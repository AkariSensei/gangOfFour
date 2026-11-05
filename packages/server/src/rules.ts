import {
  type BattleshipState,
  type GameState,
  type Ship,
  type SlotsState,
  applyAction,
  applyBattleshipAction,
  battleshipBotShot,
  battleshipToAct,
  battleshipView,
  cellsAfloat,
  createBattleship,
  randomFleet,
  applySlotsAction,
  createGame,
  createSlots,
  getPlayerView,
  playableCards,
  slotsView,
} from '@gof/engine';
import { type BotLevel, chooseBotAction } from './bot';
import { type GameSummary, gofSummary } from './history';

/** Les jeux jouables : chacun a ses règles ci-dessous. */
export type GameId = 'gof' | 'slots' | 'battleship';
export const GAME_IDS: GameId[] = ['gof', 'slots', 'battleship'];

/** Partie en cours, de n'importe quel jeu ; ses règles savent la lire. */
export type AnyGame = GameState | SlotsState | BattleshipState;

/** Action de jeu telle qu'envoyée par un joueur : son siège est déduit du serveur, jamais du client. */
export type PlayerAction =
  | { type: 'play'; cardIds: string[] }
  | { type: 'pass' }
  | { type: 'giveCard'; cardId: string }
  | { type: 'spin' }
  | { type: 'place'; ships: Ship[] }
  | { type: 'shoot'; cell: number }
  | { type: 'nextRound' }
  | { type: 'cut'; position: number };

/** Réglages choisis par l'hôte au lancement : chaque jeu prend ce qui le concerne. */
export interface GameSettings {
  targetScore?: number;
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
const slots = (game: AnyGame) => game as SlotsState;
const naval = (game: AnyGame) => game as BattleshipState;

const GOF: GameRules = {
  id: 'gof',
  minPlayers: 3,
  maxPlayers: 4,
  create: (players, seed, settings) =>
    createGame(players, seed, { targetScore: TARGET_SCORES.includes(settings.targetScore!) ? settings.targetScore! : DEFAULT_TARGET_SCORE }),
  again: (game, players, seed) => createGame(players, seed, gof(game).config),
  act(game, playerIndex, action) {
    if (action.type === 'spin' || action.type === 'place' || action.type === 'shoot') return { ok: false, error: 'wrongPhase' };
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

const SLOTS: GameRules = {
  id: 'slots',
  minPlayers: 2,
  maxPlayers: 2,
  create: (players, seed) => createSlots(players, seed),
  again: (_game, players, seed) => createSlots(players, seed),
  act(game, playerIndex, action) {
    if (action.type !== 'spin') return { ok: false, error: 'wrongPhase' };
    const result = applySlotsAction(slots(game), { type: 'spin', playerIndex });
    return result.ok ? { ok: true, game: result.state } : result;
  },
  toAct: (game) => (slots(game).phase === 'playing' ? slots(game).currentPlayer : -1),
  over: (game) => slots(game).phase === 'gameOver',
  turnKey: (game) => `${slots(game).spins.length}-${slots(game).currentPlayer}`,
  untimed: () => false,
  // Un seul coup possible : tirer. Le bot de l'entraînement, le minuteur et le secours tirent tous.
  botAction: () => ({ type: 'spin' }),
  fallback: () => null,
  timeout: () => ({ type: 'spin' }),
  stuck: () => false,
  view: (game, index) => slotsView(slots(game), index),
  spectatorView: (game) => slotsView(slots(game), -1),
  rename: (game, index, name) => renamed(slots(game), index, name),
  round: (game) => slots(game).round,
  scores: (game) => slots(game).players.map((p) => p.balance),
  summary(game) {
    const g = slots(game);
    return {
      game: 'slots',
      rounds: g.round,
      players: g.players.map((p, i) => ({ name: p.name, score: p.balance, winner: g.winners.includes(i) })),
    };
  },
};

const BATTLESHIP: GameRules = {
  id: 'battleship',
  minPlayers: 2,
  maxPlayers: 2,
  create: (players, seed) => createBattleship(players, seed),
  again: (_game, players, seed) => createBattleship(players, seed),
  act(game, playerIndex, action) {
    const result =
      action.type === 'place'
        ? applyBattleshipAction(naval(game), { type: 'place', playerIndex, ships: action.ships })
        : action.type === 'shoot'
          ? applyBattleshipAction(naval(game), { type: 'shoot', playerIndex, cell: action.cell })
          : ({ ok: false, error: 'wrongPhase' } as const);
    return result.ok ? { ok: true, game: result.state } : result;
  },
  toAct: (game) => battleshipToAct(naval(game)),
  over: (game) => naval(game).phase === 'gameOver',
  turnKey(game) {
    const g = naval(game);
    return `${g.phase}-${g.players.map((p) => p.shots.length).join('-')}-${g.currentPlayer}`;
  },
  // Chacun prend le temps de placer sa flotte ; le minuteur ne compte que les tirs.
  untimed: (game) => naval(game).phase === 'placing',
  botAction(game, index, random) {
    const g = naval(game);
    if (g.phase === 'placing') return { type: 'place', ships: randomFleet(random) };
    return g.phase === 'playing' ? { type: 'shoot', cell: battleshipBotShot(g, index, random) } : null;
  },
  fallback: () => null,
  timeout: (game, index) => (naval(game).phase === 'playing' ? { type: 'shoot', cell: battleshipBotShot(naval(game), index, Math.random) } : null),
  stuck: () => false,
  view: (game, index) => battleshipView(naval(game), index),
  spectatorView: (game) => battleshipView(naval(game), -1),
  rename: (game, index, name) => renamed(naval(game), index, name),
  round: (game) => Math.max(...naval(game).players.map((p) => p.shots.length)),
  // Le score d'un joueur : les cases de sa flotte encore à flot.
  scores: (game) => naval(game).players.map((p, i) => (p.ships ? cellsAfloat(p.ships, naval(game).players[1 - i]!.shots) : 0)),
  summary(game) {
    const g = naval(game);
    return {
      game: 'battleship',
      rounds: Math.max(...g.players.map((p) => p.shots.length)),
      players: g.players.map((p, i) => ({
        name: p.name,
        score: p.ships ? cellsAfloat(p.ships, g.players[1 - i]!.shots) : 0,
        winner: g.winners.includes(i),
      })),
    };
  },
};

const RULES: Record<GameId, GameRules> = { gof: GOF, slots: SLOTS, battleship: BATTLESHIP };

/** Règles d'un jeu ; un salon sans jeu (d'avant les autres jeux) joue à Gang of Four. */
export function rulesOf(game: GameId | undefined): GameRules {
  return RULES[game ?? 'gof'];
}

export function isGameId(value: unknown): value is GameId {
  return GAME_IDS.includes(value as GameId);
}
