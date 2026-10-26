import { describe, expect, it } from 'vitest';
import {
  type Action,
  type Card,
  type GameState,
  MULTI_ONE_ID,
  analyzeCombination,
  applyAction,
  canBeat,
  createDeck,
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

/** Partie avec des mains choisies, le joueur 0 ayant la main et le tour allant de 0 à 1, 2… ; les autres cartes sont déjà jouées. */
function withHands(hands: string[][], overrides: Partial<GameState> = {}): GameState {
  const state = createGame(players.slice(0, hands.length), 1);
  state.players.forEach((p, i) => (p.hand = cards(...hands[i]!)));
  const pile = createDeck();
  for (const card of state.players.flatMap((p) => p.hand)) {
    pile.splice(pile.findIndex((c) => c.color === card.color && c.value === card.value), 1);
  }
  return { ...state, pile, dummy: [], direction: 1, currentPlayer: 0, mustPlayMultiOne: false, ...overrides };
}

const ids = (state: GameState, player: number, ...positions: number[]) =>
  positions.map((i) => state.players[player]!.hand[i]!.id);

describe('createGame', () => {
  it('distribue 16 cartes à chacun et donne la main au détenteur du 1 multicolore', () => {
    const state = createGame(players, 42);
    expect(state.players.map((p) => p.hand.length)).toEqual([16, 16, 16, 16]);
    // Première manche en sens horaire.
    expect(state.direction).toBe(-1);
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

  it('à trois joueurs, met 16 cartes de côté et fait ouvrir le voisin du donneur si le 1 multicolore y est', () => {
    for (let seed = 1; seed < 50; seed++) {
      const state = createGame(players.slice(0, 3), seed);
      expect(state.players.map((p) => p.hand.length)).toEqual([16, 16, 16]);
      const holder = state.players.findIndex((p) => p.hand.some((c) => c.id === MULTI_ONE_ID));
      expect(state.currentPlayer).toBe(holder >= 0 ? holder : 2);
      expect(state.mustPlayMultiOne).toBe(holder >= 0);
    }
  });

  it('refuse un nombre de joueurs autre que 3 ou 4', () => {
    expect(() => createGame(players.slice(0, 2), 1)).toThrow();
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

  it("refuse une combinaison trop faible ou d'un autre format", () => {
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

  it('garde la trace des coups et des passes du pli en cours', () => {
    let state = withHands(hands);
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    state = apply(state, { type: 'pass', playerIndex: 1 });
    state = apply(state, { type: 'play', playerIndex: 2, cardIds: ids(state, 2, 0) });
    expect(state.trick.map((e) => [e.playerIndex, e.combination?.type ?? 'pass'])).toEqual([
      [0, 'single'],
      [1, 'pass'],
      [2, 'single'],
    ]);
    state = apply(state, { type: 'pass', playerIndex: 3 });
    state = apply(state, { type: 'pass', playerIndex: 0 });
    // Le joueur 1 a déjà passé : il ne rejoue pas, le pli est fini.
    // Le pli terminé reste visible jusqu'à ce que le suivant soit ouvert.
    expect(state.table).toBeNull();
    expect(state.currentPlayer).toBe(2);
    expect(state.trick).toHaveLength(5);
    state = apply(state, { type: 'play', playerIndex: 2, cardIds: ids(state, 2, 0) });
    expect(state.trick).toHaveLength(1);
    expect(getPlayerView(state, 1).trick).toEqual(state.trick);
  });

  it("saute jusqu'à la fin du pli un joueur qui a passé", () => {
    let state = withHands(hands);
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    state = apply(state, { type: 'pass', playerIndex: 1 });
    state = apply(state, { type: 'play', playerIndex: 2, cardIds: ids(state, 2, 0) });
    state = apply(state, { type: 'play', playerIndex: 3, cardIds: ids(state, 3, 0) });
    state = apply(state, { type: 'pass', playerIndex: 0 });
    expect(state.currentPlayer).toBe(2);
    expect(applyAction(state, { type: 'pass', playerIndex: 1 })).toEqual({ ok: false, error: 'notYourTurn' });
    state = apply(state, { type: 'pass', playerIndex: 2 });
    // Tous les autres ont passé : le joueur 3 remporte le pli et rouvre.
    expect(state.table).toBeNull();
    expect(state.currentPlayer).toBe(3);
  });

  it('tourne dans l\'autre sens quand la direction est inversée', () => {
    let state = withHands(hands, { direction: -1 });
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    expect(state.currentPlayer).toBe(3);
  });

  it("ne modifie pas l'état d'origine", () => {
    const state = withHands(hands);
    const copy = structuredClone(state);
    applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    expect(state).toEqual(copy);
  });
});

describe('règle « Carte ! »', () => {
  it("oblige à jouer sa plus forte carte seule si le joueur suivant n'a plus qu'une carte", () => {
    const table = { playerIndex: 3, combination: analyzeCombination(cards('y2'))! };
    const state = withHands([['g5', 'g9', 'r9'], ['r3'], ['g6'], ['y7', 'y8']], { table });
    expect(applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) })).toEqual({
      ok: false,
      error: 'mustPlayHighestSingle',
    });
    expect(applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 2) }).ok).toBe(true);
  });

  it("oblige à ouvrir avec une combinaison si possible quand le joueur suivant n'a plus qu'une carte", () => {
    const state = withHands([['g2', 'g9', 'r9'], ['r3'], ['g5', 'g6'], ['y7', 'y8']]);
    expect(applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 2) })).toEqual({
      ok: false,
      error: 'mustLeadCombination',
    });
    expect(applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 1, 2) }).ok).toBe(true);
  });

  it('autorise à ouvrir avec sa plus forte carte seule faute de combinaison', () => {
    const state = withHands([['g2', 'r9'], ['r3'], ['g5', 'g6'], ['y7', 'y8']]);
    expect(applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) })).toEqual({
      ok: false,
      error: 'mustPlayHighestSingle',
    });
    expect(applyAction(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 1) }).ok).toBe(true);
  });
});

describe('fin de manche', () => {
  it("compte les pénalités, puis organise l'échange de cartes et fait ouvrir le gagnant", () => {
    const loserHand = ['g1', 'g2', 'g3', 'g4', 'y5', 'y6', 'y7', 'r8', 'r9'];
    let state = withHands([['rD'], ['g3', 'y4'], loserHand, ['y7']]);
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });

    expect(state.phase).toBe('roundOver');
    expect(state.lastRound).toEqual({ winnerIndex: 0, loserIndex: 2, penalties: [0, 2, 18, 1] });
    expect(state.players.map((p) => p.score)).toEqual([0, 2, 18, 1]);

    state = apply(state, { type: 'nextRound' });
    state = apply(state, { type: 'cut', playerIndex: 0, position: 30 });
    expect(state.phase).toBe('exchange');
    expect(state.direction).toBe(1);
    expect(state.players[0]!.hand).toHaveLength(17);
    expect(state.players[2]!.hand).toHaveLength(15);

    // Les cartes échangées sont montrées à tous.
    const given = state.exchange!.loserCard;
    expect(getPlayerView(state, 1).exchange!.loserCard).toEqual(given);
    expect(state.players[0]!.hand).toContainEqual(given);

    expect(applyAction(state, { type: 'giveCard', playerIndex: 2, cardId: 'x' })).toEqual({
      ok: false,
      error: 'notYourTurn',
    });
    const returned = state.players[0]!.hand[0]!;
    state = apply(state, { type: 'giveCard', playerIndex: 0, cardId: returned.id });
    expect(state.exchange!.winnerCard).toEqual(returned);
    expect(state.phase).toBe('playing');
    expect(state.players.map((p) => p.hand.length)).toEqual([16, 16, 16, 16]);
    expect(state.currentPlayer).toBe(0);
  });

  it('désigne comme perdant, à égalité de cartes, celui qui a le plus gros score', () => {
    let state = withHands([['rD'], ['g3', 'y4'], ['g5', 'g6'], ['y7']]);
    state.players[2]!.score = 10;
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    expect(state.lastRound!.loserIndex).toBe(2);
  });

  it('départage ensuite par la proximité avec le gagnant dans le sens antihoraire', () => {
    let state = withHands([['g3', 'y4'], ['rD'], ['y7'], ['g5', 'g6']], { currentPlayer: 1 });
    state = apply(state, { type: 'play', playerIndex: 1, cardIds: ids(state, 1, 0) });
    expect(state.lastRound!.loserIndex).toBe(3);
  });

  it('ne remélange pas : redistribue les 64 cartes ramassées, et le voisin de gauche devient donneur', () => {
    let state = createGame(players.slice(0, 3), 9);
    expect(state.dealer).toBe(0);
    state = withHands([['rD'], ['g3', 'y4'], ['g5', 'g6']]);
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    state = apply(state, { type: 'nextRound' });

    // L'ancien donneur coupe où il veut : le paquet est montré, pas son contenu.
    expect(state.phase).toBe('cut');
    expect(getPlayerView(state, 1).deckSize).toBe(64);
    expect(getPlayerView(state, 1)).not.toHaveProperty('deck');
    expect(applyAction(state, { type: 'cut', playerIndex: 1, position: 10 })).toEqual({ ok: false, error: 'notYourTurn' });
    expect(applyAction(state, { type: 'cut', playerIndex: 0, position: 64 })).toEqual({ ok: false, error: 'invalidCut' });
    const top = state.deck.slice(0, 10).map((c) => c.id);
    state = apply(state, { type: 'cut', playerIndex: 0, position: 10 });

    expect(state.dealer).toBe(2);
    // Les 10 cartes coupées sont passées dessous : à trois, elles finissent dans la main morte.
    expect(state.dummy.map((c) => c.id).slice(-10)).toEqual(top);
    const faces = (list: Card[]) => list.map((c) => `${c.color}${c.value}`).sort();
    expect(faces([...state.players.flatMap((p) => p.hand), ...state.dummy])).toEqual(faces(createDeck()));
    expect(state.dummy).toHaveLength(16);
    expect(state.pile).toEqual([]);
    expect(getPlayerView(state, 0)).not.toHaveProperty('dummy');
  });

  it('termine la partie quand un joueur atteint le score cible', () => {
    let state = withHands([['rD'], ['g3', 'y4'], ['g5'], ['y7']], { config: { targetScore: 2 } });
    state = apply(state, { type: 'play', playerIndex: 0, cardIds: ids(state, 0, 0) });
    expect(state.phase).toBe('gameOver');
    expect(state.winners).toEqual([0]);
  });
});

describe('partie complète simulée', () => {
  function firstCombination(hand: Card[]): string[] | null {
    for (let i = 0; i < hand.length; i++)
      for (let j = i + 1; j < hand.length; j++)
        if (analyzeCombination([hand[i]!, hand[j]!])) return [hand[i]!.id, hand[j]!.id];
    return null;
  }

  /** Joueur automatique naïf : pose sa plus petite carte seule si elle passe, sinon passe. */
  function botAction(state: GameState): Action {
    const p = state.currentPlayer;
    const hand = state.players[p]!.hand;
    if (state.mustPlayMultiOne) return { type: 'play', playerIndex: p, cardIds: [MULTI_ONE_ID] };
    const n = state.players.length;
    const lastCard = state.players[(p + state.direction + n) % n]!.hand.length === 1;
    if (!state.table) {
      const combo = lastCard ? firstCombination(hand) : null;
      return { type: 'play', playerIndex: p, cardIds: combo ?? [hand[lastCard ? hand.length - 1 : 0]!.id] };
    }
    const candidates = lastCard ? [hand[hand.length - 1]!] : hand;
    const card = candidates.find((c) => canBeat(analyzeCombination([c])!, state.table!.combination));
    return card ? { type: 'play', playerIndex: p, cardIds: [card.id] } : { type: 'pass', playerIndex: p };
  }

  it.each([
    [4, 1],
    [4, 2],
    [4, 3],
    [3, 4],
    [3, 5],
  ])("va jusqu'au bout à %i joueurs (graine %i)", (count, seed) => {
    let state = createGame(players.slice(0, count), seed);
    for (let steps = 0; state.phase !== 'gameOver'; steps++) {
      expect(steps).toBeLessThan(20000);
      if (state.phase === 'roundOver') state = apply(state, { type: 'nextRound' });
      else if (state.phase === 'cut') state = apply(state, { type: 'cut', playerIndex: state.dealer, position: 32 });
      else if (state.phase === 'exchange') {
        const giver = state.exchange!.winnerIndex;
        state = apply(state, { type: 'giveCard', playerIndex: giver, cardId: state.players[giver]!.hand[0]!.id });
      } else {
        state = apply(state, botAction(state));
      }
    }
    expect(state.players.some((p) => p.score >= 100)).toBe(true);
    expect(state.winners.length).toBeGreaterThan(0);
  });
});
