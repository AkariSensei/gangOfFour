import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleVerifier } from '../src/google';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'cle-1', alg: 'RS256', use: 'sig' };

const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Jeton signé comme Google le ferait, avec ces champs à la place des bons. */
function token(claims: Record<string, unknown> = {}, key = privateKey) {
  const body = `${part({ alg: 'RS256', kid: 'cle-1' })}.${part({
    iss: 'https://accounts.google.com',
    aud: 'client-test',
    sub: '1234',
    email: 'camille@exemple.fr',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  })}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}

afterEach(() => vi.unstubAllGlobals());

describe('connexion Google', () => {
  it("n'accepte qu'un jeton signé par Google, pour ce site, pas expiré et à l'adresse vérifiée", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=600' } }));
    vi.stubGlobal('fetch', fetch);
    const verify = googleVerifier('client-test');
    expect(await verify(token())).toEqual({ sub: '1234', email: 'camille@exemple.fr' });
    expect(await verify(token({ aud: 'autre-site' }))).toBeNull();
    expect(await verify(token({ iss: 'https://pirate.example' }))).toBeNull();
    expect(await verify(token({ exp: 1 }))).toBeNull();
    expect(await verify(token({ email_verified: false }))).toBeNull();
    expect(await verify(token({}, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey))).toBeNull();
    expect(await verify('pas.un.jeton')).toBeNull();
    // Les clés de Google sont gardées en cache.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
