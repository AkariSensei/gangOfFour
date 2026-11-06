/**
 * Reversi à deux, sur un plateau de 8 × 8. Chacun à son tour pose un pion qui encadre, en ligne droite (horizontale,
 * verticale ou diagonale), des pions adverses : ils se retournent et changent de camp. Qui n'a aucun coup passe son
 * tour ; quand plus personne ne peut jouer, le plus de pions gagne. Le joueur 0 (l'hôte) joue les pions orange et
 * commence. Une case est un nombre de 0 à 63 : ligne × 8 + colonne.
 */

export const BOARD = 8;
const SIZE = BOARD * BOARD;
const DIRECTIONS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;

/** Une case : vide (-1) ou le joueur qui l'occupe (0 ou 1). */
export type Disc = -1 | 0 | 1;

export interface ReversiState {
  seed: number;
  phase: 'playing' | 'gameOver';
  players: { id: string; name: string }[];
  board: Disc[];
  currentPlayer: number;
  /** Dernier coup : la case posée, les pions retournés, et si l'adversaire a dû passer ensuite. */
  lastMove: { playerIndex: number; cell: number; flipped: number[]; skipped: boolean } | null;
  moves: number;
  winners: number[];
}

export type ReversiAction = { type: 'move'; playerIndex: number; cell: number };
export type ReversiError = 'wrongPhase' | 'notYourTurn' | 'illegalMove';
export type ReversiResult = { ok: true; state: ReversiState } | { ok: false; error: ReversiError };

export function createReversi(players: { id: string; name: string }[], seed: number): ReversiState {
  if (players.length !== 2) throw new Error('Le Reversi se joue à 2');
  const board: Disc[] = Array.from({ length: SIZE }, () => -1);
  // Les quatre pions du départ, en croix au centre.
  board[27] = 1;
  board[36] = 1;
  board[28] = 0;
  board[35] = 0;
  return { seed, phase: 'playing', players: players.map((p) => ({ ...p })), board, currentPlayer: 0, lastMove: null, moves: 0, winners: [] };
}

/** Les pions adverses que retournerait un pion de `player` posé sur `cell` (vide si le coup est interdit). */
export function flipsFor(board: Disc[], player: number, cell: number): number[] {
  if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE || board[cell] !== -1) return [];
  const row = Math.floor(cell / BOARD);
  const col = cell % BOARD;
  const flips: number[] = [];
  for (const [dr, dc] of DIRECTIONS) {
    const line: number[] = [];
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < BOARD && c >= 0 && c < BOARD && board[r * BOARD + c] === 1 - player) {
      line.push(r * BOARD + c);
      r += dr;
      c += dc;
    }
    if (line.length > 0 && r >= 0 && r < BOARD && c >= 0 && c < BOARD && board[r * BOARD + c] === player) flips.push(...line);
  }
  return flips;
}

/** Les cases où `player` peut jouer. */
export function legalMoves(board: Disc[], player: number): number[] {
  const moves: number[] = [];
  for (let cell = 0; cell < SIZE; cell++) if (flipsFor(board, player, cell).length > 0) moves.push(cell);
  return moves;
}

export function countDiscs(board: Disc[]): [number, number] {
  return [board.filter((d) => d === 0).length, board.filter((d) => d === 1).length];
}

/** Applique un coup (sans vérifier qu'il est permis) sur une copie du plateau. */
export function playOn(board: Disc[], player: number, cell: number): { board: Disc[]; flipped: number[] } {
  const flipped = flipsFor(board, player, cell);
  const next = [...board];
  next[cell] = player as Disc;
  for (const f of flipped) next[f] = player as Disc;
  return { board: next, flipped };
}

/** Applique une action sans modifier l'état reçu. */
export function applyReversiAction(previous: ReversiState, action: ReversiAction): ReversiResult {
  if (previous.phase !== 'playing') return { ok: false, error: 'wrongPhase' };
  if (action.playerIndex !== previous.currentPlayer) return { ok: false, error: 'notYourTurn' };
  const player = action.playerIndex;
  if (flipsFor(previous.board, player, action.cell).length === 0) return { ok: false, error: 'illegalMove' };
  const state = structuredClone(previous);
  const { board, flipped } = playOn(state.board, player, action.cell);
  state.board = board;
  state.moves += 1;
  const other = 1 - player;
  let skipped = false;
  if (legalMoves(board, other).length > 0) {
    state.currentPlayer = other;
  } else if (legalMoves(board, player).length > 0) {
    // L'adversaire n'a aucun coup : il passe, et on rejoue.
    skipped = true;
  } else {
    const [a, b] = countDiscs(board);
    state.phase = 'gameOver';
    state.winners = a === b ? [0, 1] : [a > b ? 0 : 1];
  }
  state.lastMove = { playerIndex: player, cell: action.cell, flipped, skipped };
  return { ok: true, state };
}

export interface ReversiView {
  game: 'reversi';
  you: number;
  phase: ReversiState['phase'];
  players: { id: string; name: string; discs: number }[];
  board: Disc[];
  currentPlayer: number;
  /** Les coups permis au joueur dont c'est le tour. */
  legal: number[];
  lastMove: ReversiState['lastMove'];
  moves: number;
  winners: number[];
}

/** Tout est visible au Reversi. `you` vaut -1 pour un spectateur. */
export function reversiView(state: ReversiState, you: number): ReversiView {
  const counts = countDiscs(state.board);
  return {
    game: 'reversi',
    you,
    phase: state.phase,
    players: state.players.map((p, i) => ({ ...p, discs: counts[i]! })),
    board: state.board,
    currentPlayer: state.currentPlayer,
    legal: state.phase === 'playing' ? legalMoves(state.board, state.currentPlayer) : [],
    lastMove: state.lastMove,
    moves: state.moves,
    winners: state.winners,
  };
}

/**
 * Valeur de chaque case pour le bot : les coins valent cher, les cases qui les donnent à l'adversaire sont à éviter,
 * les bords sont bons.
 */
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

/** Ce que vaut le plateau pour `player` : la position des pions, plus sa liberté de jeu face à celle de l'autre. */
function evaluate(board: Disc[], player: number): number {
  let score = 0;
  for (let i = 0; i < SIZE; i++) {
    if (board[i] === player) score += WEIGHTS[i]!;
    else if (board[i] === 1 - player) score -= WEIGHTS[i]!;
  }
  const mobility = legalMoves(board, player).length - legalMoves(board, 1 - player).length;
  return score + 5 * mobility;
}

/** Recherche à `depth` coups d'avance (alpha-bêta), du point de vue de `player`. */
function search(board: Disc[], toMove: number, player: number, depth: number, alpha: number, beta: number): number {
  const moves = legalMoves(board, toMove);
  if (depth === 0 || (moves.length === 0 && legalMoves(board, 1 - toMove).length === 0)) {
    if (moves.length === 0 && legalMoves(board, 1 - toMove).length === 0) {
      const [a, b] = countDiscs(board);
      const diff = player === 0 ? a - b : b - a;
      return diff > 0 ? 10000 + diff : diff < 0 ? -10000 + diff : 0;
    }
    return evaluate(board, player);
  }
  if (moves.length === 0) return search(board, 1 - toMove, player, depth - 1, alpha, beta);
  if (toMove === player) {
    let best = -Infinity;
    for (const m of moves) {
      best = Math.max(best, search(playOn(board, toMove, m).board, 1 - toMove, player, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    best = Math.min(best, search(playOn(board, toMove, m).board, 1 - toMove, player, depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Le coup du bot. Facile : au hasard, avec une préférence pour les coins. Moyen : le meilleur coup immédiat d'après la
 * valeur des cases. Difficile : il regarde trois coups d'avance.
 */
export function reversiBotMove(state: ReversiState, index: number, random: () => number, level: 'easy' | 'normal' | 'hard' = 'normal'): number | null {
  const moves = legalMoves(state.board, index);
  if (moves.length === 0) return null;
  if (level === 'easy') {
    const corners = moves.filter((m) => [0, 7, 56, 63].includes(m));
    const pool = corners.length > 0 && random() < 0.5 ? corners : moves;
    return pool[Math.floor(random() * pool.length)]!;
  }
  const depth = level === 'hard' ? 3 : 1;
  let best: number[] = [];
  let bestScore = -Infinity;
  for (const m of moves) {
    const next = playOn(state.board, index, m).board;
    const score = depth === 1 ? evaluate(next, index) : search(next, 1 - index, index, depth - 1, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      best = [m];
    } else if (score === bestScore) best.push(m);
  }
  return best[Math.floor(random() * best.length)]!;
}
