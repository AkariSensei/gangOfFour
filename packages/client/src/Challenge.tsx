import { useEffect, useState } from 'react';
import type { ChallengeView, Session } from '../../server/src/protocol';
import { errorLabel } from './labels';
import { socket } from './socket';

const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Résultat d'un essai en quelques mots : coups joués pour une manche gagnée, cartes restées sinon. */
function outcome(won: boolean, moves: number, cardsLeft: number): string {
  return won ? `gagné en ${moves} coup${moves > 1 ? 's' : ''}` : `${cardsLeft} carte${cardsLeft > 1 ? 's' : ''} en main`;
}

/**
 * Défi du jour sur l'accueil : la même donne pour tout le monde, une seule manche contre trois bots difficiles,
 * un essai par jour. Le classement du jour et celui au long cours sont juste en dessous.
 */
export function DailyChallenge({ canPlay, onEnter }: { canPlay: boolean; onEnter: (s: Session) => void }) {
  const [challenge, setChallenge] = useState<ChallengeView | null>(null);
  const [tab, setTab] = useState<'today' | 'overall'>('today');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const result = await socket.emitWithAck('challenge:get');
      if (result.ok) setChallenge(result.challenge);
    };
    if (socket.connected) void load();
    socket.on('connect', load);
    socket.on('stats:changed', load);
    return () => {
      socket.off('connect', load);
      socket.off('stats:changed', load);
    };
    // Le compte change (connexion, déconnexion) : son essai du jour aussi.
  }, [canPlay]);

  async function start() {
    setError('');
    const result = await socket.emitWithAck('challenge:start');
    if (result.ok) onEnter(result);
    else setError(errorLabel(result.error));
  }

  if (!challenge) return null;
  const { mine, today, overall } = challenge;
  const day = dayFormat.format(new Date(`${challenge.day}T12:00:00`));

  return (
    <section className="panel daily-challenge">
      <div className="challenge-head">
        <h2>🗓️ Défi du jour</h2>
        <span className="muted">{day[0]!.toUpperCase() + day.slice(1)}</span>
      </div>
      <p className="muted small">La même donne pour tout le monde : une manche contre trois bots difficiles, un seul essai par jour.</p>

      {mine?.finished ? (
        <p className={`challenge-mine ${mine.won ? 'won' : 'lost'}`}>
          {mine.won ? '✅' : '❌'} Ton essai : <strong>{outcome(!!mine.won, mine.moves ?? 0, mine.cardsLeft ?? 0)}</strong>
          {mine.rank && (
            <>
              {' '}
              · <strong>{mine.rank}</strong>
              {mine.rank === 1 ? 'er' : 'e'} sur {today.length}
            </>
          )}
          . Prochain défi demain !
        </p>
      ) : mine ? (
        <p className="challenge-mine">⏳ Ton défi est en cours.</p>
      ) : canPlay && confirming ? (
        <div className="challenge-confirm">
          <span>Un seul essai aujourd'hui : prêt ?</span>
          <button className="primary" onClick={start}>
            C'est parti
          </button>
          <button className="ghost" onClick={() => setConfirming(false)}>
            Plus tard
          </button>
        </div>
      ) : canPlay ? (
        <button className="primary" onClick={() => setConfirming(true)}>
          Relever le défi
        </button>
      ) : null}
      {error && <p className="error">{error}</p>}

      {(today.length > 0 || overall.length > 0) && (
        <>
          <div className="segmented" role="tablist" aria-label="Classement du défi">
            {(
              [
                ['today', "Aujourd'hui"],
                ['overall', 'Au long cours'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'today' ? (
            today.length === 0 ? (
              <p className="muted">Personne n'a encore relevé le défi aujourd'hui.</p>
            ) : (
              <ol className="ranking">
                {today.map((e) => (
                  <li key={e.rank}>
                    <span className="medal" aria-hidden>
                      {['🥇', '🥈', '🥉'][e.rank - 1] ?? e.rank}
                    </span>
                    <span className="who">{e.name}</span>
                    <span className={`stat ${e.won ? '' : 'muted'}`}>{outcome(e.won, e.moves, e.cardsLeft)}</span>
                  </li>
                ))}
              </ol>
            )
          ) : (
            <ol className="ranking">
              {overall.map((e, i) => (
                <li key={e.name}>
                  <span className="medal" aria-hidden>
                    {['🥇', '🥈', '🥉'][i] ?? i + 1}
                  </span>
                  <span className="who">{e.name}</span>
                  <span className="stat" title="Défis gagnés / joués">
                    <strong>{e.wins}</strong> / {e.played}
                  </span>
                  <span className="stat muted" title="Plus longue série de jours d'affilée">
                    🔁 {e.bestStreak} j
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
