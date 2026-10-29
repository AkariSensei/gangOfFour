import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { BotLevel, LiveRoom, Session } from '../../server/src/protocol';
import { AccountForm, AdminPanel, GoogleButton } from './Account';
import { Avatar } from './Avatar';
import { BadgesPage, useMyBadges } from './Badges';
import { DailyChallenge, challengeSummary, useDailyChallenge } from './Challenge';
import { Leaderboard } from './Leaderboard';
import { Rules } from './Rules';
import { LEVEL_LABELS, errorLabel } from './labels';
import { socket, type useAccount } from './socket';

/** Le joueur a vu (suivi ou refusé) la proposition de tutoriel sur ce navigateur. */
const TUTORIAL_SEEN = 'gof-tutorial-seen';

/** Écrans de l'accueil : le menu principal, et un écran par entrée du menu (chacun a son adresse, #jouer…). */
const SCREENS = ['menu', 'jouer', 'defi', 'regarder', 'classement', 'badges'] as const;
type Screen = (typeof SCREENS)[number];

const screenOf = (hash: string): Screen => {
  const name = hash.replace('#', '');
  return (SCREENS as readonly string[]).includes(name) ? (name as Screen) : 'menu';
};

/** Durée de la transition entre deux écrans (doit suivre l'animation de styles.css). */
const TRANSITION_MS = 380;

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
  const invite = new URLSearchParams(location.search).get('salon')?.toUpperCase() ?? '';
  const [error, setError] = useState(notice);
  const [editing, setEditing] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [rules, setRules] = useState(false);
  const { account } = me;
  const signedIn = !!account?.name;
  const badges = useMyBadges(account?.name || undefined);
  const challenge = useDailyChallenge(account?.id);
  const live = useLiveRooms();

  // Navigation entre les écrans : l'adresse suit l'écran, pour que le bouton Retour du navigateur ramène au menu.
  // Un lien d'invitation (?salon=1234) ouvre directement l'écran « Jouer », le code déjà rempli.
  const [screen, setScreen] = useState<Screen>(() => (invite ? 'jouer' : screenOf(location.hash)));
  const [leaving, setLeaving] = useState<{ screen: Screen; back: boolean } | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
  function show(next: Screen, back: boolean) {
    if (next === screen) return;
    setError('');
    clearTimeout(leaveTimer.current);
    setLeaving({ screen, back });
    setScreen(next);
    leaveTimer.current = setTimeout(() => setLeaving(null), TRANSITION_MS);
  }
  useEffect(() => {
    const onPop = () => show(screenOf(location.hash), screenOf(location.hash) === 'menu');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  function open(next: Screen) {
    history.pushState(null, '', `${location.pathname}${location.search}#${next}`);
    show(next, false);
  }
  function backToMenu() {
    if (location.hash) history.back();
    else show('menu', true);
  }

  // Première fois : tant qu'il n'a fini aucune partie et n'a pas refusé, on lui propose le tutoriel.
  const [tutorialSeen, setTutorialSeen] = useState(() => {
    try {
      return localStorage.getItem(TUTORIAL_SEEN) === '1';
    } catch {
      return false;
    }
  });
  const firstTime = !tutorialSeen && !!badges && !badges.some((b) => b.id === 'games-1' && b.value >= b.goal);
  function dismissTutorial() {
    try {
      localStorage.setItem(TUTORIAL_SEEN, '1');
    } catch {
      // Sans stockage, la proposition reviendra à la prochaine visite : rien de grave.
    }
    setTutorialSeen(true);
  }
  async function startTutorial() {
    setError('');
    const result = await socket.emitWithAck('tutorial:start');
    if (!result.ok) return setError(errorLabel(result.error));
    dismissTutorial();
    onEnter(result);
  }

  async function signIn(credential: string) {
    setError('');
    const failure = await me.signIn(credential);
    if (failure) setError(errorLabel(failure));
  }

  async function setShowcase(badgeIds: string[]) {
    const result = await socket.emitWithAck('account:showcase', { badgeIds });
    if (result.ok) me.setAccount(result.account);
  }

  const wonBadges = badges?.filter((b) => b.value >= b.goal).length ?? 0;

  function render(s: Screen): ReactNode {
    // Sans compte (ou sans pseudo), seul le menu s'affiche, avec la connexion à la place des entrées.
    if (!signedIn && s !== 'menu') return null;
    switch (s) {
      case 'menu':
        return (
          <div className="menu-screen">
            <div className="menu-title">
              {/* Écran titre : les cartes maîtresses du jeu en éventail derrière le dos de carte. */}
              <div className="home-fan" aria-hidden>
                <img src="/cards/PV.webp" alt="" />
                <img src="/cards/1M.webp" alt="" />
                <img src="/cards/DR.webp" alt="" />
                <img src="/cards/PJ.webp" alt="" />
                <img className="home-logo" src="/cards/dos.webp" alt="" />
              </div>
              <h1 className="game-title">
                Gang <span>of</span> Four
              </h1>
              <p className="tagline">Le jeu de cartes, entre collègues, chacun sur son poste.</p>
            </div>
            <div className="menu-side">
              {account === undefined ? (
                <p className="muted menu-loading">Connexion…</p>
              ) : account === null ? (
                <section className="panel signin-panel">
                  <p className="signin-hint">Connecte-toi avec ton compte Google pour jouer.</p>
                  {me.googleClientId ? (
                    <GoogleButton clientId={me.googleClientId} onCredential={signIn} />
                  ) : (
                    <p className="error">La connexion Google n'est pas encore configurée sur le serveur.</p>
                  )}
                </section>
              ) : !account.name ? (
                <section className="panel signin-panel">
                  <AccountForm account={account} onSaved={(a) => me.setAccount(a)} />
                </section>
              ) : (
                <>
                  {firstTime && (
                    <div className="first-time">
                      <strong>🎓 Première partie ?</strong>
                      <p>
                        Un tutoriel de deux minutes t'apprend les règles en jouant : une manche guidée contre trois bots, que tu gagnes à
                        coup sûr.
                      </p>
                      <div className="first-time-actions">
                        <button type="button" className="primary" onClick={startTutorial}>
                          Suivre le tutoriel
                        </button>
                        <button type="button" className="ghost" onClick={dismissTutorial}>
                          Non merci, partie classique
                        </button>
                      </div>
                    </div>
                  )}
                  <nav className="game-menu" aria-label="Menu principal">
                    <MenuItem primary icon="🃏" title="Jouer" subtitle="Créer un salon, rejoindre des collègues, partie rapide" onClick={() => open('jouer')} />
                    <MenuItem
                      icon="🗓️"
                      title="Défi du jour"
                      subtitle={challengeSummary(challenge)}
                      pill={challenge && !challenge.mine ? { text: 'Nouveau' } : undefined}
                      onClick={() => open('defi')}
                    />
                    <MenuItem
                      icon="👀"
                      title="Regarder"
                      subtitle={live.length === 0 ? 'Aucune partie en cours' : 'Parties en cours des collègues'}
                      pill={live.length > 0 ? { text: `${live.length} en cours`, live: true } : undefined}
                      onClick={() => open('regarder')}
                    />
                    <div className="menu-tiles">
                      <MenuItem tile icon="🏆" title="Classement" subtitle="Le bureau, ce mois-ci" onClick={() => open('classement')} />
                      <MenuItem tile icon="🏅" title="Badges" subtitle={badges?.length ? `${wonBadges} / ${badges.length}` : 'À gagner'} onClick={() => open('badges')} />
                      <MenuItem tile icon="🎓" title="Tutoriel" subtitle="2 minutes" onClick={() => void startTutorial()} />
                      <MenuItem tile icon="📜" title="Règles" subtitle="Combinaisons, scores" onClick={() => setRules(true)} />
                    </div>
                  </nav>
                </>
              )}
              {error && <p className="error">{error}</p>}
            </div>
          </div>
        );
      case 'jouer':
        return (
          <SubScreen title="Jouer" onBack={backToMenu}>
            <PlayScreen initialCode={invite} onEnter={onEnter} />
          </SubScreen>
        );
      case 'defi':
        return (
          <SubScreen title="Défi du jour" onBack={backToMenu} narrow>
            <DailyChallenge canPlay={signedIn} onEnter={onEnter} />
          </SubScreen>
        );
      case 'regarder':
        return (
          <SubScreen title="Regarder" onBack={backToMenu} narrow>
            <LiveRooms rooms={live} onWatch={onEnter} />
          </SubScreen>
        );
      case 'classement':
        return (
          <SubScreen title="Classement" onBack={backToMenu}>
            <div className="ranking-screen">
              <Leaderboard />
            </div>
          </SubScreen>
        );
      case 'badges':
        return <BadgesPage badges={badges} showcase={account?.showcase ?? []} onShowcase={(ids) => void setShowcase(ids)} onClose={backToMenu} />;
    }
  }

  return (
    <main className="home-menu">
      {signedIn && account && (
        <header className="menu-topbar">
          <button type="button" className="player-card" onClick={() => setEditing(true)} title="Modifier mon pseudo et mon avatar">
            <Avatar name={account.name} look={account} />
            <span>
              <strong>{account.name}</strong>
              <small>
                🏅 {wonBadges} badge{wonBadges > 1 ? 's' : ''}
              </small>
            </span>
          </button>
          <div className="menu-topbar-actions">
            {account.admin && (
              <button type="button" className="round-button" onClick={() => setAdmin(true)} title="Gérer les comptes">
                ⚙️
              </button>
            )}
            <button type="button" className="round-button" onClick={() => void me.signOut()} title="Se déconnecter">
              🚪
            </button>
          </div>
        </header>
      )}
      <div className="screens">
        {leaving && (
          <div key={`sortie-${leaving.screen}`} className={`screen-view leaving ${leaving.back ? 'back' : ''}`} aria-hidden>
            {render(leaving.screen)}
          </div>
        )}
        <div key={screen} className={`screen-view ${leaving ? 'entering' : ''} ${leaving?.back ? 'back' : ''}`}>
          {render(screen)}
        </div>
      </div>
      {rules && <Rules onClose={() => setRules(false)} />}
      {admin && <AdminPanel onClose={() => setAdmin(false)} />}
      {editing && account?.name && (
        <div className="overlay" onClick={() => setEditing(false)}>
          <div className="panel modal account-modal pop-in" onClick={(e) => e.stopPropagation()}>
            <AccountForm
              account={account}
              onSaved={(a) => {
                me.setAccount(a);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        </div>
      )}
    </main>
  );
}

/** Entrée du menu principal : grande (Jouer), normale, ou en tuile ; avec une pastille éventuelle (« Nouveau »). */
function MenuItem({
  icon,
  title,
  subtitle,
  onClick,
  primary,
  tile,
  pill,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onClick: () => void;
  primary?: boolean;
  tile?: boolean;
  pill?: { text: string; live?: boolean };
}) {
  return (
    <button type="button" className={`menu-item ${primary ? 'primary' : ''} ${tile ? 'tile' : ''}`} onClick={onClick}>
      {pill && <span className={`menu-pill ${pill.live ? 'live' : ''}`}>{pill.text}</span>}
      <span className="menu-icon" aria-hidden>
        {icon}
      </span>
      <span className="menu-text">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      {!tile && (
        <span className="menu-chevron" aria-hidden>
          ›
        </span>
      )}
    </button>
  );
}

/** Écran secondaire de l'accueil : un titre, le retour au menu, et son contenu. */
function SubScreen({ title, onBack, narrow, children }: { title: string; onBack: () => void; narrow?: boolean; children: ReactNode }) {
  return (
    <div className={`sub-screen ${narrow ? 'narrow' : ''}`}>
      <div className="sub-head">
        <button type="button" className="back-button" onClick={onBack}>
          ← Menu
        </button>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

/** Écran « Jouer » : créer un salon, rejoindre avec un code, ou lancer tout de suite une partie contre trois bots. */
function PlayScreen({ initialCode, onEnter }: { initialCode: string; onEnter: (s: Session) => void }) {
  const [code, setCode] = useState(initialCode);
  const [level, setLevel] = useState<BotLevel>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<{ ok: true } & Session | { ok: false; error: string }>) {
    setBusy(true);
    setError('');
    const result = await action();
    setBusy(false);
    if (result.ok) onEnter(result);
    else setError(errorLabel(result.error));
  }

  /** Partie rapide : un salon, trois bots du niveau choisi, et la partie démarre aussitôt (sans passer par le salon). */
  async function quickGame() {
    const created = await socket.emitWithAck('room:create');
    if (!created.ok) return created;
    for (let i = 0; i < 3; i++) {
      const added = await socket.emitWithAck('room:addBot', { level });
      if (!added.ok) return added;
    }
    const started = await socket.emitWithAck('game:start', {});
    if (!started.ok) {
      await socket.emitWithAck('room:leave');
      return started;
    }
    return created;
  }

  return (
    <>
      <div className="choices">
        <section className="choice">
          <span className="choice-icon" aria-hidden>
            🪑
          </span>
          <strong>Créer un salon</strong>
          <p>Invite tes collègues avec un code, ou complète la table avec des bots.</p>
          <button type="button" className="primary" disabled={busy} onClick={() => void run(() => socket.emitWithAck('room:create'))}>
            Créer
          </button>
        </section>
        <form
          className="choice"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 4) void run(() => socket.emitWithAck('room:join', { code }));
          }}
        >
          <span className="choice-icon" aria-hidden>
            🔑
          </span>
          <strong>Rejoindre</strong>
          <p>Un collègue t'a donné le code de son salon&nbsp;?</p>
          <div className="join">
            <input
              value={code}
              // Codes en chiffres ; les lettres restent acceptées pour les salons ouverts avant ce changement.
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
              maxLength={4}
              inputMode="numeric"
              placeholder="1234"
              aria-label="Code du salon"
              className="code-input"
            />
            <button type="submit" className="primary" disabled={busy || code.length !== 4}>
              Go
            </button>
          </div>
        </form>
        <section className="choice">
          <span className="choice-icon" aria-hidden>
            🤖
          </span>
          <strong>Partie rapide</strong>
          <p>Toi contre trois bots, au niveau de ton choix : la partie démarre tout de suite.</p>
          <div className="segmented" role="radiogroup" aria-label="Niveau des bots">
            {(Object.entries(LEVEL_LABELS) as [BotLevel, string][]).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={level === id} className={level === id ? 'on' : ''} onClick={() => setLevel(id)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="primary" disabled={busy} onClick={() => void run(quickGame)}>
            Lancer
          </button>
        </section>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

/** Parties en cours, rechargées toutes les 10 secondes (pour le menu et l'écran « Regarder »). */
function useLiveRooms(): LiveRoom[] {
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
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
  return rooms;
}

/** Parties en cours que l'on peut regarder sans jouer, ou rejoindre quand une place a été laissée libre. */
function LiveRooms({ rooms, onWatch }: { rooms: LiveRoom[]; onWatch: (s: Session) => void }) {
  const [error, setError] = useState('');

  async function watch(code: string, play = false) {
    setError('');
    const result = play ? await socket.emitWithAck('room:join', { code }) : await socket.emitWithAck('room:watch', { code });
    if (result.ok) onWatch(result);
    else setError(errorLabel(result.error));
  }

  return (
    <section className="panel live-rooms">
      {rooms.length === 0 ? (
        <p className="muted">Aucune partie en cours pour l'instant. Reviens plus tard, ou lance-en une !</p>
      ) : (
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
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
