import type { CSSProperties } from 'react';
import type { Look } from '../../server/src/protocol';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Rond du joueur : son avatar sur sa couleur s'il en a choisi, sinon ses initiales (ou 🤖 pour un bot). */
export function Avatar({ name, look, bot = false }: { name: string; look?: Look; bot?: boolean }) {
  const style = look?.color ? ({ '--avatar-color': look.color } as CSSProperties) : undefined;
  return (
    <span className={`avatar ${look?.color ? 'colored' : ''} ${look?.avatar ? 'emoji' : ''}`} style={style} aria-hidden>
      {bot ? '🤖' : (look?.avatar ?? initials(name))}
    </span>
  );
}
