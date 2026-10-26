import { describe, expect, it } from 'vitest';
import {
  type Action,
  type GameState,
  MULTI_ONE_ID,
  analyzeCombination,
  applyAction,
  canBeat,
  createGame,
  getPlayerView,
} from '../src';
import { cards } from './helpers';

const players = ['Alice', 'Bruno', 'Chloé', 'David'].map((name, i) => ({ id: `p${i}`, name }));

function apply(state: GameState, action: Action): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** Partie avec des mains choisies, le joueur 0 ayant la main. */
function withHands(hands: string[][], overrides: Partial<GameState> = {}): GameState {
  const state = createGame(players, 1);
  state.players.forEach((p, i) => (p.hand = cards(...hands[i]!)));
  return { ...state, currentPlayer: 0, firstPlayOfGame: false, ...overrides };
}

const ids = (state: GameState, player: number, ...positions: number[]) =>
  positions.map((i) => state.players[player]!.hand[i]!.id);

describe('createGame', () => {
  it('distribue 16 cartes à chacun et donne la main au détenteur du 1 multicolore', () => {
    const state = createGame(players, 42);
    expect(state.players.map((p) => p.hand.length)).toEqual([16, 16, 16, 16]);
    expect(state.players[state.currentPlayer]!.hand.some((c) => c.id === MULTI_ONE_ID)).toBe(true);
  });

  it('distribue toujours les mêmes mains pour la même graine', () => {
    expect(createGame(players, 7).players).toEqual(createGame(players, 7).players);
  });

  it('exige le 1 multicolore dans le premier coup', () => {
    const state = createGame(players, 42);
    const p = state.currentPlayer;
    const other = state.players[p]!.hand.find((c) => c.id !== MULTI_ONE_ID)!;
    expect(applyAction(state, { type: 'play', playerIndex: p, cardIds: [other.id] })).toEqual({
      ok: false,
      error: 'mustPlayMultiOne',
    });
    expect(applyAction(state, { type: 'play', playerIndex: p, cardIds: [MULTI_ONE_ID] }).ok).toBe(true);
  });
});

describe('déroulement des plis', () => {
  const hands = [
    ['g2', 'g9', 'r9'],
    ['g3', 'y4'],
    ['g5', 'g6'],
    ['y7', 'y8'],
  ];

  it('refuse de jouer hors de son tour et de passer en ouvrant', () => {
    const state = withHands(hands);
    expect(applyAction(state, { type: 'pass', playerIndex: 1 })).toEqual({ ok: false, error: 'notYourTurn' });
    expect(applyAction(state, { type: 'pass', playerIndex: 0 })).toEqual({ ok: false, error: 'cannotPassWhenLeading' });
  });

  it('refuse une combinaison trop faible ou d\'un autre format', () => {
    let state = withHands(hands);
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 1, 2) });
    expect(applyAction(state, { type: 'play', playerIndex: 1, cardIds: ids(state, 1, 0) })).toEqual({
      ok: false,
      error: 'tooWeak',
    });
  });

  it('rend la main au dernier joueur à avoir posé quand tous les autres passent', () => {
    let state = withHands(hands);
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    state = apply(state, { type: 'play', playerIndex: 1, cardIds: ids(state, 1, 0) });
    state = apply(state, { type: 'pass', playerIndex: 2 });
    state = apply(state, { type: 'pass', playerIndex: 3 });
    expect(state.currentPlayer).toBe(0);
    state = apply(state, { type: 'pass', playerIndex: 0 });
    expect(state.table).toBeNull();
    expect(state.currentPlayer).toBe(1);
  });

  it('ne modifie pas l\'état d\'origine', () => {
    const state = withHands(hands);
    const copy = structuredClone(state);
    applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    expect(state).toEqual(copy);
  });

  it('oblige à jouer sa plus forte carte seule si le joueur suivant n\'a plus qu\'une carte', () => {
    const state = withHands([['g2', 'g9'], ['r3'], ['g5', 'g6'], ['y7', 'y8']]);
    expect(applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) })).toEqual({
      ok: false,
      error: 'mustPlayHighestSingle',
    });
    expect(applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 1) }).ok).toBe(true);
  });
});

describe('fin de manche', () => {
  it('compte les pénalités, puis organise l\'échange de cartes', () => {
    const loserHand = ['g1', 'g2', 'g3', 'g4', 'y5', 'y6', 'y7', 'r8', 'r9'];
    let state = withHands([['rD'], ['g3', 'y4'], loserHand, ['y7']]);
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });

    expect(state.phase).toBe('roundOver');
    expect(state.lastRound).toEqual({ winnerIndex: 0, loserIndex: 2, penalties: [0, 2, 18, 1] });
    expect(state.players.map((p) => p.score)).toEqual([0, 2, 18, 1]);

    state = apply(state, { type: 'nextRound' });
    expect(state.phase).toBe('exchange');
    expect(state.players[0]!.hand).toHaveLength(17);
    expect(state.players[2]!.hand).toHaveLength(15);
    expect(state.players[0]!.hand.some((c) => c.id === state.exchange!.receivedCardId)).toBe(true);

    // Les autres joueurs ne voient pas quelle carte a été donnée.
    expect(getPlayerView(state, 1).exchange!.receivedCardId).toBe('');
    expect(getPlayerView(state, 0).exchange!.receivedCardId).not.toBe('');

    expect(applyAction(state, { type: 'giveCard', playerIndex: 2, cardId: 'x' })).toEqual({
      ok: false,
      error: 'notYourTurn',
    });
    state = apply(state, { type: 'giveCard', playerIndex: 0, cardId: ids(state, 0, 0)[0]! });
    expect(state.phase).toBe('playing');
    expect(state.players.map((p) => p.hand.length)).toEqual([16, 16, 16, 16]);
    expect(state.currentPlayer).toBe(2);
  });

  it('termine la partie quand un joueur atteint le score cible', () => {
    let state = withHands([['rD'], ['g3', 'y4'], ['g5'], ['y7']], { config: { ...createGame(players, 1).config, targetScore: 2 } });
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    expect(state.phase).toBe('gameOver');
    expect(state.winners).toEqual([0]);
  });
});

describe('partie complète simulée', () => {
  /** Joueur automatique naïf : pose sa plus petite carte seule si elle passe, sinon passe. */
  function botAction(state: GameState): Action {
    const p = state.currentPlayer;
    const hand = state.players[p]!.hand;
    if (state.firstPlayOfGame) return { type: 'play', playerIndex: p, cardIds: [MULTI_ONE_ID] };
    const candidates = state.players[(p + 1) % 4]!.hand.length === 1 ? [hand[hand.length - 1]!] : hand;
    const card = candidates.find((c) => canBeat(analyzeCombination([c])!, state.table?.combination ?? null));
    if (card && (!state.table || state.table.combination.type === 'single')) {
      return { type: 'play', playerIndex: p, cardIds: [card.id] };
    }
    return state.table ? { type: 'pass', playerIndex: p } : { type: 'play', playerIndex: p, cardIds: [hand[0]!.id] };
  }

  it.each([1, 2, 3, 4, 5])('va jusqu\'au bout sans perdre de carte (graine %i)', (seed) => {
    let state = createGame(players, seed);
    for (let steps = 0; state.phase !== 'gameOver'; steps++) {
      expect(steps).toBeLessThan(20000);
      if (state.phase === 'roundOver') state = apply(state, { type: 'nextRound' });
      else if (state.phase === 'exchange') {
        const giver = state.exchange!.fromIndex;
        state = apply(state, { type: 'giveCard', playerIndex: giver, cardId: state.players[giver]!.hand[0]!.id });
      } else {
        const total = state.players.reduce((n, p) => n + p.hand.length, 0);
        expect(total).toBeLessThanOrEqual(64);
        state = apply(state, botAction(state));
      }
    }
    expect(state.players.some((p) => p.score >= 100)).toBe(true);
    expect(state.winners.length).toBeGreaterThan(0);
  });
});
