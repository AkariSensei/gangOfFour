import { type FormEvent, useEffect, useRef, useState } from 'react';
import { AVATARS, type AccountView, type AdminAccount, COLORS, type Look } from '../../server/src/protocol';
import { Avatar } from './Avatar';
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
          theme: 'outline',
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

/** Gestion des comptes par l'admin : renommer un pseudo, bloquer ou débloquer un compte. */
export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  async function load() {
    const result = await socket.emitWithAck('admin:accounts');
    if (!result.ok) return setError(errorLabel(result.error));
    setAccounts(result.accounts);
    setNames(Object.fromEntries(result.accounts.map((a) => [a.id, a.name])));
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

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal profile admin pop-in" role="dialog" aria-label="Comptes" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
        <h2>Comptes</h2>
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
                  aria-label={`Pseudo de ${a.email}`}
                />
                <span className="muted small">{a.email}</span>
              </div>
              {names[a.id] !== a.name && <button onClick={() => update(a.id, { name: names[a.id] })}>Renommer</button>}
              <button className={a.blocked ? '' : 'danger'} onClick={() => update(a.id, { blocked: !a.blocked })}>
                {a.blocked ? 'Débloquer' : 'Bloquer'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
