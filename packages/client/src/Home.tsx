import { type FormEvent, useEffect, useState } from 'react';
import type { LiveRoom, Session } from '../../server/src/protocol';
import { Leaderboard } from './Leaderboard';
import { errorLabel } from './labels';
import { saveName, savedName, socket } from './socket';

export function Home({ onEnter }: { onEnter: (s: Session) => void }) {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('salon')?.toUpperCase() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(kind: 'create' | 'join', e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    saveName(name);
    const result =
      kind === 'create'
        ? await socket.emitWithAck('room:create', { name })
        : await socket.emitWithAck('room:join', { code, name });
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
        <label>
          Ton pseudo
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus placeholder="ex. Camille" />
        </label>

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
