import { GAMES } from '../../server/src/protocol';
import { Leaderboard, type Stats, daysLeft } from './Leaderboard';

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const dayLabel = (day: string) => dayFormat.format(new Date(`${day}T12:00:00`));

/** La saison en cours, en une ligne : son nom et les jours qu'il lui reste. */
export function SeasonBadge({ stats, onClick }: { stats: Stats | null; onClick: () => void }) {
  if (!stats) return null;
  const left = daysLeft(stats.season);
  return (
    <button type="button" className="season-strip" onClick={onClick}>
      <strong>{stats.season.name}</strong>
      <span>
        encore {left} jour{left > 1 ? 's' : ''}
      </span>
      <span className="season-strip-link">Voir les classements →</span>
    </button>
  );
}

/**
 * Écran « Saison » : la saison en cours (les vraies saisons de l'année, trois mois chacune), et le classement de
 * chaque jeu pour cette saison. Tous les jeux suivent la même saison.
 */
export function SeasonScreen({ stats }: { stats: Stats | null }) {
  if (!stats) return <p className="muted">Chargement…</p>;
  const { season } = stats;
  const left = daysLeft(season);
  const live = GAMES.filter((g) => g.status === 'live');
  const coming = GAMES.filter((g) => g.status !== 'live');
  return (
    <div className="season-screen">
      <section className="panel season-head">
        <h2>{season.name}</h2>
        <p>
          Du {dayLabel(season.start)} au {dayLabel(season.end)} · <strong>encore {left} jour{left > 1 ? 's' : ''}</strong>
        </p>
        <p className="muted small">
          Une saison dure trois mois, comme les saisons de l’année. Tous les jeux suivent la même : à la fin, chaque classement
          repart de zéro.
        </p>
      </section>
      {live.map((g) => (
        <Leaderboard key={g.id} stats={stats} title={g.name} seasonOnly />
      ))}
      {coming.length > 0 && (
        <p className="muted small season-coming">
          Bientôt dans la saison : {coming.map((g) => g.name).join(', ')}.
        </p>
      )}
    </div>
  );
}
