import { type Card, type PlayerView, analyzeCombination, canBeat } from '@gof/engine';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../src';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { game?: PlayerView };

function firstPair(hand: Card[]): string[] | null {
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      if (analyzeCombination([hand[i]!, hand[j]!])) return [hand[i]!.id, hand[j]!.id];
  return null;
}

/** Fait jouer le joueur dont c'est le tour, avec une stratégie naïve : la plus petite carte seule possible. */
export async function playBotTurn(players: Client[]): Promise<void> {
  const view = players[0]!.game!;
  if (view.phase === 'roundOver') {
    await players[0]!.emitWithAck('game:nextRound');
    return;
  }
  const client = players[view.currentPlayer]!;
  const { hand, table, mustPlayMultiOne, phase, direction } = client.game!;
  if (phase === 'exchange') {
    await client.emitWithAck('game:giveCard', { cardId: hand[0]!.id });
    return;
  }
  if (mustPlayMultiOne) {
    await client.emitWithAck('game:play', { cardIds: ['m1'] });
    return;
  }
  const n = view.players.length;
  const lastCard = view.players[(view.currentPlayer + direction + n) % n]!.cardCount === 1;
  if (!table) {
    const ids = (lastCard && firstPair(hand)) || [hand[lastCard ? hand.length - 1 : 0]!.id];
    await client.emitWithAck('game:play', { cardIds: ids });
    return;
  }
  const candidates = lastCard ? [hand[hand.length - 1]!] : hand;
  const card = candidates.find((c) => canBeat(analyzeCombination([c])!, table.combination));
  const result = card
    ? await client.emitWithAck('game:play', { cardIds: [card.id] })
    : await client.emitWithAck('game:pass');
  if (!result.ok) throw new Error(result.error);
}
