import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { GameHistory } from './history';
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
}

export interface GameServerOptions {
  corsOrigin?: string | string[];
  abandonDelayMs?: number;
  /** Dossier de l'interface compilée à servir sur la même adresse que le jeu. */
  staticDir?: string;
  /** Fichier JSON de l'historique des parties ; sans fichier, l'historique reste en mémoire. */
  historyFile?: string;
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const http = createHttpServer(options.staticDir ? createStaticHandler(options.staticDir) : undefined);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(http, {
    cors: options.corsOrigin ? { origin: options.corsOrigin } : undefined,
  });
  const rooms = new RoomManager();
  const history = new GameHistory(options.historyFile);

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
      }, abandonDelay),
    );
  }

  io.on('connection', (socket) => {
    async function enter(result: Result<{ code: string; playerId: string; token: string }>, ack: (r: typeof result) => void) {
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
    function handle(ack: (r: Result) => void, run: (code: string, playerId: string) => Result) {
      const { code, playerId } = socket.data;
      if (typeof ack !== 'function') return;
      if (!code || !playerId) return ack({ ok: false, error: 'notInRoom' });
      const result = run(code, playerId);
      ack(result);
      if (result.ok) void broadcast(code);
    }

    const act = (action: PlayerAction) => (ack: (r: Result) => void) =>
      handle(ack, (code, playerId) => {
        const result = rooms.act(code, playerId, action);
        if (result.ok) recordIfFinished(code);
        return result;
      });

    socket.on('room:create', (payload, ack) => void enter(rooms.create(payload?.name), ack));
    socket.on('room:join', (payload, ack) => void enter(rooms.join(String(payload?.code ?? ''), payload?.name), ack));
    socket.on('room:rejoin', (payload, ack) =>
      void enter(rooms.rejoin(String(payload?.code ?? ''), String(payload?.token ?? '')), ack),
    );
    socket.on('room:leave', (ack) => {
      leaveCurrent();
      ack?.({ ok: true });
    });
    socket.on('game:start', (payload, ack) =>
      handle(ack, (code, playerId) => rooms.start(code, playerId, { targetScore: Number(payload?.targetScore) })),
    );
    socket.on('game:play', (payload, ack) =>
      act({ type: 'play', cardIds: Array.isArray(payload?.cardIds) ? payload.cardIds.map(String) : [] })(ack),
    );
    socket.on('game:pass', (ack) => act({ type: 'pass' })(ack));
    socket.on('game:giveCard', (payload, ack) => act({ type: 'giveCard', cardId: String(payload?.cardId ?? '') })(ack));
    socket.on('game:nextRound', (ack) => act({ type: 'nextRound' })(ack));
    socket.on('game:cut', (payload, ack) => act({ type: 'cut', position: Number(payload?.position) })(ack));
    socket.on('stats:get', (ack) => ack?.({ ok: true, leaderboard: history.leaderboard(), recent: history.recent() }));

    socket.on('disconnect', () => {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return;
      rooms.setConnected(code, playerId, false);
      scheduleCleanup(code);
      void broadcast(code);
    });
  });

  io.engine.on('close', () => cleanupTimers.forEach(clearTimeout));
  return { http, io, rooms, history };
}
