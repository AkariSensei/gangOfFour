import { type Stats, daysLeft } from './Leaderboard';

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const dayLabel = (day: string) => dayFormat.format(new Date(`${day}T12:00:00`));

/** La saison en cours, en une ligne discrète : son nom et les jours qu'il lui reste (page Jeux). */
export function SeasonLine({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  const left = daysLeft(stats.season);
  return (
    <p className="season-line">
      {stats.season.name}
      <span className="season-line-left">
        encore {left} jour{left > 1 ? 's' : ''}
      </span>
    </p>
  );
}

/**
 * En tête du classement d'un jeu : la saison en cours (les vraies saisons de l'année, trois mois chacune), commune à
 * tous les jeux. Chaque jeu a son propre classement, sur sa page.
 */
export function SeasonHeader({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  const { season } = stats;
  const left = daysLeft(season);
  return (
    <section className="season-header">
      <div>
        <h3>{season.name}</h3>
        <p className="muted small">
          Du {dayLabel(season.start)} au {dayLabel(season.end)}. Tous les jeux suivent la même saison : à la fin, chaque
          classement repart de zéro.
        </p>
      </div>
      <span className="season-header-left">
        encore {left} jour{left > 1 ? 's' : ''}
      </span>
    </section>
  );
}
