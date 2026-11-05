import { useEffect, useState } from 'react';
import type { GameId, GameStats, Season } from '../../server/src/protocol';
import { Profile } from './Profile';
import { socket } from './socket';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** La saison en cours et les classements de chaque jeu. */
export interface Stats {
  season: Season;
  games: Record<GameId, GameStats>;
}

/** Jours qu'il reste dans la saison, aujourd'hui compris. */
export function daysLeft(season: Season, now = new Date()): number {
  const end = new Date(`${season.end}T23:59:59`);
  return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

/** Classements et dernières parties, rechargés à chaque partie terminée. */
export function useStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);
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
  return stats;
}

/**
 * Classement d'un jeu et ses dernières parties. `seasonOnly` (écran Saison) : seulement le classement de la saison,
 * sans les dernières parties.
 */
export function Leaderboard({
  stats: all,
  game = 'gof',
  title = 'Classement du bureau',
  seasonOnly,
}: {
  stats: Stats | null;
  game?: GameId;
  title?: string;
  seasonOnly?: boolean;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const [tab, setTab] = useState<'season' | 'all'>('season');
  // Parties en ligne (au moins deux personnes) ou jouées seul contre des bots : deux classements séparés.
  const [mode, setMode] = useState<'online' | 'bots'>('online');

  if (!all) return null;
  const stats = all.games[game];
  // La fiche d'un joueur ne parle que de Gang of Four pour l'instant : pas de fiche depuis les autres classements.
  const withProfile = game === 'gof';
  const period = seasonOnly ? 'season' : tab;
  const ranking =
    mode === 'online' ? (period === 'season' ? stats.seasonal : stats.leaderboard) : period === 'season' ? stats.botSeasonal : stats.botLeaderboard;

  return (
    <>
      <section className="panel leaderboard">
        <div className="leaderboard-head">
          <h2>{title}</h2>
          {!seasonOnly && (
            <div className="segmented" role="tablist" aria-label="Période du classement">
              {(
                [
                  ['season', 'Saison'],
                  ['all', 'Général'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
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
        {withProfile && <p className="muted small">Clique sur un nom pour voir ses statistiques.</p>}
        {ranking.length === 0 && (
          <p className="muted">
            Aucune partie {mode === 'online' ? 'en ligne' : 'contre les bots'} terminée {period === 'season' ? 'cette saison ' : ''}pour l'instant.
          </p>
        )}
        <ol className="ranking">
          {ranking.map((e, i) => (
            <li key={e.name}>
              <span className="medal" aria-hidden>
                {['🥇', '🥈', '🥉'][i] ?? i + 1}
              </span>
              {withProfile ? (
                <button className="who" onClick={() => setShown(e.name)} title="Voir ses statistiques">
                  {e.name}
                </button>
              ) : (
                <span className="who">{e.name}</span>
              )}
              <span className="stat" title="Victoires / parties">
                <strong>{e.wins}</strong> / {e.games}
              </span>
              <span className="stat muted" title={withProfile ? 'Score moyen (le plus bas est le meilleur)' : 'Points moyens par partie'}>
                moy. {e.averageScore}
              </span>
            </li>
          ))}
        </ol>
        {stats.streak && mode === 'online' && (
          <p className="streak" title="Record du bureau : plus longue série de victoires d'affilée">
            🔥 Record :{' '}
            {withProfile ? (
              <button className="who" onClick={() => setShown(stats.streak!.name)}>
                {stats.streak.name}
              </button>
            ) : (
              <strong>{stats.streak.name}</strong>
            )}
            , <strong>{stats.streak.wins}</strong> victoires d'affilée
          </p>
        )}
      </section>
      {!seasonOnly && stats.recent.length > 0 && (
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
