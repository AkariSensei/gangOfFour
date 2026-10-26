import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlayerView } from '@gof/engine';
import { type Socket, io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { type ClientToServerEvents, type GameServer, type RoomView, type ServerToClientEvents, createGameServer } from '../src';
import { playBotTurn } from '../scripts/bot';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { room?: RoomView; game?: PlayerView };

let server: GameServer;
const clients: Client[] = [];

async function start(options = {}) {
  server = createGameServer(options);
  await new Promise<void>((resolve) => server.http.listen(0, resolve));
}

function connect(): Client {
  const { port } = server.http.address() as AddressInfo;
  const client: Client = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
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
  const host = connect();
  const created = await host.emitWithAck('room:create', { name: 'Alice' });
  if (!created.ok) throw new Error(created.error);
  const players = [host];
  for (const name of ['Bruno', 'Chloé', 'David'].slice(0, count - 1)) {
    const c = connect();
    const joined = await c.emitWithAck('room:join', { code: created.code, name });
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

  it('supprime un salon abandonné après le délai', async () => {
    await start({ abandonDelayMs: 50 });
    const { code, players } = await lobby(3);
    await players[0]!.emitWithAck('game:start', {});
    players.forEach((p) => p.disconnect());
    await waitFor(() => server.rooms.get(code) === undefined);
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
    for (let i = 0; i < 3; i++) results.push(await spammer.emitWithAck('room:create', { name: 'Spam' }));
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(results[2]).toEqual({ ok: false, error: 'slowDown' });

    // Une autre connexion de la même adresse n'a plus droit qu'à un salon.
    const other = connect();
    expect((await other.emitWithAck('room:create', { name: 'Bob' })).ok).toBe(true);
    expect(await other.emitWithAck('room:create', { name: 'Bob' })).toEqual({ ok: false, error: 'slowDown' });
    // Rejoindre un salon reste possible.
    const code = (results[1] as { code: string }).code;
    expect((await connect().emitWithAck('room:join', { code, name: 'Chloé' })).ok).toBe(true);
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
    const outsider = connect();
    await outsider.emitWithAck('room:create', { name: 'Zoé' });
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

  it('refuse de nouveaux salons au-delà du maximum', async () => {
    await start({ limits: { maxRooms: 2 } });
    expect((await connect().emitWithAck('room:create', { name: 'A' })).ok).toBe(true);
    expect((await connect().emitWithAck('room:create', { name: 'B' })).ok).toBe(true);
    expect(await connect().emitWithAck('room:create', { name: 'C' })).toEqual({ ok: false, error: 'tooManyRooms' });
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
    await start();
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
    expect((await human.emitWithAck('room:addBot')).ok).toBe(true);
    expect((await human.emitWithAck('room:addBot')).ok).toBe(true);
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

    const stats = await human.emitWithAck('stats:get');
    expect(stats.ok && stats.recent).toHaveLength(1);
    expect(stats.ok && stats.leaderboard.map((e) => e.name)).toEqual(['Alice']);
    expect(server.rooms.get(code)!.game!.phase).toBe('gameOver');
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
    expect(result).toEqual({ ok: false, error: 'invalidName' });
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
