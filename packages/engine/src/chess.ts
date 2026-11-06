/**
 * Échecs à deux, règles de la FIDE : roque, prise en passant, promotion au choix, échec et mat, pat, triple répétition,
 * règle des 50 coups et matériel insuffisant, plus une pendule avec incrément. Une case est un nombre de 0 (a1) à 63
 * (h8) : rangée × 8 + colonne. Une pièce est un nombre signé, positif pour les blancs et négatif pour les noirs :
 * 1 pion, 2 cavalier, 3 fou, 4 tour, 5 dame, 6 roi.
 */

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

/** 1 pour les blancs, -1 pour les noirs. */
export type Side = 1 | -1;

export interface ChessPosition {
  board: number[];
  turn: Side;
  /** Roques encore permis : 1 petit roque blanc, 2 grand roque blanc, 4 petit roque noir, 8 grand roque noir. */
  castling: number;
  /** Case où une prise en passant est possible, -1 sinon. */
  ep: number;
  /** Demi-coups depuis la dernière prise ou le dernier coup de pion (règle des 50 coups). */
  halfmove: number;
  fullmove: number;
}

/** Un coup : case de départ, case d'arrivée, et la pièce choisie quand un pion est promu. */
export interface ChessMove {
  from: number;
  to: number;
  promotion?: number;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';
const LETTERS = ' PNBRQK';

const fileOf = (sq: number) => sq & 7;
const rankOf = (sq: number) => sq >> 3;
export const squareName = (sq: number) => `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;

function jumps(deltas: number[][]): number[][] {
  return Array.from({ length: 64 }, (_, sq) =>
    deltas.flatMap(([df, dr]) => {
      const f = fileOf(sq) + df!;
      const r = rankOf(sq) + dr!;
      return f >= 0 && f < 8 && r >= 0 && r < 8 ? [r * 8 + f] : [];
    }),
  );
}

const KNIGHT_TARGETS = jumps([
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
]);
const KING_TARGETS = jumps([
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]);
/** Cases qu'attaque un pion blanc (ou noir) posé sur chaque case. */
const WHITE_PAWN_ATTACKS = jumps([
  [-1, 1],
  [1, 1],
]);
const BLACK_PAWN_ATTACKS = jumps([
  [-1, -1],
  [1, -1],
]);
/** Les huit directions : les quatre premières pour la tour, les quatre suivantes pour le fou. */
const DIRECTIONS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
/** Pour chaque case et chaque direction, les cases traversées jusqu'au bord. */
const RAYS: number[][][] = Array.from({ length: 64 }, (_, sq) =>
  DIRECTIONS.map(([df, dr]) => {
    const ray: number[] = [];
    let f = fileOf(sq) + df!;
    let r = rankOf(sq) + dr!;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      ray.push(r * 8 + f);
      f += df!;
      r += dr!;
    }
    return ray;
  }),
);
/** Droits de roque perdus quand une pièce part de cette case ou y est prise (roi ou tour d'origine). */
const CASTLING_LOST: Record<number, number> = { 4: 3, 0: 2, 7: 1, 60: 12, 56: 8, 63: 4 };

/** La case est-elle attaquée par une pièce de la couleur `by` ? */
export function isAttacked(board: number[], sq: number, by: Side): boolean {
  // Un pion de `by` attaque `sq` depuis les cases qu'attaquerait un pion adverse posé sur `sq`.
  for (const s of (by === 1 ? BLACK_PAWN_ATTACKS : WHITE_PAWN_ATTACKS)[sq]!) if (board[s] === by * PAWN) return true;
  for (const s of KNIGHT_TARGETS[sq]!) if (board[s] === by * KNIGHT) return true;
  for (const s of KING_TARGETS[sq]!) if (board[s] === by * KING) return true;
  const rays = RAYS[sq]!;
  for (let d = 0; d < 8; d++) {
    const slider = by * (d < 4 ? ROOK : BISHOP);
    for (const s of rays[d]!) {
      const p = board[s]!;
      if (p === 0) continue;
      if (p === slider || p === by * QUEEN) return true;
      break;
    }
  }
  return false;
}

export const kingSquare = (board: number[], color: Side) => board.indexOf(color * KING);

export function inCheck(pos: ChessPosition): boolean {
  return isAttacked(pos.board, kingSquare(pos.board, pos.turn), -pos.turn as Side);
}

/** Coup codé dans un nombre, pour aller vite : départ, arrivée et promotion. */
export const moveCode = (from: number, to: number, promotion = 0) => from | (to << 6) | (promotion << 12);
export const codeMove = (m: number): ChessMove => {
  const promotion = m >> 12;
  return promotion ? { from: m & 63, to: (m >> 6) & 63, promotion } : { from: m & 63, to: (m >> 6) & 63 };
};

/**
 * Coups possibles sans regarder si le roi reste en échec. `noisy` : seulement les prises et les promotions en dame
 * (pour la recherche du bot).
 */
export function pseudoMoves(pos: ChessPosition, noisy = false): number[] {
  const { board, turn } = pos;
  const moves: number[] = [];
  const lastRank = turn === 1 ? 7 : 0;
  const pawnPush = (from: number, to: number) => {
    if (rankOf(to) !== lastRank) moves.push(moveCode(from, to));
    else if (noisy) moves.push(moveCode(from, to, QUEEN));
    else for (const promotion of [QUEEN, KNIGHT, ROOK, BISHOP]) moves.push(moveCode(from, to, promotion));
  };
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]! * turn;
    if (p <= 0) continue;
    if (p === PAWN) {
      const one = sq + 8 * turn;
      if (board[one] === 0) {
        if (!noisy || rankOf(one) === lastRank) pawnPush(sq, one);
        const two = one + 8 * turn;
        if (!noisy && rankOf(sq) === (turn === 1 ? 1 : 6) && board[two] === 0) moves.push(moveCode(sq, two));
      }
      for (const t of (turn === 1 ? WHITE_PAWN_ATTACKS : BLACK_PAWN_ATTACKS)[sq]!) {
        if (board[t]! * turn < 0) pawnPush(sq, t);
        else if (t === pos.ep) moves.push(moveCode(sq, t));
      }
    } else if (p === KNIGHT || p === KING) {
      for (const t of (p === KNIGHT ? KNIGHT_TARGETS : KING_TARGETS)[sq]!) {
        const q = board[t]! * turn;
        if (q < 0 || (q === 0 && !noisy)) moves.push(moveCode(sq, t));
      }
    } else {
      const first = p === BISHOP ? 4 : 0;
      const last = p === ROOK ? 4 : 8;
      const rays = RAYS[sq]!;
      for (let d = first; d < last; d++) {
        for (const t of rays[d]!) {
          const q = board[t]! * turn;
          if (q === 0) {
            if (!noisy) moves.push(moveCode(sq, t));
            continue;
          }
          if (q < 0) moves.push(moveCode(sq, t));
          break;
        }
      }
    }
  }
  if (!noisy) castlingMoves(pos, moves);
  return moves;
}

function castlingMoves(pos: ChessPosition, moves: number[]) {
  const { board, turn, castling } = pos;
  const home = turn === 1 ? 0 : 56;
  const enemy = -turn as Side;
  const king = home + 4;
  if (board[king] !== turn * KING || !(castling & (turn === 1 ? 3 : 12))) return;
  if (isAttacked(board, king, enemy)) return;
  const kingside = turn === 1 ? 1 : 4;
  const queenside = turn === 1 ? 2 : 8;
  if (
    castling & kingside &&
    board[home + 5] === 0 &&
    board[home + 6] === 0 &&
    board[home + 7] === turn * ROOK &&
    !isAttacked(board, home + 5, enemy) &&
    !isAttacked(board, home + 6, enemy)
  ) {
    moves.push(moveCode(king, home + 6));
  }
  if (
    castling & queenside &&
    board[home + 3] === 0 &&
    board[home + 2] === 0 &&
    board[home + 1] === 0 &&
    board[home] === turn * ROOK &&
    !isAttacked(board, home + 3, enemy) &&
    !isAttacked(board, home + 2, enemy)
  ) {
    moves.push(moveCode(king, home + 2));
  }
}

/** La position après le coup (supposé possible), sans toucher à l'ancienne. */
export function makeMove(pos: ChessPosition, m: number): ChessPosition {
  const from = m & 63;
  const to = (m >> 6) & 63;
  const promotion = m >> 12;
  const { turn } = pos;
  const board = pos.board.slice();
  const piece = board[from]!;
  const type = piece * turn;
  let captured = board[to]!;
  board[to] = promotion ? turn * promotion : piece;
  board[from] = 0;
  let ep = -1;
  if (type === PAWN) {
    if (to === pos.ep && captured === 0 && fileOf(from) !== fileOf(to)) {
      const taken = to - 8 * turn;
      captured = board[taken]!;
      board[taken] = 0;
    }
    // La case de prise en passant n'est notée que si un pion adverse peut vraiment prendre (utile pour les répétitions).
    if (Math.abs(to - from) === 16) {
      const enemyPawn = -turn * PAWN;
      if ((fileOf(to) > 0 && board[to - 1] === enemyPawn) || (fileOf(to) < 7 && board[to + 1] === enemyPawn)) ep = (from + to) / 2;
    }
  } else if (type === KING && Math.abs(to - from) === 2) {
    const rookFrom = to > from ? to + 1 : to - 2;
    const rookTo = to > from ? to - 1 : to + 1;
    board[rookTo] = board[rookFrom]!;
    board[rookFrom] = 0;
  }
  let castling = pos.castling;
  if (castling) castling &= ~((CASTLING_LOST[from] ?? 0) | (CASTLING_LOST[to] ?? 0));
  return {
    board,
    turn: -turn as Side,
    castling,
    ep,
    halfmove: type === PAWN || captured !== 0 ? 0 : pos.halfmove + 1,
    fullmove: turn === -1 ? pos.fullmove + 1 : pos.fullmove,
  };
}

/** Le coup laisse-t-il le roi de celui qui l'a joué hors d'échec ? */
export const leavesKingSafe = (after: ChessPosition) => !isAttacked(after.board, kingSquare(after.board, -after.turn as Side), after.turn);

/** Coups permis, codés. */
export function legalCodes(pos: ChessPosition): number[] {
  return pseudoMoves(pos).filter((m) => leavesKingSafe(makeMove(pos, m)));
}

export function chessLegalMoves(pos: ChessPosition): ChessMove[] {
  return legalCodes(pos).map(codeMove);
}

/**
 * Cases qu'une pièce pourrait atteindre sur un échiquier vide : pour préparer un coup pendant le tour de l'autre
 * (prémouvement). Le coup ne sera joué que s'il est permis quand vient son tour.
 */
export function premoveTargets(board: number[], from: number): number[] {
  const p = board[from] ?? 0;
  const type = Math.abs(p);
  const side = p > 0 ? 1 : -1;
  if (type === KNIGHT) return [...KNIGHT_TARGETS[from]!];
  if (type === KING) {
    const home = side === 1 ? 4 : 60;
    return from === home ? [...KING_TARGETS[from]!, home + 2, home - 2] : [...KING_TARGETS[from]!];
  }
  if (type === PAWN) {
    const one = from + 8 * side;
    if (one < 0 || one > 63) return [];
    const targets = [one, ...(side === 1 ? WHITE_PAWN_ATTACKS : BLACK_PAWN_ATTACKS)[from]!];
    if (rankOf(from) === (side === 1 ? 1 : 6)) targets.push(one + 8 * side);
    return targets;
  }
  if (type === 0) return [];
  const first = type === BISHOP ? 4 : 0;
  const last = type === ROOK ? 4 : 8;
  return RAYS[from]!.slice(first, last).flat();
}


/** Nombre de positions atteintes après `depth` demi-coups (pour vérifier le générateur de coups). */
export function perft(pos: ChessPosition, depth: number): number {
  const moves = legalCodes(pos);
  if (depth <= 1) return depth === 1 ? moves.length : 1;
  let total = 0;
  for (const m of moves) total += perft(makeMove(pos, m), depth - 1);
  return total;
}

export function parseFen(fen: string): ChessPosition {
  const [placement = '', turn = 'w', castling = '-', ep = '-', halfmove = '0', fullmove = '1'] = fen.trim().split(/\s+/);
  const board = Array.from({ length: 64 }, () => 0);
  placement.split('/').forEach((row, i) => {
    let file = 0;
    for (const c of row) {
      if (/\d/.test(c)) {
        file += Number(c);
        continue;
      }
      const type = LETTERS.indexOf(c.toUpperCase());
      if (type > 0 && file < 8) board[(7 - i) * 8 + file] = c === c.toUpperCase() ? type : -type;
      file += 1;
    }
  });
  const rights = (castling.includes('K') ? 1 : 0) | (castling.includes('Q') ? 2 : 0) | (castling.includes('k') ? 4 : 0) | (castling.includes('q') ? 8 : 0);
  const epSquare = ep === '-' ? -1 : FILES.indexOf(ep[0] ?? '') + (Number(ep[1]) - 1) * 8;
  return { board, turn: turn === 'b' ? -1 : 1, castling: rights, ep: epSquare, halfmove: Number(halfmove) || 0, fullmove: Number(fullmove) || 1 };
}

export function toFen(pos: ChessPosition): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[r * 8 + f]!;
      if (p === 0) {
        empty += 1;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      const letter = LETTERS[Math.abs(p)]!;
      row += p > 0 ? letter : letter.toLowerCase();
    }
    rows.push(row + (empty ? empty : ''));
  }
  const castling = ['K', 'Q', 'k', 'q'].filter((_, i) => pos.castling & (1 << i)).join('') || '-';
  return `${rows.join('/')} ${pos.turn === 1 ? 'w' : 'b'} ${castling} ${pos.ep < 0 ? '-' : squareName(pos.ep)} ${pos.halfmove} ${pos.fullmove}`;
}

/** Ce qui identifie une position pour la triple répétition : pièces, trait, roques et prise en passant. */
export function positionKey(pos: ChessPosition): string {
  return `${pos.board.map((p) => 'kqrbnp.PNBRQK'[p + 6]).join('')}${pos.turn}${pos.castling}${pos.ep}`;
}

/** Notation algébrique du coup (en lettres anglaises, comme dans une PGN) : « Nf3 », « exd5 », « O-O », « e8=Q# ». */
export function toSan(pos: ChessPosition, m: number, legal = legalCodes(pos)): string {
  const { from, to, promotion } = codeMove(m);
  const type = Math.abs(pos.board[from]!);
  let san: string;
  if (type === KING && Math.abs(to - from) === 2) {
    san = to > from ? 'O-O' : 'O-O-O';
  } else if (type === PAWN) {
    const capture = fileOf(from) !== fileOf(to);
    san = `${capture ? `${FILES[fileOf(from)]}x` : ''}${squareName(to)}${promotion ? `=${LETTERS[promotion]}` : ''}`;
  } else {
    // Deux pièces pareilles peuvent aller sur la même case : on précise la colonne, sinon la rangée, sinon les deux.
    const rivals = legal.map(codeMove).filter((o) => o.to === to && o.from !== from && Math.abs(pos.board[o.from]!) === type);
    let which = '';
    if (rivals.length > 0) {
      if (rivals.every((o) => fileOf(o.from) !== fileOf(from))) which = FILES[fileOf(from)]!;
      else if (rivals.every((o) => rankOf(o.from) !== rankOf(from))) which = String(rankOf(from) + 1);
      else which = squareName(from);
    }
    san = `${LETTERS[type]}${which}${pos.board[to] !== 0 ? 'x' : ''}${squareName(to)}`;
  }
  const after = makeMove(pos, m);
  if (inCheck(after)) san += legalCodes(after).length === 0 ? '#' : '+';
  return san;
}

/** Plus personne ne peut faire mat : deux rois seuls, un roi et une pièce mineure, ou seulement des fous de même couleur. */
export function insufficientMaterial(board: number[]): boolean {
  const minors: { type: number; sq: number }[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const type = Math.abs(board[sq]!);
    if (type === 0 || type === KING) continue;
    if (type === PAWN || type === ROOK || type === QUEEN) return false;
    minors.push({ type, sq });
  }
  if (minors.length <= 1) return true;
  const shade = (sq: number) => (fileOf(sq) + rankOf(sq)) % 2;
  return minors.every((m) => m.type === BISHOP && shade(m.sq) === shade(minors[0]!.sq));
}

/** La couleur `color` a-t-elle de quoi mater (pour savoir si une chute du drapeau adverse lui donne la victoire) ? */
export function canMate(board: number[], color: Side): boolean {
  const mine: { type: number; sq: number }[] = [];
  let theirs = 0;
  board.forEach((p, sq) => {
    if (p * color > 0 && p * color !== KING) mine.push({ type: Math.abs(p), sq });
    else if (p * color < 0 && p * color !== -KING) theirs += 1;
  });
  if (mine.some((m) => m.type === PAWN || m.type === ROOK || m.type === QUEEN)) return true;
  if (mine.length === 0) return false;
  // Une seule pièce mineure (ou des fous tous de la même couleur) : le mat n'est possible qu'avec des pièces adverses
  // qui enferment leur propre roi.
  const shade = (sq: number) => (fileOf(sq) + rankOf(sq)) % 2;
  const sameBishops = mine.every((m) => m.type === BISHOP && shade(m.sq) === shade(mine[0]!.sq));
  return mine.length >= 2 && !sameBishops ? true : theirs > 0;
}

// ————————————————————————————————————— La partie —————————————————————————————————————

/** Cadences proposées : temps de départ en minutes et incrément en secondes. */
export const TIME_CONTROLS = [
  { id: '1+0', minutes: 1, increment: 0, label: 'Bullet 1 min' },
  { id: '3+2', minutes: 3, increment: 2, label: 'Blitz 3 + 2' },
  { id: '5+0', minutes: 5, increment: 0, label: 'Blitz 5 min' },
  { id: '10+0', minutes: 10, increment: 0, label: 'Rapide 10 min' },
  { id: '15+10', minutes: 15, increment: 10, label: 'Rapide 15 + 10' },
  { id: '30+0', minutes: 30, increment: 0, label: 'Classique 30 min' },
] as const;
export const DEFAULT_TIME_CONTROL = '5+0';
/** Sans pendule : seulement à l'entraînement. */
export const NO_CLOCK = 'none';
/** Temps laissé à chacun pour jouer son premier coup ; au-delà, la partie est annulée. */
export const FIRST_MOVE_MS = 30_000;

export type ChessEnd =
  | 'checkmate'
  | 'resign'
  | 'time'
  | 'abandon'
  | 'stalemate'
  | 'repetition'
  | 'fiftyMoves'
  | 'material'
  | 'agreement'
  | 'timeVsMaterial'
  | 'aborted';

export interface ChessClock {
  /** Temps de départ et incrément, en millisecondes. */
  initial: number;
  increment: number;
  /** Temps qu'il reste à chaque joueur au début de son tour. */
  remaining: number[];
  /** Début du tour en cours (horloge du serveur) ; null quand la pendule est arrêtée. */
  since: number | null;
}

export interface ChessState {
  seed: number;
  phase: 'playing' | 'gameOver';
  players: { id: string; name: string }[];
  /** Le joueur qui a les blancs (0 ou 1). */
  white: number;
  timeControl: string;
  start: ChessPosition;
  position: ChessPosition;
  /** Coups joués depuis le départ, avec leur notation. */
  moves: (ChessMove & { san: string })[];
  /** Combien de fois chaque position a été vue (triple répétition). */
  seen: Record<string, number>;
  clock: ChessClock | null;
  /** Le joueur qui propose la nulle, s'il y en a un. */
  drawOffer: number | null;
  /** Nombre de coups joués quand chacun a proposé la nulle pour la dernière fois (une proposition par coup). */
  offeredAt: number[];
  end: ChessEnd | null;
  winners: number[];
}

export type ChessAction =
  | ({ type: 'move'; playerIndex: number } & ChessMove)
  | { type: 'resign'; playerIndex: number }
  | { type: 'draw'; playerIndex: number; answer: 'offer' | 'accept' | 'decline' }
  | { type: 'flag'; playerIndex: number };
export type ChessError = 'wrongPhase' | 'notYourTurn' | 'illegalMove' | 'noDrawOffer' | 'timeLeft';
export type ChessResult = { ok: true; state: ChessState } | { ok: false; error: ChessError };

export const chessToMove = (state: ChessState) => (state.position.turn === 1 ? state.white : 1 - state.white);
const colorOf = (state: ChessState, index: number): Side => (index === state.white ? 1 : -1);

/** `white` : le joueur qui a les blancs (tiré au sort par défaut) ; `fen` : une autre position de départ (pour les tests). */
export function createChess(
  players: { id: string; name: string }[],
  seed: number,
  timeControl: string,
  now: number,
  options: { white?: number; fen?: string } = {},
): ChessState {
  if (players.length !== 2) throw new Error('Les échecs se jouent à 2');
  const control = TIME_CONTROLS.find((c) => c.id === timeControl);
  const start = parseFen(options.fen ?? START_FEN);
  const white = options.white ?? seed % 2;
  return {
    seed,
    phase: 'playing',
    players: players.map((p) => ({ ...p })),
    white,
    timeControl: control ? control.id : NO_CLOCK,
    start,
    position: start,
    moves: [],
    seen: { [positionKey(start)]: 1 },
    clock: control
      ? { initial: control.minutes * 60_000, increment: control.increment * 1000, remaining: [control.minutes * 60_000, control.minutes * 60_000], since: now }
      : null,
    drawOffer: null,
    offeredAt: [-1, -1],
    end: null,
    winners: [],
  };
}

/** La pendule ne décompte qu'à partir du premier coup de chacun : avant, c'est le délai du premier coup. */
const clockRunning = (state: ChessState) => state.moves.length >= 2;

/** Temps restant du joueur au trait (ou délai de son premier coup), à l'instant `now` ; null sans pendule qui tourne. */
export function chessTimeLeft(state: ChessState, now: number): number | null {
  const clock = state.clock;
  if (!clock || clock.since === null || state.phase !== 'playing') return null;
  const elapsed = now - clock.since;
  return Math.max(0, clockRunning(state) ? clock.remaining[chessToMove(state)]! - elapsed : FIRST_MOVE_MS - elapsed);
}

/** Arrête la pendule (pause, fin de partie) en décomptant le temps du tour en cours, ou la relance à `now`. */
export function holdChessClock(state: ChessState, held: boolean, now: number): ChessState {
  const clock = state.clock;
  if (!clock || state.phase !== 'playing') return state;
  if (!held) return clock.since === null ? { ...state, clock: { ...clock, since: now } } : state;
  if (clock.since === null) return state;
  const remaining = [...clock.remaining];
  if (clockRunning(state)) remaining[chessToMove(state)] = Math.max(0, remaining[chessToMove(state)]! - (now - clock.since));
  return { ...state, clock: { ...clock, remaining, since: null } };
}

function finish(state: ChessState, end: ChessEnd, winners: number[], now: number): ChessState {
  const held = holdChessClock(state, true, now);
  return { ...held, phase: 'gameOver', end, winners, drawOffer: null };
}

/** Le joueur au trait a dépassé son temps : il perd, sauf si l'autre ne peut plus mater (nulle). */
function flagged(state: ChessState, now: number): ChessState {
  const mover = chessToMove(state);
  if (!clockRunning(state)) return finish(state, 'aborted', [], now);
  const lost = finish(state, 'time', [1 - mover], now);
  const clock = lost.clock!;
  const remaining = [...clock.remaining];
  remaining[mover] = 0;
  const ended = { ...lost, clock: { ...clock, remaining } };
  return canMate(state.position.board, colorOf(state, 1 - mover)) ? ended : { ...ended, end: 'timeVsMaterial', winners: [] };
}

/** Un joueur parti pour de bon : l'autre réclame la victoire. */
export function forfeitChess(state: ChessState, loser: number, now: number): ChessState {
  if (state.phase !== 'playing') return state;
  return state.moves.length < 2 ? finish(state, 'aborted', [], now) : finish(state, 'abandon', [1 - loser], now);
}

export function applyChessAction(previous: ChessState, action: ChessAction, now: number): ChessResult {
  if (previous.phase !== 'playing') return { ok: false, error: 'wrongPhase' };
  const state = previous;
  const me = action.playerIndex;
  if (me !== 0 && me !== 1) return { ok: false, error: 'notYourTurn' };
  const mover = chessToMove(state);
  const left = chessTimeLeft(state, now);

  if (action.type === 'resign') {
    // Abandonner avant que chacun ait joué annule simplement la partie.
    return { ok: true, state: state.moves.length < 2 ? finish(state, 'aborted', [], now) : finish(state, 'resign', [1 - me], now) };
  }
  if (action.type === 'draw') {
    if (action.answer === 'offer') {
      if (state.drawOffer !== null || state.offeredAt[me] === state.moves.length || state.moves.length < 2) return { ok: false, error: 'noDrawOffer' };
      const offeredAt = [...state.offeredAt];
      offeredAt[me] = state.moves.length;
      return { ok: true, state: { ...state, drawOffer: me, offeredAt } };
    }
    if (state.drawOffer === null || state.drawOffer === me) return { ok: false, error: 'noDrawOffer' };
    return { ok: true, state: action.answer === 'accept' ? finish(state, 'agreement', [], now) : { ...state, drawOffer: null } };
  }
  if (me !== mover) return { ok: false, error: 'notYourTurn' };
  if (action.type === 'flag') {
    if (left === null || left > 0) return { ok: false, error: 'timeLeft' };
    return { ok: true, state: flagged(state, now) };
  }

  // Temps dépassé avant que le coup arrive : le drapeau tombe, le coup ne compte pas.
  if (left !== null && left <= 0) return { ok: true, state: flagged(state, now) };
  const promotion = action.promotion ?? 0;
  const code = moveCode(action.from, action.to, promotion);
  const legal = legalCodes(state.position);
  if (!Number.isInteger(action.from) || !Number.isInteger(action.to) || !legal.includes(code)) return { ok: false, error: 'illegalMove' };

  const san = toSan(state.position, code, legal);
  const position = makeMove(state.position, code);
  const key = positionKey(position);
  const seen = { ...state.seen, [key]: (state.seen[key] ?? 0) + 1 };
  let clock = state.clock;
  if (clock) {
    const remaining = [...clock.remaining];
    if (clockRunning(state)) remaining[mover] = left! + clock.increment;
    clock = { ...clock, remaining, since: now };
  }
  const next: ChessState = {
    ...state,
    position,
    moves: [...state.moves, { ...codeMove(code), san }],
    seen,
    clock,
    // Jouer sans accepter refuse la nulle proposée par l'autre.
    drawOffer: state.drawOffer === mover ? mover : null,
  };

  const replies = legalCodes(position);
  if (replies.length === 0) return { ok: true, state: inCheck(position) ? finish(next, 'checkmate', [mover], now) : finish(next, 'stalemate', [], now) };
  if (insufficientMaterial(position.board)) return { ok: true, state: finish(next, 'material', [], now) };
  if (seen[key]! >= 3) return { ok: true, state: finish(next, 'repetition', [], now) };
  if (position.halfmove >= 100) return { ok: true, state: finish(next, 'fiftyMoves', [], now) };
  return { ok: true, state: next };
}

/** Les positions successives de la partie, du départ au dernier coup (pour revoir la partie coup par coup). */
export function chessReplay(start: ChessPosition, moves: ChessMove[]): ChessPosition[] {
  const positions = [start];
  for (const m of moves) positions.push(makeMove(positions[positions.length - 1]!, moveCode(m.from, m.to, m.promotion ?? 0)));
  return positions;
}

export interface ChessView {
  game: 'chess';
  you: number;
  phase: 'playing' | 'gameOver';
  players: { id: string; name: string }[];
  white: number;
  timeControl: string;
  /** ChessPosition de départ et coups joués : de quoi revoir toute la partie. */
  startFen: string;
  fen: string;
  board: number[];
  currentPlayer: number;
  /** Coups permis au joueur au trait (vide pour les autres). */
  legal: ChessMove[];
  moves: (ChessMove & { san: string })[];
  /** Case du roi en échec, -1 sinon. */
  check: number;
  /** Temps de chacun à l'instant de l'envoi, et le joueur dont la pendule tourne. */
  clock: { remaining: number[]; running: number | null; increment: number } | null;
  /** Délai du premier coup du joueur au trait, tant que la pendule ne tourne pas. */
  firstMoveMs: number | null;
  drawOffer: number | null;
  /** Le joueur peut proposer la nulle maintenant. */
  canOfferDraw: boolean;
  end: ChessEnd | null;
  winners: number[];
}

export function chessView(state: ChessState, you: number, now: number): ChessView {
  const mover = chessToMove(state);
  const playing = state.phase === 'playing';
  const left = chessTimeLeft(state, now);
  const clock = state.clock;
  const remaining = clock ? [...clock.remaining] : [];
  if (clock && left !== null && clockRunning(state)) remaining[mover] = left;
  const pos = state.position;
  return {
    game: 'chess',
    you,
    phase: state.phase,
    players: state.players.map((p) => ({ ...p })),
    white: state.white,
    timeControl: state.timeControl,
    startFen: toFen(state.start),
    fen: toFen(pos),
    board: [...pos.board],
    currentPlayer: playing ? mover : -1,
    legal: playing && you === mover ? chessLegalMoves(pos) : [],
    moves: state.moves.map((m) => ({ ...m })),
    check: inCheck(pos) ? kingSquare(pos.board, pos.turn) : -1,
    clock: clock ? { remaining, running: playing && clock.since !== null && clockRunning(state) ? mover : null, increment: clock.increment } : null,
    firstMoveMs: playing && clock && !clockRunning(state) ? left : null,
    drawOffer: state.drawOffer,
    canOfferDraw: playing && you >= 0 && state.drawOffer === null && state.moves.length >= 2 && state.offeredAt[you] !== state.moves.length,
    end: state.end,
    winners: [...state.winners],
  };
}

/** Résultat noté à la façon d'une PGN : « 1-0 », « 0-1 », « 1/2-1/2 », ou « * » si la partie continue. */
export function chessResultText(view: { phase: string; winners: number[]; white: number; end: ChessEnd | null }): string {
  if (view.phase !== 'gameOver' || view.end === 'aborted') return '*';
  if (view.winners.length === 0) return '1/2-1/2';
  return view.winners[0] === view.white ? '1-0' : '0-1';
}

/** La partie au format PGN, à coller dans n'importe quel logiciel d'analyse. */
export function toPgn(view: Pick<ChessView, 'players' | 'white' | 'moves' | 'phase' | 'winners' | 'end' | 'timeControl' | 'startFen'>, date: Date, site: string): string {
  const result = chessResultText(view);
  const control = TIME_CONTROLS.find((c) => c.id === view.timeControl);
  const pad = (n: number) => String(n).padStart(2, '0');
  const headers = [
    ['Event', 'Partie amicale'],
    ['Site', site],
    ['Date', `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`],
    ['White', view.players[view.white]?.name ?? '?'],
    ['Black', view.players[1 - view.white]?.name ?? '?'],
    ['Result', result],
    ['TimeControl', control ? `${control.minutes * 60}+${control.increment}` : '-'],
    ...(view.startFen !== START_FEN ? [['SetUp', '1'], ['FEN', view.startFen]] : []),
  ];
  const blackFirst = view.startFen.split(' ')[1] === 'b';
  const firstNumber = Number(view.startFen.split(' ')[5]) || 1;
  const words: string[] = [];
  view.moves.forEach((m, i) => {
    const ply = i + (blackFirst ? 1 : 0);
    const number = firstNumber + Math.floor(ply / 2);
    if (ply % 2 === 0) words.push(`${number}.`);
    else if (i === 0) words.push(`${number}...`);
    words.push(m.san);
  });
  words.push(result);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > 80) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return `${headers.map(([k, v]) => `[${k} "${v}"]`).join('\n')}\n\n${lines.join('\n')}\n`;
}
