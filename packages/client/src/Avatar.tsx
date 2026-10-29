import type { CSSProperties } from 'react';
import type { Cosmetics, Look } from '../../server/src/protocol';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Rond du joueur : son avatar sur sa couleur s'il en a choisi, sinon ses initiales (ou 🤖 pour un bot), entouré du
 * cadre qu'il a débloqué et choisi (bronze, argent…).
 */
export function Avatar({ name, look, bot = false }: { name: string; look?: Look & Cosmetics; bot?: boolean }) {
  const style = look?.color ? ({ '--avatar-color': look.color } as CSSProperties) : undefined;
  const frame = !bot && look?.frame ? `frame frame-${look.frame}` : '';
  return (
    <span className={`avatar ${look?.color ? 'colored' : ''} ${look?.avatar ? 'emoji' : ''} ${frame}`} style={style} aria-hidden>
      {bot ? '🤖' : (look?.avatar ?? initials(name))}
    </span>
  );
}
