import { GAMES, type GameId } from '../../server/src/protocol';
import { Leaderboard, type Stats, daysLeft } from './Leaderboard';

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const dayLabel = (day: string) => dayFormat.format(new Date(`${day}T12:00:00`));

/** La saison en cours, en carte : son nom, les jours qu'il lui reste et le podium du moment. */
export function SeasonCard({ stats, onClick }: { stats: Stats | null; onClick: () => void }) {
  if (!stats) return null;
  const left = daysLeft(stats.season);
  // Le podium du jeu le plus joué cette saison (le premier du catalogue à égalité).
  const played = (g: (typeof GAMES)[number]) => (stats.games[g.id as GameId]?.seasonal ?? []).reduce((n, e) => n + e.games, 0);
  const top = GAMES.filter((g) => g.status === 'live').reduce<(typeof GAMES)[number] | undefined>((best, g) => (!best || played(g) > played(best) ? g : best), undefined);
  const podium = (top ? (stats.games[top.id as GameId]?.seasonal ?? []) : []).slice(0, 3);
  return (
    <button type="button" className="season-card" onClick={onClick}>
      <span className="season-card-head">
        <strong>{stats.season.name}</strong>
        <span className="season-card-left" title={`Encore ${left} jour${left > 1 ? 's' : ''}`}>
          J-{left}
        </span>
      </span>
      {podium.length > 0 ? (
        <ol className="season-podium">
          {podium.map((p, i) => (
            <li key={p.name} className={`rank-${i + 1}`}>
              <span className="season-podium-rank">{i + 1}</span>
              <span className="season-podium-name">{p.name}</span>
              <span className="season-podium-wins">
                {p.wins} victoire{p.wins > 1 ? 's' : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <span className="season-card-empty">Personne n’a encore joué cette saison : la première place est à prendre.</span>
      )}
      <span className="season-card-note">
        {podium.length > 0 && top ? `Podium ${top.name} · ` : ''}Tous les jeux suivent la même saison · voir les classements →
      </span>
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
        <Leaderboard key={g.id} stats={stats} game={g.id as GameId} title={g.name} seasonOnly />
      ))}
      {coming.length > 0 && (
        <p className="muted small season-coming">
          Bientôt dans la saison : {coming.map((g) => g.name).join(', ')}.
        </p>
      )}
    </div>
  );
}
