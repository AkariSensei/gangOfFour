import type { ActionError, Card, CombinationType } from '@gof/engine';
import type { BotLevel, RoomError } from '../../server/src/protocol';

/** Niveaux de bot, affichés dans le salon et sur la table. */
export const LEVEL_LABELS: Record<BotLevel, string> = { easy: 'Facile', normal: 'Moyen', hard: 'Difficile' };

export const COMBINATION_LABELS: Record<CombinationType, string> = {
  single: 'Carte seule',
  pair: 'Paire',
  trio: 'Brelan',
  straight: 'Suite',
  flush: 'Couleur',
  fullHouse: 'Full',
  straightFlush: 'Quinte flush',
  gang: 'Gang',
};

export function combinationLabel(type: CombinationType, size: number): string {
  if (type !== 'gang') return COMBINATION_LABELS[type];
  return ['Gang of Four', 'Gang of Five', 'Gang of Six', 'Gang of Seven'][size - 4] ?? 'Gang';
}

export const ERROR_LABELS: Record<RoomError | ActionError | 'disconnected', string> = {
  roomNotFound: 'Salon introuvable. Vérifie le code.',
  roomFull: 'Ce salon est complet (4 joueurs).',
  seatTaken: 'Ta place est déjà ouverte dans un autre onglet.',
  alreadySeated: 'Tu as déjà une place dans ce salon.',
  notSignedIn: 'Connecte-toi pour jouer.',
  noName: 'Choisis ton pseudo.',
  nameTaken: 'Ce pseudo est déjà pris.',
  blocked: 'Ce compte est bloqué.',
  signInFailed: 'La connexion Google a échoué, réessaie.',
  notAdmin: 'Réservé à l’admin.',
  accountNotFound: 'Compte introuvable.',
  tooManyRooms: 'Trop de salons sont ouverts en ce moment. Rejoins-en un ou réessaie plus tard.',
  slowDown: 'Trop de demandes d’un coup. Réessaie dans un moment.',
  gameAlreadyStarted: 'La partie a déjà commencé dans ce salon.',
  invalidName: 'Choisis un pseudo.',
  notInRoom: "Tu n'es pas dans un salon.",
  notHost: "Seul l'hôte peut faire ça.",
  notEnoughPlayers: 'Il faut au moins 3 joueurs.',
  gameNotStarted: "La partie n'a pas commencé.",
  wrongPhase: "Ce n'est pas le moment.",
  notYourTurn: "Ce n'est pas ton tour.",
  unknownCard: "Tu n'as pas cette carte.",
  invalidCombination: "Ces cartes ne forment pas une combinaison valide.",
  tooWeak: 'Il faut une combinaison plus forte, avec le même nombre de cartes (ou un Gang).',
  cannotPassWhenLeading: "Tu ouvres le pli : tu dois jouer.",
  mustPlayMultiOne: 'Le premier coup doit contenir le 1 multicolore.',
  mustPlayHighestSingle: 'Le joueur suivant n\'a plus qu\'une carte : joue ta carte la plus forte.',
  mustLeadCombination: 'Le joueur suivant n\'a plus qu\'une carte : ouvre avec une combinaison.',
  invalidCut: 'Coupe le paquet entre deux cartes.',
  serverError: 'Le serveur a eu un problème, réessaie.',
  emptyMessage: 'Message vide.',
  muted: 'Ton chat a été coupé dans ce salon.',
  kicked: 'Tu as été exclu de ce salon.',
  paused: 'La partie est en pause.',
  disconnected: 'Connexion au serveur perdue, reconnexion…',
};

export function errorLabel(error: string): string {
  return ERROR_LABELS[error as keyof typeof ERROR_LABELS] ?? error;
}

const COLOR_NAMES: Record<Card['color'], string> = { green: 'vert', yellow: 'jaune', red: 'rouge', multi: 'multicolore' };

export function cardLabel(card: Card): string {
  if (card.value === 12) return 'Dragon rouge';
  if (card.value === 11) return `Phénix ${COLOR_NAMES[card.color]}`;
  return `${card.value} ${COLOR_NAMES[card.color]}`;
}
