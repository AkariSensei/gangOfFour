import { useEffect, useState } from 'react';
import { type GameRecord, type LeaderboardEntry, SEASON_MIN_GAMES, SEASON_XP, type SeasonResult, type WinStreak } from '../../server/src/protocol';
import { Profile } from './Profile';
import { socket } from './socket';

const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long' });

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Jours restants avant la fin du mois, à l'heure locale (la saison se termine à minuit le dernier jour). */
function daysLeft(now = new Date()): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Saison en cours (le mois) et palmarès des saisons passées : le podium du classement en ligne de chaque mois gagne
 * de l'expérience, un titre à son nom, et le premier la couronne de champion.
 */
function Season({ seasons }: { seasons: SeasonResult[] }) {
  const month = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date());
  const left = daysLeft();
  return (
    <section className="panel season">
      <div className="season-head">
        <span className="season-crown" aria-hidden>
          👑
        </span>
        <div>
          <h2>Saison de {month}</h2>
          <p className="muted">
            Se termine dans {left} jour{left > 1 ? 's' : ''}. Le podium du classement en ligne du mois gagne {SEASON_XP.join(', ')} XP
            et un titre à son nom ; le premier, la couronne de champion. Au moins {SEASON_MIN_GAMES} parties en ligne dans le mois
            pour être classé.
          </p>
        </div>
      </div>
      {seasons.length > 0 && (
        <>
          <h3>Palmarès</h3>
          <ul className="palmares">
            {seasons.map((s) => (
              <li key={s.month}>
                <span className="palmares-month">{s.name}</span>
                <span className="palmares-podium">
                  {s.podium.map((p, i) => (
                    <span key={p.name}>
                      {['🥇', '🥈', '🥉'][i]} {p.name} <small className="muted">{p.wins} v.</small>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Classement du bureau et dernières parties : deux blocs de l'accueil. */
export function Leaderboard() {
  const [stats, setStats] = useState<{
    leaderboard: LeaderboardEntry[];
    monthly: LeaderboardEntry[];
    botLeaderboard: LeaderboardEntry[];
    botMonthly: LeaderboardEntry[];
    recent: GameRecord[];
    streak: WinStreak | null;
    seasons: SeasonResult[];
  } | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [tab, setTab] = useState<'month' | 'all'>('month');
  // Parties en ligne (au moins deux personnes) ou jouées seul contre des bots : deux classements séparés.
  const [mode, setMode] = useState<'online' | 'bots'>('online');

  useEffect(() => {
    const load = async () => {
      const result = await socket.emitWithAck('stats:get');
      if (result.ok) {
        const { ok: _ok, ...rest } = result;
        setStats(rest);
      }
    };
    if (socket.connected) void load();
    socket.on('connect', load);
    socket.on('stats:changed', load);
    return () => {
      socket.off('connect', load);
      socket.off('stats:changed', load);
    };
  }, []);

  if (!stats || (stats.leaderboard.length === 0 && stats.botLeaderboard.length === 0)) return null;

  const month = monthFormat.format(new Date());
  const ranking = mode === 'online' ? (tab === 'month' ? stats.monthly : stats.leaderboard) : tab === 'month' ? stats.botMonthly : stats.botLeaderboard;

  return (
    <>
      <Season seasons={stats.seasons} />
      <section className="panel leaderboard">
        <div className="leaderboard-head">
          <h2>Classement du bureau</h2>
          <div className="segmented" role="tablist" aria-label="Période du classement">
            {(
              [
                ['month', month[0]!.toUpperCase() + month.slice(1)],
                ['all', 'Général'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="segmented ranking-mode" role="tablist" aria-label="Type de parties">
          {(
            [
              ['online', '👥 En ligne'],
              ['bots', '🤖 Contre les bots'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>
        {shown && <Profile name={shown} onClose={() => setShown(null)} />}
        <p className="muted small">Clique sur un nom pour voir ses statistiques.</p>
        {ranking.length === 0 && (
          <p className="muted">
            Aucune partie {mode === 'online' ? 'en ligne' : 'contre les bots'} terminée {tab === 'month' ? `en ${month} ` : ''}pour l'instant.
          </p>
        )}
        <ol className="ranking">
          {ranking.map((e, i) => (
            <li key={e.name}>
              <span className="medal" aria-hidden>
                {['🥇', '🥈', '🥉'][i] ?? i + 1}
              </span>
              <button className="who" onClick={() => setShown(e.name)} title="Voir ses statistiques">
                {e.name}
              </button>
              <span className="stat" title="Victoires / parties">
                <strong>{e.wins}</strong> / {e.games}
              </span>
              <span className="stat muted" title="Score moyen (le plus bas est le meilleur)">
                moy. {e.averageScore}
              </span>
            </li>
          ))}
        </ol>
        {stats.streak && mode === 'online' && (
          <p className="streak" title="Record du bureau : plus longue série de victoires d'affilée">
            🔥 Record :{' '}
            <button className="who" onClick={() => setShown(stats.streak!.name)}>
              {stats.streak.name}
            </button>
            , <strong>{stats.streak.wins}</strong> victoires d'affilée
          </p>
        )}
      </section>
      {stats.recent.length > 0 && (
        <section className="panel recent-games">
          <h2>Dernières parties</h2>
          <ul className="recent">
            {stats.recent.map((r) => (
              <li key={r.finishedAt}>
                <span className="muted">{dateFormat.format(new Date(r.finishedAt))}</span>
                <span>
                  🏆{' '}
                  {r.players
                    .filter((p) => p.winner)
                    .map((p) => p.name)
                    .join(', ')}{' '}
                  <span className="muted">
                    · {r.players.length} joueurs · {r.rounds} manche
                    {r.rounds > 1 ? 's' : ''}
                    {r.players.filter((p) => !p.bot).length < 2 && ' · 🤖 contre les bots'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
