import { describe, expect, it } from 'vitest';
import {
  type BattleshipState,
  type Ship,
  applyBattleshipAction,
  battleshipBotShot,
  battleshipToAct,
  battleshipView,
  createBattleship,
  createRng,
  randomFleet,
  shipAt,
  validFleet,
} from '../src';

const players = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bruno' },
];

/** Une flotte rangée en lignes espacées : porte-avions en A, croiseur en C, etc. */
const rows = (): Ship[] => [shipAt(0, 5, false)!, shipAt(20, 4, false)!, shipAt(40, 3, false)!, shipAt(60, 3, false)!, shipAt(80, 2, false)!];

function apply(state: BattleshipState, action: Parameters<typeof applyBattleshipAction>[1]): BattleshipState {
  const result = applyBattleshipAction(state, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function placed(): BattleshipState {
  let state = createBattleship(players, 1);
  state = apply(state, { type: 'place', playerIndex: 0, ships: rows() });
  return apply(state, { type: 'place', playerIndex: 1, ships: rows() });
}

describe('bataille navale', () => {
  it('vérifie la flotte : bonnes tailles, droite, sans chevauchement ni contact', () => {
    expect(validFleet(rows())).toBe(true);
    // Deux bateaux qui se touchent par un côté, puis par un coin.
    expect(validFleet([shipAt(0, 5, false)!, shipAt(10, 4, false)!, shipAt(40, 3, false)!, shipAt(60, 3, false)!, shipAt(80, 2, false)!])).toBe(false);
    expect(validFleet([shipAt(0, 5, false)!, shipAt(15, 4, false)!, shipAt(40, 3, false)!, shipAt(60, 3, false)!, shipAt(80, 2, false)!])).toBe(false);
    // Un bateau en trop court, un bateau tordu, un bateau qui passe d'une ligne à l'autre.
    expect(validFleet([...rows().slice(0, 4), { cells: [80] }])).toBe(false);
    expect(validFleet([...rows().slice(0, 4), { cells: [80, 91] }])).toBe(false);
    expect(validFleet([{ cells: [7, 8, 9, 10, 11] }, ...rows().slice(1)])).toBe(false);
    expect(shipAt(8, 3, false)).toBeNull();
    expect(shipAt(85, 3, true)).toBeNull();
  });

  it('place une flotte au hasard toujours réglementaire', () => {
    const random = createRng(5);
    for (let i = 0; i < 50; i++) expect(validFleet(randomFleet(random))).toBe(true);
  });

  it('attend que les deux flottes soient placées pour commencer, chacun une seule fois', () => {
    let state = createBattleship(players, 1);
    expect(battleshipToAct(state)).toBe(0);
    expect(applyBattleshipAction(state, { type: 'shoot', playerIndex: 0, cell: 0 })).toEqual({ ok: false, error: 'wrongPhase' });
    expect(applyBattleshipAction(state, { type: 'place', playerIndex: 0, ships: rows().slice(1) })).toEqual({ ok: false, error: 'invalidFleet' });
    state = apply(state, { type: 'place', playerIndex: 1, ships: rows() });
    expect(applyBattleshipAction(state, { type: 'place', playerIndex: 1, ships: rows() })).toEqual({ ok: false, error: 'alreadyPlaced' });
    expect(state.phase).toBe('placing');
    expect(battleshipToAct(state)).toBe(0);
    state = apply(state, { type: 'place', playerIndex: 0, ships: rows() });
    expect(state.phase).toBe('playing');
    expect(battleshipToAct(state)).toBe(0);
  });

  it('annonce à l’eau, touché, puis touché-coulé, et passe la main à chaque tir', () => {
    let state = placed();
    state = apply(state, { type: 'shoot', playerIndex: 0, cell: 9 });
    expect(state.lastShot).toMatchObject({ playerIndex: 0, cell: 9, result: 'miss' });
    expect(state.currentPlayer).toBe(1);
    expect(applyBattleshipAction(state, { type: 'shoot', playerIndex: 0, cell: 80 })).toEqual({ ok: false, error: 'notYourTurn' });
    state = apply(state, { type: 'shoot', playerIndex: 1, cell: 99 });
    state = apply(state, { type: 'shoot', playerIndex: 0, cell: 80 });
    expect(state.lastShot?.result).toBe('hit');
    state = apply(state, { type: 'shoot', playerIndex: 1, cell: 98 });
    expect(applyBattleshipAction(state, { type: 'shoot', playerIndex: 0, cell: 80 })).toEqual({ ok: false, error: 'alreadyShot' });
    state = apply(state, { type: 'shoot', playerIndex: 0, cell: 81 });
    expect(state.lastShot).toMatchObject({ result: 'sunk', ship: 4 });
    // Le torpilleur coulé se voit chez l'adversaire ; le reste de la flotte reste caché.
    const view = battleshipView(state, 0);
    expect(view.revealed[1]).toEqual([{ cells: [80, 81], kind: 4 }]);
    expect(view.players[1]!.afloat).toBe(4);
    expect(view.myShips).toEqual(rows());
    expect(JSON.stringify(battleshipView(state, 0).revealed[1])).not.toContain('[0,1,2,3,4]');
  });

  it('donne la victoire à qui coule toute la flotte adverse', () => {
    let state = placed();
    const targets = rows().flatMap((s) => s.cells);
    const misses = [9, 19, 29, 39, 49, 59, 69, 79, 89, 99, 8, 18, 28, 38, 48, 58, 68];
    for (const [i, cell] of targets.entries()) {
      state = apply(state, { type: 'shoot', playerIndex: 0, cell });
      if (state.phase === 'gameOver') break;
      state = apply(state, { type: 'shoot', playerIndex: 1, cell: misses[i]! });
    }
    expect(state.phase).toBe('gameOver');
    expect(state.winners).toEqual([0]);
    expect(battleshipView(state, 1).revealed[0]).toHaveLength(5);
  });

  it('fait jouer le bot sans jamais tirer deux fois au même endroit, et il finit par gagner', () => {
    let state = createBattleship(players, 9);
    const random = createRng(9);
    state = apply(state, { type: 'place', playerIndex: 0, ships: randomFleet(random) });
    state = apply(state, { type: 'place', playerIndex: 1, ships: randomFleet(random) });
    let shots = 0;
    while (state.phase === 'playing') {
      const me = state.currentPlayer;
      state = apply(state, { type: 'shoot', playerIndex: me, cell: battleshipBotShot(state, me, random) });
      shots++;
      expect(shots).toBeLessThanOrEqual(200);
    }
    expect(state.winners).toHaveLength(1);
    // Un bot qui achève ses touches gagne bien avant d'avoir tiré partout.
    expect(state.players[state.winners[0]!]!.shots.length).toBeLessThan(80);
  });
});
