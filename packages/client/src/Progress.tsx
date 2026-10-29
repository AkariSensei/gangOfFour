import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { type AccountView, FELTS, FRAMES, LEVEL_TITLES, type PlayerProfile, type Progress } from '../../server/src/protocol';
import { AccountForm } from './Account';
import { Avatar } from './Avatar';
import { errorLabel } from './labels';
import { socket } from './socket';

/** Niveau d'un joueur qui n'a encore fini ni partie ni défi. */
export const FIRST_LEVEL: Progress = { xp: 0, level: 1, levelXp: 0, levelSpan: 100, title: LEVEL_TITLES[0]!.title };

/** Barre d'expérience vers le niveau suivant. */
export function LevelBar({ progress, compact }: { progress: Progress; compact?: boolean }) {
  return (
    <span className={`level-bar ${compact ? 'compact' : ''}`} title={`${progress.levelXp} / ${progress.levelSpan} XP vers le niveau ${progress.level + 1}`}>
      <span style={{ width: `${(100 * progress.levelXp) / progress.levelSpan}%` }} />
    </span>
  );
}

/** Pastille du niveau, posée sur l'avatar. */
export function LevelBadge({ level }: { level: number }) {
  return (
    <span className="level-badge" aria-label={`Niveau ${level}`}>
      {level}
    </span>
  );
}

/**
 * Écran « Mon profil » : son niveau et son expérience, son pseudo et son avatar, et les récompenses à choisir
 * (tapis, cadre, titre), celles pas encore débloquées en retrait avec le niveau qui les débloque.
 */
export function ProfileScreen({
  account,
  profile,
  onAccount,
}: {
  account: AccountView;
  profile: PlayerProfile | null | undefined;
  onAccount: (a: AccountView) => void;
}) {
  const progress = profile?.progress ?? FIRST_LEVEL;
  const unlocks = profile?.unlocks ?? { felts: ['vert'], frames: [], titles: [FIRST_LEVEL.title] };
  const [error, setError] = useState('');
  const chosen = { felt: account.felt ?? '', frame: account.frame ?? '', title: account.title ?? '' };

  async function choose(change: Partial<typeof chosen>) {
    setError('');
    const result = await socket.emitWithAck('account:cosmetics', { ...chosen, ...change });
    if (result.ok) onAccount(result.account);
    else setError(errorLabel(result.error));
  }

  // Les titres de niveau dans l'ordre (verrouillés compris), puis ceux gagnés avec les badges.
  const badgeTitles = unlocks.titles.filter((t) => !LEVEL_TITLES.some((l) => l.title === t));
  const remaining = progress.levelSpan - progress.levelXp;

  return (
    <div className="profile-screen">
      <section className="panel level-card">
        <div className="level-avatar">
          <Avatar name={account.name} look={account} />
          <LevelBadge level={progress.level} />
        </div>
        <div className="level-info">
          <strong>{account.name}</strong>
          <span className="level-title">{account.title || progress.title}</span>
          <LevelBar progress={progress} />
          <small className="muted">
            Niveau {progress.level} · {progress.xp} XP au total · encore {remaining} XP pour le niveau {progress.level + 1}
          </small>
        </div>
      </section>

      <div className="profile-columns">
        <section className="panel">
          <h3>Pseudo et avatar</h3>
          <AccountForm key={`${account.name}-${account.avatar}-${account.color}`} account={account} onSaved={onAccount} />
        </section>

        <div className="rewards">
          <section className="panel">
            <h3>Tapis de jeu</h3>
            <p className="muted small">Ta table, vue par toi seul.</p>
            <div className="reward-grid">
              {FELTS.map((f) => {
                const open = unlocks.felts.includes(f.id);
                const on = (chosen.felt || 'vert') === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`reward felt-swatch ${on ? 'on' : ''} ${open ? '' : 'locked'}`}
                    disabled={!open}
                    onClick={() => void choose({ felt: f.id === 'vert' ? '' : f.id })}
                    aria-pressed={on}
                  >
                    <span className={`felt-preview felt-${f.id}`} />
                    <span>{f.name}</span>
                    {!open && <small>🔒 Niveau {f.level}</small>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <h3>Cadre d'avatar</h3>
            <p className="muted small">Autour de ton avatar, vu de toute la table.</p>
            <div className="reward-grid">
              <button type="button" className={`reward ${chosen.frame ? '' : 'on'}`} onClick={() => void choose({ frame: '' })} aria-pressed={!chosen.frame}>
                <Avatar name={account.name} look={{ ...account, frame: undefined }} />
                <span>Aucun</span>
              </button>
              {FRAMES.map((f) => {
                const open = unlocks.frames.includes(f.id);
                const on = chosen.frame === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={`reward ${on ? 'on' : ''} ${open ? '' : 'locked'}`}
                    disabled={!open}
                    onClick={() => void choose({ frame: f.id })}
                    aria-pressed={on}
                  >
                    <Avatar name={account.name} look={{ ...account, frame: f.id }} />
                    <span>{f.name}</span>
                    {!open && <small>🔒 Niveau {f.level}</small>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <h3>Titre</h3>
            <p className="muted small">Sous ton pseudo. Les badges obtenus en donnent d'autres.</p>
            <div className="title-chips">
              {LEVEL_TITLES.map((t) => {
                const open = unlocks.titles.includes(t.title);
                const on = (chosen.title || progress.title) === t.title;
                return (
                  <button
                    key={t.title}
                    type="button"
                    className={`chip ${on ? 'on' : ''} ${open ? '' : 'locked'}`}
                    disabled={!open}
                    onClick={() => void choose({ title: t.title === progress.title ? '' : t.title })}
                    title={open ? undefined : `Débloqué au niveau ${t.level}`}
                  >
                    {open ? t.title : `🔒 ${t.title} · niv. ${t.level}`}
                  </button>
                );
              })}
              {badgeTitles.map((title) => (
                <button key={title} type="button" className={`chip ${chosen.title === title ? 'on' : ''}`} onClick={() => void choose({ title })}>
                  🏅 {title}
                </button>
              ))}
            </div>
          </section>
          {error && <p className="error">{error}</p>}
        </div>
      </div>

      <p className="muted small xp-help">
        L'expérience : 40 XP par partie, 60 de plus pour une victoire, 8 par manche gagnée, 10 par gang posé, 30 par défi du jour
        (80 s'il est gagné) et 40 par badge. Contre des bots, elle compte en entier en difficile, à 60 % en moyen et à 30 % en
        facile.
      </p>
    </div>
  );
}

/** Expérience gagnée avec la dernière partie (annoncée par le serveur à la fin), pour l'écran de fin. */
export type ProgressGain = { gained: number; before: Progress; after: Progress; rewards: string[] };

export function useProgressGain(): [ProgressGain | null, () => void] {
  const [gain, setGain] = useState<ProgressGain | null>(null);
  useEffect(() => {
    socket.on('progress:gained', setGain);
    return () => {
      socket.off('progress:gained', setGain);
    };
  }, []);
  const clear = useCallback(() => setGain(null), []);
  return [gain, clear];
}

/**
 * Fin de partie : « +140 XP », la barre qui se remplit depuis où elle en était, et, en cas de niveau supérieur,
 * l'annonce du nouveau niveau et de ce qu'il débloque.
 */
export function XpGain({ gain }: { gain: ProgressGain }) {
  const { before, after } = gain;
  const levelUp = after.level > before.level;
  // La barre part de la position d'avant (ou de zéro si un niveau est passé) puis glisse jusqu'à la nouvelle.
  const [width, setWidth] = useState(levelUp ? 0 : (100 * before.levelXp) / before.levelSpan);
  useEffect(() => {
    const t = setTimeout(() => setWidth((100 * after.levelXp) / after.levelSpan), 450);
    return () => clearTimeout(t);
  }, [after]);
  return (
    <div className={`xp-gain ${levelUp ? 'level-up' : ''}`}>
      <div className="xp-gain-head">
        <strong className="xp-amount">+{gain.gained} XP</strong>
        <span>
          Niveau <b>{after.level}</b>
          {levelUp && <span className="level-up-tag">Niveau supérieur !</span>}
        </span>
      </div>
      <span className="level-bar big">
        <span style={{ width: `${width}%` } as CSSProperties} />
      </span>
      <small className="muted">
        {after.levelXp} / {after.levelSpan} XP vers le niveau {after.level + 1}
      </small>
      {gain.rewards.length > 0 && <p className="xp-rewards">🎁 Débloqué : {gain.rewards.join(' · ')}</p>}
    </div>
  );
}
