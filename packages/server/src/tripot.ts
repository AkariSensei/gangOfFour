import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/*
 * Le Tripot : un jeu d'incrémentation dans l'univers de Gang of Four. On tient un tripot clandestin : chaque clic
 * distribue une donne et rapporte des jetons, qu'on investit dans du personnel et des salles qui en produisent seuls.
 * Le serveur fait autorité : il garde la partie de chacun, compte la production, et plafonne les clics reçus.
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
  { id: 'donneur', icon: '🃏', name: 'Donneur du dimanche', plural: 'donneurs du dimanche', text: 'Un collègue qui distribue une donne de temps en temps.', cost: 15, rate: 0.1 },
  { id: 'croupier', icon: '🧑‍💼', name: 'Croupier', plural: 'croupiers', text: 'Il bat, il coupe, il distribue.', cost: 100, rate: 1 },
  { id: 'chevronne', icon: '🎩', name: 'Croupier chevronné', plural: 'croupiers chevronnés', text: 'Trente ans de tapis vert dans les doigts.', cost: 1_100, rate: 8 },
  { id: 'table', icon: '🪑', name: 'Table de quatre', plural: 'tables de quatre', text: 'Une table de plus, quatre joueurs de plus.', cost: 12_000, rate: 47 },
  { id: 'bot', icon: '🤖', name: 'Bot croupier', plural: 'bots croupiers', text: 'Il ne dort jamais et ne se trompe jamais de sens.', cost: 130_000, rate: 260 },
  { id: 'bar', icon: '🍸', name: 'Bar clandestin', plural: 'bars clandestins', text: 'Les joueurs restent plus longtemps quand le bar est ouvert.', cost: 1_400_000, rate: 1_400 },
  { id: 'dragon', icon: '🐉', name: 'Salle du Dragon', plural: 'salles du Dragon', text: 'La salle des grosses mises, gardée par la carte la plus forte.', cost: 20_000_000, rate: 7_800 },
  { id: 'phenix', icon: '🦅', name: 'Cercle du Phénix', plural: 'cercles du Phénix', text: 'Un cercle privé où les fortunes renaissent de leurs cendres.', cost: 330_000_000, rate: 44_000 },
];

/** Hausse du prix à chaque achat d'une même activité. */
const COST_GROWTH = 1.15;

/** Prix du prochain exemplaire d'une activité dont on possède déjà \`owned\`. */
export const buildingCost = (b: Building, owned: number) => Math.ceil(b.cost * COST_GROWTH ** owned);

/** Une amélioration, achetée une seule fois. */
export interface Upgrade {
  id: string;
  icon: string;
  name: string;
  text: string;
  cost: number;
  /** Activité dont la production double, ou \`deal\` (la donne vaut plus), ou \`all\` (tout le tripot). */
  target: string;
  factor: number;
  /** Proposée quand on possède ce nombre de l'activité visée (ou ce nombre de donnes distribuées pour la donne). */
  needs: number;
}

/**
 * Les combinaisons du jeu doublent chacune la production d'une activité, quand on en possède assez : une paire de
 * croupiers, un brelan, une suite, une couleur, un full. Le prix suit celui de l'activité.
 */
const COMBINATIONS: [string, string, number, number][] = [
  ['paire', 'Paire', 1, 10],
  ['brelan', 'Brelan', 5, 50],
  ['suite', 'Suite', 25, 500],
  ['couleur', 'Couleur', 50, 5_000],
  ['full', 'Full', 100, 50_000],
];

export const UPGRADES: Upgrade[] = [
  { id: 'doigts', icon: '👆', name: 'Doigts de croupier', text: 'Chaque donne rapporte deux fois plus.', cost: 100, target: 'deal', factor: 2, needs: 10 },
  { id: 'americaine', icon: '🔀', name: 'Battage à l’américaine', text: 'Chaque donne rapporte deux fois plus.', cost: 5_000, target: 'deal', factor: 2, needs: 200 },
  { id: 'multi', icon: '🌈', name: 'Le 1 multicolore', text: 'Chaque donne rapporte aussi 2 % de la production par seconde.', cost: 50_000, target: 'dealRate', factor: 0.02, needs: 500 },
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
  { id: 'phenix-carte', icon: '🪶', name: 'La paire de phénix', text: 'Tout le tripot produit 25 % de plus.', cost: 10_000_000, target: 'all', factor: 1.25, needs: 0 },
  { id: 'dragon-carte', icon: '🔥', name: 'Le dragon', text: 'Tout le tripot produit 50 % de plus.', cost: 500_000_000, target: 'all', factor: 1.5, needs: 0 },
  { id: 'gang', icon: '💥', name: 'Gang of Four', text: 'Quatre de chaque activité ou plus : tout le tripot produit deux fois plus.', cost: 5_000_000_000, target: 'all', factor: 2, needs: 4 },
];

/** Établissements successifs : le prestige fait grandir le tripot (chaque niveau : +10 % de jetons pour toujours). */
export const VENUES = ['Arrière-salle', 'Cave enfumée', 'Tripot de quartier', 'Cercle de jeu', 'Casino clandestin', 'Palace'];
/** Jetons à avoir gagnés depuis l'ouverture pour pouvoir s'agrandir : un million, puis quatre fois plus à chaque niveau. */
export const prestigeGoal = (prestige: number) => 1_000_000 * 4 ** prestige;
const PRESTIGE_BONUS = 0.1;

/** La partie d'un joueur. */
export interface TripotSave {
  chips: number;
  /** Jetons gagnés depuis l'ouverture de l'établissement actuel, et depuis toujours. */
  earned: number;
  earnedAll: number;
  deals: number;
  buildings: Record<string, number>;
  upgrades: string[];
  prestige: number;
  /** Dernier calcul de la production (millisecondes). */
  updatedAt: number;
}

export const newSave = (now: number): TripotSave => ({ chips: 0, earned: 0, earnedAll: 0, deals: 0, buildings: {}, upgrades: [], prestige: 0, updatedAt: now });

const owned = (save: TripotSave, id: string) => save.buildings[id] ?? 0;
const upgradeFactor = (save: TripotSave, target: string) =>
  UPGRADES.filter((u) => u.target === target && save.upgrades.includes(u.id)).reduce((f, u) => f * u.factor, 1);
const globalFactor = (save: TripotSave) => (1 + PRESTIGE_BONUS * save.prestige) * upgradeFactor(save, 'all');

/** Jetons produits par seconde par tout le tripot. */
export function productionOf(save: TripotSave): number {
  const base = BUILDINGS.reduce((sum, b) => sum + owned(save, b.id) * b.rate * upgradeFactor(save, b.id), 0);
  return base * globalFactor(save);
}

/** Jetons rapportés par une donne distribuée à la main. */
export function dealValue(save: TripotSave): number {
  const rate = UPGRADES.filter((u) => u.target === 'dealRate' && save.upgrades.includes(u.id)).reduce((sum, u) => sum + u.factor, 0);
  return upgradeFactor(save, 'deal') * globalFactor(save) + rate * productionOf(save);
}

/** Une amélioration est proposée (pas encore achetée) quand on remplit sa condition. */
export function upgradeAvailable(save: TripotSave, u: Upgrade): boolean {
  if (save.upgrades.includes(u.id)) return false;
  if (u.target === 'deal' || u.target === 'dealRate') return save.deals >= u.needs;
  if (u.id === 'gang') return BUILDINGS.every((b) => owned(save, b.id) >= u.needs);
  if (u.target === 'all') return save.earned >= u.cost / 10;
  return owned(save, u.target) >= u.needs;
}

/** Au-delà de ce délai sans nouvelles, le joueur est parti : sa production continue, mais à moitié et sur 8 h au plus. */
const ONLINE_GAP_S = 120;
const OFFLINE_FACTOR = 0.5;
const OFFLINE_CAP_S = 8 * 3600;

/**
 * Fait tourner le tripot jusqu'à \`now\` : la production du temps écoulé (pleine pendant les deux premières minutes,
 * puis à moitié pendant l'absence, plafonnée à 8 h). Renvoie les jetons gagnés pendant l'absence (0 sans absence).
 */
export function advance(save: TripotSave, now: number): number {
  const elapsed = Math.max(0, (now - save.updatedAt) / 1000);
  save.updatedAt = now;
  const rate = productionOf(save);
  const online = Math.min(elapsed, ONLINE_GAP_S);
  const away = Math.min(Math.max(0, elapsed - ONLINE_GAP_S), OFFLINE_CAP_S);
  const awayGain = away * rate * OFFLINE_FACTOR;
  earn(save, online * rate + awayGain);
  return awayGain;
}

function earn(save: TripotSave, chips: number) {
  save.chips += chips;
  save.earned += chips;
  save.earnedAll += chips;
}

/** Clics par seconde au plus : au-delà, les donnes reçues sont ignorées (un clic automatique n'apporte rien). */
export const MAX_DEALS_PER_S = 15;

/** Ajoute les donnes distribuées à la main depuis le dernier envoi, plafonnées selon le temps écoulé. */
export function deal(save: TripotSave, count: number, elapsedS: number): number {
  const allowed = Math.max(0, Math.min(Math.floor(count), Math.ceil((elapsedS + 1) * MAX_DEALS_PER_S)));
  earn(save, allowed * dealValue(save));
  save.deals += allowed;
  return allowed;
}

export type BuyError = 'unknownItem' | 'tooExpensive' | 'notAvailable';

export function buyBuilding(save: TripotSave, id: string): BuyError | null {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) return 'unknownItem';
  const cost = buildingCost(b, owned(save, id));
  if (save.chips < cost) return 'tooExpensive';
  save.chips -= cost;
  save.buildings[id] = owned(save, id) + 1;
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

/** S'agrandir : on repart de zéro (jetons, activités, améliorations) avec un établissement de plus. */
export function prestige(save: TripotSave): BuyError | null {
  if (save.earned < prestigeGoal(save.prestige) || save.prestige >= VENUES.length - 1) return 'notAvailable';
  Object.assign(save, { chips: 0, earned: 0, buildings: {}, upgrades: [], prestige: save.prestige + 1 });
  return null;
}

/** Ce que le joueur voit de sa partie : ses chiffres, la boutique (prix à jour) et l'établissement. */
export interface TripotView {
  chips: number;
  earned: number;
  earnedAll: number;
  deals: number;
  rate: number;
  dealValue: number;
  prestige: number;
  venue: string;
  nextVenue: string | null;
  prestigeGoal: number;
  /** Jetons produits pendant l'absence, annoncés au retour. */
  awayGain: number;
  buildings: (Building & { owned: number; price: number; unlocked: boolean })[];
  upgrades: (Omit<Upgrade, 'needs' | 'factor' | 'target'> & { available: boolean })[];
}

export function viewOf(save: TripotSave, awayGain = 0): TripotView {
  return {
    chips: save.chips,
    earned: save.earned,
    earnedAll: save.earnedAll,
    deals: save.deals,
    rate: productionOf(save),
    dealValue: dealValue(save),
    prestige: save.prestige,
    venue: VENUES[save.prestige]!,
    nextVenue: VENUES[save.prestige + 1] ?? null,
    prestigeGoal: prestigeGoal(save.prestige),
    awayGain,
    // Une activité se dévoile quand on a gagné la moitié de son prix (ou qu'on en possède déjà).
    buildings: BUILDINGS.map((b) => ({
      ...b,
      owned: owned(save, b.id),
      price: buildingCost(b, owned(save, b.id)),
      unlocked: owned(save, b.id) > 0 || save.earned >= b.cost / 2,
    })),
    // Les améliorations proposées, de la moins chère à la plus chère ; les achetées en dernier.
    upgrades: UPGRADES.filter((u) => upgradeAvailable(save, u) || save.upgrades.includes(u.id))
      .map(({ needs: _n, factor: _f, target: _t, ...u }) => ({ ...u, available: !save.upgrades.includes(u.id) }))
      .sort((a, b) => Number(b.available) - Number(a.available) || a.cost - b.cost),
  };
}

/** Les parties de tous les joueurs, gardées dans un fichier JSON (ou en mémoire sans fichier). */
export class TripotStore {
  private saves: Record<string, TripotSave> = {};
  private timer: NodeJS.Timeout | undefined;

  constructor(private file?: string) {
    if (!file) return;
    try {
      this.saves = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.saves = {};
    }
  }

  /** La partie d'un joueur, créée à sa première visite. */
  get(account: string, now = Date.now()): TripotSave {
    return (this.saves[account] ??= newSave(now));
  }

  /** Enregistre bientôt (plusieurs changements rapprochés ne donnent qu'une écriture). */
  save(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.saveNow(), 1000);
  }

  saveNow(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.saves));
      renameSync(tmp, this.file);
    } catch (error) {
      console.error("Impossible d'enregistrer le tripot :", error);
    }
  }
}
