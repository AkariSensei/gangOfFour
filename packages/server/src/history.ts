import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameState } from '@gof/engine';

export interface GameRecord {
  finishedAt: string;
  rounds: number;
  players: { name: string; score: number; winner: boolean; bot?: boolean }[];
}

export interface LeaderboardEntry {
  name: string;
  games: number;
  wins: number;
  averageScore: number;
}

const key = (name: string) => name.trim().toLocaleLowerCase('fr');

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

  /** Classement par victoires, puis taux de victoire, puis score moyen (le plus bas est le meilleur). */
  leaderboard(limit = 10): LeaderboardEntry[] {
    const byName = new Map<string, LeaderboardEntry & { total: number }>();
    for (const record of this.records) {
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
}
