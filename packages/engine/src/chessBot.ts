/**
 * Le bot des échecs : une recherche alpha-bêta classique (approfondissement itératif, recherche de calme sur les
 * prises, coups tueurs) et une évaluation par matériel et tables de cases, qui passe du milieu de partie à la finale.
 * Trois niveaux : facile voit un coup et se trompe souvent, moyen calcule trois demi-coups, difficile cherche aussi
 * loin que son temps le permet.
 */
import {
  type ChessMove,
  type ChessPosition,
  type ChessState,
  BISHOP,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  chessToMove,
  codeMove,
  inCheck,
  leavesKingSafe,
  legalCodes,
  makeMove,
  positionKey,
  pseudoMoves,
} from './chess';

const VALUE = [0, 100, 320, 330, 500, 900, 0];
const MATE = 100_000;
const INFINITY = 1_000_000;

/** Tables de cases (vues des blancs, rangée 8 en haut, comme sur un diagramme). */
// prettier-ignore
const TABLES: Record<number, number[]> = {
  [PAWN]: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  [KNIGHT]: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  [BISHOP]: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  [ROOK]: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  [QUEEN]: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
};
// prettier-ignore
const KING_MIDDLE = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];
// prettier-ignore
const KING_END = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];
const PHASE = [0, 0, 1, 1, 2, 4, 0];

/** Case du diagramme (rangée 8 en haut) pour une pièce blanche ou noire posée sur `sq`. */
const tableIndex = (sq: number, white: boolean) => (white ? (7 - (sq >> 3)) * 8 + (sq & 7) : sq);
const centerDistance = (sq: number) => Math.max(3 - (sq & 7), (sq & 7) - 4, 3 - (sq >> 3), (sq >> 3) - 4);
const distance = (a: number, b: number) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));

/** Évaluation de la position, en centièmes de pion, du point de vue du joueur au trait. */
export function evaluate(pos: ChessPosition): number {
  const board = pos.board;
  let score = 0;
  let phase = 0;
  let whiteKing = 0;
  let blackKing = 0;
  let whiteBishops = 0;
  let blackBishops = 0;
  let material = 0;
  let pawnPush = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]!;
    if (p === 0) continue;
    const type = p > 0 ? p : -p;
    const white = p > 0;
    const sign = white ? 1 : -1;
    if (type === KING) {
      if (white) whiteKing = sq;
      else blackKing = sq;
      continue;
    }
    phase += PHASE[type]!;
    material += sign * VALUE[type]!;
    score += sign * (VALUE[type]! + TABLES[type]![tableIndex(sq, white)]!);
    if (type === BISHOP) {
      if (white) whiteBishops += 1;
      else blackBishops += 1;
    }
    // En finale, un pion avancé vaut de plus en plus : il file vers la promotion.
    if (type === PAWN) pawnPush += sign * (white ? sq >> 3 : 7 - (sq >> 3));
  }
  const middle = Math.min(phase, 24);
  const kingScore = (sq: number, white: boolean) => {
    const i = tableIndex(sq, white);
    return (KING_MIDDLE[i]! * middle + KING_END[i]! * (24 - middle)) / 24;
  };
  score += kingScore(whiteKing, true) - kingScore(blackKing, false);
  if (whiteBishops >= 2) score += 30;
  if (blackBishops >= 2) score -= 30;
  score += (pawnPush * 6 * (24 - middle)) / 24;
  // Finale gagnée : pousser le roi adverse vers le bord et en approcher le sien, pour finir par le mat.
  if (middle <= 10 && Math.abs(material) >= 300) {
    const winner = material > 0 ? 1 : -1;
    const loserKing = winner === 1 ? blackKing : whiteKing;
    score += winner * (centerDistance(loserKing) * 12 + (7 - distance(whiteKing, blackKing)) * 5);
  }
  return Math.round(score) * pos.turn;
}

interface Search {
  nodes: number;
  maxNodes: number;
  deadline: number;
  stopped: boolean;
  killers: number[][];
  history: Int32Array;
}

const victimOf = (pos: ChessPosition, m: number) => {
  const to = (m >> 6) & 63;
  const v = pos.board[to]!;
  // Prise en passant : la case d'arrivée est vide mais c'est un pion qui tombe.
  return v !== 0 ? Math.abs(v) : to === pos.ep && Math.abs(pos.board[m & 63]!) === PAWN ? PAWN : 0;
};

/** Range les coups : d'abord le meilleur connu, puis les prises (grosse victime, petit attaquant), les promotions, les coups tueurs. */
function order(pos: ChessPosition, moves: number[], s: Search, ply: number, first = -1): number[] {
  const killers = s.killers[ply] ?? [];
  const scored = moves.map((m) => {
    let score: number;
    if (m === first) score = 1_000_000;
    else {
      const victim = victimOf(pos, m);
      if (victim) score = 100_000 + victim * 100 - Math.abs(pos.board[m & 63]!);
      else if (m >> 12) score = 90_000 + (m >> 12);
      else if (killers.includes(m)) score = 80_000;
      else score = s.history[m & 4095]!;
    }
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.m);
}

const timeUp = (s: Search) => {
  if (s.stopped) return true;
  if ((s.nodes & 1023) === 0 && (s.nodes >= s.maxNodes || Date.now() >= s.deadline)) s.stopped = true;
  return s.stopped;
};

/** Recherche de calme : on ne s'arrête pas au milieu d'un échange de pièces. */
function quiesce(pos: ChessPosition, alpha: number, beta: number, s: Search, ply: number): number {
  s.nodes++;
  if (timeUp(s)) return 0;
  const stand = evaluate(pos);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  for (const m of order(pos, pseudoMoves(pos, true), s, ply)) {
    // Même en gagnant la pièce, on ne remonterait pas jusqu'à alpha : inutile de regarder.
    if (!(m >> 12) && stand + VALUE[victimOf(pos, m)]! + 200 < alpha) continue;
    const next = makeMove(pos, m);
    if (!leavesKingSafe(next)) continue;
    const score = -quiesce(next, -beta, -alpha, s, ply + 1);
    if (s.stopped) return 0;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** Le joueur au trait a encore une pièce autre que ses pions : sans elle, passer son tour peut être un piège (zugzwang). */
function hasPieces(pos: ChessPosition): boolean {
  for (const p of pos.board) {
    const type = p * pos.turn;
    if (type > PAWN && type < KING) return true;
  }
  return false;
}

function negamax(pos: ChessPosition, depth: number, alpha: number, beta: number, s: Search, ply: number, allowNull = true): number {
  const checked = inCheck(pos);
  // Un roi en échec mérite un demi-coup de plus : on ne coupe pas la recherche au milieu d'une attaque.
  if (checked && ply < 12) depth += 1;
  if (depth <= 0) return quiesce(pos, alpha, beta, s, ply);
  s.nodes++;
  if (timeUp(s)) return 0;
  if (pos.halfmove >= 100) return 0;
  // Coup nul : même en laissant jouer l'adversaire deux fois, la position tient au-dessus de beta ? Alors inutile de chercher plus.
  if (allowNull && !checked && depth >= 3 && beta < MATE - 100 && hasPieces(pos)) {
    const score = -negamax({ ...pos, turn: -pos.turn as 1 | -1, ep: -1 }, depth - 3, -beta, -beta + 1, s, ply + 1, false);
    if (s.stopped) return 0;
    if (score >= beta) return beta;
  }
  let best = -INFINITY;
  let legal = 0;
  for (const m of order(pos, pseudoMoves(pos), s, ply)) {
    const next = makeMove(pos, m);
    if (!leavesKingSafe(next)) continue;
    legal += 1;
    let score: number;
    if (legal === 1) score = -negamax(next, depth - 1, -beta, -alpha, s, ply + 1);
    else {
      // Les coups calmes rangés loin sont sans doute mauvais : on les regarde moins profond, et en fenêtre nulle ;
      // seul celui qui surprend est recherché à nouveau en entier.
      const quiet = !victimOf(pos, m) && !(m >> 12);
      const reduction = depth >= 3 && legal > 3 && quiet && !checked && !inCheck(next) ? (legal > 10 ? 2 : 1) : 0;
      score = -negamax(next, depth - 1 - reduction, -alpha - 1, -alpha, s, ply + 1);
      if (!s.stopped && score > alpha && (reduction > 0 || score < beta)) score = -negamax(next, depth - 1, -beta, -alpha, s, ply + 1);
    }
    if (s.stopped) return 0;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      if (!victimOf(pos, m) && !(m >> 12)) {
        const killers = (s.killers[ply] ??= []);
        if (!killers.includes(m)) {
          killers.unshift(m);
          killers.length = Math.min(killers.length, 2);
        }
        s.history[m & 4095] = s.history[m & 4095]! + depth * depth;
      }
      break;
    }
  }
  if (legal === 0) return checked ? -MATE + ply : 0;
  return best;
}

export type ChessBotLevel = 'easy' | 'normal' | 'hard';

const LEVELS: Record<ChessBotLevel, { depth: number; ms: number; margin: number; blunder: number }> = {
  easy: { depth: 1, ms: 150, margin: 90, blunder: 0.12 },
  normal: { depth: 3, ms: 500, margin: 25, blunder: 0 },
  hard: { depth: 30, ms: 1200, margin: 0, blunder: 0 },
};

/**
 * Note chaque coup du joueur au trait par approfondissement itératif. Les positions déjà vues dans la partie valent
 * nulle (0), pour que le bot ne répète pas une position gagnante et cherche la répétition quand il est perdu.
 */
export function rootScores(
  pos: ChessPosition,
  depth: number,
  limits: { ms: number; nodes?: number },
  seen: Record<string, number> = {},
  margin = 0,
): { move: number; score: number }[] {
  const s: Search = {
    nodes: 0,
    maxNodes: limits.nodes ?? Infinity,
    deadline: Date.now() + limits.ms,
    stopped: false,
    killers: [],
    history: new Int32Array(4096),
  };
  let results = legalCodes(pos).map((move) => ({ move, score: 0 }));
  if (results.length <= 1) return results;
  for (let d = 1; d <= depth; d++) {
    const current: { move: number; score: number }[] = [];
    let alpha = -INFINITY;
    for (const { move } of results) {
      const next = makeMove(pos, move);
      // Fenêtre élargie de `margin` : on note aussi les coups presque aussi bons que le meilleur, pour varier.
      const score = seen[positionKey(next)] ? 0 : -negamax(next, d - 1, -INFINITY, -(alpha - margin - 1), s, 1);
      if (s.stopped) break;
      current.push({ move, score });
      alpha = Math.max(alpha, score);
    }
    if (s.stopped && current.length < results.length) {
      // Itération inachevée : on garde l'ancienne, sauf si un coup déjà regardé s'est révélé meilleur.
      const top = current.sort((a, b) => b.score - a.score)[0];
      if (top && d > 1 && top.score > results[0]!.score) results = [top, ...results.filter((r) => r.move !== top.move)];
      break;
    }
    results = current.sort((a, b) => b.score - a.score);
    // Un mat trouvé : inutile d'aller plus loin.
    if (Math.abs(results[0]!.score) > MATE - 100) break;
  }
  return results;
}

/** Le coup du bot pour le joueur `index`, ou null si ce n'est pas à lui. */
export function chessBotMove(
  state: ChessState,
  index: number,
  random: () => number,
  level: ChessBotLevel = 'normal',
  limits: { ms?: number; nodes?: number } = {},
): ChessMove | null {
  if (state.phase !== 'playing' || chessToMove(state) !== index) return null;
  const settings = LEVELS[level] ?? LEVELS.normal;
  const legal = legalCodes(state.position);
  if (legal.length === 0) return null;
  if (random() < settings.blunder) return codeMove(legal[Math.floor(random() * legal.length)]!);
  // De la variété : en ouverture, ou au niveau facile, un coup presque aussi bon que le meilleur peut sortir.
  const margin = state.moves.length < 12 ? Math.max(settings.margin, 15) : settings.margin;
  const scores = rootScores(state.position, settings.depth, { ms: limits.ms ?? settings.ms, nodes: limits.nodes }, state.seen, margin);
  const best = scores[0]!.score;
  const close = scores.filter((r) => r.score >= best - margin && Math.abs(best) < MATE - 100);
  const pick = close.length > 0 ? close[Math.floor(random() * close.length)]! : scores[0]!;
  return codeMove(pick.move);
}

/** Le bot accepte la nulle quand il est moins bien, ou quand la position est morte. */
export function chessBotAcceptsDraw(state: ChessState, index: number): boolean {
  const pos = state.position;
  const fromMover = rootScores(pos, 2, { ms: 200 }, state.seen)[0]?.score ?? 0;
  const mine = chessToMove(state) === index ? fromMover : -fromMover;
  const pieces = pos.board.filter((p) => p !== 0 && Math.abs(p) !== PAWN && Math.abs(p) !== KING).length;
  return mine < -80 || (pieces <= 2 && Math.abs(mine) < 30);
}
