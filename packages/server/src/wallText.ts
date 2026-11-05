/**
 * Texte permis sur le mur de la communauté : des lettres (accents compris), des chiffres, des espaces et la ponctuation
 * d'une phrase. Tout le reste disparaît, pour qu'on ne puisse pas y dessiner en caractères (ASCII art, symboles,
 * lettres surchargées d'accents). Partagé par le serveur, qui fait foi, et par l'interface, qui filtre pendant la saisie.
 */
const FORBIDDEN = /[^\p{L}\p{Nd} .,'’?!:;()«»"€%\-\n]/gu;

export function wallText(value: string, multiline = false): string {
  let text = value.normalize('NFC');
  // Les retours à la ligne ne servent que dans les détails ; ailleurs ils deviennent des espaces.
  text = multiline ? text.replace(/\r\n?/g, '\n') : text.replace(/[\r\n]+/g, ' ');
  text = text.replace(FORBIDDEN, '');
  // Pas d'alignement à coups d'espaces, au plus une ligne vide d'affilée, et une ponctuation trois fois au plus.
  text = text.replace(/ {2,}/g, ' ');
  text = text.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return text.replace(/([.,'’?!:;()«»"€%-])\1{3,}/gu, '$1$1$1');
}
