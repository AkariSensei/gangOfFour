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

const BADGES: { id: string; icon: string; name: string; description: string; goal: number; value: (games: Game[]) => number }[] = [
  { id: 'first-win', icon: '🏆', name: 'Premier sang', description: 'Gagne une partie.', goal: 1, value: (g) => wins(g) },
  { id: 'games-10', icon: '🃏', name: 'Habitué', description: 'Joue 10 parties.', goal: 10, value: (g) => g.length },
  { id: 'games-50', icon: '🪑', name: 'Pilier', description: 'Joue 50 parties.', goal: 50, value: (g) => g.length },
  { id: 'games-100', icon: '💯', name: 'Centurion', description: 'Joue 100 parties.', goal: 100, value: (g) => g.length },
  { id: 'wins-10', icon: '🎩', name: 'Chef de gang', description: 'Gagne 10 parties.', goal: 10, value: (g) => wins(g) },
  { id: 'wins-25', icon: '👑', name: 'Parrain', description: 'Gagne 25 parties.', goal: 25, value: (g) => wins(g) },
  { id: 'streak-3', icon: '🔥', name: 'En série', description: '3 victoires d’affilée.', goal: 3, value: (g) => streak(g) },
  { id: 'streak-5', icon: '⚡', name: 'Intouchable', description: '5 victoires d’affilée.', goal: 5, value: (g) => streak(g) },
  { id: 'gang-1', icon: '💥', name: 'Gang of Four', description: 'Pose un gang.', goal: 1, value: (g) => sum(g, (x) => x.me.gangs ?? 0) },
  { id: 'gang-10', icon: '🧨', name: 'Dynamiteur', description: 'Pose 10 gangs.', goal: 10, value: (g) => sum(g, (x) => x.me.gangs ?? 0) },
  {
    id: 'clean-win',
    icon: '🛡️',
    name: 'Sans une égratignure',
    description: 'Gagne une partie avec moins de 20 points.',
    goal: 1,
    value: (g) => (g.some((x) => x.me.winner && x.me.score < 20) ? 1 : 0),
  },
  {
    id: 'steamroller',
    icon: '🚜',
    name: 'Rouleau compresseur',
    description: 'Gagne 5 manches dans une partie.',
    goal: 5,
    value: (g) => max(g, (x) => x.me.roundsWon ?? 0),
  },
  { id: 'marathon', icon: '🏃', name: 'Marathon', description: 'Joue une partie de 10 manches.', goal: 10, value: (g) => max(g, (x) => x.record.rounds) },
  {
    id: 'scapegoat',
    icon: '🐐',
    name: 'Bouc émissaire',
    description: 'Prends 80 points en une manche.',
    goal: 1,
    value: (g) => (g.some((x) => (x.me.worstRound ?? 0) >= 80) ? 1 : 0),
  },
];

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
