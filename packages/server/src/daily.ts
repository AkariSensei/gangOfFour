const parisDay = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Jour d'une date à l'heure de Paris, sous la forme « 2026-10-28 » : la journée change à minuit. */
export const dayOf = (date: Date) => parisDay.format(date);

const weekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Deux jours se suivent pour la série s'il n'y a entre eux que des jours de week-end (le bureau est fermé). */
function follows(before: string, after: string): boolean {
  for (let d = nextDay(before); d < after; d = nextDay(d)) if (!weekend(d)) return false;
  return true;
}

/**
 * Série de jours de jeu : chaque jour où le joueur a joué une partie qui compte prolonge la série si la veille ouvrée
 * était aussi jouée ; le week-end ne la casse pas. `current` : la série en cours, encore vivante si le dernier jour
 * joué est aujourd'hui ou la veille ouvrée.
 */
export function streakOf(days: string[], today: string): { current: number; playedToday: boolean } {
  const sorted = [...new Set(days)].sort();
  let length = 0;
  sorted.forEach((day, i) => {
    length = i > 0 && follows(sorted[i - 1]!, day) ? length + 1 : 1;
  });
  const last = sorted[sorted.length - 1];
  const alive = !!last && (last === today || follows(last, today));
  return { current: alive ? length : 0, playedToday: last === today };
}
