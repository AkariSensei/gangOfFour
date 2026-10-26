import { type FormEvent, useState } from 'react';
import { AVATARS, COLORS, type Look, type Session } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { Leaderboard } from './Leaderboard';
import { errorLabel } from './labels';
import { saveLook, saveName, savedLook, savedName, socket } from './socket';

export function Home({ onEnter }: { onEnter: (s: Session) => void }) {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('salon')?.toUpperCase() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [look, setLook] = useState<Look>(savedLook);
  const [picking, setPicking] = useState(false);

  function changeLook(change: Look) {
    const next = { ...look, ...change };
    setLook(next);
    saveLook(next);
  }

  async function submit(kind: 'create' | 'join', e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    saveName(name);
    const result =
      kind === 'create'
        ? await socket.emitWithAck('room:create', { name, ...look })
        : await socket.emitWithAck('room:join', { code, name, ...look });
    setBusy(false);
    if (result.ok) onEnter(result);
    else setError(errorLabel(result.error));
  }

  return (
    <main className="home">
      <img className="home-logo" src="/cards/dos.webp" alt="" />
      <h1>
        Gang <span>of</span> Four
      </h1>
      <p className="tagline">Le jeu de cartes, entre collègues, chacun sur son poste.</p>

      <form className="panel" onSubmit={(e) => submit(code ? 'join' : 'create', e)}>
        <label htmlFor="pseudo">Ton pseudo</label>
        <div className="identity">
          <button
            type="button"
            className="avatar-button"
            onClick={() => setPicking((p) => !p)}
            title="Choisir ton avatar et ta couleur"
            aria-expanded={picking}
          >
            <Avatar name={name || '?'} look={look} />
          </button>
          <input
            id="pseudo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoFocus
            placeholder="ex. Camille"
          />
        </div>
        {picking && (
          <div className="look-picker">
            <div className="look-grid" role="radiogroup" aria-label="Avatar">
              <button
                type="button"
                role="radio"
                aria-checked={!look.avatar}
                className={!look.avatar ? 'on' : ''}
                onClick={() => changeLook({ avatar: undefined })}
                title="Mes initiales"
              >
                Aa
              </button>
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={look.avatar === a}
                  className={look.avatar === a ? 'on' : ''}
                  onClick={() => changeLook({ avatar: a })}
                >
                  {a}
                </button>
              ))}
            </div>
            <div className="look-colors" role="radiogroup" aria-label="Couleur">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={look.color === c}
                  aria-label={`Couleur ${c}`}
                  className={`swatch ${look.color === c ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => changeLook({ color: look.color === c ? undefined : c })}
                />
              ))}
            </div>
          </div>
        )}

        <div className="home-actions">
          <button type="button" className="primary" disabled={busy || !name.trim()} onClick={() => submit('create')}>
            Créer un salon
          </button>
          <div className="or">ou</div>
          <div className="join">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="CODE"
              aria-label="Code du salon"
              className="code-input"
            />
            <button type="submit" disabled={busy || !name.trim() || code.length !== 4}>
              Rejoindre
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      <Leaderboard />
    </main>
  );
}
