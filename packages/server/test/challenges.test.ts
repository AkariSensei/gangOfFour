import { describe, expect, it } from 'vitest';
import { ChallengeStore, dayOf, seedOf } from '../src/challenges';

const names: Record<string, string> = { a: 'Alice', b: 'Bruno', c: 'Chloé', d: 'David' };
const accounts = { get: (id: string | undefined) => (id ? { name: names[id] } : undefined), byName: () => undefined };

/** Un essai joué à `day` (midi à Paris), terminé `seconds` secondes plus tard. */
function play(store: ChallengeStore, account: string, day: string, outcome: { won: boolean; moves: number; cardsLeft: number }, seconds = 60) {
  const start = new Date(`${day}T12:00:00+01:00`);
  expect(store.start(account, start)).toBe(true);
  store.finish(account, day, outcome, new Date(start.getTime() + seconds * 1000));
}

describe('défi du jour', () => {
  it('change de donne chaque jour, à minuit heure de Paris', () => {
    expect(dayOf(new Date('2026-10-28T22:59:00Z'))).toBe('2026-10-28');
    expect(dayOf(new Date('2026-10-28T23:01:00Z'))).toBe('2026-10-29');
    expect(seedOf('2026-10-28')).toBe(seedOf('2026-10-28'));
    expect(seedOf('2026-10-28')).not.toBe(seedOf('2026-10-29'));
  });

  it("n'accorde qu'un essai par jour", () => {
    const store = new ChallengeStore(undefined, accounts);
    const now = new Date('2026-10-28T10:00:00Z');
    expect(store.start('a', now)).toBe(true);
    expect(store.start('a', now)).toBe(false);
    expect(store.start('a', new Date('2026-10-29T10:00:00Z'))).toBe(true);
  });

  it('classe les gagnants au moins de coups, puis les autres au moins de cartes, puis le plus rapide', () => {
    const store = new ChallengeStore(undefined, accounts);
    const day = '2026-10-28';
    play(store, 'a', day, { won: false, moves: 6, cardsLeft: 3 });
    play(store, 'b', day, { won: true, moves: 9, cardsLeft: 0 });
    play(store, 'c', day, { won: true, moves: 7, cardsLeft: 0 }, 300);
    play(store, 'd', day, { won: true, moves: 7, cardsLeft: 0 }, 100);
    expect(store.ranking(day).map((e) => [e.rank, e.name])).toEqual([
      [1, 'David'],
      [2, 'Chloé'],
      [3, 'Bruno'],
      [4, 'Alice'],
    ]);
    expect(store.rankOf('a', day)).toBe(4);
  });

  it('compte les séries de jours et les podiums des journées terminées à trois joueurs ou plus', () => {
    const store = new ChallengeStore(undefined, accounts);
    const win = { won: true, moves: 8, cardsLeft: 0 };
    const loss = { won: false, moves: 8, cardsLeft: 5 };
    // Seule ce jour-là : premier, mais pas de podium au rabais.
    play(store, 'a', '2026-10-25', win);
    // Le 26 et le 27, trois joueurs : Alice première puis deuxième.
    for (const [day, others] of [['2026-10-26', loss], ['2026-10-27', win]] as const) {
      play(store, 'a', day, day === '2026-10-26' ? win : { ...win, moves: 9 });
      play(store, 'b', day, others);
      play(store, 'c', day, loss);
    }
    // Aujourd'hui (journée pas finie), elle est première : ça ne compte pas encore.
    play(store, 'a', '2026-10-28', win);
    play(store, 'b', '2026-10-28', loss);
    play(store, 'c', '2026-10-28', loss);
    expect(store.statsOf('a', new Date('2026-10-28T15:00:00Z'))).toEqual({ played: 4, wins: 4, bestStreak: 4, podiums: 2, firsts: 1 });
    expect(store.statsOf('b', new Date('2026-10-28T15:00:00Z'))).toMatchObject({ played: 3, bestStreak: 3, podiums: 2, firsts: 1 });
    expect(store.overall().map((e) => e.name)).toEqual(['Alice', 'Bruno', 'Chloé']);
  });

  it("ne classe pas un essai encore en cours", () => {
    const store = new ChallengeStore(undefined, accounts);
    store.start('a', new Date('2026-10-28T10:00:00Z'));
    expect(store.ranking('2026-10-28')).toEqual([]);
    expect(store.attempt('a', '2026-10-28')).toMatchObject({ day: '2026-10-28' });
  });
});
