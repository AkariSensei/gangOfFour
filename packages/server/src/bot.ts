import {
  type Action,
  DRAGON_VALUE,
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
 * Niveau « moyen » : stratégie simple mais raisonnable. Se débarrasser d'abord des grosses combinaisons faibles,
 * battre la table avec le plus petit coup possible, et garder les gangs pour la fin ou pour empêcher un adversaire de finir.
 */
function normalAction(state: GameState, botIndex: number, random: () => number): Action | null {
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

/** Niveau d'un bot, choisi par l'hôte pour chaque bot du salon. */
export type BotLevel = 'easy' | 'normal' | 'hard';
export const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];

/**
 * Coup d'un bot selon son niveau : facile (joue au petit bonheur et passe souvent), moyen (stratégie simple),
 * difficile (planifie sa main et se défend). Aucun ne triche : seuls sa main et ce qui est public comptent.
 */
export function chooseBotAction(state: GameState, botIndex: number, random: () => number = Math.random, level: BotLevel = 'normal'): Action | null {
  if (level === 'easy') return easyAction(state, botIndex, random);
  if (level === 'hard') return hardAction(state, botIndex) ?? normalAction(state, botIndex, random);
  return normalAction(state, botIndex, random);
}

/** Niveau « facile » : rend une carte au hasard, ouvre souvent avec une carte seule prise au hasard, et passe souvent. */
function easyAction(state: GameState, botIndex: number, random: () => number): Action | null {
  const hand = state.players[botIndex]!.hand;
  if (state.phase === 'exchange' && state.exchange?.winnerIndex === botIndex) {
    return { type: 'giveCard', playerIndex: botIndex, cardId: hand[Math.floor(random() * hand.length)]!.id };
  }
  const normal = normalAction(state, botIndex, random);
  if (state.phase !== 'playing' || state.currentPlayer !== botIndex || state.mustPlayMultiOne || !normal) return normal;
  const n = state.players.length;
  const nextHasOneCard = state.players[(botIndex + state.direction + n) % n]!.hand.length === 1;
  // La règle « Carte ! » impose ses coups : on la laisse au niveau moyen.
  if (nextHasOneCard) return normal;
  if (!state.table) {
    if (random() < 0.5) return { type: 'play', playerIndex: botIndex, cardIds: [hand[Math.floor(random() * hand.length)]!.id] };
    return normal;
  }
  return normal.type === 'play' && random() < 0.4 ? { type: 'pass', playerIndex: botIndex } : normal;
}

/** Nombre de valeurs différentes : estimation du nombre de coups qu'il faudra pour vider ces cartes. */
const distinctValues = (cards: Card[]) => new Set(cards.map((c) => c.value)).size;

/**
 * Découpe la main en combinaisons, pour la vider en un minimum de coups : les gangs, puis les cinq cartes qui
 * font gagner des coups (une suite qui absorbe des cartes isolées), puis brelans, paires et cartes seules.
 */
function plan(hand: Card[]): Combination[] {
  const units: Combination[] = gangs(hand);
  let rest = hand.filter((c) => !units.some((g) => g.cards.includes(c)));
  for (;;) {
    let best: { combo: Combination; gain: number } | null = null;
    for (const combo of combinationsOfSize(rest, 5)) {
      const left = rest.filter((c) => !combo.cards.includes(c));
      // Coups économisés : les valeurs qui disparaissent, moins le coup de la combinaison elle-même.
      const gain = distinctValues(rest) - distinctValues(left) - 1;
      if (gain >= 1 && (!best || gain > best.gain || (gain === best.gain && weakestFirst(combo, best.combo) < 0))) best = { combo, gain };
    }
    if (!best) break;
    units.push(best.combo);
    rest = rest.filter((c) => !best!.combo.cards.includes(c));
  }
  const byValue = new Map<number, Card[]>();
  for (const card of rest) byValue.set(card.value, [...(byValue.get(card.value) ?? []), card]);
  for (const group of byValue.values()) {
    const combo = analyzeCombination(group);
    if (combo) units.push(combo);
    else for (const card of group) units.push(analyzeCombination([card])!);
  }
  return units;
}

/** Combinaison maîtresse : très difficile à battre, gardée pour reprendre la main au bon moment. */
const isControl = (c: Combination) =>
  c.type === 'gang' || (c.cards.length === 1 && c.cards[0]!.value === DRAGON_VALUE) || (c.cards.length === 2 && c.cards[0]!.value > 10);

/**
 * Niveau « difficile » : planifie sa main pour la vider en un minimum de coups, garde ses combinaisons maîtresses
 * pour reprendre la main, ne casse pas son plan pour rien, et se défend quand un adversaire va sortir.
 * Renvoie null quand le niveau moyen sait déjà quoi faire (coupe, ouverture imposée avec le 1 multicolore).
 */
function hardAction(state: GameState, botIndex: number): Action | null {
  const hand = state.players[botIndex]!.hand;
  if (state.phase === 'exchange' && state.exchange?.winnerIndex === botIndex) {
    // Rend la plus faible carte seule de son plan : elle ne casse aucune combinaison.
    const singles = plan(hand).filter((u) => u.cards.length === 1 && !isControl(u)).map((u) => u.cards[0]!);
    const pool = singles.length > 0 ? singles : hand;
    return { type: 'giveCard', playerIndex: botIndex, cardId: pool.reduce((w, c) => (compareCards(c, w) < 0 ? c : w)).id };
  }
  if (state.phase !== 'playing' || state.currentPlayer !== botIndex || state.mustPlayMultiOne) return null;

  const n = state.players.length;
  const nextHasOneCard = state.players[(botIndex + state.direction + n) % n]!.hand.length === 1;
  // La règle « Carte ! » (jouer sa plus forte carte seule) est gérée par le niveau moyen.
  if (nextHasOneCard) return null;
  const opponents = state.players.filter((_, i) => i !== botIndex).map((p) => p.hand.length);
  const fewest = Math.min(...opponents);
  const danger = fewest <= 3;
  const units = plan(hand);
  const controls = units.filter(isControl);
  const others = units.filter((u) => !isControl(u)).sort((a, b) => b.cards.length - a.cards.length || weakestFirst(a, b));
  const play = (c: Combination): Action => ({ type: 'play', playerIndex: botIndex, cardIds: ids(c) });

  if (!state.table) {
    // Plus qu'une combinaison en dehors des maîtresses : les maîtresses d'abord (on garde la main), puis la dernière.
    if (controls.length > 0 && others.length <= 1) return play(controls.sort(weakestFirst)[0]!);
    // Un adversaire presque sorti : ouvrir avec plus de cartes qu'il n'en a, pour qu'il ne puisse pas suivre.
    if (danger) {
      const safe = others.filter((u) => u.cards.length > fewest);
      if (safe[0]) return play(safe[0]);
    }
    const first = others[0] ?? controls.sort(weakestFirst)[0];
    return first ? play(first) : null;
  }

  const target = state.table.combination;
  const owner = state.players[state.table.playerIndex]!.hand.length;
  // Il faut se battre quand celui qui tient le pli, ou n'importe qui, est sur le point de sortir.
  const mustFight = danger || owner <= 4;
  const beats = (c: Combination) => canBeat(c, target);
  // 1. Une combinaison du plan qui bat la table, sans rien casser (les maîtresses seulement si nécessaire).
  const fromPlan = units.filter((u) => u.type !== 'gang' && beats(u)).sort(weakestFirst);
  const plain = fromPlan.find((u) => !isControl(u));
  if (plain) return play(plain);
  const control = fromPlan.find(isControl);
  if (control && (mustFight || others.length <= 1)) return play(control);
  // 2. Casser une combinaison, seulement si ça ne coûte pas de coup en plus, ou s'il faut se défendre.
  if (target.type !== 'gang') {
    const broken = [...combinationsOfSize(hand, target.cards.length)].filter(beats).sort(weakestFirst);
    for (const combo of broken) {
      const after = plan(hand.filter((c) => !combo.cards.includes(c))).length;
      if (mustFight || after <= units.length - 1) return play(combo);
    }
  }
  // 3. Un gang pour reprendre la main quand ça compte : adversaire presque sorti, ou fin de main en vue.
  const gang = gangs(hand).filter(beats).sort(weakestFirst)[0];
  if (gang && (mustFight || units.length <= 3 || target.type === 'gang')) return play(gang);
  return { type: 'pass', playerIndex: botIndex };
}
