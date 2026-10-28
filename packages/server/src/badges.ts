import { type ChallengeStats, NO_CHALLENGE } from './challenges';
import type { GameRecord } from './history';

/** Un badge d'un joueur : `value` sur `goal`, obtenu dès que `value` atteint `goal`. */
export interface Badge {
  /** Thème du badge (parties jouées, victoires, gangs…), pour les ranger. */
  theme: string;
  id: string;
  icon: string;
  name: string;
  description: string;
  value: number;
  goal: number;
}

/** Une partie vue par un joueur : la partie, et sa ligne à lui. */
type Game = { record: GameRecord; me: GameRecord['players'][number] };

type Definition = { theme?: string; id: string; icon: string; name: string; description: string; goal: number; value: (games: Game[], challenges: ChallengeStats) => number };

/** Range des badges sous un thème (pour la page des badges). */
const themed = (theme: string, definitions: Definition[]) => definitions.map((d) => ({ ...d, theme }));

/** Badge obtenu dès qu'une seule partie remplit la condition. */
const once = (id: string, icon: string, name: string, description: string, test: (g: Game) => boolean): Definition => ({
  id,
  icon,
  name,
  description,
  goal: 1,
  value: (games) => (games.some(test) ? 1 : 0),
});

/**
 * Badges à gagner, du plus simple au plus rare, rangés par thème. Ils comptent toutes les parties
 * (en ligne et contre les bots), sauf ceux qui parlent explicitement de jouer avec d'autres personnes ou contre les bots.
 */
const BADGES: Definition[] = [
  ...themed('Parties jouées', [
    { id: 'games-1', icon: '👋', name: 'Bienvenue', description: 'Joue ta première partie.', goal: 1, value: (g) => g.length },
    { id: 'games-25', icon: '🃏', name: 'Habitué', description: 'Joue 25 parties.', goal: 25, value: (g) => g.length },
    { id: 'games-100', icon: '🪑', name: 'Pilier', description: 'Joue 100 parties.', goal: 100, value: (g) => g.length },
    { id: 'games-250', icon: '🎖️', name: 'Vétéran', description: 'Joue 250 parties.', goal: 250, value: (g) => g.length },
    { id: 'games-500', icon: '🗿', name: 'Légende du bureau', description: 'Joue 500 parties.', goal: 500, value: (g) => g.length },
    { id: 'games-1000', icon: '♾️', name: 'Immortel', description: 'Joue 1 000 parties.', goal: 1000, value: (g) => g.length },
  ]),
  ...themed('Avec les collègues', [
    { id: 'online-25', icon: '👥', name: 'Bon collègue', description: 'Joue 25 parties en ligne, avec au moins une autre personne.', goal: 25, value: (g) => online(g).length },
    { id: 'online-100', icon: '☕', name: 'Pilier de la pause café', description: 'Joue 100 parties en ligne.', goal: 100, value: (g) => online(g).length },
    { id: 'online-wins-10', icon: '🏢', name: 'Roi du bureau', description: 'Gagne 10 parties en ligne.', goal: 10, value: (g) => wins(online(g)) },
    { id: 'online-wins-50', icon: '🏛️', name: 'Empereur du bureau', description: 'Gagne 50 parties en ligne.', goal: 50, value: (g) => wins(online(g)) },
    { id: 'friends-10', icon: '🤝', name: 'Grande famille', description: 'Joue avec 10 personnes différentes.', goal: 10, value: (g) => partners(g) },
    { id: 'friends-25', icon: '🏙️', name: 'Tout le bureau', description: 'Joue avec 25 personnes différentes.', goal: 25, value: (g) => partners(g) },
    once('full-table', '🎯', 'Table complète', 'Gagne une partie face à trois autres personnes.', (x) => x.me.winner && humans(x) >= 4),
  ]),
  ...themed('Contre les bots', [
    { id: 'bots-wins-10', icon: '🤖', name: 'Dompteur de robots', description: 'Gagne 10 parties seul contre des bots.', goal: 10, value: (g) => wins(g.filter((x) => humans(x) < 2)) },
    { id: 'bots-wins-50', icon: '🦾', name: 'Terminator', description: 'Gagne 50 parties seul contre des bots.', goal: 50, value: (g) => wins(g.filter((x) => humans(x) < 2)) },
    { id: 'hard-games-25', icon: '🔧', name: 'Mécano', description: 'Joue 25 parties contre au moins un bot difficile.', goal: 25, value: (g) => g.filter((x) => x.record.players.some((p) => p.botLevel === 'hard')).length },
    once('beat-hard-1', '🧠', 'Plus fort que la machine', 'Gagne une partie seul contre des bots tous en difficile.', (x) => x.me.winner && allHard(x)),
    { id: 'beat-hard-10', icon: '⚙️', name: 'Maître des machines', description: 'Gagne 10 parties seul contre des bots tous en difficile.', goal: 10, value: (g) => wins(g.filter(allHard)) },
  ]),
  ...themed('Victoires', [
    { id: 'first-win', icon: '🏆', name: 'Premier sang', description: 'Gagne une partie.', goal: 1, value: (g) => wins(g) },
    { id: 'wins-5', icon: '🌱', name: 'Prometteur', description: 'Gagne 5 parties.', goal: 5, value: (g) => wins(g) },
    { id: 'wins-25', icon: '🎩', name: 'Chef de gang', description: 'Gagne 25 parties.', goal: 25, value: (g) => wins(g) },
    { id: 'wins-75', icon: '👑', name: 'Parrain', description: 'Gagne 75 parties.', goal: 75, value: (g) => wins(g) },
    { id: 'wins-150', icon: '🦁', name: 'Le Boss', description: 'Gagne 150 parties.', goal: 150, value: (g) => wins(g) },
    once('win-3', '🥉', 'Trio gagnant', 'Gagne une partie à 3 joueurs.', (x) => x.me.winner && x.record.players.length === 3),
    once('win-4', '🍀', 'Carré gagnant', 'Gagne une partie à 4 joueurs.', (x) => x.me.winner && x.record.players.length === 4),
  ]),
  ...themed('Séries', [
    { id: 'streak-2', icon: '✌️', name: 'Doublé', description: '2 victoires d’affilée.', goal: 2, value: (g) => streak(g, (x) => x.me.winner) },
    { id: 'streak-4', icon: '🔥', name: 'En série', description: '4 victoires d’affilée.', goal: 4, value: (g) => streak(g, (x) => x.me.winner) },
    { id: 'streak-7', icon: '⚡', name: 'Intouchable', description: '7 victoires d’affilée.', goal: 7, value: (g) => streak(g, (x) => x.me.winner) },
    { id: 'streak-10', icon: '💎', name: 'Invincible', description: '10 victoires d’affilée.', goal: 10, value: (g) => streak(g, (x) => x.me.winner) },
  ]),
  ...themed('Places', [
    { id: 'second-10', icon: '🥈', name: 'Éternel second', description: 'Finis 10 parties à la deuxième place.', goal: 10, value: (g) => g.filter((x) => rank(x) === 2).length },
    { id: 'last-10', icon: '🏮', name: 'Lanterne rouge', description: 'Finis 10 parties à la dernière place.', goal: 10, value: (g) => g.filter(last).length },
    { id: 'bad-streak-5', icon: '☔', name: 'La poisse', description: '5 défaites d’affilée.', goal: 5, value: (g) => streak(g, (x) => !x.me.winner) },
  ]),
  ...themed('Manches', [
    once('hot-hand', '🌶️', 'Main chaude', 'Gagne 5 manches dans une même partie.', (x) => (x.me.roundsWon ?? 0) >= 5),
    once('masterclass', '🎓', 'Démonstration', 'Gagne 8 manches dans une même partie.', (x) => (x.me.roundsWon ?? 0) >= 8),
    { id: 'steamroller', icon: '🚜', name: 'Rouleau compresseur', description: 'Gagne 100 manches, toutes parties confondues.', goal: 100, value: (g) => sum(g, (x) => x.me.roundsWon ?? 0) },
    { id: 'bulldozer', icon: '🏗️', name: 'Bulldozer', description: 'Gagne 500 manches, toutes parties confondues.', goal: 500, value: (g) => sum(g, (x) => x.me.roundsWon ?? 0) },
    { id: 'marathon', icon: '🏃', name: 'Marathon', description: 'Joue une partie de 20 manches.', goal: 20, value: (g) => max(g, (x) => x.record.rounds) },
    { id: 'ultra-trail', icon: '🏔️', name: 'Ultra-trail', description: 'Joue une partie de 30 manches.', goal: 30, value: (g) => max(g, (x) => x.record.rounds) },
    once('blitz', '⏱️', 'Éclair', 'Gagne une partie en 4 manches ou moins.', (x) => x.me.winner && x.record.rounds <= 4),
  ]),
  ...themed('Gangs', [
    { id: 'gang-1', icon: '💥', name: 'Gang of Four', description: 'Pose un gang.', goal: 1, value: (g) => sum(g, (x) => x.me.gangs ?? 0) },
    { id: 'gang-25', icon: '🧨', name: 'Dynamiteur', description: 'Pose 25 gangs.', goal: 25, value: (g) => sum(g, (x) => x.me.gangs ?? 0) },
    { id: 'gang-100', icon: '🎇', name: 'Artificier en chef', description: 'Pose 100 gangs.', goal: 100, value: (g) => sum(g, (x) => x.me.gangs ?? 0) },
    { id: 'fireworks', icon: '🎆', name: 'Feu d’artifice', description: 'Pose 3 gangs dans une même partie.', goal: 3, value: (g) => max(g, (x) => x.me.gangs ?? 0) },
    { id: 'bouquet', icon: '💐', name: 'Bouquet final', description: 'Pose 5 gangs dans une même partie.', goal: 5, value: (g) => max(g, (x) => x.me.gangs ?? 0) },
  ]),
  ...themed('Scores', [
    once('perfect', '💯', 'Parfait', 'Gagne une partie sans prendre un seul point.', (x) => x.me.winner && x.me.score === 0),
    once('clean-win', '🛡️', 'Sans une égratignure', 'Gagne une partie avec moins de 10 points.', (x) => x.me.winner && x.me.score < 10),
    once('photo-finish', '📸', 'Photo finish', 'Gagne une partie avec un seul point d’avance.', (x) => x.me.winner && margin(x) === 1),
    once('crushing', '🐘', 'Écrasant', 'Gagne une partie avec 80 points d’avance sur le deuxième.', (x) => x.me.winner && margin(x) >= 80),
    once('cold-shower', '🚿', 'Douche froide', 'Prends 40 points en une manche.', (x) => (x.me.worstRound ?? 0) >= 40),
    once('scapegoat', '🐐', 'Bouc émissaire', 'Prends 80 points en une manche.', (x) => (x.me.worstRound ?? 0) >= 80),
    once('castaway', '⚓', 'Naufragé', 'Finis une partie avec 150 points ou plus.', (x) => x.me.score >= 150),
  ]),
  ...themed('Défi du jour', [
    { id: 'challenge-1', icon: '📆', name: 'Relève le gant', description: 'Joue ton premier défi du jour.', goal: 1, value: (_g, c) => c.played },
    { id: 'challenge-win-1', icon: '🎲', name: 'Défi relevé', description: 'Gagne un défi du jour.', goal: 1, value: (_g, c) => c.wins },
    { id: 'challenge-win-10', icon: '🧩', name: 'Casse-tête', description: 'Gagne 10 défis du jour.', goal: 10, value: (_g, c) => c.wins },
    { id: 'challenge-streak-7', icon: '🔁', name: 'Rituel', description: 'Joue le défi 7 jours d’affilée.', goal: 7, value: (_g, c) => c.bestStreak },
    { id: 'challenge-podium', icon: '🏅', name: 'Podium du jour', description: 'Finis une journée de défi dans les trois premiers (au moins 3 joueurs).', goal: 1, value: (_g, c) => c.podiums },
    { id: 'challenge-first', icon: '🌟', name: 'Numéro 1 du jour', description: 'Finis une journée de défi à la première place (au moins 3 joueurs).', goal: 1, value: (_g, c) => c.firsts },
  ]),
  ...themed('Moments', [
    once('early-bird', '🌅', 'Lève-tôt', 'Termine une partie avant 9 h.', (x) => paris(x).hour < 9),
    { id: 'lunch-10', icon: '🥪', name: 'Pause déj', description: 'Termine 10 parties entre midi et 14 h.', goal: 10, value: (g) => g.filter((x) => paris(x).hour >= 12 && paris(x).hour < 14).length },
    once('night-owl', '🦉', 'Oiseau de nuit', 'Termine une partie après 21 h.', (x) => paris(x).hour >= 21),
    once('weekend', '🗓️', 'Heures sup', 'Joue une partie un samedi ou un dimanche.', (x) => paris(x).weekend),
    { id: 'days-20', icon: '📅', name: 'Fidèle', description: 'Joue 20 jours différents.', goal: 20, value: (g) => new Set(g.map((x) => paris(x).day)).size },
  ]),
];

const sum = (games: Game[], f: (g: Game) => number) => games.reduce((total, g) => total + f(g), 0);
const max = (games: Game[], f: (g: Game) => number) => Math.max(0, ...games.map(f));
const wins = (games: Game[]) => games.filter((g) => g.me.winner).length;

/** Nombre de personnes (pas de bots) à la table de cette partie. */
const humans = (g: Game) => g.record.players.filter((p) => !p.bot).length;
/** Seul contre des bots, tous réglés en difficile. */
const allHard = (g: Game) => humans(g) < 2 && g.record.players.filter((p) => p.bot).every((p) => p.botLevel === 'hard');
/** Parties en ligne : au moins deux personnes à la table. */
const online = (games: Game[]) => games.filter((g) => humans(g) >= 2);
/** Place à la fin de la partie (1 = le score le plus bas ; à égalité, même place). */
const rank = (g: Game) => 1 + g.record.players.filter((p) => p.score < g.me.score).length;
/** Dernier : personne n'a fait pire, et la partie n'est pas une égalité générale. */
const last = (g: Game) => !g.me.winner && g.record.players.every((p) => p.score <= g.me.score);
/** Avance du gagnant sur le meilleur des autres joueurs. */
const margin = (g: Game) => Math.min(...g.record.players.filter((p) => p !== g.me).map((p) => p.score)) - g.me.score;

/** Personnes différentes (pas de bots) rencontrées à la table, reconnues par leur compte, sinon leur pseudo. */
function partners(games: Game[]): number {
  const people = new Set<string>();
  for (const g of games) {
    for (const p of g.record.players) {
      if (p === g.me || p.bot) continue;
      people.add(p.account ?? `pseudo:${p.name.trim().toLocaleLowerCase('fr')}`);
    }
  }
  return people.size;
}

const parisParts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Heure, jour et week-end de la fin de partie, à l'heure de Paris. */
function paris(g: Game): { hour: number; day: string; weekend: boolean } {
  const parts = Object.fromEntries(parisParts.formatToParts(new Date(g.record.finishedAt)).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), day: `${parts.year}-${parts.month}-${parts.day}`, weekend: [0, 6].includes(new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay()) };
}

/** Plus longue série de parties d'affilée qui remplissent la condition (dans l'ordre où elles ont été jouées). */
function streak(games: Game[], test: (g: Game) => boolean): number {
  let best = 0;
  let current = 0;
  for (const g of games) {
    current = test(g) ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

/** Badges d'un joueur à partir de ses parties (de la plus ancienne à la plus récente) et de ses défis du jour. */
export function badgesOf(games: Game[], challenges: ChallengeStats = NO_CHALLENGE, definitions = BADGES): Badge[] {
  return definitions.map(({ value, theme = '', ...badge }) => ({ ...badge, theme, value: Math.min(value(games, challenges), badge.goal) }));
}

/**
 * Badges qu'on peut gagner pendant une partie, au moment même où ça arrive : ils ne dépendent que de ce que
 * la partie a déjà accumulé (gangs, manches gagnées, pire manche, nombre de manches), qui ne fait que monter.
 * Les autres (victoires, places, parties jouées, horaires…) attendent la fin de la partie.
 */
const LIVE = new Set(['hot-hand', 'masterclass', 'steamroller', 'bulldozer', 'marathon', 'ultra-trail', 'gang-1', 'gang-25', 'gang-100', 'fireworks', 'bouquet', 'cold-shower', 'scapegoat']);

/** Badges « en direct » d'un joueur, en comptant la partie en cours parmi ses parties. */
export function liveBadgesOf(games: Game[]): Badge[] {
  return badgesOf(
    games,
    NO_CHALLENGE,
    BADGES.filter((b) => LIVE.has(b.id)),
  );
}
