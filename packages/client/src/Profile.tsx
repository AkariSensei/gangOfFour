import { useEffect, useState } from 'react';
import type { PlayerProfile } from '../../server/src/protocol';
import { ThemedBadgeGrid } from './Badges';
import { socket } from './socket';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Fiche d'un joueur : ses chiffres sur toutes ses parties, ouverte depuis le classement. */
export function Profile({ name, onClose }: { name: string; onClose: () => void }) {
  const [profile, setProfile] = useState<PlayerProfile | null | undefined>(undefined);

  useEffect(() => {
    void socket.emitWithAck('stats:player', { name }).then((r) => setProfile(r.ok ? r.profile : null));
  }, [name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal profile pop-in" role="dialog" aria-label={`Statistiques de ${name}`} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
        <h2>{profile?.name ?? name}</h2>
        {profile === undefined && <p className="muted">Chargement…</p>}
        {profile === null && <p className="muted">Pas encore de partie terminée.</p>}
        {profile && (
          // Grand écran : les chiffres et les dernières parties à gauche, tous les badges à droite.
          <div className="profile-body">
            <aside className="profile-side">
              <div className="profile-stats">
                <Stat value={profile.wins} label={`victoire${profile.wins > 1 ? 's' : ''} sur ${profile.games}`} />
                <Stat value={`${Math.round((100 * profile.wins) / profile.games)} %`} label="de victoires" />
                <Stat value={profile.averageScore} label="score moyen" />
                <Stat value={profile.bestScore} label="meilleur score" />
                <Stat
                  value={profile.roundsWon}
                  label={`manche${profile.roundsWon > 1 ? 's' : ''} gagnée${profile.roundsWon > 1 ? 's' : ''} sur ${profile.roundsPlayed}`}
                />
                <Stat value={profile.gangs} label={`gang${profile.gangs > 1 ? 's' : ''} posé${profile.gangs > 1 ? 's' : ''}`} />
                <Stat value={profile.worstRound} label="pire manche (pts)" />
              </div>
              <h3>Dernières parties</h3>
              <ul className="recent">
                {profile.recent.map((g) => (
                  <li key={g.finishedAt} className="profile-game">
                    <span className="muted">{dateFormat.format(new Date(g.finishedAt))}</span>
                    <span>
                      {g.winner ? '🏆 Victoire' : `${g.rank}e sur ${g.players}`} · {plural(g.score, 'pt')}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted small">
                Score : le plus bas est le meilleur. Manches gagnées, gangs et pire manche sont comptés depuis le 26 octobre.
              </p>
            </aside>
            <div className="profile-badges">
              <h3>
                Badges · {profile.badges.filter((b) => b.value >= b.goal).length} / {profile.badges.length}
              </h3>
              <ThemedBadgeGrid badges={profile.badges} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="profile-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
