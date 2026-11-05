import { createRng, shuffle } from './random';

/**
 * Le Président, avec les règles du bureau : jeu de 52 cartes du 3 (la plus faible) au 2 (la plus forte), de 3 à
 * 7 joueurs. On pose des cartes de même valeur (1 à 4), le suivant pose autant de cartes d'une valeur au moins égale,
 * ou passe et sort du pli. Le 2 ferme le pli ; deux poses de la même valeur d'affilée imposent « cette valeur ou
 * rien » ; finir sur un 2 envoie au rang de Trou. Les places de la manche donnent des points et l'échange suivant :
 * le Trou donne ses 2 meilleures cartes au Président, le Vice-trou sa meilleure au Vice-président, qui rendent
 * les cartes de leur choix.
 */

export type Suit = 'S' | 'H' | 'D' | 'C';

export interface PlayingCard {
  /** Valeur puis couleur, par exemple « 10H » ou « QS ». */
  id: string;
  /** 3 à 10, puis 11 (valet), 12 (dame), 13 (roi), 14 (as) et 15 (le 2, la plus forte). */
  rank: number;
  suit: Suit;
}

export const PRESIDENT_MIN_PLAYERS = 3;
export const PRESIDENT_MAX_PLAYERS = 7;
/** Nombres de manches que l'hôte peut choisir. */
export const PRESIDENT_ROUNDS = [3, 5, 10];
export const PRESIDENT_DEFAULT_ROUNDS = 5;
/** Le 2, la carte la plus forte : elle ferme le pli. */
export const TWO_RANK = 15;
/** Le 3 de trèfle : son détenteur ouvre la première manche. */
export const OPENING_CARD_ID = '3C';

const SUITS: Suit[] = ['C', 'D', 'H', 'S'];
const RANK_LABELS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' };

export function rankLabel(rank: number): string {
  return RANK_LABELS[rank] ?? String(rank);
}

export function createPlayingDeck(): PlayingCard[] {
  return Array.from({ length: 13 }, (_, i) => i + 3).flatMap((rank) => SUITS.map((suit) => ({ id: `${rankLabel(rank)}${suit}`, rank, suit })));
}

/** Du plus faible au plus fort, les couleurs dans un ordre fixe pour que la main ne bouge pas. */
export function sortPlayingCards(cards: PlayingCard[]): PlayingCard[] {
  return [...cards].sort((a, b) => a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
}

/** Titre d'une place de fin de manche (0 : la première) à `players` joueurs. */
export type PresidentTitle = 'president' | 'vicePresident' | 'neutral' | 'viceTrou' | 'trou';

export function titleOf(place: number, players: number): PresidentTitle {
  if (place === 0) return 'president';
  if (place === players - 1) return 'trou';
  if (players >= 4 && place === 1) return 'vicePresident';
  if (players >= 4 && place === players - 2) return 'viceTrou';
  return 'neutral';
}

/** Points d'une place de fin de manche : le Président en marque le plus, le Trou aucun. */
export function pointsFor(place: number, players: number): number {
  return players - 1 - place;
}

export interface PresidentPlayer {
  id: string;
  name: string;
  hand: PlayingCard[];
  /** Points de toutes les manches jouées. */
  score: number;
}

export interface PresidentPlay {
  playerIndex: number;
  cards: PlayingCard[];
  rank: number;
}

/** Un coup du pli en cours : des cartes posées, ou null pour une passe. */
export interface PresidentTrickEntry {
  playerIndex: number;
  cards: PlayingCard[] | null;
}

/** Une carte à rendre pendant l'échange : `from` doit donner `count` cartes de son choix à `to`. */
export interface PresidentGift {
  from: number;
  to: number;
  count: number;
  /** Les meilleures cartes reçues d'office de `to`, montrées seulement aux deux joueurs. */
  received: PlayingCard[];
  /** Les cartes rendues, null tant que `from` n'a pas choisi. */
  given: PlayingCard[] | null;
}

export interface PresidentRoundResult {
  /** Joueurs dans l'ordre des places, du Président au Trou. */
  order: number[];
  /** Points de la manche, dans l'ordre des joueurs. */
  points: number[];
  /** Joueurs qui ont fini sur un 2 (et sont donc passés Trou). */
  endedOnTwo: number[];
}

export type PresidentPhase = 'exchange' | 'playing' | 'roundOver' | 'gameOver';

export interface PresidentConfig {
  rounds: number;
}

export interface PresidentState {
  config: PresidentConfig;
  seed: number;
  round: number;
  phase: PresidentPhase;
  players: PresidentPlayer[];
  currentPlayer: number;
  /** Dernières cartes posées dans le pli en cours. */
  table: PresidentPlay | null;
  /** « X ou rien » : la valeur imposée au prochain joueur, après deux poses de la même valeur d'affilée. */
  forcedRank: number | null;
  /** Joueurs qui ont passé dans le pli en cours : ils n'y rejouent plus. */
  passed: boolean[];
  /** Coups du pli en cours (ou du dernier pli terminé, jusqu'à l'ouverture du suivant). */
  trick: PresidentTrickEntry[];
  /** Joueurs sortis normalement, dans l'ordre. */
  finished: number[];
  /** Joueurs sortis sur un 2, dans l'ordre : le premier finit tout en bas. */
  endedOnTwo: number[];
  /** Échanges du début de manche, dans l'ordre où ils se font (le Président d'abord). */
  gifts: PresidentGift[];
  lastRound: PresidentRoundResult | null;
  /** Indices des joueurs qui ont le plus de points en fin de partie. */
  winners: number[];
  /** Places de chaque joueur à chaque manche (0 : Président). */
  places: number[][];
}

export type PresidentAction =
  | { type: 'play'; playerIndex: number; cardIds: string[] }
  | { type: 'pass'; playerIndex: number }
  | { type: 'giveCards'; playerIndex: number; cardIds: string[] }
  | { type: 'nextRound' };

export type PresidentError =
  | 'wrongPhase'
  | 'notYourTurn'
  | 'unknownCard'
  | 'invalidCombination'
  | 'tooWeak'
  | 'wrongCount'
  | 'mustPlayForcedRank'
  | 'cannotPassWhenLeading';

export type PresidentResult = { ok: true; state: PresidentState } | { ok: false; error: PresidentError };

export function createPresident(players: { id: string; name: string }[], seed: number, config: Partial<PresidentConfig> = {}): PresidentState {
  if (players.length < PRESIDENT_MIN_PLAYERS || players.length > PRESIDENT_MAX_PLAYERS) {
    throw new Error(`Le Président se joue de ${PRESIDENT_MIN_PLAYERS} à ${PRESIDENT_MAX_PLAYERS} joueurs`);
  }
  const state: PresidentState = {
    config: { rounds: config.rounds ?? PRESIDENT_DEFAULT_ROUNDS },
    seed,
    round: 1,
    phase: 'playing',
    players: players.map((p) => ({ ...p, hand: [], score: 0 })),
    currentPlayer: 0,
    table: null,
    forcedRank: null,
    passed: players.map(() => false),
    trick: [],
    finished: [],
    endedOnTwo: [],
    gifts: [],
    lastRound: null,
    winners: [],
    places: players.map(() => []),
  };
  deal(state);
  state.currentPlayer = Math.max(
    0,
    state.players.findIndex((p) => p.hand.some((c) => c.id === OPENING_CARD_ID)),
  );
  return state;
}

/** Chaque manche, un paquet mélangé distribué en entier (certains ont une carte de plus). */
function deal(state: PresidentState): void {
  const deck = shuffle(createPlayingDeck(), createRng(state.seed + state.round * 7919));
  const n = state.players.length;
  const hands: PlayingCard[][] = state.players.map(() => []);
  deck.forEach((card, i) => hands[i % n]!.push(card));
  state.players.forEach((p, i) => (p.hand = sortPlayingCards(hands[i]!)));
}

const next = (state: PresidentState, index: number) => (index + 1) % state.players.length;
const inPlay = (state: PresidentState, index: number) => state.players[index]!.hand.length > 0;

function takeCards(hand: PlayingCard[], ids: string[]): PlayingCard[] | null {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return null;
  const cards = ids.map((id) => hand.find((c) => c.id === id));
  return cards.every((c): c is PlayingCard => c !== undefined) ? cards : null;
}

/** Ce que ces cartes valent posées ensemble, ou une erreur si le coup est interdit sur la table actuelle. */
export function checkPresidentPlay(cards: PlayingCard[], table: PresidentPlay | null, forcedRank: number | null): PresidentError | null {
  const rank = cards[0]?.rank;
  if (rank === undefined || cards.length > 4 || cards.some((c) => c.rank !== rank)) return 'invalidCombination';
  if (!table) return null;
  if (cards.length !== table.cards.length) return 'wrongCount';
  if (forcedRank !== null && rank !== forcedRank) return 'mustPlayForcedRank';
  return rank >= table.rank ? null : 'tooWeak';
}

function play(state: PresidentState, playerIndex: number, cardIds: string[]): PresidentResult {
  const player = state.players[playerIndex]!;
  const cards = takeCards(player.hand, cardIds);
  if (!cards) return { ok: false, error: 'unknownCard' };
  const error = checkPresidentPlay(cards, state.table, state.forcedRank);
  if (error) return { ok: false, error };

  const rank = cards[0]!.rank;
  player.hand = player.hand.filter((c) => !cardIds.includes(c.id));
  if (!state.table) state.trick = [];
  state.forcedRank = state.table && state.table.rank === rank ? rank : null;
  state.trick.push({ playerIndex, cards });
  state.table = { playerIndex, cards, rank };

  if (player.hand.length === 0) {
    // Finir sur un 2 est interdit : celui qui le fait finit Trou.
    (rank === TWO_RANK ? state.endedOnTwo : state.finished).push(playerIndex);
    if (state.players.filter((p) => p.hand.length > 0).length <= 1) {
      endRound(state);
      return { ok: true, state };
    }
  }
  if (rank === TWO_RANK) {
    // Le 2 ferme le pli : celui qui l'a posé relance (ou son voisin encore en jeu s'il vient de finir).
    closeTrick(state, playerIndex);
  } else {
    advance(state, playerIndex);
  }
  return { ok: true, state };
}

function pass(state: PresidentState, playerIndex: number): PresidentResult {
  if (!state.table) return { ok: false, error: 'cannotPassWhenLeading' };
  state.passed[playerIndex] = true;
  state.trick.push({ playerIndex, cards: null });
  advance(state, playerIndex);
  return { ok: true, state };
}

/** Le pli est fini : `leader` ouvre le suivant, ou le prochain joueur qui a encore des cartes. */
function closeTrick(state: PresidentState, leader: number): void {
  state.table = null;
  state.forcedRank = null;
  state.passed = state.players.map(() => false);
  let index = leader;
  while (!inPlay(state, index)) index = next(state, index);
  state.currentPlayer = index;
}

/**
 * Donne la main au joueur suivant encore en jeu qui n'a pas passé. S'il n'y en a plus (en dehors de celui qui a posé
 * les dernières cartes), le pli revient à celui qui a posé les dernières cartes.
 */
function advance(state: PresidentState, from: number): void {
  const last = state.table!.playerIndex;
  for (let index = next(state, from); index !== from; index = next(state, index)) {
    if (index === last) break;
    if (inPlay(state, index) && !state.passed[index]) {
      state.currentPlayer = index;
      return;
    }
  }
  // Personne ne peut plus suivre : le pli revient à celui qui a posé les dernières cartes, s'il lui reste
  // des cartes et qu'il n'a pas passé depuis ; sinon au suivant encore en jeu.
  closeTrick(state, last === from && !inPlay(state, from) ? next(state, from) : last);
}

function endRound(state: PresidentState): void {
  const last = state.players.findIndex((p) => p.hand.length > 0);
  const order = [...state.finished, ...(last >= 0 ? [last] : []), ...[...state.endedOnTwo].reverse()];
  const n = state.players.length;
  const points = state.players.map(() => 0);
  order.forEach((player, place) => {
    points[player] = pointsFor(place, n);
    state.places[player]!.push(place);
  });
  state.players.forEach((p, i) => (p.score += points[i]!));
  state.lastRound = { order, points, endedOnTwo: [...state.endedOnTwo] };
  state.table = null;
  state.forcedRank = null;
  state.passed = state.players.map(() => false);

  if (state.round >= state.config.rounds) {
    const best = Math.max(...state.players.map((p) => p.score));
    state.winners = state.players.flatMap((p, i) => (p.score === best ? [i] : []));
    state.phase = 'gameOver';
  } else {
    state.phase = 'roundOver';
  }
}

/** Nouvelle manche : nouvelle donne, puis l'échange entre les places de la manche précédente. */
function nextRound(state: PresidentState): PresidentResult {
  const { order } = state.lastRound!;
  const n = state.players.length;
  state.round += 1;
  state.trick = [];
  state.finished = [];
  state.endedOnTwo = [];
  deal(state);

  // Le Trou donne d'office ses 2 meilleures cartes au Président, le Vice-trou sa meilleure au Vice-président.
  const pairs: [number, number, number][] = [[order[0]!, order[n - 1]!, 2]];
  if (n >= 4) pairs.push([order[1]!, order[n - 2]!, 1]);
  state.gifts = pairs.map(([winner, loser, count]) => {
    const giver = state.players[loser]!;
    const best = giver.hand.slice(-count);
    giver.hand = giver.hand.slice(0, -count);
    const receiver = state.players[winner]!;
    receiver.hand = sortPlayingCards([...receiver.hand, ...best]);
    return { from: winner, to: loser, count, received: best, given: null };
  });
  state.phase = 'exchange';
  state.currentPlayer = state.gifts[0]!.from;
  return { ok: true, state };
}

function giveCards(state: PresidentState, playerIndex: number, cardIds: string[]): PresidentResult {
  const gift = state.gifts.find((g) => g.given === null)!;
  const giver = state.players[playerIndex]!;
  const cards = takeCards(giver.hand, cardIds);
  if (!cards) return { ok: false, error: 'unknownCard' };
  if (cards.length !== gift.count) return { ok: false, error: 'wrongCount' };
  giver.hand = giver.hand.filter((c) => !cardIds.includes(c.id));
  const receiver = state.players[gift.to]!;
  receiver.hand = sortPlayingCards([...receiver.hand, ...cards]);
  gift.given = cards;

  const pending = state.gifts.find((g) => g.given === null);
  if (pending) {
    state.currentPlayer = pending.from;
  } else {
    // Le Trou de la manche précédente ouvre la nouvelle.
    state.phase = 'playing';
    state.currentPlayer = state.lastRound!.order.at(-1)!;
  }
  return { ok: true, state };
}

/** Le joueur qui doit agir maintenant (jouer, ou rendre des cartes pendant l'échange), -1 si personne. */
export function presidentToAct(state: PresidentState): number {
  return state.phase === 'playing' || state.phase === 'exchange' ? state.currentPlayer : -1;
}

/** Applique une action sans modifier l'état reçu. */
export function applyPresidentAction(previous: PresidentState, action: PresidentAction): PresidentResult {
  const state = structuredClone(previous);
  switch (action.type) {
    case 'play':
    case 'pass':
      if (state.phase !== 'playing') return { ok: false, error: 'wrongPhase' };
      if (action.playerIndex !== state.currentPlayer) return { ok: false, error: 'notYourTurn' };
      return action.type === 'play' ? play(state, action.playerIndex, action.cardIds) : pass(state, action.playerIndex);
    case 'giveCards':
      if (state.phase !== 'exchange') return { ok: false, error: 'wrongPhase' };
      if (action.playerIndex !== state.currentPlayer) return { ok: false, error: 'notYourTurn' };
      return giveCards(state, action.playerIndex, action.cardIds);
    case 'nextRound':
      if (state.phase !== 'roundOver') return { ok: false, error: 'wrongPhase' };
      return nextRound(state);
  }
}

/** Les cartes de la main qu'on peut poser maintenant (au moins dans un coup), pour griser les autres. */
export function presidentPlayable(hand: PlayingCard[], table: PresidentPlay | null, forcedRank: number | null): Set<string> {
  const byRank = new Map<number, PlayingCard[]>();
  for (const card of hand) byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  const ids = new Set<string>();
  for (const [rank, cards] of byRank) {
    const ok = !table || (cards.length >= table.cards.length && (forcedRank === null ? rank >= table.rank : rank === forcedRank));
    if (ok) cards.forEach((c) => ids.add(c.id));
  }
  return ids;
}

export interface PresidentView {
  game: 'president';
  round: number;
  rounds: number;
  phase: PresidentPhase;
  you: number;
  hand: PlayingCard[];
  players: { id: string; name: string; score: number; cardCount: number; out: boolean; passed: boolean }[];
  currentPlayer: number;
  table: PresidentPlay | null;
  forcedRank: number | null;
  trick: PresidentTrickEntry[];
  /** Ordre de sortie de la manche en cours : les sortis normalement, puis ceux sortis sur un 2. */
  finished: number[];
  endedOnTwo: number[];
  /** Les échanges, avec les cartes visibles seulement des deux joueurs concernés. */
  gifts: { from: number; to: number; count: number; received: PlayingCard[] | null; given: PlayingCard[] | null; done: boolean }[];
  lastRound: PresidentRoundResult | null;
  winners: number[];
  places: number[][];
}

/** Ce qu'un joueur a le droit de voir (`you` vaut -1 pour un spectateur) : sa main et le nombre de cartes des autres. */
export function presidentView(state: PresidentState, you: number): PresidentView {
  return {
    game: 'president',
    round: state.round,
    rounds: state.config.rounds,
    phase: state.phase,
    you,
    hand: state.players[you]?.hand ?? [],
    players: state.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      cardCount: p.hand.length,
      out: p.hand.length === 0,
      passed: state.passed[i] ?? false,
    })),
    currentPlayer: state.currentPlayer,
    table: state.table,
    forcedRank: state.forcedRank,
    trick: state.trick,
    finished: state.finished,
    endedOnTwo: state.endedOnTwo,
    gifts: state.gifts.map((g) => {
      const involved = you === g.from || you === g.to;
      return { from: g.from, to: g.to, count: g.count, received: involved ? g.received : null, given: involved ? g.given : null, done: g.given !== null };
    }),
    lastRound: state.lastRound,
    winners: state.winners,
    places: state.places,
  };
}
