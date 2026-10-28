import { type Card, MULTI_ONE_ID, compareCards, createDeck, highestCard, sortHand } from './cards';
import { type Combination, analyzeCombination, canBeat, hasMultiCardCombination } from './combinations';
import { createRng, shuffle } from './random';
import { penaltyForCards } from './scoring';

export const HAND_SIZE = 16;

export interface GameConfig {
  /** Score à partir duquel la partie s'arrête. */
  targetScore: number;
}

export const DEFAULT_CONFIG: GameConfig = { targetScore: 100 };

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  score: number;
}

export interface TablePlay {
  playerIndex: number;
  combination: Combination;
}

/** Un coup du pli en cours : une combinaison posée, ou null pour une passe. */
export interface TrickEntry {
  playerIndex: number;
  combination: Combination | null;
}

export interface RoundResult {
  winnerIndex: number;
  loserIndex: number;
  /** Pénalités de la manche, dans l'ordre des joueurs. */
  penalties: number[];
  /** Cartes restées en main à la fin de la manche, dans l'ordre des joueurs (montrées à tous). */
  hands: Card[][];
}

/** Échange du début de manche, visible de tous comme dans le jeu réel. */
export interface Exchange {
  winnerIndex: number;
  loserIndex: number;
  /** Meilleure carte donnée par le perdant. */
  loserCard: Card;
  /** Carte rendue par le gagnant, null tant qu'il n'a pas choisi. */
  winnerCard: Card | null;
}

/** Coupe du paquet par le donneur : les `position` cartes du dessus d'un paquet de `deckSize` cartes passent dessous. */
export interface Cut {
  playerIndex: number;
  position: number;
  deckSize: number;
}

export type Phase = 'cut' | 'exchange' | 'playing' | 'roundOver' | 'gameOver';

export interface GameState {
  config: GameConfig;
  seed: number;
  round: number;
  phase: Phase;
  players: PlayerState[];
  /** Donneur de la manche : le créateur du salon pour la première, puis son voisin de gauche à chaque manche. */
  dealer: number;
  /** Cartes posées pendant la manche, dans l'ordre (la dernière dessus), ramassées pour la donne suivante. */
  pile: Card[];
  /** À trois joueurs, les 16 cartes non distribuées (hors jeu pour la manche). */
  dummy: Card[];
  /** Paquet ramassé en fin de manche (le dessus en premier), en attente de la coupe. Jamais montré aux joueurs. */
  deck: Card[];
  /** Sens de jeu de la manche : -1 (horaire, vers la gauche, première manche) ou +1, alterné à chaque manche. */
  direction: 1 | -1;
  currentPlayer: number;
  /** Dernière combinaison posée sur la table dans le pli en cours. */
  table: TablePlay | null;
  /** Joueurs qui ont passé dans le pli en cours : ils n'y rejouent plus jusqu'à sa fin. */
  passed: boolean[];
  /** Coups du pli en cours (ou du dernier pli terminé, jusqu'à l'ouverture du suivant). */
  trick: TrickEntry[];
  /** Le prochain coup doit contenir le 1 multicolore (ouverture de la première manche). */
  mustPlayMultiOne: boolean;
  exchange: Exchange | null;
  /** Dernière coupe du paquet, pour que toute la table la voie (absente des parties créées avant son ajout). */
  lastCut?: Cut | null;
  lastRound: RoundResult | null;
  /** Indices des joueurs avec le score le plus bas en fin de partie. */
  winners: number[];
  /** Statistiques de la partie, dans l'ordre des joueurs (absentes des parties créées avant leur ajout). */
  stats?: PlayerStats[];
}

/** Ce que chaque joueur a fait pendant la partie, pour ses statistiques personnelles. */
export interface PlayerStats {
  /** Manches où il est sorti en premier. */
  roundsWon: number;
  /** Gangs posés. */
  gangs: number;
  /** Plus grosse pénalité prise en une manche. */
  worstRound: number;
}

function statsOf(state: GameState): PlayerStats[] {
  return (state.stats ??= state.players.map(() => ({ roundsWon: 0, gangs: 0, worstRound: 0 })));
}

export type Action =
  | { type: 'play'; playerIndex: number; cardIds: string[] }
  | { type: 'pass'; playerIndex: number }
  | { type: 'giveCard'; playerIndex: number; cardId: string }
  | { type: 'nextRound' }
  /** Le donneur coupe le paquet : les `position` cartes du dessus passent dessous. */
  | { type: 'cut'; playerIndex: number; position: number };

export type ActionError =
  | 'wrongPhase'
  | 'notYourTurn'
  | 'unknownCard'
  | 'invalidCombination'
  | 'tooWeak'
  | 'cannotPassWhenLeading'
  | 'mustPlayMultiOne'
  | 'mustPlayHighestSingle'
  | 'mustLeadCombination'
  | 'invalidCut';

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: ActionError };

export interface NewPlayer {
  id: string;
  name: string;
}

function step(state: GameState, index: number, direction: number = state.direction): number {
  const n = state.players.length;
  return (index + direction + n) % n;
}

/** Le voisin de gauche (sens horaire), quel que soit le sens de jeu de la manche. */
function leftOf(state: GameState, index: number): number {
  return step(state, index, -1);
}

/**
 * Distribue le paquet (la première carte du tableau est le dessus) une carte à la fois, en commençant par
 * le voisin de gauche du donneur, jusqu'à 16 cartes chacun. À trois, les 16 cartes restantes forment
 * une main morte, hors jeu.
 */
function deal(state: GameState, deck: Card[]): void {
  const n = state.players.length;
  const hands: Card[][] = state.players.map(() => []);
  let seat = leftOf(state, state.dealer);
  for (const card of deck.slice(0, n * HAND_SIZE)) {
    hands[seat]!.push(card);
    seat = leftOf(state, seat);
  }
  state.players.forEach((p, i) => (p.hand = sortHand(hands[i]!)));
  state.dummy = deck.slice(n * HAND_SIZE);
  state.pile = [];
}

/**
 * Comme dans le jeu réel, on ne remélange pas entre deux manches : on ramasse les cartes posées (la main morte
 * dessous, puis les combinaisons dans l'ordre où elles ont été jouées, puis les mains restantes). Le donneur
 * coupe ensuite ce paquet où il veut, et son voisin de gauche distribue.
 */
function gather(state: GameState): Card[] {
  const hands: Card[] = [];
  for (let i = 0, seat = leftOf(state, state.dealer); i < state.players.length; i++, seat = leftOf(state, seat)) {
    hands.push(...state.players[seat]!.hand);
  }
  // Du dessous vers le dessus, puis retourné pour que le dessus soit la première carte.
  return [...state.dummy, ...state.pile, ...hands].reverse();
}

/** Le joueur 0 est le donneur de la première manche (le plus âgé dans le jeu réel). */
export function createGame(players: NewPlayer[], seed: number, config: Partial<GameConfig> = {}): GameState {
  if (players.length !== 3 && players.length !== 4) throw new Error('Gang of Four se joue à 3 ou 4 joueurs');
  const state: GameState = {
    config: { ...DEFAULT_CONFIG, ...config },
    seed,
    round: 1,
    phase: 'playing',
    players: players.map((p) => ({ ...p, hand: [], score: 0 })),
    dealer: 0,
    pile: [],
    dummy: [],
    deck: [],
    direction: -1,
    currentPlayer: 0,
    table: null,
    passed: players.map(() => false),
    trick: [],
    mustPlayMultiOne: false,
    exchange: null,
    lastRound: null,
    winners: [],
    stats: players.map(() => ({ roundsWon: 0, gangs: 0, worstRound: 0 })),
  };
  // Seul le tout premier paquet est mélangé.
  deal(state, shuffle(createDeck(), createRng(state.seed)));
  // Le détenteur du 1 multicolore ouvre avec ce 1. À trois, s'il est dans la main morte, le voisin du donneur ouvre.
  const holder = state.players.findIndex((p) => p.hand.some((c) => c.id === MULTI_ONE_ID));
  state.mustPlayMultiOne = holder >= 0;
  state.currentPlayer = holder >= 0 ? holder : leftOf(state, 0);
  return state;
}

function takeCards(hand: Card[], ids: string[]): Card[] | null {
  if (new Set(ids).size !== ids.length) return null;
  const cards = ids.map((id) => hand.find((c) => c.id === id));
  return cards.every((c): c is Card => c !== undefined) ? cards : null;
}

function play(state: GameState, playerIndex: number, cardIds: string[]): ActionResult {
  const player = state.players[playerIndex]!;
  const cards = takeCards(player.hand, cardIds);
  if (!cards) return { ok: false, error: 'unknownCard' };

  const combination = analyzeCombination(cards);
  if (!combination) return { ok: false, error: 'invalidCombination' };

  if (state.mustPlayMultiOne && !cardIds.includes(MULTI_ONE_ID)) return { ok: false, error: 'mustPlayMultiOne' };
  if (!canBeat(combination, state.table?.combination ?? null)) return { ok: false, error: 'tooWeak' };

  // « Carte ! » : quand le joueur suivant n'a plus qu'une carte, on ouvre avec une combinaison si possible,
  // et une carte seule ne peut être que sa plus forte.
  const nextPlayer = state.players[step(state, playerIndex)]!;
  if (combination.type === 'single' && nextPlayer.hand.length === 1) {
    if (!state.table && hasMultiCardCombination(player.hand)) return { ok: false, error: 'mustLeadCombination' };
    if (compareCards(cards[0]!, highestCard(player.hand)!) !== 0) return { ok: false, error: 'mustPlayHighestSingle' };
  }

  player.hand = player.hand.filter((c) => !cardIds.includes(c.id));
  state.pile.push(...cards);
  if (!state.table) state.trick = [];
  state.trick.push({ playerIndex, combination });
  state.table = { playerIndex, combination };
  state.mustPlayMultiOne = false;
  if (combination.type === 'gang') statsOf(state)[playerIndex]!.gangs += 1;

  if (player.hand.length === 0) {
    endRound(state, playerIndex);
  } else {
    nextTurn(state, playerIndex);
  }
  return { ok: true, state };
}

function pass(state: GameState, playerIndex: number): ActionResult {
  if (!state.table) return { ok: false, error: 'cannotPassWhenLeading' };
  state.passed[playerIndex] = true;
  state.trick.push({ playerIndex, combination: null });
  nextTurn(state, playerIndex);
  return { ok: true, state };
}

/**
 * Donne la main au joueur suivant qui n'a pas passé dans ce pli. Si c'est celui qui a posé la dernière
 * combinaison, tous les autres ont passé : il remporte le pli et en ouvre un nouveau.
 */
function nextTurn(state: GameState, from: number): void {
  let next = step(state, from);
  while (state.passed[next] && next !== from) next = step(state, next);
  if (next === state.table!.playerIndex) {
    state.table = null;
    state.passed = state.players.map(() => false);
  }
  state.currentPlayer = next;
}

/**
 * Le perdant est celui à qui il reste le plus de cartes ; à égalité, celui qui a le plus gros score total,
 * puis le plus proche du gagnant dans le sens antihoraire.
 */
function findLoser(state: GameState, winnerIndex: number): number {
  let loser = -1;
  for (let i = step(state, winnerIndex, 1); i !== winnerIndex; i = step(state, i, 1)) {
    if (loser < 0) {
      loser = i;
      continue;
    }
    const [a, b] = [state.players[i]!, state.players[loser]!];
    if (a.hand.length > b.hand.length || (a.hand.length === b.hand.length && a.score > b.score)) loser = i;
  }
  return loser;
}

function endRound(state: GameState, winnerIndex: number): void {
  const penalties = state.players.map((p) => penaltyForCards(p.hand.length));
  state.players.forEach((p, i) => (p.score += penalties[i]!));
  const stats = statsOf(state);
  stats[winnerIndex]!.roundsWon += 1;
  penalties.forEach((penalty, i) => (stats[i]!.worstRound = Math.max(stats[i]!.worstRound, penalty)));

  state.lastRound = {
    winnerIndex,
    loserIndex: findLoser(state, winnerIndex),
    penalties,
    hands: state.players.map((p) => p.hand),
  };
  state.table = null;
  state.passed = state.players.map(() => false);

  if (state.players.some((p) => p.score >= state.config.targetScore)) {
    const best = Math.min(...state.players.map((p) => p.score));
    state.winners = state.players.flatMap((p, i) => (p.score === best ? [i] : []));
    state.phase = 'gameOver';
  } else {
    state.phase = 'roundOver';
  }
}

/** Fin de manche : on ramasse les cartes et le donneur de la manche écoulée doit couper le paquet. */
function nextRound(state: GameState): ActionResult {
  state.deck = gather(state);
  state.players.forEach((p) => (p.hand = []));
  state.pile = [];
  state.dummy = [];
  state.trick = [];
  state.exchange = null;
  state.lastCut = null;
  state.phase = 'cut';
  state.currentPlayer = state.dealer;
  return { ok: true, state };
}

/** Le donneur coupe, puis son voisin de gauche devient donneur et distribue la nouvelle manche. */
function cut(state: GameState, position: number): ActionResult {
  if (!Number.isInteger(position) || position < 1 || position >= state.deck.length) {
    return { ok: false, error: 'invalidCut' };
  }
  const deck = [...state.deck.slice(position), ...state.deck.slice(0, position)];
  state.lastCut = { playerIndex: state.dealer, position, deckSize: state.deck.length };
  state.deck = [];
  state.round += 1;
  state.direction = state.round % 2 === 1 ? -1 : 1;
  state.dealer = leftOf(state, state.dealer);
  deal(state, deck);

  const { winnerIndex, loserIndex } = state.lastRound!;

  // Le perdant donne automatiquement sa meilleure carte au gagnant, qui lui en rend une de son choix.
  const loser = state.players[loserIndex]!;
  const winner = state.players[winnerIndex]!;
  const best = highestCard(loser.hand)!;
  loser.hand = loser.hand.filter((c) => c.id !== best.id);
  winner.hand = sortHand([...winner.hand, best]);

  state.exchange = { winnerIndex, loserIndex, loserCard: best, winnerCard: null };
  state.phase = 'exchange';
  state.currentPlayer = winnerIndex;
  return { ok: true, state };
}

function giveCard(state: GameState, playerIndex: number, cardId: string): ActionResult {
  const exchange = state.exchange!;
  const giver = state.players[playerIndex]!;
  const card = giver.hand.find((c) => c.id === cardId);
  if (!card) return { ok: false, error: 'unknownCard' };

  const receiver = state.players[exchange.loserIndex]!;
  giver.hand = giver.hand.filter((c) => c.id !== cardId);
  receiver.hand = sortHand([...receiver.hand, card]);

  exchange.winnerCard = card;
  state.phase = 'playing';
  // Le gagnant de la manche précédente ouvre la nouvelle.
  state.currentPlayer = exchange.winnerIndex;
  return { ok: true, state };
}

/** Applique une action sans modifier l'état reçu. */
export function applyAction(previous: GameState, action: Action): ActionResult {
  const state = structuredClone(previous);

  switch (action.type) {
    case 'play':
    case 'pass':
      if (state.phase !== 'playing') return { ok: false, error: 'wrongPhase' };
      if (action.playerIndex !== state.currentPlayer) return { ok: false, error: 'notYourTurn' };
      return action.type === 'play' ? play(state, action.playerIndex, action.cardIds) : pass(state, action.playerIndex);
    case 'giveCard':
      if (state.phase !== 'exchange') return { ok: false, error: 'wrongPhase' };
      if (action.playerIndex !== state.exchange!.winnerIndex) return { ok: false, error: 'notYourTurn' };
      return giveCard(state, action.playerIndex, action.cardId);
    case 'nextRound':
      if (state.phase !== 'roundOver') return { ok: false, error: 'wrongPhase' };
      return nextRound(state);
    case 'cut':
      if (state.phase !== 'cut') return { ok: false, error: 'wrongPhase' };
      if (action.playerIndex !== state.dealer) return { ok: false, error: 'notYourTurn' };
      return cut(state, action.position);
  }
}

export interface PlayerView {
  round: number;
  phase: Phase;
  you: number;
  hand: Card[];
  players: { id: string; name: string; score: number; cardCount: number }[];
  dealer: number;
  /** Score qui met fin à la partie. */
  targetScore: number;
  /** Nombre de cartes du paquet à couper (phase « cut »), 0 sinon. */
  deckSize: number;
  direction: 1 | -1;
  currentPlayer: number;
  table: TablePlay | null;
  trick: TrickEntry[];
  mustPlayMultiOne: boolean;
  exchange: Exchange | null;
  lastCut: Cut | null;
  lastRound: RoundResult | null;
  winners: number[];
  /** Statistiques de chaque joueur depuis le début de la partie (publiques : tout le monde a vu les manches). */
  stats: PlayerStats[];
}

/** Ce qu'un joueur a le droit de voir : sa main, et seulement le nombre de cartes des autres. */
export function getPlayerView(state: GameState, playerIndex: number): PlayerView {
  return {
    round: state.round,
    phase: state.phase,
    you: playerIndex,
    hand: state.players[playerIndex]!.hand,
    players: state.players.map((p) => ({ id: p.id, name: p.name, score: p.score, cardCount: p.hand.length })),
    dealer: state.dealer,
    targetScore: state.config.targetScore,
    deckSize: state.deck.length,
    direction: state.direction,
    currentPlayer: state.currentPlayer,
    table: state.table,
    trick: state.trick,
    mustPlayMultiOne: state.mustPlayMultiOne,
    exchange: state.exchange,
    lastCut: state.lastCut ?? null,
    lastRound: state.lastRound,
    winners: state.winners,
    stats: statsOf(state),
  };
}
