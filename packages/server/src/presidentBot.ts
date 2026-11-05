import { type PlayingCard, type PresidentAction, type PresidentState, TWO_RANK, presidentPlayable } from '@gof/engine';
import type { BotLevel } from './bot';

/** Les cartes de la main rangées par valeur, de la plus faible à la plus forte. */
function groups(hand: PlayingCard[]): PlayingCard[][] {
  const byRank = new Map<number, PlayingCard[]>();
  for (const card of hand) byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  return [...byRank.entries()].sort(([a], [b]) => a - b).map(([, cards]) => cards);
}

const ids = (cards: PlayingCard[]) => cards.map((c) => c.id);

/** Rend les cartes les plus faibles, en évitant de casser une paire ou plus. */
function gift(hand: PlayingCard[], count: number): string[] {
  const alone = groups(hand).filter((g) => g.length === 1 && g[0]!.rank !== TWO_RANK).flat();
  const rest = hand.filter((c) => !alone.includes(c));
  return ids([...alone, ...rest].slice(0, count));
}

/**
 * Bot du Président. Il ouvre avec sa plus faible valeur, toutes les cartes ensemble ; il suit avec la plus faible
 * valeur qui passe sans casser de groupe, ne casse un groupe que pour des petites cartes, et garde ses 2 pour
 * reprendre la main. Il pose ses 2 avant sa dernière valeur : finir sur un 2 le ferait Trou.
 * Le niveau facile joue au hasard parmi les coups permis.
 */
export function choosePresidentAction(state: PresidentState, index: number, random: () => number = Math.random, level: BotLevel = 'normal'): PresidentAction | null {
  if (state.currentPlayer !== index) return null;
  const hand = state.players[index]!.hand;
  if (state.phase === 'exchange') {
    const pending = state.gifts.find((g) => g.given === null);
    return pending ? { type: 'giveCards', playerIndex: index, cardIds: gift(hand, pending.count) } : null;
  }
  if (state.phase !== 'playing' || hand.length === 0) return null;

  const table = state.table;
  const count = table?.cards.length ?? 0;
  const playable = presidentPlayable(hand, table, state.forcedRank);
  // Chaque coup permis : une valeur, avec autant de cartes que la table (ou tout le groupe pour ouvrir).
  const options = groups(hand)
    .filter((g) => playable.has(g[0]!.id))
    .map((g) => (table ? g.slice(0, count) : g));
  const play = (cards: PlayingCard[]): PresidentAction => ({ type: 'play', playerIndex: index, cardIds: ids(cards) });
  const pass: PresidentAction = { type: 'pass', playerIndex: index };

  if (level === 'easy') {
    const choices = table ? [...options.map(play), pass] : options.map(play);
    return choices[Math.floor(random() * choices.length)] ?? pass;
  }

  const twos = options.find((g) => g[0]!.rank === TWO_RANK);
  const others = options.filter((g) => g[0]!.rank !== TWO_RANK);
  const nonTwoLeft = hand.filter((c) => c.rank !== TWO_RANK).length;
  const someoneAlmostOut = state.players.some((p, i) => i !== index && p.hand.length > 0 && p.hand.length <= 3);

  if (!table) {
    // Il ne reste qu'une valeur à côté des 2 : poser un 2 d'abord, qui rend la main, pour ne pas finir dessus.
    const plain = groups(hand).filter((g) => g[0]!.rank !== TWO_RANK);
    if (twos && plain.length <= 1 && nonTwoLeft > 0) return play(twos.slice(0, 1));
    return play(others[0] ?? options[0]!);
  }

  // Suivre sans casser de groupe, avec la plus faible valeur possible.
  const sizeOf = (rank: number) => hand.filter((c) => c.rank === rank).length;
  const exact = others.find((g) => sizeOf(g[0]!.rank) === count);
  if (exact) return play(exact);
  // Casser un groupe seulement pour des petites cartes (jusqu'au 10), ou si quelqu'un va bientôt sortir.
  const broken = others.find((g) => g[0]!.rank <= 10 || someoneAlmostOut);
  if (broken) return play(broken);
  // Les 2 : pour reprendre la main quand la fin approche, avant de se retrouver avec seulement des 2.
  if (twos && (nonTwoLeft <= 4 || someoneAlmostOut)) return play(twos);
  return pass;
}
