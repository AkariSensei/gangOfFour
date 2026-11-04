import { dayOf } from './daily';

/**
 * Saisons du site : les vraies saisons de l'année, de trois mois chacune (l'hiver de décembre à février, le printemps
 * de mars à mai, l'été de juin à août, l'automne de septembre à novembre). Tous les classements de tous les jeux
 * suivent la même saison.
 */
export interface Season {
  /** « 2026-automne », ou « 2026-hiver » pour l'hiver qui commence en décembre 2026. */
  id: string;
  /** « Saison d'automne 2026 », « Saison d'hiver 2026-2027 ». */
  name: string;
  /** Premier et dernier jour, à l'heure de Paris (« 2026-09-01 », « 2026-11-30 »). */
  start: string;
  end: string;
}

const SEASONS = [
  { key: 'hiver', label: "d'hiver", firstMonth: 12 },
  { key: 'printemps', label: 'de printemps', firstMonth: 3 },
  { key: 'ete', label: "d'été", firstMonth: 6 },
  { key: 'automne', label: "d'automne", firstMonth: 9 },
] as const;

const pad = (n: number) => String(n).padStart(2, '0');
/** Dernier jour d'un mois (1 à 12). */
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Saison d'un jour « 2026-10-28 ». */
export function seasonOfDay(day: string): Season {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  // L'hiver commence en décembre : janvier et février appartiennent à l'hiver commencé l'année d'avant.
  const startYear = month <= 2 ? year - 1 : year;
  const season = month === 12 || month <= 2 ? SEASONS[0] : SEASONS[Math.floor((month - 3) / 3) + 1]!;
  const endMonth = ((season.firstMonth + 1) % 12) + 1;
  const endYear = season.key === 'hiver' ? startYear + 1 : startYear;
  return {
    id: `${startYear}-${season.key}`,
    name: `Saison ${season.label} ${season.key === 'hiver' ? `${startYear}-${startYear + 1}` : startYear}`,
    start: `${startYear}-${pad(season.firstMonth)}-01`,
    end: `${endYear}-${pad(endMonth)}-${pad(lastDay(endYear, endMonth))}`,
  };
}

/** Saison d'une date (à l'heure de Paris). */
export const seasonOf = (date: Date) => seasonOfDay(dayOf(date));
