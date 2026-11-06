import { useEffect, useState } from 'react';
import { GAMES } from '../../server/src/protocol';
import { pointsFormat } from './Leaderboard';
import { socket } from './socket';

type Change = { game: string; before: number; after: number; format?: string };

/** Ce que la dernière partie a rapporté en points ; oublié quand une nouvelle partie commence (`active` à faux). */
export function useRatingChange(active: boolean): Change | null {
  const [change, setChange] = useState<Change | null>(null);
  useEffect(() => {
    socket.on('rating:changed', setChange);
    return () => {
      socket.off('rating:changed', setChange);
    };
  }, []);
  useEffect(() => {
    if (!active) setChange(null);
  }, [active]);
  return change;
}

/** « +24 points en blitz · 1 024 » : le gain (ou la perte) de la partie, dans quel format, et les points de la saison. */
export function RatingChange({ change }: { change: Change | null }) {
  if (!change) return null;
  const delta = change.after - change.before;
  const phrase = GAMES.find((g) => g.id === change.game)?.formats?.find((f) => f.id === change.format)?.phrase;
  return (
    <p className={`rating-change ${delta >= 0 ? 'up' : 'down'}`}>
      <strong>
        {delta >= 0 ? '+' : '−'}
        {Math.abs(delta)} point{Math.abs(delta) > 1 ? 's' : ''}
        {phrase ? ` ${phrase}` : ''}
      </strong>
      <span>{pointsFormat.format(change.after)} cette saison</span>
    </p>
  );
}
