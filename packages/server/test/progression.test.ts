import { describe, expect, it } from 'vitest';
import { NO_CHALLENGE } from '../src/challenges';
import { gameXp, newRewards, progressOf, totalXp, unlocksOf, xpForLevel } from '../src/progression';

const game = { winner: false, roundsWon: 0, gangs: 0, vsBots: null };

describe('progression', () => {
  it('rapporte plus pour une victoire, des manches gagnées et des gangs', () => {
    expect(gameXp(game)).toBe(40);
    expect(gameXp({ ...game, winner: true, roundsWon: 3, gangs: 2 })).toBe(40 + 60 + 24 + 20);
  });

  it('rapporte moins contre des bots plus faciles, et tout en ligne ou contre des bots difficiles', () => {
    const won = { ...game, winner: true };
    expect(gameXp({ ...won, vsBots: 'hard' })).toBe(100);
    expect(gameXp({ ...won, vsBots: 'normal' })).toBe(60);
    expect(gameXp({ ...won, vsBots: 'easy' })).toBe(30);
    expect(gameXp({ ...won, vsBots: 'unknown' })).toBe(60);
  });

  it('compte aussi les défis terminés et les badges obtenus', () => {
    const badges = [
      { id: 'a', value: 1, goal: 1 },
      { id: 'b', value: 0, goal: 1 },
    ] as never[];
    expect(totalXp([game], { ...NO_CHALLENGE, played: 2, wins: 1 }, badges)).toBe(40 + 60 + 50 + 40);
  });

  it('monte de niveau de plus en plus lentement', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000]);
    expect(progressOf(0)).toEqual({ xp: 0, level: 1, levelXp: 0, levelSpan: 100, title: 'Débutant' });
    expect(progressOf(350)).toMatchObject({ level: 3, levelXp: 50, levelSpan: 300, title: 'Apprenti' });
    expect(progressOf(xpForLevel(8))).toMatchObject({ level: 8, levelXp: 0, title: 'Habitué du tripot' });
  });

  it('débloque tapis et cadres par niveau, et un titre par badge obtenu', () => {
    const badges = [{ id: 'wins-75', name: 'Parrain', value: 75, goal: 75 }] as never[];
    const unlocks = unlocksOf(8, badges);
    expect(unlocks.felts).toEqual(['vert', 'bordeaux', 'nuit']);
    expect(unlocks.frames).toEqual(['bronze', 'argent']);
    expect(unlocks.titles).toEqual(['Débutant', 'Apprenti', 'Joueur du dimanche', 'Habitué du tripot', 'Parrain']);
    expect(unlocksOf(1, []).frames).toEqual([]);
  });

  it('annonce les récompenses gagnées en passant de niveau', () => {
    expect(newRewards(2, 4)).toEqual(['Tapis bordeaux', 'Cadre bronze', 'Titre « Apprenti »']);
    expect(newRewards(4, 4)).toEqual([]);
  });
});
