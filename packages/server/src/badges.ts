import type { GameRecord } from './history';

/** Un badge d'un joueur : `value` sur `goal`, obtenu dès que `value` atteint `goal`. */
export interface Badge {
  id: string;
  icon: string;
  name: string;
  description: string;
  value: number;
  goal: number;
}

/** Une partie vue par un joueur : la partie, et sa ligne à lui. */
type Game = { record: GameRecord; me: GameRecord['players'][number] };

/**
 * Badges à gagner, du plus simple au plus rare. Ils comptent toutes les parties (en ligne et contre les bots),
 * sauf ceux qui parlent explicitement de jouer avec d'autres personnes.
 */
const BADGES: { id: string; icon: string; name: string; description: string; goal: number; value: (games: Game[]) => number }[] = [
  // Parties jouées
  { id: 'games-25', icon: '🃏', name: 'Habitué', description: 'Joue 25 parties.', goal: 25, value: (g) => g.length },
  { id: 'games-100', icon: '🪑', name: 'Pilier', description: 'Joue 100 parties.', goal: 100, value: (g) => g.length },
  { id: 'games-250', icon: '🎖️', name: 'Vétéran', description: 'Joue 250 parties.', goal: 250, value: (g) => g.length },
  { id: 'games-500', icon: '🗿', name: 'Légende du bureau', description: 'Joue 500 parties.', goal: 500, value: (g) => g.length },
  {
    id: 'online-25',
    icon: '👥',
    name: 'Bon collègue',
    description: 'Joue 25 parties en ligne, avec au moins une autre personne.',
    goal: 25,
    value: (g) => g.filter((x) => humans(x) >= 2).length,
  },
  // Victoires
  { id: 'first-win', icon: '🏆', name: 'Premier sang', description: 'Gagne une partie.', goal: 1, value: (g) => wins(g) },
  { id: 'wins-25', icon: '🎩', name: 'Chef de gang', description: 'Gagne 25 parties.', goal: 25, value: (g) => wins(g) },
  { id: 'wins-75', icon: '👑', name: 'Parrain', description: 'Gagne 75 parties.', goal: 75, value: (g) => wins(g) },
  { id: 'wins-150', icon: '🦁', name: 'Le Boss', description: 'Gagne 150 parties.', goal: 150, value: (g) => wins(g) },
  {
    id: 'full-table',
    icon: '🎯',
    name: 'Table complète',
    description: 'Gagne une partie face à trois autres personnes.',
    goal: 1,
    value: (g) => (g.some((x) => x.me.winner && humans(x) >= 4) ? 1 : 0),
  },
  // Séries
  { id: 'streak-4', icon: '🔥', name: 'En série', description: '4 victoires d’affilée.', goal: 4, value: (g) => streak(g) },
  { id: 'streak-7', icon: '⚡', name: 'Intouchable', description: '7 victoires d’affilée.', goal: 7, value: (g) => streak(g) },
  // Manches
  {
    id: 'steamroller',
    icon: '🚜',
    name: 'Rouleau compresseur',
    description: 'Gagne 100 manches, toutes parties confondues.',
    goal: 100,
    value: (g) => sum(g, (x) => x.me.roundsWon ?? 0),
  },
  {
    id: 'bulldozer',
    icon: '🏗️',
    name: 'Bulldozer',
    description: 'Gagne 500 manches, toutes parties confondues.',
    goal: 500,
    value: (g) => sum(g, (x) => x.me.roundsWon ?? 0),
  },
  { id: 'marathon', icon: '🏃', name: 'Marathon', description: 'Joue une partie de 20 manches.', goal: 20, value: (g) => max(g, (x) => x.record.rounds) },
  {
    id: 'blitz',
    icon: '⏱️',
    name: 'Éclair',
    description: 'Gagne une partie en 4 manches ou moins.',
    goal: 1,
    value: (g) => (g.some((x) => x.me.winner && x.record.rounds <= 4) ? 1 : 0),
  },
  // Gangs
  { id: 'gang-1', icon: '💥', name: 'Gang of Four', description: 'Pose un gang.', goal: 1, value: (g) => sum(g, (x) => x.me.gangs ?? 0) },
  { id: 'gang-25', icon: '🧨', name: 'Dynamiteur', description: 'Pose 25 gangs.', goal: 25, value: (g) => sum(g, (x) => x.me.gangs ?? 0) },
  {
    id: 'fireworks',
    icon: '🎆',
    name: 'Feu d’artifice',
    description: 'Pose 3 gangs dans une même partie.',
    goal: 3,
    value: (g) => max(g, (x) => x.me.gangs ?? 0),
  },
  // Scores
  {
    id: 'clean-win',
    icon: '🛡️',
    name: 'Sans une égratignure',
    description: 'Gagne une partie avec moins de 10 points.',
    goal: 1,
    value: (g) => (g.some((x) => x.me.winner && x.me.score < 10) ? 1 : 0),
  },
  {
    id: 'scapegoat',
    icon: '🐐',
    name: 'Bouc émissaire',
    description: 'Prends 80 points en une manche.',
    goal: 1,
    value: (g) => (g.some((x) => (x.me.worstRound ?? 0) >= 80) ? 1 : 0),
  },
  {
    id: 'castaway',
    icon: '⚓',
    name: 'Naufragé',
    description: 'Finis une partie avec 150 points ou plus.',
    goal: 1,
    value: (g) => (g.some((x) => x.me.score >= 150) ? 1 : 0),
  },
];

/** Nombre de personnes (pas de bots) à la table de cette partie. */
const humans = (g: Game) => g.record.players.filter((p) => !p.bot).length;

const sum = (games: Game[], f: (g: Game) => number) => games.reduce((total, g) => total + f(g), 0);
const max = (games: Game[], f: (g: Game) => number) => Math.max(0, ...games.map(f));
const wins = (games: Game[]) => games.filter((g) => g.me.winner).length;

/** Plus longue série de victoires d'affilée (les parties sont dans l'ordre où elles ont été jouées). */
function streak(games: Game[]): number {
  let best = 0;
  let current = 0;
  for (const g of games) {
    current = g.me.winner ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

/** Badges d'un joueur à partir de ses parties, de la plus ancienne à la plus récente. */
export function badgesOf(games: Game[]): Badge[] {
  return BADGES.map(({ value, ...badge }) => ({ ...badge, value: Math.min(value(games), badge.goal) }));
}
