import { type Card, MULTI_ONE_ID, compareCards, createDeck, highestCard, sortHand } from './cards';
import { type Combination, analyzeCombination, canBeat } from './combinations';
import { createRng, shuffle } from './random';
import { penaltyForCards } from './scoring';

export const PLAYER_COUNT = 4;
export const HAND_SIZE = 16;

export interface GameConfig {
  /** Score à partir duquel la partie s'arrête. */
  targetScore: number;
  /** Qui ouvre les manches suivantes : le perdant ou le gagnant de la manche précédente. */
  nextRoundLeader: 'loser' | 'winner';
  /** Le premier coup de la partie doit contenir le 1 multicolore. */
  firstPlayMustIncludeMultiOne: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  targetScore: 100,
  nextRoundLeader: 'loser',
  firstPlayMustIncludeMultiOne: true,
};

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  score: number;
}

export interface TablePlay {
  playerIndex: number;
  combination: Combination;
}

export interface RoundResult {
  winnerIndex: number;
  loserIndex: number;
  /** Pénalités de la manche, dans l'ordre des joueurs. */
  penalties: number[];
}

export type Phase = 'exchange' | 'playing' | 'roundOver' | 'gameOver';

export interface GameState {
  config: GameConfig;
  seed: number;
  round: number;
  phase: Phase;
  players: PlayerState[];
  currentPlayer: number;
  /** Dernière combinaison posée sur la table dans le pli en cours. */
  table: TablePlay | null;
  /** Nombre de passes consécutives depuis la dernière combinaison posée. */
  passes: number;
  firstPlayOfGame: boolean;
  /** Pendant l'échange : le gagnant doit rendre une carte au perdant. */
  exchange: { fromIndex: number; toIndex: number; receivedCardId: string } | null;
  lastRound: RoundResult | null;
  /** Indices des joueurs avec le score le plus bas en fin de partie. */
  winners: number[];
}

export type Action =
  | { type: 'play'; playerIndex: number; cardIds: string[] }
  | { type: 'pass'; playerIndex: number }
  | { type: 'giveCard'; playerIndex: number; cardId: string }
  | { type: 'nextRound' };

export type ActionError =
  | 'wrongPhase'
  | 'notYourTurn'
  | 'unknownCard'
  | 'invalidCombination'
  | 'tooWeak'
  | 'cannotPassWhenLeading'
  | 'mustPlayMultiOne'
  | 'mustPlayHighestSingle';

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: ActionError };

export interface NewPlayer {
  id: string;
  name: string;
}

function nextIndex(index: number): number {
  return (index + 1) % PLAYER_COUNT;
}

function deal(state: GameState): void {
  const rng = createRng(state.seed + state.round);
  const deck = shuffle(createDeck(), rng);
  state.players.forEach((p, i) => {
    p.hand = sortHand(deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE));
  });
}

export function createGame(players: NewPlayer[], seed: number, config: Partial<GameConfig> = {}): GameState {
  if (players.length !== PLAYER_COUNT) throw new Error(`Gang of Four se joue à ${PLAYER_COUNT} joueurs`);
  const state: GameState = {
    config: { ...DEFAULT_CONFIG, ...config },
    seed,
    round: 1,
    phase: 'playing',
    players: players.map((p) => ({ ...p, hand: [], score: 0 })),
    currentPlayer: 0,
    table: null,
    passes: 0,
    firstPlayOfGame: true,
    exchange: null,
    lastRound: null,
    winners: [],
  };
  deal(state);
  state.currentPlayer = state.players.findIndex((p) => p.hand.some((c) => c.id === MULTI_ONE_ID));
  return state;
}

function takeCards(hand: Card[], ids: string[]): Card[] | null {
  if (new Set(ids).size !== ids.length) return null;
  const cards = ids.map((id) => hand.find((c) => c.id === id));
  return cards.every((c): c is Card => c !== undefined) ? cards : null;
}

function play(state: GameState, playerIndex: number, cardIds: string[]): ActionResult {
  const player = state.players[playerIndex]!;
  const cards = takeCards(player.hand, cardIds);
  if (!cards) return { ok: false, error: 'unknownCard' };

  const combination = analyzeCombination(cards);
  if (!combination) return { ok: false, error: 'invalidCombination' };

  if (state.firstPlayOfGame && state.config.firstPlayMustIncludeMultiOne && !cardIds.includes(MULTI_ONE_ID)) {
    return { ok: false, error: 'mustPlayMultiOne' };
  }
  if (!canBeat(combination, state.table?.combination ?? null)) return { ok: false, error: 'tooWeak' };

  // Si le joueur suivant n'a plus qu'une carte, on ne peut jouer une carte seule que si c'est sa plus forte.
  const nextPlayer = state.players[nextIndex(playerIndex)]!;
  if (combination.type === 'single' && nextPlayer.hand.length === 1) {
    const best = highestCard(player.hand)!;
    if (compareCards(cards[0]!, best) !== 0) return { ok: false, error: 'mustPlayHighestSingle' };
  }

  player.hand = player.hand.filter((c) => !cardIds.includes(c.id));
  state.table = { playerIndex, combination };
  state.passes = 0;
  state.firstPlayOfGame = false;

  if (player.hand.length === 0) {
    endRound(state, playerIndex);
  } else {
    state.currentPlayer = nextIndex(playerIndex);
  }
  return { ok: true, state };
}

function pass(state: GameState, playerIndex: number): ActionResult {
  if (!state.table) return { ok: false, error: 'cannotPassWhenLeading' };
  state.passes += 1;
  if (state.passes >= PLAYER_COUNT - 1) {
    // Tout le monde a passé : celui qui a posé la dernière combinaison ouvre un nouveau pli.
    state.currentPlayer = state.table.playerIndex;
    state.table = null;
    state.passes = 0;
  } else {
    state.currentPlayer = nextIndex(playerIndex);
  }
  return { ok: true, state };
}

function endRound(state: GameState, winnerIndex: number): void {
  const penalties = state.players.map((p) => penaltyForCards(p.hand.length));
  state.players.forEach((p, i) => (p.score += penalties[i]!));

  // Le perdant est celui qui prend le plus de points ; à égalité, le premier après le gagnant.
  let loserIndex = winnerIndex;
  for (let step = 1; step < PLAYER_COUNT; step++) {
    const i = (winnerIndex + step) % PLAYER_COUNT;
    if (loserIndex === winnerIndex || penalties[i]! > penalties[loserIndex]!) loserIndex = i;
  }

  state.lastRound = { winnerIndex, loserIndex, penalties };
  state.table = null;
  state.passes = 0;

  if (state.players.some((p) => p.score >= state.config.targetScore)) {
    const best = Math.min(...state.players.map((p) => p.score));
    state.winners = state.players.flatMap((p, i) => (p.score === best ? [i] : []));
    state.phase = 'gameOver';
  } else {
    state.phase = 'roundOver';
  }
}

function nextRound(state: GameState): ActionResult {
  const { winnerIndex, loserIndex } = state.lastRound!;
  state.round += 1;
  deal(state);

  // Le perdant donne automatiquement sa meilleure carte au gagnant, qui lui en rend une de son choix.
  const loser = state.players[loserIndex]!;
  const winner = state.players[winnerIndex]!;
  const best = highestCard(loser.hand)!;
  loser.hand = loser.hand.filter((c) => c.id !== best.id);
  winner.hand = sortHand([...winner.hand, best]);

  state.exchange = { fromIndex: winnerIndex, toIndex: loserIndex, receivedCardId: best.id };
  state.phase = 'exchange';
  state.currentPlayer = winnerIndex;
  return { ok: true, state };
}

function giveCard(state: GameState, playerIndex: number, cardId: string): ActionResult {
  const exchange = state.exchange!;
  const giver = state.players[playerIndex]!;
  const card = giver.hand.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: 'unknownCard' };

  const receiver = state.players[exchange.toIndex]!;
  giver.hand = giver.hand.filter((c) => c.id !== cardId);
  receiver.hand = sortHand([...receiver.hand, card]);

  state.exchange = null;
  state.phase = 'playing';
  state.currentPlayer = state.config.nextRoundLeader === 'loser' ? exchange.toIndex : exchange.fromIndex;
  return { ok: true, state };
}

/** Applique une action sans modifier l'état reçu. */
export function applyAction(previous: GameState, action: Action): ActionResult {
  const state = structuredClone(previous);

  switch (action.type) {
    case 'play':
    case 'pass':
      if (state.phase !== 'playing') return { ok: false, error: 'wrongPhase' };
      if (action.playerIndex !== state.currentPlayer) return { ok: false, error: 'notYourTurn' };
      return action.type === 'play' ? play(state, action.playerIndex, action.cardIds) : pass(state, action.playerIndex);
    case 'giveCard':
      if (state.phase !== 'exchange') return { ok: false, error: 'wrongPhase' };
      if (action.playerIndex !== state.exchange!.fromIndex) return { ok: false, error: 'notYourTurn' };
      return giveCard(state, action.playerIndex, action.cardId);
    case 'nextRound':
      if (state.phase !== 'roundOver') return { ok: false, error: 'wrongPhase' };
      return nextRound(state);
  }
}

export interface PlayerView {
  round: number;
  phase: Phase;
  you: number;
  hand: Card[];
  players: { id: string; name: string; score: number; cardCount: number }[];
  currentPlayer: number;
  table: TablePlay | null;
  exchange: GameState['exchange'];
  lastRound: RoundResult | null;
  winners: number[];
}

/** Ce qu'un joueur a le droit de voir : sa main, et seulement le nombre de cartes des autres. */
export function getPlayerView(state: GameState, playerIndex: number): PlayerView {
  return {
    round: state.round,
    phase: state.phase,
    you: playerIndex,
    hand: state.players[playerIndex]!.hand,
    players: state.players.map((p) => ({ id: p.id, name: p.name, score: p.score, cardCount: p.hand.length })),
    currentPlayer: state.currentPlayer,
    table: state.table,
    exchange:
      state.exchange && playerIndex !== state.exchange.fromIndex && playerIndex !== state.exchange.toIndex
        ? { ...state.exchange, receivedCardId: '' }
        : state.exchange,
    lastRound: state.lastRound,
    winners: state.winners,
  };
}
