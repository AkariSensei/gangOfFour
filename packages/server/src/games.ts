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
  /** Les bots de l'entraînement ont plusieurs niveaux, au choix du joueur. */
  botLevels?: boolean;
  /**
   * Formats qui ont chacun leur classement (la cadence aux échecs, le nombre de joueurs à Gang of Four) : `label` pour
   * les onglets, `phrase` pour annoncer les points (« +18 points en blitz »).
   */
  formats?: { id: string; label: string; phrase: string }[];
}

export const GAMES: GameInfo[] = [
  {
    id: 'gof',
    name: 'Gang of Four',
    tagline: 'Combinaisons, gangs et dragon rouge',
    players: '3 ou 4 joueurs',
    status: 'live',
    lowScoreWins: true,
    botLevels: true,
    formats: [
      { id: '3', label: 'À 3 joueurs', phrase: 'à 3 joueurs' },
      { id: '4', label: 'À 4 joueurs', phrase: 'à 4 joueurs' },
    ],
  },
  {
    id: 'chess',
    name: 'Échecs',
    tagline: 'Blitz ou rapide, à la pendule, avec toutes les règles',
    players: '2 joueurs',
    status: 'live',
    beta: true,
    botLevels: true,
    formats: [
      { id: 'bullet', label: 'Bullet', phrase: 'en bullet' },
      { id: 'blitz', label: 'Blitz', phrase: 'en blitz' },
      { id: 'rapide', label: 'Rapide', phrase: 'en rapide' },
      { id: 'classique', label: 'Classique', phrase: 'en classique' },
    ],
  },
  {
    id: 'slots',
    name: 'Duel Jackpot',
    tagline: 'Deux machines à sous, 100 € chacun : le premier à 300 € gagne',
    players: '2 joueurs',
    status: 'live',
    beta: true,
  },
  {
    id: 'reversi',
    name: 'Reversi',
    tagline: 'Encadre les pions de l’autre pour les retourner',
    players: '2 joueurs',
    status: 'live',
    beta: true,
    botLevels: true,
  },
  {
    id: 'battleship',
    name: 'Bataille navale',
    tagline: 'Place ta flotte en secret, et coule celle de l’autre',
    players: '2 joueurs',
    status: 'live',
    beta: true,
  },
];

/** Le jeu des parties enregistrées avant l'arrivée des autres jeux. */
export const DEFAULT_GAME = 'gof';

/**
 * Format d'une partie, pour les jeux qui ont un classement par format : la cadence enregistrée aux échecs, le nombre
 * de joueurs à Gang of Four (déduit de la table, donc connu aussi pour les parties d'avant les formats).
 */
export function formatOf(game: string, record: { format?: string; players: unknown[] }): string | undefined {
  if (!GAMES.find((g) => g.id === game)?.formats) return undefined;
  return record.format ?? (game === DEFAULT_GAME ? String(record.players.length) : undefined);
}
