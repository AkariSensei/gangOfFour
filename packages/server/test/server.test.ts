import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PlayerView, createDeck } from '@gof/engine';
import { type Socket, io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { type ClientToServerEvents, type GameServer, type GameServerOptions, type RoomView, type ServerToClientEvents, createGameServer } from '../src';
import { playBotTurn } from '../scripts/bot';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { room?: RoomView; game?: PlayerView };

let server: GameServer;
const clients: Client[] = [];

// Les parties de test enchaînent les coups bien plus vite qu'un humain : on lève la limite d'événements,
// vérifiée à part dans son propre test.
async function start(options: GameServerOptions = {}) {
  server = createGameServer({ ...options, limits: { eventsPerSocket: Infinity, ...options.limits } });
  await new Promise<void>((resolve) => server.http.listen(0, resolve));
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
  client.on('game:state', (game) => (client.game = game));
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
  const created = await host.emitWithAck('room:create');
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
    const created = await host.emitWithAck('room:create');
    if (!created.ok) throw new Error(created.error);
    const session = (host.auth as { session: string }).session;
    const otherBrowser = connectWith({ session });
    expect(await otherBrowser.emitWithAck('room:join', { code: created.code })).toEqual({ ok: false, error: 'alreadySeated' });
    expect((await connect('Bruno').emitWithAck('room:join', { code: created.code })).ok).toBe(true);

    server.accounts.signIn({ sub: 'chef', email: 'chef@exemple.fr' });
    server.accounts.update('chef', { name: 'Maître' });
    const admin = { session: server.accounts.session('chef') };
    const adminRoom = await connectWith(admin).emitWithAck('room:create');
    if (!adminRoom.ok) throw new Error(adminRoom.error);
    expect((await connectWith(admin).emitWithAck('room:join', { code: adminRoom.code })).ok).toBe(true);
    // Le second siège de l'admin n'est pas rattaché à son compte : il ne compte pas deux fois au classement.
    expect(server.rooms.get(adminRoom.code)!.seats.map((s) => s.account)).toEqual(['chef', undefined]);
  });

  it('demande un compte avec un pseudo pour jouer, mais pas pour regarder', async () => {
    await start();
    const guest = connect(null);
    expect(await guest.emitWithAck('room:create')).toEqual({ ok: false, error: 'notSignedIn' });
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
    expect(await client.emitWithAck('room:create')).toEqual({ ok: false, error: 'noName' });

    connect('Alice');
    expect(await client.emitWithAck('account:update', { name: ' alice ' })).toEqual({ ok: false, error: 'nameTaken' });
    expect(await client.emitWithAck('account:update', { name: 'Camille', avatar: '🦊', color: 'pas une couleur' })).toMatchObject({
      ok: true,
      account: { name: 'Camille', avatar: '🦊' },
    });
    expect((await client.emitWithAck('room:create')).ok).toBe(true);
    expect(server.rooms.all()[0]!.seats[0]).toMatchObject({ name: 'Camille', avatar: '🦊', account: 'ok-camille' });

    // La session remise suffit à se reconnecter depuis un autre onglet.
    const again = connectWith({ session: signed.session });
    expect(await again.emitWithAck('account:get')).toMatchObject({ account: { name: 'Camille' }, googleClientId: 'client-test' });
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
    expect(await player.emitWithAck('room:create')).toEqual({ ok: false, error: 'notSignedIn' });
    expect(server.accounts.get(id)).toMatchObject({ name: 'Poli', blocked: true });
    expect(await player.emitWithAck('admin:resetRanking')).toEqual({ ok: false, error: 'notAdmin' });
    expect(await admin.emitWithAck('admin:unrank', { id: 'personne' })).toEqual({ ok: false, error: 'accountNotFound' });
    expect(await admin.emitWithAck('admin:unrank', { id })).toEqual({ ok: true });
    const changed = new Promise<void>((resolve) => player.once('stats:changed', resolve));
    expect(await admin.emitWithAck('admin:resetRanking')).toEqual({ ok: true });
    await changed; // l'accueil de chacun recharge le classement
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
    expect((await waiting.players[0]!.emitWithAck('room:addBot', {})).ok).toBe(true);
    expect((await waiting.players[0]!.emitWithAck('room:leave')).ok).toBe(true);
    expect(server.rooms.get(waiting.code)).toBeUndefined();

    // Partie lancée : tant qu'un joueur reste, elle continue ; quand le dernier quitte, elle est supprimée.
    const playing = await lobby(2);
    expect((await playing.players[0]!.emitWithAck('room:addBot', {})).ok).toBe(true);
    await waitFor(() => playing.players[0]!.room?.players.length === 3);
    await playing.players[0]!.emitWithAck('game:start', {});
    await waitFor(() => playing.players.every((p) => p.game));
    expect((await playing.players[0]!.emitWithAck('room:leave')).ok).toBe(true);
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
    for (let i = 0; i < 3; i++) results.push(await spammer.emitWithAck('room:create'));
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(results[2]).toEqual({ ok: false, error: 'slowDown' });

    // Une autre connexion de la même adresse n'a plus droit qu'à un salon.
    const other = connect();
    expect((await other.emitWithAck('room:create')).ok).toBe(true);
    expect(await other.emitWithAck('room:create')).toEqual({ ok: false, error: 'slowDown' });
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
    expect(await watcher.emitWithAck('game:pass')).toEqual({ ok: false, error: 'notInRoom' });

    watcher.disconnect();
    await waitFor(() => players.every((p) => p.room?.spectators === 0));
    expect(server.rooms.get(code)!.seats).toHaveLength(3);
  });

  it('relaie le chat aux joueurs du salon seulement, sans rien garder', async () => {
    await start();
    const { players } = await lobby(3);
    const outsider = connect('Zoé');
    await outsider.emitWithAck('room:create');
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
    expect((await connect().emitWithAck('room:create')).ok).toBe(true);
    expect((await connect().emitWithAck('room:create')).ok).toBe(true);
    expect(await connect().emitWithAck('room:create')).toEqual({ ok: false, error: 'tooManyRooms' });
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
    expect(stats.ok && stats.recent).toHaveLength(1);
    expect(stats.ok && stats.leaderboard).toHaveLength(count);
  }, 60000);

  it('fait jouer les bots tout seuls : une partie complète avec un humain et deux bots', async () => {
    await start({ botDelayMs: 0 });
    const { code, players } = await lobby(1);
    const human = players[0]!;
    expect((await human.emitWithAck('room:addBot', {})).ok).toBe(true);
    expect((await human.emitWithAck('room:addBot', {})).ok).toBe(true);
    await waitFor(() => human.room?.players.length === 3);
    expect(human.room!.players.map((p) => p.bot)).toEqual([false, true, true]);
    const badges: string[] = [];
    human.on('badges:won', (won) => badges.push(...won.map((b) => b.id)));
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

    const stats = await human.emitWithAck('stats:get');
    expect(stats.ok && stats.recent).toHaveLength(1);
    // Seule contre des bots : la partie compte dans le classement « contre les bots », pas dans celui en ligne.
    expect(stats.ok && stats.botLeaderboard.map((e) => e.name)).toEqual(['Alice']);
    expect(stats.ok && stats.leaderboard).toEqual([]);
    expect(server.rooms.get(code)!.game!.phase).toBe('gameOver');
    // Sa première partie terminée lui fait gagner « Bienvenue », annoncé tout de suite (une seule fois).
    await waitFor(() => badges.includes('games-1'));
    expect(badges.filter((id) => id === 'games-1')).toHaveLength(1);

    // Revanche : nouvelle partie, mêmes joueurs, même score de fin, et elle sera enregistrée à son tour.
    const target = server.rooms.get(code)!.game!.config.targetScore;
    expect((await human.emitWithAck('game:rematch')).ok).toBe(true);
    await waitFor(() => human.game!.phase !== 'gameOver');
    expect(human.game!.round).toBe(1);
    expect(human.game!.players.every((p) => p.score === 0)).toBe(true);
    expect(server.rooms.get(code)!.game!.config.targetScore).toBe(target);
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
    const before = server.rooms.get(code)!.game!;
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
    const before = server.rooms.get(code)!.game!.trick.length;
    await waitFor(() => server.rooms.get(code)!.game!.trick.length > before, 2000);
    // Et un nouveau tour relance le minuteur pour le joueur suivant.
    await waitFor(() => players.every((p) => p.room!.turnRemainingMs !== null && p.room!.turnRemainingMs > 250));
  });

  it('annonce un badge au moment où il est gagné, en pleine partie (un gang posé)', async () => {
    await start();
    const { code, players } = await lobby(3);
    const badges: string[][] = players.map(() => []);
    players.forEach((p, i) => p.on('badges:won', (won) => badges[i]!.push(...won.map((b) => b.id))));
    await players[0]!.emitWithAck('game:start', {});
    await waitFor(() => players.every((p) => p.game));
    // Partie arrangée : Alice ouvre un nouveau pli et a un gang de 5 en main.
    const game = server.rooms.get(code)!.game!;
    const deck = createDeck();
    const cards = (...ids: string[]) => ids.map((id) => deck.find((c) => c.id === id)!);
    Object.assign(game, { phase: 'playing', currentPlayer: 0, table: null, trick: [], passed: [false, false, false], mustPlayMultiOne: false, exchange: null });
    game.players[0]!.hand = cards('g5a', 'y5a', 'r5a', 'g5b', 'g2a', 'g3a');
    expect((await players[0]!.emitWithAck('game:play', { cardIds: ['g5a', 'y5a', 'r5a', 'g5b'] })).ok).toBe(true);
    await waitFor(() => badges[0]!.includes('gang-1'));
    expect(server.rooms.get(code)!.game!.phase).toBe('playing');
    // Une seule annonce, même quand la table est rediffusée ensuite, et rien pour ceux qui n'ont pas posé de gang.
    expect((await players[1]!.emitWithAck('game:autoPass', { enabled: true })).ok).toBe(true);
    await waitFor(() => players[0]!.room!.players[1]!.autoPass === true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(badges[0]).toEqual(['gang-1']);
    expect(badges[1]).toEqual([]);
  });

  it('laisse le gagnant choisir sans minuteur la carte qu\'il rend pendant l\'échange', async () => {
    await start({ turnSecondMs: 10 });
    const { players } = await lobby(3);
    expect((await players[0]!.emitWithAck('game:start', { turnSeconds: 30 })).ok).toBe(true);
    await waitFor(() => players.every((p) => p.game));
    const code = players[0]!.room!.code;
    const game = server.rooms.get(code)!.game!;
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
    const game = server.rooms.get(code)!.game!;
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
    const now = () => server.rooms.get(code)!.game!;
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

  it('fait relever le défi du jour une seule fois, sur la même donne pour tous, sans spectateur', async () => {
    await start();
    const [alice, bruno, curieux] = [connect('Alice'), connect('Bruno'), connect('Curieux')];
    const first = await alice.emitWithAck('challenge:start');
    if (!first.ok) throw new Error(first.error);
    expect(await bruno.emitWithAck('challenge:start')).toMatchObject({ ok: true });
    await waitFor(() => !!alice.game && !!bruno.game);
    expect(alice.game!.hand).toEqual(bruno.game!.hand);
    expect(alice.room!.challenge).toEqual({ day: expect.any(String), moves: 0 });
    expect(alice.room!.players.filter((p) => p.bot).map((p) => p.level)).toEqual(['hard', 'hard', 'hard']);

    expect(await alice.emitWithAck('challenge:start')).toEqual({ ok: false, error: 'challengeAlreadyPlayed' });
    expect(await curieux.emitWithAck('room:watch', { code: first.code })).toEqual({ ok: false, error: 'roomNotFound' });
    expect(await curieux.emitWithAck('rooms:live')).toEqual({ ok: true, rooms: [] });
    expect(await curieux.emitWithAck('challenge:get')).toMatchObject({ ok: true, challenge: { mine: null, today: [] } });
    expect(await alice.emitWithAck('challenge:get')).toMatchObject({ ok: true, challenge: { mine: { finished: false } } });
  });

  it('termine le défi avec la manche, le classe à part et annonce ses badges', async () => {
    await start({ botDelayMs: 0 });
    const alice = connect('Alice');
    const won: string[] = [];
    alice.on('badges:won', (badges) => won.push(...badges.map((b) => b.id)));
    await alice.emitWithAck('challenge:start');
    const over = () => alice.game?.phase === 'gameOver';
    for (let steps = 0; !over(); steps++) {
      expect(steps).toBeLessThan(500);
      await waitFor(() => over() || (alice.game?.phase === 'playing' && alice.game.currentPlayer === 0), 5000);
      if (over()) break;
      const before = JSON.stringify(alice.game);
      await playBotTurn([alice]);
      await waitFor(() => JSON.stringify(alice.game) !== before);
    }
    const result = await alice.emitWithAck('challenge:get');
    if (!result.ok) throw new Error(result.error);
    const mine = result.challenge.mine!;
    expect(mine).toMatchObject({ finished: true, rank: 1, moves: alice.room!.challenge!.moves, cardsLeft: alice.game!.hand.length });
    expect(mine.won).toBe(alice.game!.lastRound!.winnerIndex === 0);
    expect(result.challenge.today).toEqual([{ rank: 1, name: 'Alice', won: mine.won, moves: mine.moves, cardsLeft: mine.cardsLeft }]);
    expect(result.challenge.overall).toEqual([{ name: 'Alice', played: 1, wins: mine.won ? 1 : 0, bestStreak: 1 }]);
    // Le défi n'entre pas dans l'historique des parties, et la revanche est refusée.
    expect(server.history.recent()).toEqual([]);
    expect(await alice.emitWithAck('game:rematch')).toEqual({ ok: false, error: 'challengeAlreadyPlayed' });
    await waitFor(() => won.includes('challenge-1'));
    expect(won.includes('challenge-win-1')).toBe(!!mine.won);
  }, 30000);

  it("consomme l'essai du jour quand le joueur quitte le défi en cours", async () => {
    await start();
    const alice = connect('Alice');
    await alice.emitWithAck('challenge:start');
    await waitFor(() => !!alice.game);
    await alice.emitWithAck('room:leave');
    const result = await alice.emitWithAck('challenge:get');
    expect(result).toMatchObject({ ok: true, challenge: { mine: { finished: true, won: false, cardsLeft: 16 } } });
    expect(await alice.emitWithAck('challenge:start')).toEqual({ ok: false, error: 'challengeAlreadyPlayed' });
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
