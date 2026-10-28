import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BADGE_IDS, SHOWCASE_SIZE } from './badges';
import type { GoogleIdentity } from './google';
import type { AccountView, Look, RoomError } from './protocol';
import { cleanLook, cleanName } from './rooms';

/** Compte d'un joueur, créé à sa première connexion Google. Aucun mot de passe : Google s'en charge. */
export interface Account extends Look {
  /** Identifiant Google du compte (ne change jamais, même si l'adresse change). */
  id: string;
  email: string;
  /** Pseudo unique, choisi à la première connexion ; absent tant qu'il n'est pas choisi. */
  name?: string;
  /** Compte bloqué par l'admin : il ne peut plus jouer. */
  blocked?: boolean;
  /** Badges que le joueur a choisi de montrer sur sa fiche (trois au plus) ; sans choix, ses plus rares. */
  showcase?: string[];
  createdAt: string;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: RoomError };

/** Une session dure un an ; se déconnecter ou être bloqué l'arrête avant. */
const SESSION_MS = 365 * 24 * 60 * 60 * 1000;

const key = (name: string) => name.trim().toLocaleLowerCase('fr');

/**
 * Comptes des joueurs, gardés dans un fichier JSON (ou en mémoire sans fichier), avec la clé secrète qui signe
 * les sessions : après la connexion Google, le navigateur garde une session signée qui le reconnecte tout seul.
 */
export class AccountStore {
  private accounts: Account[] = [];
  private secret = randomBytes(32).toString('hex');

  constructor(
    private file?: string,
    private adminEmail?: string,
  ) {
    if (!file) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      this.accounts = saved.accounts ?? [];
      this.secret = saved.secret ?? this.secret;
    } catch {
      this.save();
    }
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ secret: this.secret, accounts: this.accounts }, null, 1));
      renameSync(tmp, this.file);
    } catch (error) {
      console.error("Impossible d'enregistrer les comptes :", error);
    }
  }

  get(id: string | undefined): Account | undefined {
    return id ? this.accounts.find((a) => a.id === id) : undefined;
  }

  /** Compte qui porte ce pseudo (sans tenir compte des majuscules). */
  byName(name: string): Account | undefined {
    return this.accounts.find((a) => a.name !== undefined && key(a.name) === key(name));
  }

  isAdmin(account: Account | undefined): boolean {
    return !!account && !!this.adminEmail && account.email.toLowerCase() === this.adminEmail.toLowerCase();
  }

  view(account: Account): AccountView {
    return {
      id: account.id,
      email: account.email,
      name: account.name ?? '',
      ...cleanLook(account),
      admin: this.isAdmin(account),
      showcase: account.showcase ?? [],
    };
  }

  list(): Account[] {
    return [...this.accounts].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email, 'fr'));
  }

  /** Connexion Google : retrouve le compte, ou le crée à la première connexion. */
  signIn(identity: GoogleIdentity): Result<{ account: Account }> {
    let account = this.get(identity.sub);
    if (!account) {
      account = { id: identity.sub, email: identity.email, createdAt: new Date().toISOString() };
      this.accounts.push(account);
    }
    account.email = identity.email;
    this.save();
    return account.blocked ? { ok: false, error: 'blocked' } : { ok: true, account };
  }

  /** Modifie un compte : pseudo, apparence, ou blocage (ce dernier par l'admin seulement). */
  update(id: string, change: { name?: unknown; look?: unknown; blocked?: boolean; showcase?: unknown }): Result {
    const account = this.get(id);
    if (!account) return { ok: false, error: 'accountNotFound' };
    if (change.name !== undefined) {
      const name = cleanName(change.name);
      if (!name) return { ok: false, error: 'invalidName' };
      const other = this.byName(name);
      if (other && other.id !== id) return { ok: false, error: 'nameTaken' };
      account.name = name;
    }
    if (change.look !== undefined) {
      delete account.avatar;
      delete account.color;
      Object.assign(account, cleanLook(change.look));
    }
    if (change.showcase !== undefined) {
      const ids = Array.isArray(change.showcase) ? change.showcase.filter((id): id is string => typeof id === 'string' && BADGE_IDS.has(id)) : [];
      const showcase = [...new Set(ids)].slice(0, SHOWCASE_SIZE);
      if (showcase.length > 0) account.showcase = showcase;
      else delete account.showcase;
    }
    if (change.blocked !== undefined) {
      if (change.blocked) account.blocked = true;
      else delete account.blocked;
    }
    this.save();
    return { ok: true };
  }

  private sign(text: string) {
    return createHmac('sha256', this.secret).update(text).digest('base64url');
  }

  /** Session signée remise au navigateur après la connexion Google. */
  session(id: string, now = Date.now()): string {
    const body = `${Buffer.from(id).toString('base64url')}.${now + SESSION_MS}`;
    return `${body}.${this.sign(body)}`;
  }

  /** Compte d'une session encore valable, s'il n'est pas bloqué. */
  fromSession(session: unknown, now = Date.now()): Account | undefined {
    if (typeof session !== 'string' || session.length > 300) return undefined;
    const [id, expires, signature] = session.split('.');
    if (!id || !expires || !signature) return undefined;
    const expected = Buffer.from(this.sign(`${id}.${expires}`));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected) || Number(expires) < now) return undefined;
    const account = this.get(Buffer.from(id, 'base64url').toString('utf8'));
    return account?.blocked ? undefined : account;
  }
}
