import { useEffect, useState } from 'react';
import type { DailyView } from '../../server/src/protocol';
import { socket } from './socket';

/** Missions du jour et série du joueur connecté, rechargées à chaque fin de partie. */
export function useDaily(accountKey: unknown): DailyView | null {
  const [daily, setDaily] = useState<DailyView | null>(null);
  useEffect(() => {
    if (!accountKey) return;
    const load = async () => {
      const result = await socket.emitWithAck('daily:get');
      if (result.ok) setDaily(result.daily);
    };
    if (socket.connected) void load();
    socket.on('connect', load);
    socket.on('stats:changed', load);
    return () => {
      socket.off('connect', load);
      socket.off('stats:changed', load);
    };
  }, [accountKey]);
  return daily;
}

/** Expérience que rapportera le prochain jour de série (10 par jour d'affilée, 70 au plus). */
const nextStreakXp = (streak: number) => 10 * Math.min(streak + 1, 7);

/** En quelques mots pour le menu : missions accomplies, ou la prochaine à faire. */
export function dailySummary(daily: DailyView | null): string {
  if (!daily) return 'Trois missions par jour';
  const done = daily.missions.filter((m) => m.done).length;
  if (done === daily.missions.length) return 'Toutes accomplies, bravo ! Reviens demain';
  const next = daily.missions.find((m) => !m.done)!;
  return `${done} / ${daily.missions.length} · ${next.text}`;
}

/** Écran des missions du jour : les trois missions avec leur avancée, et la série de jours joués. */
export function DailyScreen({ daily }: { daily: DailyView | null }) {
  if (!daily) return <p className="muted">Chargement…</p>;
  const { streak, playedToday } = daily;
  return (
    <div className="daily-screen">
      <section className={`panel streak-card ${streak > 0 ? 'alive' : ''}`}>
        <span className="streak-flame" aria-hidden>
          🔥
        </span>
        <div>
          <strong>
            {streak > 0 ? `Série de ${streak} jour${streak > 1 ? 's' : ''}` : 'Pas de série en cours'}
          </strong>
          <p className="muted">
            {playedToday
              ? `C'est fait pour aujourd'hui : reviens demain pour la prolonger (+${nextStreakXp(streak)} XP).`
              : streak > 0
                ? `Joue une partie aujourd'hui pour la prolonger : +${nextStreakXp(streak)} XP.`
                : 'Joue une partie aujourd’hui pour la lancer : +10 XP, puis un peu plus chaque jour d’affilée.'}{' '}
            Le week-end ne la casse pas.
          </p>
        </div>
      </section>

      <ul className="missions">
        {daily.missions.map((m, i) => (
          <li key={m.id} className={`panel mission ${m.done ? 'done' : ''}`}>
            <span className="mission-tier" aria-hidden>
              {['🥉', '🥈', '🥇'][i]}
            </span>
            <div className="mission-text">
              <strong>{m.text}</strong>
              <span className="mission-bar">
                <span style={{ width: `${(100 * m.value) / m.goal}%` }} />
              </span>
              <small className="muted">{m.done ? 'Accomplie !' : `${m.value} / ${m.goal}`}</small>
            </div>
            <span className="mission-xp">{m.done ? '✓' : `+${m.xp} XP`}</span>
          </li>
        ))}
      </ul>
      <p className="muted small mission-help">
        Les mêmes missions pour tout le monde, renouvelées chaque jour à minuit. Seules comptent les parties en ligne, ou seul contre
        des bots tous en difficile.
      </p>
    </div>
  );
}
