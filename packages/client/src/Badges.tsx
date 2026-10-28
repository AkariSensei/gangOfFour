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
  return (
    <section className="panel my-badges">
      <button className="my-badges-open" onClick={() => setOpen(true)} title="Voir mes badges">
        <h2>Mes badges</h2>
        <span className="muted">
          {badges.filter(done).length} / {badges.length}
        </span>
      </button>
      <div className="badge-strip">
        {badges.map((b) => (
          <span key={b.id} className={done(b) ? 'won' : ''} title={`${b.name} : ${b.description}`}>
            {b.icon}
          </span>
        ))}
      </div>
      {open && <Profile name={name} onClose={() => setOpen(false)} />}
    </section>
  );
}
