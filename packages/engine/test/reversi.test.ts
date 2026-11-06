import { describe, expect, it } from 'vitest';
import { type Disc, type ReversiState, applyReversiAction, countDiscs, createReversi, createRng, flipsFor, legalMoves, reversiBotMove, reversiView } from '../src';

const players = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bruno' },
];

function move(state: ReversiState, cell: number): ReversiState {
  const result = applyReversiAction(state, { type: 'move', playerIndex: state.currentPlayer, cell });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** Un plateau dessiné en texte, ligne par ligne : « o » pour le joueur 0, « x » pour le joueur 1, « . » vide. */
function board(...rows: string[]): Disc[] {
  return rows
    .join('')
    .split('')
    .map((c) => (c === 'o' ? 0 : c === 'x' ? 1 : -1));
}

describe('Reversi', () => {
  it('part de quatre pions en croix, l’hôte commence avec quatre coups possibles', () => {
    const state = createReversi(players, 1);
    expect(countDiscs(state.board)).toEqual([2, 2]);
    expect(state.currentPlayer).toBe(0);
    expect(legalMoves(state.board, 0).sort((a, b) => a - b)).toEqual([19, 26, 37, 44]);
    expect(() => createReversi(players.slice(0, 1), 1)).toThrow();
  });

  it('retourne les pions encadrés, dans plusieurs directions à la fois', () => {
    const b = board(
      '........',
      '.o......',
      '..x.....',
      '...x....',
      '.xxx.o..',
      '....x...',
      '....o...',
      '........',
    );
    // En E5 (case 36) : la diagonale D4-C3 est fermée par B2, la colonne E6 par E7, mais à gauche B5-D5 reste ouvert.
    expect(flipsFor(b, 0, 36).sort((a, b) => a - b)).toEqual([18, 27, 44]);
    // En A5 (case 32) : B5-D5 ne sont fermés par rien, rien ne se retourne.
    expect(flipsFor(b, 0, 32)).toEqual([]);
    // Une case occupée n'est jamais jouable.
    expect(flipsFor(b, 0, 33)).toEqual([]);
  });

  it('refuse un coup qui ne retourne rien, ou joué hors de son tour', () => {
    const state = createReversi(players, 1);
    expect(applyReversiAction(state, { type: 'move', playerIndex: 0, cell: 0 })).toEqual({ ok: false, error: 'illegalMove' });
    expect(applyReversiAction(state, { type: 'move', playerIndex: 1, cell: 19 })).toEqual({ ok: false, error: 'notYourTurn' });
    const next = move(state, 19);
    expect(countDiscs(next.board)).toEqual([4, 1]);
    expect(next.lastMove).toMatchObject({ playerIndex: 0, cell: 19, flipped: [27], skipped: false });
    expect(next.currentPlayer).toBe(1);
  });

  it('finit la partie quand plus personne ne peut jouer, et donne la victoire au plus de pions', () => {
    const state = createReversi(players, 1);
    state.board = board('ox......', '........', '........', '........', '........', '........', '........', '........');
    const next = move(state, 2);
    expect(next.phase).toBe('gameOver');
    expect(next.winners).toEqual([0]);
  });

  it('passe le tour quand l’adversaire est bloqué mais que le joueur peut encore jouer', () => {
    const state = createReversi(players, 1);
    state.board = board('oxx.....', '........', '........', '........', '........', '........', 'x.......', 'o.......');
    // Le joueur 0 prend la ligne du haut ; le joueur 1 n'a alors aucun coup, mais le 0 peut encore encadrer A7.
    const next = move(state, 3);
    expect(next.lastMove?.skipped).toBe(true);
    expect(next.currentPlayer).toBe(0);
    expect(reversiView(next, 1).legal).toEqual(legalMoves(next.board, 0));
  });

  it('va toujours au bout entre bots, et le bot difficile bat le facile le plus souvent', () => {
    let hardWins = 0;
    for (let seed = 1; seed <= 8; seed++) {
      let state = createReversi(players, seed);
      const random = createRng(seed);
      for (let guard = 0; state.phase === 'playing'; guard++) {
        expect(guard).toBeLessThan(80);
        const level = state.currentPlayer === seed % 2 ? 'hard' : 'easy';
        state = move(state, reversiBotMove(state, state.currentPlayer, random, level)!);
      }
      if (state.winners.length === 1 && state.winners[0] === seed % 2) hardWins++;
    }
    expect(hardWins).toBeGreaterThanOrEqual(6);
  }, 60000);
});
