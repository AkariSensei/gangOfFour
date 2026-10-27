import { createPublicKey, verify } from 'node:crypto';

/** Ce que l'on garde d'une connexion Google : l'identifiant stable du compte et son adresse. */
export interface GoogleIdentity {
  sub: string;
  email: string;
}

/** Vérifie le jeton envoyé par le bouton « Se connecter avec Google » ; null s'il n'est pas valable. */
export type VerifyGoogle = (credential: string) => Promise<GoogleIdentity | null>;

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

type Jwk = { kid: string } & Record<string, unknown>;

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Vérification d'un jeton d'identité Google (JWT signé RS256), sans bibliothèque : signature avec les clés
 * publiques de Google (gardées en cache le temps indiqué par Google), puis destinataire, émetteur et expiration.
 */
export function googleVerifier(clientId: string): VerifyGoogle {
  let keys: Jwk[] = [];
  let expiresAt = 0;

  async function publicKeys(): Promise<Jwk[]> {
    if (Date.now() < expiresAt) return keys;
    const response = await fetch(CERTS_URL);
    if (!response.ok) throw new Error(`Clés Google indisponibles (${response.status})`);
    keys = ((await response.json()) as { keys: Jwk[] }).keys;
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    expiresAt = Date.now() + maxAge * 1000;
    return keys;
  }

  return async (credential) => {
    const parts = credential.split('.');
    if (parts.length !== 3) return null;
    try {
      const [header, payload, signature] = parts as [string, string, string];
      const { alg, kid } = decode(header);
      if (alg !== 'RS256') return null;
      const jwk = (await publicKeys()).find((k) => k.kid === kid);
      if (!jwk) return null;
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      if (!verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, 'base64url'))) return null;
      const claims = decode(payload);
      if (claims.aud !== clientId || !ISSUERS.includes(claims.iss) || Number(claims.exp) * 1000 < Date.now()) return null;
      if (claims.email_verified !== true || typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null;
      return { sub: claims.sub, email: claims.email };
    } catch {
      return null;
    }
  };
}
