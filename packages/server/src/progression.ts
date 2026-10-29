import type { Badge } from './badges';
import type { BotLevel } from './bot';
import type { ChallengeStats } from './challenges';

/** Où en est un joueur : son expérience totale, son niveau, et son avancée vers le niveau suivant. */
export interface Progress {
  xp: number;
  level: number;
  /** Expérience gagnée depuis le début du niveau actuel, sur `levelSpan` pour passer au suivant. */
  levelXp: number;
  levelSpan: number;
  /** Titre attaché au niveau atteint (« Habitué du tripot »…). */
  title: string;
}

/** Ce que le joueur a débloqué : tapis, cadres d'avatar et titres qu'il peut choisir. */
export interface Unlocks {
  felts: string[];
  frames: string[];
  titles: string[];
}

/** Une récompense et le niveau qui la débloque. */
export interface Reward {
  id: string;
  name: string;
  level: number;
}

/*
 * Les récompenses s'étalent jusqu'au niveau 30, à peu près une par niveau : un cadre, un tapis ou un titre.
 * Passé le niveau 20, elles s'espacent, comme les niveaux eux-mêmes.
 */

/** Couleurs de tapis, chacune débloquée à un niveau (le vert pour tout le monde). */
export const FELTS: Reward[] = [
  { id: 'vert', name: 'Vert tripot', level: 1 },
  { id: 'bordeaux', name: 'Bordeaux', level: 3 },
  { id: 'nuit', name: 'Bleu nuit', level: 5 },
  { id: 'ardoise', name: 'Ardoise', level: 7 },
  { id: 'royal', name: 'Violet royal', level: 10 },
  { id: 'cuivre', name: 'Cuivre', level: 13 },
  { id: 'onyx', name: 'Onyx et or', level: 16 },
  { id: 'glace', name: 'Glacier', level: 20 },
  { id: 'rubis', name: 'Rubis', level: 25 },
  { id: 'legende', name: 'Légendaire', level: 30 },
];

/** Cadres autour de l'avatar, vus de toute la table (aucun au départ). */
export const FRAMES: Reward[] = [
  { id: 'bronze', name: 'Bronze', level: 2 },
  { id: 'cuivre', name: 'Cuivre', level: 4 },
  { id: 'argent', name: 'Argent', level: 6 },
  { id: 'jade', name: 'Jade', level: 9 },
  { id: 'or', name: 'Or', level: 12 },
  { id: 'saphir', name: 'Saphir', level: 15 },
  { id: 'rubis', name: 'Rubis', level: 18 },
  { id: 'diamant', name: 'Diamant', level: 22 },
  { id: 'legende', name: 'Légendaire', level: 28 },
];

/** Titres de niveau : le dernier atteint est celui du joueur, et chacun peut être choisi une fois débloqué. */
export const LEVEL_TITLES: { level: number; title: string }[] = [
  { level: 1, title: 'Débutant' },
  { level: 3, title: 'Apprenti' },
  { level: 5, title: 'Joueur du dimanche' },
  { level: 7, title: 'Amateur éclairé' },
  { level: 8, title: 'Habitué du tripot' },
  { level: 11, title: 'Fine gâchette' },
  { level: 13, title: 'Requin' },
  { level: 14, title: 'Stratège' },
  { level: 17, title: 'Caïd' },
  { level: 19, title: 'Parrain du tapis' },
  { level: 22, title: 'Maître du jeu' },
  { level: 25, title: 'Grand maître' },
  { level: 30, title: 'Légende du tapis' },
];

/** Ce que rapporte une partie, un défi ou un badge. */
const XP = {
  game: 40,
  win: 60,
  roundWon: 8,
  gang: 10,
  challenge: 30,
  challengeWin: 50,
  badge: 25,
};

/**
 * L'expérience ne compte qu'en ligne ou seul contre des bots tous difficiles : contre des bots faciles ou moyens
 * (ou d'avant les niveaux, « unknown »), une partie ne rapporte rien, pour qu'on ne monte pas de niveau à la chaîne.
 */
const BOT_FACTOR: Record<BotLevel | 'unknown', number> = { hard: 1, normal: 0, easy: 0, unknown: 0 };

/** Une partie vue par un joueur, réduite à ce qui compte pour l'expérience. */
export interface GameForXp {
  winner: boolean;
  roundsWon: number;
  gangs: number;
  /** Partie en ligne (null), ou seul contre des bots : niveau du plus fort, ou « unknown » s'il n'est pas connu. */
  vsBots: BotLevel | 'unknown' | null;
}

/** Expérience d'une partie. */
export function gameXp(g: GameForXp): number {
  const raw = XP.game + (g.winner ? XP.win : 0) + g.roundsWon * XP.roundWon + g.gangs * XP.gang;
  return Math.round(raw * (g.vsBots ? BOT_FACTOR[g.vsBots] : 1));
}

/** Expérience totale : les parties, les défis du jour terminés, et chaque badge obtenu. */
export function totalXp(games: GameForXp[], challenges: ChallengeStats, badges: Badge[]): number {
  const fromGames = games.reduce((sum, g) => sum + gameXp(g), 0);
  const fromChallenges = challenges.played * XP.challenge + challenges.wins * XP.challengeWin;
  const fromBadges = badges.filter((b) => b.value >= b.goal).length * XP.badge;
  return fromGames + fromChallenges + fromBadges;
}

/**
 * Expérience pour passer du niveau `level` au suivant : de plus en plus, comme dans un jeu (100, 280, 520, 800,
 * 1 120… puis environ 3 200 au niveau 10 et 9 000 au niveau 20), arrondie à la dizaine.
 */
export const levelSpan = (level: number) => Math.round((100 * level ** 1.5) / 10) * 10;

/** Expérience totale à atteindre pour être au niveau `level` (0 au niveau 1). */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += levelSpan(l);
  return total;
}

export function progressOf(xp: number): Progress {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level += 1;
  const start = xpForLevel(level);
  return {
    xp,
    level,
    levelXp: xp - start,
    levelSpan: xpForLevel(level + 1) - start,
    title: [...LEVEL_TITLES].reverse().find((t) => t.level <= level)!.title,
  };
}

/** Récompenses débloquées : tapis et cadres par le niveau, titres par le niveau et par chaque badge obtenu. */
export function unlocksOf(level: number, badges: Badge[]): Unlocks {
  return {
    felts: FELTS.filter((f) => f.level <= level).map((f) => f.id),
    frames: FRAMES.filter((f) => f.level <= level).map((f) => f.id),
    titles: [...LEVEL_TITLES.filter((t) => t.level <= level).map((t) => t.title), ...badges.filter((b) => b.value >= b.goal).map((b) => b.name)],
  };
}

/** Récompenses gagnées en passant du niveau `before` au niveau `after`, pour les annoncer. */
export function newRewards(before: number, after: number): string[] {
  const between = (level: number) => level > before && level <= after;
  return [
    ...FELTS.filter((f) => between(f.level)).map((f) => `Tapis ${f.name.toLowerCase()}`),
    ...FRAMES.filter((f) => between(f.level)).map((f) => `Cadre ${f.name.toLowerCase()}`),
    ...LEVEL_TITLES.filter((t) => between(t.level)).map((t) => `Titre « ${t.title} »`),
  ];
}
