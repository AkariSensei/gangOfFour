import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { type BotLevel, GAMES, type GameId, type LiveRoom, type OpenRoom, type Session } from '../../server/src/protocol';
import { AccountForm, AdminPanel, GoogleButton, InviteForm, PasswordSignIn } from './Account';
import { Avatar } from './Avatar';
import { CommunityScreen } from './Community';
import { Leaderboard, useStats } from './Leaderboard';
import { SlotIcon } from './SlotsTable';
import { SlotsRules } from './SlotsRules';
import { Rules } from './Rules';
import { FIRST_LEVEL, ProfileScreen } from './Progress';
import { SeasonCard, SeasonScreen } from './Season';
import { SITE_NAME, SITE_TAGLINE } from './site';
import { useDaily, useMyProfile } from './useProfile';
import { LEVEL_LABELS, errorLabel } from './labels';
import { socket, type useAccount } from './socket';

/** Le joueur a vu (suivi ou refusé) la proposition de tutoriel sur ce navigateur. */
const TUTORIAL_SEEN = 'gof-tutorial-seen';

/**
 * Écrans de l'accueil, chacun avec son adresse (#saison…) : les trois onglets du site (les jeux, la saison, la
 * communauté), le profil, et les écrans d'un jeu (sa page, puis jouer, regarder, son classement).
 */
const SCREENS = [
  'jeux',
  'saison',
  'communaute',
  'profil',
  'gof',
  'jouer',
  'regarder',
  'classement',
  'slots',
  'slots-jouer',
  'slots-regarder',
  'slots-classement',
] as const;
type Screen = (typeof SCREENS)[number];

const TABS: { id: Screen; label: string }[] = [
  { id: 'jeux', label: 'Jeux' },
  { id: 'saison', label: 'Saison' },
  { id: 'communaute', label: 'Communauté' },
];

/** Où ramène le bouton retour de chaque écran (les onglets n'en ont pas). */
const PARENT: Partial<Record<Screen, Screen>> = {
  gof: 'jeux',
  jouer: 'gof',
  regarder: 'gof',
  classement: 'gof',
  slots: 'jeux',
  'slots-jouer': 'slots',
  'slots-regarder': 'slots',
  'slots-classement': 'slots',
  profil: 'jeux',
};

/** Les écrans de chaque jeu : sa page, puis jouer, regarder et son classement. */
const GAME_SCREENS: Record<GameId, { hub: Screen; play: Screen; watch: Screen; ranking: Screen }> = {
  gof: { hub: 'gof', play: 'jouer', watch: 'regarder', ranking: 'classement' },
  slots: { hub: 'slots', play: 'slots-jouer', watch: 'slots-regarder', ranking: 'slots-classement' },
};
const GAME_NAMES: Record<GameId, string> = { gof: 'Gang of Four', slots: 'Duel Jackpot' };

/** Les trois rouleaux qui illustrent le Duel Jackpot. */
function JackpotArt() {
  return (
    <span className="jackpot-art">
      <SlotIcon symbol="seven" />
      <SlotIcon symbol="seven" />
      <SlotIcon symbol="seven" />
    </span>
  );
}
const depth = (s: Screen): number => (PARENT[s] ? 1 + depth(PARENT[s]!) : 0);
/** L'onglet d'un écran : lui-même, ou celui de son parent. */
const tabOf = (s: Screen): Screen => (PARENT[s] ? tabOf(PARENT[s]!) : s);

const screenOf = (hash: string): Screen => {
  const name = hash.replace('#', '');
  return (SCREENS as readonly string[]).includes(name) ? (name as Screen) : 'jeux';
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
  // Lien d'invitation de l'admin (?invitation=…) : création d'un compte sans Google, ou nouveau mot de passe.
  const [invitation, setInvitation] = useState(() => new URLSearchParams(location.search).get('invitation') ?? '');
  function closeInvitation() {
    const params = new URLSearchParams(location.search);
    params.delete('invitation');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    setInvitation('');
  }
  const [error, setError] = useState(notice);
  const [admin, setAdmin] = useState(false);
  const [rules, setRules] = useState<GameId | null>(null);
  const { account } = me;
  const signedIn = !!account?.name;
  const profile = useMyProfile(account?.name || undefined);
  // Sans partie terminée, pas encore de fiche : niveau 1.
  const progress = profile?.progress ?? FIRST_LEVEL;
  const live = useLiveRooms();
  const stats = useStats();
  const daily = useDaily(account?.name ? account.id : null);

  // Navigation entre les écrans : l'adresse suit l'écran, pour que le bouton Retour du navigateur ramène en arrière.
  // Un lien d'invitation (?salon=1234) ouvre directement l'écran « Jouer », le code déjà rempli.
  const [screen, setScreen] = useState<Screen>(() => (invite ? 'jouer' : screenOf(location.hash)));
  const liveOf = (game: GameId) => live.filter((r) => (r.game ?? 'gof') === game);
  const [leaving, setLeaving] = useState<{ screen: Screen; back: boolean } | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
  function show(next: Screen, back = depth(next) < depth(screen)) {
    if (next === screen) return;
    setError('');
    clearTimeout(leaveTimer.current);
    setLeaving({ screen, back });
    setScreen(next);
    leaveTimer.current = setTimeout(() => setLeaving(null), TRANSITION_MS);
  }
  useEffect(() => {
    const onPop = () => show(screenOf(location.hash));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  // Déconnecté (ou pas encore de pseudo) depuis un autre écran : retour à l'accueil, qui propose la connexion.
  useEffect(() => {
    if (account === undefined || signedIn || screen === 'jeux') return;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    show('jeux', true);
  });
  function open(next: Screen) {
    history.pushState({ inApp: true }, '', `${location.pathname}${location.search}#${next}`);
    show(next);
  }
  /** Retour à l'écran parent : par l'historique si on y est arrivé en naviguant, sinon directement. */
  function back() {
    const parent = PARENT[screen] ?? 'jeux';
    if ((history.state as { inApp?: boolean } | null)?.inApp) history.back();
    else {
      history.replaceState(null, '', `${location.pathname}${location.search}#${parent}`);
      show(parent, true);
    }
  }

  // Première fois : tant qu'il n'a fini aucune partie et n'a pas refusé, on lui propose le tutoriel.
  const [tutorialSeen, setTutorialSeen] = useState(() => {
    try {
      return localStorage.getItem(TUTORIAL_SEEN) === '1';
    } catch {
      return false;
    }
  });
  const firstTime = !tutorialSeen && profile === null;
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

  /** Sans compte (ou sans pseudo) : le nom du site et la connexion. */
  function landing(): ReactNode {
    return (
      <div className="menu-screen">
        <div className="menu-title">
          <div className="home-fan" aria-hidden>
            <img src="/cards/PV.webp" alt="" />
            <img src="/cards/1M.webp" alt="" />
            <img src="/cards/DR.webp" alt="" />
            <img src="/cards/PJ.webp" alt="" />
            <img className="home-logo" src="/cards/dos.webp" alt="" />
          </div>
          <h1 className="game-title site-title">{SITE_NAME}</h1>
          <p className="tagline">{SITE_TAGLINE}</p>
        </div>
        <div className="menu-side">
          {account === undefined ? (
            <p className="muted menu-loading">Connexion…</p>
          ) : account === null ? (
            <section className="panel signin-panel">
              {invitation ? (
                <InviteForm code={invitation} onRegister={me.register} onDone={closeInvitation} />
              ) : (
                <>
                  <p className="signin-hint">Connecte-toi avec ton compte Google pour jouer.</p>
                  {me.googleClientId ? (
                    <GoogleButton clientId={me.googleClientId} onCredential={signIn} />
                  ) : (
                    <p className="error">La connexion Google n'est pas encore configurée sur le serveur.</p>
                  )}
                  <p className="signin-or">ou, sans compte Google</p>
                  <PasswordSignIn onSignIn={me.signInWithPassword} />
                  <p className="muted small signin-note">Pas encore de compte ? Demande un lien d’invitation à l’admin.</p>
                </>
              )}
            </section>
          ) : (
            <section className="panel signin-panel">
              <AccountForm account={account} onSaved={(a) => me.setAccount(a)} />
            </section>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  function render(s: Screen): ReactNode {
    if (!signedIn) return landing();
    switch (s) {
      case 'jeux':
        return (
          <div className="catalog">
            <h2 className="catalog-title">Jeux</h2>
            <div className="game-cards">
              {GAMES.map((g) =>
                g.status === 'live' ? (
                  <button key={g.id} type="button" className={`game-card live game-${g.id}`} onClick={() => open(GAME_SCREENS[g.id as GameId].hub)}>
                    <span className="game-card-top">
                      <span className="game-card-players">{g.players}</span>
                      {g.beta && <span className="beta-badge">Bêta</span>}
                      {liveOf(g.id as GameId).length > 0 && (
                        <span className="game-card-live">
                          {liveOf(g.id as GameId).length} partie{liveOf(g.id as GameId).length > 1 ? 's' : ''} en cours
                        </span>
                      )}
                    </span>
                    <span className="game-card-art" aria-hidden>
                      {g.id === 'slots' ? (
                        <JackpotArt />
                      ) : (
                        <>
                          <img src="/cards/PV.webp" alt="" />
                          <img src="/cards/DR.webp" alt="" />
                          <img src="/cards/1M.webp" alt="" />
                        </>
                      )}
                    </span>
                    <strong>{g.name}</strong>
                    <small>{g.tagline}</small>
                  </button>
                ) : (
                  <div key={g.id} className={`game-card upcoming status-${g.status} game-${g.id}`}>
                    <span className="game-card-top">
                      <span className="game-card-status">{g.status === 'soon' ? 'Bientôt' : 'Plus tard'}</span>
                    </span>
                    <strong>{g.name}</strong>
                    <small>
                      {g.tagline} · {g.players}
                    </small>
                  </div>
                ),
              )}
            </div>
            <SeasonCard stats={stats} onClick={() => open('saison')} />
            {error && <p className="error">{error}</p>}
          </div>
        );
      case 'saison':
        return (
          <SubScreen title="Saison">
            <SeasonScreen stats={stats} />
          </SubScreen>
        );
      case 'communaute':
        return (
          <SubScreen title="Communauté" narrow>
            <CommunityScreen admin={!!account?.admin} />
          </SubScreen>
        );
      case 'gof':
        return (
          <div className="menu-screen game-hub">
            <button type="button" className="back-button hub-back" onClick={back}>
              ← Jeux
            </button>
            <div className="menu-title">
              {/* Les cartes maîtresses du jeu en éventail derrière le dos de carte. */}
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
              <p className="tagline">Débarrasse-toi de tes cartes avant les autres.</p>
            </div>
            <div className="menu-side">
              {firstTime && (
                <div className="first-time">
                  <strong>🎓 Première partie ?</strong>
                  <p>
                    Un tutoriel de deux minutes t'apprend les règles en jouant : une manche guidée contre trois bots, que tu gagnes à coup
                    sûr.
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
              <nav className="game-menu" aria-label="Gang of Four">
                <MenuItem primary icon="🃏" title="Jouer" subtitle="Créer un salon ou rejoindre ceux qui attendent" onClick={() => open('jouer')} />
                <MenuItem
                  icon="👀"
                  title="Regarder"
                  subtitle={liveOf('gof').length === 0 ? 'Aucune partie en cours' : 'Parties en cours des collègues'}
                  pill={liveOf('gof').length > 0 ? { text: `${liveOf('gof').length} en cours`, live: true } : undefined}
                  onClick={() => open('regarder')}
                />
                <div className="menu-tiles">
                  <MenuItem tile icon="🏆" title="Classement" subtitle="Saison et général" onClick={() => open('classement')} />
                  <MenuItem tile icon="🎓" title="Tutoriel" subtitle="2 minutes" onClick={() => void startTutorial()} />
                  <MenuItem tile icon="📜" title="Règles" subtitle="Combinaisons, scores" onClick={() => setRules('gof')} />
                </div>
              </nav>
              {error && <p className="error">{error}</p>}
            </div>
          </div>
        );
      case 'slots':
        return (
          <div className="menu-screen game-hub slots-hub">
            <button type="button" className="back-button hub-back" onClick={back}>
              ← Jeux
            </button>
            <div className="menu-title">
              <div className="slots-hub-machine" aria-hidden>
                <JackpotArt />
              </div>
              <h1 className="game-title">
                Duel Jackpot <span className="beta-badge big">Bêta</span>
              </h1>
              <p className="tagline">100 € chacun, une machine chacun : le premier à 300 € gagne.</p>
            </div>
            <div className="menu-side">
              <nav className="game-menu" aria-label="Duel Jackpot">
                <MenuItem primary icon="🎰" title="Jouer" subtitle="Un duel à deux : crée un salon ou rejoins-en un" onClick={() => open('slots-jouer')} />
                <MenuItem
                  icon="👀"
                  title="Regarder"
                  subtitle={liveOf('slots').length === 0 ? 'Aucun duel en cours' : 'Duels en cours des collègues'}
                  pill={liveOf('slots').length > 0 ? { text: `${liveOf('slots').length} en cours`, live: true } : undefined}
                  onClick={() => open('slots-regarder')}
                />
                <div className="menu-tiles two">
                  <MenuItem tile icon="🏆" title="Classement" subtitle="Saison et général" onClick={() => open('slots-classement')} />
                  <MenuItem tile icon="📜" title="Règles" subtitle="Mises et gains" onClick={() => setRules('slots')} />
                </div>
              </nav>
              {error && <p className="error">{error}</p>}
            </div>
          </div>
        );
      case 'jouer':
      case 'slots-jouer': {
        const game: GameId = s === 'jouer' ? 'gof' : 'slots';
        return (
          <SubScreen title="Jouer" onBack={back} backLabel={GAME_NAMES[game]}>
            <PlayScreen game={game} initialCode={game === 'gof' ? invite : ''} onEnter={onEnter} />
          </SubScreen>
        );
      }
      case 'regarder':
      case 'slots-regarder': {
        const game: GameId = s === 'regarder' ? 'gof' : 'slots';
        return (
          <SubScreen title="Regarder" onBack={back} backLabel={GAME_NAMES[game]} narrow>
            <LiveRooms rooms={liveOf(game)} onWatch={onEnter} />
          </SubScreen>
        );
      }
      case 'classement':
      case 'slots-classement': {
        const game: GameId = s === 'classement' ? 'gof' : 'slots';
        return (
          <SubScreen title="Classement" onBack={back} backLabel={GAME_NAMES[game]}>
            <div className="ranking-screen">
              <Leaderboard stats={stats} game={game} />
            </div>
          </SubScreen>
        );
      }
      case 'profil':
        return account?.name ? (
          <SubScreen title="Mon profil" onBack={back} backLabel="Jeux">
            <ProfileScreen account={account} profile={profile} onAccount={(a) => me.setAccount(a)} />
          </SubScreen>
        ) : null;
    }
  }

  const currentTab = tabOf(screen);
  return (
    <main className="home-menu">
      {signedIn && account && (
        <header className="menu-topbar">
          <button type="button" className="site-brand" onClick={() => (screen === 'jeux' ? undefined : open('jeux'))}>
            <span className="site-mark" aria-hidden>
              {SITE_NAME.charAt(0)}
            </span>
            {SITE_NAME}
          </button>
          <nav className="site-tabs" aria-label="Menu principal">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={currentTab === t.id ? 'on' : ''}
                aria-current={currentTab === t.id ? 'page' : undefined}
                onClick={() => (screen === t.id ? undefined : open(t.id))}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="menu-topbar-actions">
            <button type="button" className="player-card" onClick={() => open('profil')} title="Mon profil : pseudo, avatar, récompenses">
              <span className="level-avatar">
                <Avatar name={account.name} look={account} />
              </span>
              <span className="player-card-text">
                <strong>{account.name}</strong>
                <small>
                  {account.title || progress.title}
                  {daily && daily.streak > 0 && <span title={`Série de ${daily.streak} jours de jeu d'affilée`}> · 🔥 {daily.streak}</span>}
                </small>
              </span>
            </button>
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
      {rules === 'gof' && <Rules onClose={() => setRules(null)} />}
      {rules === 'slots' && <SlotsRules onClose={() => setRules(null)} />}
      {admin && <AdminPanel onClose={() => setAdmin(false)} />}
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

/** Écran secondaire de l'accueil : un titre, le retour à l'écran parent (sauf pour un onglet), et son contenu. */
function SubScreen({
  title,
  onBack,
  backLabel,
  narrow,
  children,
}: {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`sub-screen ${narrow ? 'narrow' : ''}`}>
      <div className="sub-head">
        {onBack && (
          <button type="button" className="back-button" onClick={onBack}>
            ← {backLabel}
          </button>
        )}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

/** Bots de l'entraînement : trois à Gang of Four, un au Duel Jackpot. */
const TRAINING_BOTS: Record<GameId, number> = { gof: 3, slots: 1 };
const BOT_COUNT: Record<number, string> = { 1: 'un bot', 3: 'trois bots' };

/** Salons de ce jeu qui attendent des joueurs, rechargés toutes les 5 secondes. */
function useOpenRooms(game: GameId): OpenRoom[] | null {
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const result = await socket.emitWithAck('rooms:open', { game });
      if (active && result.ok) setRooms(result.rooms);
    };
    void load();
    const t = setInterval(load, 5_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [game]);
  return rooms;
}

/**
 * Écran « Jouer » : créer un salon, ou rejoindre un des salons qui attendent des joueurs. Les parties comptent
 * seulement entre humains ; l'entraînement contre les bots, à part, ne compte nulle part.
 */
function PlayScreen({ game, initialCode, onEnter }: { game: GameId; initialCode: string; onEnter: (s: Session) => void }) {
  const [level, setLevel] = useState<BotLevel>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = useOpenRooms(game);
  const info = GAMES.find((g) => g.id === game);

  async function run(action: () => Promise<{ ok: true } & Session | { ok: false; error: string }>) {
    setBusy(true);
    setError('');
    const result = await action();
    setBusy(false);
    if (result.ok) onEnter(result);
    else setError(errorLabel(result.error));
  }

  /** Entraînement : un salon fermé, des bots du niveau choisi, et la partie démarre aussitôt. */
  async function training() {
    const created = await socket.emitWithAck('room:create', { game, training: true });
    if (!created.ok) return created;
    for (let i = 0; i < TRAINING_BOTS[game]; i++) {
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

  const join = (code: string) => run(() => socket.emitWithAck('room:join', { code }));

  return (
    <>
      {initialCode && (
        <section className="panel invite-banner">
          <span>
            Tu as été invité dans le salon <strong>{initialCode}</strong>.
          </span>
          <button type="button" className="primary" disabled={busy} onClick={() => void join(initialCode)}>
            Rejoindre
          </button>
        </section>
      )}
      <div className="play-grid">
        <section className="panel play-create">
          <span className="choice-icon" aria-hidden>
            🪑
          </span>
          <h3>Créer un salon</h3>
          <p>Il apparaît dans les salons actifs pour les collègues. Tu peux aussi leur envoyer le lien.</p>
          <button type="button" className="primary big" disabled={busy} onClick={() => void run(() => socket.emitWithAck('room:create', { game }))}>
            Créer un salon
          </button>
        </section>
        <section className="panel play-open">
          <h3>Salons actifs</h3>
          {open === null ? (
            <p className="muted">Chargement…</p>
          ) : open.length === 0 ? (
            <p className="muted">Aucun salon n’attend de joueur pour l’instant : crée le tien !</p>
          ) : (
            <ul className="open-rooms">
              {open.map((r) => (
                <li key={r.code}>
                  <span className="open-room-text">
                    <strong>Salon de {r.host}</strong>
                    <small>
                      {r.players} / {r.maxPlayers} joueurs
                      {r.players < r.minPlayers && ` · encore ${r.minPlayers - r.players} pour lancer`}
                    </small>
                  </span>
                  <button type="button" className="primary" disabled={busy} onClick={() => void join(r.code)}>
                    Rejoindre
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="panel play-training">
        <div className="play-training-text">
          <h3>🤖 Entraînement contre les bots</h3>
          <p>
            Toi contre {BOT_COUNT[TRAINING_BOTS[game]]} pour t’exercer{info ? ` à ${info.name}` : ''}.{' '}
            <strong>Ne compte pas dans les classements et ne rapporte rien.</strong>
          </p>
        </div>
        <div className="play-training-actions">
          <div className="segmented" role="radiogroup" aria-label="Niveau des bots">
            {(Object.entries(LEVEL_LABELS) as [BotLevel, string][]).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={level === id} className={level === id ? 'on' : ''} onClick={() => setLevel(id)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void run(training)}>
            S’entraîner
          </button>
        </div>
      </section>
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
