import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameState } from '@gof/engine';
import { type Badge, SHOWCASE_SIZE, badgesOf, liveBadgesOf } from './badges';
import { BOT_LEVELS, type BotLevel } from './bot';
import { type ChallengeStats, NO_CHALLENGE, dayOf } from './challenges';

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
    /** Niveau du bot (parties enregistrées depuis l'ajout des niveaux). */
    botLevel?: BotLevel;
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
  /**
   * Parties jouées seul contre des bots, rangées par niveau du bot le plus fort de la table (celles d'avant les
   * niveaux, sans niveau enregistré, n'y sont pas).
   */
  vsBots: { level: BotLevel; games: number; wins: number }[];
  badges: Badge[];
  /** Badges montrés sur sa fiche : ceux qu'il a choisis, complétés par ses plus rares. */
  showcase: Badge[];
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

/** Partie jouée seul contre des bots : niveau du plus fort des bots de la table (undefined sinon, ou sans niveau connu). */
function topBotLevel(record: GameRecord): BotLevel | undefined {
  if (record.players.filter((p) => !p.bot).length >= 2) return undefined;
  const levels = record.players.filter((p) => p.bot).map((p) => p.botLevel);
  if (levels.some((l) => l === undefined)) return undefined;
  return [...BOT_LEVELS].reverse().find((level) => levels.includes(level));
}

/** Ce que l'historique doit savoir des comptes : leur pseudo actuel, et quel compte porte un pseudo. */
export interface AccountNames {
  get(id: string | undefined): { name?: string; showcase?: string[] } | undefined;
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
    /** Défis du jour, qui donnent eux aussi des badges. */
    private challenges?: { statsOf(account: string): ChallengeStats; players(): string[]; version: number },
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
  record(
    game: GameState,
    finishedAt = new Date(),
    bots: number[] = [],
    accounts: (string | undefined)[] = [],
    levels: (BotLevel | undefined)[] = [],
  ): GameRecord {
    const record = this.toRecord(game, finishedAt, bots, accounts, levels);
    this.records.push(record);
    this.save();
    return record;
  }

  /**
   * Badges « en direct » d'un compte en comptant la partie en cours (gangs posés, manches gagnées, pire manche…) :
   * ceux qu'on peut gagner pendant la partie, et donc annoncer dès qu'ils tombent.
   */
  liveBadgesOfAccount(
    accountId: string,
    game: GameState,
    bots: number[],
    accounts: (string | undefined)[],
    levels: (BotLevel | undefined)[] = [],
  ): Badge[] {
    const record = this.toRecord(game, new Date(), bots, accounts, levels);
    const me = record.players.find((p) => this.ranked(p) && this.owner(p) === accountId);
    return liveBadgesOf(me ? [...this.gamesOf(accountId), { record, me }] : this.gamesOf(accountId));
  }

  private toRecord(game: GameState, finishedAt: Date, bots: number[], accounts: (string | undefined)[], levels: (BotLevel | undefined)[] = []): GameRecord {
    return {
      finishedAt: finishedAt.toISOString(),
      rounds: game.round,
      players: game.players.map((p, i) => ({
        name: p.name,
        score: p.score,
        winner: game.winners.includes(i),
        ...(bots.includes(i) ? { bot: true, ...(levels[i] ? { botLevel: levels[i] } : {}) } : {}),
        ...(accounts[i] ? { account: accounts[i] } : {}),
        ...(game.stats?.[i] ?? {}),
      })),
    };
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

  /** Change à chaque modification de l'historique (partie ajoutée, remise à zéro, retrait, pseudo repris). */
  private version = 0;
  /** Rareté des badges, recalculée seulement quand l'historique ou les défis ont changé. */
  private rarity?: { key: string; value: Record<string, number> };

  private save() {
    this.version += 1;
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
    return badgesOf(this.gamesOf(accountId), this.challengesOf(accountId));
  }

  /**
   * Part des joueurs (tous ceux qui ont une partie au classement ou un défi terminé) qui ont obtenu chaque badge,
   * en pourcentage arrondi : plus il est bas, plus le badge est rare.
   */
  badgeRarity(): Record<string, number> {
    // Le podium du défi dépend aussi du jour : le cache change donc à minuit, heure de Paris.
    const key = `${this.version}/${this.challenges?.version ?? 0}/${dayOf(new Date())}`;
    if (this.rarity?.key !== key) this.rarity = { key, value: this.computeRarity() };
    return this.rarity.value;
  }

  private computeRarity(): Record<string, number> {
    const owners = new Set([
      ...this.counted.flatMap((r) => r.players.filter((p) => this.ranked(p)).map((p) => this.owner(p))),
      ...(this.challenges?.players() ?? []),
    ]);
    const counts: Record<string, number> = {};
    for (const owner of owners) {
      for (const b of badgesOf(this.gamesOf(owner), this.challengesOf(owner))) if (b.value >= b.goal) counts[b.id] = (counts[b.id] ?? 0) + 1;
    }
    return Object.fromEntries(badgesOf([]).map((b) => [b.id, owners.size ? Math.round((100 * (counts[b.id] ?? 0)) / owners.size) : 0]));
  }

  private challengesOf(owner: string): ChallengeStats {
    return owner.startsWith('pseudo:') ? NO_CHALLENGE : (this.challenges?.statsOf(owner) ?? NO_CHALLENGE);
  }

  /** Fiche d'un joueur humain (nom sans tenir compte des majuscules), ou null s'il n'a jamais joué (ni relevé de défi). */
  profile(name: string): PlayerProfile | null {
    const owner = this.accounts?.byName(name)?.id ?? `pseudo:${key(name)}`;
    const games = this.gamesOf(owner);
    const challenges = this.challengesOf(owner);
    if (games.length === 0 && challenges.played === 0) return null;
    const sum = (f: (g: (typeof games)[number]) => number) => games.reduce((total, g) => total + f(g), 0);
    const rarity = this.badgeRarity();
    const badges = badgesOf(games, challenges).map((b) => ({ ...b, percent: rarity[b.id] ?? 0 }));
    const earned = badges.filter((b) => b.value >= b.goal);
    const chosen = (this.accounts?.get(owner)?.showcase ?? []).flatMap((id) => earned.filter((b) => b.id === id));
    const rarest = [...earned].sort((a, b) => a.percent - b.percent).filter((b) => !chosen.includes(b));
    return {
      name: games.length > 0 ? this.displayName(games[games.length - 1]!.me) : (this.accounts?.get(owner)?.name ?? name),
      games: games.length,
      wins: games.filter((g) => g.me.winner).length,
      averageScore: games.length > 0 ? Math.round(sum((g) => g.me.score) / games.length) : 0,
      bestScore: games.length > 0 ? Math.min(...games.map((g) => g.me.score)) : 0,
      roundsPlayed: sum((g) => g.record.rounds),
      roundsWon: sum((g) => g.me.roundsWon ?? 0),
      gangs: sum((g) => g.me.gangs ?? 0),
      worstRound: Math.max(0, ...games.map((g) => g.me.worstRound ?? 0)),
      vsBots: BOT_LEVELS.map((level) => {
        const atLevel = games.filter((g) => topBotLevel(g.record) === level);
        return { level, games: atLevel.length, wins: atLevel.filter((g) => g.me.winner).length };
      }),
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
      badges,
      showcase: [...chosen, ...rarest].slice(0, SHOWCASE_SIZE),
    };
  }
}
