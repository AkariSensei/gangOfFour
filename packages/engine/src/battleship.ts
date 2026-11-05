import { createRng } from './random';

/**
 * Bataille navale à deux, sur une grille de 10 × 10. Chacun place sa flotte en secret (cinq bateaux, qui ne se
 * touchent pas, même en diagonale), puis on tire chacun son tour. Le premier qui coule toute la flotte adverse gagne.
 * Une case est un nombre de 0 à 99 : ligne × 10 + colonne.
 */

export const GRID = 10;
/** La flotte, du plus grand au plus petit. */
export const FLEET = [
  { size: 5, name: 'Porte-avions' },
  { size: 4, name: 'Croiseur' },
  { size: 3, name: 'Contre-torpilleur' },
  { size: 3, name: 'Sous-marin' },
  { size: 2, name: 'Torpilleur' },
];

/** Un bateau : ses cases, dans l'ordre, d'un bout à l'autre. */
export interface Ship {
  cells: number[];
}

export type ShotResult = 'miss' | 'hit' | 'sunk';

export interface Shot {
  cell: number;
  result: ShotResult;
}

export interface BattleshipPlayer {
  id: string;
  name: string;
  /** Sa flotte, null tant qu'il ne l'a pas placée. */
  ships: Ship[] | null;
  /** Ses tirs sur la grille de l'adversaire, dans l'ordre. */
  shots: Shot[];
}

export interface BattleshipState {
  seed: number;
  phase: 'placing' | 'playing' | 'gameOver';
  players: BattleshipPlayer[];
  currentPlayer: number;
  /** Dernier tir de la partie, pour l'annoncer à la table. */
  lastShot: (Shot & { playerIndex: number; ship?: number }) | null;
  winners: number[];
}

export type BattleshipAction =
  | { type: 'place'; playerIndex: number; ships: Ship[] }
  | { type: 'shoot'; playerIndex: number; cell: number };

export type BattleshipError = 'wrongPhase' | 'notYourTurn' | 'invalidFleet' | 'alreadyPlaced' | 'invalidCell' | 'alreadyShot';
export type BattleshipResult = { ok: true; state: BattleshipState } | { ok: false; error: BattleshipError };

const rowOf = (cell: number) => Math.floor(cell / GRID);
const colOf = (cell: number) => cell % GRID;

/** Les cases voisines (les huit autour), dans la grille. */
export function neighbours(cell: number): number[] {
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = rowOf(cell) + dr;
      const c = colOf(cell) + dc;
      if ((dr || dc) && r >= 0 && r < GRID && c >= 0 && c < GRID) out.push(r * GRID + c);
    }
  }
  return out;
}

/** Les cases d'un bateau de `size` cases partant de `start`, à l'horizontale ou à la verticale ; null s'il sort de la grille. */
export function shipAt(start: number, size: number, vertical: boolean): Ship | null {
  if (!Number.isInteger(start) || start < 0 || start >= GRID * GRID) return null;
  const r = rowOf(start);
  const c = colOf(start);
  if (vertical ? r + size > GRID : c + size > GRID) return null;
  return { cells: Array.from({ length: size }, (_, i) => (vertical ? start + i * GRID : start + i)) };
}

/** Un bateau droit et d'un seul tenant, dans la grille. */
function straight(ship: Ship): boolean {
  const cells = [...ship.cells].sort((a, b) => a - b);
  const first = cells[0];
  if (first === undefined || !cells.every((c) => Number.isInteger(c) && c >= 0 && c < GRID * GRID)) return false;
  const horizontal = cells.every((c, i) => c === first + i && rowOf(c) === rowOf(first));
  const vertical = cells.every((c, i) => c === first + i * GRID);
  return horizontal || vertical;
}

/** La flotte est-elle réglementaire : les bonnes tailles, droits, sans chevauchement ni contact ? */
export function validFleet(ships: Ship[]): boolean {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return false;
  const sizes = ships.map((s) => (Array.isArray(s?.cells) ? s.cells.length : 0)).sort((a, b) => b - a);
  if (sizes.some((size, i) => size !== FLEET[i]!.size)) return false;
  if (!ships.every(straight)) return false;
  const owner = new Map<number, number>();
  ships.forEach((s, i) => s.cells.forEach((c) => owner.set(c, owner.has(c) ? -1 : i)));
  if ([...owner.values()].includes(-1)) return false;
  // Deux bateaux ne se touchent pas, même par un coin.
  return ships.every((s, i) => s.cells.every((c) => neighbours(c).every((n) => owner.get(n) === undefined || owner.get(n) === i)));
}

/** Une flotte placée au hasard, réglementaire. */
export function randomFleet(random: () => number): Ship[] {
  for (;;) {
    const ships: Ship[] = [];
    let tries = 0;
    for (const { size } of FLEET) {
      let placed: Ship | null = null;
      while (!placed && tries++ < 500) {
        const candidate = shipAt(Math.floor(random() * GRID * GRID), size, random() < 0.5);
        if (candidate && validFleetSoFar([...ships, candidate])) placed = candidate;
      }
      if (!placed) break;
      ships.push(placed);
    }
    if (ships.length === FLEET.length) return ships;
  }
}

/** Les bateaux déjà posés ne se chevauchent ni ne se touchent (sans vérifier les tailles). */
function validFleetSoFar(ships: Ship[]): boolean {
  const owner = new Map<number, number>();
  for (const [i, s] of ships.entries()) {
    for (const c of s.cells) {
      if (owner.has(c)) return false;
      owner.set(c, i);
    }
  }
  return ships.every((s, i) => s.cells.every((c) => neighbours(c).every((n) => owner.get(n) === undefined || owner.get(n) === i)));
}

export function createBattleship(players: { id: string; name: string }[], seed: number): BattleshipState {
  if (players.length !== 2) throw new Error('La bataille navale se joue à 2');
  return {
    seed,
    phase: 'placing',
    players: players.map((p) => ({ ...p, ships: null, shots: [] })),
    // L'hôte tire en premier.
    currentPlayer: 0,
    lastShot: null,
    winners: [],
  };
}

/** Une flotte au hasard, la même pour une même graine (pour un joueur absent ou le minuteur). */
export function seededFleet(seed: number): Ship[] {
  return randomFleet(createRng(seed));
}

/** Ce que donne un tir sur cette flotte, compte tenu des tirs déjà faits. */
function resolve(ships: Ship[], shots: Shot[], cell: number): { result: ShotResult; ship?: number } {
  const ship = ships.findIndex((s) => s.cells.includes(cell));
  if (ship < 0) return { result: 'miss' };
  const hits = new Set([...shots.map((s) => s.cell), cell]);
  return { result: ships[ship]!.cells.every((c) => hits.has(c)) ? 'sunk' : 'hit', ship };
}

/** Bateaux coulés de cette flotte (leurs indices), d'après les tirs reçus. */
export function sunkShips(ships: Ship[], shots: Shot[]): number[] {
  const hits = new Set(shots.map((s) => s.cell));
  return ships.flatMap((s, i) => (s.cells.every((c) => hits.has(c)) ? [i] : []));
}

/** Cases encore à flot d'une flotte. */
export function cellsAfloat(ships: Ship[], shots: Shot[]): number {
  const hits = new Set(shots.map((s) => s.cell));
  return ships.reduce((n, s) => n + s.cells.filter((c) => !hits.has(c)).length, 0);
}

export function applyBattleshipAction(previous: BattleshipState, action: BattleshipAction): BattleshipResult {
  const state = structuredClone(previous);
  const player = state.players[action.playerIndex];
  if (!player) return { ok: false, error: 'notYourTurn' };
  if (action.type === 'place') {
    if (state.phase !== 'placing') return { ok: false, error: 'wrongPhase' };
    if (player.ships) return { ok: false, error: 'alreadyPlaced' };
    const ships = Array.isArray(action.ships) ? action.ships.map((s) => ({ cells: Array.isArray(s?.cells) ? s.cells.map(Number) : [] })) : [];
    if (!validFleet(ships)) return { ok: false, error: 'invalidFleet' };
    player.ships = ships;
    if (state.players.every((p) => p.ships)) state.phase = 'playing';
    return { ok: true, state };
  }
  if (state.phase !== 'playing') return { ok: false, error: 'wrongPhase' };
  if (action.playerIndex !== state.currentPlayer) return { ok: false, error: 'notYourTurn' };
  const cell = action.cell;
  if (!Number.isInteger(cell) || cell < 0 || cell >= GRID * GRID) return { ok: false, error: 'invalidCell' };
  if (player.shots.some((s) => s.cell === cell)) return { ok: false, error: 'alreadyShot' };
  const other = state.players[1 - action.playerIndex]!;
  const { result, ship } = resolve(other.ships!, player.shots, cell);
  player.shots.push({ cell, result });
  state.lastShot = { playerIndex: action.playerIndex, cell, result, ...(ship !== undefined ? { ship } : {}) };
  if (cellsAfloat(other.ships!, player.shots) === 0) {
    state.phase = 'gameOver';
    state.winners = [action.playerIndex];
  } else {
    state.currentPlayer = 1 - action.playerIndex;
  }
  return { ok: true, state };
}

/** Le joueur qui doit agir : pendant le placement, le premier qui n'a pas encore placé sa flotte. */
export function battleshipToAct(state: BattleshipState): number {
  if (state.phase === 'placing') return state.players.findIndex((p) => !p.ships);
  return state.phase === 'playing' ? state.currentPlayer : -1;
}

export interface BattleshipView {
  game: 'battleship';
  you: number;
  phase: BattleshipState['phase'];
  currentPlayer: number;
  players: {
    id: string;
    name: string;
    ready: boolean;
    shots: Shot[];
    /** Bateaux restants (pas encore coulés). */
    afloat: number;
  }[];
  /** Sa propre flotte (null pour un spectateur, ou tant qu'elle n'est pas placée). */
  myShips: Ship[] | null;
  /** Les bateaux coulés de chaque joueur, visibles de tous ; toute la flotte à la fin de la partie. */
  revealed: Ship[][];
  lastShot: BattleshipState['lastShot'];
  winners: number[];
}

/** Ce qu'un joueur voit : sa flotte, les tirs de chacun, et chez l'adversaire seulement les bateaux coulés. */
export function battleshipView(state: BattleshipState, you: number): BattleshipView {
  const over = state.phase === 'gameOver';
  return {
    game: 'battleship',
    you,
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    players: state.players.map((p, i) => {
      const enemyShots = state.players[1 - i]!.shots;
      return {
        id: p.id,
        name: p.name,
        ready: !!p.ships,
        shots: p.shots,
        afloat: p.ships ? p.ships.length - sunkShips(p.ships, enemyShots).length : FLEET.length,
      };
    }),
    myShips: state.players[you]?.ships ?? null,
    revealed: state.players.map((p, i) => {
      if (!p.ships) return [];
      if (over) return p.ships;
      const sunk = sunkShips(p.ships, state.players[1 - i]!.shots);
      return p.ships.filter((_, k) => sunk.includes(k));
    }),
    lastShot: state.lastShot,
    winners: state.winners,
  };
}

/**
 * Le tir du bot : il achève d'abord un bateau touché (dans l'alignement des touches), sinon il tire au hasard en
 * damier, en évitant les cases autour des bateaux coulés (où rien ne peut se trouver).
 */
export function battleshipBotShot(state: BattleshipState, index: number, random: () => number): number {
  const me = state.players[index]!;
  const enemy = state.players[1 - index]!;
  const shot = new Set(me.shots.map((s) => s.cell));
  const sunkCells = new Set(
    sunkShips(enemy.ships ?? [], me.shots).flatMap((k) => enemy.ships![k]!.cells),
  );
  const blocked = new Set([...sunkCells].flatMap((c) => neighbours(c)));
  const free = (c: number) => c >= 0 && c < GRID * GRID && !shot.has(c) && !blocked.has(c);
  const open = me.shots.filter((s) => s.result === 'hit' && !sunkCells.has(s.cell)).map((s) => s.cell);
  if (open.length > 0) {
    const sameRow = open.length > 1 && open.every((c) => rowOf(c) === rowOf(open[0]!));
    const sameCol = open.length > 1 && open.every((c) => colOf(c) === colOf(open[0]!));
    const steps = sameRow ? [-1, 1] : sameCol ? [-GRID, GRID] : [-1, 1, -GRID, GRID];
    // Un pas de côté reste sur la même ligne ; un pas vertical change de ligne.
    const candidates = open.flatMap((c) =>
      steps.flatMap((d) => (free(c + d) && (Math.abs(d) === GRID || rowOf(c + d) === rowOf(c)) ? [c + d] : [])),
    );
    if (candidates.length > 0) return candidates[Math.floor(random() * candidates.length)]!;
  }
  const all = Array.from({ length: GRID * GRID }, (_, c) => c).filter(free);
  const checker = all.filter((c) => (rowOf(c) + colOf(c)) % 2 === 0);
  const pool = checker.length > 0 ? checker : all.length > 0 ? all : Array.from({ length: GRID * GRID }, (_, c) => c).filter((c) => !shot.has(c));
  return pool[Math.floor(random() * pool.length)]!;
}
