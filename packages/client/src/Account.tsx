import { type FormEvent, useEffect, useRef, useState } from 'react';
import { AVATARS, type AccountView, type AdminAccount, COLORS, type InviteView, type Look } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { setMaintenance } from './Maintenance';
import { errorLabel } from './labels';
import { socket } from './socket';

interface GoogleIdentityApi {
  initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentityApi } };
  }
}

let googleScript: Promise<void> | null = null;

/** Charge une seule fois le script du bouton Google. */
function loadGoogle(): Promise<void> {
  googleScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleScript = null;
      reject(new Error('Script Google indisponible'));
    };
    document.head.appendChild(script);
  });
  return googleScript;
}

/** Bouton officiel « Se connecter avec Google » ; Google renvoie un jeton que le serveur vérifie. */
export function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadGoogle()
      .then(() => {
        const api = window.google?.accounts.id;
        if (!active || !ref.current || !api) return;
        api.initialize({ client_id: clientId, callback: (r) => callback.current(r.credential) });
        api.renderButton(ref.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          locale: 'fr',
          width: Math.min(320, ref.current.clientWidth || 320),
        });
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [clientId]);

  return (
    <>
      <div className="google-button" ref={ref} />
      {failed && <p className="error">Impossible de joindre Google. Recharge la page.</p>}
    </>
  );
}

/** Connexion d'un compte invité (sans Google) : identifiant et mot de passe. */
export function PasswordSignIn({ onSignIn }: { onSignIn: (login: string, password: string) => Promise<string | null> }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const failure = await onSignIn(login, password);
    setBusy(false);
    if (failure) setError(errorLabel(failure));
  }

  return (
    <form className="password-form" onSubmit={submit}>
      <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Identifiant" autoComplete="username" aria-label="Identifiant" />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Mot de passe"
        autoComplete="current-password"
        aria-label="Mot de passe"
      />
      <button type="submit" disabled={busy || !login.trim() || !password}>
        Se connecter
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

/**
 * Lien d'invitation ouvert (?invitation=…) : l'invité choisit son identifiant et son mot de passe, ou seulement un
 * nouveau mot de passe si l'admin lui a envoyé un lien pour son compte.
 */
export function InviteForm({
  code,
  onRegister,
  onDone,
}: {
  code: string;
  onRegister: (code: string, login: string, password: string) => Promise<string | null>;
  onDone: () => void;
}) {
  const [invite, setInvite] = useState<{ reset: boolean; login?: string } | null | undefined>(undefined);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void socket.emitWithAck('account:invite', { code }).then((r) => {
      setInvite(r.ok ? r.invite : null);
      if (!r.ok && r.error !== 'invalidInvite') setError(errorLabel(r.error));
    });
  }, [code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== again) return setError('Les deux mots de passe ne sont pas les mêmes.');
    setBusy(true);
    setError('');
    const failure = await onRegister(code, login, password);
    setBusy(false);
    if (failure) setError(errorLabel(failure));
    else onDone();
  }

  if (invite === undefined) return <p className="muted">Vérification du lien…</p>;
  if (invite === null)
    return (
      <>
        <p className="error">{error || 'Ce lien d’invitation n’est plus valable (il sert une fois, pendant une semaine). Demande-en un autre à l’admin.'}</p>
        <button type="button" className="link" onClick={onDone}>
          Retour à la connexion
        </button>
      </>
    );
  return (
    <form className="password-form" onSubmit={submit}>
      <p className="signin-hint">
        {invite.reset ? (
          <>
            Choisis un nouveau mot de passe pour <b>{invite.login}</b>.
          </>
        ) : (
          'Bienvenue ! Choisis ton identifiant et ton mot de passe : ils te serviront à te connecter.'
        )}
      </p>
      {!invite.reset && (
        <input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="Identifiant (lettres, chiffres, . _ -)"
          autoComplete="username"
          aria-label="Identifiant"
          maxLength={30}
          autoFocus
        />
      )}
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Mot de passe (8 caractères au moins)"
        autoComplete="new-password"
        aria-label="Mot de passe"
      />
      <input
        type="password"
        value={again}
        onChange={(e) => setAgain(e.target.value)}
        placeholder="Le même, encore une fois"
        autoComplete="new-password"
        aria-label="Confirmation du mot de passe"
      />
      <button type="submit" className="primary" disabled={busy || (!invite.reset && !login.trim()) || !password || !again}>
        {invite.reset ? 'Changer le mot de passe' : 'Créer mon compte'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

const inviteDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
/** Adresse complète d'un lien d'invitation, à envoyer à l'invité. */
const inviteUrl = (code: string) => `${location.origin}/?invitation=${encodeURIComponent(code)}`;

/** Liens d'invitation de l'admin : en créer un, le copier pour l'envoyer, ou le révoquer. */
function Invites({ invites, onChange }: { invites: InviteView[]; onChange: () => Promise<void> }) {
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(code);
    } catch {
      // Sans presse-papiers (navigateur ancien ou refus) : le lien reste affiché, à copier à la main.
      setCopied('');
    }
  }

  async function create() {
    setError('');
    const result = await socket.emitWithAck('admin:invite', {});
    if (!result.ok) return setError(errorLabel(result.error));
    await onChange();
    await copy(result.invite.code);
  }

  async function revoke(code: string) {
    await socket.emitWithAck('admin:revokeInvite', { code });
    await onChange();
  }

  return (
    <section className="admin-invites">
      <h3>Invitations</h3>
      <p className="muted small">
        Pour un collègue sans compte Google : un lien qu’il ouvre pour choisir son identifiant et son mot de passe. Chaque lien sert
        une fois, pendant une semaine.
      </p>
      <button type="button" onClick={() => void create()}>
        ✉️ Créer un lien d’invitation
      </button>
      {error && <p className="error">{error}</p>}
      {invites.length > 0 && (
        <ul>
          {invites.map((i) => (
            <li key={i.code}>
              <input readOnly value={inviteUrl(i.code)} onFocus={(e) => e.target.select()} aria-label="Lien d’invitation" />
              <span className="muted small">
                {i.account ? `Nouveau mot de passe pour ${i.account}` : 'Nouveau compte'} · jusqu’au {inviteDate.format(new Date(i.expiresAt))}
              </span>
              <button type="button" onClick={() => void copy(i.code)}>
                {copied === i.code ? 'Copié ✓' : 'Copier'}
              </button>
              <button type="button" className="danger" onClick={() => void revoke(i.code)}>
                Révoquer
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Pseudo (unique) et apparence du compte : choisis à la première connexion, modifiables ensuite. */
export function AccountForm({ account, onSaved, onCancel }: { account: AccountView; onSaved: (a: AccountView) => void; onCancel?: () => void }) {
  const [name, setName] = useState(account.name);
  const [look, setLook] = useState<Look>({ avatar: account.avatar, color: account.color });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const result = await socket.emitWithAck('account:update', { name, ...look });
    setBusy(false);
    if (result.ok) onSaved(result.account);
    else setError(errorLabel(result.error));
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="pseudo">{account.name ? 'Ton pseudo' : 'Choisis ton pseudo'}</label>
      <div className="identity">
        <Avatar name={name || '?'} look={look} />
        <input id="pseudo" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus placeholder="ex. Camille" />
      </div>
      <div className="look-picker">
        <div className="look-grid" role="radiogroup" aria-label="Avatar">
          <button
            type="button"
            role="radio"
            aria-checked={!look.avatar}
            className={!look.avatar ? 'on' : ''}
            onClick={() => setLook({ ...look, avatar: undefined })}
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
              onClick={() => setLook({ ...look, avatar: a })}
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
              onClick={() => setLook({ ...look, color: look.color === c ? undefined : c })}
            />
          ))}
        </div>
      </div>
      <div className="home-actions">
        <button type="submit" className="primary" disabled={busy || !name.trim()}>
          Enregistrer
        </button>
        {onCancel && (
          <button type="button" className="link" onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

/** Gestion des comptes par l'admin : renommer, bloquer, retirer du classement, ou remettre le classement à zéro. */
export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [invites, setInvites] = useState<InviteView[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  async function load() {
    const result = await socket.emitWithAck('admin:accounts');
    if (!result.ok) return setError(errorLabel(result.error));
    setAccounts(result.accounts);
    setNames(Object.fromEntries(result.accounts.map((a) => [a.id, a.name])));
    const links = await socket.emitWithAck('admin:invites');
    if (links.ok) setInvites(links.invites);
  }

  /** Mot de passe oublié : un lien pour que ce compte invité en choisisse un nouveau. */
  async function resetLink(a: AdminAccount) {
    setError('');
    const result = await socket.emitWithAck('admin:invite', { accountId: a.id });
    if (!result.ok) setError(errorLabel(result.error));
    await load();
  }

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function update(id: string, change: { name?: string; blocked?: boolean }) {
    setError('');
    const result = await socket.emitWithAck('admin:update', { id, ...change });
    if (!result.ok) setError(errorLabel(result.error));
    await load();
  }

  async function unrank(a: AdminAccount) {
    if (!confirm(`Retirer ${a.name || a.login || a.email} du classement ? Ses parties jouées jusqu'ici ne compteront plus.`)) return;
    setError('');
    const result = await socket.emitWithAck('admin:unrank', { id: a.id });
    if (!result.ok) setError(errorLabel(result.error));
    await load();
  }

  async function resetRanking() {
    if (!confirm('Remettre le classement à zéro ? Classement, records et niveaux repartent de zéro pour tout le monde.')) return;
    setError('');
    const result = await socket.emitWithAck('admin:resetRanking');
    if (!result.ok) setError(errorLabel(result.error));
    await load();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal profile admin pop-in" role="dialog" aria-label="Comptes" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
        <h2>Comptes</h2>
        <p className="admin-maintenance">
          <button type="button" className="danger" onClick={async () => setError(await setMaintenance(true))}>
            🔧 Fermer le site pour maintenance
          </button>
          <span className="muted small">Les joueurs verront un message ; toi seul pourras encore jouer.</span>
        </p>
        {accounts && <Invites invites={invites} onChange={load} />}
        {!accounts && !error && <p className="muted">Chargement…</p>}
        {error && <p className="error">{error}</p>}
        <ul className="admin-accounts">
          {accounts?.map((a) => (
            <li key={a.id} className={a.blocked ? 'blocked' : ''}>
              <Avatar name={a.name || '?'} look={a} />
              <div className="admin-who">
                <input
                  value={names[a.id] ?? ''}
                  onChange={(e) => setNames({ ...names, [a.id]: e.target.value })}
                  maxLength={20}
                  placeholder="(pas de pseudo)"
                  aria-label={`Pseudo de ${a.email || a.login}`}
                />
                <span className="muted small">{a.login ? `🔑 ${a.login}` : a.email}</span>
              </div>
              {names[a.id] !== a.name && <button onClick={() => update(a.id, { name: names[a.id] })}>Renommer</button>}
              {a.login && (
                <button className="icon" onClick={() => void resetLink(a)} title="Lien pour choisir un nouveau mot de passe" aria-label={`Nouveau mot de passe pour ${a.login}`}>
                  🔑
                </button>
              )}
              {a.ranked && (
                <button className="danger icon" onClick={() => unrank(a)} title="Retirer du classement" aria-label={`Retirer ${a.name} du classement`}>
                  🏆✕
                </button>
              )}
              <button className={a.blocked ? '' : 'danger'} onClick={() => update(a.id, { blocked: !a.blocked })}>
                {a.blocked ? 'Débloquer' : 'Bloquer'}
              </button>
            </li>
          ))}
        </ul>
        {accounts && (
          <button className="danger reset-ranking" onClick={resetRanking}>
            Remettre le classement à zéro
          </button>
        )}
      </div>
    </div>
  );
}
