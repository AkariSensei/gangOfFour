import { useEffect, useState } from 'react';
import type { GameRecord, LeaderboardEntry } from '../../server/src/protocol';
import { socket } from './socket';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Classement du bureau et dernières parties, affichés sur l'accueil. */
export function Leaderboard() {
  const [stats, setStats] = useState<{ leaderboard: LeaderboardEntry[]; recent: GameRecord[] } | null>(null);

  useEffect(() => {
    const load = async () => {
      const result = await socket.emitWithAck('stats:get');
      if (result.ok) setStats({ leaderboard: result.leaderboard, recent: result.recent });
    };
    if (socket.connected) void load();
    socket.on('connect', load);
    return () => {
      socket.off('connect', load);
    };
  }, []);

  if (!stats || stats.leaderboard.length === 0) return null;

  return (
    <section className="panel leaderboard">
      <h2>Classement du bureau</h2>
      <ol className="ranking">
        {stats.leaderboard.map((e, i) => (
          <li key={e.name}>
            <span className="medal" aria-hidden>
              {['🥇', '🥈', '🥉'][i] ?? i + 1}
            </span>
            <span className="who">{e.name}</span>
            <span className="stat" title="Victoires / parties">
              <strong>{e.wins}</strong> / {e.games}
            </span>
            <span className="stat muted" title="Score moyen (le plus bas est le meilleur)">
              moy. {e.averageScore}
            </span>
          </li>
        ))}
      </ol>
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
