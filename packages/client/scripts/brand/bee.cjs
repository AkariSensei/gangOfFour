// L'abeille Ludora : toutes les déclinaisons partent des mêmes pièces, aux mêmes coordonnées (repère 256 × 256).
const C = {
  ink: '#2a190e',
  inkSoft: '#3d2614',
  stalk: '#7a4a22',
  honeyLight: '#ffe58a',
  honey: '#ffc53d',
  honeyDeep: '#f0960f',
  amber: '#d9730a',
  wax: '#fffaf0',
  waxDeep: '#f3e3c4',
  waxLine: '#e3c99b',
  blush: '#ff7a1a',
  tongue: '#ff8f6b',
  spark: '#ffd66b',
  tear: '#cfe8ff',
};

// Pièces du corps, dans l'ordre d'empilement.
const HEAD = { cx: 128, cy: 108, r: 64 };
const BODY = { cx: 128, cy: 192, rx: 56, ry: 47 };

const defs = (id) => `
  <defs>
    <radialGradient id="${id}-head" cx="0.38" cy="0.3" r="0.78">
      <stop offset="0" stop-color="${C.honeyLight}"/>
      <stop offset="0.55" stop-color="${C.honey}"/>
      <stop offset="1" stop-color="${C.honeyDeep}"/>
    </radialGradient>
    <radialGradient id="${id}-body" cx="0.4" cy="0.25" r="0.85">
      <stop offset="0" stop-color="${C.honeyLight}"/>
      <stop offset="0.5" stop-color="${C.honey}"/>
      <stop offset="1" stop-color="${C.amber}"/>
    </radialGradient>
    <linearGradient id="${id}-wing" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${C.wax}"/>
      <stop offset="1" stop-color="${C.waxDeep}"/>
    </linearGradient>
    <clipPath id="${id}-bodyclip"><ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}"/></clipPath>
  </defs>`;

/** Le contour d'une aile en goutte, accrochée derrière le haut du corps ; la droite est le miroir de la gauche. */
const wingD = (side) => {
  const s = side === 'left' ? 1 : -1;
  const x = (v) => 128 - s * (128 - v);
  return {
    outline: `M ${x(92)} 160 C ${x(70)} 166, ${x(34)} 160, ${x(28)} 134 C ${x(22)} 108, ${x(52)} 98, ${x(72)} 116 C ${x(84)} 127, ${x(92)} 144, ${x(92)} 160 Z`,
    vein: `M ${x(86)} 152 C ${x(70)} 146, ${x(54)} 136, ${x(44)} 122`,
  };
};

const wing = (side, id) => {
  const d = wingD(side);
  return `<g class="bee-wing bee-wing-${side}">
    <path d="${d.outline}" fill="url(#${id}-wing)" stroke="${C.waxLine}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="${d.vein}" fill="none" stroke="${C.waxLine}" stroke-width="2.5" stroke-linecap="round"/>
  </g>`;
};

const body = (id) => `<g class="bee-body">
    <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}" fill="url(#${id}-body)"/>
    <g clip-path="url(#${id}-bodyclip)">
      <path d="M 60 184 Q 128 200 196 184 L 196 202 Q 128 218 60 202 Z" fill="${C.ink}"/>
      <path d="M 60 214 Q 128 230 196 214 L 196 230 Q 128 246 60 230 Z" fill="${C.ink}"/>
      <ellipse cx="128" cy="166" rx="60" ry="14" fill="${C.ink}" opacity="0.22"/>
      <ellipse cx="104" cy="190" rx="14" ry="6" fill="#fff" opacity="0.18" transform="rotate(-12 104 190)"/>
    </g>
    <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}" fill="none" stroke="${C.amber}" stroke-width="3"/>
    <path d="M 120 237 Q 128 252 136 237 Z" fill="${C.ink}" stroke="${C.amber}" stroke-width="2.5" stroke-linejoin="round"/>
  </g>`;

// Antennes brun moyen et bouts dorés : elles restent visibles sur les fonds sombres comme clairs.
const antennae = () => `<g class="bee-antennae" fill="none" stroke="${C.stalk}" stroke-width="6" stroke-linecap="round">
    <path d="M 110 48 C 106 32, 96 24, 86 20"/>
    <path d="M 146 48 C 150 32, 160 24, 170 20"/>
    <circle cx="84" cy="19" r="8.5" fill="${C.honey}" stroke="${C.ink}" stroke-width="3"/>
    <circle cx="172" cy="19" r="8.5" fill="${C.honey}" stroke="${C.ink}" stroke-width="3"/>
    <circle cx="81.5" cy="16.5" r="2.6" fill="#fff" stroke="none" opacity="0.7"/>
    <circle cx="169.5" cy="16.5" r="2.6" fill="#fff" stroke="none" opacity="0.7"/>
  </g>`;

const head = (id) => `<g class="bee-head">
    <circle cx="${HEAD.cx}" cy="${HEAD.cy}" r="${HEAD.r}" fill="url(#${id}-head)"/>
    <ellipse cx="104" cy="72" rx="20" ry="10" fill="#fff" opacity="0.32" transform="rotate(-24 104 72)"/>
  </g>`;

const cheeks = () => `<g class="bee-cheeks" fill="${C.blush}" opacity="0.3">
    <ellipse cx="86" cy="130" rx="10" ry="6"/>
    <ellipse cx="170" cy="130" rx="10" ry="6"/>
  </g>`;

/** Un œil ouvert : un ovale sombre et deux reflets. `dx`, `dy` : où il regarde. */
const eye = (cx, cy, rx = 12, ry = 16, dx = 0, dy = 0) => `
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${C.ink}"/>
    <circle cx="${cx - rx * 0.32 + dx}" cy="${cy - ry * 0.38 + dy}" r="${rx * 0.42}" fill="#fff"/>
    <circle cx="${cx + rx * 0.35 + dx}" cy="${cy + ry * 0.38 + dy}" r="${rx * 0.18}" fill="#fff" opacity="0.85"/>`;

const line = (d, w = 5) => `<path d="${d}" fill="none" stroke="${C.ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const arm = (from, to) => `<g class="bee-arm">${line(`M ${from[0]} ${from[1]} Q ${(from[0] + to[0]) / 2} ${Math.min(from[1], to[1]) + 6} ${to[0]} ${to[1]}`, 8)}<circle cx="${to[0]}" cy="${to[1]}" r="7" fill="${C.ink}"/></g>`;

const sparkle = (x, y, s) =>
  `<path d="M ${x} ${y - s} Q ${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q ${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q ${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q ${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z" fill="${C.spark}"/>`;

/** Les expressions : les yeux, les sourcils, la bouche, et ce qui les accompagne (bras, étincelles). */
const FACES = {
  happy: {
    face: `${eye(104, 106)}${eye(152, 106)}${line('M 112 134 Q 126 147 144 131')}${line('M 144 131 L 147 128', 4)}`,
  },
  surprised: {
    face: `${eye(104, 104, 14, 18)}${eye(152, 104, 14, 18)}${line('M 90 78 Q 104 69 117 76', 4.5)}${line('M 139 76 Q 152 69 166 78', 4.5)}
      <ellipse cx="128" cy="142" rx="8" ry="10" fill="${C.ink}"/><ellipse cx="128" cy="147" rx="5" ry="3.5" fill="${C.tongue}"/>`,
  },
  sad: {
    face: `${eye(104, 110, 12, 14, 0, 1)}${eye(152, 110, 12, 14, 0, 1)}${line('M 90 88 L 115 80', 4.5)}${line('M 141 80 L 166 88', 4.5)}
      ${line('M 114 144 Q 128 133 142 144')}
      <path d="M 88 124 Q 84 134 88 138 Q 93 134 88 124 Z" fill="${C.tear}" stroke="#9ec7ea" stroke-width="1.5"/>`,
  },
  thinking: {
    face: `${eye(104, 106, 12, 16, 3, -3)}${eye(152, 106, 12, 16, 3, -3)}${line('M 92 86 L 115 86', 4.5)}${line('M 140 80 Q 153 70 166 77', 4.5)}
      ${line('M 118 139 Q 128 135 140 140')}`,
    front: arm([178, 196], [148, 150]),
  },
  victory: {
    face: `${line('M 92 110 Q 104 96 116 110', 5.5)}${line('M 140 110 Q 152 96 164 110', 5.5)}
      <path d="M 106 128 Q 128 160 150 128 Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>
      <ellipse cx="128" cy="143" rx="10" ry="5" fill="${C.tongue}"/>`,
    back: `${arm([80, 180], [44, 140])}${arm([176, 180], [212, 140])}`,
    extra: `${sparkle(36, 92, 11)}${sparkle(224, 78, 9)}${sparkle(214, 40, 6)}`,
  },
  playing: {
    face: `${eye(104, 108, 12, 15, 1, 3)}${eye(152, 108, 12, 15, 1, 3)}${line('M 92 82 L 115 88', 4.5)}${line('M 141 88 L 164 82', 4.5)}
      ${line('M 114 136 Q 128 143 142 134')}<ellipse cx="141" cy="140" rx="5" ry="4" fill="${C.tongue}"/>`,
    front: `<g class="bee-card" transform="rotate(-8 128 196)">
        <rect x="108" y="170" width="40" height="54" rx="6" fill="${C.wax}" stroke="${C.waxLine}" stroke-width="2"/>
        <path d="M 128 184 L 137 197 L 128 210 L 119 197 Z" fill="${C.blush}"/>
      </g>${arm([82, 192], [108, 190])}${arm([174, 192], [148, 196])}`,
  },
};

/** L'abeille entière : `face` choisit l'expression, `shadow` ajoute l'ombre au sol. */
function bee(face = 'happy', { id = 'bee', shadow = true } = {}) {
  const f = FACES[face];
  return `${defs(id)}
  ${shadow ? `<ellipse cx="128" cy="247" rx="46" ry="6" fill="#000" opacity="0.28"/>` : ''}
  ${wing('left', id)}${wing('right', id)}
  ${f.back ?? ''}
  ${body(id)}
  ${antennae()}
  ${head(id)}
  ${cheeks()}
  <g class="bee-face">${f.face}</g>
  ${f.front ?? ''}
  ${f.extra ?? ''}`;
}

/** La tête seule (icône de profil) : mêmes pièces, recadrées. */
function beeHead(id = 'head') {
  return `${defs(id)}${antennae()}${head(id)}${cheeks()}<g class="bee-face">${FACES.happy.face}</g>`;
}

/** La silhouette d'un seul tenant (petits espaces) : ailes, corps, tête et antennes, sans détail. */
function beeSilhouette(color = 'currentColor') {
  return `<g fill="${color}">
    <path d="${wingD('left').outline}"/>
    <path d="${wingD('right').outline}"/>
    <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}"/>
    <path d="M 120 236 Q 128 252 136 236 Z"/>
    <circle cx="${HEAD.cx}" cy="${HEAD.cy}" r="${HEAD.r}"/>
    <circle cx="84" cy="19" r="8.5"/><circle cx="172" cy="19" r="8.5"/>
  </g>
  <g fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"><path d="M 110 48 C 106 32, 96 24, 86 20"/><path d="M 146 48 C 150 32, 160 24, 170 20"/></g>`;
}

/**
 * Monochrome : une seule couleur (currentColor), les détails découpés dans la silhouette (yeux, rayures, bouche) pour
 * qu'elle se lise sur n'importe quel fond.
 */
function beeMono(id = 'mono') {
  return `<defs><mask id="${id}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
      <rect width="256" height="256" fill="#000"/>
      ${beeSilhouette('#fff')}
      <g fill="none" stroke="#000" stroke-width="5"><circle cx="${HEAD.cx}" cy="${HEAD.cy}" r="${HEAD.r + 2}"/></g>
      <circle cx="${HEAD.cx}" cy="${HEAD.cy}" r="${HEAD.r - 1}" fill="#fff"/>
      <g stroke="#000" stroke-width="5" fill="none"><path d="M ${92} 160 C ${70} 166, ${34} 160, ${28} 134"/><path d="M ${164} 160 C ${186} 166, ${222} 160, ${228} 134"/></g>
      <g clip-path="url(#${id}-bc)"><path d="M 60 184 Q 128 200 196 184 L 196 202 Q 128 218 60 202 Z" fill="#000"/><path d="M 60 214 Q 128 230 196 214 L 196 230 Q 128 246 60 230 Z" fill="#000"/></g>
      <ellipse cx="104" cy="106" rx="12" ry="16" fill="#000"/><ellipse cx="152" cy="106" rx="12" ry="16" fill="#000"/>
      <circle cx="100.2" cy="99.9" r="5" fill="#fff"/><circle cx="148.2" cy="99.9" r="5" fill="#fff"/>
      <path d="M 112 134 Q 126 147 144 131" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round"/>
    </mask><clipPath id="${id}-bc"><ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}"/></clipPath></defs>
  <rect width="256" height="256" fill="currentColor" mask="url(#${id}-m)"/>`;
}

/** Favicon : la tête redessinée pour 16 et 32 px (traits épais, contour sombre pour les onglets clairs). */
function favicon() {
  return `<g stroke="${C.stalk}" stroke-linecap="round" fill="none" stroke-width="2.2"><path d="M 12.5 8 L 9.6 4"/><path d="M 19.5 8 L 22.4 4"/></g>
  <circle cx="9" cy="3.2" r="2.4" fill="${C.honey}" stroke="${C.ink}" stroke-width="1.2"/><circle cx="23" cy="3.2" r="2.4" fill="${C.honey}" stroke="${C.ink}" stroke-width="1.2"/>
  <circle cx="16" cy="18" r="12.5" fill="${C.honey}" stroke="${C.ink}" stroke-width="1.6"/>
  <ellipse cx="11.8" cy="17.5" rx="2.6" ry="3.4" fill="${C.ink}"/><ellipse cx="20.2" cy="17.5" rx="2.6" ry="3.4" fill="${C.ink}"/>
  <circle cx="11" cy="16.2" r="1" fill="#fff"/><circle cx="19.4" cy="16.2" r="1" fill="#fff"/>
  <path d="M 13.2 23 Q 16 25.2 19 22.6" fill="none" stroke="${C.ink}" stroke-width="1.6" stroke-linecap="round"/>`;
}

module.exports = { C, bee, beeHead, beeSilhouette, beeMono, favicon, FACES };
