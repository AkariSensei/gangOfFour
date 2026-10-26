import { type FormEvent, useState } from 'react';
import type { Session } from '../../server/src/protocol';
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
    </main>
  );
}
