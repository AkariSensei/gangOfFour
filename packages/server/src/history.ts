import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameState } from '@gof/engine';
import { type Badge, badgesOf } from './badges';

export interface GameRecord {
  finishedAt: string;
  rounds: number;
  /** Partie d'avant une remise à zéro du classement : gardée dans le fichier, mais plus comptée nulle part. */
  archived?: boolean;
  players: {
    name: string;
    score: number;
    winner: boolean;
    bot?: boolean;
    /** Compte du joueur (absent des parties jouées avant les comptes, ou d'un siège en plus de l'admin). */
    account?: string;
    /** Statistiques de la partie (absentes des parties enregistrées avant leur ajout). */
    roundsWon?: number;
    gangs?: number;
    worstRound?: number;
    /** Retiré du classement par l'admin : la partie reste, mais ne compte plus pour ce joueur. */
    removed?: boolean;
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
  badges: Badge[];
}

export interface LeaderboardEntry {
  name: string;
  games: number;
  wins: number;
  averageScore: number;
}

/** Parties en ligne (au moins deux personnes) ou jouées seul contre des bots. */
export type RankingMode = 'online' | 'bots';

/** Plus longue série de victoires d'affilée d'un compte. */
export interface WinStreak {
  name: string;
  wins: number;
}

const key = (name: string) => name.trim().toLocaleLowerCase('fr');

/** Ce que l'historique doit savoir des comptes : leur pseudo actuel, et quel compte porte un pseudo. */
export interface AccountNames {
  get(id: string | undefined): { name?: string } | undefined;
  byName(name: string): { id: string } | undefined;
}

/** Mois d'une date à l'heure de Paris, sous la forme « 2026-10 ». */
const parisMonth = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' });
export const monthOf = (date: Date) => parisMonth.format(date).slice(0, 7);

/** Historique des parties terminées, gardé dans un fichier JSON (ou en mémoire sans fichier). */
export class GameHistory {
  private records: GameRecord[] = [];

  constructor(
    private file?: string,
    private accounts?: AccountNames,
  ) {
    if (!file) return;
    try {
      this.records = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.records = [];
    }
  }

  /**
   * `bots` : indices des joueurs tenus par l'ordinateur, gardés dans l'historique mais pas dans le classement.
   * `accounts` : compte de chaque siège, pour que le classement suive la personne et pas le pseudo.
   */
  record(game: GameState, finishedAt = new Date(), bots: number[] = [], accounts: (string | undefined)[] = []): GameRecord {
    const record: GameRecord = {
      finishedAt: finishedAt.toISOString(),
      rounds: game.round,
      players: game.players.map((p, i) => ({
        name: p.name,
        score: p.score,
        winner: game.winners.includes(i),
        ...(bots.includes(i) ? { bot: true } : {}),
        ...(accounts[i] ? { account: accounts[i] } : {}),
        ...(game.stats?.[i] ?? {}),
      })),
    };
    this.records.push(record);
    this.save();
    return record;
  }

  /** Parties qui comptent : celles d'après la dernière remise à zéro. */
  private get counted(): GameRecord[] {
    return this.records.filter((r) => !r.archived);
  }

  /** Partie en ligne : au moins deux personnes différentes à la table. Sinon, une personne seule contre des bots. */
  private online(record: GameRecord): boolean {
    return new Set(record.players.filter((p) => !p.bot).map((p) => this.owner(p))).size >= 2;
  }

  /** Parties qui comptent pour ce classement : toutes, seulement en ligne, ou seulement contre les bots. */
  private ofMode(mode?: RankingMode): GameRecord[] {
    return mode ? this.counted.filter((r) => this.online(r) === (mode === 'online')) : this.counted;
  }

  /** Ce joueur compte-t-il dans le classement, les records et les badges ? */
  private ranked(player: GameRecord['players'][number]): boolean {
    return !player.bot && !player.removed;
  }

  /** Remise à zéro du classement : toutes les parties jouées jusqu'ici sont archivées (rien n'est effacé du fichier). */
  resetRanking(): void {
    for (const record of this.counted) record.archived = true;
    this.save();
  }

  /** L'admin retire un compte du classement : ses parties jouées jusqu'ici ne comptent plus pour lui. */
  removeFromRanking(accountId: string): void {
    for (const p of this.counted.flatMap((r) => r.players)) if (p.account === accountId) p.removed = true;
    this.save();
  }

  /** Ce compte a-t-il des parties qui comptent au classement ? */
  isRanked(accountId: string): boolean {
    return this.counted.some((r) => r.players.some((p) => this.ranked(p) && p.account === accountId));
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

  /** À qui revient une ligne de l'historique : son compte, ou le pseudo seul pour une partie d'avant les comptes. */
  private owner(player: GameRecord['players'][number]): string {
    return player.account ?? `pseudo:${key(player.name)}`;
  }

  /**
   * Un compte prend un pseudo : les parties jouées sous ce pseudo avant les comptes lui reviennent, pour de bon
   * (même s'il change de pseudo plus tard). Le premier compte qui prend le pseudo les récupère.
   */
  claim(name: string, accountId: string): void {
    let changed = false;
    for (const p of this.records.flatMap((r) => r.players)) {
      if (p.bot || p.account || key(p.name) !== key(name)) continue;
      p.account = accountId;
      changed = true;
    }
    if (changed) this.save();
  }

  /** Pseudo à afficher : celui du compte aujourd'hui (s'il a été renommé), sinon celui de la partie. */
  private displayName(player: GameRecord['players'][number]): string {
    return this.accounts?.get(this.owner(player))?.name ?? player.name;
  }

  recent(limit = 5): GameRecord[] {
    return this.counted
      .slice(-limit)
      .reverse()
      .map((record) => ({
        ...record,
        players: record.players.map((p) => {
          const { account: _account, removed: _removed, ...shown } = p;
          return { ...shown, name: this.displayName(p) };
        }),
      }));
  }

  /**
   * Classement par victoires, puis taux de victoire, puis score moyen (le plus bas est le meilleur).
   * `month` (« 2026-10 ») ne compte que les parties finies ce mois-là, à l'heure de Paris.
   * `mode` sépare les parties en ligne de celles jouées seul contre des bots (sans : toutes).
   */
  leaderboard(limit = 10, month?: string, mode?: RankingMode): LeaderboardEntry[] {
    const byName = new Map<string, LeaderboardEntry & { total: number }>();
    for (const record of this.ofMode(mode)) {
      if (month && monthOf(new Date(record.finishedAt)) !== month) continue;
      for (const p of record.players) {
        if (!this.ranked(p)) continue;
        const owner = this.owner(p);
        const entry = byName.get(owner) ?? { name: p.name, games: 0, wins: 0, averageScore: 0, total: 0 };
        entry.name = this.displayName(p);
        entry.games += 1;
        entry.wins += p.winner ? 1 : 0;
        entry.total += p.score;
        byName.set(owner, entry);
      }
    }
    return [...byName.values()]
      .map(({ total, ...e }) => ({ ...e, averageScore: Math.round(total / e.games) }))
      .sort((a, b) => b.wins - a.wins || b.wins / b.games - a.wins / a.games || a.averageScore - b.averageScore)
      .slice(0, limit);
  }

  /**
   * Record du bureau : la plus longue série de parties gagnées d'affilée par un compte (une victoire partagée compte).
   * À égalité, le record reste à celui qui l'a atteint en premier. Null tant que personne n'a gagné deux fois de suite.
   */
  bestStreak(mode?: RankingMode): WinStreak | null {
    const current = new Map<string, number>();
    let best: { player: GameRecord['players'][number]; wins: number } | null = null;
    for (const record of this.ofMode(mode)) {
      for (const p of record.players) {
        if (!this.ranked(p) || !p.account) continue;
        const wins = p.winner ? (current.get(p.account) ?? 0) + 1 : 0;
        current.set(p.account, wins);
        if (wins > (best?.wins ?? 1)) best = { player: p, wins };
      }
    }
    return best && { name: this.displayName(best.player), wins: best.wins };
  }

  /** Parties d'un joueur (compte, ou « pseudo:… » d'avant les comptes), de la plus ancienne à la plus récente. */
  private gamesOf(owner: string) {
    return this.counted.flatMap((record) => {
      const me = record.players.find((p) => this.ranked(p) && this.owner(p) === owner);
      return me ? [{ record, me }] : [];
    });
  }

  /** Badges d'un compte, pour repérer ceux qu'une partie vient de lui faire gagner. */
  badgesOfAccount(accountId: string): Badge[] {
    return badgesOf(this.gamesOf(accountId));
  }

  /** Fiche d'un joueur humain (nom sans tenir compte des majuscules), ou null s'il n'a jamais joué. */
  profile(name: string): PlayerProfile | null {
    const games = this.gamesOf(this.accounts?.byName(name)?.id ?? `pseudo:${key(name)}`);
    if (games.length === 0) return null;
    const sum = (f: (g: (typeof games)[number]) => number) => games.reduce((total, g) => total + f(g), 0);
    return {
      name: this.displayName(games[games.length - 1]!.me),
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
      badges: badgesOf(games),
    };
  }
}
