import { describe, expect, it } from 'vitest';
import { penaltyForCards } from '../src';

describe('penaltyForCards', () => {
  it.each([
    [0, 0],
    [1, 1],
    [7, 7],
    [8, 16],
    [10, 20],
    [11, 33],
    [13, 39],
    [14, 56],
    [15, 60],
    [16, 80],
  ])('%i cartes restantes valent %i points', (cardsLeft, points) => {
    expect(penaltyForCards(cardsLeft)).toBe(points);
  });
});
