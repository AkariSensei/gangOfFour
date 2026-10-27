import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameState } from '@gof/engine';

export interface GameRecord {
  finishedAt: string;
  rounds: number;
  players: {
    name: string;
    score: number;
    winner: boolean;
    bot?: boolean;
    /** Statistiques de la partie (absentes des parties enregistrées avant leur ajout). */
    roundsWon?: number;
    gangs?: number;
    worstRound?: number;
  }[];
}

/** Fiche d'un joueur : ses chiffres sur toutes ses parties. */
export interface PlayerProfile {
  name: string;
  games: number;
  wins: number;
  averageScore: number;
  /** Meilleur score final (le plus bas). */
  bestScore: number;
  roundsPlayed: number;
  roundsWon: number;
  gangs: number;
  worstRound: number;
  /** Dernières parties, de la plus récente à la plus ancienne. */
  recent: { finishedAt: string; score: number; winner: boolean; rank: number; players: number }[];
}

export interface LeaderboardEntry {
  name: string;
  games: number;
  wins: number;
  averageScore: number;
}

const key = (name: string) => name.trim().toLocaleLowerCase('fr');

/** Mois d'une date à l'heure de Paris, sous la forme « 2026-10 ». */
const parisMonth = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' });
export const monthOf = (date: Date) => parisMonth.format(date).slice(0, 7);

/** Historique des parties terminées, gardé dans un fichier JSON (ou en mémoire sans fichier). */
export class GameHistory {
  private records: GameRecord[] = [];

  constructor(private file?: string) {
    if (!file) return;
    try {
      this.records = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.records = [];
    }
  }

  /** `bots` : indices des joueurs tenus par l'ordinateur, gardés dans l'historique mais pas dans le classement. */
  record(game: GameState, finishedAt = new Date(), bots: number[] = []): GameRecord {
    const record: GameRecord = {
      finishedAt: finishedAt.toISOString(),
      rounds: game.round,
      players: game.players.map((p, i) => ({
        name: p.name,
        score: p.score,
        winner: game.winners.includes(i),
        ...(bots.includes(i) ? { bot: true } : {}),
        ...(game.stats?.[i] ?? {}),
      })),
    };
    this.records.push(record);
    this.save();
    return record;
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Écriture dans un fichier temporaire puis renommage, pour ne jamais laisser un fichier à moitié écrit.
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.records, null, 1));
      renameSync(tmp, this.file);
    } catch (error) {
      console.error("Impossible d'enregistrer l'historique des parties :", error);
    }
  }

  recent(limit = 5): GameRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /**
   * Classement par victoires, puis taux de victoire, puis score moyen (le plus bas est le meilleur).
   * `month` (« 2026-10 ») ne compte que les parties finies ce mois-là, à l'heure de Paris.
   */
  leaderboard(limit = 10, month?: string): LeaderboardEntry[] {
    const byName = new Map<string, LeaderboardEntry & { total: number }>();
    for (const record of this.records) {
      if (month && monthOf(new Date(record.finishedAt)) !== month) continue;
      for (const p of record.players) {
        if (p.bot) continue;
        const entry = byName.get(key(p.name)) ?? { name: p.name, games: 0, wins: 0, averageScore: 0, total: 0 };
        entry.name = p.name;
        entry.games += 1;
        entry.wins += p.winner ? 1 : 0;
        entry.total += p.score;
        byName.set(key(p.name), entry);
      }
    }
    return [...byName.values()]
      .map(({ total, ...e }) => ({ ...e, averageScore: Math.round(total / e.games) }))
      .sort((a, b) => b.wins - a.wins || b.wins / b.games - a.wins / a.games || a.averageScore - b.averageScore)
      .slice(0, limit);
  }

  /** Fiche d'un joueur humain (nom sans tenir compte des majuscules), ou null s'il n'a jamais joué. */
  profile(name: string): PlayerProfile | null {
    const games = this.records.flatMap((record) => {
      const me = record.players.find((p) => !p.bot && key(p.name) === key(name));
      return me ? [{ record, me }] : [];
    });
    if (games.length === 0) return null;
    const sum = (f: (g: (typeof games)[number]) => number) => games.reduce((total, g) => total + f(g), 0);
    return {
      name: games[games.length - 1]!.me.name,
      games: games.length,
      wins: games.filter((g) => g.me.winner).length,
      averageScore: Math.round(sum((g) => g.me.score) / games.length),
      bestScore: Math.min(...games.map((g) => g.me.score)),
      roundsPlayed: sum((g) => g.record.rounds),
      roundsWon: sum((g) => g.me.roundsWon ?? 0),
      gangs: sum((g) => g.me.gangs ?? 0),
      worstRound: Math.max(0, ...games.map((g) => g.me.worstRound ?? 0)),
      recent: games
        .slice(-8)
        .reverse()
        .map(({ record, me }) => ({
          finishedAt: record.finishedAt,
          score: me.score,
          winner: me.winner,
          rank: 1 + record.players.filter((p) => p.score < me.score).length,
          players: record.players.length,
        })),
    };
  }
}
