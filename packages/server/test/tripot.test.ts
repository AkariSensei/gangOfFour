import type { Card } from '@gof/engine';
import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  FRENZY_FACTOR,
  HAND_SIZE,
  MAX_DEALS_PER_S,
  REPUTATION_UNIT,
  UPGRADES,
  advance,
  affordable,
  bestHand,
  buildingCost,
  bulkCost,
  buyBuilding,
  buyUpgrade,
  catchEvent,
  checkAchievements,
  deal,
  dealValue,
  handOf,
  markDay,
  newSave,
  prestige,
  productionOf,
  rentOf,
  rentXp,
  reputationFor,
  venueLevel,
  venueName,
  viewOf,
} from '../src/tripot';

const croupier = BUILDINGS.find((b) => b.id === 'croupier')!;
const card = (value: number, color: Card['color'] = 'green', copy = 'a'): Card => ({ id: `${color[0]}${value}${copy}`, value, color });

describe('le Tripot', () => {
  it('rapporte un jeton par carte au départ, et plafonne les clics selon le temps écoulé', () => {
    const save = newSave(0, 1);
    deal(save, 4, 5);
    expect(save.chips).toBe(4);
    // 1 000 clics annoncés en 2 secondes : seuls ceux possibles à la main comptent.
    deal(save, 1000, 2);
    expect(save.deals).toBe(4 + 3 * MAX_DEALS_PER_S);
    deal(save, -5, 10);
    expect(save.deals).toBe(4 + 3 * MAX_DEALS_PER_S);
  });

  it('reconnaît la meilleure combinaison d’une main, selon les règles du jeu', () => {
    expect(bestHand([card(7), card(7, 'red'), card(7, 'yellow'), card(7, 'green', 'b'), card(2)])).toBe('gang');
    expect(bestHand([card(3), card(4), card(5), card(6), card(7)])).toBe('straightFlush');
    expect(bestHand([card(9), card(9, 'red'), card(9, 'yellow'), card(2), card(2, 'red')])).toBe('fullHouse');
    expect(bestHand([card(9), card(9, 'red'), card(9, 'yellow'), card(11), card(11, 'yellow')])).toBe('fullHouse');
    expect(bestHand([card(1), card(4), card(6), card(8), card(10)])).toBe('flush');
    expect(bestHand([card(3), card(4, 'red'), card(5), card(6), card(7)])).toBe('straight');
    expect(bestHand([card(3), card(3, 'red'), card(3, 'yellow'), card(6), card(12, 'red')])).toBe('trio');
    // Les phénix forment une paire, mais n'entrent pas dans une suite.
    expect(bestHand([card(11), card(11, 'yellow'), card(2), card(5, 'red'), card(8)])).toBe('pair');
    expect(bestHand([card(7), card(8, 'red'), card(9), card(10), card(11)])).toBeNull();
  });

  it('distribue toujours les mêmes mains pour une même partie, et paie les combinaisons', () => {
    expect(handOf(42, 3)).toEqual(handOf(42, 3));
    expect(handOf(42, 3)).not.toEqual(handOf(42, 4));
    // Une graine dont la première main forme une combinaison.
    const seed = [...Array(200).keys()].find((s) => bestHand(handOf(s, 0)) !== null)!;
    const save = newSave(0, seed);
    const [hand] = deal(save, HAND_SIZE, 1);
    expect(hand).toMatchObject({ index: 0, type: bestHand(handOf(seed, 0)) });
    expect(hand!.gain).toBeGreaterThan(0);
    expect(save.chips).toBe(HAND_SIZE + hand!.gain);
    expect(save.hands[hand!.type!]).toBe(1);
  });

  it('fait payer chaque activité 15 % de plus que la précédente, à l’unité ou par lots', () => {
    const save = newSave(0);
    save.chips = 1000;
    expect(buyBuilding(save, 'croupier')).toBeNull();
    expect(save.chips).toBe(1000 - croupier.cost);
    expect(buildingCost(croupier, 1)).toBe(Math.ceil(croupier.cost * 1.15));
    expect(productionOf(save)).toBe(1);
    expect(buyBuilding(save, 'inconnu')).toBe('unknownItem');
    save.chips = 10;
    expect(buyBuilding(save, 'croupier')).toBe('tooExpensive');
    // Dix d'un coup, puis autant que possible.
    save.chips = bulkCost(croupier, 1, 10);
    expect(buyBuilding(save, 'croupier', 10)).toBeNull();
    expect(save.buildings.croupier).toBe(11);
    save.chips = 1e5;
    const n = affordable(croupier, 11, 1e5);
    expect(buyBuilding(save, 'croupier', 'max')).toBeNull();
    expect(save.buildings.croupier).toBe(11 + n);
    expect(save.chips).toBeLessThan(buildingCost(croupier, 11 + n));
  });

  it('propose les améliorations selon ce qu’on possède, et elles doublent la production', () => {
    const save = newSave(0);
    save.chips = 10_000;
    const pair = UPGRADES.find((u) => u.id === 'croupier-paire')!;
    expect(pair.name).toBe('Paire de croupiers');
    expect(buyUpgrade(save, pair.id)).toBe('notAvailable');
    buyBuilding(save, 'croupier');
    expect(buyUpgrade(save, pair.id)).toBeNull();
    expect(productionOf(save)).toBe(2);
    expect(buyUpgrade(save, pair.id)).toBe('notAvailable');
    // La carte vaut plus avec les doigts de croupier, après dix cartes.
    save.deals = 10;
    expect(buyUpgrade(save, 'doigts')).toBeNull();
    expect(dealValue(save)).toBe(2);
  });

  it('produit plein pot pendant le jeu, à moitié pendant une absence, et 8 heures au plus', () => {
    const save = newSave(0);
    save.buildings = { croupier: 10 };
    expect(advance(save, 60_000)).toBe(0);
    expect(save.chips).toBe(600);
    // Une nuit de 12 h : deux minutes pleines, puis 8 h à moitié.
    const away = advance(save, 60_000 + 12 * 3600_000);
    expect(away).toBe(8 * 3600 * 10 * 0.5);
    expect(save.chips).toBe(600 + 120 * 10 + away);
  });

  it('laisse attraper le Dragon ou le Phénix quand il passe, et pas en dehors', () => {
    const save = newSave(0);
    save.buildings = { croupier: 10 };
    expect(catchEvent(save, 1000)).toBe('notAvailable');
    const at = save.nextEventAt;
    // Le Dragon : frénésie d'une minute.
    expect(catchEvent(save, at, () => 0.1)).toEqual({ kind: 'frenzy', until: at + 60_000 });
    expect(save.caught).toBe(1);
    expect(save.nextEventAt).toBeGreaterThan(at);
    save.updatedAt = at;
    save.chips = 0;
    advance(save, at + 10_000);
    expect(save.chips).toBeCloseTo(10 * 10 * FRENZY_FACTOR);
    // Le Phénix : un butin.
    const before = save.chips;
    const loot = catchEvent(save, save.nextEventAt, () => 0.9);
    expect(loot).toMatchObject({ kind: 'loot' });
    expect(save.chips).toBeGreaterThan(before);
  });

  it('fait grandir l’établissement : on repart de zéro avec la réputation méritée', () => {
    const save = newSave(0);
    save.buildings = { croupier: 10 };
    expect(prestige(save)).toBe('notAvailable');
    save.earnedAll = 8 * REPUTATION_UNIT;
    save.earned = save.earnedAll;
    save.chips = 123;
    save.achievements = ['donnes-100'];
    expect(reputationFor(save.earnedAll)).toBe(2);
    expect(prestige(save)).toBeNull();
    expect(save).toMatchObject({ chips: 0, earned: 0, buildings: {}, upgrades: [], reputation: 2, achievements: ['donnes-100'] });
    expect(viewOf(save, 0).venue).toBe('Cave enfumée');
    // +2 % par point de réputation, +1 % par succès.
    save.buildings = { croupier: 100 };
    expect(productionOf(save)).toBeCloseTo(100 * 1.04 * 1.01);
    // Rien de plus à encaisser tant qu'on n'a pas gagné davantage.
    expect(prestige(save)).toBe('notAvailable');
  });

  it('compte les établissements jusqu’au Palace, puis en étoiles, et la rente qui va avec', () => {
    expect([0, 1, 9, 10, 100, 1_000, 10_000, 40_000, 160_000].map(venueLevel)).toEqual([0, 1, 1, 2, 3, 4, 5, 6, 7]);
    expect(venueName(7)).toBe('Palace ★★');
    expect([0, 1, 3, 5, 6, 9].map(rentXp)).toEqual([0, 10, 30, 50, 60, 60]);
    const save = newSave(0);
    markDay(save, '2026-11-01');
    save.reputation = 10;
    markDay(save, '2026-11-02');
    markDay(save, '2026-11-02');
    expect(rentOf(save)).toBe(0 + 20);
  });

  it('gagne des succès une fois pour toutes', () => {
    const save = newSave(0);
    save.deals = 150;
    expect(checkAchievements(save)).toEqual(['donnes-100']);
    expect(checkAchievements(save)).toEqual([]);
    expect(viewOf(save, 0).achievements.find((a) => a.id === 'donnes-100')).toMatchObject({ done: true });
  });
});
