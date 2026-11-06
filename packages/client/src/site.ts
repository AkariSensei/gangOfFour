import type { GameId } from '../../server/src/protocol';

/**
 * Identité du site : le nom, l'accroche et l'encart des nouveautés de la page Jeux. Le logo et la mascotte sont dans
 * public/assets/brand (générés par scripts/brand/export.cjs), le titre de l'onglet dans index.html.
 */
export const SITE_NAME = 'Ludora';
export const SITE_TAGLINE = 'Des jeux entre amis, à deux ou à plusieurs, avec un classement à chaque saison';

/** La nouveauté mise en avant sur la page Jeux (null : pas d'encart). Elle mène à la page du jeu. */
export const SITE_NEWS: { game: GameId; title: string; text: string } | null = {
  game: 'chess',
  title: 'Nouveau : les échecs',
  text: 'Pendule, prémouvements et un classement par cadence',
};
