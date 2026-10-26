import type { Card } from '@gof/engine';
import { cardLabel } from './labels';

const COLOR_CODES: Record<Card['color'], string> = { green: 'V', yellow: 'J', red: 'R', multi: 'M' };

/** Nom du fichier de l'illustration : 5V, 10R, 1M, PJ, PV, DR… */
export function cardImage(card: Card): string {
  const code = card.value === 12 ? 'DR' : card.value === 11 ? `P${COLOR_CODES[card.color]}` : `${card.value}${COLOR_CODES[card.color]}`;
  return `/cards/${code}.png`;
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
  const classes = ['card', selected && 'selected', small && 'small', onClick && 'clickable'].filter(Boolean).join(' ');
  const image = <img src={cardImage(card)} alt={cardLabel(card)} draggable={false} />;
  return onClick ? (
    <button type="button" className={classes} onClick={onClick} title={cardLabel(card)} aria-pressed={selected}>
      {image}
    </button>
  ) : (
    <div className={classes} title={cardLabel(card)}>
      {image}
    </div>
  );
}
