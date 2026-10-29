import { describe, expect, it } from 'vitest';
import { NO_CHALLENGE } from '../src/challenges';
import { FELTS, FRAMES, LEVEL_TITLES, gameXp, levelSpan, newRewards, progressOf, totalXp, unlocksOf, xpForLevel } from '../src/progression';

/** Une partie à quatre, finie à la deuxième place, sans manche gagnée ni gang. */
const game = { rank: 2, players: 4, roundsWon: 0, gangs: 0, vsBots: null };

describe('progression', () => {
  it('rapporte selon la place, et rien au dernier', () => {
    expect([1, 2, 3, 4].map((rank) => gameXp({ ...game, rank }))).toEqual([120, 70, 35, 0]);
    expect([1, 2, 3].map((rank) => gameXp({ ...game, rank, players: 3 }))).toEqual([110, 50, 0]);
    // Manches gagnées et gangs s'ajoutent, sauf pour le dernier qui ne gagne rien du tout.
    expect(gameXp({ ...game, rank: 1, roundsWon: 3, gangs: 2 })).toBe(120 + 24 + 20);
    expect(gameXp({ ...game, rank: 4, roundsWon: 2, gangs: 1 })).toBe(0);
    // À égalité, la même place : deux joueurs à égalité en tête prennent chacun l'expérience du premier.
    expect(gameXp({ ...game, rank: 1 })).toBe(120);
  });

  it("ne rapporte qu'en ligne ou contre des bots difficiles", () => {
    const won = { ...game, rank: 1 };
    expect(gameXp({ ...won, vsBots: 'hard' })).toBe(120);
    expect(gameXp({ ...won, vsBots: 'normal' })).toBe(0);
    expect(gameXp({ ...won, vsBots: 'easy' })).toBe(0);
    expect(gameXp({ ...won, vsBots: 'unknown' })).toBe(0);
  });

  it('compte aussi les défis terminés et les badges obtenus', () => {
    const badges = [
      { id: 'a', value: 1, goal: 1 },
      { id: 'b', value: 0, goal: 1 },
    ] as never[];
    expect(totalXp([game], { ...NO_CHALLENGE, played: 2, wins: 1 }, badges)).toBe(70 + 60 + 50 + 25);
  });

  it('demande de plus en plus d’expérience à chaque niveau', () => {
    expect([1, 2, 3, 4, 5, 10, 20].map(levelSpan)).toEqual([100, 280, 520, 800, 1120, 3160, 8940]);
    expect([1, 2, 3, 4].map(xpForLevel)).toEqual([0, 100, 380, 900]);
    expect(progressOf(0)).toEqual({ xp: 0, level: 1, levelXp: 0, levelSpan: 100, title: 'Débutant' });
    expect(progressOf(400)).toMatchObject({ level: 3, levelXp: 20, levelSpan: 520, title: 'Apprenti' });
    expect(progressOf(xpForLevel(8))).toMatchObject({ level: 8, levelXp: 0, title: 'Habitué du tripot' });
    // Une première partie gagnée en ligne, avec ses premiers badges, ne fait pas sauter plusieurs niveaux.
    const firstGame = totalXp([{ ...game, rank: 1, roundsWon: 4, gangs: 1 }], NO_CHALLENGE, Array(5).fill({ value: 1, goal: 1 }));
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
