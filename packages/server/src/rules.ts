import {
  type GameState,
  PRESIDENT_DEFAULT_ROUNDS,
  PRESIDENT_MAX_PLAYERS,
  PRESIDENT_MIN_PLAYERS,
  PRESIDENT_ROUNDS,
  type PresidentState,
  applyAction,
  applyPresidentAction,
  createGame,
  createPresident,
  getPlayerView,
  playableCards,
  presidentPlayable,
  presidentToAct,
  presidentView,
} from '@gof/engine';
import { type BotLevel, chooseBotAction } from './bot';
import { type GameSummary, gofSummary } from './history';
import { choosePresidentAction } from './presidentBot';

/** Les jeux jouables : chacun a ses règles ci-dessous. */
export type GameId = 'gof' | 'president';
export const GAME_IDS: GameId[] = ['gof', 'president'];

/** Partie en cours, de n'importe quel jeu ; ses règles savent la lire. */
export type AnyGame = GameState | PresidentState;

/** Action de jeu telle qu'envoyée par un joueur : son siège est déduit du serveur, jamais du client. */
export type PlayerAction =
  | { type: 'play'; cardIds: string[] }
  | { type: 'pass' }
  | { type: 'giveCard'; cardId: string }
  | { type: 'giveCards'; cardIds: string[] }
  | { type: 'nextRound' }
  | { type: 'cut'; position: number };

/** Réglages choisis par l'hôte au lancement : chaque jeu prend ce qui le concerne. */
export interface GameSettings {
  targetScore?: number;
  rounds?: number;
}

/** Scores de fin de partie de Gang of Four que l'hôte peut choisir. */
export const TARGET_SCORES = [50, 100, 200];
const DEFAULT_TARGET_SCORE = 100;

/**
 * Ce que le serveur doit savoir d'un jeu pour faire tourner ses salons : créer la partie, appliquer les coups,
 * dire qui joue, faire jouer les bots, montrer la table et résumer la partie finie pour l'historique.
 */
export interface GameRules {
  id: GameId;
  minPlayers: number;
  maxPlayers: number;
  create(players: { id: string; name: string }[], seed: number, settings: GameSettings): AnyGame;
  /** La même partie, rejouée avec les mêmes réglages (revanche). */
  again(game: AnyGame, players: { id: string; name: string }[], seed: number): AnyGame;
  act(game: AnyGame, playerIndex: number, action: PlayerAction): { ok: true; game: AnyGame } | { ok: false; error: string };
  /** Le siège qui doit agir maintenant, -1 si personne (entre deux manches, partie finie). */
  toAct(game: AnyGame): number;
  over(game: AnyGame): boolean;
  /** Identifie le tour en cours : tant qu'il ne change pas, le minuteur court. */
  turnKey(game: AnyGame): string;
  /** Pas de minuteur pendant ce moment (un échange où l'on choisit ses cartes). */
  untimed(game: AnyGame): boolean;
  botAction(game: AnyGame, index: number, random: () => number, level?: BotLevel): PlayerAction | null;
  /** Coup de secours quand le bot n'a rien trouvé de permis : passer, ou ouvrir avec sa plus petite carte. */
  fallback(game: AnyGame, index: number): PlayerAction | null;
  /** Temps écoulé : ce que le serveur joue à la place du joueur. */
  timeout(game: AnyGame, index: number): PlayerAction | null;
  /** Le joueur dont c'est le tour ne peut rien poser sur la table (pour la passe automatique). */
  stuck(game: AnyGame, index: number): boolean;
  view(game: AnyGame, index: number): object;
  spectatorView(game: AnyGame): object;
  rename(game: AnyGame, index: number, name: string): AnyGame;
  round(game: AnyGame): number;
  scores(game: AnyGame): number[];
  summary(game: AnyGame): GameSummary;
}

/** Action du moteur sans le siège : le salon l'ajoute lui-même. */
const withoutIndex = (action: object | null): PlayerAction | null => {
  if (!action) return null;
  const { playerIndex: _index, ...rest } = action as { playerIndex?: number };
  return rest as PlayerAction;
};

const renamed = <T extends { players: { name: string }[] }>(game: T, index: number, name: string): T => ({
  ...game,
  players: game.players.map((p, i) => (i === index ? { ...p, name } : p)),
});

const gof = (game: AnyGame) => game as GameState;
const president = (game: AnyGame) => game as PresidentState;

const GOF: GameRules = {
  id: 'gof',
  minPlayers: 3,
  maxPlayers: 4,
  create: (players, seed, settings) =>
    createGame(players, seed, { targetScore: TARGET_SCORES.includes(settings.targetScore!) ? settings.targetScore! : DEFAULT_TARGET_SCORE }),
  again: (game, players, seed) => createGame(players, seed, gof(game).config),
  act(game, playerIndex, action) {
    if (action.type === 'giveCards') return { ok: false, error: 'wrongPhase' };
    const result = applyAction(gof(game), action.type === 'nextRound' ? action : { ...action, playerIndex });
    return result.ok ? { ok: true, game: result.state } : result;
  },
  toAct(game) {
    const g = gof(game);
    return g.phase === 'playing' ? g.currentPlayer : g.phase === 'exchange' ? g.exchange!.winnerIndex : g.phase === 'cut' ? g.dealer : -1;
  },
  over: (game) => gof(game).phase === 'gameOver',
  turnKey(game) {
    const g = gof(game);
    return `${g.round}-${g.phase}-${g.trick.length}-${g.currentPlayer}`;
  },
  untimed: (game) => gof(game).phase === 'exchange',
  botAction: (game, index, random, level) => withoutIndex(chooseBotAction(gof(game), index, random, level)),
  fallback(game, index) {
    const g = gof(game);
    if (g.phase !== 'playing') return null;
    const hand = g.players[index]!.hand;
    return g.table ? { type: 'pass' } : { type: 'play', cardIds: [hand[0]!.id] };
  },
  timeout(game, index) {
    const g = gof(game);
    if (g.phase === 'playing' && g.table) return { type: 'pass' };
    const choice = withoutIndex(chooseBotAction(g, index));
    return choice?.type === 'nextRound' ? null : choice;
  },
  stuck(game, index) {
    const g = gof(game);
    if (g.phase !== 'playing' || !g.table) return false;
    const n = g.players.length;
    const next = g.players[(index + g.direction + n) % n]!;
    return playableCards(g.players[index]!.hand, g.table.combination, next.hand.length === 1).size === 0;
  },
  view: (game, index) => getPlayerView(gof(game), index),
  spectatorView: (game) => ({ ...getPlayerView(gof(game), 0), you: -1, hand: [], hands: gof(game).players.map((p) => p.hand) }),
  rename: (game, index, name) => renamed(gof(game), index, name),
  round: (game) => gof(game).round,
  scores: (game) => gof(game).players.map((p) => p.score),
  summary: (game) => gofSummary(gof(game)),
};

const PRESIDENT: GameRules = {
  id: 'president',
  minPlayers: PRESIDENT_MIN_PLAYERS,
  maxPlayers: PRESIDENT_MAX_PLAYERS,
  create: (players, seed, settings) =>
    createPresident(players, seed, { rounds: PRESIDENT_ROUNDS.includes(settings.rounds!) ? settings.rounds! : PRESIDENT_DEFAULT_ROUNDS }),
  again: (game, players, seed) => createPresident(players, seed, president(game).config),
  act(game, playerIndex, action) {
    const g = president(game);
    const result =
      action.type === 'play'
        ? applyPresidentAction(g, { type: 'play', playerIndex, cardIds: action.cardIds })
        : action.type === 'pass'
          ? applyPresidentAction(g, { type: 'pass', playerIndex })
          : action.type === 'giveCards'
            ? applyPresidentAction(g, { type: 'giveCards', playerIndex, cardIds: action.cardIds })
            : action.type === 'nextRound'
              ? applyPresidentAction(g, { type: 'nextRound' })
              : ({ ok: false, error: 'wrongPhase' } as const);
    return result.ok ? { ok: true, game: result.state } : result;
  },
  toAct: (game) => presidentToAct(president(game)),
  over: (game) => president(game).phase === 'gameOver',
  turnKey(game) {
    const g = president(game);
    return `${g.round}-${g.phase}-${g.trick.length}-${g.gifts.filter((x) => x.given).length}-${g.currentPlayer}`;
  },
  untimed: (game) => president(game).phase === 'exchange',
  botAction: (game, index, random, level) => withoutIndex(choosePresidentAction(president(game), index, random, level)),
  fallback(game, index) {
    const g = president(game);
    if (g.phase !== 'playing') return null;
    return g.table ? { type: 'pass' } : { type: 'play', cardIds: [g.players[index]!.hand[0]!.id] };
  },
  timeout(game, index) {
    const g = president(game);
    if (g.phase === 'playing' && g.table) return { type: 'pass' };
    return withoutIndex(choosePresidentAction(g, index));
  },
  stuck(game, index) {
    const g = president(game);
    return g.phase === 'playing' && !!g.table && presidentPlayable(g.players[index]!.hand, g.table, g.forcedRank).size === 0;
  },
  view: (game, index) => presidentView(president(game), index),
  spectatorView: (game) => ({ ...presidentView(president(game), -1), hands: president(game).players.map((p) => p.hand) }),
  rename: (game, index, name) => renamed(president(game), index, name),
  round: (game) => president(game).round,
  scores: (game) => president(game).players.map((p) => p.score),
  summary(game) {
    const g = president(game);
    return {
      game: 'president',
      rounds: g.round,
      players: g.players.map((p, i) => ({
        name: p.name,
        score: p.score,
        winner: g.winners.includes(i),
        // Manches finies Président.
        roundsWon: g.places[i]?.filter((place) => place === 0).length ?? 0,
      })),
    };
  },
};

const RULES: Record<GameId, GameRules> = { gof: GOF, president: PRESIDENT };

/** Règles d'un jeu ; un salon sans jeu (d'avant les autres jeux) joue à Gang of Four. */
export function rulesOf(game: GameId | undefined): GameRules {
  return RULES[game ?? 'gof'];
}

export function isGameId(value: unknown): value is GameId {
  return GAME_IDS.includes(value as GameId);
}
