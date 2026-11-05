/**
 * Les jeux du site. Chaque jeu est un module : une fiche ici (ce que l'accueil en montre), et, une fois jouable, ses
 * règles dans le moteur (branchées au serveur par rules.ts), ses écrans côté client et son classement de saison.
 * Un nouveau jeu porte le badge « Bêta » tant que l'admin ne l'a pas retiré.
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
  /** Nouveau jeu encore en rodage : un badge « Bêta » l'annonce, jusqu'à ce que l'admin décide de l'enlever. */
  beta?: boolean;
}

export const GAMES: GameInfo[] = [
  { id: 'gof', name: 'Gang of Four', tagline: 'Combinaisons, gangs et dragon rouge', players: '3 ou 4 joueurs', status: 'live', lowScoreWins: true },
  {
    id: 'slots',
    name: 'Duel Jackpot',
    tagline: 'Deux machines à sous, 100 € chacun : le premier à 300 € gagne',
    players: '2 joueurs',
    status: 'live',
    beta: true,
  },
];

/** Le jeu des parties enregistrées avant l'arrivée des autres jeux. */
export const DEFAULT_GAME = 'gof';
