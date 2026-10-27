import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { ErrorLog } from './errors';
import { GameHistory } from './history';
import { SavedRooms } from './saved-rooms';
import { createStaticHandler } from './static';
import type { ClientToServerEvents, ServerToClientEvents } from './protocol';
import { chooseBotAction } from './bot';
import { DEFAULT_LIMITS, type Limits, RateLimiter, clientIp } from './limits';
import { type PlayerAction, RoomManager, type Result } from './rooms';

/** Délai avant de supprimer un salon dont tous les joueurs sont partis. */
export const ABANDONED_ROOM_DELAY_MS = 10 * 60 * 1000;
/** Délai plus court pour un salon dont la partie n'a pas commencé : rien à perdre à le fermer. */
export const ABANDONED_LOBBY_DELAY_MS = 60 * 1000;
/** Chat : longueur maximale d'un message, et nombre de messages par connexion sur la fenêtre donnée. */
const CHAT_MAX_LENGTH = 200;
const CHAT_MESSAGES = 6;
const CHAT_WINDOW_MS = 10 * 1000;

interface SocketData {
  code?: string;
  playerId?: string;
  ip?: string;
  /** Regarde la partie de `code` sans y jouer. */
  spectator?: boolean;
}

export interface GameServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
  rooms: RoomManager;
  history: GameHistory;
  errors: ErrorLog;
  /** Enregistre tout de suite les salons sur disque (avant un arrêt du serveur). */
  saveRooms: () => void;
}

export interface GameServerOptions {
  corsOrigin?: string | string[];
  abandonDelayMs?: number;
  /** Délai avant de supprimer un salon abandonné avant le début de la partie. */
  lobbyAbandonDelayMs?: number;
  /** Garde-fous contre la création de salons ou de connexions à la chaîne. */
  limits?: Partial<Limits>;
  /** Dossier de l'interface compilée à servir sur la même adresse que le jeu. */
  staticDir?: string;
  /** Fichier JSON de l'historique des parties ; sans fichier, l'historique reste en mémoire. */
  historyFile?: string;
  /** Journal des erreurs (une ligne JSON par erreur), relevé par la surveillance GitHub. */
  errorsFile?: string;
  /** Durée d'une « seconde » du minuteur de tour, en millisecondes (raccourcie dans les tests). */
  turnSecondMs?: number;
  /** Temps de réflexion des bots, pour que les humains voient leurs coups passer. */
  botDelayMs?: number;
  /** Fichier JSON des salons en cours, rechargé au démarrage ; sans fichier, un redémarrage les perd. */
  roomsFile?: string;
}

type AnyAck = (result: unknown) => void;

/** Ce qui est envoyé avec un événement : n'importe quoi, puisque ça vient du réseau. */
type Payload = Record<string, unknown>;

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const http = createHttpServer(options.staticDir ? createStaticHandler(options.staticDir) : undefined);
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(http, {
    cors: options.corsOrigin ? { origin: options.corsOrigin } : undefined,
    // Un message trop gros est refusé (et la connexion coupée) avant même d'être lu.
    maxHttpBufferSize: limits.maxMessageBytes,
  });
  const rooms = new RoomManager();
  const history = new GameHistory(options.historyFile);
  const errors = new ErrorLog(options.errorsFile);
  const saved = new SavedRooms(options.roomsFile, () => rooms.all());
  rooms.restore(saved.load());

  /** Ajoute la partie à l'historique dès qu'elle est terminée, une seule fois. */
  function recordIfFinished(code: string) {
    const room = rooms.get(code);
    if (room?.game?.phase !== 'gameOver' || room.recorded) return;
    room.recorded = true;
    const bots = room.seats.flatMap((s, i) => (s.bot ? [i] : []));
    history.record(room.game, new Date(), bots);
  }

  const botTimers = new Map<string, NodeJS.Timeout>();
  const botDelay = options.botDelayMs ?? 1100;

  /** Si c'est à un bot d'agir, il joue après un court délai, puis on regarde si le suivant est aussi un bot. */
  function scheduleBots(code: string) {
    if (botTimers.has(code) || !rooms.botToAct(code)) return;
    botTimers.set(
      code,
      setTimeout(() => {
        botTimers.delete(code);
        try {
          playBot(code);
        } catch (error) {
          errors.record('bot', error);
        }
      }, botDelay),
    );
  }

  /** Le bot dont c'est le tour joue (s'il est toujours de mise), puis on regarde si le suivant est aussi un bot. */
  function playBot(code: string) {
    const room = rooms.get(code);
    const seat = rooms.botToAct(code);
    if (!room?.game || !seat) return;
    const index = room.seats.indexOf(seat);
    const choice = chooseBotAction(room.game, index);
    if (!choice) return;
    const { playerIndex: _index, ...action } = choice as typeof choice & { playerIndex?: number };
    let result = rooms.act(code, seat.playerId, action as PlayerAction);
    // Coup refusé (cas non prévu par la stratégie) : le bot passe, ou ouvre avec sa plus petite carte.
    if (!result.ok && room.game.phase === 'playing') {
      const hand = room.game.players[index]!.hand;
      result = rooms.act(code, seat.playerId, room.game.table ? { type: 'pass' } : { type: 'play', cardIds: [hand[0]!.id] });
    }
    if (!result.ok) errors.record('bot', new Error(`Bot bloqué dans le salon ${code} : ${result.error}`));
    recordIfFinished(code);
    void broadcast(code);
    scheduleBots(code);
  }
  const turnTimers = new Map<string, { turn: string; endsAt: number; timer: NodeJS.Timeout }>();

  /**
   * Minuteur de tour : quand un humain doit agir, il a `turnSeconds` secondes ; ensuite le serveur agit pour lui
   * (il passe, ou joue comme un bot s'il doit ouvrir, couper ou rendre une carte). Renvoie le temps restant.
   */
  function updateTurnTimer(code: string): number | null {
    const room = rooms.get(code);
    const game = room?.game;
    const seat = rooms.seatToAct(code);
    const current = turnTimers.get(code);
    // Le tour est identifié par la manche, la phase, le pli et le joueur : tant qu'il ne change pas, le temps court.
    const turn = game && seat ? `${game.round}-${game.phase}-${game.trick.length}-${game.currentPlayer}-${seat.playerId}` : '';
    const active = !!room?.turnSeconds && !!seat && !seat.bot && !rooms.isAbandoned(code);
    if (!active) {
      clearTimeout(current?.timer);
      turnTimers.delete(code);
      return null;
    }
    if (current?.turn === turn) return Math.max(0, current.endsAt - Date.now());
    clearTimeout(current?.timer);
    const delay = room.turnSeconds! * (options.turnSecondMs ?? 1000);
    const timer = setTimeout(() => {
      turnTimers.delete(code);
      try {
        timeUp(code, turn);
      } catch (error) {
        errors.record('minuteur', error);
      }
    }, delay);
    turnTimers.set(code, { turn, endsAt: Date.now() + delay, timer });
    return delay;
  }

  /** Temps écoulé : le serveur joue à la place du joueur, au plus simple. */
  function timeUp(code: string, turn: string) {
    const room = rooms.get(code);
    const seat = rooms.seatToAct(code);
    const game = room?.game;
    if (!room || !game || !seat) return;
    if (`${game.round}-${game.phase}-${game.trick.length}-${game.currentPlayer}-${seat.playerId}` !== turn) return;
    const index = room.seats.indexOf(seat);
    let action: PlayerAction | null = null;
    if (game.phase === 'playing' && game.table) {
      action = { type: 'pass' };
    } else {
      const choice = chooseBotAction(game, index);
      if (choice && choice.type !== 'nextRound') {
        const { playerIndex: _index, ...rest } = choice;
        action = rest as PlayerAction;
      }
    }
    if (!action) return;
    const result = rooms.act(code, seat.playerId, action);
    if (!result.ok) {
      errors.record('minuteur', new Error(`Coup refusé dans le salon ${code} : ${result.error}`));
      return;
    }
    recordIfFinished(code);
    void broadcast(code);
    scheduleBots(code);
  }

  const cleanupTimers = new Map<string, NodeJS.Timeout>();
  const abandonDelay = options.abandonDelayMs ?? ABANDONED_ROOM_DELAY_MS;
  const lobbyAbandonDelay = options.lobbyAbandonDelayMs ?? ABANDONED_LOBBY_DELAY_MS;

  /** Envoie à chaque joueur connecté l'état du salon et sa propre vue de la partie. */
  async function broadcast(code: string) {
    saved.schedule();
    const room = rooms.get(code);
    if (!room) return;
    const turnRemainingMs = updateTurnTimer(code);
    const sockets = await io.in(room.code).fetchSockets();
    const spectators = sockets.filter((s) => s.data.spectator).length;
    const roomView = { ...rooms.roomView(room), turnRemainingMs, spectators };
    for (const socket of sockets) {
      socket.emit('room:state', roomView);
      const gameView = socket.data.spectator ? rooms.spectatorView(room) : rooms.gameView(room, socket.data.playerId!);
      if (gameView) socket.emit('game:state', gameView);
    }
  }

  function scheduleCleanup(code: string) {
    clearTimeout(cleanupTimers.get(code));
    if (!rooms.isAbandoned(code)) return;
    cleanupTimers.set(
      code,
      setTimeout(() => {
        if (rooms.isAbandoned(code)) rooms.delete(code);
        cleanupTimers.delete(code);
        saved.schedule();
      }, rooms.get(code)?.game ? abandonDelay : lobbyAbandonDelay),
    );
  }

  const connectionsPerIp = new RateLimiter(limits.connectionsPerIp, limits.windowMs);
  const roomsPerIp = new RateLimiter(limits.roomsPerIp, limits.windowMs);
  const roomsPerSocket = new RateLimiter(limits.roomsPerSocket, limits.windowMs);
  const openSockets = new Map<string, number>();
  const chatPerSocket = new RateLimiter(CHAT_MESSAGES, CHAT_WINDOW_MS);
  const eventsPerSocket = new RateLimiter(limits.eventsPerSocket, limits.eventWindowMs);

  // Refuse les connexions d'une adresse qui en ouvre trop, en même temps ou à la suite.
  io.use((socket, next) => {
    const ip = clientIp(socket.request);
    if ((openSockets.get(ip) ?? 0) >= limits.socketsPerIp || !connectionsPerIp.allow(ip)) {
      return next(new Error('slowDown'));
    }
    socket.data.ip = ip;
    openSockets.set(ip, (openSockets.get(ip) ?? 0) + 1);
    socket.on('disconnect', () => {
      const left = (openSockets.get(ip) ?? 1) - 1;
      if (left > 0) openSockets.set(ip, left);
      else openSockets.delete(ip);
    });
    next();
  });

  /** Vérifie qu'on peut encore ouvrir un salon : nombre total, et rythme par adresse et par connexion. */
  function canCreateRoom(ip: string, socketId: string): Result {
    if (rooms.count() >= limits.maxRooms) return { ok: false, error: 'tooManyRooms' };
    if (!roomsPerSocket.allow(socketId) || !roomsPerIp.allow(ip)) return { ok: false, error: 'slowDown' };
    return { ok: true };
  }

  io.on('connection', (socket) => {
    /**
     * Branche un événement en se méfiant de ce qui arrive : charge utile absente ou d'un autre type, pas de
     * fonction de réponse (ack), ou erreur imprévue. Rien de tout ça ne doit pouvoir arrêter le serveur.
     */
    function on(event: string, handler: (payload: Payload, ack: AnyAck) => unknown) {
      (socket as unknown as { on: (e: string, l: (...args: unknown[]) => void) => void }).on(event, (...args) => {
        const last = args[args.length - 1];
        const ack: AnyAck = typeof last === 'function' ? (last as AnyAck) : () => {};
        const first = args[0];
        const payload: Payload = first && typeof first === 'object' && !Array.isArray(first) ? (first as Payload) : {};
        // Une connexion qui envoie des événements à la chaîne est freinée : on refuse sans rien traiter.
        if (!eventsPerSocket.allow(socket.id)) {
          try {
            ack({ ok: false, error: 'slowDown' });
          } catch {
            // Rien à faire si la réponse échoue.
          }
          return;
        }
        const fail = (error: unknown) => {
          errors.record(`événement ${event}`, error);
          try {
            ack({ ok: false, error: 'serverError' });
          } catch {
            // La réponse elle-même a échoué : rien de plus à faire.
          }
        };
        try {
          const result = handler(payload, ack);
          if (result instanceof Promise) result.catch(fail);
        } catch (error) {
          fail(error);
        }
      });
    }
    const text = (value: unknown) => (typeof value === 'string' ? value : '');

    async function enter(result: Result<{ code: string; playerId: string; token: string }>, ack: AnyAck) {
      if (result.ok) {
        if (socket.data.code) leaveCurrent();
        socket.data = { ip: socket.data.ip, code: result.code, playerId: result.playerId };
        await socket.join(result.code);
        clearTimeout(cleanupTimers.get(result.code));
      }
      ack(result);
      if (result.ok) await broadcast(result.code);
    }

    function leaveCurrent() {
      const { code, playerId, spectator } = socket.data;
      if (code && spectator) {
        void socket.leave(code);
        socket.data = { ip: socket.data.ip };
        void broadcast(code);
        return;
      }
      if (!code || !playerId) return;
      rooms.leave(code, playerId);
      void socket.leave(code);
      socket.data = { ip: socket.data.ip };
      scheduleCleanup(code);
      void broadcast(code);
    }

    /** Exécute une commande pour le joueur de cette socket, puis diffuse le nouvel état. */
    function handle(ack: AnyAck, run: (code: string, playerId: string) => Result) {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return ack({ ok: false, error: 'notInRoom' });
      const result = run(code, playerId);
      ack(result);
      if (result.ok) {
        void broadcast(code);
        scheduleBots(code);
      }
    }

    const act = (action: PlayerAction, ack: AnyAck) =>
      handle(ack, (code, playerId) => {
        const result = rooms.act(code, playerId, action);
        if (result.ok) recordIfFinished(code);
        return result;
      });

    on('room:create', (payload, ack) => {
      const allowed = canCreateRoom(socket.data.ip ?? '', socket.id);
      return allowed.ok ? enter(rooms.create(payload.name, payload), ack) : ack(allowed);
    });
    on('room:join', (payload, ack) => enter(rooms.join(text(payload.code), payload.name, payload), ack));
    on('room:rejoin', (payload, ack) => enter(rooms.rejoin(text(payload.code), text(payload.token)), ack));
    on('room:leave', (_payload, ack) => {
      leaveCurrent();
      ack({ ok: true });
    });
    on('room:watch', async (payload, ack) => {
      const room = rooms.get(text(payload.code));
      if (!room) return ack({ ok: false, error: 'roomNotFound' });
      if (!room.game) return ack({ ok: false, error: 'gameNotStarted' });
      if (socket.data.code) leaveCurrent();
      socket.data = { ip: socket.data.ip, code: room.code, spectator: true };
      await socket.join(room.code);
      ack({ ok: true, code: room.code, playerId: '', token: '', spectator: true });
      await broadcast(room.code);
    });
    on('rooms:live', async (_payload, ack) => {
      const live = await Promise.all(
        rooms.live().map(async (room) => {
          const sockets = await io.in(room.code).fetchSockets();
          return { ...room, spectators: sockets.filter((s) => s.data.spectator).length };
        }),
      );
      ack({ ok: true, rooms: live });
    });
    // Le chat n'est que relayé : rien n'est gardé sur le serveur, ni en mémoire ni sur disque.
    on('chat:send', (payload, ack) => {
      const { code, playerId } = socket.data;
      const seat = code && playerId ? rooms.get(code)?.seats.find((s) => s.playerId === playerId) : undefined;
      if (!code || !seat) return ack({ ok: false, error: 'notInRoom' });
      const message = text(payload.text).replace(/[\p{Cc}]/gu, ' ').trim().slice(0, CHAT_MAX_LENGTH);
      if (!message) return ack({ ok: false, error: 'emptyMessage' });
      if (!chatPerSocket.allow(socket.id)) return ack({ ok: false, error: 'slowDown' });
      io.to(code).emit('chat:message', { id: randomUUID(), playerId: seat.playerId, name: seat.name, text: message, at: Date.now() });
      ack({ ok: true });
    });
    on('room:addBot', (_payload, ack) => handle(ack, (code, playerId) => rooms.addBot(code, playerId)));
    on('room:removeBot', (payload, ack) => handle(ack, (code, playerId) => rooms.removeBot(code, playerId, text(payload.botId))));
    on('game:start', (payload, ack) =>
      handle(ack, (code, playerId) =>
        rooms.start(code, playerId, { targetScore: Number(payload.targetScore), turnSeconds: Number(payload.turnSeconds) }),
      ),
    );
    on('game:rematch', (_payload, ack) => handle(ack, (code, playerId) => rooms.rematch(code, playerId)));
    on('game:play', (payload, ack) =>
      act({ type: 'play', cardIds: Array.isArray(payload.cardIds) ? payload.cardIds.map(String) : [] }, ack),
    );
    on('game:pass', (_payload, ack) => act({ type: 'pass' }, ack));
    on('game:giveCard', (payload, ack) => act({ type: 'giveCard', cardId: text(payload.cardId) }, ack));
    on('game:nextRound', (_payload, ack) => act({ type: 'nextRound' }, ack));
    on('game:cut', (payload, ack) => act({ type: 'cut', position: Number(payload.position) }, ack));
    on('stats:get', (_payload, ack) => ack({ ok: true, leaderboard: history.leaderboard(), recent: history.recent() }));
    on('stats:player', (payload, ack) => ack({ ok: true, profile: history.profile(text(payload.name)) }));

    socket.on('disconnect', () => {
      const { code, playerId, spectator } = socket.data;
      if (code && spectator) return void broadcast(code);
      if (!code || !playerId) return;
      rooms.setConnected(code, playerId, false);
      scheduleCleanup(code);
      void broadcast(code);
    });
  });

  // Les salons rechargés après un redémarrage sont supprimés si personne ne revient.
  // Les bots d'une partie rechargée reprennent la main s'ils devaient jouer.
  rooms.all().forEach((room) => {
    scheduleCleanup(room.code);
    scheduleBots(room.code);
  });

  io.engine.on('close', () => {
    cleanupTimers.forEach(clearTimeout);
    botTimers.forEach(clearTimeout);
    turnTimers.forEach((t) => clearTimeout(t.timer));
  });
  return { http, io, rooms, history, errors, saveRooms: () => saved.saveNow() };
}
