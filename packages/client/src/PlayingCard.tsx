import { type PlayingCard, type Suit, rankLabel } from '@gof/engine';
import type { CSSProperties } from 'react';

/** Les cartes classiques (Président, et les jeux à venir), dessinées plutôt qu'illustrées. */
const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAMES: Record<Suit, string> = { S: 'pique', H: 'cœur', D: 'carreau', C: 'trèfle' };
const RANK_NAMES: Record<string, string> = { J: 'valet', Q: 'dame', K: 'roi', A: 'as' };
/** Valeurs affichées à la française : V, D, R pour valet, dame, roi. */
const FRENCH_RANKS: Record<string, string> = { J: 'V', Q: 'D', K: 'R' };

export function rankName(rank: number): string {
  const label = rankLabel(rank);
  return RANK_NAMES[label] ?? label;
}

/** « dame de cœur », « 10 de pique »… */
export function playingCardLabel(card: PlayingCard): string {
  return `${rankName(card.rank)} de ${SUIT_NAMES[card.suit]}`;
}

/** Valeur telle qu'écrite sur la carte. */
export function rankText(rank: number): string {
  const label = rankLabel(rank);
  return FRENCH_RANKS[label] ?? label;
}

export function PlayingCardView({
  card,
  selected,
  dimmed,
  small,
  onClick,
  style,
}: {
  card: PlayingCard;
  selected?: boolean;
  dimmed?: boolean;
  small?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const red = card.suit === 'H' || card.suit === 'D';
  const classes = ['card', 'playing-card', red ? 'red' : 'black', selected && 'selected', dimmed && 'dimmed', small && 'small', onClick && 'clickable']
    .filter(Boolean)
    .join(' ');
  const face = (
    <>
      <span className="pc-corner">
        <span className="pc-rank">{rankText(card.rank)}</span>
        <span className="pc-suit">{SUIT_SYMBOLS[card.suit]}</span>
      </span>
      <span className="pc-center" aria-hidden>
        {SUIT_SYMBOLS[card.suit]}
      </span>
      <span className="pc-corner pc-corner-bottom" aria-hidden>
        <span className="pc-rank">{rankText(card.rank)}</span>
        <span className="pc-suit">{SUIT_SYMBOLS[card.suit]}</span>
      </span>
    </>
  );
  const label = playingCardLabel(card);
  return onClick ? (
    <button type="button" className={classes} onClick={onClick} title={label} aria-label={label} aria-pressed={selected} style={style} data-card={card.id}>
      {face}
    </button>
  ) : (
    <div className={classes} title={label} role="img" aria-label={label} style={style}>
      {face}
    </div>
  );
}

/** Dos de carte classique, pour les mains des adversaires et les illustrations. */
export function PlayingCardBack({ style }: { style?: CSSProperties }) {
  return <span className="card playing-card back" aria-hidden style={style} />;
}
