import { type GameState, applyAction, createGame } from '@gof/engine';
import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '../src/bot';

/** Graine simple et reproductible pour les choix aléatoires des bots (coupe). */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe('bot', () => {
  it.each([3, 4])('mène 20 parties à %i bots jusqu\'au bout, sans coup refusé', (count) => {
    for (let seed = 1; seed <= 20; seed++) {
      const random = rng(seed);
      let state: GameState = createGame(
        Array.from({ length: count }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}` })),
        seed,
      );
      for (let steps = 0; state.phase !== 'gameOver'; steps++) {
        expect(steps).toBeLessThan(20000);
        if (state.phase === 'roundOver') {
          const next = applyAction(state, { type: 'nextRound' });
          if (!next.ok) throw new Error(next.error);
          state = next.state;
          continue;
        }
        const actor =
          state.phase === 'cut' ? state.dealer : state.phase === 'exchange' ? state.exchange!.winnerIndex : state.currentPlayer;
        const action = chooseBotAction(state, actor, random);
        expect(action).not.toBeNull();
        const result = applyAction(state, action!);
        if (!result.ok) throw new Error(`partie ${seed} : ${result.error} (${JSON.stringify(action)})`);
        state = result.state;
      }
    }
  }, 60000);
});
