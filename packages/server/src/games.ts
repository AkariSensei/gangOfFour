/**
 * Les jeux du site. Chaque jeu est un module : une fiche ici (ce que l'accueil en montre), et, une fois jouable, ses
 * règles dans le moteur (branchées au serveur par rules.ts), ses écrans côté client et son classement de saison.
 * Gang of Four et le Président sont jouables ; les autres sont annoncés.
 */
export interface GameInfo {
  id: string;
  name: string;
  tagline: string;
  players: string;
  /** Jouable, annoncé pour bientôt, ou prévu plus tard. */
  status: 'live' | 'soon' | 'later';
  /** Le score le plus bas gagne (Gang of Four, où l'on marque des pénalités). */
  lowScoreWins?: boolean;
}

export const GAMES: GameInfo[] = [
  { id: 'gof', name: 'Gang of Four', tagline: 'Combinaisons, gangs et dragon rouge', players: '3 ou 4 joueurs', status: 'live', lowScoreWins: true },
  { id: 'president', name: 'Président', tagline: 'Le premier sera président, le dernier… trou', players: '3 à 7 joueurs', status: 'live' },
  { id: 'coinche', name: 'Coinche', tagline: 'Deux contre deux, annonces et belote', players: '4 joueurs en équipes', status: 'later' },
];

/** Le jeu des parties enregistrées avant l'arrivée des autres jeux. */
export const DEFAULT_GAME = 'gof';
