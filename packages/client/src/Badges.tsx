import { useEffect, useState } from 'react';
import type { Badge } from '../../server/src/protocol';
import { Profile } from './Profile';
import { socket } from './socket';

const done = (b: Badge) => b.value >= b.goal;

/** Grille des badges d'un joueur : obtenus en couleur, les autres en pointillés avec leur progression. */
export function BadgeGrid({ badges }: { badges: Badge[] }) {
  return (
    <ul className="badges">
      {badges.map((b) => (
        <li key={b.id} className={done(b) ? 'badge won' : 'badge'}>
          <span className="badge-icon" aria-hidden>
            {b.icon}
          </span>
          <strong>{b.name}</strong>
          <span className="badge-desc">{b.description}</span>
          {done(b) ? (
            <span className="badge-won">✓ Obtenu</span>
          ) : (
            b.goal > 1 && (
              <span className="badge-progress" title={`${b.value} / ${b.goal}`}>
                <span className="badge-bar">
                  <span style={{ width: `${(100 * b.value) / b.goal}%` }} />
                </span>
                <small>
                  {b.value} / {b.goal}
                </small>
              </span>
            )
          )}
        </li>
      ))}
    </ul>
  );
}

/** Mes badges sur l'accueil : une rangée d'icônes, la grille complète dans ma fiche. */
export function MyBadges({ name }: { name: string }) {
  const [badges, setBadges] = useState<Badge[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () => void socket.emitWithAck('stats:player', { name }).then((r) => setBadges(r.ok && r.profile ? r.profile.badges : null));
    load();
    socket.on('stats:changed', load);
    return () => {
      socket.off('stats:changed', load);
    };
  }, [name]);

  if (!badges) return null;
  // Une cinquantaine de badges : sur l'accueil, ceux obtenus, puis les trois les plus proches d'être gagnés.
  const won = badges.filter(done);
  const next = badges
    .filter((b) => !done(b))
    .sort((a, b) => b.value / b.goal - a.value / a.goal)
    .slice(0, 3);
  return (
    <section className="panel my-badges">
      <button className="my-badges-open" onClick={() => setOpen(true)} title="Voir mes badges">
        <h2>Mes badges</h2>
        <span className="muted">
          {badges.filter(done).length} / {badges.length}
        </span>
      </button>
      <div className="badge-strip">
        {won.map((b) => (
          <span key={b.id} className="won" title={`${b.name} : ${b.description}`}>
            {b.icon}
          </span>
        ))}
        {next.map((b) => (
          <span key={b.id} title={`Prochain : ${b.name} (${b.value} / ${b.goal}) : ${b.description}`}>
            {b.icon}
          </span>
        ))}
      </div>
      {next.length > 0 && <p className="muted small badge-next">Prochains : {next.map((b) => b.name).join(', ')}</p>}
      {open && <Profile name={name} onClose={() => setOpen(false)} />}
    </section>
  );
}
