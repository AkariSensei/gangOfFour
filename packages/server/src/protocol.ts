import type { ActionError, PlayerView } from '@gof/engine';
import type { GameRecord, LeaderboardEntry } from './history';

export type { GameRecord, LeaderboardEntry };

/** Ce que chacun voit du salon, avant et pendant la partie. */
export interface RoomView {
  code: string;
  hostId: string;
  players: { id: string; name: string; connected: boolean; bot: boolean }[];
  started: boolean;
}

export type RoomError =
  | 'roomNotFound'
  | 'roomFull'
  | 'gameAlreadyStarted'
  | 'invalidName'
  | 'notInRoom'
  | 'notHost'
  | 'notEnoughPlayers'
  | 'gameNotStarted'
  | 'serverError';

export type Ack<T = object> = (result: ({ ok: true } & T) | { ok: false; error: RoomError | ActionError }) => void;

export interface Session {
  code: string;
  playerId: string;
  /** Jeton secret à garder côté client pour se reconnecter au même siège. */
  token: string;
}

export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, ack: Ack<Session>) => void;
  'room:join': (payload: { code: string; name: string }, ack: Ack<Session>) => void;
  'room:rejoin': (payload: { code: string; token: string }, ack: Ack<Session>) => void;
  'room:leave': (ack: Ack) => void;
  'room:addBot': (ack: Ack) => void;
  'room:removeBot': (payload: { botId: string }, ack: Ack) => void;
  'game:start': (payload: { targetScore?: number }, ack: Ack) => void;
  'game:play': (payload: { cardIds: string[] }, ack: Ack) => void;
  'game:pass': (ack: Ack) => void;
  'game:giveCard': (payload: { cardId: string }, ack: Ack) => void;
  'game:nextRound': (ack: Ack) => void;
  'game:cut': (payload: { position: number }, ack: Ack) => void;
  'stats:get': (ack: Ack<{ leaderboard: LeaderboardEntry[]; recent: GameRecord[] }>) => void;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'game:state': (game: PlayerView) => void;
}
