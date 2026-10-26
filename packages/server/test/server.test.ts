import type { AddressInfo } from 'node:net';
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
    expect(await players[0]!.emitWithAck('game:start')).toEqual({ ok: true });
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
    await players[0]!.emitWithAck('game:start');
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
    players.forEach((p) => p.disconnect());
    await waitFor(() => server.rooms.get(code) === undefined);
  });

  it.each([3, 4])('joue une partie complète à %i joueurs par les sockets', async (count) => {
    await start();
    const { players } = await lobby(count);
    await players[0]!.emitWithAck('game:start');
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
  }, 60000);
});
