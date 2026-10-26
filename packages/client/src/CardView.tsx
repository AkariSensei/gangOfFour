import { type Card, createDeck } from '@gof/engine';
import type { CSSProperties, HTMLAttributes } from 'react';
import { cardLabel } from './labels';

const COLOR_CODES: Record<Card['color'], string> = { green: 'V', yellow: 'J', red: 'R', multi: 'M' };

/** Nom du fichier de l'illustration : 5V, 10R, 1M, PJ, PV, DR… */
export function cardImage(card: Card): string {
  const code = card.value === 12 ? 'DR' : card.value === 11 ? `P${COLOR_CODES[card.color]}` : `${card.value}${COLOR_CODES[card.color]}`;
  return `/cards/${code}.webp`;
}

/** Charge toutes les illustrations dès l'ouverture, pour qu'elles s'affichent sans délai en partie. */
export function preloadCardImages() {
  const sources = new Set([...createDeck().map(cardImage), '/cards/dos-mini.webp']);
  for (const src of sources) new Image().src = src;
}

export function CardView({
  card,
  selected,
  onClick,
  small,
  dimmed,
  dragging,
  style,
  handlers,
}: {
  card: Card;
  selected?: boolean;
  /** Carte qui ne peut pas battre la table : affichée en retrait. */
  dimmed?: boolean;
  onClick?: () => void;
  small?: boolean;
  /** Carte en train d'être déplacée dans la main. */
  dragging?: boolean;
  style?: CSSProperties;
  /** Gestionnaires du glisser-déposer (main du joueur). */
  handlers?: HTMLAttributes<HTMLButtonElement>;
}) {
  const classes = ['card', selected && 'selected', small && 'small', dimmed && 'dimmed', dragging && 'dragging', onClick && 'clickable']
    .filter(Boolean)
    .join(' ');
  const image = <img src={cardImage(card)} alt={cardLabel(card)} draggable={false} />;
  return onClick ? (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      title={cardLabel(card)}
      aria-pressed={selected}
      style={style}
      data-card={card.id}
      {...handlers}
    >
      {image}
    </button>
  ) : (
    <div className={classes} title={cardLabel(card)} style={style}>
      {image}
    </div>
  );
}
