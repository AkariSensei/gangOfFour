import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountNames } from './history';

/** Essai d'un joueur au défi d'un jour. Sans `finishedAt`, la manche est encore en cours. */
export interface ChallengeResult {
  /** Jour du défi à l'heure de Paris, sous la forme « 2026-10-28 ». */
  day: string;
  account: string;
  startedAt: string;
  finishedAt?: string;
  won?: boolean;
  /** Coups joués par le joueur pendant la manche. */
  moves?: number;
  /** Cartes qui lui restaient en main à la fin de la manche (0 s'il a gagné). */
  cardsLeft?: number;
}

/** Une ligne du classement d'un jour. */
export interface ChallengeRankEntry {
  rank: number;
  name: string;
  won: boolean;
  moves: number;
  cardsLeft: number;
}

/** Une ligne du classement au long cours. */
export interface ChallengeOverallEntry {
  name: string;
  played: number;
  wins: number;
  /** Plus longue série de jours de défi d'affilée. */
  bestStreak: number;
}

/** Ce que les badges savent des défis d'un joueur. */
export interface ChallengeStats {
  played: number;
  wins: number;
  bestStreak: number;
  /** Journées terminées (avant aujourd'hui, avec au moins trois joueurs) finies dans les trois premiers, ou premier. */
  podiums: number;
  firsts: number;
}

export const NO_CHALLENGE: ChallengeStats = { played: 0, wins: 0, bestStreak: 0, podiums: 0, firsts: 0 };

const parisDay = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Jour d'une date à l'heure de Paris, sous la forme « 2026-10-28 » : le défi change à minuit. */
export const dayOf = (date: Date) => parisDay.format(date);

/** Graine de la donne d'un jour (FNV-1a) : la même pour tout le monde, différente chaque jour. */
export function seedOf(day: string): number {
  let hash = 0x811c9dc5;
  for (const char of `defi:${day}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return hash >>> 0;
}

type Finished = ChallengeResult & Required<Pick<ChallengeResult, 'finishedAt' | 'won' | 'moves' | 'cardsLeft'>>;
const finished = (r: ChallengeResult): r is Finished => r.finishedAt !== undefined;
const duration = (r: Finished) => Date.parse(r.finishedAt) - Date.parse(r.startedAt);

/**
 * Ordre du classement d'un jour : les gagnants d'abord, au moins de coups joués ; puis les autres, au moins de
 * cartes restées en main ; à égalité, le plus rapide.
 */
const byPerformance = (a: Finished, b: Finished) =>
  Number(b.won) - Number(a.won) || (a.won ? a.moves - b.moves : a.cardsLeft - b.cardsLeft) || duration(a) - duration(b);

/** Le jour suivant, sous la forme « 2026-10-29 ». */
function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Défis du jour : un essai par joueur et par jour, gardés dans un fichier JSON (ou en mémoire sans fichier). */
export class ChallengeStore {
  private results: ChallengeResult[] = [];

  constructor(
    private file?: string,
    private accounts?: AccountNames,
  ) {
    if (!file) return;
    try {
      this.results = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.results = [];
    }
  }

  /** Comptes qui ont terminé au moins un défi. */
  players(): string[] {
    return [...new Set(this.results.filter(finished).map((r) => r.account))];
  }

  /** Essai de ce joueur pour ce jour, terminé ou non. */
  attempt(account: string, day: string): ChallengeResult | undefined {
    return this.results.find((r) => r.account === account && r.day === day);
  }

  /** Commence l'essai du jour ; refusé si le joueur a déjà joué (ou commencé) le défi de ce jour. */
  start(account: string, now = new Date()): boolean {
    const day = dayOf(now);
    if (this.attempt(account, day)) return false;
    this.results.push({ day, account, startedAt: now.toISOString() });
    this.save();
    return true;
  }

  /** Termine l'essai (une seule fois) : manche gagnée ou non, coups joués, cartes restées en main. */
  finish(account: string, day: string, outcome: { won: boolean; moves: number; cardsLeft: number }, now = new Date()): void {
    const result = this.attempt(account, day);
    if (!result || finished(result)) return;
    Object.assign(result, { finishedAt: now.toISOString(), ...outcome });
    this.save();
  }

  private name(account: string): string {
    return this.accounts?.get(account)?.name ?? 'Joueur';
  }

  /** Classement d'un jour (essais terminés seulement). */
  ranking(day: string): ChallengeRankEntry[] {
    return this.results
      .filter((r): r is Finished => r.day === day && finished(r))
      .sort(byPerformance)
      .map((r, i) => ({ rank: i + 1, name: this.name(r.account), won: r.won, moves: r.moves, cardsLeft: r.cardsLeft }));
  }

  /** Place de ce joueur dans le classement de ce jour, s'il a terminé son essai. */
  rankOf(account: string, day: string): number | null {
    const ofDay = this.results.filter((r): r is Finished => r.day === day && finished(r)).sort(byPerformance);
    const index = ofDay.findIndex((r) => r.account === account);
    return index >= 0 ? index + 1 : null;
  }

  /** Classement au long cours : défis gagnés, puis plus longue série de jours, puis défis joués. */
  overall(limit = 10): ChallengeOverallEntry[] {
    const accounts = new Set(this.results.filter(finished).map((r) => r.account));
    return [...accounts]
      .map((account) => {
        const stats = this.statsOf(account);
        return { name: this.name(account), played: stats.played, wins: stats.wins, bestStreak: stats.bestStreak };
      })
      .sort((a, b) => b.wins - a.wins || b.bestStreak - a.bestStreak || b.played - a.played)
      .slice(0, limit);
  }

  /** Chiffres des défis d'un joueur, pour ses badges. Le podium ne compte que les journées terminées. */
  statsOf(account: string, now = new Date()): ChallengeStats {
    const mine = this.results.filter((r): r is Finished => r.account === account && finished(r));
    const days = [...new Set(mine.map((r) => r.day))].sort();
    let bestStreak = 0;
    let current = 0;
    days.forEach((day, i) => {
      current = i > 0 && nextDay(days[i - 1]!) === day ? current + 1 : 1;
      bestStreak = Math.max(bestStreak, current);
    });
    const today = dayOf(now);
    // Pas de podium au rabais : la journée compte seulement si au moins trois joueurs ont relevé le défi.
    const ranks = days
      .filter((day) => day < today && this.results.filter((r) => r.day === day && finished(r)).length >= 3)
      .map((day) => this.rankOf(account, day) ?? 0);
    return {
      played: mine.length,
      wins: mine.filter((r) => r.won).length,
      bestStreak,
      podiums: ranks.filter((rank) => rank >= 1 && rank <= 3).length,
      firsts: ranks.filter((rank) => rank === 1).length,
    };
  }

  /** Change à chaque essai commencé ou terminé : sert à savoir si ce qui en est déduit est encore à jour. */
  version = 0;

  private save() {
    this.version += 1;
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.results, null, 1));
      renameSync(tmp, this.file);
    } catch (error) {
      console.error("Impossible d'enregistrer les défis :", error);
    }
  }
}
