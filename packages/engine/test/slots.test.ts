import { describe, expect, it } from 'vitest';
import { SLOTS_GOAL, type SlotsState, applySlotsAction, createSlots, payoutOf, slotsView, stakeOf } from '../src';

const players = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bruno' },
];

function spin(state: SlotsState): SlotsState {
  const result = applySlotsAction(state, { type: 'spin', playerIndex: state.currentPlayer });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('duel de machines à sous', () => {
  it('donne 100 € à chacun, et fait tirer l’hôte en premier', () => {
    const state = createSlots(players, 1);
    expect(state.players.map((p) => p.balance)).toEqual([100, 100]);
    expect(state.currentPlayer).toBe(0);
    expect(applySlotsAction(state, { type: 'spin', playerIndex: 1 })).toEqual({ ok: false, error: 'notYourTurn' });
    expect(() => createSlots(players.slice(0, 1), 1)).toThrow();
  });

  it('fait monter la mise de 5 € tous les trois tours', () => {
    expect([1, 2, 3, 4, 6, 7, 10].map(stakeOf)).toEqual([5, 5, 5, 10, 10, 15, 20]);
  });

  it('paie trois symboles, deux symboles, ou rien', () => {
    expect(payoutOf(['seven', 'seven', 'seven'])).toBe(200);
    expect(payoutOf(['cherry', 'cherry', 'cherry'])).toBe(4);
    expect(payoutOf(['bell', 'lemon', 'bell'])).toBe(1.5);
    expect(payoutOf(['bell', 'lemon', 'grape'])).toBe(0);
  });

  it('retire la mise, ajoute le gain, et passe la main à l’autre puis au tour suivant', () => {
    let state = createSlots(players, 7);
    state = spin(state);
    const [first] = state.spins;
    expect(first).toMatchObject({ playerIndex: 0, round: 1, stake: 5 });
    expect(first!.win).toBe(Math.round(5 * payoutOf(first!.reels)));
    expect(state.players[0]!.balance).toBe(100 - 5 + first!.win);
    expect(state.currentPlayer).toBe(1);
    state = spin(state);
    expect(state.round).toBe(2);
    expect(state.currentPlayer).toBe(0);
  });

  it('rejoue la même partie avec la même graine', () => {
    const play = (seed: number) => {
      let state = createSlots(players, seed);
      for (let i = 0; i < 10; i++) state = spin(state);
      return state.spins.map((s) => s.reels.join());
    };
    expect(play(42)).toEqual(play(42));
    expect(play(42)).not.toEqual(play(43));
  });

  it('attend la fin du tour pour désigner le plus riche, quand l’un est à sec ou l’autre à 300 €', () => {
    let state = createSlots(players, 3);
    state.players[0]!.balance = 400;
    state = spin(state);
    // L'objectif est atteint, mais Bruno tire encore ce tour-ci.
    expect(state.phase).toBe('playing');
    state = spin(state);
    expect(state.phase).toBe('gameOver');
    expect(state.winners).toEqual([0]);
  });

  it('se termine toujours, et chacun gagne à peu près une fois sur deux', () => {
    let wins = 0;
    for (let seed = 1; seed <= 300; seed++) {
      let state = createSlots(players, seed);
      while (state.phase === 'playing') state = spin(state);
      expect(state.round).toBeLessThan(100);
      const balances = state.players.map((p) => p.balance);
      expect(balances.some((b) => b <= 0 || b >= SLOTS_GOAL)).toBe(true);
      if (state.winners.includes(0)) wins++;
    }
    expect(wins).toBeGreaterThan(110);
    expect(wins).toBeLessThan(190);
  });

  it('montre la mise du tour et celle du suivant', () => {
    const view = slotsView(createSlots(players, 1), 1);
    expect(view).toMatchObject({ game: 'slots', you: 1, round: 1, stake: 5, nextStake: 5, goal: 300 });
  });
});
