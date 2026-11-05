import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { AccountStore } from './accounts';
import { newRewards } from './progression';
import { ErrorLog } from './errors';
import { type VerifyGoogle, googleVerifier } from './google';
import { CommunityStore } from './community';
import { GameHistory } from './history';
import { seasonOf } from './seasons';
import { SavedRooms } from './saved-rooms';
import { SiteSettings } from './site';
import { createStaticHandler } from './static';
import type { GameState } from '@gof/engine';
import { type ClientToServerEvents, type GameStats, type GameView, REACTIONS, type ServerToClientEvents } from './protocol';
import { DEFAULT_LIMITS, type Limits, RateLimiter, clientIp } from './limits';
import { type PlayerAction, type Room, RoomManager, type Result, rulesOfRoom } from './rooms';
import { type GameId, isGameId } from './rules';

/**
 * Délai avant de supprimer une partie dont tous les joueurs ont fermé leur onglet (le temps de recharger la page).
 * Un joueur qui clique sur « Quitter » en dernier ferme le salon tout de suite.
 */
export const ABANDONED_ROOM_DELAY_MS = 2 * 60 * 1000;
/** Délai plus court pour un salon dont la partie n'a pas commencé : rien à perdre à le fermer. */
export const ABANDONED_LOBBY_DELAY_MS = 15 * 1000;
/** Temps laissé à un joueur parti en pleine partie avant qu'un bot ne joue à sa place. */
export const AWAY_DELAY_MS = 60 * 1000;
/** Chat : longueur maximale d'un message, et nombre de messages par connexion sur la fenêtre donnée. */
const CHAT_MAX_LENGTH = 200;
const CHAT_MESSAGES = 6;
const CHAT_WINDOW_MS = 10 * 1000;
/** Idées et commentaires qu'un compte peut poster par heure sur le mur de la communauté. */
const IDEAS_PER_HOUR = 5;
const COMMENTS_PER_HOUR = 30;
/** Fenêtre des essais de mot de passe (et d'invitation) limités par adresse et par identifiant. */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Réactions : quelques-unes à la suite, pas plus, pour ne pas inonder la table. */
const REACTIONS_PER_WINDOW = 4;
const REACTIONS_WINDOW_MS = 5 * 1000;

interface SocketData {
  code?: string;
  playerId?: string;
  ip?: string;
  /** Regarde la partie de `code` sans y jouer. */
  spectator?: boolean;
  /** Compte du joueur connecté (session envoyée à la connexion, ou connexion Google). */
  accountId?: string;
}

export interface GameServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
  rooms: RoomManager;
  history: GameHistory;
  accounts: AccountStore;
  errors: ErrorLog;
  /** Enregistre tout de suite les salons sur disque (avant un arrêt du serveur). */
  saveRooms: () => void;
}

export interface GameServerOptions {
  corsOrigin?: string | string[];
  abandonDelayMs?: number;
  /** Délai avant qu'un bot remplace un joueur déconnecté en pleine partie. */
  awayDelayMs?: number;
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
  /** Pause des bots juste après la coupe, le temps que la table voie l'animation (l'interface la montre 1,8 s). */
  cutPauseMs?: number;
  /** Fichier JSON des salons en cours, rechargé au démarrage ; sans fichier, un redémarrage les perd. */
  roomsFile?: string;
  /** Fichier JSON du mur de la communauté ; sans fichier, il reste en mémoire. */
  communityFile?: string;
  /** Fichier JSON des comptes ; sans fichier, les comptes restent en mémoire. */
  accountsFile?: string;
  /** Identifiant du client OAuth Google (GOOGLE_CLIENT_ID) ; sans lui, personne ne peut se connecter. */
  googleClientId?: string;
  /** Adresse Google de l'admin (ADMIN_EMAIL) : il gère les comptes et peut tenir plusieurs sièges pour tester seul. */
  adminEmail?: string;
  /** Vérification du jeton Google (remplacée dans les tests). */
  verifyGoogle?: VerifyGoogle;
  /** Fichier JSON des réglages du site (maintenance) ; sans fichier, ils restent en mémoire. */
  siteFile?: string;
  /** Site en maintenance tant que l'admin ne l'a pas rouvert (quand le fichier des réglages n'existe pas encore). */
  maintenanceByDefault?: boolean;
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
  const accounts = new AccountStore(options.accountsFile, options.adminEmail);
  const history = new GameHistory(options.historyFile, accounts);
  const community = new CommunityStore(options.communityFile);
  // Au démarrage (après une mise à jour qui change les règles de l'expérience), on retire à chacun les récompenses
  // qu'il avait choisies mais qui ne sont plus débloquées à son niveau.
  for (const account of accounts.list()) {
    if (!account.felt && !account.frame && !account.title) continue;
    const unlocks = history.unlocksOfAccount(account.id);
    const keep = {
      felt: account.felt && unlocks.felts.includes(account.felt) ? account.felt : '',
      frame: account.frame && unlocks.frames.includes(account.frame) ? account.frame : '',
      title: account.title && unlocks.titles.includes(account.title) ? account.title : '',
    };
    if (keep.felt !== (account.felt ?? '') || keep.frame !== (account.frame ?? '') || keep.title !== (account.title ?? '')) {
      accounts.update(account.id, { cosmetics: keep });
    }
  }
  const verifyGoogle = options.verifyGoogle ?? (options.googleClientId ? googleVerifier(options.googleClientId) : undefined);
  const errors = new ErrorLog(options.errorsFile);
  const site = new SiteSettings(options.siteFile, { maintenance: options.maintenanceByDefault ?? false });
  const saved = new SavedRooms(options.roomsFile, () => rooms.all());
  rooms.restore(saved.load());

  /** Ajoute la partie à l'historique dès qu'elle est terminée, une seule fois. */
  function recordIfFinished(code: string) {
    const room = rooms.get(code);
    if (!room?.game || !rulesOfRoom(room).over(room.game) || room.recorded) return;
    room.recorded = true;
    // Ne comptent que les parties entre humains : ni le tutoriel (une manche écrite à l'avance), ni l'entraînement,
    // ni une table où l'hôte avait encore pu asseoir des bots (salons d'avant l'entraînement).
    if (room.tutorial || room.training || room.seats.some((s) => s.bot)) return;
    const game = room.game;
    withProgress(room, () =>
      history.add(
        rulesOfRoom(room).summary(game),
        new Date(),
        botSeats(room),
        room.seats.map((s) => s.account),
        botLevels(room),
      ),
    );
    io.emit('stats:changed');
  }

  /**
   * Enregistre une fin de partie, puis annonce à chaque joueur de la table l'expérience qu'elle lui a
   * rapportée : niveau avant et après, et les récompenses débloquées en passant de niveau.
   */
  function withProgress(room: Room, record: () => unknown) {
    const humans = [...new Set(room.seats.flatMap((s, i) => (s.account && !botSeats(room).includes(i) ? [s.account] : [])))];
    const before = new Map(humans.map((id) => [id, { progress: history.progressOfAccount(id), daily: history.dailyOfAccount(id) }]));
    record();
    for (const id of humans) {
      const { progress: was, daily: wasDaily } = before.get(id)!;
      const now = history.progressOfAccount(id);
      if (now.xp === was.xp) continue;
      // Ce qui s'annonce : la série prolongée, puis les récompenses d'un niveau supérieur.
      const daily = history.dailyOfAccount(id);
      const streak = daily.playedToday && !wasDaily.playedToday ? [`Série de ${daily.streak} jour${daily.streak > 1 ? 's' : ''}`] : [];
      const gain = { gained: now.xp - was.xp, before: was, after: now, rewards: [...streak, ...newRewards(was.level, now.level)] };
      for (const s of io.sockets.sockets.values()) if (s.data.accountId === id && s.data.code === room.code && !s.data.spectator) s.emit('progress:gained', gain);
    }
  }

  /** Niveau de chaque bot de la table (ajouté par l'hôte), pour l'historique. */
  const botLevels = (room: Room) => room.seats.map((s) => (s.bot ? (s.level ?? 'normal') : undefined));
  const botSeats = (room: Room) => room.seats.flatMap((s, i) => (s.bot || s.vacant ? [i] : []));
  const botTimers = new Map<string, NodeJS.Timeout>();
  /** Temps de réflexion d'un bot : 3 à 4 secondes, pour que chacun voie passer ses coups. */
  const botDelay = () => options.botDelayMs ?? 3000 + Math.random() * 1000;
  /** Passe automatique d'un humain qui ne peut rien poser : juste le temps que la table voie la passe. */
  const passDelay = options.botDelayMs ?? 1100;
  /** Dans le tutoriel, les bots jouent plus vite : le joueur lit surtout les explications. */
  const tutorialDelay = options.botDelayMs ?? 1600;
  const cutPause = options.cutPauseMs ?? 1800;

  /**
   * Si c'est à un bot d'agir, il joue après son temps de réflexion, puis on regarde si le suivant est aussi un bot.
   * Un humain qui ne peut rien poser passe de la même façon, plus vite.
   */
  function scheduleBots(code: string) {
    const bot = rooms.botToAct(code);
    if (botTimers.has(code) || !(bot || rooms.stuckToPass(code))) return;
    // L'échange suit juste la coupe : le bot attend la fin de l'animation pour que chacun voie la coupe puis l'échange.
    const current = rooms.get(code);
    const justCut = !current?.kind && (current?.game as GameState | null)?.phase === 'exchange';
    botTimers.set(
      code,
      setTimeout(() => {
        botTimers.delete(code);
        try {
          playBot(code);
        } catch (error) {
          errors.record('bot', error);
        }
      }, (bot ? (rooms.get(code)?.tutorial ? tutorialDelay : botDelay()) : passDelay) + (justCut ? cutPause : 0)),
    );
  }

  /** Le bot dont c'est le tour joue (s'il est toujours de mise), puis on regarde si le suivant est aussi un bot. */
  function playBot(code: string) {
    const room = rooms.get(code);
    const stuck = rooms.stuckToPass(code);
    if (room && stuck) {
      const result = rooms.act(code, stuck.playerId, { type: 'pass' });
      if (!result.ok) errors.record('bot', new Error(`Passe automatique refusée dans le salon ${code} : ${result.error}`));
      void broadcast(code);
      scheduleBots(code);
      return;
    }
    const seat = rooms.botToAct(code);
    if (!room?.game || !seat) return;
    const index = room.seats.indexOf(seat);
    // Tutoriel : le bot joue le coup prévu par le script.
    const scripted = rooms.tutorialMove(room);
    const rules = rulesOfRoom(room);
    const action: PlayerAction | null | undefined = room.tutorial
      ? scripted && (scripted.cardIds ? { type: 'play', cardIds: scripted.cardIds } : { type: 'pass' })
      : rules.botAction(room.game, index, Math.random, seat.level);
    if (!action) return;
    let result = rooms.act(code, seat.playerId, action);
    // Coup refusé (cas non prévu par la stratégie) : le bot passe, ou ouvre avec sa plus petite carte.
    const fallback = result.ok ? null : rules.fallback(room.game, index);
    if (fallback) result = rooms.act(code, seat.playerId, fallback);
    if (!result.ok) errors.record('bot', new Error(`Bot bloqué dans le salon ${code} : ${result.error}`));
    recordIfFinished(code);
    void broadcast(code);
    scheduleBots(code);
  }
  /** Minuteur du tour en cours ; en pause, `timer` est arrêté et `remaining` garde le temps qu'il restait. */
  const turnTimers = new Map<string, { turn: string; endsAt: number; timer?: NodeJS.Timeout; remaining?: number }>();

  /**
   * Minuteur de tour : quand un humain doit agir, il a `turnSeconds` secondes ; ensuite le serveur agit pour lui
   * (il passe, ou joue comme un bot s'il doit ouvrir ou couper). Sauf pendant l'échange. Renvoie le temps restant.
   */
  function updateTurnTimer(code: string): number | null {
    const room = rooms.get(code);
    const game = room?.game;
    const seat = rooms.seatToAct(code);
    const current = turnTimers.get(code);
    // Le tour est identifié par la manche, la phase, le pli et le joueur : tant qu'il ne change pas, le temps court.
    const turn = room && game && seat ? `${rulesOfRoom(room).turnKey(game)}-${seat.playerId}` : '';
    // Pas de minuteur pendant l'échange : le gagnant prend le temps de choisir les cartes qu'il rend.
    const active = !!room?.turnSeconds && !!seat && !seat.bot && !seat.away && !rooms.isAbandoned(code) && !!game && !rulesOfRoom(room).untimed(game);
    if (!active) {
      clearTimeout(current?.timer);
      turnTimers.delete(code);
      return null;
    }
    const sameTurn = current?.turn === turn;
    if (room.paused) {
      // Pause : le temps restant est gelé, il repartira de là à la reprise.
      if (sameTurn && current.timer) {
        clearTimeout(current.timer);
        current.timer = undefined;
        current.remaining = Math.max(0, current.endsAt - Date.now());
      }
      return sameTurn ? current.remaining! : null;
    }
    if (sameTurn && current.timer) return Math.max(0, current.endsAt - Date.now());
    clearTimeout(current?.timer);
    const delay = sameTurn ? current.remaining! : room.turnSeconds! * (options.turnSecondMs ?? 1000);
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
    if (!room || !game || !seat || room.paused) return;
    const rules = rulesOfRoom(room);
    if (`${rules.turnKey(game)}-${seat.playerId}` !== turn) return;
    const action = rules.timeout(game, room.seats.indexOf(seat));
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
      if (gameView) socket.emit('game:state', gameView as GameView);
    }
  }

  const awayTimers = new Map<string, NodeJS.Timeout>();
  const awayDelay = options.awayDelayMs ?? AWAY_DELAY_MS;

  /** Joueur déconnecté en pleine partie : s'il n'est pas revenu au bout d'une minute, un bot joue pour lui. */
  function scheduleAway(code: string, playerId: string) {
    const key = `${code}/${playerId}`;
    clearTimeout(awayTimers.get(key));
    awayTimers.set(
      key,
      setTimeout(() => {
        awayTimers.delete(key);
        if (!rooms.replaceByBot(code, playerId)) return;
        void broadcast(code);
        scheduleBots(code);
      }, awayDelay),
    );
  }

  /** Ferme un salon : il disparaît des parties en cours et ne peut plus être rejoint. */
  function closeRoom(code: string) {
    clearTimeout(cleanupTimers.get(code));
    cleanupTimers.delete(code);
    rooms.delete(code);
    saved.schedule();
  }

  function scheduleCleanup(code: string) {
    clearTimeout(cleanupTimers.get(code));
    if (!rooms.isAbandoned(code)) return;
    cleanupTimers.set(
      code,
      setTimeout(() => {
        if (rooms.isAbandoned(code)) closeRoom(code);
        cleanupTimers.delete(code);
      }, rooms.get(code)?.game ? abandonDelay : lobbyAbandonDelay),
    );
  }

  const connectionsPerIp = new RateLimiter(limits.connectionsPerIp, limits.windowMs);
  const roomsPerIp = new RateLimiter(limits.roomsPerIp, limits.windowMs);
  const roomsPerSocket = new RateLimiter(limits.roomsPerSocket, limits.windowMs);
  const openSockets = new Map<string, number>();
  const chatPerSocket = new RateLimiter(CHAT_MESSAGES, CHAT_WINDOW_MS);
  const reactionsPerSocket = new RateLimiter(REACTIONS_PER_WINDOW, REACTIONS_WINDOW_MS);
  const eventsPerSocket = new RateLimiter(limits.eventsPerSocket, limits.eventWindowMs);
  // Mots de passe : quelques essais par quart d'heure, par adresse et par identifiant, pour qu'on ne les devine pas.
  const loginsPerIp = new RateLimiter(limits.loginsPerIp, LOGIN_WINDOW_MS);
  const loginsPerName = new RateLimiter(limits.loginsPerIp, LOGIN_WINDOW_MS);
  // Le mur de la communauté : quelques idées par heure, un peu plus de commentaires, par compte.
  const ideasPerAccount = new RateLimiter(IDEAS_PER_HOUR, 60 * 60 * 1000);
  const commentsPerAccount = new RateLimiter(COMMENTS_PER_HOUR, 60 * 60 * 1000);

  // Refuse les connexions d'une adresse qui en ouvre trop, en même temps ou à la suite.
  io.use((socket, next) => {
    const ip = clientIp(socket.request);
    if ((openSockets.get(ip) ?? 0) >= limits.socketsPerIp || !connectionsPerIp.allow(ip)) {
      return next(new Error('slowDown'));
    }
    socket.data.ip = ip;
    const { session } = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    socket.data.accountId = accounts.fromSession(session)?.id;
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
        socket.data = { ip: socket.data.ip, accountId: socket.data.accountId, code: result.code, playerId: result.playerId };
        await socket.join(result.code);
        clearTimeout(cleanupTimers.get(result.code));
        clearTimeout(awayTimers.get(`${result.code}/${result.playerId}`));
        awayTimers.delete(`${result.code}/${result.playerId}`);
      }
      ack(result);
      if (result.ok) {
        await broadcast(result.code);
        // Un humain revient : les bots remplaçants peuvent reprendre s'ils attendaient.
        scheduleBots(result.code);
      }
    }

    function leaveCurrent() {
      const { code, playerId, spectator } = socket.data;
      if (code && spectator) {
        void socket.leave(code);
        socket.data = { ip: socket.data.ip, accountId: socket.data.accountId };
        void broadcast(code);
        return;
      }
      if (!code || !playerId) return;
      rooms.leave(code, playerId);
      void socket.leave(code);
      socket.data = { ip: socket.data.ip, accountId: socket.data.accountId };
      // Le dernier vrai joueur s'en va : le salon (partie lancée ou non) est fermé tout de suite.
      if (rooms.isAbandoned(code)) return closeRoom(code);
      if (rooms.get(code)?.game) scheduleAway(code, playerId);
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

    /** Compte de cette connexion, s'il existe encore et n'est pas bloqué. */
    function me() {
      const account = accounts.get(socket.data.accountId);
      return account && !account.blocked ? account : undefined;
    }

    /** Site en maintenance : seul l'admin entre encore dans les salons. */
    const closed = () => site.maintenance && !accounts.isAdmin(me());

    /** Pour s'asseoir à une table, il faut un compte avec un pseudo (et un site ouvert). */
    function player(): Result<{ account: NonNullable<ReturnType<typeof me>>; name: string }> {
      const account = me();
      if (closed()) return { ok: false, error: 'maintenance' };
      if (!account) return { ok: false, error: 'notSignedIn' };
      if (!account.name) return { ok: false, error: 'noName' };
      return { ok: true, account, name: account.name };
    }

    on('site:get', (_payload, ack) => ack({ ok: true, maintenance: site.maintenance }));
    on('admin:maintenance', (payload, ack) => {
      if (!accounts.isAdmin(me())) return ack({ ok: false, error: 'notAdmin' });
      site.setMaintenance(payload.on === true);
      io.emit('site:changed');
      ack({ ok: true });
    });
    on('account:get', (_payload, ack) => {
      const account = me();
      ack({ ok: true, account: account ? accounts.view(account) : null, googleClientId: options.googleClientId ?? null });
    });
    on('account:google', async (payload, ack) => {
      const identity = verifyGoogle && (await verifyGoogle(text(payload.credential)));
      if (!identity) return ack({ ok: false, error: 'signInFailed' });
      const result = accounts.signIn(identity);
      if (!result.ok) return ack(result);
      socket.data.accountId = result.account.id;
      ack({ ok: true, account: accounts.view(result.account), session: accounts.session(result.account.id) });
    });
    /** Connecte cette connexion au compte, et remet au navigateur la session qui le reconnectera tout seul. */
    const signedIn = (account: NonNullable<ReturnType<typeof me>>) => {
      socket.data.accountId = account.id;
      return { ok: true as const, account: accounts.view(account), session: accounts.session(account.id) };
    };
    on('account:login', (payload, ack) => {
      const login = text(payload.login).trim().toLowerCase();
      if (!loginsPerIp.allow(socket.data.ip ?? '') || !loginsPerName.allow(login)) return ack({ ok: false, error: 'slowDown' });
      const result = accounts.passwordSignIn(login, payload.password);
      ack(result.ok ? signedIn(result.account) : result);
    });
    on('account:invite', (payload, ack) => {
      if (!loginsPerIp.allow(socket.data.ip ?? '')) return ack({ ok: false, error: 'slowDown' });
      const invite = accounts.findInvite(payload.code);
      if (!invite) return ack({ ok: false, error: 'invalidInvite' });
      const target = accounts.get(invite.account);
      ack({ ok: true, invite: { reset: !!invite.account, ...(target?.login ? { login: target.login } : {}) } });
    });
    on('account:register', (payload, ack) => {
      if (!loginsPerIp.allow(socket.data.ip ?? '')) return ack({ ok: false, error: 'slowDown' });
      const result = accounts.register(payload.code, payload.login, payload.password);
      ack(result.ok ? signedIn(result.account) : result);
    });
    on('account:update', (payload, ack) => {
      const account = me();
      if (!account) return ack({ ok: false, error: 'notSignedIn' });
      const result = accounts.update(account.id, { name: payload.name, look: payload });
      if (result.ok) history.claim(account.name!, account.id);
      ack(result.ok ? { ok: true, account: accounts.view(account) } : result);
    });
    on('account:cosmetics', (payload, ack) => {
      const account = me();
      if (!account) return ack({ ok: false, error: 'notSignedIn' });
      // Seulement ce que le joueur a débloqué ; une chaîne vide revient au choix par défaut.
      const unlocks = history.unlocksOfAccount(account.id);
      const cosmetics = { felt: text(payload.felt), frame: text(payload.frame), title: text(payload.title) };
      const allowed =
        (!cosmetics.felt || unlocks.felts.includes(cosmetics.felt)) &&
        (!cosmetics.frame || unlocks.frames.includes(cosmetics.frame)) &&
        (!cosmetics.title || unlocks.titles.includes(cosmetics.title));
      if (!allowed) return ack({ ok: false, error: 'locked' });
      const result = accounts.update(account.id, { cosmetics });
      ack(result.ok ? { ok: true, account: accounts.view(account) } : result);
    });
    on('account:signOut', (_payload, ack) => {
      leaveCurrent();
      socket.data.accountId = undefined;
      ack({ ok: true });
    });
    on('admin:accounts', (_payload, ack) => {
      if (!accounts.isAdmin(me())) return ack({ ok: false, error: 'notAdmin' });
      ack({
        ok: true,
        accounts: accounts.list().map((a) => ({
          id: a.id,
          email: a.email,
          ...(a.login ? { login: a.login } : {}),
          name: a.name ?? '',
          blocked: !!a.blocked,
          createdAt: a.createdAt,
          ranked: history.isRanked(a.id),
          avatar: a.avatar,
          color: a.color,
        })),
      });
    });
    on('admin:update', (payload, ack) => {
      if (!accounts.isAdmin(me())) return ack({ ok: false, error: 'notAdmin' });
      const id = text(payload.id);
      // L'admin ne peut pas se bloquer lui-même (il ne pourrait plus rien débloquer).
      if (payload.blocked === true && accounts.isAdmin(accounts.get(id))) return ack({ ok: false, error: 'notAdmin' });
      const result = accounts.update(id, {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(typeof payload.blocked === 'boolean' ? { blocked: payload.blocked } : {}),
      });
      if (result.ok && payload.name !== undefined) history.claim(accounts.get(id)!.name!, id);
      ack(result);
    });
    on('admin:invites', (_payload, ack) => {
      if (!accounts.isAdmin(me())) return ack({ ok: false, error: 'notAdmin' });
      ack({ ok: true, invites: accounts.activeInvites().map((i) => accounts.inviteView(i)) });
    });
    on('admin:invite', (payload, ack) => {
      if (!accounts.isAdmin(me())) return ack({ ok: false, error: 'notAdmin' });
      const result = accounts.createInvite(payload.accountId === undefined ? undefined : text(payload.accountId));
      ack(result.ok ? { ok: true, invite: accounts.inviteView(result.invite) } : result);
    });
    on('admin:revokeInvite', (payload, ack) => {
      if (!accounts.isAdmin(me())) return ack({ ok: false, error: 'notAdmin' });
      accounts.revokeInvite(text(payload.code));
      ack({ ok: true });
    });
    on('admin:unrank', (payload, ack) => {
      if (!accounts.isAdmin(me())) return ack({ ok: false, error: 'notAdmin' });
      const id = text(payload.id);
      if (!accounts.get(id)) return ack({ ok: false, error: 'accountNotFound' });
      history.removeFromRanking(id);
      io.emit('stats:changed');
      ack({ ok: true });
    });
    on('admin:resetRanking', (_payload, ack) => {
      if (!accounts.isAdmin(me())) return ack({ ok: false, error: 'notAdmin' });
      history.resetRanking();
      io.emit('stats:changed');
      ack({ ok: true });
    });

    on('room:create', (payload, ack) => {
      const seated = player();
      if (!seated.ok) return ack(seated);
      const { account, name } = seated;
      const allowed = canCreateRoom(socket.data.ip ?? '', socket.id);
      const game = isGameId(payload.game) ? payload.game : 'gof';
      return allowed.ok ? enter(rooms.create(name, account, account.id, game, payload.training === true), ack) : ack(allowed);
    });
    on('tutorial:start', (_payload, ack) => {
      const seated = player();
      if (!seated.ok) return ack(seated);
      const { account, name } = seated;
      const allowed = canCreateRoom(socket.data.ip ?? '', socket.id);
      return allowed.ok ? enter(rooms.createTutorial(name, account, account.id), ack) : ack(allowed);
    });
    on('daily:get', (_payload, ack) => {
      const account = me();
      if (!account) return ack({ ok: false, error: 'notSignedIn' });
      ack({ ok: true, daily: history.dailyOfAccount(account.id) });
    });
    on('room:join', (payload, ack) => {
      const seated = player();
      if (!seated.ok) return ack(seated);
      const { account, name } = seated;
      return enter(rooms.join(text(payload.code), name, account, account.id, accounts.isAdmin(account)), ack);
    });
    on('room:rejoin', (payload, ack) =>
      closed() ? ack({ ok: false, error: 'maintenance' }) : enter(rooms.rejoin(text(payload.code), text(payload.token), payload.onlyIfFree === true), ack),
    );
    on('room:leave', (_payload, ack) => {
      leaveCurrent();
      ack({ ok: true });
    });
    on('room:watch', async (payload, ack) => {
      if (closed()) return ack({ ok: false, error: 'maintenance' });
      const room = rooms.get(text(payload.code));
      if (!room) return ack({ ok: false, error: 'roomNotFound' });
      if (!room.game) return ack({ ok: false, error: 'gameNotStarted' });
      // Le tutoriel se joue seul.
      if (room.tutorial) return ack({ ok: false, error: 'roomNotFound' });
      // Le spectateur voit toutes les mains : on ne regarde pas une partie où l'on est assis (un second onglet tricherait).
      if (socket.data.accountId && room.seats.some((s) => s.account === socket.data.accountId)) return ack({ ok: false, error: 'alreadySeated' });
      if (socket.data.code) leaveCurrent();
      socket.data = { ip: socket.data.ip, accountId: socket.data.accountId, code: room.code, spectator: true };
      await socket.join(room.code);
      ack({ ok: true, code: room.code, playerId: '', token: '', spectator: true });
      await broadcast(room.code);
    });
    on('rooms:open', (payload, ack) => ack({ ok: true, rooms: rooms.open(isGameId(payload.game) ? payload.game : 'gof') }));
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
      if (rooms.isMuted(code, seat.playerId)) return ack({ ok: false, error: 'muted' });
      if (!chatPerSocket.allow(socket.id)) return ack({ ok: false, error: 'slowDown' });
      io.to(code).emit('chat:message', { id: randomUUID(), playerId: seat.playerId, name: seat.name, text: message, at: Date.now() });
      ack({ ok: true });
    });
    on('room:react', (payload, ack) => {
      const { code, playerId } = socket.data;
      const seat = code && playerId ? rooms.get(code)?.seats.find((s) => s.playerId === playerId) : undefined;
      if (!code || !seat) return ack({ ok: false, error: 'notInRoom' });
      const emoji = text(payload.emoji);
      if (!REACTIONS.includes(emoji)) return ack({ ok: false, error: 'emptyMessage' });
      // Un joueur privé de chat ne peut pas non plus réagir.
      if (rooms.isMuted(code, seat.playerId)) return ack({ ok: false, error: 'muted' });
      if (!reactionsPerSocket.allow(socket.id)) return ack({ ok: false, error: 'slowDown' });
      io.to(code).emit('room:reaction', { id: randomUUID(), playerId: seat.playerId, emoji });
      ack({ ok: true });
    });
    on('room:mute', (payload, ack) => {
      const { code, playerId } = socket.data;
      if (!code) return ack({ ok: false, error: 'notInRoom' });
      const result = rooms.setMuted(code, playerId, accounts.isAdmin(me()), text(payload.playerId), payload.muted === true);
      ack(result);
      if (result.ok) void broadcast(code);
    });
    on('room:kick', async (payload, ack) => {
      const { code, playerId } = socket.data;
      if (!code) return ack({ ok: false, error: 'notInRoom' });
      const targetId = text(payload.playerId);
      // Personne n'exclut l'admin.
      const target = rooms.get(code)?.seats.find((s) => s.playerId === targetId);
      if (accounts.isAdmin(accounts.get(target?.account))) return ack({ ok: false, error: 'notAdmin' });
      const result = rooms.kick(code, playerId, accounts.isAdmin(me()), targetId);
      ack(result);
      if (!result.ok) return;
      clearTimeout(awayTimers.get(`${code}/${targetId}`));
      awayTimers.delete(`${code}/${targetId}`);
      for (const s of io.sockets.sockets.values()) {
        if (s.data.code !== code || s.data.playerId !== targetId) continue;
        s.emit('room:kicked');
        await s.leave(code);
        s.data = { ip: s.data.ip, accountId: s.data.accountId };
      }
      scheduleCleanup(code);
      await broadcast(code);
      scheduleBots(code);
    });
    on('room:pause', (payload, ack) => {
      const { code, playerId } = socket.data;
      if (!code) return ack({ ok: false, error: 'notInRoom' });
      const paused = payload.paused === true;
      const result = rooms.setPaused(code, playerId, accounts.isAdmin(me()), paused);
      ack(result);
      if (!result.ok) return;
      // Pendant la pause, aucun bot ne remplace un absent : à la reprise, chacun a de nouveau une minute pour revenir.
      if (!paused) rooms.get(code)!.seats.forEach((s) => !s.bot && !s.away && !s.connected && scheduleAway(code, s.playerId));
      scheduleCleanup(code);
      void broadcast(code);
      scheduleBots(code);
    });
    on('room:addBot', (payload, ack) => handle(ack, (code, playerId) => rooms.addBot(code, playerId, payload.level)));
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
    on('game:autoPass', (payload, ack) => handle(ack, (code, playerId) => rooms.setAutoPass(code, playerId, payload.enabled === true)));
    on('game:giveCard', (payload, ack) => act({ type: 'giveCard', cardId: text(payload.cardId) }, ack));
    on('game:spin', (_payload, ack) => act({ type: 'spin' }, ack));
    on('game:place', (payload, ack) =>
      act({ type: 'place', ships: Array.isArray(payload.ships) ? (payload.ships as { cells: number[] }[]) : [] }, ack),
    );
    on('game:shoot', (payload, ack) => act({ type: 'shoot', cell: Number(payload.cell) }, ack));
    on('game:nextRound', (_payload, ack) => act({ type: 'nextRound' }, ack));
    on('game:cut', (payload, ack) => act({ type: 'cut', position: Number(payload.position) }, ack));
    // Seules les parties entre humains sont enregistrées : les classements n'ont plus qu'elles.
    on('stats:get', (_payload, ack) => {
      const season = seasonOf(new Date());
      const statsOf = (game: GameId): GameStats => ({
        leaderboard: history.leaderboard(10, undefined, 'online', game),
        seasonal: history.leaderboard(10, season.id, 'online', game),
        recent: history.recent(5, game, 'online'),
        streak: history.bestStreak('online', game),
      });
      ack({ ok: true, season, games: { gof: statsOf('gof'), slots: statsOf('slots'), battleship: statsOf('battleship') } });
    });
    on('stats:player', (payload, ack) => ack({ ok: true, profile: history.profile(text(payload.name)) }));

    /** Pseudo actuel d'un compte, pour le mur de la communauté. */
    const nameOf = (id: string) => accounts.get(id)?.name ?? 'Ancien joueur';
    /** Après chaque changement du mur, chacun recharge l'écran s'il l'a ouvert. */
    const changed = <T extends { ok: boolean }>(ack: AnyAck, result: T) => {
      ack(result);
      if (result.ok) io.emit('community:changed');
    };
    on('community:list', (_payload, ack) => ack({ ok: true, ideas: community.view(me()?.id, nameOf) }));
    on('community:post', (payload, ack) => {
      const seated = player();
      if (!seated.ok) return ack(seated);
      if (!ideasPerAccount.allow(seated.account.id)) return ack({ ok: false, error: 'slowDown' });
      const result = community.post(seated.account.id, payload.kind, payload.title, payload.text);
      changed(ack, result.ok ? { ok: true, id: result.idea.id } : result);
    });
    on('community:vote', (payload, ack) => {
      const seated = player();
      if (!seated.ok) return ack(seated);
      changed(ack, community.vote(seated.account.id, payload.id, payload.on === true));
    });
    on('community:comment', (payload, ack) => {
      const seated = player();
      if (!seated.ok) return ack(seated);
      if (!commentsPerAccount.allow(seated.account.id)) return ack({ ok: false, error: 'slowDown' });
      changed(ack, community.comment(seated.account.id, payload.id, payload.text));
    });
    on('community:status', (payload, ack) => {
      if (!accounts.isAdmin(me())) return ack({ ok: false, error: 'notAdmin' });
      changed(ack, community.setStatus(payload.id, payload.status));
    });
    on('community:remove', (payload, ack) => {
      const seated = player();
      if (!seated.ok) return ack(seated);
      changed(ack, community.remove(seated.account.id, accounts.isAdmin(seated.account), payload.id, payload.commentId));
    });

    socket.on('disconnect', () => {
      const { code, playerId, spectator } = socket.data;
      if (code && spectator) return void broadcast(code);
      if (!code || !playerId) return;
      rooms.setConnected(code, playerId, false);
      if (rooms.get(code)?.game) scheduleAway(code, playerId);
      scheduleCleanup(code);
      void broadcast(code);
    });
  });

  // Les salons rechargés après un redémarrage sont supprimés si personne ne revient.
  // Les bots d'une partie rechargée reprennent la main s'ils devaient jouer.
  rooms.all().forEach((room) => {
    scheduleCleanup(room.code);
    scheduleBots(room.code);
    if (room.game) room.seats.forEach((s) => !s.bot && !s.away && scheduleAway(room.code, s.playerId));
  });

  io.engine.on('close', () => {
    cleanupTimers.forEach(clearTimeout);
    botTimers.forEach(clearTimeout);
    awayTimers.forEach(clearTimeout);
    turnTimers.forEach((t) => clearTimeout(t.timer));
  });
  return {
    http,
    io,
    rooms,
    history,
    accounts,
    errors,
    saveRooms: () => saved.saveNow(),
  };
}
