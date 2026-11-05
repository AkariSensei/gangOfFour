import { describe, expect, it } from 'vitest';
import {
  OPENING_CARD_ID,
  type PlayingCard,
  type PresidentAction,
  type PresidentState,
  applyPresidentAction,
  createPlayingDeck,
  createPresident,
  presidentPlayable,
  presidentView,
  titleOf,
} from '../src';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Joueur ${i}` }));

function apply(state: PresidentState, action: PresidentAction): PresidentState {
  const result = applyPresidentAction(state, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

const deck = createPlayingDeck();
const card = (id: string): PlayingCard => {
  const found = deck.find((c) => c.id === id);
  if (!found) throw new Error(`carte inconnue : ${id}`);
  return found;
};

/** Partie avec des mains choisies, au tour du joueur 0. */
function withHands(hands: string[][], overrides: Partial<PresidentState> = {}): PresidentState {
  const state = createPresident(players(hands.length), 1);
  state.players.forEach((p, i) => (p.hand = hands[i]!.map(card)));
  return { ...state, currentPlayer: 0, ...overrides };
}

const play = (playerIndex: number, ...cardIds: string[]): PresidentAction => ({ type: 'play', playerIndex, cardIds });
const pass = (playerIndex: number): PresidentAction => ({ type: 'pass', playerIndex });

describe('createPresident', () => {
  it('distribue tout le paquet de 52 cartes et donne la main au détenteur du 3 de trèfle', () => {
    for (const n of [3, 4, 5, 7]) {
      const state = createPresident(players(n), 42);
      const all = state.players.flatMap((p) => p.hand.map((c) => c.id));
      expect(new Set(all).size).toBe(52);
      const sizes = state.players.map((p) => p.hand.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(state.players[state.currentPlayer]!.hand.some((c) => c.id === OPENING_CARD_ID)).toBe(true);
    }
  });

  it('refuse moins de 3 ou plus de 7 joueurs', () => {
    expect(() => createPresident(players(2), 1)).toThrow();
    expect(() => createPresident(players(8), 1)).toThrow();
  });
});

describe('poser des cartes', () => {
  it('impose le même nombre de cartes et une valeur au moins égale', () => {
    let state = withHands([['5C', '5D', '9C'], ['4C', '4D', '6C', '6D', 'KC'], ['7C', 'AC']]);
    state = apply(state, play(0, '5C', '5D'));
    expect(applyPresidentAction(state, play(1, 'KC'))).toEqual({ ok: false, error: 'wrongCount' });
    expect(applyPresidentAction(state, play(1, '4C', '4D'))).toEqual({ ok: false, error: 'tooWeak' });
    expect(applyPresidentAction(state, play(1, '6C', 'KC'))).toEqual({ ok: false, error: 'invalidCombination' });
    state = apply(state, play(1, '6C', '6D'));
    expect(state.table?.rank).toBe(6);
    expect(state.currentPlayer).toBe(2);
  });

  it("interdit de passer quand on ouvre le pli", () => {
    const state = withHands([['5C'], ['6C'], ['7C']]);
    expect(applyPresidentAction(state, pass(0))).toEqual({ ok: false, error: 'cannotPassWhenLeading' });
  });

  it('sort du pli celui qui passe, et rend le pli au dernier qui a posé', () => {
    let state = withHands([['5C', '9C', '3D'], ['8C', '3S'], ['4C', 'JC', '3H']]);
    state = apply(state, play(0, '5C'));
    state = apply(state, pass(1));
    state = apply(state, play(2, 'JC'));
    // Le joueur 1 a passé : il ne rejoue plus dans ce pli, c'est au joueur 0.
    expect(state.currentPlayer).toBe(0);
    state = apply(state, pass(0));
    // Tout le monde a passé derrière le valet : le joueur 2 ouvre un nouveau pli.
    expect(state.table).toBeNull();
    expect(state.currentPlayer).toBe(2);
    expect(state.passed).toEqual([false, false, false]);
  });

  it('« X ou rien » : après deux fois la même valeur, le suivant pose cette valeur ou passe', () => {
    let state = withHands([['7C', 'KC'], ['7D', 'AC'], ['9C', '7H', '4C'], ['3C', '5C']]);
    state = apply(state, play(0, '7C'));
    state = apply(state, play(1, '7D'));
    expect(state.forcedRank).toBe(7);
    expect(applyPresidentAction(state, play(2, '9C'))).toEqual({ ok: false, error: 'mustPlayForcedRank' });
    expect(presidentPlayable(state.players[2]!.hand, state.table, state.forcedRank)).toEqual(new Set(['7H']));
    state = apply(state, play(2, '7H'));
    expect(state.forcedRank).toBe(7);
    // La passe ne lève pas la contrainte pour les suivants.
    state = apply(state, pass(3));
    expect(state.forcedRank).toBe(7);
    expect(applyPresidentAction(state, play(0, 'KC'))).toEqual({ ok: false, error: 'mustPlayForcedRank' });
  });

  it('une valeur plus forte lève « X ou rien »', () => {
    let state = withHands([['7C', 'KC'], ['7D', 'AC'], ['9C', '4C']]);
    state = apply(state, play(0, '7C'));
    state = apply(state, play(1, '7D'));
    state = apply(state, pass(2));
    expect(applyPresidentAction(state, play(0, 'KC'))).toEqual({ ok: false, error: 'mustPlayForcedRank' });
    state = withHands([['7C', 'KC'], ['9D', 'AC'], ['9C', '4C']]);
    state = apply(state, play(0, '7C'));
    state = apply(state, play(1, '9D'));
    expect(state.forcedRank).toBeNull();
  });

  it('le 2 ferme le pli : celui qui l’a posé relance', () => {
    let state = withHands([['5C', '9C'], ['2C', '3S'], ['4C', 'JC']]);
    state = apply(state, play(0, '5C'));
    state = apply(state, play(1, '2C'));
    expect(state.table).toBeNull();
    expect(state.currentPlayer).toBe(1);
  });
});

describe('fin de manche', () => {
  it('classe les joueurs dans leur ordre de sortie et donne les points', () => {
    let state = withHands([['5C'], ['6C', '3D'], ['7C', '3H']]);
    state = apply(state, play(0, '5C'));
    // Le joueur 0 est sorti : le pli continue sans lui.
    expect(state.finished).toEqual([0]);
    state = apply(state, play(1, '6C'));
    state = apply(state, play(2, '7C'));
    // Le joueur 1 n'a plus personne à suivre derrière le 7 : il passe, le pli revient au joueur 2.
    state = apply(state, pass(1));
    expect(state.currentPlayer).toBe(2);
    state = apply(state, play(2, '3H'));
    expect(state.phase).toBe('roundOver');
    expect(state.lastRound?.order).toEqual([0, 2, 1]);
    expect(state.lastRound?.points).toEqual([2, 0, 1]);
    expect(state.players.map((p) => p.score)).toEqual([2, 0, 1]);
  });

  it('finir sur un 2 envoie au rang de Trou', () => {
    let state = withHands([['2C'], ['6C', '3D'], ['7C', '3H']]);
    state = apply(state, play(0, '2C'));
    expect(state.endedOnTwo).toEqual([0]);
    // Le 2 a fermé le pli, mais le joueur 0 n'a plus de cartes : son voisin ouvre.
    expect(state.currentPlayer).toBe(1);
    state = apply(state, play(1, '6C'));
    state = apply(state, play(2, '7C'));
    state = apply(state, pass(1));
    state = apply(state, play(2, '3H'));
    expect(state.lastRound?.order).toEqual([2, 1, 0]);
    expect(state.lastRound?.endedOnTwo).toEqual([0]);
  });

  it('finit la partie après le nombre de manches choisi, avec le plus de points', () => {
    let state = withHands([['5C'], ['6C', '3D'], ['7C', '3H']], { config: { rounds: 1 } });
    state = apply(state, play(0, '5C'));
    state = apply(state, play(1, '6C'));
    state = apply(state, play(2, '7C'));
    state = apply(state, pass(1));
    state = apply(state, play(2, '3H'));
    expect(state.phase).toBe('gameOver');
    expect(state.winners).toEqual([0]);
  });
});

describe('échange', () => {
  /** Une manche finie à 4 : ordre 2, 0, 3, 1 (le joueur 1 est Trou). */
  function afterRound(): PresidentState {
    const state = createPresident(players(4), 5);
    return {
      ...state,
      phase: 'roundOver',
      lastRound: { order: [2, 0, 3, 1], points: [2, 0, 3, 1], endedOnTwo: [] },
    };
  }

  it('le Trou donne ses 2 meilleures cartes au Président, le Vice-trou sa meilleure au Vice-président', () => {
    const state = apply(afterRound(), { type: 'nextRound' });
    expect(state.round).toBe(2);
    expect(state.phase).toBe('exchange');
    const [president, vice] = state.gifts;
    expect(president).toMatchObject({ from: 2, to: 1, count: 2, given: null });
    expect(vice).toMatchObject({ from: 0, to: 3, count: 1, given: null });
    // Les cartes reçues sont au moins aussi fortes que tout ce qui reste au Trou.
    const trouBest = Math.max(...state.players[1]!.hand.map((c) => c.rank));
    expect(Math.min(...president!.received.map((c) => c.rank))).toBeGreaterThanOrEqual(trouBest);
    expect(state.currentPlayer).toBe(2);
    expect(state.players.reduce((n, p) => n + p.hand.length, 0)).toBe(52);
  });

  it('le Président puis le Vice-président rendent les cartes de leur choix, puis le Trou ouvre', () => {
    let state = apply(afterRound(), { type: 'nextRound' });
    const giveBack = (index: number, count: number) => state.players[index]!.hand.slice(0, count).map((c) => c.id);
    expect(applyPresidentAction(state, { type: 'giveCards', playerIndex: 2, cardIds: giveBack(2, 1) })).toEqual({ ok: false, error: 'wrongCount' });
    expect(applyPresidentAction(state, { type: 'giveCards', playerIndex: 0, cardIds: giveBack(0, 1) })).toEqual({ ok: false, error: 'notYourTurn' });
    const given = giveBack(2, 2);
    state = apply(state, { type: 'giveCards', playerIndex: 2, cardIds: given });
    expect(state.players[1]!.hand.map((c) => c.id)).toEqual(expect.arrayContaining(given));
    expect(state.currentPlayer).toBe(0);
    state = apply(state, { type: 'giveCards', playerIndex: 0, cardIds: giveBack(0, 1) });
    expect(state.phase).toBe('playing');
    expect(state.currentPlayer).toBe(1);
  });

  it("à 3 joueurs, seuls le Président et le Trou échangent", () => {
    const state = createPresident(players(3), 5);
    const next = apply({ ...state, phase: 'roundOver', lastRound: { order: [1, 2, 0], points: [0, 2, 1], endedOnTwo: [] } }, { type: 'nextRound' });
    expect(next.gifts).toHaveLength(1);
    expect(next.gifts[0]).toMatchObject({ from: 1, to: 0, count: 2 });
  });

  it('ne montre les cartes échangées qu’aux deux joueurs concernés', () => {
    const state = apply(afterRound(), { type: 'nextRound' });
    expect(presidentView(state, 2).gifts[0]!.received).toHaveLength(2);
    expect(presidentView(state, 1).gifts[0]!.received).toHaveLength(2);
    expect(presidentView(state, 3).gifts[0]!.received).toBeNull();
    expect(presidentView(state, -1).hand).toEqual([]);
  });
});

describe('titleOf', () => {
  it('nomme les places selon le nombre de joueurs', () => {
    expect([0, 1, 2].map((p) => titleOf(p, 3))).toEqual(['president', 'neutral', 'trou']);
    expect([0, 1, 2, 3].map((p) => titleOf(p, 4))).toEqual(['president', 'vicePresident', 'viceTrou', 'trou']);
    expect([0, 1, 2, 3, 4].map((p) => titleOf(p, 5))).toEqual(['president', 'vicePresident', 'neutral', 'viceTrou', 'trou']);
  });
});

describe('une partie entière', () => {
  it('se termine toujours en jouant la plus petite pose possible, avec des points cohérents', () => {
    let state = createPresident(players(5), 123, { rounds: 3 });
    for (let guard = 0; state.phase !== 'gameOver' && guard < 5000; guard++) {
      if (state.phase === 'roundOver') {
        state = apply(state, { type: 'nextRound' });
        continue;
      }
      const me = state.currentPlayer;
      const hand = state.players[me]!.hand;
      if (state.phase === 'exchange') {
        const gift = state.gifts.find((g) => g.given === null)!;
        state = apply(state, { type: 'giveCards', playerIndex: me, cardIds: hand.slice(0, gift.count).map((c) => c.id) });
        continue;
      }
      const playable = presidentPlayable(hand, state.table, state.forcedRank);
      const count = state.table?.cards.length ?? 1;
      const choice = hand.filter((c) => playable.has(c.id));
      const rank = choice[0]?.rank;
      const cards = choice.filter((c) => c.rank === rank).slice(0, count);
      state = cards.length === count ? apply(state, play(me, ...cards.map((c) => c.id))) : apply(state, pass(me));
    }
    expect(state.phase).toBe('gameOver');
    expect(state.round).toBe(3);
    // 5 joueurs : 4 + 3 + 2 + 1 + 0 = 10 points par manche.
    expect(state.players.reduce((n, p) => n + p.score, 0)).toBe(30);
    expect(state.places.every((p) => p.length === 3)).toBe(true);
  });
});
