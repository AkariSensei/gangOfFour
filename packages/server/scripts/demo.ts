/**
 * Démo sans interface : lance le serveur, connecte des joueurs automatiques par WebSocket
 * et affiche le déroulement d'une partie complète. Usage : npm run demo -- [3|4]
 */
import type { AddressInfo } from 'node:net';
import type { Card, PlayerView } from '@gof/engine';
import { io } from 'socket.io-client';
import { createGameServer } from '../src';
import { playBotTurn } from './bot';

const count = Number(process.argv[2] ?? 4) === 3 ? 3 : 4;
const names = ['Alice', 'Bruno', 'Chloé', 'David'].slice(0, count);
const COLORS: Record<Card['color'], string> = { green: 'vert', yellow: 'jaune', red: 'rouge', multi: 'multicolore' };

const label = (c: Card) => (c.value === 12 ? 'Dragon' : c.value === 11 ? `Phénix ${COLORS[c.color]}` : `${c.value} ${COLORS[c.color]}`);

const server = createGameServer();
await new Promise<void>((resolve) => server.http.listen(0, resolve));
const { port } = server.http.address() as AddressInfo;
console.log(`Serveur lancé sur le port ${port}, ${count} joueurs automatiques se connectent…\n`);

type Client = ReturnType<typeof io> & { game?: PlayerView };
// Chaque joueur automatique a son compte, créé directement sur le serveur (sans passer par Google).
const players: Client[] = names.map((name, i) => {
  server.accounts.signIn({ sub: `demo-${i}`, email: `demo-${i}@exemple.fr` });
  server.accounts.update(`demo-${i}`, { name });
  const auth = { session: server.accounts.session(`demo-${i}`) };
  const c: Client = io(`http://localhost:${port}`, { transports: ['websocket'], auth });
  c.on('game:state', (g: PlayerView) => (c.game = g));
  return c;
});

const created = await players[0]!.emitWithAck('room:create');
if (!created.ok) throw new Error(created.error);
console.log(`Salon ${created.code} créé par ${names[0]}`);
for (let i = 1; i < count; i++) {
  await players[i]!.emitWithAck('room:join', { code: created.code });
  console.log(`${names[i]} rejoint le salon`);
}
await players[0]!.emitWithAck('game:start', {});

const wait = () => new Promise((r) => setTimeout(r, 1));
while (!players.every((p) => p.game)) await wait();

const publicState = (p: Client) => {
  const { hand: _h, you: _y, ...rest } = p.game!;
  return JSON.stringify(rest);
};

let round = 0;
while (players[0]!.game!.phase !== 'gameOver') {
  const view = players[0]!.game!;
  if (view.round !== round) {
    round = view.round;
    console.log(`\n=== Manche ${round} (sens ${view.direction === 1 ? 'antihoraire' : 'horaire'}) ===`);
  }
  const before = publicState(players[0]!);
  const actorHand = players[view.currentPlayer]!.game!.hand;
  await playBotTurn(players);
  while (publicState(players[0]!) === before || !players.every((p) => publicState(p) === publicState(players[0]!))) await wait();

  const after = players[0]!.game!;
  const actor = names[view.currentPlayer];
  if (view.phase === 'exchange' && after.exchange?.winnerCard) {
    const ex = after.exchange;
    console.log(`Échange : ${names[ex.loserIndex]} donne ${label(ex.loserCard)}, ${names[ex.winnerIndex]} rend ${label(ex.winnerCard!)}`);
  } else if (view.phase === 'playing') {
    const remaining = new Set(players[view.currentPlayer]!.game!.hand.map((c) => c.id));
    const cards = actorHand.filter((c) => !remaining.has(c.id));
    if (cards.length > 0) {
      console.log(`${actor} joue ${cards.map(label).join(', ')}`);
    } else {
      console.log(`${actor} passe`);
    }
  }
  if (after.phase !== 'playing' && after.phase !== 'exchange' && after.lastRound && view.phase === 'playing') {
    const r = after.lastRound;
    console.log(`→ ${names[r.winnerIndex]} remporte la manche. Pénalités : ${r.penalties.map((p, i) => `${names[i]} +${p}`).join(', ')}`);
    console.log(`  Scores : ${after.players.map((p) => `${p.name} ${p.score}`).join(', ')}`);
  }
}

const final = players[0]!.game!;
console.log(`\nPartie terminée ! Gagnant(s) : ${final.winners.map((i) => names[i]).join(', ')}`);
players.forEach((p) => p.disconnect());
server.io.close();
process.exit(0);
