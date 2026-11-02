import { describe, expect, it } from 'vitest';
import { missionStatus, missionXp, streakOf } from '../src/daily';

const game = { online: true, rank: 1, players: 4, score: 10, roundsWon: 3, gangs: 1 };
const nothing = { games: [], challenge: null };

describe('missions du jour', () => {
  it('propose chaque jour une mission facile, une moyenne et une difficile, les mêmes pour tous', () => {
    const missions = missionStatus('2026-11-02', nothing);
    expect(missions.map((m) => m.xp)).toEqual([30, 50, 80]);
    expect(missionStatus('2026-11-02', nothing)).toEqual(missions);
    // Sur un mois, le tirage varie d'un jour à l'autre.
    const ids = new Set(Array.from({ length: 30 }, (_, i) => missionStatus(`2026-11-${String(i + 1).padStart(2, '0')}`, nothing).map((m) => m.id).join()));
    expect(ids.size).toBeGreaterThan(10);
  });

  it("suit l'avancée du joueur et ne rapporte que les missions accomplies", () => {
    expect(missionStatus('2026-11-02', nothing).every((m) => m.value === 0 && !m.done)).toBe(true);
    expect(missionXp('2026-11-02', nothing)).toBe(0);
    // Une grosse journée accomplit tout : deux victoires propres en ligne, des gangs, et le défi gagné.
    const bigDay = { games: [game, { ...game, online: false }, { ...game, gangs: 2 }], challenge: { won: true } };
    const done = missionStatus('2026-11-02', bigDay);
    expect(done.every((m) => m.done && m.value === m.goal)).toBe(true);
    expect(missionXp('2026-11-02', bigDay)).toBe(30 + 50 + 80);
  });
});

describe('série de jours joués', () => {
  it('rapporte de plus en plus chaque jour de série, jusqu’à une semaine', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'];
    // Le week-end entre le 9 (vendredi) et le 12 (lundi) ne casse pas la série : 8 jours d'affilée.
    expect(streakOf(days, '2026-10-14')).toEqual({ bonus: 10 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 7), current: 8, playedToday: true });
  });

  it('repart de zéro après un jour ouvré manqué, et reste vivante tant que la veille ouvrée est jouée', () => {
    expect(streakOf(['2026-10-05', '2026-10-07'], '2026-10-07')).toMatchObject({ bonus: 20, current: 1 });
    // Joué vendredi, on est lundi sans avoir encore joué : la série tient toujours.
    expect(streakOf(['2026-10-08', '2026-10-09'], '2026-10-12')).toEqual({ bonus: 30, current: 2, playedToday: false });
    // Mardi sans avoir joué lundi : elle est perdue.
    expect(streakOf(['2026-10-08', '2026-10-09'], '2026-10-13')).toMatchObject({ current: 0 });
    expect(streakOf([], '2026-10-13')).toEqual({ bonus: 0, current: 0, playedToday: false });
  });
});
