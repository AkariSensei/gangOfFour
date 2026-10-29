import { type Card, createDeck } from '@gof/engine';

/**
 * Tutoriel : une manche écrite à l'avance, seul contre trois bots, que le joueur gagne forcément. Il est assis à la
 * place 0 (donneur), les bots aux places 1 à 3 ; on joue dans le sens horaire, donc après lui viennent les places
 * 3 (Robot Grace), 2 (Robot Alan) puis 1 (Robot Ada). Chaque coup est imposé : le joueur suit les explications.
 */

/** Cartes de chaque place. Les cartes des bots qui ne servent pas au script complètent leur main. */
const HUMAN = ['m1', 'rD', 'y2a', 'r2a', 'gP', 'yP', 'g5a', 'y6a', 'r7a', 'g8a', 'y9a', 'g10a', 'g10b', 'y10a', 'r10a', 'y8a'];
const SCRIPTED: Record<number, string[]> = {
  3: ['g4a', 'g6a', 'y6b', 'r1a', 'r3a', 'r5a', 'r6a', 'r8a'],
  2: ['r6b'],
  1: [],
};

/** Un coup du script : des cartes à poser, ou une passe (sans cartes). Les coups du joueur ont leur explication. */
export interface TutorialMove {
  player: number;
  cardIds?: string[];
  coach?: string;
}

const pass = (player: number): TutorialMove => ({ player });
const play = (player: number, cardIds: string[], coach?: string): TutorialMove => ({ player, cardIds, ...(coach ? { coach } : {}) });

export const TUTORIAL_SCRIPT: TutorialMove[] = [
  play(
    0,
    ['m1'],
    'Bienvenue ! Le but : être le premier à vider sa main. Tu as le 1 multicolore, alors c’est toi qui ouvres la partie avec lui. Clique sur la carte en surbrillance, puis sur Jouer.',
  ),
  play(3, ['g4a']),
  play(2, ['r6b']),
  pass(1),
  play(
    0,
    ['rD'],
    'Chacun doit poser plus fort que la table, avec le même nombre de cartes, ou passer. Grace a posé un 4, Alan un 6, Ada a passé. Pose ton dragon : c’est la carte seule la plus forte du jeu.',
  ),
  pass(3),
  pass(2),
  play(
    0,
    ['y2a', 'r2a'],
    'Personne ne peut battre le dragon : tu remportes le pli et tu ouvres le suivant avec ce que tu veux. Pose ta paire de 2. À valeur égale, la couleur départage : vert < jaune < rouge.',
  ),
  play(3, ['g6a', 'y6b']),
  pass(2),
  pass(1),
  play(
    0,
    ['gP', 'yP'],
    'Grace a battu ta paire avec une paire de 6. Tes deux phénix forment la paire la plus forte du jeu : pose-les.',
  ),
  pass(3),
  play(
    0,
    ['g5a', 'y6a', 'r7a', 'g8a', 'y9a'],
    'Encore à toi d’ouvrir. Les combinaisons de 5 cartes, de la plus faible à la plus forte : suite, couleur, full, quinte flush. Pose ta suite du 5 au 9.',
  ),
  play(3, ['r1a', 'r3a', 'r5a', 'r6a', 'r8a']),
  pass(2),
  pass(1),
  play(
    0,
    ['g10a', 'g10b', 'y10a', 'r10a'],
    'Grace a posé une couleur (5 cartes rouges), plus forte qu’une suite. Mais tu as un gang : 4 cartes ou plus de même valeur. Un gang bat n’importe quelle combinaison ! Pose tes quatre 10.',
  ),
  pass(3),
  play(
    0,
    ['y8a'],
    'Plus qu’une carte ! Bon à savoir, la règle « Carte ! » : quand le joueur qui te suit n’a plus qu’une carte, une carte seule posée doit être ta plus forte. Ici rien ne te gêne : pose ton dernier 8 pour vider ta main et gagner la manche.',
  ),
];

/**
 * Paquet de la donne du tutoriel, le dessus en premier. La donne commence à gauche du donneur (place 0) et tourne
 * dans le sens horaire : places 3, 2, 1, 0, 3, 2…
 */
export function tutorialDeck(): Card[] {
  const deck = createDeck();
  const take = (ids: string[]) => ids.map((id) => deck.find((c) => c.id === id)!);
  const used = new Set([...HUMAN, ...Object.values(SCRIPTED).flat()]);
  const rest = deck.filter((c) => !used.has(c.id));
  const hands: Card[][] = [take(HUMAN), [], [], []];
  for (const seat of [1, 2, 3]) {
    const scripted = take(SCRIPTED[seat]!);
    hands[seat] = [...scripted, ...rest.splice(0, 16 - scripted.length)];
  }
  const order: Card[] = [];
  for (let round = 0; round < 16; round++) for (const seat of [3, 2, 1, 0]) order.push(hands[seat]![round]!);
  return order;
}
