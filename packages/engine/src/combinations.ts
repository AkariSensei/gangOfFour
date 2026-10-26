import { type Card, type Color, COLOR_RANK, PHOENIX_VALUE, compareCards, isSpecial } from './cards';

export type CombinationType =
  | 'single'
  | 'pair'
  | 'trio'
  | 'straight'
  | 'flush'
  | 'fullHouse'
  | 'straightFlush'
  | 'gang';

export interface Combination {
  type: CombinationType;
  cards: Card[];
  /** Clés de comparaison, lues dans l'ordre (ordre lexicographique). */
  rank: number[];
}

/** Hiérarchie des combinaisons de cinq cartes. */
const FIVE_CARD_ORDER: Partial<Record<CombinationType, number>> = {
  straight: 1,
  flush: 2,
  fullHouse: 3,
  straightFlush: 4,
};

function maxColor(cards: Card[]): number {
  return Math.max(...cards.map((c) => COLOR_RANK[c.color]));
}

function allSameValue(cards: Card[]): boolean {
  return cards.every((c) => c.value === cards[0]!.value);
}

/** Couleur commune des cartes, le 1 multicolore servant de joker de couleur. */
function commonColor(cards: Card[]): Color | null {
  const colors = new Set(cards.filter((c) => c.color !== 'multi').map((c) => c.color));
  if (colors.size > 1) return null;
  return colors.values().next().value ?? 'multi';
}

function isConsecutive(values: number[]): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.every((v, i) => i === 0 || v === sorted[i - 1]! + 1);
}

/** Reconnaît la combinaison formée par des cartes, ou renvoie null si elle est invalide. */
export function analyzeCombination(cards: Card[]): Combination | null {
  const n = cards.length;
  if (n === 0) return null;

  if (n === 1) {
    const [card] = cards as [Card];
    return { type: 'single', cards, rank: [card.value, COLOR_RANK[card.color]] };
  }

  if (allSameValue(cards)) {
    const value = cards[0]!.value;
    if (n === 2 && (value <= 10 || value === PHOENIX_VALUE)) {
      return { type: 'pair', cards, rank: [value, maxColor(cards)] };
    }
    if (value > 10) return null;
    if (n === 3) return { type: 'trio', cards, rank: [value, maxColor(cards)] };
    if (n >= 4) return { type: 'gang', cards, rank: [n, value] };
  }

  if (n !== 5) return null;

  // Les phénix ne peuvent entrer dans une combinaison de cinq cartes que comme paire d'un full.
  const specials = cards.filter(isSpecial);
  if (specials.length > 0) {
    const numbers = cards.filter((c) => !isSpecial(c));
    const phoenixPair = specials.length === 2 && specials.every((c) => c.value === PHOENIX_VALUE);
    if (!phoenixPair || !allSameValue(numbers)) return null;
    return { type: 'fullHouse', cards, rank: [numbers[0]!.value, maxColor(numbers)] };
  }

  const values = cards.map((c) => c.value);
  const color = commonColor(cards);
  const distinct = new Set(values).size === 5;
  const straight = distinct && isConsecutive(values);
  const sortedDesc = [...cards].sort((a, b) => b.value - a.value || COLOR_RANK[b.color] - COLOR_RANK[a.color]);
  const top = sortedDesc[0]!;

  if (straight && color) {
    return { type: 'straightFlush', cards, rank: [top.value, COLOR_RANK[color]] };
  }

  const counts = new Map<number, Card[]>();
  for (const c of cards) counts.set(c.value, [...(counts.get(c.value) ?? []), c]);
  const groups = [...counts.values()].sort((a, b) => b.length - a.length);
  if (groups.length === 2 && groups[0]!.length === 3) {
    const trio = groups[0]!;
    return { type: 'fullHouse', cards, rank: [trio[0]!.value, maxColor(trio)] };
  }

  if (color) {
    return { type: 'flush', cards, rank: [...sortedDesc.map((c) => c.value), COLOR_RANK[color]] };
  }

  if (straight) {
    return { type: 'straight', cards, rank: [top.value, COLOR_RANK[top.color]] };
  }

  return null;
}

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Indique si `play` peut être posée par-dessus `current` (null quand on ouvre un pli). */
export function canBeat(play: Combination, current: Combination | null): boolean {
  if (!current) return true;

  if (play.type === 'gang') {
    return current.type !== 'gang' || compareRanks(play.rank, current.rank) > 0;
  }
  if (current.type === 'gang') return false;
  if (play.cards.length !== current.cards.length) return false;

  if (play.cards.length === 5) {
    const diff = FIVE_CARD_ORDER[play.type]! - FIVE_CARD_ORDER[current.type]!;
    if (diff !== 0) return diff > 0;
  } else if (play.type !== current.type) {
    return false;
  }
  return compareRanks(play.rank, current.rank) > 0;
}

function* subsets<T>(items: T[], size: number, start = 0, picked: T[] = []): Generator<T[]> {
  if (picked.length === size) {
    yield picked;
    return;
  }
  for (let i = start; i <= items.length - (size - picked.length); i++) {
    yield* subsets(items, size, i + 1, [...picked, items[i]!]);
  }
}

/** Indique si la main permet de poser autre chose qu'une carte seule (paire, brelan, cinq cartes ou gang). */
export function hasMultiCardCombination(hand: Card[]): boolean {
  // Brelans, gangs et fulls contiennent tous une paire : il suffit de chercher les paires et les cinq cartes.
  for (const pair of subsets(hand, 2)) if (analyzeCombination(pair)) return true;
  for (const five of subsets(hand, 5)) if (analyzeCombination(five)) return true;
  return false;
}

/**
 * Cartes de la main qui entrent dans au moins une combinaison capable de battre la table (toutes si on ouvre).
 * Avec `onlyHighestSingle` (règle « Carte ! »), seule la plus forte carte compte parmi les cartes seules.
 */
export function playableCards(hand: Card[], current: Combination | null, onlyHighestSingle = false): Set<string> {
  if (!current) return new Set(hand.map((c) => c.id));
  const playable = new Set<string>();
  const consider = (cards: Card[]) => {
    const combination = analyzeCombination(cards);
    if (combination && canBeat(combination, current)) cards.forEach((c) => playable.add(c.id));
  };

  if (current.type !== 'gang') {
    const size = current.cards.length;
    if (size === 1 && onlyHighestSingle) {
      const best = hand.reduce<Card | null>((b, c) => (!b || compareCards(c, b) > 0 ? c : b), null);
      if (best) consider([best]);
    } else {
      for (const cards of subsets(hand, size)) consider(cards);
    }
  }
  // Un gang (4 cartes ou plus de même valeur) peut battre n'importe quoi.
  const byValue = new Map<number, Card[]>();
  for (const card of hand) byValue.set(card.value, [...(byValue.get(card.value) ?? []), card]);
  for (const group of byValue.values()) {
    for (let size = 4; size <= group.length; size++) consider(group.slice(0, size));
  }
  return playable;
}
