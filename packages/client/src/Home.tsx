import { type FormEvent, useEffect, useState } from 'react';
import { AVATARS, COLORS, type LiveRoom, type Look, type Session } from '../../server/src/protocol';
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

      <LiveRooms onWatch={onEnter} />
      <Leaderboard />
    </main>
  );
}

/** Parties en cours que l'on peut regarder sans jouer ; la liste se met à jour toute seule. */
function LiveRooms({ onWatch }: { onWatch: (s: Session) => void }) {
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const result = await socket.emitWithAck('rooms:live');
      if (active && result.ok) setRooms(result.rooms);
    };
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  async function watch(code: string) {
    setError('');
    const result = await socket.emitWithAck('room:watch', { code });
    if (result.ok) onWatch(result);
    else setError(errorLabel(result.error));
  }

  if (rooms.length === 0) return null;
  return (
    <section className="panel live-rooms">
      <h2>Parties en cours</h2>
      <ul>
        {rooms.map((r) => (
          <li key={r.code}>
            <div className="live-info">
              <span className="live-players">
                {r.players.map((p) => `${p.bot ? '🤖 ' : ''}${p.name} ${p.score}`).join(' · ')}
              </span>
              <span className="muted">
                Manche {r.round}
                {r.spectators > 0 && ` · 👀 ${r.spectators}`}
              </span>
            </div>
            <button onClick={() => watch(r.code)}>Regarder</button>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
