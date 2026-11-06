import { randomInt, randomUUID } from 'node:crypto';
import { type ActionError, type BattleshipError, type ReversiError, type SlotsError, createGame } from '@gof/engine';
import { BOT_LEVELS, type BotLevel } from './bot';
import { TUTORIAL_SCRIPT, type TutorialMove, tutorialDeck } from './tutorial';
import { AVATARS, COLORS, type Cosmetics, type Look, type RoomError, type RoomView, type Session } from './protocol';
import { FRAMES } from './progression';
import { type AnyGame, type GameId, type GameSettings, type PlayerAction, isGameId, rulesOf } from './rules';

export type { PlayerAction };
const MAX_NAME_LENGTH = 20;
/** Temps par tour que l'hôte peut choisir, en secondes (0 : pas de minuteur). */
export const TURN_SECONDS = [0, 30, 60];

export interface StartOptions extends GameSettings {
  seed?: number;
  turnSeconds?: number;
}
/** Les codes de salon sont 4 chiffres : faciles à dicter et à taper, même sur le clavier d'un téléphone. */
const CODE_DIGITS = 4;

export interface Seat {
  playerId: string;
  token: string;
  name: string;
  connected: boolean;
  /** Siège tenu par l'ordinateur, ajouté par l'hôte pour compléter la table. */
  bot?: boolean;
  /** Niveau du bot (moyen si absent). */
  level?: BotLevel;
  /** Joueur parti en pleine partie depuis un moment : un bot joue à sa place jusqu'à son retour. */
  away?: boolean;
  avatar?: string;
  color?: string;
  /** Le joueur a activé la passe automatique (coupée par défaut) : il passe tout seul quand rien ne passe. */
  autoPass?: boolean;
  /** Compte du joueur assis : il ne peut pas prendre un second siège dans le même salon. */
  account?: string;
  /** Joueur exclu en pleine partie : un bot tient le siège jusqu'à ce qu'un nouvel humain le prenne. */
  vacant?: boolean;
  /** Cadre d'avatar et titre choisis par le joueur, montrés à toute la table. */
  frame?: string;
  title?: string;
}

/** Noms donnés aux bots, dans l'ordre (jusqu'à six, pour une table de sept). */
const BOT_NAMES = ['Robot Ada', 'Robot Alan', 'Robot Grace', 'Robot Hedy', 'Robot Linus', 'Robot Margaret'];

export interface Room {
  code: string;
  hostId: string;
  /** Jeu du salon (absent des salons d'avant les autres jeux : Gang of Four). */
  kind?: GameId;
  seats: Seat[];
  game: AnyGame | null;
  /** La partie terminée a déjà été ajoutée à l'historique. */
  recorded?: boolean;
  /** Temps laissé à chaque joueur pour agir, en secondes ; 0 ou absent : pas de minuteur. */
  turnSeconds?: number;
  /** Joueurs que l'hôte ou l'admin a privés de chat dans ce salon. */
  muted?: string[];
  /** Comptes exclus par l'hôte ou l'admin : ils ne peuvent plus revenir dans ce salon. */
  kicked?: string[];
  /** Partie mise en pause par l'hôte ou l'admin : personne ne joue et aucun minuteur ne tourne. */
  paused?: boolean;
  /** Tutoriel : la manche écrite à l'avance, et le rang du prochain coup du script. */
  tutorial?: { step: number };
  /** Entraînement contre les bots : personne d'autre n'y entre, et la partie ne compte nulle part. */
  training?: boolean;
}

/** Salon qui attend des joueurs, proposé sur la page de son jeu. */
export interface OpenRoom {
  code: string;
  game: GameId;
  host: string;
  players: number;
  minPlayers: number;
  maxPlayers: number;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: RoomError | ActionError | SlotsError | BattleshipError | ReversiError };

/** Les règles du jeu d'un salon. */
export const rulesOfRoom = (room: Room) => rulesOf(room.kind);

export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  // Pas de caractères invisibles ou de contrôle, qui permettraient des pseudos vides ou trompeurs.
  const trimmed = name.replace(/[\p{C}]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** Garde seulement un cadre connu et un titre de taille raisonnable (ils viennent du compte, déjà vérifiés). */
export function cleanCosmetics(source: unknown): Cosmetics {
  const { frame, title } = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>;
  return {
    ...(typeof frame === 'string' && FRAMES.some((f) => f.id === frame) ? { frame } : {}),
    ...(typeof title === 'string' && title.length > 0 && title.length <= 40 ? { title } : {}),
  };
}

/** Garde seulement un avatar et une couleur de la liste proposée. */
export function cleanLook(look: unknown): Look {
  const { avatar, color } = (look && typeof look === 'object' ? look : {}) as Record<string, unknown>;
  return {
    ...(typeof avatar === 'string' && AVATARS.includes(avatar) ? { avatar } : {}),
    ...(typeof color === 'string' && COLORS.includes(color) ? { color } : {}),
  };
}

/** Gère les salons en mémoire, sans rien savoir des sockets. */
export class RoomManager {
  private rooms = new Map<string, Room>();

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  private newCode(): string {
    let code: string;
    do {
      code = String(randomInt(10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
    } while (this.rooms.has(code));
    return code;
  }

  private seat(room: Room, name: string, look: unknown, account?: string): Session {
    const seat: Seat = {
      playerId: randomUUID(),
      token: randomUUID(),
      name,
      connected: true,
      ...cleanLook(look),
      ...cleanCosmetics(look),
      ...(account ? { account } : {}),
    };
    room.seats.push(seat);
    return { code: room.code, playerId: seat.playerId, token: seat.token };
  }

  /** `training` : partie d'entraînement contre les bots, que personne d'autre ne peut rejoindre. */
  create(rawName: unknown, look?: unknown, account?: string, game: GameId = 'gof', training = false): Result<Session> {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'invalidName' };
    const room: Room = {
      code: this.newCode(),
      hostId: '',
      ...(game !== 'gof' ? { kind: game } : {}),
      seats: [],
      game: null,
      ...(training ? { training: true } : {}),
    };
    const session = this.seat(room, name, look, account);
    room.hostId = session.playerId;
    this.rooms.set(room.code, room);
    return { ok: true, ...session };
  }

  /** Tutoriel : le joueur à la place du donneur, trois bots, et la donne écrite à l'avance qui démarre aussitôt. */
  createTutorial(rawName: unknown, look: unknown, account: string): Result<Session> {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'invalidName' };
    const room: Room = { code: this.newCode(), hostId: '', seats: [], game: null, tutorial: { step: 0 } };
    const session = this.seat(room, name, look, account);
    room.hostId = session.playerId;
    for (const botName of BOT_NAMES.slice(0, 3)) room.seats.push({ playerId: randomUUID(), token: randomUUID(), name: botName, connected: true, bot: true });
    room.game = createGame(
      room.seats.map((s) => ({ id: s.playerId, name: s.name })),
      0,
      { targetScore: 1 },
      tutorialDeck(),
    );
    room.turnSeconds = 0;
    this.rooms.set(room.code, room);
    return { ok: true, ...session };
  }

  /** Prochain coup du script du tutoriel, s'il en reste. */
  tutorialMove(room: Room): TutorialMove | undefined {
    return room.tutorial ? TUTORIAL_SCRIPT[room.tutorial.step] : undefined;
  }

  /**
   * `account` : un même compte ne tient qu'un siège par salon, pour ne pas jouer deux mains. `severalSeats` (l'admin,
   * pour tester seul) lève cette limite : ses sièges suivants ne sont pas rattachés à son compte, ni au classement.
   */
  join(code: string, rawName: unknown, look?: unknown, account?: string, severalSeats = false): Result<Session> {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'invalidName' };
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (room.training || room.tutorial) return { ok: false, error: 'trainingRoom' };
    if (account && room.kicked?.includes(account)) return { ok: false, error: 'kicked' };
    const vacant = room.game ? room.seats.find((s) => s.vacant) : undefined;
    if (room.game && !vacant) return { ok: false, error: 'gameAlreadyStarted' };
    if (!room.game && room.seats.length >= rulesOfRoom(room).maxPlayers) return { ok: false, error: 'roomFull' };
    if (account && room.seats.some((s) => s.account === account)) {
      if (!severalSeats) return { ok: false, error: 'alreadySeated' };
      account = undefined;
    }
    return { ok: true, ...(vacant ? this.takeOver(room, vacant, name, look, account) : this.seat(room, name, look, account)) };
  }

  /** Un nouvel humain prend en pleine partie le siège d'un joueur exclu, avec ses cartes et ses points. */
  private takeOver(room: Room, seat: Seat, name: string, look: unknown, account?: string): Session {
    const index = room.seats.indexOf(seat);
    room.seats[index] = { playerId: seat.playerId, token: randomUUID(), name, connected: true, ...cleanLook(look), ...(account ? { account } : {}) };
    this.rename(room, index, name);
    return { code: room.code, playerId: seat.playerId, token: room.seats[index]!.token };
  }

  /** Change le nom affiché d'un joueur dans la partie en cours. */
  private rename(room: Room, index: number, name: string) {
    if (room.game) room.game = rulesOfRoom(room).rename(room.game, index, name);
  }

  /** `onlyIfFree` : ne reprend pas un siège encore occupé par un autre onglet ouvert. */
  rejoin(code: string, token: string, onlyIfFree = false): Result<Session> {
    const room = this.get(code);
    const seat = room?.seats.find((s) => s.token === token);
    if (!room || !seat) return { ok: false, error: 'roomNotFound' };
    if (onlyIfFree && seat.connected) return { ok: false, error: 'seatTaken' };
    seat.connected = true;
    delete seat.away;
    return { ok: true, code: room.code, playerId: seat.playerId, token };
  }

  /** Quitter le salon avant la partie libère le siège ; pendant la partie, le siège reste réservé. */
  leave(code: string, playerId: string): void {
    const room = this.get(code);
    if (!room) return;
    if (room.game) {
      this.setConnected(code, playerId, false);
      return;
    }
    room.seats = room.seats.filter((s) => s.playerId !== playerId);
    // Sans humain, le salon disparaît ; sinon l'hôte passe au premier humain restant (jamais à un bot).
    const human = room.seats.find((s) => !s.bot);
    if (!human) {
      this.rooms.delete(room.code);
    } else if (room.hostId === playerId) {
      room.hostId = human.playerId;
    }
  }

  setConnected(code: string, playerId: string, connected: boolean): void {
    const seat = this.get(code)?.seats.find((s) => s.playerId === playerId);
    if (seat) seat.connected = connected;
  }

  /** Un salon est abandonné quand plus aucun humain n'y est connecté (les bots ne comptent pas). */
  isAbandoned(code: string): boolean {
    const room = this.get(code);
    return !!room && room.seats.every((s) => s.bot || !s.connected);
  }

  /** Un bot prend la place d'un joueur parti en pleine partie, s'il n'est toujours pas revenu. */
  replaceByBot(code: string, playerId: string): boolean {
    const room = this.get(code);
    const seat = room?.seats.find((s) => s.playerId === playerId);
    if (!room?.game || rulesOfRoom(room).over(room.game) || room.paused || !seat || seat.bot || seat.connected) return false;
    seat.away = true;
    return true;
  }

  /** L'hôte ajoute un bot sur un siège libre, avant la partie. */
  addBot(code: string, playerId: string, level: unknown = 'normal'): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (room.hostId !== playerId) return { ok: false, error: 'notHost' };
    // Les bots ne jouent qu'à l'entraînement : une vraie table n'a que des humains.
    if (!room.training) return { ok: false, error: 'trainingOnly' };
    if (room.game) return { ok: false, error: 'gameAlreadyStarted' };
    if (room.seats.length >= rulesOfRoom(room).maxPlayers) return { ok: false, error: 'roomFull' };
    const name = BOT_NAMES.find((n) => !room.seats.some((s) => s.name === n)) ?? 'Robot';
    const botLevel = BOT_LEVELS.includes(level as BotLevel) ? (level as BotLevel) : 'normal';
    room.seats.push({ playerId: randomUUID(), token: randomUUID(), name, connected: true, bot: true, level: botLevel });
    return { ok: true };
  }

  removeBot(code: string, playerId: string, botId: string): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (room.hostId !== playerId) return { ok: false, error: 'notHost' };
    if (room.game) return { ok: false, error: 'gameAlreadyStarted' };
    room.seats = room.seats.filter((s) => !(s.bot && s.playerId === botId));
    return { ok: true };
  }

  /** L'hôte, ou l'admin (assis ou spectateur), coupe ou rend le chat à un autre joueur humain du salon. */
  setMuted(code: string, byId: string | undefined, isAdmin: boolean, targetId: string, muted: boolean): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (!isAdmin && (!byId || room.hostId !== byId)) return { ok: false, error: 'notHost' };
    const target = room.seats.find((s) => s.playerId === targetId && !s.bot);
    if (!target || targetId === byId) return { ok: false, error: 'notInRoom' };
    const others = (room.muted ?? []).filter((id) => id !== targetId);
    room.muted = muted ? [...others, targetId] : others;
    return { ok: true };
  }

  /**
   * L'hôte ou l'admin exclut un joueur humain : son compte ne peut plus revenir dans ce salon. Avant la partie, sa place
   * se libère ; pendant la partie, un bot la tient jusqu'à ce qu'un nouvel humain rejoigne le salon.
   */
  kick(code: string, byId: string | undefined, isAdmin: boolean, targetId: string): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (!isAdmin && (!byId || room.hostId !== byId)) return { ok: false, error: 'notHost' };
    const index = room.seats.findIndex((s) => s.playerId === targetId && !s.bot && !s.vacant);
    const target = room.seats[index];
    if (!target || targetId === byId) return { ok: false, error: 'notInRoom' };
    if (target.account) room.kicked = [...(room.kicked ?? []), target.account];
    room.muted = room.muted?.filter((id) => id !== targetId);
    if (!room.game) {
      this.leave(code, targetId);
      return { ok: true };
    }
    const name = BOT_NAMES.find((n) => !room.seats.some((s) => s.name === n)) ?? 'Robot';
    // Nouveau jeton : l'exclu ne peut pas reprendre le siège avec l'ancien.
    room.seats[index] = { playerId: target.playerId, token: randomUUID(), name, connected: false, away: true, vacant: true };
    this.rename(room, index, name);
    if (room.hostId === targetId) {
      const human = room.seats.find((s) => !s.bot && !s.vacant);
      if (human) room.hostId = human.playerId;
    }
    return { ok: true };
  }

  /**
   * L'hôte ou l'admin (même spectateur) met la partie en pause ou la relance. Si l'hôte n'est plus là, n'importe quel
   * joueur assis peut le faire, pour qu'une pause ne bloque jamais la table.
   */
  setPaused(code: string, byId: string | undefined, isAdmin: boolean, paused: boolean): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (!room.game) return { ok: false, error: 'gameNotStarted' };
    if (rulesOfRoom(room).over(room.game)) return { ok: false, error: 'wrongPhase' };
    const hostHere = !!room.seats.find((s) => s.playerId === room.hostId)?.connected;
    const seated = room.seats.some((s) => s.playerId === byId && !s.bot && !s.vacant);
    if (!isAdmin && !(seated && (byId === room.hostId || !hostHere))) return { ok: false, error: 'notHost' };
    if (paused) room.paused = true;
    else delete room.paused;
    return { ok: true };
  }

  isMuted(code: string, playerId: string): boolean {
    return !!this.get(code)?.muted?.includes(playerId);
  }

  /** Le joueur qui doit agir maintenant (jouer, rendre des cartes ou couper), s'il y en a un. */
  seatToAct(code: string): Seat | null {
    const room = this.get(code);
    if (!room?.game) return null;
    return room.seats[rulesOfRoom(room).toAct(room.game)] ?? null;
  }

  /**
   * Le bot qui doit agir maintenant dans ce salon, s'il y en a un : un vrai bot, ou un bot qui remplace un joueur
   * parti (seulement s'il reste un humain à la table, pour ne pas finir la partie sans personne).
   */
  botToAct(code: string): Seat | null {
    const seat = this.seatToAct(code);
    if (this.get(code)?.paused) return null;
    return seat?.bot || (seat?.away && !this.isAbandoned(code)) ? seat : null;
  }

  /**
   * Le joueur humain dont c'est le tour et qui ne peut rien poser sur la table (toute sa main est grisée) :
   * il passera tout seul s'il a activé l'option (coupée par défaut). Jamais quand il ouvre le pli, puisqu'il peut alors tout jouer.
   */
  stuckToPass(code: string): Seat | null {
    const room = this.get(code);
    if (!room?.game || room.paused) return null;
    const rules = rulesOfRoom(room);
    const index = rules.toAct(room.game);
    const seat = room.seats[index];
    if (!seat || seat.bot || seat.away || !seat.autoPass) return null;
    return rules.stuck(room.game, index) ? seat : null;
  }

  /** Chaque joueur choisit s'il passe tout seul quand rien ne passe. */
  setAutoPass(code: string, playerId: string, enabled: boolean): Result {
    const seat = this.get(code)?.seats.find((s) => s.playerId === playerId && !s.bot);
    if (!seat) return { ok: false, error: 'notInRoom' };
    if (enabled) seat.autoPass = true;
    else delete seat.autoPass;
    return { ok: true };
  }

  delete(code: string): void {
    this.rooms.delete(code.toUpperCase());
  }

  count(): number {
    return this.rooms.size;
  }

  /** Tous les salons, pour les enregistrer sur disque. */
  all(): Room[] {
    return [...this.rooms.values()];
  }

  /** Recharge des salons enregistrés (après un redémarrage) : personne n'est encore reconnecté. */
  restore(saved: Room[]): void {
    for (const room of saved) {
      // Les défis du jour n'existent plus : une manche de défi en cours au redémarrage est abandonnée.
      if ('challenge' in room) continue;
      // Un jeu retiré du site (le Président) : son salon est abandonné.
      if (room.kind && !isGameId(room.kind)) continue;
      room.seats.forEach((s) => (s.connected = !!s.bot));
      this.rooms.set(room.code, room);
    }
  }

  start(code: string, playerId: string, options: StartOptions = {}): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (room.hostId !== playerId) return { ok: false, error: 'notHost' };
    if (room.game) return { ok: false, error: 'gameAlreadyStarted' };
    const rules = rulesOfRoom(room);
    if (room.seats.length < rules.minPlayers) return { ok: false, error: 'notEnoughPlayers' };
    room.game = rules.create(
      room.seats.map((s) => ({ id: s.playerId, name: s.name })),
      options.seed ?? randomInt(2 ** 31),
      options,
    );
    room.turnSeconds = TURN_SECONDS.includes(options.turnSeconds!) ? options.turnSeconds : 0;
    return { ok: true };
  }

  /** Revanche : une partie terminée repart avec les mêmes joueurs et les mêmes réglages, à la demande de n'importe quel joueur. */
  rematch(code: string, playerId: string, seed = randomInt(2 ** 31)): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (!room.game) return { ok: false, error: 'gameNotStarted' };
    if (!room.seats.some((s) => s.playerId === playerId && !s.bot)) return { ok: false, error: 'notInRoom' };
    const rules = rulesOfRoom(room);
    if (!rules.over(room.game)) return { ok: false, error: 'wrongPhase' };
    if (room.tutorial) return { ok: false, error: 'tutorialMove' };
    room.game = rules.again(
      room.game,
      room.seats.map((s) => ({ id: s.playerId, name: s.name })),
      seed,
    );
    room.recorded = false;
    delete room.paused;
    return { ok: true };
  }

  act(code: string, playerId: string, action: PlayerAction): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (!room.game) return { ok: false, error: 'gameNotStarted' };
    if (room.paused) return { ok: false, error: 'paused' };
    const playerIndex = room.seats.findIndex((s) => s.playerId === playerId);
    if (playerIndex < 0) return { ok: false, error: 'notInRoom' };

    // Tutoriel : seul le coup prévu par le script est accepté.
    const scripted = this.tutorialMove(room);
    if (room.tutorial) {
      const expected = scripted?.cardIds ?? [];
      const given = action.type === 'play' ? action.cardIds : action.type === 'pass' ? [] : null;
      const same = given !== null && given.length === expected.length && given.every((id) => expected.includes(id));
      if (!scripted || scripted.player !== playerIndex || !same) return { ok: false, error: 'tutorialMove' };
    }
    const result = rulesOfRoom(room).act(room.game, playerIndex, action);
    if (!result.ok) return { ok: false, error: result.error as ActionError | SlotsError | BattleshipError | ReversiError };
    room.game = result.game;
    if (room.tutorial) room.tutorial.step += 1;
    return { ok: true };
  }

  roomView(room: Room): RoomView {
    return {
      code: room.code,
      hostId: room.hostId,
      game: room.kind ?? 'gof',
      training: room.training ?? false,
      players: room.seats.map((s) => ({
        id: s.playerId,
        name: s.name,
        connected: s.connected,
        bot: s.bot ?? false,
        ...(s.bot ? { level: s.level ?? 'normal' } : {}),
        away: s.away ?? false,
        autoPass: s.autoPass ?? false,
        vacant: s.vacant ?? false,
        muted: room.muted?.includes(s.playerId) ?? false,
        ...cleanLook(s),
        ...cleanCosmetics(s),
      })),
      started: room.game !== null,
      turnSeconds: room.turnSeconds ?? 0,
      turnRemainingMs: null,
      spectators: 0,
      paused: room.paused ?? false,
      ...(room.tutorial ? { tutorial: this.tutorialView(room) } : {}),
    };
  }

  /** Le tutoriel vu par le joueur : l'explication et les cartes à poser quand c'est à lui, rien pendant le tour des bots. */
  private tutorialView(room: Room): { coach: string | null; expect: string[] | null; step: number; total: number } {
    const move = this.tutorialMove(room);
    const total = TUTORIAL_SCRIPT.filter((m) => m.player === 0).length;
    const step = TUTORIAL_SCRIPT.slice(0, room.tutorial!.step).filter((m) => m.player === 0).length;
    return move?.player === 0 ? { coach: move.coach ?? null, expect: move.cardIds ?? [], step: step + 1, total } : { coach: null, expect: null, step, total };
  }

  /** Ce que voit un spectateur : toute la table (`you` vaut -1) et la main de chacun, qu'il choisit d'afficher ou non. */
  spectatorView(room: Room) {
    return room.game ? rulesOfRoom(room).spectatorView(room.game) : null;
  }

  /** Parties en cours (ni en attente de joueurs, ni terminées), pour les spectateurs. */
  live(): { code: string; game: GameId; players: { name: string; score: number; bot: boolean }[]; round: number; open: boolean }[] {
    // Seulement les parties où au moins un vrai joueur est encore là : pas celles que les bots jouent seuls.
    return this.all().flatMap((room) => {
      const rules = rulesOfRoom(room);
      if (!room.game || rules.over(room.game) || room.tutorial || room.training || this.isAbandoned(room.code)) return [];
      const scores = rules.scores(room.game);
      return [
        {
          code: room.code,
          game: rules.id,
          round: rules.round(room.game),
          open: room.seats.some((s) => s.vacant),
          players: room.seats.map((s, i) => ({ name: s.name, score: scores[i] ?? 0, bot: !!(s.bot || s.vacant) })),
        },
      ];
    });
  }

  /** Salons de ce jeu qui attendent encore des joueurs (pas lancés, pas pleins, avec leur hôte connecté). */
  open(game: GameId): OpenRoom[] {
    return this.all().flatMap((room) => {
      const rules = rulesOfRoom(room);
      const host = room.seats.find((s) => s.playerId === room.hostId);
      if (rules.id !== game || room.game || room.training || room.tutorial || !host?.connected) return [];
      if (room.seats.length >= rules.maxPlayers) return [];
      return [{ code: room.code, game: rules.id, host: host.name, players: room.seats.length, minPlayers: rules.minPlayers, maxPlayers: rules.maxPlayers }];
    });
  }

  gameView(room: Room, playerId: string) {
    const index = room.seats.findIndex((s) => s.playerId === playerId);
    return room.game && index >= 0 ? rulesOfRoom(room).view(room.game, index) : null;
  }
}
