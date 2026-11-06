// Écrit les fichiers de marque Ludora dans public/assets/brand (ou le dossier donné) : node scripts/brand/export.cjs
// Toutes les déclinaisons sortent du même dessin (bee.cjs) : modifier l'abeille là, puis relancer ce script.
const fs = require('fs');
const path = require('path');
const { C, bee, beeHead, beeSilhouette, beeMono, favicon, FACES } = require('./bee.cjs');

const out = process.argv[2] ?? path.join(__dirname, '../../public/assets/brand');
fs.mkdirSync(out, { recursive: true });
const CREDIT = '<!-- Ludora : la mascotte et le logo officiels. -->';
const write = (name, viewBox, inner, extra = '') => {
  const [, , w, h] = viewBox.split(' ').map(Number);
  fs.writeFileSync(
    path.join(out, name),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}"${extra}>${CREDIT}${inner.replace(/\n\s*/g, '')}</svg>\n`,
  );
};

// Les couleurs du nom : crème sur fond sombre, brun sur fond clair.
const CREAM = '#f3ebdd';
// Le nom en Rubik ExtraBold à 100 px, vectorisé une fois pour toutes : le logo ne dépend d'aucune police.
const word = require('./word.json');
// Hauteur des capitales de Rubik à 100 px : environ 70.
const CAP = 70;

/** L'abeille entière, placée dans un carré de `size` à (x, y). */
const placedBee = (x, y, size, face, id) => `<g transform="translate(${x} ${y}) scale(${size / 256})">${bee(face, { id, shadow: false })}</g>`;
const placedHead = (x, y, size, id) => `<g transform="translate(${x} ${y}) scale(${size / 168}) translate(-44 -6)">${beeHead(id)}</g>`;
const placedWord = (x, baseline, height, fill) => `<g transform="translate(${x} ${baseline}) scale(${height / CAP})"><path d="${word.d}" fill="${fill}"/></g>`;
const label = ' role="img" aria-label="Ludora"';

// La mascotte et ses expressions.
write('ludora-bee.svg', '0 0 256 256', bee('happy', { id: 'lb', shadow: false }), label);
for (const face of Object.keys(FACES)) write(`ludora-bee-${face}.svg`, '0 0 256 256', bee(face, { id: `lb-${face}`, shadow: false }), label);
// La tête seule (icône de profil).
write('ludora-bee-head.svg', '0 0 168 168', `<g transform="translate(-44 -6)">${beeHead('lh')}</g>`, label);
// Silhouette et monochrome : la couleur du texte autour (currentColor), noire dans une balise <img>.
write('ludora-bee-silhouette.svg', '0 0 256 256', beeSilhouette('currentColor'), label);
write('ludora-bee-mono.svg', '0 0 256 256', beeMono('lm'), label);
// Favicon, redessiné pour rester lisible en 16 px.
write('favicon.svg', '0 0 32 32', favicon());

// L'icône seule : la tête dans une alvéole sombre (application, avatar de réseau social).
const HEX = 'M 128 8 Q 136 8 143 12 L 229 62 Q 236 66 236 74 L 236 182 Q 236 190 229 194 L 143 244 Q 136 248 128 248 Q 120 248 113 244 L 27 194 Q 20 190 20 182 L 20 74 Q 20 66 27 62 L 113 12 Q 120 8 128 8 Z';
write(
  'ludora-icon.svg',
  '0 0 256 256',
  `<defs><linearGradient id="li-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b241e"/><stop offset="1" stop-color="#16120f"/></linearGradient></defs>
  <path d="${HEX}" fill="url(#li-bg)" stroke="${C.honey}" stroke-opacity="0.55" stroke-width="4"/>
  ${placedHead(52, 46, 152, 'li')}`,
  label,
);

// Logos : l'abeille à gauche et le nom à droite (horizontal), ou l'abeille au-dessus du nom (compact).
const H_BEE = 120;
const H_TEXT = 46;
const horizontal = (fill, beeMarkup) => {
  const textX = H_BEE + 14;
  const width = Math.ceil(textX + (word.width * H_TEXT) / CAP + 4);
  return { width, inner: `${beeMarkup}${placedWord(textX, 60 + H_TEXT / 2, H_TEXT, fill)}` };
};
const logoH = horizontal(CREAM, placedBee(0, 0, H_BEE, 'happy', 'lgh'));
write('ludora-logo-horizontal.svg', `0 0 ${logoH.width} ${H_BEE}`, logoH.inner, label);
const logoLight = horizontal(C.ink, placedBee(0, 0, H_BEE, 'happy', 'lgl'));
write('ludora-logo-light.svg', `0 0 ${logoLight.width} ${H_BEE}`, logoLight.inner, label);
const logoMono = horizontal('currentColor', `<g transform="scale(${H_BEE / 256})">${beeMono('lgm')}</g>`);
write('ludora-logo-mono.svg', `0 0 ${logoMono.width} ${H_BEE}`, logoMono.inner, label);

const textW = (word.width * 40) / CAP;
const compactW = Math.ceil(Math.max(textW, 132) + 8);
write('ludora-logo.svg', `0 0 ${compactW} 186`, `${placedBee((compactW - 132) / 2, 0, 132, 'happy', 'lgc')}${placedWord((compactW - textW) / 2, 182, 40, CREAM)}`, label);

// Le nom seul, pour les endroits où l'abeille est déjà présente.
write('ludora-wordmark.svg', `0 0 ${Math.ceil((word.width * 40) / CAP + 2)} 42`, placedWord(0, 41, 40, CREAM), label);

// Le motif d'alvéoles, en tuile répétable pour les fonds (très discret, à poser sur un fond sombre).
write(
  'ludora-comb.svg',
  '0 0 56 97',
  `<path d="M28 0 L56 16.2 L56 48.5 L28 64.7 L0 48.5 L0 16.2 Z M28 64.7 L28 97 M0 48.5 L0 80.8 M56 48.5 L56 80.8" fill="none" stroke="${C.honey}" stroke-opacity="0.16" stroke-width="1.5"/>`,
  ' aria-hidden="true"',
);
console.log(fs.readdirSync(out).join(' '));
