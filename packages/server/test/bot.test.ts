import { type GameState, applyAction, createGame } from '@gof/engine';
import { describe, expect, it } from 'vitest';
import { type BotLevel, chooseBotAction } from '../src/bot';

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

  /** Joue une partie complète entre bots de ces niveaux ; renvoie les gagnants (un coup refusé fait échouer le test). */
  function play(levels: BotLevel[], seed: number): number[] {
    const random = rng(seed);
    let state: GameState = createGame(
      levels.map((_, i) => ({ id: `b${i}`, name: `Bot ${i}` })),
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
      const actor = state.phase === 'cut' ? state.dealer : state.phase === 'exchange' ? state.exchange!.winnerIndex : state.currentPlayer;
      const action = chooseBotAction(state, actor, random, levels[actor]);
      const result = applyAction(state, action!);
      if (!result.ok) throw new Error(`partie ${seed}, niveau ${levels[actor]} : ${result.error} (${JSON.stringify(action)})`);
      state = result.state;
    }
    return state.winners;
  }

  it('fait jouer chaque niveau sans coup refusé : le difficile gagne bien plus que les moyens, le facile presque jamais', async () => {
    // Une pause entre deux parties : sans elle, ce long calcul bloquerait le processus de test.
    const breathe = () => new Promise((resolve) => setTimeout(resolve));
    // Le bot difficile change de place à chaque partie, face à trois bots moyens.
    let hardWins = 0;
    const games = 32;
    for (let seed = 1; seed <= games; seed++) {
      const seat = seed % 4;
      const winners = play(
        [0, 1, 2, 3].map((i) => (i === seat ? 'hard' : 'normal')),
        seed,
      );
      if (winners.includes(seat)) hardWins += 1 / winners.length;
      await breathe();
    }
    // Au hasard, il gagnerait une partie sur quatre : on attend nettement plus.
    expect(hardWins / games).toBeGreaterThan(0.4);
    // Deux bots faciles face à deux moyens : ils gagnent bien moins que la moitié des parties.
    let easyWins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const winners = play(['easy', 'normal', 'normal', 'easy'], seed);
      easyWins += winners.filter((w) => w === 0 || w === 3).length / winners.length;
      await breathe();
    }
    expect(easyWins / 12).toBeLessThan(0.25);
  }, 120000);
});
