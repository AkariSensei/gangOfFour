import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GameState, createGame } from '@gof/engine';
import { describe, expect, it } from 'vitest';
import { GameHistory } from '../src';

function finished(scores: Record<string, number>): GameState {
  const names = Object.keys(scores);
  const game = createGame(
    names.map((name, i) => ({ id: `p${i}`, name })),
    1,
  );
  game.players.forEach((p) => (p.score = scores[p.name]!));
  const best = Math.min(...game.players.map((p) => p.score));
  game.winners = game.players.flatMap((p, i) => (p.score === best ? [i] : []));
  game.phase = 'gameOver';
  return game;
}

describe('GameHistory', () => {
  it('classe par victoires, puis taux de victoire, puis score moyen', () => {
    const history = new GameHistory();
    history.record(finished({ Alice: 20, Bruno: 104, Chloé: 60 }));
    history.record(finished({ Alice: 101, Bruno: 30, Chloé: 50 }));
    history.record(finished({ alice: 10, Bruno: 120, David: 40 }));
    expect(history.leaderboard().map((e) => [e.name, e.games, e.wins, e.averageScore])).toEqual([
      ['alice', 3, 2, 44],
      ['Bruno', 3, 1, 85],
      ['David', 1, 0, 40],
      ['Chloé', 2, 0, 55],
    ]);
    expect(history.recent(1)[0]!.players.find((p) => p.winner)!.name).toBe('alice');
  });

  it('enregistre dans un fichier et le relit au démarrage', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gof-')), 'data', 'parties.json');
    new GameHistory(file).record(finished({ Alice: 20, Bruno: 104, Chloé: 60 }));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
    expect(new GameHistory(file).leaderboard()[0]).toMatchObject({ name: 'Alice', wins: 1 });
  });

  it('démarre avec un historique vide si le fichier est absent ou illisible', () => {
    expect(new GameHistory('/chemin/inexistant/parties.json').leaderboard()).toEqual([]);
  });
});
