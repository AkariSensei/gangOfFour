import { mkdtempSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { type BattleshipView, type ChessView, type GameState, type ReversiView, type PlayerView, type SlotsView, createDeck, createRng, randomFleet } from '@gof/engine';
import { type Socket, io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ClientToServerEvents,
  type GameServer,
  type GameServerOptions,
  type GofView,
  type RoomView,
  type ServerToClientEvents,
  createGameServer,
} from '../src';
import { playBotTurn } from '../scripts/bot';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { room?: RoomView; game?: GofView };

let server: GameServer;
const clients: Client[] = [];

// Les parties de test enchaînent les coups bien plus vite qu'un humain : on lève la limite d'événements,
// vérifiée à part dans son propre test.
async function start(options: GameServerOptions = {}) {
  server = createGameServer({ ...options, limits: { eventsPerSocket: Infinity, ...options.limits } });
  await new Promise<void>((resolve) => server.http.listen(0, resolve));
}

/** Requête brute (sans décompression automatique, contrairement à fetch), pour vérifier ce qui transite. */
function request(url: string, acceptEncoding: string): Promise<{ headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    httpGet(url, { headers: { 'Accept-Encoding': acceptEncoding } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

let accountCount = 0;

/** Ouvre une connexion avec un compte qui porte ce pseudo (créé directement sur le serveur) ; null : sans compte. */
function connect(name: string | null = `Joueur ${accountCount + 1}`): Client {
  let auth: { session: string } | undefined;
  if (name !== null) {
    const id = `google-${++accountCount}`;
    server.accounts.signIn({ sub: id, email: `${id}@exemple.fr` });
    if (!server.accounts.update(id, { name }).ok) server.accounts.update(id, { name: `${name} ${accountCount}` });
    auth = { session: server.accounts.session(id) };
  }
  return connectWith(auth);
}

function connectWith(auth?: { session: string }): Client {
  const { port } = server.http.address() as AddressInfo;
  const client: Client = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, auth });
  client.on('room:state', (room) => (client.room = room));
  // Les tests de Gang of Four lisent la vue telle quelle ; ceux des autres jeux la convertissent eux-mêmes.
  client.on('game:state', (game) => (client.game = game as GofView));
  clients.push(client);
  return client;
}

const waitFor = async (check: () => boolean, timeout = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 5));
  }
};

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await new Promise((resolve) => server.io.close(resolve));
});

async function lobby(count: number) {
  const host = connect('Alice');
  const created = await host.emitWithAck('room:create', {});
  if (!created.ok) throw new Error(created.error);
  const players = [host];
  for (const name of ['Bruno', 'Chloé', 'David'].slice(0, count - 1)) {
    const c = connect(name);
    const joined = await c.emitWithAck('room:join', { code: created.code });
    expect(joined.ok).toBe(true);
    players.push(c);
  }
  await waitFor(() => players.every((p) => p.room?.players.length === count));
  return { code: created.code, players };
}

describe('serveur de jeu', () => {
  it('tient tout le salon au courant des arrivées', async () => {
    await start();
    const { players } = await lobby(3);
    expect(players[0]!.room!.players.map((p) => p.name)).toEqual(['Alice', 'Bruno', 'Chloé']);
  });

  it('refuse les actions hors salon', async () => {
    await start();
    const c = connect();
    expect(await c.emitWithAck('game:pass')).toEqual({ ok: false, error: 'notInRoom' });
  });

  it('envoie à chacun sa main au lancement, sans les mains des autres', async () => {
    await start();
    const { players } = await lobby(4);
    expect(await players[0]!.emitWithAck('game:start', {})).toEqual({ ok: true });
    await waitFor(() => players.every((p) => p.game));
    const hands = players.map((p) => p.game!.hand.map((c) => c.id));
    expect(new Set(hands.flat()).size).toBe(64);
    players.forEach((p, i) => expect(p.game!.you).toBe(i));
  });

  it('permet de reprendre sa place après une déconnexion', async () => {
    await start();
    const { code, players } = await lobby(3);
    const bruno = players[1]!;
    const session = await bruno.emitWithAck('room:rejoin', { code, token: 'faux' });
    expect(session).toEqual({ ok: false, error: 'roomNotFound' });

    // On récupère le jeton de Bruno côté serveur pour simuler sa reconnexion depuis un nouvel onglet.
    const token = server.rooms.get(code)!.seats[1]!.token;
    await players[0]!.emitWithAck('game:start', {});
    bruno.disconnect();
    await waitFor(() => players[0]!.room!.players[1]!.connected === false);

    const again = connect();
    expect(await again.emitWithAck('room:rejoin', { code, token })).toMatchObject({ ok: true });
    await waitFor(() => again.game !== undefined && players[0]!.room!.players[1]!.connected);
    expect(again.game!.you).toBe(1);
  });

  it('fait jouer un bot à la place d\'un joueur parti, puis lui rend sa place à son retour', async () => {
    await start({ botDelayMs: 0, awayDelayMs: 30 });
    const { code, players } = await lobby(3);
    const [alice, bruno, chloe] = players as [Client, Client, Client];
    const token = server.rooms.get(code)!.seats[1]!.token;
    await alice.emitWithAck('game:start', {});
    await waitFor(() => !!alice.game);

    // Chloé revient avant le délai : elle garde la main. Bruno, lui, est remplacé.
    bruno.disconnect();
    chloe.disconnect();
    const chloeToken = server.rooms.get(code)!.seats[2]!.token;
    const chloe2 = connect();
    await chloe2.emitWithAck('room:rejoin', { code, token: chloeToken });
    await waitFor(() => alice.room!.players[1]!.away);
    expect(alice.room!.players.map((p) => p.away)).toEqual([false, true, false]);

    // Les humains jouent quand c'est à eux ; le bot de Bruno joue tout seul, jusqu'à la manche suivante.
    const mustAct = (g: PlayerView) =>
      g.phase === 'roundOver' ||
      (g.phase === 'cut' && g.dealer === g.you) ||
      (g.phase === 'exchange' && g.exchange?.winnerIndex === g.you) ||
      (g.phase === 'playing' && g.currentPlayer === g.you);
    const humans = [alice, chloe2];
    const done = () => alice.game!.round > 1 || alice.game!.phase === 'gameOver';
    for (let steps = 0; !done(); steps++) {
      expect(steps).toBeLessThan(2000);
      await waitFor(() => done() || humans.some((h) => h.game && mustAct(h.game)), 5000);
      if (done()) break;
      const before = JSON.stringify(alice.game);
      const human = humans.find((h) => h.game && mustAct(h.game))!;
      await playBotTurn([human, human, human]);
      await waitFor(() => JSON.stringify(alice.game) !== before);
    }

    const back = connect();
    expect(await back.emitWithAck('room:rejoin', { code, token })).toMatchObject({ ok: true });
    await waitFor(() => !alice.room!.players[1]!.away && alice.room!.players[1]!.connected);
    expect(back.game!.you).toBe(1);
  }, 30000);

  it("refuse un second siège au même compte, sauf pour l'admin", async () => {
    await start({ adminEmail: 'Chef@Exemple.fr' });
    const host = connect('Alice');
    const created = await host.emitWithAck('room:create', {});
    if (!created.ok) throw new Error(created.error);
    const session = (host.auth as { session: string }).session;
    const otherBrowser = connectWith({ session });
    expect(await otherBrowser.emitWithAck('room:join', { code: created.code })).toEqual({ ok: false, error: 'alreadySeated' });
    expect((await connect('Bruno').emitWithAck('room:join', { code: created.code })).ok).toBe(true);

    server.accounts.signIn({ sub: 'chef', email: 'chef@exemple.fr' });
    server.accounts.update('chef', { name: 'Maître' });
    const admin = { session: server.accounts.session('chef') };
    const adminRoom = await connectWith(admin).emitWithAck('room:create', {});
    if (!adminRoom.ok) throw new Error(adminRoom.error);
    expect((await connectWith(admin).emitWithAck('room:join', { code: adminRoom.code })).ok).toBe(true);
    // Le second siège de l'admin n'est pas rattaché à son compte : il ne compte pas deux fois au classement.
    expect(server.rooms.get(adminRoom.code)!.seats.map((s) => s.account)).toEqual(['chef', undefined]);
  });

  it('demande un compte avec un pseudo pour jouer, mais pas pour regarder', async () => {
    await start();
    const guest = connect(null);
    expect(await guest.emitWithAck('room:create', {})).toEqual({ ok: false, error: 'notSignedIn' });
    expect(await guest.emitWithAck('room:join', { code: 'ABCD' })).toEqual({ ok: false, error: 'notSignedIn' });
    expect(await guest.emitWithAck('stats:get')).toMatchObject({ ok: true });
    expect(await guest.emitWithAck('account:get')).toEqual({ ok: true, account: null, googleClientId: null });
    expect(await connectWith({ session: 'fausse.session.signee' }).emitWithAck('account:get')).toMatchObject({ account: null });
  });

  it('crée le compte à la connexion Google, puis le pseudo choisi est unique', async () => {
    const verifyGoogle = async (credential: string) => (credential.startsWith('ok-') ? { sub: credential, email: `${credential}@exemple.fr` } : null);
    await start({ verifyGoogle, googleClientId: 'client-test' });
    const client = connect(null);
    expect(await client.emitWithAck('account:google', { credential: 'faux' })).toEqual({ ok: false, error: 'signInFailed' });
    const signed = await client.emitWithAck('account:google', { credential: 'ok-camille' });
    if (!signed.ok) throw new Error(signed.error);
    expect(signed.account).toMatchObject({ id: 'ok-camille', name: '', admin: false });
    expect(await client.emitWithAck('room:create', {})).toEqual({ ok: false, error: 'noName' });

    connect('Alice');
    expect(await client.emitWithAck('account:update', { name: ' alice ' })).toEqual({ ok: false, error: 'nameTaken' });
    expect(await client.emitWithAck('account:update', { name: 'Camille', avatar: '🦊', color: 'pas une couleur' })).toMatchObject({
      ok: true,
      account: { name: 'Camille', avatar: '🦊' },
    });
    expect((await client.emitWithAck('room:create', {})).ok).toBe(true);
    expect(server.rooms.all()[0]!.seats[0]).toMatchObject({ name: 'Camille', avatar: '🦊', account: 'ok-camille' });

    // La session remise suffit à se reconnecter depuis un autre onglet.
    const again = connectWith({ session: signed.session });
    expect(await again.emitWithAck('account:get')).toMatchObject({ account: { name: 'Camille' }, googleClientId: 'client-test' });
  });

  it('ferme le site pour maintenance : seul l’admin entre encore dans un salon, et lui seul le rouvre', async () => {
    await start({ adminEmail: 'chef@exemple.fr', maintenanceByDefault: true });
    server.accounts.signIn({ sub: 'chef', email: 'chef@exemple.fr' });
    server.accounts.update('chef', { name: 'Maître' });
    const admin = connectWith({ session: server.accounts.session('chef') });
    const player = connect('Bruno');
    expect(await player.emitWithAck('site:get')).toEqual({ ok: true, maintenance: true });
    expect(await player.emitWithAck('room:create', {})).toEqual({ ok: false, error: 'maintenance' });
    expect(await player.emitWithAck('admin:maintenance', { on: false })).toEqual({ ok: false, error: 'notAdmin' });
    // L'admin, lui, joue pour tester.
    const created = await admin.emitWithAck('room:create', {});
    if (!created.ok) throw new Error(created.error);
    expect(await player.emitWithAck('room:join', { code: created.code })).toEqual({ ok: false, error: 'maintenance' });
    let changed = false;
    player.on('site:changed', () => (changed = true));
    expect(await admin.emitWithAck('admin:maintenance', { on: false })).toEqual({ ok: true });
    await waitFor(() => changed);
    expect(await player.emitWithAck('site:get')).toEqual({ ok: true, maintenance: false });
    expect((await player.emitWithAck('room:join', { code: created.code })).ok).toBe(true);
  });

  it("laisse l'admin renommer et bloquer les comptes", async () => {
    await start({ adminEmail: 'chef@exemple.fr' });
    server.accounts.signIn({ sub: 'chef', email: 'chef@exemple.fr' });
    server.accounts.update('chef', { name: 'Maître' });
    const admin = connectWith({ session: server.accounts.session('chef') });
    const player = connect('Grossier');
    const id = `google-${accountCount}`;

    expect(await player.emitWithAck('admin:accounts')).toEqual({ ok: false, error: 'notAdmin' });
    const list = await admin.emitWithAck('admin:accounts');
    expect(list.ok && list.accounts.map((a) => a.name)).toEqual(['Grossier', 'Maître']);
    expect(await admin.emitWithAck('admin:update', { id, name: 'Maître' })).toEqual({ ok: false, error: 'nameTaken' });
    expect(await admin.emitWithAck('admin:update', { id, name: 'Poli' })).toEqual({ ok: true });
    expect(await admin.emitWithAck('admin:update', { id, blocked: true })).toEqual({ ok: true });
    expect(await player.emitWithAck('room:create', {})).toEqual({ ok: false, error: 'notSignedIn' });
    expect(server.accounts.get(id)).toMatchObject({ name: 'Poli', blocked: true });
    expect(await player.emitWithAck('admin:resetRanking')).toEqual({ ok: false, error: 'notAdmin' });
    expect(await admin.emitWithAck('admin:unrank', { id: 'personne' })).toEqual({ ok: false, error: 'accountNotFound' });
    expect(await admin.emitWithAck('admin:unrank', { id })).toEqual({ ok: true });
    const changed = new Promise<void>((resolve) => player.once('stats:changed', resolve));
    expect(await admin.emitWithAck('admin:resetRanking')).toEqual({ ok: true });
    await changed; // l'accueil de chacun recharge le classement
  });

  it("crée un compte sans Google par un lien d'invitation de l'admin, qui ne sert qu'une fois", async () => {
    // Beaucoup d'essais d'affilée depuis la même adresse : la limite est vérifiée dans le test suivant.
    await start({ adminEmail: 'chef@exemple.fr', limits: { loginsPerIp: 100 } });
    server.accounts.signIn({ sub: 'chef', email: 'chef@exemple.fr' });
    const admin = connectWith({ session: server.accounts.session('chef') });
    const invited = connect(null);
    expect(await invited.emitWithAck('admin:invite', {})).toEqual({ ok: false, error: 'notAdmin' });
    const created = await admin.emitWithAck('admin:invite', {});
    if (!created.ok) throw new Error(created.error);
    const { code } = created.invite;
    expect(await admin.emitWithAck('admin:invites')).toMatchObject({ ok: true, invites: [{ code }] });

    // L'invité ouvre le lien, choisit un identifiant et un mot de passe, et le voilà connecté (sans pseudo encore).
    expect(await invited.emitWithAck('account:invite', { code: 'inventé' })).toEqual({ ok: false, error: 'invalidInvite' });
    expect(await invited.emitWithAck('account:invite', { code })).toEqual({ ok: true, invite: { reset: false } });
    expect(await invited.emitWithAck('account:register', { code, login: 'a', password: 'motdepasse' })).toEqual({ ok: false, error: 'invalidLogin' });
    expect(await invited.emitWithAck('account:register', { code, login: 'camille', password: 'court' })).toEqual({ ok: false, error: 'weakPassword' });
    const registered = await invited.emitWithAck('account:register', { code, login: ' Camille ', password: 'motdepasse' });
    if (!registered.ok) throw new Error(registered.error);
    expect(registered.account).toMatchObject({ email: '', name: '' });
    expect(await invited.emitWithAck('account:update', { name: 'Camille' })).toMatchObject({ ok: true });
    // Le lien a servi : il ne marche plus, et la session reconnecte toute seule.
    expect(await invited.emitWithAck('account:register', { code, login: 'autre', password: 'motdepasse' })).toEqual({ ok: false, error: 'invalidInvite' });
    expect(await admin.emitWithAck('admin:invites')).toEqual({ ok: true, invites: [] });
    expect(await connectWith({ session: registered.session }).emitWithAck('account:get')).toMatchObject({ account: { name: 'Camille' } });

    // Connexion avec l'identifiant (sans tenir compte des majuscules), et refus d'un mauvais mot de passe.
    const other = connect(null);
    expect(await other.emitWithAck('account:login', { login: 'camille', password: 'mauvais' })).toEqual({ ok: false, error: 'wrongPassword' });
    expect(await other.emitWithAck('account:login', { login: 'personne', password: 'motdepasse' })).toEqual({ ok: false, error: 'wrongPassword' });
    expect(await other.emitWithAck('account:login', { login: 'CAMILLE', password: 'motdepasse' })).toMatchObject({ ok: true, account: { name: 'Camille' } });

    // Mot de passe oublié : l'admin fait un lien pour ce compte, qui garde son identifiant.
    const list = await admin.emitWithAck('admin:accounts');
    const id = list.ok ? list.accounts.find((a) => a.login === 'camille')!.id : '';
    expect(await admin.emitWithAck('admin:invite', { accountId: 'chef' })).toEqual({ ok: false, error: 'accountNotFound' });
    const reset = await admin.emitWithAck('admin:invite', { accountId: id });
    if (!reset.ok) throw new Error(reset.error);
    expect(reset.invite.account).toBe('Camille');
    expect(await other.emitWithAck('account:invite', { code: reset.invite.code })).toEqual({ ok: true, invite: { reset: true, login: 'camille' } });
    expect(await other.emitWithAck('account:register', { code: reset.invite.code, login: 'ignoré', password: 'nouveau-mot' })).toMatchObject({
      ok: true,
      account: { name: 'Camille' },
    });
    expect(await other.emitWithAck('account:login', { login: 'camille', password: 'motdepasse' })).toEqual({ ok: false, error: 'wrongPassword' });
    expect(await other.emitWithAck('account:login', { login: 'camille', password: 'nouveau-mot' })).toMatchObject({ ok: true });

    // Un lien révoqué ne sert plus, et un compte bloqué ne se connecte plus.
    const revoked = await admin.emitWithAck('admin:invite', {});
    if (!revoked.ok) throw new Error(revoked.error);
    expect(await admin.emitWithAck('admin:revokeInvite', { code: revoked.invite.code })).toEqual({ ok: true });
    expect(await other.emitWithAck('account:invite', { code: revoked.invite.code })).toEqual({ ok: false, error: 'invalidInvite' });
    expect(await admin.emitWithAck('admin:update', { id, blocked: true })).toEqual({ ok: true });
    expect(await other.emitWithAck('account:login', { login: 'camille', password: 'nouveau-mot' })).toEqual({ ok: false, error: 'blocked' });
  });

  it("limite les essais de mot de passe par identifiant", async () => {
    await start({ limits: { loginsPerIp: 3 } });
    const client = connect(null);
    for (let i = 0; i < 3; i++) expect(await client.emitWithAck('account:login', { login: 'camille', password: 'x' })).toMatchObject({ error: 'wrongPassword' });
    expect(await client.emitWithAck('account:login', { login: 'camille', password: 'x' })).toEqual({ ok: false, error: 'slowDown' });
  });

  it('tient le mur de la communauté : idées, votes, commentaires, et statut donné par l’admin', async () => {
    await start({ adminEmail: 'chef@exemple.fr' });
    server.accounts.signIn({ sub: 'chef', email: 'chef@exemple.fr' });
    server.accounts.update('chef', { name: 'Chef' });
    const admin = connectWith({ session: server.accounts.session('chef') });
    const alice = connect('Alice');
    const bruno = connect('Bruno');
    const visitor = connect(null);
    expect(await visitor.emitWithAck('community:post', { kind: 'idea', title: 'Coucou', text: '' })).toEqual({ ok: false, error: 'notSignedIn' });
    expect(await alice.emitWithAck('community:post', { kind: 'idea', title: '   ', text: '' })).toEqual({ ok: false, error: 'emptyMessage' });
    // Pas de dessin en caractères : seuls les lettres, les chiffres et la ponctuation d'une phrase restent.
    expect(await alice.emitWithAck('community:post', { kind: 'idea', title: '/\\_/\\ ===> |#|', text: '' })).toEqual({ ok: false, error: 'emptyMessage' });
    const changed = new Promise<void>((resolve) => bruno.once('community:changed', resolve));
    const posted = await alice.emitWithAck('community:post', { kind: 'idea', title: 'Ajouter le Président', text: 'Pour jouer à plus de quatre.' });
    if (!posted.ok) throw new Error(posted.error);
    await changed;
    const art = await alice.emitWithAck('community:post', {
      kind: 'bug',
      title: 'Le chat masque mes cartes !!!!!! /\\_/\\ ===>   ok',
      text: 'Ligne 1\n\n\n\n| ### |\nLigne 2   ¯\\_(o)_/¯',
    });
    if (!art.ok) throw new Error(art.error);
    const wall = await alice.emitWithAck('community:list');
    const cleaned = wall.ok ? wall.ideas.find((i) => i.id === art.id)! : null;
    expect(cleaned!.title).toBe('Le chat masque mes cartes !!! ok');
    expect(cleaned!.text).toBe('Ligne 1\n\nLigne 2 (o)');

    // Bruno vote pour la première idée : elle passe devant, avec deux voix (l'autrice vote d'office).
    expect(await bruno.emitWithAck('community:vote', { id: posted.id, on: true })).toEqual({ ok: true });
    expect(await bruno.emitWithAck('community:comment', { id: posted.id, text: 'Oui !' })).toEqual({ ok: true });
    const list = await bruno.emitWithAck('community:list');
    if (!list.ok) throw new Error(list.error);
    expect(list.ideas.map((i) => [i.title, i.votes, i.voted, i.mine])).toEqual([
      ['Ajouter le Président', 2, true, false],
      ['Le chat masque mes cartes !!! ok', 1, false, false],
    ]);
    expect(list.ideas[0]).toMatchObject({ kind: 'idea', author: 'Alice', status: 'new', comments: [{ author: 'Bruno', text: 'Oui !' }] });
    // Un vote retiré ne compte plus ; sans compte, on lit le mur sans pouvoir voter.
    expect(await bruno.emitWithAck('community:vote', { id: posted.id, on: false })).toEqual({ ok: true });
    expect(await visitor.emitWithAck('community:list')).toMatchObject({ ok: true, ideas: [{ votes: 1, voted: false }, { votes: 1 }] });

    // Seul l'admin change le statut ; une demande faite passe en fin de mur.
    expect(await alice.emitWithAck('community:status', { id: posted.id, status: 'done' })).toEqual({ ok: false, error: 'notAdmin' });
    expect(await admin.emitWithAck('community:status', { id: posted.id, status: 'n’importe quoi' as 'done' })).toEqual({ ok: false, error: 'invalidStatus' });
    expect(await admin.emitWithAck('community:status', { id: posted.id, status: 'done' })).toEqual({ ok: true });
    const after = await alice.emitWithAck('community:list');
    expect(after.ok && after.ideas.map((i) => [i.title, i.status, i.mine])).toEqual([
      ['Le chat masque mes cartes !!! ok', 'new', true],
      ['Ajouter le Président', 'done', true],
    ]);

    // On retire sa propre idée, pas celle des autres (sauf l'admin).
    const bug = after.ok ? after.ideas[0]!.id : '';
    expect(await bruno.emitWithAck('community:remove', { id: bug })).toEqual({ ok: false, error: 'notAdmin' });
    expect(await alice.emitWithAck('community:remove', { id: bug })).toEqual({ ok: true });
    expect(await admin.emitWithAck('community:remove', { id: posted.id })).toEqual({ ok: true });
    expect(await alice.emitWithAck('community:list')).toEqual({ ok: true, ideas: [] });
  });

  it('fait jouer un duel de machines à sous entre deux humains, rangé dans son propre classement', async () => {
    await start();
    const alice = connect('Alice');
    const created = await alice.emitWithAck('room:create', { game: 'slots' });
    if (!created.ok) throw new Error(created.error);
    const bruno = connect('Bruno');
    expect((await bruno.emitWithAck('room:join', { code: created.code })).ok).toBe(true);
    // Deux places seulement.
    expect(await connect('Chloé').emitWithAck('room:join', { code: created.code })).toEqual({ ok: false, error: 'roomFull' });
    expect((await alice.emitWithAck('game:start', {})).ok).toBe(true);

    const players = [alice, bruno];
    const changes: { game: string; before: number; after: number }[] = [];
    alice.on('rating:changed', (c) => changes.push(c));
    const view = (c: Client) => c.game as unknown as SlotsView | undefined;
    await waitFor(() => players.every((p) => view(p)?.game === 'slots'));
    expect(view(alice)).toMatchObject({ you: 0, round: 1, stake: 5, currentPlayer: 0 });
    expect(await bruno.emitWithAck('game:spin')).toEqual({ ok: false, error: 'notYourTurn' });
    for (let spins = 0; view(alice)!.phase !== 'gameOver'; spins++) {
      expect(spins).toBeLessThan(400);
      const turn = view(alice)!;
      expect((await players[turn.currentPlayer]!.emitWithAck('game:spin')).ok).toBe(true);
      const before = JSON.stringify(turn);
      await waitFor(() => JSON.stringify(view(alice)) !== before);
    }
    const end = view(alice)!;
    expect(end.players.some((p) => p.balance <= 0 || p.balance >= end.goal)).toBe(true);

    const stats = await alice.emitWithAck('stats:get');
    expect(stats.ok && stats.games.slots.recent).toHaveLength(1);
    // Les deux partaient de 1000 : le gagnant prend 24 points au perdant, et chacun l'apprend en fin de partie.
    const ranking = stats.ok ? stats.games.slots.ranking : [];
    expect(ranking.map((e) => e.rating)).toEqual([1024, 976]);
    expect(ranking[0]!.name).toBe(end.winners[0] === 0 ? 'Alice' : 'Bruno');
    await waitFor(() => changes.length === 1);
    expect(changes[0]).toEqual({ game: 'slots', before: 1000, after: end.winners[0] === 0 ? 1024 : 976 });
    // Le duel ne compte ni dans le classement de Gang of Four, ni dans son niveau.
    expect(stats.ok && stats.games.gof.recent).toEqual([]);
    expect(server.history.progressOfAccount(server.accounts.byName('Alice')!.id).xp).toBe(0);
  }, 60000);

  it('laisse s’entraîner au duel contre un bot, sans rien enregistrer', async () => {
    await start({ botDelayMs: 0, turnSecondMs: 1 });
    const human = connect('Alice');
    expect(await human.emitWithAck('room:create', { game: 'slots', training: true })).toMatchObject({ ok: true });
    expect((await human.emitWithAck('room:addBot', {})).ok).toBe(true);
    expect(await human.emitWithAck('room:addBot', {})).toEqual({ ok: false, error: 'roomFull' });
    // Le minuteur tire à la place de l'humain : la partie va au bout toute seule.
    expect((await human.emitWithAck('game:start', { turnSeconds: 30 })).ok).toBe(true);
    await waitFor(() => (human.game as unknown as SlotsView | undefined)?.phase === 'gameOver', 20000);
    const stats = await human.emitWithAck('stats:get');
    expect(stats.ok && stats.games.slots.recent).toEqual([]);
  }, 30000);

  it('fait jouer une bataille navale entre deux humains : flottes secrètes, tirs chacun son tour, classement à part', async () => {
    await start();
    const alice = connect('Alice');
    const created = await alice.emitWithAck('room:create', { game: 'battleship' });
    if (!created.ok) throw new Error(created.error);
    const bruno = connect('Bruno');
    expect((await bruno.emitWithAck('room:join', { code: created.code })).ok).toBe(true);
    expect((await alice.emitWithAck('game:start', {})).ok).toBe(true);
    const view = (c: Client) => c.game as unknown as BattleshipView | undefined;
    await waitFor(() => [alice, bruno].every((c) => view(c)?.phase === 'placing'));

    // Chacun place sa flotte quand il veut ; une flotte non réglementaire est refusée.
    expect(await alice.emitWithAck('game:place', { ships: [{ cells: [0, 1] }] })).toEqual({ ok: false, error: 'invalidFleet' });
    const random = createRng(4);
    const fleets = [randomFleet(random), randomFleet(random)];
    expect((await bruno.emitWithAck('game:place', { ships: fleets[1]! })).ok).toBe(true);
    expect((await alice.emitWithAck('game:place', { ships: fleets[0]! })).ok).toBe(true);
    await waitFor(() => view(alice)?.phase === 'playing');
    // Alice voit sa flotte, et rien de celle de Bruno.
    expect(view(alice)!.myShips).toEqual(fleets[0]);
    expect(JSON.stringify(view(alice))).not.toContain(JSON.stringify(fleets[1]![0]!.cells));

    // Chacun tire case après case ; la partie finit quand une flotte est coulée.
    const next = [0, 0];
    const players = [alice, bruno];
    for (let shots = 0; view(alice)!.phase === 'playing'; shots++) {
      expect(shots).toBeLessThan(200);
      const turn = view(alice)!.currentPlayer;
      const before = JSON.stringify(view(alice));
      expect((await players[turn]!.emitWithAck('game:shoot', { cell: next[turn]!++ })).ok).toBe(true);
      await waitFor(() => JSON.stringify(view(alice)) !== before);
    }
    expect(view(alice)!.revealed[1]).toHaveLength(5);
    const stats = await alice.emitWithAck('stats:get');
    expect(stats.ok && stats.games.battleship.recent).toHaveLength(1);
    expect(stats.ok && stats.games.gof.recent).toEqual([]);
  }, 60000);

  it('laisse s’entraîner à la bataille navale contre un bot qui place et tire tout seul', async () => {
    await start({ botDelayMs: 0, turnSecondMs: 1 });
    const human = connect('Alice');
    expect(await human.emitWithAck('room:create', { game: 'battleship', training: true })).toMatchObject({ ok: true });
    expect((await human.emitWithAck('room:addBot', {})).ok).toBe(true);
    expect((await human.emitWithAck('game:start', { turnSeconds: 30 })).ok).toBe(true);
    await waitFor(() => (human.game as unknown as BattleshipView | undefined)?.phase === 'placing');
    expect((await human.emitWithAck('game:place', { ships: randomFleet(createRng(2)) })).ok).toBe(true);
    // Le bot place sa flotte, puis le minuteur tire pour l'humain : la partie va au bout.
    await waitFor(() => (human.game as unknown as BattleshipView | undefined)?.phase === 'gameOver', 20000);
    const stats = await human.emitWithAck('stats:get');
    expect(stats.ok && stats.games.battleship.recent).toEqual([]);
  }, 30000);

  it('fait jouer une partie de Reversi entre deux humains, classée en points', async () => {
    await start();
    const alice = connect('Alice');
    const created = await alice.emitWithAck('room:create', { game: 'reversi' });
    if (!created.ok) throw new Error(created.error);
    const bruno = connect('Bruno');
    expect((await bruno.emitWithAck('room:join', { code: created.code })).ok).toBe(true);
    expect((await alice.emitWithAck('game:start', {})).ok).toBe(true);
    const view = (c: Client) => c.game as unknown as ReversiView | undefined;
    await waitFor(() => [alice, bruno].every((c) => view(c)?.game === 'reversi'));
    expect(view(alice)).toMatchObject({ you: 0, currentPlayer: 0, players: [{ discs: 2 }, { discs: 2 }] });
    expect(await alice.emitWithAck('game:move', { cell: 0 })).toEqual({ ok: false, error: 'illegalMove' });
    // Chacun joue le premier coup permis jusqu'à la fin.
    const players = [alice, bruno];
    for (let moves = 0; view(alice)!.phase === 'playing'; moves++) {
      expect(moves).toBeLessThan(80);
      const turn = view(alice)!;
      const before = JSON.stringify(turn);
      expect((await players[turn.currentPlayer]!.emitWithAck('game:move', { cell: turn.legal[0]! })).ok).toBe(true);
      await waitFor(() => JSON.stringify(view(alice)) !== before);
    }
    const stats = await alice.emitWithAck('stats:get');
    expect(stats.ok && stats.games.reversi.recent).toHaveLength(1);
    expect(stats.ok && stats.games.reversi.ranking).toHaveLength(2);
  }, 60000);

  it('laisse s’entraîner au Reversi contre un bot difficile', async () => {
    await start({ botDelayMs: 0, turnSecondMs: 1 });
    const human = connect('Alice');
    expect(await human.emitWithAck('room:create', { game: 'reversi', training: true })).toMatchObject({ ok: true });
    expect((await human.emitWithAck('room:addBot', { level: 'hard' })).ok).toBe(true);
    // Le minuteur joue pour l'humain : la partie va au bout toute seule.
    expect((await human.emitWithAck('game:start', { turnSeconds: 30 })).ok).toBe(true);
    await waitFor(() => (human.game as unknown as ReversiView | undefined)?.phase === 'gameOver', 30000);
    const stats = await human.emitWithAck('stats:get');
    expect(stats.ok && stats.games.reversi.recent).toEqual([]);
  }, 40000);

  it('fait jouer une partie d’échecs à la pendule entre deux humains, classée en points, et échange les couleurs à la revanche', async () => {
    await start();
    const alice = connect('Alice');
    const created = await alice.emitWithAck('room:create', { game: 'chess' });
    if (!created.ok) throw new Error(created.error);
    const bruno = connect('Bruno');
    expect((await bruno.emitWithAck('room:join', { code: created.code })).ok).toBe(true);
    const changes: { before: number; after: number }[] = [];
    alice.on('rating:changed', (c) => changes.push(c));
    expect((await alice.emitWithAck('game:start', { timeControl: '3+2' })).ok).toBe(true);
    const view = (c: Client) => c.game as unknown as ChessView | undefined;
    await waitFor(() => [alice, bruno].every((c) => view(c)?.game === 'chess'));
    const players = [alice, bruno];
    const first = view(alice)!;
    expect(first).toMatchObject({ timeControl: '3+2', currentPlayer: first.white, clock: { remaining: [180_000, 180_000], running: null } });
    const white = players[first.white]!;
    const black = players[1 - first.white]!;
    expect(view(white)!.legal).toHaveLength(20);
    expect(view(black)!.legal).toEqual([]);
    expect(await black.emitWithAck('game:chessMove', { from: 52, to: 36 })).toEqual({ ok: false, error: 'notYourTurn' });
    expect(await white.emitWithAck('game:chessMove', { from: 12, to: 36 })).toEqual({ ok: false, error: 'illegalMove' });

    // Le mat du berger inversé : f3 e5 g4 Dh4 mat.
    const moves: [Client, number, number][] = [
      [white, 13, 21],
      [black, 52, 36],
      [white, 14, 30],
      [black, 59, 31],
    ];
    for (const [who, from, to] of moves) {
      const before = view(alice)!.moves.length;
      expect((await who.emitWithAck('game:chessMove', { from, to })).ok).toBe(true);
      await waitFor(() => view(alice)!.moves.length === before + 1);
    }
    await waitFor(() => view(alice)!.phase === 'gameOver');
    expect(view(alice)).toMatchObject({ end: 'checkmate', winners: [1 - first.white] });
    expect(view(alice)!.moves.map((m) => m.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    await waitFor(() => changes.length === 1);
    expect(changes[0]!.after).toBe(alice === black ? 1024 : 976);

    // Revanche : l'autre a les blancs, puis nulle par accord après deux coups.
    expect((await bruno.emitWithAck('game:rematch')).ok).toBe(true);
    await waitFor(() => view(alice)!.phase === 'playing');
    expect(view(alice)!.white).toBe(1 - first.white);
    const white2 = players[view(alice)!.white]!;
    const black2 = players[1 - view(alice)!.white]!;
    expect(await white2.emitWithAck('game:draw', { answer: 'offer' })).toEqual({ ok: false, error: 'noDrawOffer' });
    await white2.emitWithAck('game:chessMove', { from: 12, to: 28 });
    await black2.emitWithAck('game:chessMove', { from: 52, to: 36 });
    await waitFor(() => view(alice)!.moves.length === 2);
    expect((await white2.emitWithAck('game:draw', { answer: 'offer' })).ok).toBe(true);
    await waitFor(() => view(black2)!.drawOffer !== null);
    expect((await black2.emitWithAck('game:draw', { answer: 'accept' })).ok).toBe(true);
    await waitFor(() => view(alice)!.phase === 'gameOver');
    expect(view(alice)).toMatchObject({ end: 'agreement', winners: [] });
    const stats = await alice.emitWithAck('stats:get');
    expect(stats.ok && stats.games.chess.recent).toHaveLength(2);
  }, 30000);

  it('aux échecs, aucun bot ne remplace un absent : le joueur resté réclame la victoire', async () => {
    await start({ awayDelayMs: 30 });
    const alice = connect('Alice');
    const created = await alice.emitWithAck('room:create', { game: 'chess' });
    if (!created.ok) throw new Error(created.error);
    const bruno = connect('Bruno');
    await bruno.emitWithAck('room:join', { code: created.code });
    await alice.emitWithAck('game:start', { timeControl: '10+0' });
    const view = (c: Client) => c.game as unknown as ChessView | undefined;
    await waitFor(() => view(alice)?.game === 'chess' && view(bruno)?.game === 'chess');
    const white = [alice, bruno][view(alice)!.white]!;
    const black = [alice, bruno][1 - view(alice)!.white]!;
    await white.emitWithAck('game:chessMove', { from: 12, to: 28 });
    await black.emitWithAck('game:chessMove', { from: 52, to: 36 });
    await waitFor(() => view(alice)!.moves.length === 2);
    expect(await alice.emitWithAck('game:claim')).toEqual({ ok: false, error: 'opponentHere' });
    bruno.disconnect();
    await waitFor(() => !!alice.room?.players[1]?.away);
    // Toujours au même point : personne n'a joué à la place de Bruno.
    expect(view(alice)!.moves).toHaveLength(2);
    expect((await alice.emitWithAck('game:claim')).ok).toBe(true);
    await waitFor(() => view(alice)!.phase === 'gameOver');
    expect(view(alice)).toMatchObject({ end: 'abandon', winners: [0] });
  });

  it('laisse s’entraîner aux échecs contre un bot, sans pendule, sans compter la partie', async () => {
    await start({ botDelayMs: 0 });
    const human = connect('Alice');
    expect(await human.emitWithAck('room:create', { game: 'chess', training: true })).toMatchObject({ ok: true });
    expect((await human.emitWithAck('room:addBot', { level: 'easy' })).ok).toBe(true);
    expect((await human.emitWithAck('game:start', { timeControl: 'none' })).ok).toBe(true);
    const view = () => human.game as unknown as ChessView | undefined;
    await waitFor(() => view()?.game === 'chess');
    expect(view()!.clock).toBe(null);
    if (view()!.white === 0) await human.emitWithAck('game:chessMove', { from: 12, to: 28 });
    // Le bot répond tout seul.
    await waitFor(() => view()!.currentPlayer === 0 && view()!.moves.length > 0, 5000);
    if (view()!.moves.length < 2) {
      await human.emitWithAck('game:chessMove', view()!.legal[0]!);
      await waitFor(() => view()!.moves.length >= 3, 5000);
    }
    expect((await human.emitWithAck('game:resign')).ok).toBe(true);
    await waitFor(() => view()!.phase === 'gameOver');
    expect(view()!.end).toBe('resign');
    const stats = await human.emitWithAck('stats:get');
    expect(stats.ok && stats.games.chess.recent).toEqual([]);
  }, 20000);

  it('liste les salons qui attendent des joueurs, jeu par jeu', async () => {

    await start();
    const alice = connect('Alice');
    const created = await alice.emitWithAck('room:create', { game: 'slots' });
    if (!created.ok) throw new Error(created.error);
    await alice.emitWithAck('room:addBot', {}).then((r) => expect(r).toEqual({ ok: false, error: 'trainingOnly' }));
    const bruno = connect('Bruno');
    const open = await bruno.emitWithAck('rooms:open', { game: 'slots' });
    expect(open).toEqual({ ok: true, rooms: [{ code: created.code, game: 'slots', host: 'Alice', players: 1, minPlayers: 2, maxPlayers: 2 }] });
    expect(await bruno.emitWithAck('rooms:open', { game: 'gof' })).toEqual({ ok: true, rooms: [] });
    expect((await bruno.emitWithAck('room:join', { code: created.code })).ok).toBe(true);
    await waitFor(() => alice.room?.players.length === 2);
  });

  it('donne la saison en cours avec les classements', async () => {
    await start();
    const stats = await connect('Alice').emitWithAck('stats:get');
    expect(stats).toMatchObject({
      ok: true,
      season: { id: expect.stringMatching(/^\d{4}-(hiver|printemps|ete|automne)$/) },
      games: { gof: { ranking: [] }, slots: { ranking: [] }, battleship: { ranking: [] }, reversi: { ranking: [] } },
    });
  });

  it('supprime un salon abandonné après le délai', async () => {
    await start({ abandonDelayMs: 50 });
    const { code, players } = await lobby(3);
    await players[0]!.emitWithAck('game:start', {});
    players.forEach((p) => p.disconnect());
    await waitFor(() => server.rooms.get(code) === undefined);
  });

  it('ferme tout de suite un salon que le dernier vrai joueur quitte, et ne montre que les parties avec un vrai joueur', async () => {
    await start({ abandonDelayMs: 60_000, lobbyAbandonDelayMs: 60_000 });
    // Salon d'attente : l'hôte seul avec des bots s'en va, le salon disparaît.
    const waiting = await lobby(1);
    expect((await waiting.players[0]!.emitWithAck('room:leave')).ok).toBe(true);
    expect(server.rooms.get(waiting.code)).toBeUndefined();

    // Partie lancée : tant qu'un joueur reste, elle continue ; quand le dernier quitte, elle est supprimée.
    const playing = await lobby(3);
    await playing.players[0]!.emitWithAck('game:start', {});
    await waitFor(() => playing.players.every((p) => p.game));
    expect((await playing.players[0]!.emitWithAck('room:leave')).ok).toBe(true);
    playing.players[2]!.disconnect();
    expect(server.rooms.get(playing.code)).toBeDefined();
    const watcher = connect();
    const live = async () => {
      const result = await watcher.emitWithAck('rooms:live');
      return result.ok ? result.rooms.map((r) => r.code) : [];
    };
    expect(await live()).toEqual([playing.code]);
    // Le dernier joueur ferme son onglet : la partie reste un moment pour qu'il puisse revenir, mais n'est plus listée.
    playing.players[1]!.disconnect();
    await waitFor(() => server.rooms.isAbandoned(playing.code));
    expect(server.rooms.get(playing.code)).toBeDefined();
    expect(await live()).toEqual([]);
  });

  it('ferme vite un salon abandonné avant la partie, mais garde une partie en cours', async () => {
    await start({ abandonDelayMs: 60_000, lobbyAbandonDelayMs: 50 });
    const waiting = await lobby(3);
    const playing = await lobby(3);
    await playing.players[0]!.emitWithAck('game:start', {});
    [...waiting.players, ...playing.players].forEach((p) => p.disconnect());
    await waitFor(() => server.rooms.get(waiting.code) === undefined);
    await new Promise((r) => setTimeout(r, 100));
    expect(server.rooms.get(playing.code)).toBeDefined();
  });

  it('limite les salons créés à la chaîne par une même connexion et une même adresse', async () => {
    await start({ limits: { roomsPerSocket: 2, roomsPerIp: 3 } });
    const spammer = connect();
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await spammer.emitWithAck('room:create', {}));
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(results[2]).toEqual({ ok: false, error: 'slowDown' });

    // Une autre connexion de la même adresse n'a plus droit qu'à un salon.
    const other = connect();
    expect((await other.emitWithAck('room:create', {})).ok).toBe(true);
    expect(await other.emitWithAck('room:create', {})).toEqual({ ok: false, error: 'slowDown' });
    // Rejoindre un salon reste possible.
    const code = (results[1] as { code: string }).code;
    expect((await connect().emitWithAck('room:join', { code })).ok).toBe(true);
  });

  it('laisse regarder une partie en cours sans voir aucune main ni pouvoir jouer', async () => {
    await start();
    const { code, players } = await lobby(3);
    const watcher = connect();
    expect(await watcher.emitWithAck('room:watch', { code })).toEqual({ ok: false, error: 'gameNotStarted' });
    await players[0]!.emitWithAck('game:start', {});
    await waitFor(() => players.every((p) => p.game));

    const live = await watcher.emitWithAck('rooms:live');
    expect(live.ok && live.rooms.map((r) => r.code)).toEqual([code]);

    const watched = await watcher.emitWithAck('room:watch', { code });
    expect(watched).toMatchObject({ ok: true, code, spectator: true });
    await waitFor(() => !!watcher.game && players.every((p) => p.room?.spectators === 1));
    expect(watcher.game!.you).toBe(-1);
    expect(watcher.game!.hand).toEqual([]);
    expect(watcher.game!.players.map((p) => p.cardCount)).toEqual(players.map((p) => p.game!.hand.length));
    // Le spectateur reçoit la main de chacun ; les joueurs, eux, ne voient que la leur.
    expect(watcher.game!.hands).toEqual(players.map((p) => p.game!.hand));
    expect(players[0]!.game!.hands).toBeUndefined();
    expect(await watcher.emitWithAck('game:pass')).toEqual({ ok: false, error: 'notInRoom' });
    // Un joueur ne peut pas regarder sa propre partie (il verrait les mains des autres).
    expect(await players[1]!.emitWithAck('room:watch', { code })).toEqual({ ok: false, error: 'alreadySeated' });

    watcher.disconnect();
    await waitFor(() => players.every((p) => p.room?.spectators === 0));
    expect(server.rooms.get(code)!.seats).toHaveLength(3);
  });

  it('relaie le chat aux joueurs du salon seulement, sans rien garder', async () => {
    await start();
    const { players } = await lobby(3);
    const outsider = connect('Zoé');
    await outsider.emitWithAck('room:create', {});
    const received: { name: string; text: string }[][] = [[], [], [], []];
    [...players, outsider].forEach((c, i) => c.on('chat:message', (m) => received[i]!.push({ name: m.name, text: m.text })));

    expect(await players[1]!.emitWithAck('chat:send', { text: '  Salut\u0007 tout le monde  ' })).toEqual({ ok: true });
    await waitFor(() => received.slice(0, 3).every((r) => r.length === 1));
    expect(received[0]).toEqual([{ name: 'Bruno', text: 'Salut  tout le monde' }]);
    expect(received[3]).toEqual([]);

    expect(await players[0]!.emitWithAck('chat:send', { text: '   ' })).toEqual({ ok: false, error: 'emptyMessage' });
    expect(await connect().emitWithAck('chat:send', { text: 'coucou' })).toEqual({ ok: false, error: 'notInRoom' });
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await players[2]!.emitWithAck('chat:send', { text: `spam ${i}` }));
    expect(results.filter((r) => r.ok)).toHaveLength(6);
    expect(results[6]).toEqual({ ok: false, error: 'slowDown' });
    expect(JSON.stringify(server.rooms.all())).not.toContain('Salut');
  });

  it("laisse l'hôte et l'admin couper le chat d'un joueur pendant la partie", async () => {
    await start({ adminEmail: 'chef@exemple.fr' });
    const { code, players } = await lobby(3);
    await players[0]!.emitWithAck('game:start', {});
    const [host, bruno, chloe] = players;
    const brunoId = bruno!.room!.players[1]!.id;
    const chloeId = chloe!.room!.players[2]!.id;

    expect(await bruno!.emitWithAck('room:mute', { playerId: chloeId, muted: true })).toEqual({ ok: false, error: 'notHost' });
    expect(await host!.emitWithAck('room:mute', { playerId: brunoId, muted: true })).toEqual({ ok: true });
    await waitFor(() => chloe!.room!.players[1]!.muted);
    expect(await bruno!.emitWithAck('chat:send', { text: 'insulte' })).toEqual({ ok: false, error: 'muted' });
    expect(await chloe!.emitWithAck('chat:send', { text: 'merci' })).toEqual({ ok: true });

    // L'admin, même simple spectateur, peut rendre le chat.
    server.accounts.signIn({ sub: 'chef', email: 'chef@exemple.fr' });
    const admin = connectWith({ session: server.accounts.session('chef') });
    await admin.emitWithAck('room:watch', { code });
    expect(await admin.emitWithAck('room:mute', { playerId: brunoId, muted: false })).toEqual({ ok: true });
    expect(await bruno!.emitWithAck('chat:send', { text: 'pardon' })).toEqual({ ok: true });
  });

  it('laisse l\'hôte exclure un joueur : un bot tient sa place jusqu\'à ce qu\'un nouvel humain la prenne', async () => {
    await start({ botDelayMs: 5, cutPauseMs: 0 });
    const { code, players } = await lobby(3);
    const [host, bruno, chloe] = players;
    await host!.emitWithAck('game:start', {});
    const brunoId = bruno!.room!.players[1]!.id;
    let kicked = false;
    bruno!.on('room:kicked', () => (kicked = true));

    expect(await chloe!.emitWithAck('room:kick', { playerId: brunoId })).toEqual({ ok: false, error: 'notHost' });
    expect(await host!.emitWithAck('room:kick', { playerId: brunoId })).toEqual({ ok: true });
    await waitFor(() => kicked && !!host!.room!.players[1]!.vacant);
    expect(host!.game!.players[1]!.name).toMatch(/^Robot/);
    expect(await bruno!.emitWithAck('game:pass')).toEqual({ ok: false, error: 'notInRoom' });
    expect(await bruno!.emitWithAck('room:join', { code })).toEqual({ ok: false, error: 'kicked' });
    expect(server.rooms.live()[0]).toMatchObject({ open: true });

    // Un nouveau joueur prend la place, avec les cartes et les points du siège.
    const david = connect('David');
    const joined = await david.emitWithAck('room:join', { code });
    expect(joined).toMatchObject({ ok: true, playerId: brunoId });
    await waitFor(() => david.game?.you === 1 && host!.game!.players[1]!.name === 'David');
    expect(host!.room!.players[1]).toMatchObject({ vacant: false, away: false });
    expect(await connect('Emma').emitWithAck('room:join', { code })).toEqual({ ok: false, error: 'gameAlreadyStarted' });
  });

  it("laisse exclure avant la partie, mais personne n'exclut l'admin", async () => {
    await start({ adminEmail: 'chef@exemple.fr' });
    const { code, players } = await lobby(3);
    server.accounts.signIn({ sub: 'chef', email: 'chef@exemple.fr' });
    server.accounts.update('chef', { name: 'Maître' });
    const admin = connectWith({ session: server.accounts.session('chef') });
    await admin.emitWithAck('room:join', { code });
    await waitFor(() => players[0]!.room!.players.length === 4);
    const adminId = players[0]!.room!.players[3]!.id;
    expect(await players[0]!.emitWithAck('room:kick', { playerId: adminId })).toEqual({ ok: false, error: 'notAdmin' });
    // L'admin exclut même l'hôte, qui passe au joueur suivant.
    expect(await admin.emitWithAck('room:kick', { playerId: players[0]!.room!.hostId })).toEqual({ ok: true });
    await waitFor(() => admin.room?.players.length === 3);
    expect(admin.room!.hostId).toBe(admin.room!.players[0]!.id);
    expect(await players[0]!.emitWithAck('room:join', { code })).toEqual({ ok: false, error: 'kicked' });
  });

  it("sert l'interface avec les en-têtes de sécurité et refuse une adresse mal encodée", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gof-static-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    await start({ staticDir: dir });
    const { port } = server.http.address() as AddressInfo;
    const page = await fetch(`http://localhost:${port}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect((await fetch(`http://localhost:${port}/%E0`)).status).toBe(400);
    expect((await fetch(`http://localhost:${port}/`)).status).toBe(200);
  });

  it("compresse les fichiers texte de l'interface selon ce que le navigateur accepte", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gof-static-'));
    const script = `console.log("${'Gang of Four '.repeat(500)}");`;
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    writeFileSync(join(dir, 'app.js'), script);
    await start({ staticDir: dir });
    const { port } = server.http.address() as AddressInfo;
    const get = (encoding: string) => request(`http://localhost:${port}/app.js`, encoding);
    const br = await get('gzip, deflate, br');
    expect(br.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(br.body).toString()).toBe(script);
    expect(br.body.length).toBeLessThan(script.length / 5);
    const gzip = await get('gzip');
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gzip.body).toString()).toBe(script);
    const plain = await get('identity');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.toString()).toBe(script);
  });

  it('freine une connexion qui envoie des événements à la chaîne', async () => {
    await start({ limits: { eventsPerSocket: 5 } });
    const client = connect();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await client.emitWithAck('stats:get'));
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(results[5]).toEqual({ ok: false, error: 'slowDown' });
  });

  it('coupe une connexion qui envoie un message trop gros', async () => {
    await start({ limits: { maxMessageBytes: 1000 } });
    const client = connect();
    await waitFor(() => client.connected);
    client.emit('chat:send', { text: 'x'.repeat(5000) }, () => {});
    await waitFor(() => !client.connected);
  });

  it('refuse de nouveaux salons au-delà du maximum', async () => {
    await start({ limits: { maxRooms: 2 } });
    expect((await connect().emitWithAck('room:create', {})).ok).toBe(true);
    expect((await connect().emitWithAck('room:create', {})).ok).toBe(true);
    expect(await connect().emitWithAck('room:create', {})).toEqual({ ok: false, error: 'tooManyRooms' });
  });

  it('refuse les connexions en trop depuis une même adresse', async () => {
    await start({ limits: { socketsPerIp: 2 } });
    const [a, b] = [connect(), connect()];
    await waitFor(() => a.connected && b.connected);
    const c = connect();
    const refused = await new Promise<string>((resolve) => c.on('connect_error', (e) => resolve(e.message)));
    expect(refused).toBe('slowDown');
    c.disconnect();
    // Une place se libère quand une connexion se ferme.
    a.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    const d = connect();
    await waitFor(() => d.connected);
  });

  it.each([3, 4])('joue une partie complète à %i joueurs par les sockets', async (count) => {
    await start({ botDelayMs: 0 });
    const { players } = await lobby(count);
    await players[0]!.emitWithAck('game:start', {});
    await waitFor(() => players.every((p) => p.game));

    // Partie publique de l'état, identique chez tous les joueurs une fois la diffusion terminée.
    const publicState = (p: Client) => {
      const { hand: _hand, you: _you, ...rest } = p.game!;
      return JSON.stringify(rest);
    };
    for (let steps = 0; players[0]!.game!.phase !== 'gameOver'; steps++) {
      expect(steps).toBeLessThan(20000);
      const before = publicState(players[0]!);
      await playBotTurn(players);
      await waitFor(() => publicState(players[0]!) !== before && players.every((p) => publicState(p) === publicState(players[0]!)));
    }
    expect(players.every((p) => p.game!.phase === 'gameOver')).toBe(true);

    // La partie terminée est ajoutée une seule fois à l'historique.
    const stats = await players[0]!.emitWithAck('stats:get');
    expect(stats.ok && stats.games.gof.recent).toHaveLength(1);
    expect(stats.ok && stats.games.gof.ranking).toHaveLength(count);
  }, 60000);

  it('fait jouer les bots tout seuls : un entraînement complet avec un humain et deux bots, qui ne compte pas', async () => {
    await start({ botDelayMs: 0 });
    const human = connect('Alice');
    const created = await human.emitWithAck('room:create', { training: true });
    if (!created.ok) throw new Error(created.error);
    const code = created.code;
    expect((await human.emitWithAck('room:addBot', {})).ok).toBe(true);
    expect((await human.emitWithAck('room:addBot', {})).ok).toBe(true);
    await waitFor(() => human.room?.players.length === 3);
    expect(human.room!.players.map((p) => p.bot)).toEqual([false, true, true]);
    await human.emitWithAck('game:start', {});
    await waitFor(() => !!human.game);

    // L'humain n'agit que quand c'est à lui (ou pour lancer la manche suivante) ; les bots enchaînent seuls.
    const seats = [human, human, human];
    const humanMustAct = (g: PlayerView) =>
      g.phase === 'roundOver' ||
      (g.phase === 'cut' && g.dealer === g.you) ||
      (g.phase === 'exchange' && g.exchange?.winnerIndex === g.you) ||
      (g.phase === 'playing' && g.currentPlayer === g.you);
    const over = () => human.game!.phase === 'gameOver';
    for (let steps = 0; !over(); steps++) {
      expect(steps).toBeLessThan(5000);
      await waitFor(() => over() || humanMustAct(human.game!), 5000);
      if (over()) break;
      const before = JSON.stringify(human.game);
      await playBotTurn(seats);
      await waitFor(() => JSON.stringify(human.game) !== before);
    }

    // L'entraînement n'est enregistré nulle part : ni classement, ni historique, ni expérience.
    const stats = await human.emitWithAck('stats:get');
    expect(stats.ok && stats.games.gof.recent).toEqual([]);
    expect(stats.ok && stats.games.gof.ranking).toEqual([]);
    expect(server.rooms.get(code)!.game!.phase).toBe('gameOver');

    // Revanche : nouvelle partie, mêmes joueurs, même score de fin.
    const target = (server.rooms.get(code)!.game as GameState).config.targetScore;
    expect((await human.emitWithAck('game:rematch')).ok).toBe(true);
    await waitFor(() => human.game!.phase !== 'gameOver');
    expect(human.game!.round).toBe(1);
    expect(human.game!.players.every((p) => p.score === 0)).toBe(true);
    expect((server.rooms.get(code)!.game as GameState).config.targetScore).toBe(target);
    expect(server.rooms.get(code)!.recorded).toBe(false);
  }, 60000);

  it('survit aux messages bizarres : sans réponse attendue, sans données, ou avec des données invalides', async () => {
    await start();
    const { players } = await lobby(3);
    const raw = players[1]! as unknown as { emit: (event: string, ...args: unknown[]) => void };
    // Ce qui a fait planter le site : un événement envoyé sans fonction de réponse.
    for (const event of ['room:create', 'room:join', 'room:rejoin', 'room:leave', 'room:addBot', 'room:removeBot', 'game:start', 'game:play', 'game:pass', 'game:cut', 'stats:get']) {
      raw.emit(event);
      raw.emit(event, null);
      raw.emit(event, 'n\'importe quoi', 42);
      raw.emit(event, { name: 12, code: {}, token: [], cardIds: 'm1', position: 'x' });
    }
    // Sans charge utile, la réponse arrive quand même (la fonction est alors le premier argument).
    const fresh = connect();
    const result = await (fresh as unknown as { emitWithAck: (e: string) => Promise<{ ok: boolean; error?: string }> }).emitWithAck('room:join');
    expect(result).toEqual({ ok: false, error: 'roomNotFound' });
    // Le serveur répond toujours.
    const stats = await players[0]!.emitWithAck('stats:get');
    expect(stats.ok).toBe(true);
  });

  it('retrouve les parties en cours après un redémarrage du serveur', async () => {
    const roomsFile = join(mkdtempSync(join(tmpdir(), 'gof-')), 'salons.json');
    await start({ roomsFile });
    const { code, players } = await lobby(3);
    await players[0]!.emitWithAck('game:start', {});
    await waitFor(() => players.every((p) => p.game));
    await playBotTurn(players);
    await waitFor(() => players[0]!.game!.phase !== 'cut' || players[0]!.game!.round > 1);
    const before = server.rooms.get(code)!.game as GameState;
    const session = { code, token: server.rooms.get(code)!.seats[1]!.token };

    // Arrêt « propre » comme alwaysData (SIGTERM), puis nouveau serveur sur le même fichier.
    server.saveRooms();
    clients.splice(0).forEach((c) => c.disconnect());
    await new Promise((resolve) => server.io.close(resolve));
    await start({ roomsFile });

    expect(server.rooms.get(code)!.game).toEqual(before);
    const back = connect();
    const rejoined = await back.emitWithAck('room:rejoin', session);
    expect(rejoined.ok).toBe(true);
    await waitFor(() => !!back.game);
    expect(back.game!.you).toBe(1);
    expect(back.game!.hand).toEqual(before.players[1]!.hand);
  });

  it('joue à la place d\'un joueur trop lent quand le minuteur est choisi', async () => {
    await start({ turnSecondMs: 10 });
    const { players } = await lobby(3);
    expect((await players[0]!.emitWithAck('game:start', { turnSeconds: 30 })).ok).toBe(true);
    await waitFor(() => players.every((p) => p.game && p.room?.turnRemainingMs !== null));
    expect(players[0]!.room!.turnSeconds).toBe(30);
    expect(players[0]!.room!.turnRemainingMs).toBeGreaterThan(250);
    // Une « seconde » du minuteur dure ici 10 ms : au bout de 300 ms, le serveur joue pour le joueur qui doit ouvrir.
    const code = players[0]!.room!.code;
    const before = (server.rooms.get(code)!.game as GameState).trick.length;
    await waitFor(() => (server.rooms.get(code)!.game as GameState).trick.length > before, 2000);
    // Et un nouveau tour relance le minuteur pour le joueur suivant.
    await waitFor(() => players.every((p) => p.room!.turnRemainingMs !== null && p.room!.turnRemainingMs > 250));
  });

  it('laisse le gagnant choisir sans minuteur la carte qu\'il rend pendant l\'échange', async () => {
    await start({ turnSecondMs: 10 });
    const { players } = await lobby(3);
    expect((await players[0]!.emitWithAck('game:start', { turnSeconds: 30 })).ok).toBe(true);
    await waitFor(() => players.every((p) => p.game));
    const code = players[0]!.room!.code;
    const game = server.rooms.get(code)!.game as GameState;
    // Échange arrangé : Alice a gagné la manche et doit rendre une carte à Bruno.
    const given = game.players[1]!.hand[0]!;
    Object.assign(game, { phase: 'exchange', currentPlayer: 0, exchange: { winnerIndex: 0, loserIndex: 1, loserCard: given } });
    // Une diffusion pour que tout le monde voie l'échange.
    expect((await players[0]!.emitWithAck('game:autoPass', { enabled: true })).ok).toBe(true);
    await waitFor(() => players.every((p) => p.game!.phase === 'exchange'));
    expect(players.every((p) => p.room!.turnRemainingMs === null)).toBe(true);
    // Bien plus que les 30 « secondes » (300 ms ici) : personne n'a joué à la place d'Alice.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(server.rooms.get(code)!.game!.phase).toBe('exchange');
  });

  it('fait passer tout seul un joueur qui ne peut rien poser (s\'il l\'a activé), mais jamais quand il ouvre', async () => {
    await start({ botDelayMs: 50 });
    const { code, players } = await lobby(3);
    await players[0]!.emitWithAck('game:start', {});
    await waitFor(() => players.every((p) => p.game));
    // Partie arrangée : Alice ouvre avec le dragon, le joueur suivant n'a que des petites cartes isolées.
    const game = server.rooms.get(code)!.game as GameState;
    const deck = createDeck();
    const cards = (...ids: string[]) => ids.map((id) => deck.find((c) => c.id === id)!);
    const next = (0 + game.direction + 3) % 3;
    const last = (next + game.direction + 3) % 3;
    Object.assign(game, { phase: 'playing', currentPlayer: 0, table: null, trick: [], passed: [false, false, false], mustPlayMultiOne: false, exchange: null });
    game.players[0]!.hand = cards('rD', 'g2a', 'g3a');
    game.players[next]!.hand = cards('g1a', 'y4a', 'r6b');
    game.players[last]!.hand = cards('y7a', 'r8a', 'g9b');
    // L'option est coupée par défaut : le serveur laisse le joueur suivant décider.
    expect(players[0]!.room!.players.every((p) => p.autoPass === false)).toBe(true);
    expect((await players[last]!.emitWithAck('game:autoPass', { enabled: true })).ok).toBe(true);
    await waitFor(() => players[0]!.room!.players[last]!.autoPass === true);
    expect((await players[0]!.emitWithAck('game:play', { cardIds: ['rD'] })).ok).toBe(true);
    const now = () => server.rooms.get(code)!.game as GameState;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(now().currentPlayer).toBe(next);
    // Il l'active à son tour : les deux autres passent sans rien faire, et Alice reprend la main pour ouvrir.
    expect((await players[next]!.emitWithAck('game:autoPass', { enabled: true })).ok).toBe(true);
    await waitFor(() => now().table === null && now().currentPlayer === 0, 2000);
    expect(now().trick.map((e) => e.combination === null)).toEqual([false, true, true]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(now().currentPlayer).toBe(0);
    expect(now().players[0]!.hand).toHaveLength(2);
  });

  it("laisse l'hôte mettre la partie en pause : rien ne bouge, le minuteur est gelé, puis tout reprend", async () => {
    await start({ turnSecondMs: 10, botDelayMs: 5, cutPauseMs: 0 });
    const { code, players } = await lobby(3);
    const [host, bruno] = players;
    expect((await host!.emitWithAck('game:start', { turnSeconds: 30 })).ok).toBe(true);
    await waitFor(() => players.every((p) => p.game && p.room?.turnRemainingMs !== null));

    expect(await bruno!.emitWithAck('room:pause', { paused: true })).toEqual({ ok: false, error: 'notHost' });
    expect(await host!.emitWithAck('room:pause', { paused: true })).toEqual({ ok: true });
    await waitFor(() => players.every((p) => p.room!.paused));
    const frozen = bruno!.room!.turnRemainingMs!;
    const before = JSON.stringify(server.rooms.get(code)!.game);
    // Bien plus que les 300 ms du minuteur : personne ne joue à la place de personne.
    await new Promise((r) => setTimeout(r, 500));
    expect(JSON.stringify(server.rooms.get(code)!.game)).toBe(before);
    const toAct = server.rooms.seatToAct(code)!;
    const actor = players[server.rooms.get(code)!.seats.indexOf(toAct)]!;
    expect(await actor.emitWithAck('game:cut', { position: 20 })).toEqual({ ok: false, error: 'paused' });
    expect(await actor.emitWithAck('game:pass')).toEqual({ ok: false, error: 'paused' });

    // Reprise : le minuteur repart du temps qu'il restait, puis le serveur joue pour le joueur trop lent.
    expect(await host!.emitWithAck('room:pause', { paused: false })).toEqual({ ok: true });
    await waitFor(() => !bruno!.room!.paused);
    expect(bruno!.room!.turnRemainingMs).toBeLessThanOrEqual(frozen);
    await waitFor(() => JSON.stringify(server.rooms.get(code)!.game) !== before, 2000);
  });

  it('ferme aussi une partie en pause que tout le monde a quittée', async () => {
    await start({ abandonDelayMs: 50 });
    const { code, players } = await lobby(3);
    await players[0]!.emitWithAck('game:start', {});
    expect(await players[0]!.emitWithAck('room:pause', { paused: true })).toEqual({ ok: true });
    players.forEach((p) => p.disconnect());
    await waitFor(() => !server.rooms.get(code));
  });

  it('guide le joueur pas à pas dans le tutoriel, sans rien enregistrer', async () => {
    await start({ botDelayMs: 0 });
    const alice = connect('Alice');
    const session = await alice.emitWithAck('tutorial:start');
    if (!session.ok) throw new Error(session.error);
    await waitFor(() => !!alice.room?.tutorial?.coach);
    expect(alice.room!.tutorial).toMatchObject({ expect: ['m1'], step: 1, total: 7 });
    // Un autre coup que celui prévu est refusé.
    const other = alice.game!.hand.find((c) => c.id !== 'm1')!;
    expect(await alice.emitWithAck('game:play', { cardIds: [other.id] })).toEqual({ ok: false, error: 'tutorialMove' });
    expect(await alice.emitWithAck('rooms:live')).toEqual({ ok: true, rooms: [] });
    const over = () => alice.game?.phase === 'gameOver';
    for (let steps = 0; !over(); steps++) {
      expect(steps).toBeLessThan(20);
      await waitFor(() => over() || !!alice.room?.tutorial?.expect, 5000);
      const wanted = alice.room!.tutorial!.expect;
      if (over() || !wanted) break;
      const before = alice.room!.tutorial!.step;
      expect(await alice.emitWithAck('game:play', { cardIds: [...wanted].reverse() })).toEqual({ ok: true });
      await waitFor(() => over() || alice.room!.tutorial!.step !== before || !alice.room!.tutorial!.expect);
    }
    await waitFor(() => alice.game?.phase === 'gameOver');
    expect(alice.game!.winners).toEqual([0]);
    expect(server.history.recent()).toEqual([]);
    expect(await alice.emitWithAck('game:rematch')).toEqual({ ok: false, error: 'tutorialMove' });
  }, 20000);

  it('relaie les réactions à toute la table, seulement celles de la liste et sans inonder', async () => {
    await start();
    const { players } = await lobby(3);
    const received: string[] = [];
    players[1]!.on('room:reaction', (r) => received.push(`${r.playerId === players[0]!.room!.hostId ? 'hôte' : '?'} ${r.emoji}`));
    expect(await players[0]!.emitWithAck('room:react', { emoji: '😂' })).toEqual({ ok: true });
    await waitFor(() => received.length === 1);
    expect(received).toEqual(['hôte 😂']);
    expect(await players[0]!.emitWithAck('room:react', { emoji: '<b>' })).toEqual({ ok: false, error: 'emptyMessage' });
    for (let i = 0; i < 3; i++) await players[0]!.emitWithAck('room:react', { emoji: '👍' });
    expect(await players[0]!.emitWithAck('room:react', { emoji: '👍' })).toEqual({ ok: false, error: 'slowDown' });
    expect(await connect().emitWithAck('room:react', { emoji: '👍' })).toEqual({ ok: false, error: 'notInRoom' });
  });

  it("ne laisse choisir que les récompenses débloquées, et montre cadre et titre à la table", async () => {
    await start();
    const alice = connect('Alice');
    await waitFor(() => alice.connected);
    // Niveau 1 : le tapis vert et le titre « Débutant », mais pas encore de cadre ni de tapis bleu nuit.
    expect(await alice.emitWithAck('account:cosmetics', { felt: 'nuit', frame: '', title: '' })).toEqual({ ok: false, error: 'locked' });
    expect(await alice.emitWithAck('account:cosmetics', { felt: '', frame: 'or', title: '' })).toEqual({ ok: false, error: 'locked' });
    expect(await alice.emitWithAck('account:cosmetics', { felt: '', frame: '', title: 'Parrain' })).toEqual({ ok: false, error: 'locked' });
    const chosen = await alice.emitWithAck('account:cosmetics', { felt: 'vert', frame: '', title: 'Débutant' });
    expect(chosen).toMatchObject({ ok: true, account: { felt: 'vert', title: 'Débutant' } });
    // Un cadre débloqué (posé ici directement) se voit, avec le titre, sur sa place à la table.
    server.accounts.update(server.accounts.byName('Alice')!.id, { cosmetics: { felt: 'vert', frame: 'bronze', title: 'Débutant' } });
    await alice.emitWithAck('room:create', {});
    await waitFor(() => !!alice.room);
    expect(alice.room!.players[0]).toMatchObject({ frame: 'bronze', title: 'Débutant' });
  });

  it('retire au démarrage les récompenses qui ne sont plus débloquées', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gof-comptes-')), 'comptes.json');
    await start({ accountsFile: file });
    server.accounts.signIn({ sub: 'g-1', email: 'a@exemple.fr' });
    server.accounts.update('g-1', { name: 'Alice', cosmetics: { felt: 'onyx', frame: 'or', title: 'Débutant' } });
    await new Promise((resolve) => server.io.close(resolve));
    await start({ accountsFile: file });
    expect(server.accounts.get('g-1')).toMatchObject({ title: 'Débutant' });
    expect(server.accounts.get('g-1')).not.toHaveProperty('felt');
    expect(server.accounts.get('g-1')).not.toHaveProperty('frame');
  });

  it('ne lance pas de minuteur par défaut', async () => {
    await start();
    const { players } = await lobby(3);
    await players[0]!.emitWithAck('game:start', {});
    await waitFor(() => players.every((p) => p.game));
    expect(players[0]!.room).toMatchObject({ turnSeconds: 0, turnRemainingMs: null });
  });

  it('donne la fiche d\'un joueur', async () => {
    await start();
    const client = connect();
    const result = await client.emitWithAck('stats:player', { name: 'Personne' });
    expect(result).toEqual({ ok: true, profile: null });
  });
});
