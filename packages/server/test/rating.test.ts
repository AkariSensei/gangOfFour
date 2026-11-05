import { describe, expect, it } from 'vitest';
import { START_RATING, computeRatings, expected, shown } from '../src/rating';

const duel = (winner: string, loser: string) => ({
  players: [
    { owner: winner, name: winner, place: 0, winner: true },
    { owner: loser, name: loser, place: 1, winner: false },
  ],
});

describe('points de classement', () => {
  it('fait partir tout le monde de 1000, et donne autant au gagnant qu’il en prend au perdant entre égaux', () => {
    const ratings = computeRatings([duel('a', 'b')]);
    expect(shown(ratings.get('a')!.rating)).toBe(START_RATING + 24);
    expect(shown(ratings.get('b')!.rating)).toBe(START_RATING - 24);
    expect(ratings.get('a')).toMatchObject({ games: 1, wins: 1 });
  });

  it('rapporte plus pour une victoire contre plus fort que soi', () => {
    // Le joueur fort enchaîne les victoires contre un tiers avant d'affronter les deux autres.
    const warmup = Array.from({ length: 12 }, () => duel('fort', 'tiers'));
    const strong = computeRatings([...warmup, duel('a', 'fort')]);
    const even = computeRatings([duel('x', 'y'), duel('a', 'y')]);
    const vsStrong = strong.get('a')!.rating - START_RATING;
    const vsEven = even.get('a')!.rating - START_RATING;
    expect(vsStrong).toBeGreaterThan(vsEven);
    expect(expected(1200, 3000)).toBeLessThan(0.01);
  });

  it('après les dix premières parties, les points bougent moins vite', () => {
    const games = Array.from({ length: 11 }, (_, i) => (i % 2 ? duel('b', 'a') : duel('a', 'b')));
    const before = computeRatings(games.slice(0, 10)).get('a')!.rating;
    const after = computeRatings(games).get('a')!.rating;
    // Entre joueurs proches, une partie vaut alors 16 points environ, au lieu de 24 au début.
    expect(Math.abs(after - before)).toBeLessThan(20);
  });

  it('à plusieurs, compare chaque paire selon le classement final, sans créer de points', () => {
    const ratings = computeRatings([
      {
        players: [
          { owner: 'a', name: 'A', place: 0, winner: true },
          { owner: 'b', name: 'B', place: 1, winner: false },
          { owner: 'c', name: 'C', place: 2, winner: false },
          { owner: 'd', name: 'D', place: 2, winner: false },
        ],
      },
    ]);
    expect(shown(ratings.get('a')!.rating)).toBe(1024);
    expect(shown(ratings.get('b')!.rating)).toBe(1008);
    expect(shown(ratings.get('c')!.rating)).toBe(984);
    const total = [...ratings.values()].reduce((n, r) => n + r.rating, 0);
    expect(total).toBeCloseTo(4 * START_RATING, 6);
  });
});
