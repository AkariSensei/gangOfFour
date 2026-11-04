import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GoogleIdentity } from './google';
import type { AccountView, InviteView, Look, RoomError } from './protocol';
import { cleanLook, cleanName } from './rooms';

/**
 * Compte d'un joueur : créé à sa première connexion Google (sans mot de passe, Google s'en charge), ou par un lien
 * d'invitation de l'admin, avec un identifiant et un mot de passe.
 */
export interface Account extends Look {
  /** Identifiant Google du compte (ne change jamais, même si l'adresse change), ou « local:… » pour un compte invité. */
  id: string;
  /** Adresse Google ; vide pour un compte invité. */
  email: string;
  /** Compte invité : son identifiant de connexion (en minuscules, unique) et son mot de passe chiffré. */
  login?: string;
  password?: { salt: string; hash: string };
  /** Pseudo unique, choisi à la première connexion ; absent tant qu'il n'est pas choisi. */
  name?: string;
  /** Compte bloqué par l'admin : il ne peut plus jouer. */
  blocked?: boolean;
  /** Récompenses choisies (vérifiées comme débloquées avant d'être enregistrées) : tapis, cadre d'avatar, titre. */
  felt?: string;
  frame?: string;
  title?: string;
  createdAt: string;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: RoomError };

/** Lien d'invitation : crée un compte, ou (avec `account`) fait choisir un nouveau mot de passe à un compte invité. */
export interface Invite {
  code: string;
  createdAt: string;
  expiresAt: string;
  account?: string;
}

/** Un lien d'invitation sert une fois, pendant une semaine. */
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
/** Identifiant : 3 à 30 caractères simples ; mot de passe : 8 caractères au moins. */
const LOGIN_PATTERN = /^[a-z0-9._-]{3,30}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

const cleanLogin = (login: unknown) => (typeof login === 'string' ? login.trim().toLowerCase() : '');

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}

function checkPassword(password: string, stored: { salt: string; hash: string }): boolean {
  const given = Buffer.from(hashPassword(password, stored.salt).hash, 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Un mot de passe à chiffrer, même faux : la réponse prend le même temps, que l'identifiant existe ou non. */
const DECOY = hashPassword('leurre');

/** Une session dure un an ; se déconnecter ou être bloqué l'arrête avant. */
const SESSION_MS = 365 * 24 * 60 * 60 * 1000;

const key = (name: string) => name.trim().toLocaleLowerCase('fr');

/**
 * Comptes des joueurs, gardés dans un fichier JSON (ou en mémoire sans fichier), avec la clé secrète qui signe
 * les sessions : après la connexion Google, le navigateur garde une session signée qui le reconnecte tout seul.
 */
export class AccountStore {
  private accounts: Account[] = [];
  private invites: Invite[] = [];
  private secret = randomBytes(32).toString('hex');

  constructor(
    private file?: string,
    private adminEmail?: string,
  ) {
    if (!file) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      this.accounts = saved.accounts ?? [];
      this.invites = saved.invites ?? [];
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
      writeFileSync(tmp, JSON.stringify({ secret: this.secret, accounts: this.accounts, invites: this.invites }, null, 1));
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
      ...(account.felt ? { felt: account.felt } : {}),
      ...(account.frame ? { frame: account.frame } : {}),
      ...(account.title ? { title: account.title } : {}),
    };
  }

  list(): Account[] {
    const label = (a: Account) => a.name ?? a.login ?? a.email;
    return [...this.accounts].sort((a, b) => label(a).localeCompare(label(b), 'fr'));
  }

  /* ——— Comptes invités ——— */

  /** Liens d'invitation encore valables (les expirés sont oubliés au passage). */
  activeInvites(now = Date.now()): Invite[] {
    const before = this.invites.length;
    this.invites = this.invites.filter((i) => Date.parse(i.expiresAt) > now);
    if (this.invites.length !== before) this.save();
    return this.invites;
  }

  /** Ce que voit l'admin d'un lien : pour un nouveau mot de passe, le compte visé. */
  inviteView(invite: Invite): InviteView {
    const target = this.get(invite.account);
    return {
      code: invite.code,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      ...(target ? { account: target.name ?? target.login ?? '' } : {}),
    };
  }

  /** L'admin crée un lien : pour un nouveau compte, ou pour qu'un compte invité choisisse un nouveau mot de passe. */
  createInvite(forAccount?: string, now = Date.now()): Result<{ invite: Invite }> {
    if (forAccount !== undefined && !this.get(forAccount)?.login) return { ok: false, error: 'accountNotFound' };
    // Un seul lien de mot de passe à la fois par compte : le nouveau remplace l'ancien.
    if (forAccount) this.invites = this.invites.filter((i) => i.account !== forAccount);
    const invite: Invite = {
      code: randomBytes(18).toString('base64url'),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INVITE_MS).toISOString(),
      ...(forAccount ? { account: forAccount } : {}),
    };
    this.invites.push(invite);
    this.save();
    return { ok: true, invite };
  }

  revokeInvite(code: string): void {
    this.invites = this.invites.filter((i) => i.code !== code);
    this.save();
  }

  /** Le lien ouvert par un invité : valable ou non, et pour quel compte s'il s'agit d'un nouveau mot de passe. */
  findInvite(code: unknown, now = Date.now()): Invite | undefined {
    return typeof code === 'string' ? this.activeInvites(now).find((i) => i.code === code) : undefined;
  }

  /**
   * Utilise un lien : crée le compte invité (identifiant et mot de passe), ou change le mot de passe du compte visé.
   * Le lien ne sert qu'une fois.
   */
  register(code: unknown, rawLogin: unknown, password: unknown, now = Date.now()): Result<{ account: Account }> {
    const invite = this.findInvite(code, now);
    if (!invite) return { ok: false, error: 'invalidInvite' };
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return { ok: false, error: 'weakPassword' };
    let account = this.get(invite.account);
    if (invite.account && !account) return { ok: false, error: 'invalidInvite' };
    if (!account) {
      const login = cleanLogin(rawLogin);
      if (!LOGIN_PATTERN.test(login)) return { ok: false, error: 'invalidLogin' };
      if (this.accounts.some((a) => a.login === login)) return { ok: false, error: 'loginTaken' };
      account = { id: `local:${randomUUID()}`, email: '', login, createdAt: new Date(now).toISOString() };
      this.accounts.push(account);
    }
    account.password = hashPassword(password);
    this.invites = this.invites.filter((i) => i.code !== invite.code);
    this.save();
    return account.blocked ? { ok: false, error: 'blocked' } : { ok: true, account };
  }

  /** Connexion d'un compte invité avec son identifiant et son mot de passe. */
  passwordSignIn(rawLogin: unknown, password: unknown): Result<{ account: Account }> {
    const login = cleanLogin(rawLogin);
    const account = login ? this.accounts.find((a) => a.login === login) : undefined;
    const given = typeof password === 'string' ? password.slice(0, MAX_PASSWORD) : '';
    const valid = checkPassword(given, account?.password ?? DECOY) && !!account?.password;
    if (!account || !valid) return { ok: false, error: 'wrongPassword' };
    return account.blocked ? { ok: false, error: 'blocked' } : { ok: true, account };
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
  update(
    id: string,
    change: { name?: unknown; look?: unknown; blocked?: boolean; cosmetics?: { felt: string; frame: string; title: string } },
  ): Result {
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
    // Le serveur a déjà vérifié que ces récompenses sont débloquées ; une chaîne vide revient au choix par défaut.
    if (change.cosmetics) {
      for (const key of ['felt', 'frame', 'title'] as const) {
        if (change.cosmetics[key]) account[key] = change.cosmetics[key];
        else delete account[key];
      }
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
