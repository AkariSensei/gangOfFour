import { Flame, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GameId, GameStats, Season } from '../../server/src/protocol';
import { Profile } from './Profile';
import { socket } from './socket';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Points affichés à la française : « 1 024 ». */
export const pointsFormat = new Intl.NumberFormat('fr-FR');

/** L'unité d'une partie, pour les dernières parties : des manches, des tours ou des tirs. */
const ROUND_UNITS: Record<GameId, string> = { gof: 'manche', slots: 'tour', battleship: 'tir' };

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
  /** Seulement le classement, sans les dernières parties. */
  seasonOnly?: boolean;
}) {
  const [shown, setShown] = useState<string | null>(null);

  if (!all) return null;
  const stats = all.games[game];
  // La fiche d'un joueur ne parle que de Gang of Four pour l'instant : pas de fiche depuis les autres classements.
  const withProfile = game === 'gof';
  // Les points de la saison : chacun part de 1000, seules les parties entre humains comptent.
  const ranking = stats.ranking;

  return (
    <>
      <section className="panel leaderboard">
        <div className="leaderboard-head">
          <h2>{title}</h2>
        </div>
        {shown && <Profile name={shown} onClose={() => setShown(null)} />}
        <p className="muted small">
          Chacun part de 1000 points à chaque saison. Gagner contre plus fort que soi rapporte plus, perdre contre plus faible
          coûte plus.{withProfile && ' Clique sur un nom pour voir ses statistiques.'}
        </p>
        {ranking.length === 0 && <p className="muted">Aucune partie classée cette saison pour l'instant.</p>}
        <ol className="ranking">
          {ranking.map((e, i) => (
            <li key={e.name}>
              <span className="medal" aria-hidden>
                {i + 1}
              </span>
              {withProfile ? (
                <button className="who" onClick={() => setShown(e.name)} title="Voir ses statistiques">
                  {e.name}
                </button>
              ) : (
                <span className="who">{e.name}</span>
              )}
              <span className="stat muted" title="Victoires et parties de la saison">
                {e.wins} V · {e.games} partie{e.games > 1 ? 's' : ''}
              </span>
              <span className="stat rating" title="Points de la saison">
                {pointsFormat.format(e.rating)}
              </span>
            </li>
          ))}
        </ol>
        {stats.streak && (
          <p className="streak" title="Record du bureau : plus longue série de victoires d'affilée">
            <Flame /> Record :{' '}
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
                  <Trophy />{' '}
                  {r.players
                    .filter((p) => p.winner)
                    .map((p) => p.name)
                    .join(', ')}{' '}
                  <span className="muted">
                    · {r.players.length} joueurs · {r.rounds} {ROUND_UNITS[game]}
                    {r.rounds > 1 ? 's' : ''}
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
