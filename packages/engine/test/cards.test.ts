import { describe, expect, it } from 'vitest';
import { createDeck } from '../src';

describe('createDeck', () => {
  it('contient les 64 cartes avec des identifiants uniques', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(64);
    expect(new Set(deck.map((c) => c.id)).size).toBe(64);
  });

  it('contient six cartes de chaque valeur de 2 à 10 et sept 1', () => {
    const deck = createDeck();
    for (let v = 2; v <= 10; v++) expect(deck.filter((c) => c.value === v)).toHaveLength(6);
    expect(deck.filter((c) => c.value === 1)).toHaveLength(7);
  });
});
