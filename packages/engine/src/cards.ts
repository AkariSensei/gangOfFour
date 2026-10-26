export type Color = 'green' | 'yellow' | 'red' | 'multi';

export interface Card {
  id: string;
  /** 1 à 10 pour les cartes numérotées, 11 pour les phénix, 12 pour le dragon. */
  value: number;
  color: Color;
}

export const PHOENIX_VALUE = 11;
export const DRAGON_VALUE = 12;

/** Ordre des couleurs pour départager deux cartes de même valeur. */
export const COLOR_RANK: Record<Color, number> = { multi: 0, green: 1, yellow: 2, red: 3 };

const NUMBER_COLORS: Color[] = ['green', 'yellow', 'red'];

/** Les 64 cartes du jeu : 1 à 10 en double dans chaque couleur, le 1 multicolore, deux phénix et le dragon. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const color of NUMBER_COLORS) {
    for (let value = 1; value <= 10; value++) {
      for (const copy of ['a', 'b']) {
        deck.push({ id: `${color[0]}${value}${copy}`, value, color });
      }
    }
  }
  deck.push({ id: 'm1', value: 1, color: 'multi' });
  deck.push({ id: 'gP', value: PHOENIX_VALUE, color: 'green' });
  deck.push({ id: 'yP', value: PHOENIX_VALUE, color: 'yellow' });
  deck.push({ id: 'rD', value: DRAGON_VALUE, color: 'red' });
  return deck;
}

export const MULTI_ONE_ID = 'm1';

export function isSpecial(card: Card): boolean {
  return card.value > 10;
}

/** Force d'une carte jouée seule : la valeur d'abord, puis la couleur. */
export function compareCards(a: Card, b: Card): number {
  return a.value - b.value || COLOR_RANK[a.color] - COLOR_RANK[b.color];
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort(compareCards);
}

export function highestCard(cards: Card[]): Card | undefined {
  return cards.reduce<Card | undefined>((best, c) => (!best || compareCards(c, best) > 0 ? c : best), undefined);
}
