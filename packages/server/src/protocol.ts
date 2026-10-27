import type { ActionError, PlayerView } from '@gof/engine';
import type { GameRecord, LeaderboardEntry, PlayerProfile } from './history';

export type { GameRecord, LeaderboardEntry, PlayerProfile };

/** Avatars et couleurs qu'un joueur peut choisir dans son profil (le serveur refuse tout le reste). */
export const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐙', '🦄', '🐧', '🐝', '🦉', '🐢', '🐳', '🌵', '🍕', '🎩', '👾'];
export const COLORS = ['#e8b931', '#d1453b', '#4fb477', '#3b82c4', '#9b59b6', '#e67e22', '#1abc9c', '#ec6fa6'];

/** Apparence choisie par le joueur ; sans choix, on affiche ses initiales sur le fond doré habituel. */
export interface Look {
  avatar?: string;
  color?: string;
}

/** Ce que chacun voit du salon, avant et pendant la partie. */
export interface RoomView {
  code: string;
  hostId: string;
  players: ({ id: string; name: string; connected: boolean; bot: boolean; away: boolean } & Look)[];
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
  | 'emptyMessage'
  | 'tooManyRooms'
  | 'slowDown'
  | 'seatTaken'
  | 'alreadySeated'
  | 'notSignedIn'
  | 'noName'
  | 'nameTaken'
  | 'blocked'
  | 'signInFailed'
  | 'notAdmin'
  | 'accountNotFound';

export type Ack<T = object> = (result: ({ ok: true } & T) | { ok: false; error: RoomError | ActionError }) => void;

export interface Session {
  code: string;
  playerId: string;
  /** Jeton secret à garder côté client pour se reconnecter au même siège. */
  token: string;
  /** Spectateur : regarde la partie sans siège (playerId et token sont alors vides). */
  spectator?: boolean;
}

/** Compte du joueur connecté, tel que le voit son navigateur. */
export interface AccountView extends Look {
  id: string;
  email: string;
  /** Pseudo unique ; vide tant que le joueur ne l'a pas choisi. */
  name: string;
  admin: boolean;
}

/** Ligne de la liste des comptes, vue par l'admin. */
export interface AdminAccount extends Look {
  id: string;
  email: string;
  name: string;
  blocked: boolean;
  createdAt: string;
}

export interface ClientToServerEvents {
  /** Compte de cette connexion (null sans compte), et l'identifiant du client Google pour afficher le bouton. */
  'account:get': (ack: Ack<{ account: AccountView | null; googleClientId: string | null }>) => void;
  /** Connexion avec le jeton du bouton Google : renvoie la session à garder dans le navigateur. */
  'account:google': (payload: { credential: string }, ack: Ack<{ account: AccountView; session: string }>) => void;
  'account:update': (payload: { name: string } & Look, ack: Ack<{ account: AccountView }>) => void;
  'account:signOut': (ack: Ack) => void;
  'admin:accounts': (ack: Ack<{ accounts: AdminAccount[] }>) => void;
  'admin:update': (payload: { id: string; name?: string; blocked?: boolean }, ack: Ack) => void;
  'room:create': (ack: Ack<Session>) => void;
  'room:join': (payload: { code: string }, ack: Ack<Session>) => void;
  'room:rejoin': (payload: { code: string; token: string; onlyIfFree?: boolean }, ack: Ack<Session>) => void;
  'room:leave': (ack: Ack) => void;
  'room:watch': (payload: { code: string }, ack: Ack<Session>) => void;
  'rooms:live': (ack: Ack<{ rooms: LiveRoom[] }>) => void;
  'chat:send': (payload: { text: string }, ack: Ack) => void;
  'room:addBot': (ack: Ack) => void;
  'room:removeBot': (payload: { botId: string }, ack: Ack) => void;
  'game:start': (payload: { targetScore?: number; turnSeconds?: number }, ack: Ack) => void;
  'game:rematch': (ack: Ack) => void;
  'game:play': (payload: { cardIds: string[] }, ack: Ack) => void;
  'game:pass': (ack: Ack) => void;
  'game:giveCard': (payload: { cardId: string }, ack: Ack) => void;
  'game:nextRound': (ack: Ack) => void;
  'game:cut': (payload: { position: number }, ack: Ack) => void;
  'stats:get': (ack: Ack<{ leaderboard: LeaderboardEntry[]; monthly: LeaderboardEntry[]; recent: GameRecord[] }>) => void;
  'stats:player': (payload: { name: string }, ack: Ack<{ profile: PlayerProfile | null }>) => void;
}

/** Message du chat d'un salon : relayé aux joueurs présents, jamais enregistré. */
export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  at: number;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'game:state': (game: PlayerView) => void;
  'chat:message': (message: ChatMessage) => void;
}
