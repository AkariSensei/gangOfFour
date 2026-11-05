import { FLEET } from '@gof/engine';

/**
 * Les navires de la bataille navale, dessinés vus du dessus, la proue vers la droite (ou vers le bas à la verticale).
 * Chaque case du bateau fait 100 unités : un porte-avions de 5 cases fait 500 × 100.
 */

const HULL = '#9aa3ab';
const DECK = '#c2c8cd';
const DARK = '#2e363c';
const STEEL = '#5b656d';

/** La coque : poupe arrondie à gauche, proue effilée à droite, de `w` unités de long. */
function hull(w: number, top = 20, bottom = 80) {
  const mid = (top + bottom) / 2;
  return `M 14 ${top + 8} Q 14 ${top} 26 ${top} L ${w - 70} ${top} Q ${w - 22} ${top + 2} ${w - 8} ${mid} Q ${w - 22} ${bottom - 2} ${w - 70} ${bottom} L 26 ${bottom} Q 14 ${bottom} 14 ${bottom - 8} Z`;
}

/** Une tourelle, ses canons pointés vers la proue. */
function Turret({ x, big = false }: { x: number; big?: boolean }) {
  const r = big ? 15 : 12;
  return (
    <g>
      <rect x={x} y={big ? 44 : 45} width={big ? 34 : 28} height={big ? 4 : 3} rx="1.5" fill={DARK} />
      <rect x={x} y={big ? 52 : 52} width={big ? 34 : 28} height={big ? 4 : 3} rx="1.5" fill={DARK} />
      <circle cx={x} cy="50" r={r} fill={STEEL} stroke={DARK} strokeWidth="3" />
    </g>
  );
}

/** Les détails propres à chaque navire. */
function Details({ kind, w }: { kind: number; w: number }) {
  switch (FLEET[kind]?.name) {
    case 'Porte-avions':
      return (
        <g>
          <rect x="34" y="28" width={w - 120} height="44" rx="4" fill="#6f777e" />
          <line x1="44" y1="50" x2={w - 96} y2="50" stroke="#e9edf0" strokeWidth="3" strokeDasharray="16 12" />
          <rect x={w * 0.55} y="16" width="58" height="16" rx="3" fill={STEEL} stroke={DARK} strokeWidth="3" />
          <circle cx={w * 0.55 + 18} cy="24" r="4" fill="#e9edf0" />
        </g>
      );
    case 'Sous-marin':
      return (
        <g>
          <ellipse cx={w * 0.48} cy="50" rx="34" ry="11" fill="#3e484f" stroke={DARK} strokeWidth="3" />
          <line x1={w * 0.48} y1="50" x2={w * 0.48 + 26} y2="50" stroke="#c2c8cd" strokeWidth="3" />
          <line x1="40" y1="50" x2={w * 0.3} y2="50" stroke="#55616a" strokeWidth="3" />
        </g>
      );
    case 'Torpilleur':
      return (
        <g>
          <rect x={w * 0.28} y="38" width="40" height="24" rx="4" fill={STEEL} stroke={DARK} strokeWidth="3" />
          <Turret x={w * 0.62} />
        </g>
      );
    case 'Croiseur':
      return (
        <g>
          <Turret x={w * 0.2} big />
          <rect x={w * 0.36} y="34" width="74" height="32" rx="5" fill={STEEL} stroke={DARK} strokeWidth="3" />
          <rect x={w * 0.36 + 44} y="42" width="12" height="16" rx="2" fill={DARK} />
          <Turret x={w * 0.62} big />
          <Turret x={w * 0.76} big />
        </g>
      );
    default:
      // Contre-torpilleur.
      return (
        <g>
          <Turret x={w * 0.22} />
          <rect x={w * 0.4} y="36" width="58" height="28" rx="5" fill={STEEL} stroke={DARK} strokeWidth="3" />
          <rect x={w * 0.4 + 34} y="43" width="10" height="14" rx="2" fill={DARK} />
          <Turret x={w * 0.74} />
        </g>
      );
  }
}

/** Un navire de la flotte (`kind` : son rang dans FLEET), à l'horizontale ou à la verticale. */
export function ShipArt({ kind, vertical = false }: { kind: number; vertical?: boolean }) {
  const size = FLEET[kind]?.size ?? 2;
  const w = size * 100;
  const sub = FLEET[kind]?.name === 'Sous-marin';
  const ship = (
    <g>
      <path d={hull(w, sub ? 30 : 20, sub ? 70 : 80)} fill={sub ? '#59646c' : HULL} stroke={DARK} strokeWidth="4" strokeLinejoin="round" />
      {!sub && <path d={hull(w, 27, 73)} fill="none" stroke={DECK} strokeWidth="2" opacity="0.7" transform={`translate(${w * 0.02} 0) scale(0.97 1)`} />}
      <Details kind={kind} w={w} />
    </g>
  );
  return (
    <svg
      viewBox={vertical ? `0 0 100 ${w}` : `0 0 ${w} 100`}
      preserveAspectRatio="none"
      aria-hidden
      className="ship-art"
    >
      {vertical ? <g transform="translate(100 0) rotate(90)">{ship}</g> : ship}
    </svg>
  );
}
