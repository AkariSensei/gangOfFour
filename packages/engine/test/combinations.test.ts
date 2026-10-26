import { describe, expect, it } from 'vitest';
import { analyzeCombination, canBeat, playableCards } from '../src';
import { cards } from './helpers';

const combo = (...codes: string[]) => {
  const c = analyzeCombination(cards(...codes));
  if (!c) throw new Error(`combinaison invalide : ${codes.join(' ')}`);
  return c;
};

describe('analyzeCombination', () => {
  it.each([
    [['g5'], 'single'],
    [['rD'], 'single'],
    [['g5', 'r5'], 'pair'],
    [['gP', 'yP'], 'pair'],
    [['g5', 'r5', 'y5'], 'trio'],
    [['g1', 'y2', 'r3', 'g4', 'g5'], 'straight'],
    [['g1', 'g3', 'g5', 'g7', 'g9'], 'flush'],
    [['m1', 'r3', 'r5', 'r7', 'r9'], 'flush'],
    [['g5', 'r5', 'y5', 'g2', 'r2'], 'fullHouse'],
    [['g5', 'r5', 'y5', 'gP', 'yP'], 'fullHouse'],
    [['y6', 'y7', 'y8', 'y9', 'y10'], 'straightFlush'],
    [['m1', 'r2', 'r3', 'r4', 'r5'], 'straightFlush'],
    [['g5', 'r5', 'y5', 'g5'], 'gang'],
    [['g1', 'r1', 'y1', 'g1', 'r1', 'y1', 'm1'], 'gang'],
  ])('%j est un(e) %s', (codes, type) => {
    expect(analyzeCombination(cards(...codes))?.type).toBe(type);
  });

  it.each([
    [['g5', 'r6']],
    [['gP', 'rD']],
    [['g5', 'r5', 'y5', 'g6']],
    [['g7', 'y8', 'r9', 'g10', 'gP']],
    [['g5', 'r5', 'y5', 'gP', 'rD']],
    [['gP', 'yP', 'g5', 'r5', 'y6']],
    [['g9', 'y10', 'r1', 'g2', 'g3']],
    [['g1', 'y2', 'r3', 'g4', 'g5', 'g6']],
    [['g2', 'r2', 'y3', 'r3', 'g4']],
  ])('%j est invalide', (codes) => {
    expect(analyzeCombination(cards(...codes))).toBeNull();
  });
});

describe('canBeat', () => {
  it('compare les cartes seules par valeur puis par couleur', () => {
    expect(canBeat(combo('g6'), combo('r5'))).toBe(true);
    expect(canBeat(combo('r5'), combo('g5'))).toBe(true);
    expect(canBeat(combo('g5'), combo('r5'))).toBe(false);
    expect(canBeat(combo('g5'), combo('g5'))).toBe(false);
    expect(canBeat(combo('rD'), combo('yP'))).toBe(true);
    expect(canBeat(combo('yP'), combo('gP'))).toBe(true);
    expect(canBeat(combo('m1'), combo('r1'))).toBe(true);
    expect(canBeat(combo('r2'), combo('m1'))).toBe(true);
  });

  it('classe un full par son brelan, même avec la paire de phénix', () => {
    expect(canBeat(combo('g6', 'r6', 'y6', 'g2', 'r2'), combo('g5', 'r5', 'y5', 'gP', 'yP'))).toBe(true);
    expect(canBeat(combo('g5', 'r5', 'y5', 'gP', 'yP'), combo('g6', 'r6', 'y6', 'g2', 'r2'))).toBe(false);
  });

  it('impose le même nombre de cartes', () => {
    expect(canBeat(combo('g9', 'r9'), combo('g2'))).toBe(false);
    expect(canBeat(combo('g9'), combo('g2', 'r2'))).toBe(false);
  });

  it('départage les paires par la couleur la plus forte', () => {
    expect(canBeat(combo('g5', 'r5'), combo('g5', 'y5'))).toBe(true);
    expect(canBeat(combo('gP', 'yP'), combo('r10', 'y10'))).toBe(true);
  });

  it('à couleur la plus forte égale, départage par la couleur suivante', () => {
    // Le cas signalé en partie : 10 rouge + jaune sur 10 vert + rouge.
    expect(canBeat(combo('r10', 'y10'), combo('g10', 'r10'))).toBe(true);
    expect(canBeat(combo('g10', 'r10'), combo('r10', 'y10'))).toBe(false);
    expect(canBeat(combo('r4', 'y4', 'y4'), combo('r4', 'y4', 'g4'))).toBe(true);
    expect(canBeat(combo('r4', 'r4', 'g4'), combo('r4', 'y4', 'y4'))).toBe(true);
    // Mêmes valeurs et mêmes couleurs : ce n'est pas plus fort.
    expect(canBeat(combo('g10', 'r10'), combo('r10', 'g10'))).toBe(false);
  });

  it('départage les suites de même hauteur par la couleur de la plus haute carte, puis des suivantes', () => {
    expect(canBeat(combo('g3', 'g4', 'y5', 'g6', 'r7'), combo('r3', 'r4', 'r5', 'r6', 'y7'))).toBe(true);
    expect(canBeat(combo('g3', 'g4', 'g5', 'y6', 'r7'), combo('r3', 'r4', 'r5', 'g6', 'r7'))).toBe(true);
    expect(canBeat(combo('r3', 'r4', 'r5', 'g6', 'r7'), combo('g3', 'g4', 'g5', 'y6', 'r7'))).toBe(false);
  });

  it('suit la hiérarchie des combinaisons de cinq cartes', () => {
    const straight = combo('g6', 'y7', 'r8', 'g9', 'g10');
    const flush = combo('g1', 'g3', 'g5', 'g7', 'g9');
    const fullHouse = combo('g2', 'r2', 'y2', 'g3', 'r3');
    const straightFlush = combo('y1', 'y2', 'y3', 'y4', 'y5');
    expect(canBeat(flush, straight)).toBe(true);
    expect(canBeat(fullHouse, flush)).toBe(true);
    expect(canBeat(straightFlush, fullHouse)).toBe(true);
    expect(canBeat(straight, flush)).toBe(false);
    expect(canBeat(combo('g2', 'y3', 'r4', 'g5', 'g6'), combo('g1', 'y2', 'r3', 'g4', 'y5'))).toBe(true);
    expect(canBeat(combo('g1', 'y2', 'r3', 'g4', 'r5'), combo('g1', 'y2', 'r3', 'g4', 'y5'))).toBe(true);
  });

  it('laisse un gang battre tout le reste, et un gang plus grand battre un plus petit', () => {
    const gang4 = combo('g2', 'r2', 'y2', 'g2');
    const gang4High = combo('g9', 'r9', 'y9', 'g9');
    const gang5 = combo('g3', 'r3', 'y3', 'g3', 'r3');
    expect(canBeat(gang4, combo('rD'))).toBe(true);
    expect(canBeat(gang4, combo('y6', 'y7', 'y8', 'y9', 'y10'))).toBe(true);
    expect(canBeat(gang4High, gang4)).toBe(true);
    expect(canBeat(gang5, gang4High)).toBe(true);
    expect(canBeat(gang4High, gang5)).toBe(false);
    expect(canBeat(combo('rD'), gang4)).toBe(false);
  });
});

describe('playableCards', () => {
  it('retient les cartes qui entrent dans une combinaison capable de battre la table', () => {
    const hand = cards('g3', 'y3', 'r5', 'g9', 'y9');
    const pair = analyzeCombination(cards('r4', 'g4'))!;
    const ids = (set: Set<string>) => hand.filter((c) => set.has(c.id)).map((c) => c.id);
    expect(ids(playableCards(hand, pair))).toEqual(['g9-3', 'y9-4']);
    expect(playableCards(hand, null).size).toBe(5);
  });

  it('compte les gangs, qui battent tout', () => {
    const hand = cards('g6', 'y6', 'r6', 'g6', 'r2');
    const flush = analyzeCombination(cards('r1', 'r3', 'r5', 'r7', 'r9'))!;
    expect(playableCards(hand, flush).size).toBe(4);
  });

  it('ne garde que la plus forte carte seule quand la règle « Carte ! » l’impose', () => {
    const hand = cards('g3', 'r8', 'y5');
    const single = analyzeCombination(cards('g2'))!;
    expect([...playableCards(hand, single, true)]).toEqual(['r8-1']);
  });
});
