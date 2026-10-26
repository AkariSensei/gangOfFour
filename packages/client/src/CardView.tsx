import type { Card } from '@gof/engine';
import { cardLabel } from './labels';

function face(card: Card): string {
  if (card.value === 12) return '🐉';
  if (card.value === 11) return '🔥';
  return String(card.value);
}

export function CardView({
  card,
  selected,
  onClick,
  small,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
}) {
  const classes = ['card', card.color, selected && 'selected', small && 'small', onClick && 'clickable']
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      <span className="corner">{face(card)}</span>
      <span className="center">{face(card)}</span>
      {card.value > 10 && <span className="name">{card.value === 12 ? 'Dragon' : 'Phénix'}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={classes} onClick={onClick} title={cardLabel(card)} aria-pressed={selected}>
      {content}
    </button>
  ) : (
    <div className={classes} title={cardLabel(card)}>
      {content}
    </div>
  );
}
