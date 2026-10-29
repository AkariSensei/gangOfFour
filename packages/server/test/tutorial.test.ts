import { type GameState, applyAction, createGame } from '@gof/engine';
import { describe, expect, it } from 'vitest';
import { TUTORIAL_SCRIPT, tutorialDeck } from '../src/tutorial';

describe('tutoriel', () => {
  it('distribue toujours la même donne, sans carte en double', () => {
    const deck = tutorialDeck();
    expect(deck).toHaveLength(64);
    expect(new Set(deck.map((c) => c.id)).size).toBe(64);
    expect(tutorialDeck()).toEqual(deck);
  });

  it('se joue jusqu’au bout en suivant le script, et le joueur gagne la manche', () => {
    let game: GameState = createGame(
      ['Moi', 'Robot Ada', 'Robot Alan', 'Robot Grace'].map((name, i) => ({ id: `p${i}`, name })),
      1,
      { targetScore: 1 },
      tutorialDeck(),
    );
    expect(game.currentPlayer).toBe(0);
    for (const move of TUTORIAL_SCRIPT) {
      expect(game.currentPlayer).toBe(move.player);
      const result = applyAction(
        game,
        move.cardIds ? { type: 'play', playerIndex: move.player, cardIds: move.cardIds } : { type: 'pass', playerIndex: move.player },
      );
      if (!result.ok) throw new Error(`${JSON.stringify(move)} : ${result.error}`);
      game = result.state;
    }
    expect(game.phase).toBe('gameOver');
    expect(game.lastRound?.winnerIndex).toBe(0);
    expect(game.winners).toEqual([0]);
  });

  it('explique chaque coup du joueur', () => {
    expect(TUTORIAL_SCRIPT.filter((m) => m.player === 0).every((m) => m.coach)).toBe(true);
  });
});
