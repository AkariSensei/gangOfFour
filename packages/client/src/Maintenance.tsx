import { useEffect, useState } from 'react';
import { GoogleButton } from './Account';
import { errorLabel } from './labels';
import { SITE_NAME } from './site';
import { socket, type useAccount } from './socket';

/** Le site est-il fermé pour maintenance ? null tant que le serveur n'a pas répondu. */
export function useMaintenance(): boolean | null {
  const [maintenance, setMaintenance] = useState<boolean | null>(null);
  useEffect(() => {
    const load = async () => {
      const result = await socket.emitWithAck('site:get');
      if (result.ok) setMaintenance(result.maintenance);
    };
    void load();
    socket.on('connect', load);
    socket.on('site:changed', load);
    return () => {
      socket.off('connect', load);
      socket.off('site:changed', load);
    };
  }, []);
  return maintenance;
}

/** Ferme ou rouvre le site (admin). */
export async function setMaintenance(on: boolean): Promise<string> {
  const result = await socket.emitWithAck('admin:maintenance', { on });
  return result.ok ? '' : errorLabel(result.error);
}

/** Ce que voient les joueurs pendant la maintenance ; l'admin peut se connecter pour entrer quand même. */
export function MaintenanceScreen({ account: me }: { account: ReturnType<typeof useAccount> }) {
  const [error, setError] = useState('');
  const signedIn = !!me.account;

  async function signIn(credential: string) {
    setError('');
    const failure = await me.signIn(credential);
    if (failure) setError(errorLabel(failure));
  }

  return (
    <main className="maintenance">
      <div className="maintenance-box pop-in">
        <span className="site-mark maintenance-mark" aria-hidden>
          {SITE_NAME.charAt(0)}
        </span>
        <h1>Site en maintenance</h1>
        <p>
          {SITE_NAME} se refait une beauté et prépare de nouveaux jeux. Reviens un peu plus tard : les parties reprendront très
          vite.
        </p>
        <span className="maintenance-cards" aria-hidden>
          🃏 🎰 👑
        </span>
        {signedIn ? (
          <p className="muted small">Tu es connecté : tu pourras jouer dès la réouverture.</p>
        ) : (
          <details className="maintenance-admin">
            <summary>Accès admin</summary>
            {me.googleClientId ? <GoogleButton clientId={me.googleClientId} onCredential={signIn} /> : null}
          </details>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}

/** Bandeau de l'admin pendant la maintenance : le site est fermé aux autres, un bouton le rouvre. */
export function MaintenanceBanner() {
  const [error, setError] = useState('');
  return (
    <div className="maintenance-banner" role="status">
      🔧 Site en maintenance : fermé à tous sauf toi.
      <button type="button" className="link small" onClick={async () => setError(await setMaintenance(false))}>
        Rouvrir le site
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
