import { type Card, type CombinationType, analyzeCombination, createDeck, createRng, shuffle } from '@gof/engine';

/*
 * Le Tripot : un jeu d'incrémentation dans l'univers de Gang of Four. On tient un tripot clandestin : chaque clic
 * distribue une carte (cinq font une main, et une belle combinaison rapporte gros), on investit dans du personnel et
 * des salles qui produisent seuls, et l'on s'agrandit pour gagner de la réputation. La progression est lente exprès :
 * des jours pour le premier agrandissement, des mois pour le Palace. Le serveur fait autorité.
 *
 * Ce fichier ne contient que les règles (sans E/S) : l'interface s'en sert aussi pour montrer les cartes distribuées
 * avant même que le serveur les ait comptées.
 */

/** Une activité du tripot : chacune produit des jetons par seconde, et coûte 15 % de plus à chaque achat. */
export interface Building {
  id: string;
  icon: string;
  name: string;
  /** Le nom au pluriel, pour les améliorations (« Paire de croupiers »). */
  plural: string;
  text: string;
  cost: number;
  rate: number;
}

export const BUILDINGS: Building[] = [
  { id: 'donneur', icon: '🃏', name: 'Donneur du dimanche', plural: 'donneurs du dimanche', text: 'Un collègue qui distribue une donne de temps en temps.', cost: 12, rate: 0.1 },
  { id: 'croupier', icon: '🧑‍💼', name: 'Croupier', plural: 'croupiers', text: 'Il bat, il coupe, il distribue.', cost: 120, rate: 1 },
  { id: 'chevronne', icon: '🎩', name: 'Croupier chevronné', plural: 'croupiers chevronnés', text: 'Trente ans de tapis vert dans les doigts.', cost: 1_500, rate: 9 },
  { id: 'table', icon: '🪑', name: 'Table de quatre', plural: 'tables de quatre', text: 'Une table de plus, quatre joueurs de plus.', cost: 18_000, rate: 55 },
  { id: 'bot', icon: '🤖', name: 'Bot croupier', plural: 'bots croupiers', text: 'Il ne dort jamais et ne se trompe jamais de sens.', cost: 220_000, rate: 340 },
  { id: 'bar', icon: '🍸', name: 'Bar clandestin', plural: 'bars clandestins', text: 'Les joueurs restent plus longtemps quand le bar est ouvert.', cost: 3e6, rate: 2_100 },
  { id: 'dragon', icon: '🐉', name: 'Salle du Dragon', plural: 'salles du Dragon', text: 'La salle des grosses mises, gardée par la carte la plus forte.', cost: 4e7, rate: 13_000 },
  { id: 'phenix', icon: '🦅', name: 'Cercle du Phénix', plural: 'cercles du Phénix', text: 'Un cercle privé où les fortunes renaissent de leurs cendres.', cost: 6e8, rate: 85_000 },
  { id: 'ligue', icon: '🏆', name: 'Ligue régionale', plural: 'ligues régionales', text: 'Tous les bureaux de la région jouent chez toi le jeudi soir.', cost: 9e9, rate: 520_000 },
  { id: 'tournoi', icon: '🌍', name: 'Tournoi international', plural: 'tournois internationaux', text: 'Des joueurs du monde entier, et des droits télé.', cost: 1.4e11, rate: 3.3e6 },
  { id: 'fabrique', icon: '🏭', name: 'Fabrique de cartes', plural: 'fabriques de cartes', text: 'Tu imprimes les paquets toi-même. Et parfois quelques dragons en plus.', cost: 2.2e12, rate: 2.1e7 },
  { id: 'banque', icon: '🏦', name: 'Banque du tapis vert', plural: 'banques du tapis vert', text: 'Les jetons du tripot sont acceptés partout. Même au guichet.', cost: 3.5e13, rate: 1.35e8 },
  { id: 'ile', icon: '🏝️', name: 'Île privée', plural: 'îles privées', text: 'Un tripot sur chaque plage, et pas un seul inspecteur.', cost: 6e14, rate: 9e8 },
  { id: 'orbite', icon: '🛰️', name: 'Casino en orbite', plural: 'casinos en orbite', text: 'En apesanteur, les cartes restent là où on les pose.', cost: 1e16, rate: 6e9 },
  { id: 'multivers', icon: '🌀', name: 'Tripot du multivers', plural: 'tripots du multivers', text: 'Dans chaque univers, quelqu’un pose un Gang of Four.', cost: 2e17, rate: 4e10 },
  { id: 'originel', icon: '👑', name: 'Le Gang originel', plural: 'gangs originels', text: 'Les quatre premiers joueurs de l’histoire, à ta table, pour toujours.', cost: 4e18, rate: 3e11 },
];

/** Hausse du prix à chaque achat d'une même activité. */
const COST_GROWTH = 1.15;

/** Prix du prochain exemplaire d'une activité dont on possède déjà `owned`. */
export const buildingCost = (b: Building, owned: number) => Math.ceil(b.cost * COST_GROWTH ** owned);

/** Prix de `count` exemplaires de plus d'une activité (somme d'une suite géométrique). */
export const bulkCost = (b: Building, owned: number, count: number) =>
  Math.ceil((b.cost * COST_GROWTH ** owned * (COST_GROWTH ** count - 1)) / (COST_GROWTH - 1));

/** Combien d'exemplaires on peut s'offrir avec ces jetons. */
export function affordable(b: Building, owned: number, chips: number): number {
  const first = b.cost * COST_GROWTH ** owned;
  if (chips < first) return 0;
  const n = Math.floor(Math.log((chips * (COST_GROWTH - 1)) / first + 1) / Math.log(COST_GROWTH));
  return bulkCost(b, owned, n) <= chips ? n : Math.max(0, n - 1);
}

/* ——— Les mains ——— */

/** Une main du tripot : cinq cartes, distribuées une par clic. */
export const HAND_SIZE = 5;

/** Combinaisons qu'une main peut former, de la plus faible à la plus forte. */
export const HAND_TYPES = ['pair', 'trio', 'straight', 'flush', 'fullHouse', 'straightFlush', 'gang'] as const;
export type HandType = (typeof HAND_TYPES)[number];

/** Ce que rapporte une combinaison : des secondes de production (ou de donnes, tant que le tripot ne produit rien). */
export const HAND_SECONDS: Record<HandType, number> = {
  pair: 1,
  trio: 5,
  straight: 20,
  flush: 20,
  fullHouse: 60,
  // Plus rare qu'un Gang of Four quand on tire cinq cartes au hasard : c'est elle qui rapporte le plus.
  straightFlush: 1200,
  gang: 300,
};

/** Les cinq cartes de la main numéro `index` d'une partie : toujours les mêmes, pour le serveur comme pour l'écran. */
export function handOf(seed: number, index: number): Card[] {
  return shuffle(createDeck(), createRng((seed + Math.imul(index, 0x9e3779b1)) >>> 0)).slice(0, HAND_SIZE);
}

/** La meilleure combinaison d'une main (selon les règles du jeu : les phénix ne font qu'une paire ou un full). */
export function bestHand(cards: Card[]): HandType | null {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.value, (counts.get(c.value) ?? 0) + 1);
  const most = Math.max(0, ...[...counts].filter(([v]) => v <= 10).map(([, n]) => n));
  if (most >= 4) return 'gang';
  const five: CombinationType | undefined = cards.length === 5 ? analyzeCombination(cards)?.type : undefined;
  if (five === 'straightFlush' || five === 'fullHouse' || five === 'flush' || five === 'straight') return five;
  if (most === 3) return 'trio';
  if (most === 2 || (counts.get(11) ?? 0) === 2) return 'pair';
  return null;
}

/* ——— Améliorations ——— */

/**
 * Une amélioration, achetée une seule fois. Elle vise une activité (production doublée), la donne (`deal`, qui vaut
 * plus ; `dealRate`, qui rapporte une part de la production), les mains (`hand`) ou tout le tripot (`all`).
 */
export interface Upgrade {
  id: string;
  icon: string;
  name: string;
  text: string;
  cost: number;
  target: string;
  factor: number;
  /** Proposée quand on possède ce nombre de l'activité visée (de donnes, de mains gagnantes, de jetons gagnés). */
  needs: number;
}

/** Les combinaisons du jeu doublent tour à tour la production d'une activité, quand on en possède assez. */
const COMBINATIONS: [string, string, number, number][] = [
  ['paire', 'Paire', 1, 10],
  ['brelan', 'Brelan', 5, 50],
  ['suite', 'Suite', 25, 500],
  ['couleur', 'Couleur', 50, 5e4],
  ['full', 'Full', 100, 5e6],
  ['quinte', 'Quinte flush', 150, 5e8],
  ['gang', 'Gang', 200, 5e10],
];

export const UPGRADES: Upgrade[] = [
  { id: 'doigts', icon: '👆', name: 'Doigts de croupier', text: 'Chaque carte distribuée rapporte deux fois plus.', cost: 80, target: 'deal', factor: 2, needs: 10 },
  { id: 'americaine', icon: '🔀', name: 'Battage à l’américaine', text: 'Chaque carte distribuée rapporte deux fois plus.', cost: 1_500, target: 'deal', factor: 2, needs: 200 },
  { id: 'coupe', icon: '✂️', name: 'La coupe parfaite', text: 'Chaque carte rapporte aussi 1 % de la production par seconde.', cost: 5e4, target: 'dealRate', factor: 0.01, needs: 1_000 },
  { id: 'multi', icon: '🌈', name: 'Le 1 multicolore', text: 'Chaque carte rapporte encore 1 % de la production par seconde.', cost: 5e7, target: 'dealRate', factor: 0.01, needs: 10_000 },
  { id: 'mains-or', icon: '🖐️', name: 'Des mains en or', text: 'Chaque carte rapporte encore 1 % de la production par seconde.', cost: 5e10, target: 'dealRate', factor: 0.01, needs: 50_000 },
  { id: 'donne-legende', icon: '🌟', name: 'La donne légendaire', text: 'Chaque carte rapporte encore 2 % de la production par seconde.', cost: 5e14, target: 'dealRate', factor: 0.02, needs: 200_000 },
  { id: 'lecture', icon: '👀', name: 'Lire le jeu', text: 'Les combinaisons de la donne rapportent deux fois plus.', cost: 2_000, target: 'hand', factor: 2, needs: 10 },
  { id: 'memoire', icon: '🧠', name: 'Compter les cartes', text: 'Les combinaisons de la donne rapportent deux fois plus.', cost: 5e6, target: 'hand', factor: 2, needs: 200 },
  { id: 'bluff', icon: '😏', name: 'Le bluff', text: 'Les combinaisons de la donne rapportent deux fois plus.', cost: 5e10, target: 'hand', factor: 2, needs: 2_000 },
  { id: 'instinct', icon: '🔮', name: 'L’instinct du joueur', text: 'Les combinaisons de la donne rapportent deux fois plus.', cost: 5e15, target: 'hand', factor: 2, needs: 10_000 },
  ...BUILDINGS.flatMap((b) =>
    COMBINATIONS.map(([id, name, needs, multiplier]) => ({
      id: `${b.id}-${id}`,
      icon: b.icon,
      name: `${name} de ${b.plural}`,
      text: `${b.name} : production doublée.`,
      cost: b.cost * multiplier,
      target: b.id,
      factor: 2,
      needs,
    })),
  ),
  { id: 'phenix-vert', icon: '🪶', name: 'Le phénix vert', text: 'Tout le tripot produit 10 % de plus.', cost: 5e6, target: 'all', factor: 1.1, needs: 5e6 },
  { id: 'phenix-jaune', icon: '🪶', name: 'Le phénix jaune', text: 'Tout le tripot produit 10 % de plus.', cost: 5e9, target: 'all', factor: 1.1, needs: 5e9 },
  { id: 'dragon-rouge', icon: '🔥', name: 'Le dragon rouge', text: 'Tout le tripot produit 20 % de plus.', cost: 5e12, target: 'all', factor: 1.2, needs: 5e12 },
  { id: 'gang-of-four', icon: '💥', name: 'Gang of Four', text: 'Quatre exemplaires de chacune des huit premières activités : tout le tripot produit deux fois plus.', cost: 1e11, target: 'all', factor: 2, needs: 4 },
  { id: 'gang-of-seven', icon: '💥', name: 'Gang of Seven', text: 'Sept exemplaires de chacune des seize activités : tout le tripot produit deux fois plus.', cost: 1e20, target: 'all', factor: 2, needs: 7 },
];

/* ——— Réputation et établissements ——— */

/** Jetons gagnés (depuis toujours) pour le premier point de réputation ; il en faut toujours plus pour les suivants. */
export const REPUTATION_UNIT = 1e10;
/** Réputation totale méritée par les jetons gagnés depuis toujours (racine cubique : 8 fois plus pour le double). */
export const reputationFor = (earnedAll: number) => Math.floor(Math.cbrt(earnedAll / REPUTATION_UNIT));
/** Jetons à avoir gagnés (depuis toujours) pour mériter cette réputation. */
export const earnedForReputation = (reputation: number) => reputation ** 3 * REPUTATION_UNIT;
/** Chaque point de réputation : +2 % de production, pour toujours. */
const REPUTATION_BONUS = 0.02;

/** Un établissement : on y accède avec assez de réputation, et chacun apporte un avantage qui reste. */
export interface Venue {
  name: string;
  reputation: number;
  perk: string;
}
export const VENUES: Venue[] = [
  { name: 'Arrière-salle', reputation: 0, perk: '' },
  { name: 'Cave enfumée', reputation: 1, perk: 'Ton absence compte jusqu’à 12 h au lieu de 8.' },
  { name: 'Tripot de quartier', reputation: 10, perk: 'Pendant ton absence, le tripot tourne aux trois quarts.' },
  { name: 'Cercle de jeu', reputation: 100, perk: 'Le Dragon et le Phénix passent deux fois plus souvent.' },
  { name: 'Casino clandestin', reputation: 1_000, perk: 'Ton absence compte jusqu’à 24 h.' },
  { name: 'Palace', reputation: 10_000, perk: 'Les combinaisons de la donne rapportent trois fois plus.' },
];
/** Après le Palace, chaque étoile demande quatre fois plus de réputation (Palace ★, ★★…). */
const STAR_GROWTH = 4;

/** Niveau d'établissement (0 pour l'arrière-salle, 5 pour le Palace, 6 et plus pour les étoiles). */
export function venueLevel(reputation: number): number {
  let level = VENUES.filter((v) => reputation >= v.reputation).length - 1;
  if (level < VENUES.length - 1) return level;
  for (let need = VENUES[VENUES.length - 1]!.reputation * STAR_GROWTH; reputation >= need; need *= STAR_GROWTH) level++;
  return level;
}
export function venueName(level: number): string {
  const last = VENUES.length - 1;
  return level <= last ? VENUES[level]!.name : `Palace ${'★'.repeat(level - last)}`;
}
/** Réputation à avoir pour l'établissement de ce niveau. */
export function venueReputation(level: number): number {
  const last = VENUES.length - 1;
  return level <= last ? VENUES[level]!.reputation : VENUES[last]!.reputation * STAR_GROWTH ** (level - last);
}

/**
 * Rente quotidienne : l'expérience que le Tripot verse chaque jour où l'on y passe, selon l'établissement
 * (rien dans l'arrière-salle, 10 dans la cave… et 60 au plus).
 */
export const rentXp = (level: number) => Math.min(60, 10 * level);

/**
 * Les faveurs du milieu : chaque point de réputation gagné en s'agrandissant donne une faveur à dépenser. Ce qu'on
 * achète avec reste pour toujours, et la réputation garde son bonus (on ne la dépense pas, on la fait valoir).
 */
export interface Favor {
  id: string;
  icon: string;
  name: string;
  text: string;
  cost: number;
}
export const FAVORS: Favor[] = [
  { id: 'mise', icon: '💼', name: 'Mise de départ', text: 'Après chaque agrandissement, tu repars avec 10 croupiers.', cost: 1 },
  { id: 'indic', icon: '🕵️', name: 'Un indic au commissariat', text: 'Ton absence compte 4 h de plus.', cost: 2 },
  { id: 'habitues', icon: '🍻', name: 'Les habitués', text: 'Le Dragon, le Phénix et le 1 multicolore restent deux fois plus longtemps sur la table.', cost: 3 },
  { id: 'doigts-fee', icon: '🪄', name: 'Doigts de fée', text: 'Chaque carte distribuée rapporte trois fois plus.', cost: 5 },
  { id: 'ardoise', icon: '📒', name: 'L’ardoise', text: 'Pendant ton absence, le tripot tourne 15 points plus vite.', cost: 10 },
  { id: 'marquees', icon: '🖊️', name: 'Cartes marquées', text: 'Les combinaisons de la donne rapportent trois fois plus.', cost: 25 },
  { id: 'parrain', icon: '🎖️', name: 'Le parrain', text: 'Tout le tripot produit 50 % de plus.', cost: 50 },
  { id: 'apprivoise', icon: '🐲', name: 'Dragon apprivoisé', text: 'La frénésie du Dragon dure deux minutes.', cost: 100 },
  { id: 'enveloppe', icon: '✉️', name: 'Enveloppe garnie', text: 'L’enveloppe du jour contient trois fois plus.', cost: 250 },
  { id: 'gros-bras', icon: '💪', name: 'Les gros bras', text: 'Les activités coûtent 10 % de moins.', cost: 500 },
  { id: 'famille', icon: '👨‍👩‍👧‍👦', name: 'La famille', text: 'Tout le tripot produit deux fois plus.', cost: 1_000 },
  { id: 'legende', icon: '📜', name: 'Légende du milieu', text: 'Chaque succès ajoute 2 % de production au lieu de 1 %.', cost: 2_500 },
  { id: 'empire', icon: '🏰', name: 'L’empire', text: 'Tout le tripot produit trois fois plus.', cost: 5_000 },
];

const hasFavor = (save: TripotSave, id: string) => save.favors.includes(id);
/** Faveurs encore à dépenser : une par point de réputation. */
export const favorPoints = (save: TripotSave) =>
  save.reputation - FAVORS.filter((f) => hasFavor(save, f.id)).reduce((sum, f) => sum + f.cost, 0);

/* ——— Succès ——— */

/** Un succès : gagné une fois pour toutes (même après un agrandissement), chacun ajoute 1 % de production. */
export interface Achievement {
  id: string;
  icon: string;
  name: string;
  text: string;
}
const ACHIEVEMENT_BONUS = 0.01;

const HAND_NAMES: Record<HandType, string> = {
  pair: 'Paire',
  trio: 'Brelan',
  straight: 'Suite',
  flush: 'Couleur',
  fullHouse: 'Full',
  straightFlush: 'Quinte flush',
  gang: 'Gang of Four',
};

const HAND_FEMININE: HandType[] = ['pair', 'straight', 'flush', 'straightFlush'];

/** Grands nombres, en toutes lettres (pour les succès). */
const BIG_WORDS: [number, string][] = [
  [1e24, 'quadrillion'],
  [1e21, 'trilliard'],
  [1e18, 'trillion'],
  [1e15, 'billiard'],
  [1e12, 'billion'],
  [1e9, 'milliard'],
  [1e6, 'million'],
  [1e3, 'mille'],
];
function inWords(n: number): string {
  const [size, word] = BIG_WORDS.find(([s]) => n >= s) ?? [1, ''];
  if (!word) return String(n);
  const count = n / size;
  return word === 'mille' ? `${count === 1 ? '' : `${count} `}mille`.trim() : `${count} ${word}${count > 1 ? 's' : ''}`;
}

interface AchievementRule extends Achievement {
  done: (save: TripotSave) => boolean;
}

const ACHIEVEMENT_RULES: AchievementRule[] = [
  ...[100, 1_000, 10_000, 100_000, 1_000_000].map((n, i) => ({
    id: `donnes-${n}`,
    icon: '🃏',
    name: ['Premières donnes', 'Le poignet chauffe', 'Distributeur fou', 'Tendinite', 'La main de fer'][i]!,
    text: `Distribuer ${inWords(n)}${n >= 1e6 ? ' de' : ''} cartes.`,
    done: (s: TripotSave) => s.deals >= n,
  })),
  ...[1e3, 1e6, 1e9, 1e12, 1e15, 1e18, 1e21, 1e24].map((n, i) => ({
    id: `jetons-${n}`,
    icon: '🪙',
    name: ['Petite monnaie', 'Millionnaire', 'Milliardaire', 'Le magot', 'Fortune obscène', 'Hors de contrôle', 'Plus de jetons que d’étoiles', 'Le tripot infini'][i]!,
    text: `Gagner ${inWords(n)}${n >= 1e6 ? ' de' : ''} jetons en tout.`,
    done: (s: TripotSave) => s.earnedAll >= n,
  })),
  ...BUILDINGS.flatMap((b) =>
    [1, 50, 100].map((n) => ({
      id: `${b.id}-${n}`,
      icon: b.icon,
      name: n === 1 ? `${b.name}` : `${n} ${b.plural}`,
      text: n === 1 ? `Accueillir dans ton tripot : ${b.name}.` : `Avoir ${n} ${b.plural} en même temps.`,
      done: (s: TripotSave) => (s.buildings[b.id] ?? 0) >= n,
    })),
  ),
  ...HAND_TYPES.map((t) => ({
    id: `main-${t}`,
    icon: '🂡',
    name: `${HAND_FEMININE.includes(t) ? 'Première' : 'Premier'} ${t === 'gang' ? HAND_NAMES[t] : HAND_NAMES[t].toLowerCase()}`,
    text: `Former ${HAND_FEMININE.includes(t) ? 'une' : 'un'} ${t === 'gang' ? HAND_NAMES[t] : HAND_NAMES[t].toLowerCase()} en distribuant.`,
    done: (s: TripotSave) => (s.hands[t] ?? 0) > 0,
  })),
  { id: 'gangs-10', icon: '💥', name: 'Collectionneur de gangs', text: 'Former dix Gang of Four en distribuant.', done: (s) => (s.hands.gang ?? 0) >= 10 },
  ...[1, 10, 100, 1000].map((n, i) => ({
    id: `passages-${n}`,
    icon: '🐉',
    name: ['Le Dragon est passé', 'Chasseur de dragons', 'Dompteur', 'Le Dragon, c’est toi'][i]!,
    text: `Attraper ${n === 1 ? 'le Dragon ou le Phénix' : `${n} passages du Dragon ou du Phénix`}.`,
    done: (s: TripotSave) => s.caught >= n,
  })),
  ...[1e3, 1e6, 1e9, 1e12, 1e15, 1e18].map((n, i) => ({
    id: `production-${n}`,
    icon: '⚙️',
    name: ['Ça tourne tout seul', 'La machine à jetons', 'Usine à sous', 'Le robinet ouvert', 'Les vannes du ciel', 'Le déluge'][i]!,
    text: `Produire ${inWords(n)}${n >= 1e6 ? ' de' : ''} jetons par seconde.`,
    done: (s: TripotSave) => productionOf(s) >= n,
  })),
  ...[1, 10, 50].map((n, i) => ({
    id: `agrandi-${n}`,
    icon: '🏛️',
    name: ['On pousse les murs', 'Agent immobilier', 'Bâtisseur d’empire'][i]!,
    text: n === 1 ? 'S’agrandir une première fois.' : `S’agrandir ${n} fois.`,
    done: (s: TripotSave) => s.grown >= n,
  })),
  ...VENUES.slice(2).map((v, i) => ({
    id: `etablissement-${i + 2}`,
    icon: '🏠',
    name: v.name,
    text: `Ouvrir : ${v.name}.`,
    done: (s: TripotSave) => s.reputation >= v.reputation,
  })),
  ...[3, 7, 30].map((n, i) => ({
    id: `serie-${n}`,
    icon: '📅',
    name: ['Un habitué', 'Toute la semaine', 'Pilier de comptoir'][i]!,
    text: `Ouvrir l’enveloppe du jour ${n} jours d’affilée.`,
    done: (s: TripotSave) => s.bestStreak >= n,
  })),
  ...[30, 100].map((n, i) => ({
    id: `visites-${n}`,
    icon: '🗝️',
    name: ['Tu as les clés', 'Tu fais partie des murs'][i]!,
    text: `Passer au tripot ${n} jours différents.`,
    done: (s: TripotSave) => s.visits >= n,
  })),
  { id: 'faveur-1', icon: '🤝', name: 'Un service rendu', text: 'Obtenir une faveur du milieu.', done: (s) => s.favors.length > 0 },
  { id: 'faveurs-toutes', icon: '🤵', name: 'Tout le milieu te doit', text: 'Obtenir toutes les faveurs du milieu.', done: (s) => s.favors.length >= FAVORS.length },
];
export const ACHIEVEMENTS: Achievement[] = ACHIEVEMENT_RULES.map(({ done: _d, ...a }) => a);

/* ——— La partie ——— */

/** La partie d'un joueur. */
export interface TripotSave {
  /** Version du format : les parties d'avant la refonte (sans version) repartent de zéro. */
  v: 2;
  /** Graine des mains distribuées. */
  seed: number;
  chips: number;
  /** Jetons gagnés depuis le dernier agrandissement, et depuis toujours. */
  earned: number;
  earnedAll: number;
  /** Cartes distribuées depuis toujours (la main en cours en est la fin). */
  deals: number;
  buildings: Record<string, number>;
  upgrades: string[];
  /** Réputation acquise en s'agrandissant. */
  reputation: number;
  /** Mains gagnantes depuis toujours, par combinaison. */
  hands: Partial<Record<HandType, number>>;
  /** Passages du Dragon ou du Phénix attrapés. */
  caught: number;
  achievements: string[];
  /** Prochain passage du Dragon ou du Phénix (millisecondes), et fin d'une frénésie en cours. */
  nextEventAt: number;
  frenzyUntil: number;
  /** Jours (à l'heure de Paris) où l'on est passé au Tripot, avec le niveau d'établissement ce jour-là (pour la rente). */
  days: Record<string, number>;
  /** Dernier calcul de la production (millisecondes). */
  updatedAt: number;
  /** Ce qui passera sur la table au prochain passage. */
  nextEventKind: EventKind;
  /** Cartes qui restent à rapporter dix fois plus (après le passage du 1 multicolore). */
  hotCards: number;
  /** Faveurs du milieu achetées (avec la réputation, pour toujours). */
  favors: string[];
  /** Dernier jour où l'enveloppe du jour a été ouverte, la série de jours d'affilée, la meilleure série, et les jours de visite. */
  giftDay: string;
  streak: number;
  bestStreak: number;
  visits: number;
  /** Agrandissements, et ouverture du tripot (millisecondes). */
  grown: number;
  createdAt: number;
}

/** Complète une partie enregistrée avant l'ajout de nouveaux champs. */
export function upgradeSave(save: TripotSave): TripotSave {
  return Object.assign(save, {
    nextEventKind: save.nextEventKind ?? 'dragon',
    hotCards: save.hotCards ?? 0,
    favors: save.favors ?? [],
    giftDay: save.giftDay ?? '',
    streak: save.streak ?? 0,
    bestStreak: save.bestStreak ?? 0,
    visits: save.visits ?? 0,
    grown: save.grown ?? 0,
    createdAt: save.createdAt ?? save.updatedAt,
  });
}

export const newSave = (now: number, seed = Math.floor(Math.random() * 2 ** 32)): TripotSave => ({
  v: 2,
  seed,
  chips: 0,
  earned: 0,
  earnedAll: 0,
  deals: 0,
  buildings: {},
  upgrades: [],
  reputation: 0,
  hands: {},
  caught: 0,
  achievements: [],
  nextEventAt: now + EVENT_FIRST_MS,
  frenzyUntil: 0,
  days: {},
  updatedAt: now,
  nextEventKind: 'dragon',
  hotCards: 0,
  favors: [],
  giftDay: '',
  streak: 0,
  bestStreak: 0,
  visits: 0,
  grown: 0,
  createdAt: now,
});

const owned = (save: TripotSave, id: string) => save.buildings[id] ?? 0;
const upgradeFactor = (save: TripotSave, target: string) =>
  UPGRADES.filter((u) => u.target === target && save.upgrades.includes(u.id)).reduce((f, u) => f * u.factor, 1);
const level = (save: TripotSave) => venueLevel(save.reputation);

/** Production ajoutée par chaque succès. */
export const achievementBonus = (save: TripotSave) => (hasFavor(save, 'legende') ? 2 : 1) * ACHIEVEMENT_BONUS;

/** Ce que rapportent les faveurs à tout le tripot. */
const favorFactor = (save: TripotSave) =>
  (hasFavor(save, 'parrain') ? 1.5 : 1) * (hasFavor(save, 'famille') ? 2 : 1) * (hasFavor(save, 'empire') ? 3 : 1);

/** Multiplicateur de tout le tripot : réputation, succès, cartes spéciales et faveurs. */
export function globalFactor(save: TripotSave): number {
  return (
    (1 + REPUTATION_BONUS * save.reputation) *
    (1 + achievementBonus(save) * save.achievements.length) *
    upgradeFactor(save, 'all') *
    favorFactor(save)
  );
}

/** Une activité au prix du joueur (les gros bras font baisser les prix). */
export const pricedBuilding = (save: TripotSave, b: Building): Building => (hasFavor(save, 'gros-bras') ? { ...b, cost: b.cost * 0.9 } : b);

/** Jetons produits par seconde par tout le tripot (hors frénésie). */
export function productionOf(save: TripotSave): number {
  const base = BUILDINGS.reduce((sum, b) => sum + owned(save, b.id) * b.rate * upgradeFactor(save, b.id), 0);
  return base * globalFactor(save);
}

/** Pendant une frénésie (le Dragon attrapé), tout le tripot produit sept fois plus. */
export const FRENZY_FACTOR = 7;
export const FRENZY_MS = 60_000;
const frenzyMs = (save: TripotSave) => (hasFavor(save, 'apprivoise') ? 2 : 1) * FRENZY_MS;
const frenzy = (save: TripotSave, now: number) => (now < save.frenzyUntil ? FRENZY_FACTOR : 1);

/** Après le passage du 1 multicolore, les cartes (et les combinaisons qu'elles forment) rapportent dix fois plus. */
export const HOT_FACTOR = 10;
export const HOT_CARDS = 50;

/** Jetons rapportés par une carte distribuée à la main (hors 1 multicolore). */
export function dealValue(save: TripotSave, now = save.updatedAt): number {
  const share = UPGRADES.filter((u) => u.target === 'dealRate' && save.upgrades.includes(u.id)).reduce((sum, u) => sum + u.factor, 0);
  const fingers = hasFavor(save, 'doigts-fee') ? 3 : 1;
  return upgradeFactor(save, 'deal') * fingers * globalFactor(save) + share * productionOf(save) * frenzy(save, now);
}

/** Jetons rapportés par une combinaison de la donne (hors 1 multicolore). */
export function handValue(save: TripotSave, type: HandType, now = save.updatedAt): number {
  const palace = level(save) >= 5 ? 3 : 1;
  const marked = hasFavor(save, 'marquees') ? 3 : 1;
  const base = Math.max(productionOf(save) * frenzy(save, now), upgradeFactor(save, 'deal') * globalFactor(save));
  return HAND_SECONDS[type] * base * upgradeFactor(save, 'hand') * palace * marked;
}

const handsWon = (save: TripotSave) => Object.values(save.hands).reduce((sum, n) => sum + (n ?? 0), 0);

/** Une amélioration est proposée (pas encore achetée) quand on remplit sa condition. */
export function upgradeAvailable(save: TripotSave, u: Upgrade): boolean {
  if (save.upgrades.includes(u.id)) return false;
  if (u.target === 'deal' || u.target === 'dealRate') return save.deals >= u.needs;
  if (u.target === 'hand') return handsWon(save) >= u.needs;
  if (u.id === 'gang-of-four') return BUILDINGS.slice(0, 8).every((b) => owned(save, b.id) >= u.needs);
  if (u.id === 'gang-of-seven') return BUILDINGS.every((b) => owned(save, b.id) >= u.needs);
  if (u.target === 'all') return save.earned >= u.needs;
  return owned(save, u.target) >= u.needs;
}

/* ——— Le temps qui passe ——— */

/** Au-delà de ce délai sans nouvelles, le joueur est parti : sa production continue, mais réduite et plafonnée. */
export const ONLINE_GAP_S = 120;
export const offlineFactor = (save: TripotSave) => (level(save) >= 2 ? 0.75 : 0.5) + (hasFavor(save, 'ardoise') ? 0.15 : 0);
export const offlineCapS = (save: TripotSave) =>
  ((level(save) >= 4 ? 24 : level(save) >= 1 ? 12 : 8) + (hasFavor(save, 'indic') ? 4 : 0)) * 3600;

/**
 * Fait tourner le tripot jusqu'à `now` : la production du temps écoulé (pleine pendant les deux premières minutes,
 * frénésie comprise, puis réduite pendant l'absence, plafonnée). Renvoie les jetons gagnés pendant l'absence.
 */
export function advance(save: TripotSave, now: number): number {
  const from = save.updatedAt;
  const elapsed = Math.max(0, (now - from) / 1000);
  save.updatedAt = Math.max(now, from);
  const rate = productionOf(save);
  const online = Math.min(elapsed, ONLINE_GAP_S);
  const frenzied = Math.max(0, Math.min(from / 1000 + online, save.frenzyUntil / 1000) - from / 1000);
  const away = Math.min(Math.max(0, elapsed - ONLINE_GAP_S), offlineCapS(save));
  const awayGain = away * rate * offlineFactor(save);
  earn(save, online * rate + frenzied * rate * (FRENZY_FACTOR - 1) + awayGain);
  return awayGain;
}

function earn(save: TripotSave, chips: number) {
  save.chips += chips;
  save.earned += chips;
  save.earnedAll += chips;
}

/** Clics par seconde au plus : au-delà, les cartes reçues sont ignorées (un clic automatique n'apporte rien). */
export const MAX_DEALS_PER_S = 15;

/** Ce qu'a rapporté un envoi de cartes : les mains complétées, avec leur combinaison et leur gain. */
export interface DealtHand {
  index: number;
  type: HandType | null;
  gain: number;
}

/** Ajoute les cartes distribuées à la main depuis le dernier envoi, plafonnées selon le temps écoulé. */
export function deal(save: TripotSave, count: number, elapsedS: number, now = save.updatedAt): DealtHand[] {
  const allowed = Math.max(0, Math.min(Math.floor(count), Math.ceil((elapsedS + 1) * MAX_DEALS_PER_S)));
  const hands: DealtHand[] = [];
  for (let i = 0; i < allowed; i++) {
    const hot = save.hotCards > 0 ? HOT_FACTOR : 1;
    save.hotCards = Math.max(0, save.hotCards - 1);
    earn(save, dealValue(save, now) * hot);
    save.deals++;
    if (save.deals % HAND_SIZE !== 0) continue;
    const index = save.deals / HAND_SIZE - 1;
    const type = bestHand(handOf(save.seed, index));
    const gain = type ? handValue(save, type, now) * hot : 0;
    if (type) {
      save.hands[type] = (save.hands[type] ?? 0) + 1;
      earn(save, gain);
    }
    hands.push({ index, type, gain });
  }
  return hands;
}

/* ——— Le Dragon, le Phénix et le 1 multicolore ——— */

/** Premier passage peu après l'ouverture, puis toutes les 4 à 9 minutes (deux fois plus souvent au Cercle de jeu). */
const EVENT_FIRST_MS = 90_000;
const EVENT_MIN_MS = 4 * 60_000;
const EVENT_SPREAD_MS = 5 * 60_000;
/** Le temps de cliquer dessus (deux fois plus avec les habitués), plus une marge pour le réseau. */
export const EVENT_WINDOW_MS = 12_000;
export const eventWindowMs = (save: TripotSave) => (hasFavor(save, 'habitues') ? 2 : 1) * EVENT_WINDOW_MS;
const EVENT_SLACK_MS = 3_000;

/** Ce qui passe sur la table : le Dragon (frénésie), le Phénix (butin) ou, plus rare, le 1 multicolore (main chaude). */
export type EventKind = 'dragon' | 'phenix' | 'multi';
export type EventResult = { kind: 'frenzy'; until: number } | { kind: 'loot'; gain: number } | { kind: 'hot'; cards: number };

function scheduleEvent(save: TripotSave, now: number, random: () => number) {
  const delay = EVENT_MIN_MS + random() * EVENT_SPREAD_MS;
  save.nextEventAt = now + (level(save) >= 3 ? delay / 2 : delay);
  const draw = random();
  save.nextEventKind = draw < 0.4 ? 'dragon' : draw < 0.8 ? 'phenix' : 'multi';
}

/** Un passage manqué est reporté au suivant. */
export function skipMissedEvent(save: TripotSave, now: number, random = Math.random) {
  if (now > save.nextEventAt + eventWindowMs(save) + EVENT_SLACK_MS) scheduleEvent(save, now, random);
}

/**
 * Attraper le passage en cours : le Dragon lance une frénésie (production ×7 pendant une minute), le Phénix apporte
 * un butin (un quart d'heure de production, sans dépasser 15 % des jetons en poche, et au moins de quoi démarrer), le
 * 1 multicolore rend les 50 cartes suivantes dix fois plus rentables.
 */
export function catchEvent(save: TripotSave, now: number, random = Math.random): EventResult | BuyError {
  if (now < save.nextEventAt - EVENT_SLACK_MS || now > save.nextEventAt + eventWindowMs(save) + EVENT_SLACK_MS) return 'notAvailable';
  const kind = save.nextEventKind;
  save.caught++;
  scheduleEvent(save, now, random);
  if (kind === 'dragon') {
    save.frenzyUntil = now + frenzyMs(save);
    return { kind: 'frenzy', until: save.frenzyUntil };
  }
  if (kind === 'multi') {
    save.hotCards += HOT_CARDS;
    return { kind: 'hot', cards: save.hotCards };
  }
  const gain = Math.max(Math.min(productionOf(save) * 900, save.chips * 0.15), 50 * dealValue(save, now));
  earn(save, gain);
  return { kind: 'loot', gain };
}

/* ——— L'enveloppe du jour ——— */

/** Jour précédent d'un jour « 2026-11-04 ». */
function dayBefore(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** L'enveloppe grossit avec la série de jours d'affilée, jusqu'à sept. */
export const GIFT_MAX_STREAK = 7;

/**
 * Au premier passage de la journée, une enveloppe : vingt minutes de production par jour de série (au moins de
 * quoi faire quelques achats au début). Renvoie ce qu'elle contenait, ou null si elle est déjà ouverte.
 */
export function openGift(save: TripotSave, day: string, now = save.updatedAt): number | null {
  if (save.giftDay === day) return null;
  save.streak = save.giftDay === dayBefore(day) ? save.streak + 1 : 1;
  save.bestStreak = Math.max(save.bestStreak, save.streak);
  save.giftDay = day;
  save.visits++;
  const gain =
    Math.min(save.streak, GIFT_MAX_STREAK) *
    Math.max(productionOf(save) * 1200, dealValue(save, now) * 100) *
    (hasFavor(save, 'enveloppe') ? 3 : 1);
  earn(save, gain);
  return gain;
}

/* ——— Achats ——— */

export type BuyError = 'unknownItem' | 'tooExpensive' | 'notAvailable';

/** Achète `count` exemplaires d'une activité (ou autant que possible avec `max`). */
export function buyBuilding(save: TripotSave, id: string, count: number | 'max' = 1): BuyError | null {
  const found = BUILDINGS.find((x) => x.id === id);
  if (!found) return 'unknownItem';
  const b = pricedBuilding(save, found);
  const n = count === 'max' ? affordable(b, owned(save, id), save.chips) : Math.max(1, Math.min(100, Math.floor(count) || 1));
  const cost = n > 0 ? bulkCost(b, owned(save, id), n) : Infinity;
  if (save.chips < cost) return 'tooExpensive';
  save.chips -= cost;
  save.buildings[id] = owned(save, id) + n;
  return null;
}

export function buyUpgrade(save: TripotSave, id: string): BuyError | null {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return 'unknownItem';
  if (!upgradeAvailable(save, u)) return 'notAvailable';
  if (save.chips < u.cost) return 'tooExpensive';
  save.chips -= u.cost;
  save.upgrades.push(id);
  return null;
}

/** Achète toutes les améliorations proposées qu'on peut s'offrir, de la moins chère à la plus chère. */
export function buyAllUpgrades(save: TripotSave): BuyError | null {
  const bought = UPGRADES.filter((u) => upgradeAvailable(save, u))
    .sort((a, b) => a.cost - b.cost)
    .filter((u) => buyUpgrade(save, u.id) === null);
  return bought.length > 0 ? null : 'tooExpensive';
}

export function buyFavor(save: TripotSave, id: string): BuyError | null {
  const f = FAVORS.find((x) => x.id === id);
  if (!f) return 'unknownItem';
  if (hasFavor(save, id)) return 'notAvailable';
  if (favorPoints(save) < f.cost) return 'tooExpensive';
  save.favors.push(id);
  return null;
}

/**
 * S'agrandir : on repart de zéro (jetons, activités, améliorations) et l'on encaisse la réputation méritée depuis le
 * début. Les succès, les faveurs, les cartes distribuées et les mains gagnées restent.
 */
export function prestige(save: TripotSave): BuyError | null {
  const reputation = reputationFor(save.earnedAll);
  if (reputation <= save.reputation) return 'notAvailable';
  const buildings = hasFavor(save, 'mise') ? { croupier: 10 } : {};
  Object.assign(save, { chips: 0, earned: 0, buildings, upgrades: [], reputation, frenzyUntil: 0, hotCards: 0, grown: save.grown + 1 });
  return null;
}

/** Ajoute les succès nouvellement remplis ; renvoie leurs identifiants. */
export function checkAchievements(save: TripotSave): string[] {
  const fresh = ACHIEVEMENT_RULES.filter((a) => !save.achievements.includes(a.id) && a.done(save)).map((a) => a.id);
  save.achievements.push(...fresh);
  return fresh;
}

/** Note le passage du jour (pour la rente), avec l'établissement atteint. */
export function markDay(save: TripotSave, day: string) {
  save.days[day] = Math.max(save.days[day] ?? 0, level(save));
}

/** Expérience versée par la rente, sur tous les jours passés au Tripot. */
export const rentOf = (save: TripotSave) => Object.values(save.days).reduce((sum, l) => sum + rentXp(l), 0);

/* ——— Ce que voit le joueur ——— */

/** Une amélioration pas encore proposée, mais qu'on peut viser : on possède déjà ce qu'elle concerne. */
function upgradeInSight(save: TripotSave, u: Upgrade): boolean {
  if (BUILDINGS.some((b) => b.id === u.target)) return owned(save, u.target) > 0;
  if (u.id === 'gang-of-seven') return BUILDINGS.every((b) => owned(save, b.id) > 0);
  return true;
}

/** Ce qu'il faut pour qu'une amélioration soit proposée. */
function upgradeHint(u: Upgrade): string {
  const n = intFormat.format(u.needs);
  if (u.target === 'deal' || u.target === 'dealRate') return `À ${n} cartes distribuées`;
  if (u.target === 'hand') return `À ${n} mains gagnantes`;
  if (u.id === 'gang-of-four') return 'Avec 4 de chacune des huit premières activités';
  if (u.id === 'gang-of-seven') return 'Avec 7 de chacune des seize activités';
  if (u.target === 'all') return `À ${inWords(u.needs)} de jetons gagnés depuis l’agrandissement`;
  const b = BUILDINGS.find((x) => x.id === u.target);
  const single = b ? b.name.charAt(0).toLowerCase() + b.name.slice(1) : '';
  return `Avec ${n} ${u.needs === 1 ? single : b?.plural}`;
}
const intFormat = new Intl.NumberFormat('fr-FR');

export interface TripotView {
  seed: number;
  chips: number;
  earned: number;
  earnedAll: number;
  deals: number;
  rate: number;
  dealValue: number;
  /** Ce que rapporterait chaque combinaison maintenant. */
  handValues: Record<HandType, number>;
  hands: Partial<Record<HandType, number>>;
  frenzyUntil: number;
  nextEventAt: number;
  /** Heure du serveur au moment de l'envoi, pour caler les passages du Dragon sur l'horloge de l'écran. */
  now: number;
  reputation: number;
  /** Réputation que rapporterait un agrandissement maintenant, et jetons (depuis toujours) pour un point de plus. */
  reputationGain: number;
  nextReputationAt: number;
  bonus: number;
  venue: string;
  level: number;
  perks: string[];
  nextVenue: { name: string; reputation: number; perk: string } | null;
  offlineFactor: number;
  offlineHours: number;
  /** Rente quotidienne d'expérience (null tant que le Tripot n'est pas ouvert à tous). */
  rent: number | null;
  /** Jetons gagnés pendant l'absence, annoncés au retour, et durée de l'absence (secondes). */
  awayGain: number;
  awaySeconds: number;
  /** L'enveloppe du jour, si elle vient d'être ouverte. */
  gift: { gain: number; streak: number } | null;
  streak: number;
  /** Ce qui passera au prochain passage, et le temps qu'il reste sur la table (millisecondes). */
  eventKind: EventKind;
  eventWindow: number;
  /** Cartes qui rapportent encore dix fois plus. */
  hotCards: number;
  /** Production ajoutée par chaque succès. */
  achievementBonus: number;
  favorPoints: number;
  favors: (Favor & { owned: boolean })[];
  /** Les prochaines améliorations, avec ce qu'il faut pour qu'elles soient proposées. */
  nextUpgrades: { id: string; icon: string; name: string; hint: string }[];
  stats: { grown: number; visits: number; bestStreak: number; caught: number; createdAt: number; handsWon: number };
  buildings: (Building & { owned: number; price: number })[];
  upgrades: (Omit<Upgrade, 'needs' | 'factor' | 'target'> & { available: boolean })[];
  achievements: (Achievement & { done: boolean })[];
  /** Succès gagnés par ce dernier envoi, à annoncer. */
  newAchievements: string[];
  /** Mains complétées par ce dernier envoi. */
  dealt: DealtHand[];
}

export function viewOf(
  save: TripotSave,
  now: number,
  extra: { awayGain?: number; awaySeconds?: number; gift?: number | null; rentOpen?: boolean; newAchievements?: string[]; dealt?: DealtHand[] } = {},
): TripotView {
  const lvl = level(save);
  const reputationNow = reputationFor(save.earnedAll);
  const next = venueReputation(lvl + 1);
  return {
    seed: save.seed,
    chips: save.chips,
    earned: save.earned,
    earnedAll: save.earnedAll,
    deals: save.deals,
    rate: productionOf(save),
    dealValue: dealValue(save, now),
    handValues: Object.fromEntries(HAND_TYPES.map((t) => [t, handValue(save, t, now)])) as Record<HandType, number>,
    hands: save.hands,
    frenzyUntil: save.frenzyUntil,
    nextEventAt: save.nextEventAt,
    now,
    reputation: save.reputation,
    reputationGain: Math.max(0, reputationNow - save.reputation),
    nextReputationAt: earnedForReputation(reputationNow + 1),
    bonus: globalFactor(save),
    venue: venueName(lvl),
    level: lvl,
    perks: VENUES.slice(1, lvl + 1).map((v) => v.perk),
    nextVenue: { name: venueName(lvl + 1), reputation: next, perk: VENUES[lvl + 1]?.perk ?? 'Une étoile de plus, et une rente plus généreuse.' },
    offlineFactor: offlineFactor(save),
    offlineHours: offlineCapS(save) / 3600,
    rent: extra.rentOpen ? rentXp(lvl) : null,
    awayGain: extra.awayGain ?? 0,
    awaySeconds: extra.awaySeconds ?? 0,
    gift: extra.gift ? { gain: extra.gift, streak: save.streak } : null,
    streak: save.streak,
    eventKind: save.nextEventKind,
    eventWindow: eventWindowMs(save),
    hotCards: save.hotCards,
    achievementBonus: achievementBonus(save),
    favorPoints: favorPoints(save),
    favors: FAVORS.map((f) => ({ ...f, owned: hasFavor(save, f.id) })),
    nextUpgrades: UPGRADES.filter((u) => !save.upgrades.includes(u.id) && !upgradeAvailable(save, u) && upgradeInSight(save, u))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, 3)
      .map((u) => ({ id: u.id, icon: u.icon, name: u.name, hint: upgradeHint(u) })),
    stats: { grown: save.grown, visits: save.visits, bestStreak: save.bestStreak, caught: save.caught, createdAt: save.createdAt, handsWon: handsWon(save) },
    buildings: BUILDINGS.map((b) => {
      const priced = pricedBuilding(save, b);
      return { ...priced, rate: b.rate * upgradeFactor(save, b.id) * globalFactor(save), owned: owned(save, b.id), price: buildingCost(priced, owned(save, b.id)) };
    }),
    // Les améliorations proposées, de la moins chère à la plus chère ; les achetées en dernier.
    upgrades: UPGRADES.filter((u) => upgradeAvailable(save, u) || save.upgrades.includes(u.id))
      .map(({ needs: _n, factor: _f, target: _t, ...u }) => ({ ...u, available: !save.upgrades.includes(u.id) }))
      .sort((a, b) => Number(b.available) - Number(a.available) || a.cost - b.cost),
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, done: save.achievements.includes(a.id) })),
    newAchievements: extra.newAchievements ?? [],
    dealt: extra.dealt ?? [],
  };
}
