import { describe, expect, it } from 'vitest';
import {
  type ChessState,
  FIRST_MOVE_MS,
  START_FEN,
  applyChessAction,
  canMate,
  chessBotAcceptsDraw,
  chessBotMove,
  chessLegalMoves,
  chessReplay,
  chessTimeLeft,
  chessToMove,
  chessView,
  createChess,
  createRng,
  holdChessClock,
  insufficientMaterial,
  parseFen,
  perft,
  squareName,
  toFen,
  toPgn,
} from '../src';

const players = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bruno' },
];

/** « e2e4 », « e7e8n » : un coup en notation longue. */
function parse(uci: string) {
  const sq = (s: string) => 'abcdefgh'.indexOf(s[0]!) + (Number(s[1]) - 1) * 8;
  const promotion = uci[4] ? ' pnbrqk'.indexOf(uci[4]) : undefined;
  return { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)), ...(promotion ? { promotion } : {}) };
}

function play(state: ChessState, moves: string, now = 0): ChessState {
  for (const uci of moves.split(' ').filter(Boolean)) {
    const result = applyChessAction(state, { type: 'move', playerIndex: chessToMove(state), ...parse(uci) }, now);
    if (!result.ok) throw new Error(`${uci} : ${result.error}`);
    state = result.state;
  }
  return state;
}

const fresh = (fen?: string, timeControl = 'none') => createChess(players, 1, timeControl, 0, { white: 0, ...(fen ? { fen } : {}) });

describe('Échecs : générateur de coups (perft)', () => {
  // Les positions de référence du wiki de la programmation des échecs, qui piègent roques, prises en passant et promotions.
  it.each([
    [START_FEN, [20, 400, 8902, 197281]],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
    ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
  ])('%s', (fen, counts) => {
    const pos = parseFen(fen);
    counts.forEach((count, i) => expect(perft(pos, i + 1)).toBe(count));
  });

  it('lit et écrit la notation FEN', () => {
    expect(toFen(parseFen(START_FEN))).toBe(START_FEN);
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
    expect(toFen(parseFen(fen))).toBe(fen);
    expect(squareName(0)).toBe('a1');
    expect(squareName(63)).toBe('h8');
  });
});

describe('Échecs : règles', () => {
  it('le mat du berger inversé : f3 e5 g4 Dh4 mat, les noirs gagnent', () => {
    const state = play(fresh(), 'f2f3 e7e5 g2g4 d8h4');
    expect(state.phase).toBe('gameOver');
    expect(state.end).toBe('checkmate');
    expect(state.winners).toEqual([1]);
    expect(state.moves.map((m) => m.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
  });

  it('refuse un coup interdit, et le coup de celui qui n’a pas le trait', () => {
    const state = fresh();
    expect(applyChessAction(state, { type: 'move', playerIndex: 0, ...parse('e2e5') }, 0)).toEqual({ ok: false, error: 'illegalMove' });
    expect(applyChessAction(state, { type: 'move', playerIndex: 1, ...parse('e7e5') }, 0)).toEqual({ ok: false, error: 'notYourTurn' });
    // Le roi ne peut pas se mettre en échec, ni une pièce clouée bouger.
    const pinned = fresh('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1');
    expect(chessLegalMoves(pinned.position).filter((m) => m.from === parse('e2e3').from)).toEqual([]);
  });

  it('roque des deux côtés, mais pas à travers une case attaquée', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    let state = play(fresh(fen), 'e1g1');
    expect(state.moves[0]!.san).toBe('O-O');
    expect(state.position.board[parse('f1f1').from]).toBe(4);
    state = play(state, 'e8c8');
    expect(state.moves[1]!.san).toBe('O-O-O');
    expect(state.position.board[parse('d8d8').from]).toBe(-4);
    // Une tour noire sur f8 tient f1 : pas de petit roque blanc.
    const blocked = fresh('5r1k/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    const castles = chessLegalMoves(blocked.position).filter((m) => m.from === 4 && Math.abs(m.to - m.from) === 2);
    expect(castles.map((m) => m.to)).toEqual([2]);
    // Le roi qui bouge perd ses deux roques.
    expect(play(fresh(fen), 'e1e2').position.castling & 3).toBe(0);
  });

  it('prise en passant, juste après le double pas', () => {
    const state = play(fresh(), 'e2e4 a7a6 e4e5 d7d5 e5d6');
    expect(state.moves[4]!.san).toBe('exd6');
    expect(state.position.board[parse('d5d5').from]).toBe(0);
    // Un coup plus tard, c'est trop tard.
    const late = play(fresh(), 'e2e4 a7a6 e4e5 d7d5 a2a3 a6a5');
    expect(chessLegalMoves(late.position).some((m) => m.to === parse('d6d6').from && m.from === parse('e5e5').from)).toBe(false);
  });

  it('promotion au choix, sous-promotion comprise', () => {
    const fen = '8/4P1k1/8/8/8/8/8/4K3 w - - 0 1';
    const promotions = chessLegalMoves(parseFen(fen)).filter((m) => m.from === parse('e7e7').from);
    expect(promotions.map((m) => m.promotion).sort()).toEqual([2, 3, 4, 5]);
    const state = play(fresh(fen), 'e7e8n');
    expect(state.moves[0]!.san).toBe('e8=N+');
    expect(state.position.board[60]).toBe(2);
  });

  it('précise la pièce quand deux pareilles vont sur la même case', () => {
    const state = play(fresh('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1'), 'a1d1');
    expect(state.moves[0]!.san).toBe('Rad1');
    const knights = play(fresh('4k3/8/8/1N6/8/1N6/8/4K3 w - - 0 1'), 'b3d4');
    expect(knights.moves[0]!.san).toBe('N3d4');
  });

  it('pat, matériel insuffisant, cinquante coups et triple répétition font nulle', () => {
    const stalemate = play(fresh('7k/8/5QK1/8/8/8/8/8 w - - 0 1'), 'f6f7');
    expect(stalemate.end).toBe('stalemate');
    expect(stalemate.winners).toEqual([]);

    const material = play(fresh('4k3/8/8/8/8/8/3p4/3BK3 w - - 0 1'), 'e1d2');
    expect(material.end).toBe('material');

    const fifty = play(fresh('4k3/8/8/8/8/8/8/R3K3 w - - 99 80'), 'a1a2');
    expect(fifty.end).toBe('fiftyMoves');

    const repeated = play(fresh(), 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1');
    expect(repeated.phase).toBe('playing');
    expect(play(repeated, 'f6g8').end).toBe('repetition');
  });

  it('sait qui peut encore mater', () => {
    expect(insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1').board)).toBe(true);
    expect(insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1').board)).toBe(true);
    expect(insufficientMaterial(parseFen('4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1').board)).toBe(true);
    expect(insufficientMaterial(parseFen('2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1').board)).toBe(false);
    expect(insufficientMaterial(parseFen('4k3/8/8/8/8/8/8/3NKN2 w - - 0 1').board)).toBe(false);
    expect(canMate(parseFen('4k3/8/8/8/8/8/8/4K2R w - - 0 1').board, 1)).toBe(true);
    expect(canMate(parseFen('4k3/8/8/8/8/8/8/4K2R w - - 0 1').board, -1)).toBe(false);
    expect(canMate(parseFen('4k3/8/8/8/8/8/8/3NK3 w - - 0 1').board, 1)).toBe(false);
  });

  it('abandon et nulle par accord', () => {
    const early = applyChessAction(play(fresh(), 'e2e4'), { type: 'resign', playerIndex: 1 }, 0);
    expect(early.ok && early.state.end).toBe('aborted');

    let state = play(fresh(), 'e2e4 e7e5');
    const resigned = applyChessAction(state, { type: 'resign', playerIndex: 1 }, 0);
    expect(resigned.ok && resigned.state.end).toBe('resign');
    expect(resigned.ok && resigned.state.winners).toEqual([0]);

    const offer = applyChessAction(state, { type: 'draw', playerIndex: 0, answer: 'offer' }, 0);
    if (!offer.ok) throw new Error(offer.error);
    expect(offer.state.drawOffer).toBe(0);
    // Une seule proposition par coup, et on ne peut pas accepter la sienne.
    expect(applyChessAction(offer.state, { type: 'draw', playerIndex: 0, answer: 'accept' }, 0)).toEqual({ ok: false, error: 'noDrawOffer' });
    const accepted = applyChessAction(offer.state, { type: 'draw', playerIndex: 1, answer: 'accept' }, 0);
    expect(accepted.ok && accepted.state.end).toBe('agreement');
    expect(accepted.ok && accepted.state.winners).toEqual([]);

    // Jouer sans accepter refuse la proposition.
    state = play(offer.state, 'g1f3');
    expect(state.drawOffer).toBe(0);
    state = play(state, 'b8c6');
    expect(state.drawOffer).toBe(null);
  });

  it('rejoue la partie coup par coup', () => {
    const state = play(fresh(), 'e2e4 e7e5 g1f3');
    const positions = chessReplay(state.start, state.moves);
    expect(positions).toHaveLength(4);
    expect(toFen(positions[3]!)).toBe(toFen(state.position));
  });
});

describe('Échecs : pendule', () => {
  it('le premier coup de chacun est gratuit, ensuite le temps file et l’incrément s’ajoute', () => {
    let state = createChess(players, 1, '3+2', 0, { white: 0 });
    state = play(state, 'e2e4', 20_000);
    state = play(state, 'e7e5', 25_000);
    expect(state.clock!.remaining).toEqual([180_000, 180_000]);
    state = play(state, 'g1f3', 30_000);
    expect(state.clock!.remaining).toEqual([177_000, 180_000]);
    expect(chessTimeLeft(state, 40_000)).toBe(170_000);
    const view = chessView(state, 0, 40_000);
    expect(view.clock).toEqual({ remaining: [177_000, 170_000], running: 1, increment: 2000 });
  });

  it('le drapeau tombe : défaite au temps, ou nulle si l’autre ne peut plus mater', () => {
    let state = play(createChess(players, 1, '1+0', 0, { white: 0 }), 'e2e4 e7e5', 0);
    expect(applyChessAction(state, { type: 'flag', playerIndex: 0 }, 1000)).toEqual({ ok: false, error: 'timeLeft' });
    const flagged = applyChessAction(state, { type: 'flag', playerIndex: 0 }, 60_000);
    expect(flagged.ok && flagged.state.end).toBe('time');
    expect(flagged.ok && flagged.state.winners).toEqual([1]);
    // Un coup arrivé trop tard ne compte pas.
    const late = applyChessAction(state, { type: 'move', playerIndex: 0, ...parse('g1f3') }, 61_000);
    expect(late.ok && late.state.end).toBe('time');
    expect(late.ok && late.state.moves).toHaveLength(2);

    state = play(createChess(players, 1, '1+0', 0, { white: 0, fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' }), 'a1a2 e8d8', 0);
    // Les blancs tombent, mais les noirs n'ont que leur roi : nulle.
    const vsMaterial = applyChessAction(state, { type: 'flag', playerIndex: 0 }, 60_000);
    expect(vsMaterial.ok && vsMaterial.state.end).toBe('timeVsMaterial');
    state = play(state, 'a2a3', 0);
    const bare = applyChessAction(state, { type: 'flag', playerIndex: 1 }, 60_000);
    expect(bare.ok && bare.state.end).toBe('time');
    expect(bare.ok && bare.state.winners).toEqual([0]);
  });

  it('sans premier coup dans les temps, la partie est annulée', () => {
    const state = createChess(players, 1, '5+0', 0, { white: 0 });
    expect(chessView(state, 0, 10_000).firstMoveMs).toBe(FIRST_MOVE_MS - 10_000);
    const aborted = applyChessAction(state, { type: 'flag', playerIndex: 0 }, FIRST_MOVE_MS);
    expect(aborted.ok && aborted.state.end).toBe('aborted');
  });

  it('la pause arrête la pendule', () => {
    let state = play(createChess(players, 1, '5+0', 0, { white: 0 }), 'e2e4 e7e5', 0);
    state = holdChessClock(state, true, 10_000);
    expect(state.clock!.remaining[0]).toBe(290_000);
    expect(chessTimeLeft(state, 500_000)).toBe(null);
    state = holdChessClock(state, false, 600_000);
    expect(chessTimeLeft(state, 605_000)).toBe(285_000);
  });
});

describe('Échecs : PGN', () => {
  it('écrit la partie avec ses en-têtes et son résultat', () => {
    const state = play(createChess(players, 1, '3+2', 0, { white: 1 }), 'f2f3 e7e5 g2g4 d8h4');
    const pgn = toPgn(chessView(state, 0, 0), new Date(2026, 10, 6), 'Atout');
    expect(pgn).toContain('[White "Bruno"]');
    expect(pgn).toContain('[Black "Alice"]');
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('[TimeControl "180+2"]');
    expect(pgn).toContain('[Date "2026.11.06"]');
    expect(pgn.trim().endsWith('1. f3 e5 2. g4 Qh4# 0-1')).toBe(true);
  });
});

describe('Échecs : bot', () => {
  it('voit le mat en un et prend la dame laissée en prise', () => {
    const mate = fresh('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    for (const level of ['normal', 'hard'] as const) {
      expect(chessBotMove(mate, 0, createRng(1), level, { nodes: 20_000 })).toEqual(parse('a1a8'));
    }
    const hanging = fresh('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1');
    expect(chessBotMove(hanging, 0, createRng(2), 'normal', { nodes: 20_000 })).toEqual(parse('e4d5'));
  });

  it('ne joue que quand c’est à lui, et accepte la nulle seulement s’il est moins bien', () => {
    const state = fresh();
    expect(chessBotMove(state, 1, createRng(1))).toBe(null);
    expect(chessBotAcceptsDraw(fresh('4k3/8/8/8/8/8/8/Q3K3 b - - 0 1'), 1)).toBe(true);
    expect(chessBotAcceptsDraw(fresh('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1'), 0)).toBe(false);
  });

  it('joue une partie entière contre lui-même sans coup interdit', () => {
    let state = fresh();
    const random = createRng(7);
    for (let ply = 0; ply < 160 && state.phase === 'playing'; ply++) {
      const level = ply % 2 === 0 ? 'easy' : 'normal';
      const move = chessBotMove(state, chessToMove(state), random, level, { nodes: 1500 });
      expect(move).not.toBe(null);
      const result = applyChessAction(state, { type: 'move', playerIndex: chessToMove(state), ...move! }, 0);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    expect(state.moves.length).toBeGreaterThan(10);
  });
});
