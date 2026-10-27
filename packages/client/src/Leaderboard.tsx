import { useEffect, useState } from 'react';
import type { GameRecord, LeaderboardEntry, WinStreak } from '../../server/src/protocol';
import { Profile } from './Profile';
import { socket } from './socket';

const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long' });

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Classement du bureau et dernières parties, affichés sur l'accueil. */
export function Leaderboard() {
  const [stats, setStats] = useState<{ leaderboard: LeaderboardEntry[]; monthly: LeaderboardEntry[]; recent: GameRecord[]; streak: WinStreak | null } | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [tab, setTab] = useState<'month' | 'all'>('month');

  useEffect(() => {
    const load = async () => {
      const result = await socket.emitWithAck('stats:get');
      if (result.ok) setStats({ leaderboard: result.leaderboard, monthly: result.monthly, recent: result.recent, streak: result.streak });
    };
    if (socket.connected) void load();
    socket.on('connect', load);
    return () => {
      socket.off('connect', load);
    };
  }, []);

  if (!stats || stats.leaderboard.length === 0) return null;

  const month = monthFormat.format(new Date());
  const ranking = tab === 'month' ? stats.monthly : stats.leaderboard;

  return (
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
      {shown && <Profile name={shown} onClose={() => setShown(null)} />}
      <p className="muted small">Clique sur un nom pour voir ses statistiques.</p>
      {ranking.length === 0 && <p className="muted">Aucune partie terminée en {month} pour l'instant.</p>}
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
      {stats.streak && (
        <p className="streak" title="Record du bureau : plus longue série de victoires d'affilée">
          🔥 Record : <button className="who" onClick={() => setShown(stats.streak!.name)}>{stats.streak.name}</button>,{' '}
          <strong>{stats.streak.wins}</strong> victoires d'affilée
        </p>
      )}
      {stats.recent.length > 0 && (
        <>
          <h3>Dernières parties</h3>
          <ul className="recent">
            {stats.recent.map((r) => (
              <li key={r.finishedAt}>
                <span className="muted">{dateFormat.format(new Date(r.finishedAt))}</span>
                <span>
                  🏆 {r.players.filter((p) => p.winner).map((p) => p.name).join(', ')}{' '}
                  <span className="muted">
                    · {r.players.length} joueurs · {r.rounds} manche{r.rounds > 1 ? 's' : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
