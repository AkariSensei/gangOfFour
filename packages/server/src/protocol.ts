import type { ActionError, Card, PlayerView, PlayingCard, PresidentError, PresidentView } from '@gof/engine';
import type { GameId } from './rules';
import type { OpenRoom } from './rooms';
export type { OpenRoom };
import type { BotLevel } from './bot';
import type { Progress } from './progression';
import type { Season } from './seasons';
import type { GameRecord, LeaderboardEntry, PlayerProfile, WinStreak } from './history';

export type { GameRecord, LeaderboardEntry, PlayerProfile, WinStreak };
export type { BotLevel } from './bot';
export type { Season } from './seasons';
export type { GameInfo } from './games';
export { GAMES } from './games';
export type { Progress, Reward, Unlocks } from './progression';
export { FELTS, FRAMES, LEVEL_TITLES, MAX_LEVEL } from './progression';

/** Réactions qu'un joueur peut envoyer à la table pendant la partie (le serveur refuse tout le reste). */
export const REACTIONS = ['👍', '😂', '😱', '😡', '👏', '🔥'];

/** Avatars et couleurs qu'un joueur peut choisir dans son profil (le serveur refuse tout le reste). */
export const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐙', '🦄', '🐧', '🐝', '🦉', '🐢', '🐳', '🌵', '🍕', '🎩', '👾'];
export const COLORS = ['#e8b931', '#d1453b', '#4fb477', '#3b82c4', '#9b59b6', '#e67e22', '#1abc9c', '#ec6fa6'];

/** Apparence choisie par le joueur ; sans choix, on affiche ses initiales sur le fond doré habituel. */
export interface Look {
  avatar?: string;
  color?: string;
}

/** Récompenses que le joueur a choisi de montrer à la table : un cadre autour de son avatar, et un titre. */
export interface Cosmetics {
  frame?: string;
  title?: string;
}

/** Ce que chacun voit du salon, avant et pendant la partie. */
export interface RoomView {
  code: string;
  hostId: string;
  /** Jeu du salon. */
  game: GameId;
  /** Entraînement contre les bots : hors classement, ne rapporte rien. */
  training: boolean;
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
  } & Look &
    Cosmetics)[];
  started: boolean;
  /** Temps par tour choisi par l'hôte, en secondes (0 : pas de minuteur). */
  turnSeconds: number;
  /** Temps qu'il reste au joueur qui doit agir, au moment de l'envoi ; null sans minuteur en cours. */
  turnRemainingMs: number | null;
  /** Nombre de personnes qui regardent la partie sans jouer. */
  spectators: number;
  /** L'hôte a mis la partie en pause : personne ne joue, le minuteur est gelé. */
  paused: boolean;
  /**
   * Tutoriel : quand c'est au joueur, l'explication (`coach`) et les cartes à poser (`expect`, vide pour passer) ;
   * pendant le tour des bots, les deux sont null. `step` sur `total` : où il en est.
   */
  tutorial?: { coach: string | null; expect: string[] | null; step: number; total: number };
}

/** Série de jours joués d'un joueur. */
export interface DailyView {
  day: string;
  /** Jours de jeu d'affilée (le week-end ne casse pas la série) ; `playedToday` : la série a déjà avancé aujourd'hui. */
  streak: number;
  playedToday: boolean;
}

/** Une idée (ou un bug) du mur de la communauté, vue par un joueur. */
export interface IdeaView {
  id: string;
  kind: 'idea' | 'bug';
  title: string;
  text: string;
  /** Pseudo de l'auteur ; `mine` : c'est le joueur qui regarde. */
  author: string;
  mine: boolean;
  createdAt: string;
  status: 'new' | 'planned' | 'done' | 'declined';
  votes: number;
  voted: boolean;
  comments: { id: string; author: string; text: string; at: string }[];
}

/** Partie telle qu'envoyée à un joueur ; un spectateur reçoit en plus la main de chacun (`hands`), qu'il affiche au choix. */
export type GofView = PlayerView & { hands?: Card[][] };
export type PresidentGameView = PresidentView & { hands?: PlayingCard[][] };
export type GameView = GofView | PresidentGameView;
export type { GameId };

/** La vue est-elle celle d'une partie de Président ? */
export const isPresidentView = (view: GameView): view is PresidentGameView => 'game' in view && view.game === 'president';

/**
 * Classements d'un jeu, de la saison en cours (`seasonal`) et de toujours (`leaderboard`) : seulement les parties entre
 * humains (au moins deux personnes, aucun bot), les seules qui comptent.
 */
export interface GameStats {
  leaderboard: LeaderboardEntry[];
  seasonal: LeaderboardEntry[];
  recent: GameRecord[];
  streak: WinStreak | null;
}

/** Partie en cours, proposée sur l'accueil à ceux qui veulent la regarder. */
export interface LiveRoom {
  code: string;
  game: GameId;
  players: { name: string; score: number; bot: boolean }[];
  round: number;
  spectators: number;
  /** Un joueur a été exclu : un bot tient sa place, que le premier humain qui rejoint peut prendre. */
  open: boolean;
}

export type RoomError =
  | 'roomNotFound'
  | 'roomFull'
  | 'trainingOnly'
  | 'trainingRoom'
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
  | 'tutorialMove'
  | 'locked'
  | 'invalidInvite'
  | 'invalidLogin'
  | 'loginTaken'
  | 'weakPassword'
  | 'wrongPassword'
  | 'ideaNotFound'
  | 'invalidStatus';

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
  /** Récompenses choisies : le tapis (vu par lui seul), le cadre et le titre (vus de tous). */
  felt?: string;
  frame?: string;
  title?: string;
}

/** Lien d'invitation, vu par l'admin ; `account` : le compte qui choisira un nouveau mot de passe avec. */
export interface InviteView {
  code: string;
  createdAt: string;
  expiresAt: string;
  account?: string;
}

/** Ligne de la liste des comptes, vue par l'admin. */
export interface AdminAccount extends Look {
  id: string;
  /** Adresse Google, ou vide pour un compte invité (qui a alors un identifiant). */
  email: string;
  login?: string;
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
  /** Connexion d'un compte invité, avec son identifiant et son mot de passe. */
  'account:login': (payload: { login: string; password: string }, ack: Ack<{ account: AccountView; session: string }>) => void;
  /** Lien d'invitation ouvert : valable ou non, et pour un nouveau mot de passe, l'identifiant du compte visé. */
  'account:invite': (payload: { code: string }, ack: Ack<{ invite: { reset: boolean; login?: string } }>) => void;
  /** Utilise un lien d'invitation : crée le compte (ou change son mot de passe) et connecte aussitôt. */
  'account:register': (payload: { code: string; login: string; password: string }, ack: Ack<{ account: AccountView; session: string }>) => void;
  'account:update': (payload: { name: string } & Look, ack: Ack<{ account: AccountView }>) => void;
  'account:signOut': (ack: Ack) => void;
  /** Choisit son tapis, son cadre et son titre parmi ce qu'il a débloqué (vide : celui par défaut). */
  'account:cosmetics': (payload: { felt: string; frame: string; title: string }, ack: Ack<{ account: AccountView }>) => void;
  'admin:accounts': (ack: Ack<{ accounts: AdminAccount[] }>) => void;
  'admin:update': (payload: { id: string; name?: string; blocked?: boolean }, ack: Ack) => void;
  /** Liens d'invitation encore valables. */
  'admin:invites': (ack: Ack<{ invites: InviteView[] }>) => void;
  /** Crée un lien d'invitation (une semaine, une fois) ; avec `accountId`, un lien de nouveau mot de passe pour ce compte invité. */
  'admin:invite': (payload: { accountId?: string }, ack: Ack<{ invite: InviteView }>) => void;
  'admin:revokeInvite': (payload: { code: string }, ack: Ack) => void;
  /** L'admin retire un compte du classement (ses parties jouées jusqu'ici ne comptent plus). */
  'admin:unrank': (payload: { id: string }, ack: Ack) => void;
  /** L'admin remet le classement à zéro : les parties jouées jusqu'ici sont archivées. */
  'admin:resetRanking': (ack: Ack) => void;
  /**
   * Crée un salon pour ce jeu (Gang of Four sans jeu précisé). `training` : entraînement contre les bots, que personne
   * ne peut rejoindre et qui ne compte nulle part ; c'est le seul salon où l'on peut ajouter des bots.
   */
  'room:create': (payload: { game?: GameId; training?: boolean }, ack: Ack<Session>) => void;
  /** Salons de ce jeu qui attendent des joueurs, pour les rejoindre depuis la page du jeu. */
  'rooms:open': (payload: { game: GameId }, ack: Ack<{ rooms: OpenRoom[] }>) => void;
  'room:join': (payload: { code: string }, ack: Ack<Session>) => void;
  'room:rejoin': (payload: { code: string; token: string; onlyIfFree?: boolean }, ack: Ack<Session>) => void;
  'room:leave': (ack: Ack) => void;
  'room:watch': (payload: { code: string }, ack: Ack<Session>) => void;
  'rooms:live': (ack: Ack<{ rooms: LiveRoom[] }>) => void;
  'chat:send': (payload: { text: string }, ack: Ack) => void;
  /** Envoie une réaction (une de `REACTIONS`), affichée un instant au-dessus de sa place pour toute la table. */
  'room:react': (payload: { emoji: string }, ack: Ack) => void;
  'room:addBot': (payload: { level?: BotLevel }, ack: Ack) => void;
  'room:removeBot': (payload: { botId: string }, ack: Ack) => void;
  /** L'hôte ou l'admin coupe (ou rend) le chat d'un joueur du salon. */
  'room:mute': (payload: { playerId: string; muted: boolean }, ack: Ack) => void;
  /** L'hôte ou l'admin exclut un joueur du salon. */
  'room:kick': (payload: { playerId: string }, ack: Ack) => void;
  /** L'hôte ou l'admin met la partie en pause (pour une réunion, un café) ou la relance. */
  'room:pause': (payload: { paused: boolean }, ack: Ack) => void;
  /** `targetScore` : Gang of Four ; `rounds` : nombre de manches du Président. */
  'game:start': (payload: { targetScore?: number; rounds?: number; turnSeconds?: number }, ack: Ack) => void;
  'game:rematch': (ack: Ack) => void;
  'game:play': (payload: { cardIds: string[] }, ack: Ack) => void;
  'game:pass': (ack: Ack) => void;
  'game:autoPass': (payload: { enabled: boolean }, ack: Ack) => void;
  'game:giveCard': (payload: { cardId: string }, ack: Ack) => void;
  /** Président : les cartes rendues pendant l'échange (2 pour le Président, 1 pour le Vice-président). */
  'game:giveCards': (payload: { cardIds: string[] }, ack: Ack) => void;
  'game:nextRound': (ack: Ack) => void;
  'game:cut': (payload: { position: number }, ack: Ack) => void;
  /** La saison en cours, et les classements de chaque jeu jouable. */
  'stats:get': (ack: Ack<{ season: Season; games: Record<GameId, GameStats> }>) => void;
  'stats:player': (payload: { name: string }, ack: Ack<{ profile: PlayerProfile | null }>) => void;
  /** Série de jours joués du joueur connecté. */
  'daily:get': (ack: Ack<{ daily: DailyView }>) => void;
  /** Le mur de la communauté (sans compte : en lecture seule). */
  'community:list': (ack: Ack<{ ideas: IdeaView[] }>) => void;
  /** Poste une idée ou un bug ; son auteur vote d'office pour. */
  'community:post': (payload: { kind: 'idea' | 'bug'; title: string; text: string }, ack: Ack<{ id: string }>) => void;
  'community:vote': (payload: { id: string; on: boolean }, ack: Ack) => void;
  'community:comment': (payload: { id: string; text: string }, ack: Ack) => void;
  /** L'admin indique où en est une demande. */
  'community:status': (payload: { id: string; status: 'new' | 'planned' | 'done' | 'declined' }, ack: Ack) => void;
  /** Retire une idée, ou un de ses commentaires (`commentId`) : son auteur ou l'admin. */
  'community:remove': (payload: { id: string; commentId?: string }, ack: Ack) => void;
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
  /** Un joueur de la table vient de réagir. Rien n'est gardé : la réaction s'efface d'elle-même. */
  'room:reaction': (reaction: { id: string; playerId: string; emoji: string }) => void;
  /** Ce joueur vient d'être exclu du salon par l'hôte ou l'admin. */
  'room:kicked': () => void;
  /** Le classement a changé (partie finie, remise à zéro…) : l'accueil le recharge. */
  'stats:changed': () => void;
  /** Le mur de la communauté a changé : l'écran ouvert le recharge. */
  'community:changed': () => void;
  /** Expérience gagnée avec la partie qui se termine : niveau avant et après, et récompenses débloquées en route. */
  'progress:gained': (gain: { gained: number; before: Progress; after: Progress; rewards: string[] }) => void;
}
