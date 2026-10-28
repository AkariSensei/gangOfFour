import { useEffect, useState } from 'react';
import type { LiveRoom, Session } from '../../server/src/protocol';
import { AccountForm, AdminPanel, GoogleButton } from './Account';
import { Avatar } from './Avatar';
import { BadgesPage, useMyBadges } from './Badges';
import { Leaderboard } from './Leaderboard';
import { Rules } from './Rules';
import { errorLabel } from './labels';
import { socket, type useAccount } from './socket';

export function Home({
  onEnter,
  account: me,
  notice = '',
}: {
  onEnter: (s: Session) => void;
  account: ReturnType<typeof useAccount>;
  /** Message à montrer en arrivant sur l'accueil (par exemple après une exclusion). */
  notice?: string;
}) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('salon')?.toUpperCase() ?? '');
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [rules, setRules] = useState(false);
  const { account } = me;
  const badges = useMyBadges(account?.name || undefined);
  // Page « Mes badges » : elle a sa propre adresse (#badges), pour que le bouton Retour du navigateur ramène à l'accueil.
  const [badgesOpen, setBadgesOpen] = useState(() => location.hash === '#badges');
  useEffect(() => {
    const onPop = () => setBadgesOpen(location.hash === '#badges');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  function openBadges() {
    history.pushState(null, '', '#badges');
    setBadgesOpen(true);
  }
  function closeBadges() {
    if (location.hash === '#badges') history.back();
    else setBadgesOpen(false);
  }

  async function signIn(credential: string) {
    setError('');
    const failure = await me.signIn(credential);
    if (failure) setError(errorLabel(failure));
  }

  async function submit(kind: 'create' | 'join') {
    setBusy(true);
    setError('');
    const result = kind === 'create' ? await socket.emitWithAck('room:create') : await socket.emitWithAck('room:join', { code });
    setBusy(false);
    if (result.ok) onEnter(result);
    else setError(errorLabel(result.error));
  }

  let panel;
  if (account === undefined) {
    panel = <p className="muted">Connexion…</p>;
  } else if (account === null) {
    panel = (
      <>
        <p className="signin-hint">Connecte-toi avec ton compte Google pour jouer.</p>
        {me.googleClientId ? (
          <GoogleButton clientId={me.googleClientId} onCredential={signIn} />
        ) : (
          <p className="error">La connexion Google n'est pas encore configurée sur le serveur.</p>
        )}
      </>
    );
  } else if (!account.name || editing) {
    panel = (
      <AccountForm
        account={account}
        onSaved={(a) => {
          me.setAccount(a);
          setEditing(false);
        }}
        onCancel={account.name ? () => setEditing(false) : undefined}
      />
    );
  } else {
    panel = (
      <>
        <div className="signed-in">
          <button type="button" className="avatar-button" onClick={() => setEditing(true)} title="Modifier mon pseudo et mon avatar">
            <Avatar name={account.name} look={account} />
          </button>
          <strong>{account.name}</strong>
          {badges && (
            <button type="button" className="badges-button" onClick={openBadges} title="Voir tous mes badges">
              🏅 Mes badges{' '}
              <span>
                {badges.filter((b) => b.value >= b.goal).length} / {badges.length}
              </span>
            </button>
          )}
        </div>
        <form
          className="home-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code ? 'join' : 'create');
          }}
        >
          <button type="button" className="primary" disabled={busy} onClick={() => submit('create')}>
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
            <button type="submit" disabled={busy || code.length !== 4}>
              Rejoindre
            </button>
          </div>
        </form>
      </>
    );
  }

  if (badgesOpen && account?.name) return <BadgesPage badges={badges} onClose={closeBadges} />;

  return (
    <main className="home">
      <header className="home-hero">
        {/* Écran titre : les cartes maîtresses du jeu en éventail derrière le dos de carte. */}
        <div className="home-fan" aria-hidden>
          <img src="/cards/PV.webp" alt="" />
          <img src="/cards/1M.webp" alt="" />
          <img src="/cards/DR.webp" alt="" />
          <img src="/cards/PJ.webp" alt="" />
          <img className="home-logo" src="/cards/dos.webp" alt="" />
        </div>
        <h1>
          Gang <span>of</span> Four
        </h1>
        <p className="tagline">Le jeu de cartes, entre collègues, chacun sur son poste.</p>
        <button type="button" className="link small rules-link" onClick={() => setRules(true)}>
          Règles du jeu
        </button>
      </header>
      {rules && <Rules onClose={() => setRules(false)} />}

      <div className="home-start">
        <section className="panel">
          {panel}
          {error && <p className="error">{error}</p>}
          {account && (
            <div className="account-links">
              {account.admin && (
                <button type="button" className="link small" onClick={() => setAdmin(true)}>
                  Gérer les comptes
                </button>
              )}
              <button type="button" className="link small" onClick={() => void me.signOut()}>
                Se déconnecter
              </button>
            </div>
          )}
        </section>
        {admin && <AdminPanel onClose={() => setAdmin(false)} />}
        <LiveRooms onWatch={onEnter} />
      </div>

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

  async function watch(code: string, play = false) {
    setError('');
    const result = play ? await socket.emitWithAck('room:join', { code }) : await socket.emitWithAck('room:watch', { code });
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
              <span className="live-players">{r.players.map((p) => `${p.bot ? '🤖 ' : ''}${p.name} ${p.score}`).join(' · ')}</span>
              <span className="muted">
                Manche {r.round}
                {r.spectators > 0 && ` · 👀 ${r.spectators}`}
              </span>
            </div>
            <div className="live-actions">
              {r.open && (
                <button className="primary" onClick={() => watch(r.code, true)} title="Prendre la place laissée libre, tenue par un bot">
                  Jouer
                </button>
              )}
              <button onClick={() => watch(r.code)}>Regarder</button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
