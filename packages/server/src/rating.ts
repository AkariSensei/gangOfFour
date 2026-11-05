/**
 * Les points de classement, façon Elo : chacun part de 1000 points à chaque saison, dans chaque jeu. Une victoire
 * rapporte d'autant plus que l'adversaire était fort, une défaite coûte d'autant moins. Les dix premières parties
 * comptent plus fort, pour qu'un nouveau trouve vite son niveau.
 *
 * À plus de deux joueurs, chaque paire compte comme un duel selon le classement final de la partie, et le total est
 * ramené à la taille d'un duel (divisé par le nombre d'adversaires).
 */
export const START_RATING = 1000;
/** Écart maximal pour un duel, une fois le joueur installé. */
const K = 32;
/** Pendant les premières parties, les points bougent plus vite. */
const K_NEW = 48;
const NEW_GAMES = 10;

/** Une partie classée : pour chaque joueur humain, qui il est et sa place (0 : premier ; égalité = même place). */
export interface RatedGame {
  players: { owner: string; name: string; place: number; winner: boolean }[];
}

export interface Rating {
  owner: string;
  name: string;
  rating: number;
  games: number;
  wins: number;
}

/** Chances de gagner de `a` contre `b`, d'après l'écart de points. */
export function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** Rejoue les parties dans l'ordre et donne les points de chacun (non arrondis, pour ne pas cumuler d'erreurs). */
export function computeRatings(games: RatedGame[]): Map<string, Rating> {
  const ratings = new Map<string, Rating>();
  const get = (owner: string, name: string) => {
    let r = ratings.get(owner);
    if (!r) ratings.set(owner, (r = { owner, name, rating: START_RATING, games: 0, wins: 0 }));
    r.name = name;
    return r;
  };
  for (const game of games) {
    const players = game.players;
    if (players.length < 2) continue;
    const before = players.map((p) => get(p.owner, p.name).rating);
    const deltas = players.map((p, i) => {
      const me = get(p.owner, p.name);
      const k = me.games < NEW_GAMES ? K_NEW : K;
      let sum = 0;
      players.forEach((q, j) => {
        if (i === j) return;
        const score = p.place < q.place ? 1 : p.place > q.place ? 0 : 0.5;
        sum += score - expected(before[i]!, before[j]!);
      });
      return (k * sum) / (players.length - 1);
    });
    players.forEach((p, i) => {
      const me = get(p.owner, p.name);
      me.rating += deltas[i]!;
      me.games += 1;
      if (p.winner) me.wins += 1;
    });
  }
  return ratings;
}

/** Points affichés : un entier. */
export const shown = (rating: number) => Math.round(rating);
