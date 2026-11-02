import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  MAX_DEALS_PER_S,
  UPGRADES,
  advance,
  buildingCost,
  buyBuilding,
  buyUpgrade,
  deal,
  dealValue,
  newSave,
  prestige,
  prestigeGoal,
  productionOf,
  viewOf,
} from '../src/tripot';

const croupier = BUILDINGS.find((b) => b.id === 'croupier')!;

describe('le Tripot', () => {
  it('rapporte un jeton par donne au départ, et plafonne les clics selon le temps écoulé', () => {
    const save = newSave(0);
    expect(deal(save, 10, 5)).toBe(10);
    expect(save.chips).toBe(10);
    // 1 000 clics annoncés en 2 secondes : seuls ceux possibles à la main comptent.
    expect(deal(save, 1000, 2)).toBe(3 * MAX_DEALS_PER_S);
    expect(deal(save, -5, 10)).toBe(0);
  });

  it('fait payer chaque activité 15 % de plus que la précédente, et la fait produire', () => {
    const save = newSave(0);
    save.chips = 1000;
    expect(buyBuilding(save, 'croupier')).toBeNull();
    expect(save.chips).toBe(900);
    expect(buildingCost(croupier, 1)).toBe(115);
    expect(productionOf(save)).toBe(1);
    expect(buyBuilding(save, 'inconnu')).toBe('unknownItem');
    save.chips = 10;
    expect(buyBuilding(save, 'croupier')).toBe('tooExpensive');
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
    // La donne vaut plus avec les doigts de croupier, après dix donnes.
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

  it('fait grandir l’établissement : on repart de zéro avec 10 % de plus pour toujours', () => {
    const save = newSave(0);
    save.buildings = { croupier: 10 };
    expect(prestige(save)).toBe('notAvailable');
    save.earned = prestigeGoal(0);
    save.chips = 123;
    expect(prestige(save)).toBeNull();
    expect(save).toMatchObject({ chips: 0, earned: 0, buildings: {}, upgrades: [], prestige: 1 });
    expect(viewOf(save).venue).toBe('Cave enfumée');
    save.buildings = { croupier: 10 };
    expect(productionOf(save)).toBeCloseTo(11);
  });

  it('dévoile les activités au fur et à mesure', () => {
    const save = newSave(0);
    expect(viewOf(save).buildings.filter((b) => b.unlocked).map((b) => b.id)).toEqual([]);
    save.earned = 60;
    expect(viewOf(save).buildings.filter((b) => b.unlocked).map((b) => b.id)).toEqual(['donneur', 'croupier']);
  });
});
