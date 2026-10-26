import { type Card, type PlayerView, analyzeCombination, canBeat } from '@gof/engine';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../src';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { game?: PlayerView };

/** Première combinaison de plusieurs cartes trouvée dans la main (paire, suite, couleur…), ou null. */
function firstCombination(hand: Card[]): string[] | null {
  const pick = (start: number, chosen: Card[], size: number): Card[] | null => {
    if (chosen.length === size) return analyzeCombination(chosen) ? chosen : null;
    for (let i = start; i < hand.length; i++) {
      const found = pick(i + 1, [...chosen, hand[i]!], size);
      if (found) return found;
    }
    return null;
  };
  for (let size = 2; size <= Math.min(hand.length, 5); size++) {
    const found = pick(0, [], size);
    if (found) return found.map((c) => c.id);
  }
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
  const { hand, table, mustPlayMultiOne, phase, direction, deckSize } = client.game!;
  if (phase === 'cut') {
    const result = await client.emitWithAck('game:cut', { position: Math.floor(deckSize / 2) });
    if (!result.ok) throw new Error(result.error);
    return;
  }
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
    const ids = (lastCard && firstCombination(hand)) || [hand[lastCard ? hand.length - 1 : 0]!.id];
    const result = await client.emitWithAck('game:play', { cardIds: ids });
    if (!result.ok) throw new Error(result.error);
    return;
  }
  const candidates = lastCard ? [hand[hand.length - 1]!] : hand;
  const card = candidates.find((c) => canBeat(analyzeCombination([c])!, table.combination));
  const result = card
    ? await client.emitWithAck('game:play', { cardIds: [card.id] })
    : await client.emitWithAck('game:pass');
  if (!result.ok) throw new Error(result.error);
}
