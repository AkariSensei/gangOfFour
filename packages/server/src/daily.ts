import { createRng } from '@gof/engine';
import { seedOf } from './challenges';

/** Une partie qui compte (en ligne, ou seul contre des bots tous difficiles), vue par le joueur. */
export interface DayGame {
  online: boolean;
  /** Place à la fin (1 : le moins de points), sur `players` joueurs. */
  rank: number;
  players: number;
  score: number;
  roundsWon: number;
  gangs: number;
}

/** Ce qu'un joueur a fait un jour donné : ses parties qui comptent, et son défi du jour s'il l'a terminé. */
export interface DayActivity {
  games: DayGame[];
  challenge: { won: boolean } | null;
}

/** Une mission du jour, et où en est le joueur. */
export interface MissionStatus {
  id: string;
  text: string;
  goal: number;
  value: number;
  xp: number;
  done: boolean;
}

type Mission = { id: string; text: string; goal: number; value: (a: DayActivity) => number };

const wins = (a: DayActivity) => a.games.filter((g) => g.rank === 1).length;
const sum = (a: DayActivity, f: (g: DayGame) => number) => a.games.reduce((total, g) => total + f(g), 0);

/**
 * Missions possibles, par difficulté : chaque jour en tire une de chaque, la même pour tout le monde. Seules les
 * parties qui rapportent de l'expérience comptent (en ligne, ou seul contre des bots tous difficiles).
 */
const MISSIONS: { xp: number; pool: Mission[] }[] = [
  {
    xp: 30,
    pool: [
      { id: 'play-2', text: 'Joue 2 parties', goal: 2, value: (a) => a.games.length },
      { id: 'challenge', text: 'Relève le défi du jour', goal: 1, value: (a) => (a.challenge ? 1 : 0) },
      { id: 'rounds-3', text: 'Gagne 3 manches', goal: 3, value: (a) => sum(a, (g) => g.roundsWon) },
      { id: 'podium', text: 'Finis une partie sur le podium', goal: 1, value: (a) => a.games.filter((g) => g.rank <= 3 && g.rank < g.players).length },
    ],
  },
  {
    xp: 50,
    pool: [
      { id: 'win-1', text: 'Gagne une partie', goal: 1, value: wins },
      { id: 'gang-1', text: 'Pose un gang', goal: 1, value: (a) => sum(a, (g) => g.gangs) },
      { id: 'online-2', text: 'Joue 2 parties en ligne', goal: 2, value: (a) => a.games.filter((g) => g.online).length },
      { id: 'rounds-6', text: 'Gagne 6 manches', goal: 6, value: (a) => sum(a, (g) => g.roundsWon) },
    ],
  },
  {
    xp: 80,
    pool: [
      { id: 'win-2', text: 'Gagne 2 parties', goal: 2, value: wins },
      { id: 'clean-win', text: 'Gagne une partie avec moins de 30 points', goal: 1, value: (a) => a.games.filter((g) => g.rank === 1 && g.score < 30).length },
      { id: 'hard-win', text: 'Gagne une partie seul contre trois bots difficiles', goal: 1, value: (a) => a.games.filter((g) => g.rank === 1 && !g.online).length },
      { id: 'challenge-win', text: 'Gagne le défi du jour', goal: 1, value: (a) => (a.challenge?.won ? 1 : 0) },
      { id: 'gang-2', text: 'Pose 2 gangs', goal: 2, value: (a) => sum(a, (g) => g.gangs) },
    ],
  },
];

/** Les trois missions d'un jour (une facile, une moyenne, une difficile), tirées à partir de la date. */
function missionsOf(day: string): { mission: Mission; xp: number }[] {
  const rng = createRng(seedOf(`missions:${day}`));
  return MISSIONS.map(({ xp, pool }) => ({ mission: pool[Math.floor(rng() * pool.length)]!, xp }));
}

/** Les missions d'un jour et l'avancée du joueur. */
export function missionStatus(day: string, activity: DayActivity): MissionStatus[] {
  return missionsOf(day).map(({ mission, xp }) => {
    const value = Math.min(mission.value(activity), mission.goal);
    return { id: mission.id, text: mission.text, goal: mission.goal, value, xp, done: value >= mission.goal };
  });
}

/** Expérience des missions accomplies ce jour-là. */
export const missionXp = (day: string, activity: DayActivity) => missionStatus(day, activity).reduce((total, m) => total + (m.done ? m.xp : 0), 0);

/** Expérience par jour de série, multipliée par la longueur de la série (plafonnée à une semaine). */
const STREAK_XP = 10;
const STREAK_CAP = 7;

const weekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Deux jours se suivent pour la série s'il n'y a entre eux que des jours de week-end (le bureau est fermé). */
function follows(before: string, after: string): boolean {
  for (let d = nextDay(before); d < after; d = nextDay(d)) if (!weekend(d)) return false;
  return true;
}

/**
 * Série de jours de jeu : chaque jour où le joueur a joué une partie qui compte (ou relevé le défi) prolonge la série
 * si la veille ouvrée était aussi jouée ; le week-end ne la casse pas. Chaque jour rapporte 10 XP par jour de série
 * (70 au plus). `current` : la série en cours, encore vivante si le dernier jour joué est aujourd'hui ou la veille ouvrée.
 */
export function streakOf(days: string[], today: string): { bonus: number; current: number; playedToday: boolean } {
  const sorted = [...new Set(days)].sort();
  let bonus = 0;
  let length = 0;
  sorted.forEach((day, i) => {
    length = i > 0 && follows(sorted[i - 1]!, day) ? length + 1 : 1;
    bonus += STREAK_XP * Math.min(length, STREAK_CAP);
  });
  const last = sorted[sorted.length - 1];
  const alive = !!last && (last === today || follows(last, today));
  return { bonus, current: alive ? length : 0, playedToday: last === today };
}
