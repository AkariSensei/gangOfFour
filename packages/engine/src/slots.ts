import { createRng } from './random';

/**
 * Duel de machines à sous : deux joueurs, 100 € fictifs chacun. À chaque tour, chacun tire à son tour avec la mise du
 * tour, imposée et qui monte (5 € les trois premiers tours, puis 10 €, 15 €…) : personne ne fait tapis, et la partie
 * finit forcément. À la fin d'un tour complet, si l'un est à 0 € ou qu'un autre atteint 300 €, le plus riche gagne.
 */

export const SLOT_SYMBOLS = ['cherry', 'lemon', 'orange', 'grape', 'bell', 'star', 'seven'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

/** Poids de chaque symbole sur un rouleau (sur 100) : la cerise sort souvent, le 7 une fois sur cent. */
export const SLOT_WEIGHTS: Record<SlotSymbol, number> = { cherry: 30, lemon: 25, orange: 20, grape: 13, bell: 8, star: 3, seven: 1 };
/** Gain de trois symboles identiques, en multiple de la mise. */
export const THREE_OF_A_KIND: Record<SlotSymbol, number> = { cherry: 4, lemon: 6, orange: 8, grape: 15, bell: 30, star: 80, seven: 200 };
/** Gain de deux symboles identiques (n'importe lesquels), en multiple de la mise. */
export const TWO_OF_A_KIND = 1.5;

export const SLOTS_START = 100;
export const SLOTS_GOAL = 300;
/** Garde-fou : au-delà, le plus riche gagne (la mise qui monte finit toujours la partie bien avant). */
const MAX_ROUNDS = 200;

/** Mise imposée d'un tour (le premier est le tour 1) : 5 € de plus tous les trois tours. */
export function stakeOf(round: number): number {
  return 5 * Math.ceil(round / 3);
}

export interface SlotSpin {
  playerIndex: number;
  round: number;
  stake: number;
  reels: [SlotSymbol, SlotSymbol, SlotSymbol];
  /** Ce que le tirage rapporte (0 si rien), la mise déjà retirée du solde. */
  win: number;
  /** Solde après le tirage. */
  balance: number;
}

export interface SlotsState {
  seed: number;
  round: number;
  phase: 'playing' | 'gameOver';
  players: { id: string; name: string; balance: number }[];
  currentPlayer: number;
  /** Tous les tirages de la partie, dans l'ordre. */
  spins: SlotSpin[];
  winners: number[];
}

export type SlotsAction = { type: 'spin'; playerIndex: number };
export type SlotsError = 'wrongPhase' | 'notYourTurn';
export type SlotsResult = { ok: true; state: SlotsState } | { ok: false; error: SlotsError };

/** Le joueur 0 (l'hôte) tire en premier. */
export function createSlots(players: { id: string; name: string }[], seed: number): SlotsState {
  if (players.length !== 2) throw new Error('Le duel de machines à sous se joue à 2');
  return {
    seed,
    round: 1,
    phase: 'playing',
    players: players.map((p) => ({ ...p, balance: SLOTS_START })),
    currentPlayer: 0,
    spins: [],
    winners: [],
  };
}

/** Ce que rapporte une combinaison, en multiple de la mise. */
export function payoutOf(reels: SlotSymbol[]): number {
  const [a, b, c] = reels;
  if (a === b && b === c) return THREE_OF_A_KIND[a!];
  return a === b || b === c || a === c ? TWO_OF_A_KIND : 0;
}

function pick(random: () => number): SlotSymbol {
  let x = random() * 100;
  for (const symbol of SLOT_SYMBOLS) {
    x -= SLOT_WEIGHTS[symbol];
    if (x < 0) return symbol;
  }
  return 'cherry';
}

/** Les tirages de la partie suivent la graine : chaque tirage a la sienne, pour pouvoir rejouer une partie. */
function draw(state: SlotsState): [SlotSymbol, SlotSymbol, SlotSymbol] {
  const random = createRng(state.seed + (state.spins.length + 1) * 7919);
  return [pick(random), pick(random), pick(random)];
}

/** Fin d'un tour complet : quelqu'un est à sec ou a atteint l'objectif, et ils ne sont pas à égalité. */
function endOfRound(state: SlotsState): void {
  const balances = state.players.map((p) => p.balance);
  // À égalité au-dessus de l'objectif, on rejoue un tour ; tous deux à sec, ils finissent ensemble.
  const broke = balances.every((b) => b <= 0);
  const decided = broke || (balances.some((b) => b <= 0 || b >= SLOTS_GOAL) && balances[0] !== balances[1]);
  if (decided || state.round >= MAX_ROUNDS) {
    const best = Math.max(...balances);
    state.winners = balances.flatMap((b, i) => (b === best ? [i] : []));
    state.phase = 'gameOver';
    return;
  }
  state.round += 1;
  // Un joueur à sec ne tire plus : l'autre continue seul jusqu'à la fin du tour (égalité à départager).
  state.currentPlayer = state.players[0]!.balance > 0 ? 0 : 1;
}

function spin(state: SlotsState, playerIndex: number): SlotsResult {
  const player = state.players[playerIndex]!;
  // Pas assez pour la mise du tour : il joue tout ce qui lui reste.
  const stake = Math.min(stakeOf(state.round), player.balance);
  const reels = draw(state);
  const win = Math.round(stake * payoutOf(reels));
  player.balance += win - stake;
  state.spins.push({ playerIndex, round: state.round, stake, reels, win, balance: player.balance });

  const other = 1 - playerIndex;
  if (playerIndex === 0 && state.players[other]!.balance > 0) state.currentPlayer = other;
  else endOfRound(state);
  return { ok: true, state };
}

/** Applique une action sans modifier l'état reçu. */
export function applySlotsAction(previous: SlotsState, action: SlotsAction): SlotsResult {
  if (previous.phase !== 'playing') return { ok: false, error: 'wrongPhase' };
  if (action.playerIndex !== previous.currentPlayer) return { ok: false, error: 'notYourTurn' };
  return spin(structuredClone(previous), action.playerIndex);
}

export interface SlotsView {
  game: 'slots';
  you: number;
  round: number;
  /** Mise du tour en cours. */
  stake: number;
  /** Mise du tour suivant, pour voir venir la montée. */
  nextStake: number;
  goal: number;
  phase: SlotsState['phase'];
  players: SlotsState['players'];
  currentPlayer: number;
  /** Les derniers tirages, du plus ancien au plus récent. */
  spins: SlotSpin[];
  winners: number[];
}

/** Tout est public au duel : chacun voit les rouleaux de l'autre. `you` vaut -1 pour un spectateur. */
export function slotsView(state: SlotsState, you: number): SlotsView {
  return {
    game: 'slots',
    you,
    round: state.round,
    stake: stakeOf(state.round),
    nextStake: stakeOf(state.round + 1),
    goal: SLOTS_GOAL,
    phase: state.phase,
    players: state.players,
    currentPlayer: state.currentPlayer,
    spins: state.spins.slice(-12),
    winners: state.winners,
  };
}
