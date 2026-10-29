import { describe, expect, it } from 'vitest';
import { NO_CHALLENGE } from '../src/challenges';
import { FELTS, FRAMES, LEVEL_TITLES, gameXp, levelSpan, newRewards, progressOf, totalXp, unlocksOf, xpForLevel } from '../src/progression';

const game = { winner: false, roundsWon: 0, gangs: 0, vsBots: null };

describe('progression', () => {
  it('rapporte plus pour une victoire, des manches gagnées et des gangs', () => {
    expect(gameXp(game)).toBe(40);
    expect(gameXp({ ...game, winner: true, roundsWon: 3, gangs: 2 })).toBe(40 + 60 + 24 + 20);
  });

  it("ne rapporte qu'en ligne ou contre des bots difficiles", () => {
    const won = { ...game, winner: true };
    expect(gameXp({ ...won, vsBots: 'hard' })).toBe(100);
    expect(gameXp({ ...won, vsBots: 'normal' })).toBe(0);
    expect(gameXp({ ...won, vsBots: 'easy' })).toBe(0);
    expect(gameXp({ ...won, vsBots: 'unknown' })).toBe(0);
  });

  it('compte aussi les défis terminés et les badges obtenus', () => {
    const badges = [
      { id: 'a', value: 1, goal: 1 },
      { id: 'b', value: 0, goal: 1 },
    ] as never[];
    expect(totalXp([game], { ...NO_CHALLENGE, played: 2, wins: 1 }, badges)).toBe(40 + 60 + 50 + 25);
  });

  it('demande de plus en plus d’expérience à chaque niveau', () => {
    expect([1, 2, 3, 4, 5, 10, 20].map(levelSpan)).toEqual([100, 280, 520, 800, 1120, 3160, 8940]);
    expect([1, 2, 3, 4].map(xpForLevel)).toEqual([0, 100, 380, 900]);
    expect(progressOf(0)).toEqual({ xp: 0, level: 1, levelXp: 0, levelSpan: 100, title: 'Débutant' });
    expect(progressOf(400)).toMatchObject({ level: 3, levelXp: 20, levelSpan: 520, title: 'Apprenti' });
    expect(progressOf(xpForLevel(8))).toMatchObject({ level: 8, levelXp: 0, title: 'Habitué du tripot' });
    // Une première partie gagnée en ligne, avec ses premiers badges, ne fait pas sauter plusieurs niveaux.
    const firstGame = totalXp([{ ...game, winner: true, roundsWon: 4, gangs: 1 }], NO_CHALLENGE, Array(5).fill({ value: 1, goal: 1 }));
    expect(progressOf(firstGame).level).toBe(2);
  });

  it('donne une récompense à presque chaque niveau, jusqu’au niveau 30', () => {
    const levels = new Set([...FELTS, ...FRAMES].map((r) => r.level).concat(LEVEL_TITLES.map((t) => t.level)));
    const empty = Array.from({ length: 19 }, (_, i) => i + 2).filter((l) => !levels.has(l));
    expect(empty).toEqual([]);
    expect(Math.max(...levels)).toBe(30);
  });

  it('débloque tapis et cadres par niveau, et un titre par badge obtenu', () => {
    const badges = [{ id: 'wins-75', name: 'Parrain', value: 75, goal: 75 }] as never[];
    const unlocks = unlocksOf(8, badges);
    expect(unlocks.felts).toEqual(['vert', 'bordeaux', 'nuit', 'ardoise']);
    expect(unlocks.frames).toEqual(['bronze', 'cuivre', 'argent']);
    expect(unlocks.titles).toEqual(['Débutant', 'Apprenti', 'Joueur du dimanche', 'Amateur éclairé', 'Habitué du tripot', 'Parrain']);
    expect(unlocksOf(1, []).frames).toEqual([]);
  });

  it('annonce les récompenses gagnées en passant de niveau', () => {
    expect(newRewards(2, 4)).toEqual(['Tapis bordeaux', 'Cadre cuivre', 'Titre « Apprenti »']);
    expect(newRewards(4, 4)).toEqual([]);
  });
});
