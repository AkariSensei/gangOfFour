import { useEffect, useMemo, useState } from 'react';
import type { Badge } from '../../server/src/protocol';
import { socket } from './socket';

const done = (b: Badge) => b.value >= b.goal;

/** Choix des badges montrés sur sa fiche : ceux épinglés, et de quoi épingler ou retirer un badge obtenu. */
export interface ShowcasePicker {
  pinned: string[];
  onToggle: (id: string) => void;
}

/**
 * Grille des badges d'un joueur : obtenus en couleur, les autres en pointillés avec leur progression. En haut à
 * droite, la part des joueurs qui l'ont obtenu ; sur sa propre page, une punaise pour le montrer sur sa fiche.
 */
export function BadgeGrid({ badges, picker }: { badges: Badge[]; picker?: ShowcasePicker }) {
  return (
    <ul className="badges">
      {badges.map((b) => (
        <li key={b.id} className={done(b) ? 'badge won' : 'badge'}>
          {b.percent !== undefined && (
            <span className="badge-rarity" title="Part des joueurs qui ont obtenu ce badge">
              {b.percent} %
            </span>
          )}
          {picker && done(b) && (
            <button
              className={`badge-pin ${picker.pinned.includes(b.id) ? 'on' : ''}`}
              onClick={() => picker.onToggle(b.id)}
              aria-pressed={picker.pinned.includes(b.id)}
              title={picker.pinned.includes(b.id) ? 'Retirer de ma fiche' : 'Montrer sur ma fiche'}
            >
              📌
            </button>
          )}
          <span className="badge-icon" aria-hidden>
            {b.icon}
          </span>
          <strong>{b.name}</strong>
          <span className="badge-desc">{b.description}</span>
          {b.serious && (
            <span className="badge-rule" title="Les parties contre des bots faciles ou moyens ne comptent pas pour ce badge">
              🎯 En ligne ou contre des bots difficiles
            </span>
          )}
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

/** Badges rangés par thème, dans l'ordre où le serveur les donne. */
function byTheme(badges: Badge[]): [string, Badge[]][] {
  const themes = new Map<string, Badge[]>();
  for (const b of badges) themes.set(b.theme, [...(themes.get(b.theme) ?? []), b]);
  return [...themes];
}

/** Grille des badges rangée par thème, avec le compte de badges obtenus dans chaque thème. */
export function ThemedBadgeGrid({ badges, picker }: { badges: Badge[]; picker?: ShowcasePicker }) {
  return (
    <div className="badge-themes">
      {byTheme(badges).map(([theme, list]) => (
        <section key={theme} className="badge-theme">
          <h3>
            {theme || 'Badges'}{' '}
            <span className="muted">
              {list.filter(done).length} / {list.length}
            </span>
          </h3>
          <BadgeGrid badges={list} picker={picker} />
        </section>
      ))}
    </div>
  );
}

/** Mes badges, rechargés à chaque fin de partie (ou remise à zéro du classement). */
export function useMyBadges(name: string | undefined): Badge[] | null {
  const [badges, setBadges] = useState<Badge[] | null>(null);
  useEffect(() => {
    if (!name) return;
    const load = () => void socket.emitWithAck('stats:player', { name }).then((r) => setBadges(r.ok && r.profile ? r.profile.badges : []));
    load();
    socket.on('stats:changed', load);
    return () => {
      socket.off('stats:changed', load);
    };
  }, [name]);
  return badges;
}

type Filter = 'all' | 'won' | 'todo';

/**
 * Page « Mes badges » : tous les badges du joueur, par thème, avec leur description et leur progression.
 * Elle remplace l'accueil ; le bouton Retour (ou celui du navigateur) y ramène.
 */
export function BadgesPage({
  badges,
  showcase,
  onShowcase,
  onClose,
}: {
  badges: Badge[] | null;
  /** Badges épinglés sur sa fiche. */
  showcase: string[];
  onShowcase: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = useMemo(
    () => (badges ?? []).filter((b) => filter === 'all' || (filter === 'won' ? done(b) : !done(b))),
    [badges, filter],
  );
  // Trois badges au plus sur la fiche : épingler un quatrième remplace le plus ancien.
  const picker: ShowcasePicker = {
    pinned: showcase,
    onToggle: (id) => onShowcase(showcase.includes(id) ? showcase.filter((x) => x !== id) : [...showcase, id].slice(-3)),
  };
  const wonCount = badges?.filter(done).length ?? 0;
  const total = badges?.length ?? 0;
  return (
    <main className="badges-page">
      <header className="badges-page-head">
        <button className="link" onClick={onClose}>
          ← Retour
        </button>
        <h1>Mes badges</h1>
        <div className="badges-page-progress" title={`${wonCount} badges obtenus sur ${total}`}>
          <strong>
            {wonCount} / {total}
          </strong>
          <span className="badge-bar">
            <span style={{ width: `${total ? (100 * wonCount) / total : 0}%` }} />
          </span>
        </div>
      </header>
      <div className="segmented badges-filter" role="tablist" aria-label="Badges à afficher">
        {(
          [
            ['all', 'Tous'],
            ['won', 'Obtenus'],
            ['todo', 'À gagner'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <p className="muted small badges-hint">
        📌 Épingle jusqu'à 3 badges pour les montrer sur ta fiche
        {showcase.length === 0 ? ' : sans choix, ce sont tes 3 badges les plus rares.' : ` (${showcase.length} / 3).`} Le
        pourcentage indique la part des joueurs qui ont obtenu le badge. 🎯 : seules comptent les parties en ligne, ou seul contre des
        bots tous en difficile.
      </p>
      {!badges ? (
        <p className="muted">Chargement…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{filter === 'won' ? 'Aucun badge pour l’instant : joue une partie pour commencer !' : 'Tous les badges sont obtenus, bravo !'}</p>
      ) : (
        <ThemedBadgeGrid badges={shown} picker={picker} />
      )}
    </main>
  );
}

/** Durée d'affichage d'une annonce de badge. */
const TOAST_MS = 8000;

/**
 * Annonces des badges qu'on vient d'obtenir, en bas à droite de l'écran : icône, titre et description.
 * Elles arrivent une à une, s'en vont d'elles-mêmes, et un clic les ferme.
 */
export function BadgeToasts() {
  const [toasts, setToasts] = useState<(Badge & { key: string })[]>([]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onWon = (badges: Badge[]) =>
      badges.forEach((b, i) => {
        const key = `${b.id}-${Date.now()}`;
        timers.push(setTimeout(() => setToasts((t) => [...t, { ...b, key }]), i * 600));
        timers.push(setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), i * 600 + TOAST_MS));
      });
    socket.on('badges:won', onWon);
    return () => {
      socket.off('badges:won', onWon);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="badge-toasts" role="status" aria-live="polite">
      {toasts.map((b) => (
        <button key={b.key} className="badge-toast" onClick={() => setToasts((t) => t.filter((x) => x.key !== b.key))} title="Fermer">
          <span className="badge-toast-icon" aria-hidden>
            {b.icon}
          </span>
          <span className="badge-toast-text">
            <small>Nouveau badge !</small>
            <strong>{b.name}</strong>
            <span>{b.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

