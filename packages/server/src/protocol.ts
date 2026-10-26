import type { ActionError, PlayerView } from '@gof/engine';
import type { GameRecord, LeaderboardEntry, PlayerProfile } from './history';

export type { GameRecord, LeaderboardEntry, PlayerProfile };

/** Ce que chacun voit du salon, avant et pendant la partie. */
export interface RoomView {
  code: string;
  hostId: string;
  players: { id: string; name: string; connected: boolean; bot: boolean }[];
  started: boolean;
  /** Temps par tour choisi par l'hôte, en secondes (0 : pas de minuteur). */
  turnSeconds: number;
  /** Temps qu'il reste au joueur qui doit agir, au moment de l'envoi ; null sans minuteur en cours. */
  turnRemainingMs: number | null;
  /** Nombre de personnes qui regardent la partie sans jouer. */
  spectators: number;
}

/** Partie en cours, proposée sur l'accueil à ceux qui veulent la regarder. */
export interface LiveRoom {
  code: string;
  players: { name: string; score: number; bot: boolean }[];
  round: number;
  spectators: number;
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
  | 'serverError'
  | 'tooManyRooms'
  | 'slowDown';

export type Ack<T = object> = (result: ({ ok: true } & T) | { ok: false; error: RoomError | ActionError }) => void;

export interface Session {
  code: string;
  playerId: string;
  /** Jeton secret à garder côté client pour se reconnecter au même siège. */
  token: string;
  /** Spectateur : regarde la partie sans siège (playerId et token sont alors vides). */
  spectator?: boolean;
}

export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, ack: Ack<Session>) => void;
  'room:join': (payload: { code: string; name: string }, ack: Ack<Session>) => void;
  'room:rejoin': (payload: { code: string; token: string }, ack: Ack<Session>) => void;
  'room:leave': (ack: Ack) => void;
  'room:watch': (payload: { code: string }, ack: Ack<Session>) => void;
  'rooms:live': (ack: Ack<{ rooms: LiveRoom[] }>) => void;
  'room:addBot': (ack: Ack) => void;
  'room:removeBot': (payload: { botId: string }, ack: Ack) => void;
  'game:start': (payload: { targetScore?: number; turnSeconds?: number }, ack: Ack) => void;
  'game:play': (payload: { cardIds: string[] }, ack: Ack) => void;
  'game:pass': (ack: Ack) => void;
  'game:giveCard': (payload: { cardId: string }, ack: Ack) => void;
  'game:nextRound': (ack: Ack) => void;
  'game:cut': (payload: { position: number }, ack: Ack) => void;
  'stats:get': (ack: Ack<{ leaderboard: LeaderboardEntry[]; recent: GameRecord[] }>) => void;
  'stats:player': (payload: { name: string }, ack: Ack<{ profile: PlayerProfile | null }>) => void;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'game:state': (game: PlayerView) => void;
}
