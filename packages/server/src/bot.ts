import {
  type Action,
  type Card,
  type Combination,
  type GameState,
  MULTI_ONE_ID,
  analyzeCombination,
  canBeat,
  compareCards,
  hasMultiCardCombination,
} from '@gof/engine';

/** Toutes les combinaisons de `size` cartes de la main. */
function combinationsOfSize(hand: Card[], size: number): Combination[] {
  const found: Combination[] = [];
  const pick = (start: number, chosen: Card[]) => {
    if (chosen.length === size) {
      const combination = analyzeCombination(chosen);
      if (combination) found.push(combination);
      return;
    }
    for (let i = start; i <= hand.length - (size - chosen.length); i++) pick(i + 1, [...chosen, hand[i]!]);
  };
  pick(0, []);
  return found;
}

/** Gangs possibles : toutes les cartes de même valeur, par 4 ou plus. */
function gangs(hand: Card[]): Combination[] {
  const byValue = new Map<number, Card[]>();
  for (const card of hand) byValue.set(card.value, [...(byValue.get(card.value) ?? []), card]);
  return [...byValue.values()].filter((g) => g.length >= 4).map((g) => analyzeCombination(g)!);
}

/** Du plus faible au plus fort, au sens de « peut être posé par-dessus ». */
const weakestFirst = (a: Combination, b: Combination) => (canBeat(a, b) ? 1 : canBeat(b, a) ? -1 : 0);

const ids = (combination: Combination) => combination.cards.map((c) => c.id);

/**
 * Stratégie simple mais raisonnable : se débarrasser d'abord des grosses combinaisons faibles, battre la table
 * avec le plus petit coup possible, et garder les gangs pour la fin ou pour empêcher un adversaire de finir.
 */
export function chooseBotAction(state: GameState, botIndex: number, random: () => number = Math.random): Action | null {
  const player = state.players[botIndex]!;
  const hand = player.hand;

  if (state.phase === 'cut' && state.dealer === botIndex) {
    const size = state.deck.length;
    return { type: 'cut', playerIndex: botIndex, position: Math.floor(size / 4 + random() * (size / 2)) };
  }
  if (state.phase === 'exchange' && state.exchange?.winnerIndex === botIndex) {
    // Rend sa plus faible carte isolée (qui n'appartient à aucune paire).
    const lonely = hand.filter((c) => hand.filter((o) => o.value === c.value).length === 1);
    const pool = lonely.length > 0 ? lonely : hand;
    const weakest = pool.reduce((w, c) => (compareCards(c, w) < 0 ? c : w));
    return { type: 'giveCard', playerIndex: botIndex, cardId: weakest.id };
  }
  if (state.phase !== 'playing' || state.currentPlayer !== botIndex) return null;

  const n = state.players.length;
  const next = state.players[(botIndex + state.direction + n) % n]!;
  const nextHasOneCard = next.hand.length === 1;
  const someoneAlmostOut = state.players.some((p, i) => i !== botIndex && p.hand.length <= 3);
  const highest = hand.reduce((h, c) => (compareCards(c, h) > 0 ? c : h));
  // Les cartes d'un gang sont gardées ensemble : on cherche d'abord les coups parmi les autres.
  const gangCards = new Set(gangs(hand).flatMap((g) => g.cards.map((c) => c.id)));
  const spare = hand.filter((c) => !gangCards.has(c.id));

  if (state.mustPlayMultiOne) {
    const withOne = [2, 3, 5]
      .flatMap((size) => combinationsOfSize(hand, size))
      .filter((c) => c.cards.some((card) => card.id === MULTI_ONE_ID))
      .sort((a, b) => b.cards.length - a.cards.length);
    return { type: 'play', playerIndex: botIndex, cardIds: withOne[0] ? ids(withOne[0]) : [MULTI_ONE_ID] };
  }

  if (!state.table) {
    // Ouvre avec ce qui vide le plus la main, en commençant par le plus faible ; garde les gangs.
    for (const size of [5, 3, 2]) {
      const options = combinationsOfSize(spare, size).sort(weakestFirst);
      if (options[0]) return { type: 'play', playerIndex: botIndex, cardIds: ids(options[0]) };
    }
    // Plus de paire ni de cinq cartes : un gang éventuel ne sort que pour finir, ou quand la règle « Carte ! » l'impose.
    const gang = gangs(hand)[0];
    if (gang && (hand.length === gang.cards.length || (nextHasOneCard && hasMultiCardCombination(hand)))) {
      return { type: 'play', playerIndex: botIndex, cardIds: ids(gang) };
    }
    const pool = spare.length > 0 ? spare : hand;
    const single = nextHasOneCard ? highest : pool.reduce((w, c) => (compareCards(c, w) < 0 ? c : w));
    return { type: 'play', playerIndex: botIndex, cardIds: [single.id] };
  }

  const target = state.table.combination;
  let options: Combination[] = [];
  if (target.type !== 'gang') {
    options =
      target.cards.length === 1 && nextHasOneCard
        ? [analyzeCombination([highest])!]
        : [...combinationsOfSize(spare, target.cards.length), ...combinationsOfSize(hand, target.cards.length)];
    options = options.filter((c) => canBeat(c, target));
    // Les coups qui ne cassent pas un gang d'abord, puis le plus faible.
    const breaksGang = (c: Combination) => c.cards.some((card) => gangCards.has(card.id));
    options.sort((a, b) => Number(breaksGang(a)) - Number(breaksGang(b)) || weakestFirst(a, b));
  }
  // Un gang ne sort que pour finir, ou pour contrer un adversaire presque sorti.
  const usableGangs = gangs(hand)
    .filter((g) => canBeat(g, target))
    .sort(weakestFirst);
  const gangAllowed = someoneAlmostOut || hand.length <= 6 || target.type === 'gang';
  const choice = options[0] ?? (gangAllowed ? usableGangs[0] : undefined);
  if (!choice) return { type: 'pass', playerIndex: botIndex };
  return { type: 'play', playerIndex: botIndex, cardIds: ids(choice) };
}
