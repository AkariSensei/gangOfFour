import type { ActionError, Card, PlayerView } from '@gof/engine';
import type { Badge } from './badges';
import type { BotLevel } from './bot';
import type { ChallengeOverallEntry, ChallengeRankEntry } from './challenges';
import type { GameRecord, LeaderboardEntry, PlayerProfile, WinStreak } from './history';

export type { GameRecord, LeaderboardEntry, PlayerProfile, WinStreak };
export type { Badge } from './badges';
export type { BotLevel } from './bot';
export type { ChallengeOverallEntry, ChallengeRankEntry } from './challenges';

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
  players: ({
    id: string;
    name: string;
    connected: boolean;
    bot: boolean;
    /** Niveau d'un bot ajouté par l'hôte. */
    level?: BotLevel;
    away: boolean;
    muted: boolean;
    vacant: boolean;
    /** Le joueur passe tout seul quand aucune de ses cartes ne peut battre la table (son choix, coupé par défaut). */
    autoPass: boolean;
  } & Look)[];
  started: boolean;
  /** Temps par tour choisi par l'hôte, en secondes (0 : pas de minuteur). */
  turnSeconds: number;
  /** Temps qu'il reste au joueur qui doit agir, au moment de l'envoi ; null sans minuteur en cours. */
  turnRemainingMs: number | null;
  /** Nombre de personnes qui regardent la partie sans jouer. */
  spectators: number;
  /** L'hôte a mis la partie en pause : personne ne joue, le minuteur est gelé. */
  paused: boolean;
  /** Défi du jour (une seule manche contre trois bots difficiles) : son jour et les coups joués jusqu'ici. */
  challenge?: { day: string; moves: number };
  /**
   * Tutoriel : quand c'est au joueur, l'explication (`coach`) et les cartes à poser (`expect`, vide pour passer) ;
   * pendant le tour des bots, les deux sont null. `step` sur `total` : où il en est.
   */
  tutorial?: { coach: string | null; expect: string[] | null; step: number; total: number };
}

/** Le défi du jour vu par un joueur : son essai, et les classements. */
export interface ChallengeView {
  day: string;
  /** Son essai du jour : absent s'il n'a pas encore joué, sans résultat tant que la manche est en cours. */
  mine: { finished: boolean; won?: boolean; moves?: number; cardsLeft?: number; rank?: number } | null;
  today: ChallengeRankEntry[];
  overall: ChallengeOverallEntry[];
}

/** Partie telle qu'envoyée à un joueur ; un spectateur reçoit en plus la main de chacun (`hands`), qu'il affiche au choix. */
export type GameView = PlayerView & { hands?: Card[][] };

/** Partie en cours, proposée sur l'accueil à ceux qui veulent la regarder. */
export interface LiveRoom {
  code: string;
  players: { name: string; score: number; bot: boolean }[];
  round: number;
  spectators: number;
  /** Un joueur a été exclu : un bot tient sa place, que le premier humain qui rejoint peut prendre. */
  open: boolean;
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
  | 'accountNotFound'
  | 'muted'
  | 'kicked'
  | 'paused'
  | 'challengeAlreadyPlayed'
  | 'tutorialMove';

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
  /** Badges choisis pour sa fiche. */
  showcase: string[];
}

/** Ligne de la liste des comptes, vue par l'admin. */
export interface AdminAccount extends Look {
  id: string;
  email: string;
  name: string;
  blocked: boolean;
  createdAt: string;
  /** A des parties qui comptent au classement. */
  ranked: boolean;
}

export interface ClientToServerEvents {
  /** Compte de cette connexion (null sans compte), et l'identifiant du client Google pour afficher le bouton. */
  'account:get': (ack: Ack<{ account: AccountView | null; googleClientId: string | null }>) => void;
  /** Connexion avec le jeton du bouton Google : renvoie la session à garder dans le navigateur. */
  'account:google': (payload: { credential: string }, ack: Ack<{ account: AccountView; session: string }>) => void;
  'account:update': (payload: { name: string } & Look, ack: Ack<{ account: AccountView }>) => void;
  'account:signOut': (ack: Ack) => void;
  /** Choisit les badges (trois au plus) montrés sur sa fiche ; une liste vide revient aux plus rares. */
  'account:showcase': (payload: { badgeIds: string[] }, ack: Ack<{ account: AccountView }>) => void;
  'admin:accounts': (ack: Ack<{ accounts: AdminAccount[] }>) => void;
  'admin:update': (payload: { id: string; name?: string; blocked?: boolean }, ack: Ack) => void;
  /** L'admin retire un compte du classement (ses parties jouées jusqu'ici ne comptent plus). */
  'admin:unrank': (payload: { id: string }, ack: Ack) => void;
  /** L'admin remet le classement à zéro : les parties jouées jusqu'ici sont archivées. */
  'admin:resetRanking': (ack: Ack) => void;
  'room:create': (ack: Ack<Session>) => void;
  'room:join': (payload: { code: string }, ack: Ack<Session>) => void;
  'room:rejoin': (payload: { code: string; token: string; onlyIfFree?: boolean }, ack: Ack<Session>) => void;
  'room:leave': (ack: Ack) => void;
  'room:watch': (payload: { code: string }, ack: Ack<Session>) => void;
  'rooms:live': (ack: Ack<{ rooms: LiveRoom[] }>) => void;
  'chat:send': (payload: { text: string }, ack: Ack) => void;
  'room:addBot': (payload: { level?: BotLevel }, ack: Ack) => void;
  'room:removeBot': (payload: { botId: string }, ack: Ack) => void;
  /** L'hôte ou l'admin coupe (ou rend) le chat d'un joueur du salon. */
  'room:mute': (payload: { playerId: string; muted: boolean }, ack: Ack) => void;
  /** L'hôte ou l'admin exclut un joueur du salon. */
  'room:kick': (payload: { playerId: string }, ack: Ack) => void;
  /** L'hôte ou l'admin met la partie en pause (pour une réunion, un café) ou la relance. */
  'room:pause': (payload: { paused: boolean }, ack: Ack) => void;
  'game:start': (payload: { targetScore?: number; turnSeconds?: number }, ack: Ack) => void;
  'game:rematch': (ack: Ack) => void;
  'game:play': (payload: { cardIds: string[] }, ack: Ack) => void;
  'game:pass': (ack: Ack) => void;
  'game:autoPass': (payload: { enabled: boolean }, ack: Ack) => void;
  'game:giveCard': (payload: { cardId: string }, ack: Ack) => void;
  'game:nextRound': (ack: Ack) => void;
  'game:cut': (payload: { position: number }, ack: Ack) => void;
  /** `leaderboard` et `monthly` : parties en ligne ; `botLeaderboard` et `botMonthly` : parties seul contre des bots. */
  'stats:get': (
    ack: Ack<{
      leaderboard: LeaderboardEntry[];
      monthly: LeaderboardEntry[];
      botLeaderboard: LeaderboardEntry[];
      botMonthly: LeaderboardEntry[];
      recent: GameRecord[];
      streak: WinStreak | null;
    }>,
  ) => void;
  'stats:player': (payload: { name: string }, ack: Ack<{ profile: PlayerProfile | null }>) => void;
  /** Défi du jour : son essai et les classements (sans compte, `mine` est null). */
  'challenge:get': (ack: Ack<{ challenge: ChallengeView }>) => void;
  /** Relève le défi du jour : une seule fois par jour, la manche démarre aussitôt. */
  'challenge:start': (ack: Ack<Session>) => void;
  /** Lance le tutoriel : une manche guidée contre trois bots, qui démarre aussitôt. */
  'tutorial:start': (ack: Ack<Session>) => void;
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
  'game:state': (game: GameView) => void;
  'chat:message': (message: ChatMessage) => void;
  /** Ce joueur vient d'être exclu du salon par l'hôte ou l'admin. */
  'room:kicked': () => void;
  /** Le classement a changé (partie finie, remise à zéro…) : l'accueil le recharge. */
  'stats:changed': () => void;
  /** Badges que ce joueur vient d'obtenir avec la partie qui se termine. */
  'badges:won': (badges: Badge[]) => void;
}
