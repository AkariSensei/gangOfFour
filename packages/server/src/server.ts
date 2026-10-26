import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { GameHistory } from './history';
import { SavedRooms } from './saved-rooms';
import { createStaticHandler } from './static';
import type { ClientToServerEvents, ServerToClientEvents } from './protocol';
import { type PlayerAction, RoomManager, type Result } from './rooms';

/** Délai avant de supprimer un salon dont tous les joueurs sont partis. */
export const ABANDONED_ROOM_DELAY_MS = 10 * 60 * 1000;

interface SocketData {
  code?: string;
  playerId?: string;
}

export interface GameServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
  rooms: RoomManager;
  history: GameHistory;
  /** Enregistre tout de suite les salons sur disque (avant un arrêt du serveur). */
  saveRooms: () => void;
}

export interface GameServerOptions {
  corsOrigin?: string | string[];
  abandonDelayMs?: number;
  /** Dossier de l'interface compilée à servir sur la même adresse que le jeu. */
  staticDir?: string;
  /** Fichier JSON de l'historique des parties ; sans fichier, l'historique reste en mémoire. */
  historyFile?: string;
  /** Fichier JSON des salons en cours, rechargé au démarrage ; sans fichier, un redémarrage les perd. */
  roomsFile?: string;
}

type AnyAck = (result: unknown) => void;

/** Ce qui est envoyé avec un événement : n'importe quoi, puisque ça vient du réseau. */
type Payload = Record<string, unknown>;

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const http = createHttpServer(options.staticDir ? createStaticHandler(options.staticDir) : undefined);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(http, {
    cors: options.corsOrigin ? { origin: options.corsOrigin } : undefined,
  });
  const rooms = new RoomManager();
  const history = new GameHistory(options.historyFile);
  const saved = new SavedRooms(options.roomsFile, () => rooms.all());
  rooms.restore(saved.load());

  /** Ajoute la partie à l'historique dès qu'elle est terminée, une seule fois. */
  function recordIfFinished(code: string) {
    const room = rooms.get(code);
    if (room?.game?.phase !== 'gameOver' || room.recorded) return;
    room.recorded = true;
    history.record(room.game);
  }
  const cleanupTimers = new Map<string, NodeJS.Timeout>();
  const abandonDelay = options.abandonDelayMs ?? ABANDONED_ROOM_DELAY_MS;

  /** Envoie à chaque joueur connecté l'état du salon et sa propre vue de la partie. */
  async function broadcast(code: string) {
    saved.schedule();
    const room = rooms.get(code);
    if (!room) return;
    const roomView = rooms.roomView(room);
    for (const socket of await io.in(room.code).fetchSockets()) {
      socket.emit('room:state', roomView);
      const gameView = rooms.gameView(room, socket.data.playerId!);
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
      }, abandonDelay),
    );
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
        const fail = (error: unknown) => {
          console.error(`Erreur sur l'événement ${event} :`, error);
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
        socket.data = { code: result.code, playerId: result.playerId };
        await socket.join(result.code);
        clearTimeout(cleanupTimers.get(result.code));
      }
      ack(result);
      if (result.ok) await broadcast(result.code);
    }

    function leaveCurrent() {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return;
      rooms.leave(code, playerId);
      void socket.leave(code);
      socket.data = {};
      scheduleCleanup(code);
      void broadcast(code);
    }

    /** Exécute une commande pour le joueur de cette socket, puis diffuse le nouvel état. */
    function handle(ack: AnyAck, run: (code: string, playerId: string) => Result) {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return ack({ ok: false, error: 'notInRoom' });
      const result = run(code, playerId);
      ack(result);
      if (result.ok) void broadcast(code);
    }

    const act = (action: PlayerAction, ack: AnyAck) =>
      handle(ack, (code, playerId) => {
        const result = rooms.act(code, playerId, action);
        if (result.ok) recordIfFinished(code);
        return result;
      });

    on('room:create', (payload, ack) => enter(rooms.create(payload.name), ack));
    on('room:join', (payload, ack) => enter(rooms.join(text(payload.code), payload.name), ack));
    on('room:rejoin', (payload, ack) => enter(rooms.rejoin(text(payload.code), text(payload.token)), ack));
    on('room:leave', (_payload, ack) => {
      leaveCurrent();
      ack({ ok: true });
    });
    on('game:start', (_payload, ack) => handle(ack, (code, playerId) => rooms.start(code, playerId)));
    on('game:play', (payload, ack) =>
      act({ type: 'play', cardIds: Array.isArray(payload.cardIds) ? payload.cardIds.map(String) : [] }, ack),
    );
    on('game:pass', (_payload, ack) => act({ type: 'pass' }, ack));
    on('game:giveCard', (payload, ack) => act({ type: 'giveCard', cardId: text(payload.cardId) }, ack));
    on('game:nextRound', (_payload, ack) => act({ type: 'nextRound' }, ack));
    on('game:cut', (payload, ack) => act({ type: 'cut', position: Number(payload.position) }, ack));
    on('stats:get', (_payload, ack) => ack({ ok: true, leaderboard: history.leaderboard(), recent: history.recent() }));

    socket.on('disconnect', () => {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return;
      rooms.setConnected(code, playerId, false);
      scheduleCleanup(code);
      void broadcast(code);
    });
  });

  // Les salons rechargés après un redémarrage sont supprimés si personne ne revient.
  rooms.all().forEach((room) => scheduleCleanup(room.code));

  io.engine.on('close', () => cleanupTimers.forEach(clearTimeout));
  return { http, io, rooms, history, saveRooms: () => saved.saveNow() };
}
