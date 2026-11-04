import { describe, expect, it } from 'vitest';
import { streakOf } from '../src/daily';

describe('série de jours joués', () => {
  it('compte les jours ouvrés joués d’affilée, sans que le week-end la casse', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'];
    // Le week-end entre le 9 (vendredi) et le 12 (lundi) ne casse pas la série : 8 jours d'affilée.
    expect(streakOf(days, '2026-10-14')).toEqual({ current: 8, playedToday: true });
  });

  it('repart de zéro après un jour ouvré manqué, et reste vivante tant que la veille ouvrée est jouée', () => {
    expect(streakOf(['2026-10-05', '2026-10-07'], '2026-10-07')).toMatchObject({ current: 1 });
    // Joué vendredi, on est lundi sans avoir encore joué : la série tient toujours.
    expect(streakOf(['2026-10-08', '2026-10-09'], '2026-10-12')).toEqual({ current: 2, playedToday: false });
    // Mardi sans avoir joué lundi : elle est perdue.
    expect(streakOf(['2026-10-08', '2026-10-09'], '2026-10-13')).toMatchObject({ current: 0 });
    expect(streakOf([], '2026-10-13')).toEqual({ current: 0, playedToday: false });
  });
});
