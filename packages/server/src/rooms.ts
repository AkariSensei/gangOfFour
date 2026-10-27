import { randomInt, randomUUID } from 'node:crypto';
import { type Action, type ActionError, type GameState, applyAction, createGame, getPlayerView, playableCards } from '@gof/engine';
import { AVATARS, COLORS, type Look, type RoomError, type RoomView, type Session } from './protocol';

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 3;
const MAX_NAME_LENGTH = 20;
/** Scores de fin de partie que l'hôte peut choisir. */
export const TARGET_SCORES = [50, 100, 200];
const DEFAULT_TARGET_SCORE = 100;
/** Temps par tour que l'hôte peut choisir, en secondes (0 : pas de minuteur). */
export const TURN_SECONDS = [0, 30, 60];

export interface StartOptions {
  seed?: number;
  targetScore?: number;
  turnSeconds?: number;
}
/** Lettres sans ambiguïté à l'oral ou à l'écrit (pas de I, O, 0, 1). */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface Seat {
  playerId: string;
  token: string;
  name: string;
  connected: boolean;
  /** Siège tenu par l'ordinateur, ajouté par l'hôte pour compléter la table. */
  bot?: boolean;
  /** Joueur parti en pleine partie depuis un moment : un bot joue à sa place jusqu'à son retour. */
  away?: boolean;
  avatar?: string;
  color?: string;
  /** Le joueur a coupé la passe automatique : il passe lui-même même quand rien ne passe. */
  manualPass?: boolean;
  /** Compte du joueur assis : il ne peut pas prendre un second siège dans le même salon. */
  account?: string;
  /** Joueur exclu en pleine partie : un bot tient le siège jusqu'à ce qu'un nouvel humain le prenne. */
  vacant?: boolean;
}

/** Noms donnés aux bots, dans l'ordre. */
const BOT_NAMES = ['Robot Ada', 'Robot Alan', 'Robot Grace'];

export interface Room {
  code: string;
  hostId: string;
  seats: Seat[];
  game: GameState | null;
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
}

/** Action de jeu telle qu'envoyée par un joueur : son siège est déduit du serveur, jamais du client. */
export type PlayerAction =
  | { type: 'play'; cardIds: string[] }
  | { type: 'pass' }
  | { type: 'giveCard'; cardId: string }
  | { type: 'nextRound' }
  | { type: 'cut'; position: number };

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: RoomError | ActionError };

export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  // Pas de caractères invisibles ou de contrôle, qui permettraient des pseudos vides ou trompeurs.
  const trimmed = name.replace(/[\p{C}]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
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
      code = Array.from({ length: 4 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  private seat(room: Room, name: string, look: unknown, account?: string): Session {
    const seat: Seat = { playerId: randomUUID(), token: randomUUID(), name, connected: true, ...cleanLook(look), ...(account ? { account } : {}) };
    room.seats.push(seat);
    return { code: room.code, playerId: seat.playerId, token: seat.token };
  }

  create(rawName: unknown, look?: unknown, account?: string): Result<Session> {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'invalidName' };
    const room: Room = { code: this.newCode(), hostId: '', seats: [], game: null };
    const session = this.seat(room, name, look, account);
    room.hostId = session.playerId;
    this.rooms.set(room.code, room);
    return { ok: true, ...session };
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
    if (account && room.kicked?.includes(account)) return { ok: false, error: 'kicked' };
    const vacant = room.game ? room.seats.find((s) => s.vacant) : undefined;
    if (room.game && !vacant) return { ok: false, error: 'gameAlreadyStarted' };
    if (!room.game && room.seats.length >= MAX_PLAYERS) return { ok: false, error: 'roomFull' };
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
    if (room.game) room.game = { ...room.game, players: room.game.players.map((p, i) => (i === index ? { ...p, name } : p)) };
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
    if (!room?.game || room.game.phase === 'gameOver' || room.paused || !seat || seat.bot || seat.connected) return false;
    seat.away = true;
    return true;
  }

  /** L'hôte ajoute un bot sur un siège libre, avant la partie. */
  addBot(code: string, playerId: string): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (room.hostId !== playerId) return { ok: false, error: 'notHost' };
    if (room.game) return { ok: false, error: 'gameAlreadyStarted' };
    if (room.seats.length >= MAX_PLAYERS) return { ok: false, error: 'roomFull' };
    const name = BOT_NAMES.find((n) => !room.seats.some((s) => s.name === n)) ?? 'Robot';
    room.seats.push({ playerId: randomUUID(), token: randomUUID(), name, connected: true, bot: true });
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
    if (room.game.phase === 'gameOver') return { ok: false, error: 'wrongPhase' };
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

  /** Le joueur qui doit agir maintenant (jouer, rendre une carte ou couper), s'il y en a un. */
  seatToAct(code: string): Seat | null {
    const room = this.get(code);
    const game = room?.game;
    if (!room || !game) return null;
    const index =
      game.phase === 'playing'
        ? game.currentPlayer
        : game.phase === 'exchange'
          ? game.exchange!.winnerIndex
          : game.phase === 'cut'
            ? game.dealer
            : -1;
    return room.seats[index] ?? null;
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
   * il passera tout seul, sauf s'il a coupé l'option. Jamais quand il ouvre le pli, puisqu'il peut alors tout jouer.
   */
  stuckToPass(code: string): Seat | null {
    const room = this.get(code);
    const game = room?.game;
    if (!room || !game || room.paused || game.phase !== 'playing' || !game.table) return null;
    const seat = room.seats[game.currentPlayer];
    if (!seat || seat.bot || seat.away || seat.manualPass) return null;
    const n = game.players.length;
    const next = game.players[(game.currentPlayer + game.direction + n) % n]!;
    const hand = game.players[game.currentPlayer]!.hand;
    return playableCards(hand, game.table.combination, next.hand.length === 1).size === 0 ? seat : null;
  }

  /** Chaque joueur choisit s'il passe tout seul quand rien ne passe. */
  setAutoPass(code: string, playerId: string, enabled: boolean): Result {
    const seat = this.get(code)?.seats.find((s) => s.playerId === playerId && !s.bot);
    if (!seat) return { ok: false, error: 'notInRoom' };
    if (enabled) delete seat.manualPass;
    else seat.manualPass = true;
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
      room.seats.forEach((s) => (s.connected = !!s.bot));
      this.rooms.set(room.code, room);
    }
  }

  start(code: string, playerId: string, options: StartOptions = {}): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (room.hostId !== playerId) return { ok: false, error: 'notHost' };
    if (room.game) return { ok: false, error: 'gameAlreadyStarted' };
    if (room.seats.length < MIN_PLAYERS) return { ok: false, error: 'notEnoughPlayers' };
    room.game = createGame(
      room.seats.map((s) => ({ id: s.playerId, name: s.name })),
      options.seed ?? randomInt(2 ** 31),
      { targetScore: TARGET_SCORES.includes(options.targetScore!) ? options.targetScore! : DEFAULT_TARGET_SCORE },
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
    if (room.game.phase !== 'gameOver') return { ok: false, error: 'wrongPhase' };
    room.game = createGame(
      room.seats.map((s) => ({ id: s.playerId, name: s.name })),
      seed,
      room.game.config,
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

    const engineAction: Action = action.type === 'nextRound' ? action : { ...action, playerIndex };
    const result = applyAction(room.game, engineAction);
    if (!result.ok) return result;
    room.game = result.state;
    return { ok: true };
  }

  roomView(room: Room): RoomView {
    return {
      code: room.code,
      hostId: room.hostId,
      players: room.seats.map((s) => ({
        id: s.playerId,
        name: s.name,
        connected: s.connected,
        bot: s.bot ?? false,
        away: s.away ?? false,
        autoPass: !s.manualPass,
        vacant: s.vacant ?? false,
        muted: room.muted?.includes(s.playerId) ?? false,
        ...cleanLook(s),
      })),
      started: room.game !== null,
      turnSeconds: room.turnSeconds ?? 0,
      turnRemainingMs: null,
      spectators: 0,
      paused: room.paused ?? false,
    };
  }

  /** Ce que voit un spectateur : toute la table, mais aucune main (`you` vaut -1). */
  spectatorView(room: Room) {
    return room.game ? { ...getPlayerView(room.game, 0), you: -1, hand: [] } : null;
  }

  /** Parties en cours (ni en attente de joueurs, ni terminées), pour les spectateurs. */
  live(): { code: string; players: { name: string; score: number; bot: boolean }[]; round: number; open: boolean }[] {
    return this.all().flatMap((room) =>
      room.game && room.game.phase !== 'gameOver'
        ? [
            {
              code: room.code,
              round: room.game.round,
              open: room.seats.some((s) => s.vacant),
              players: room.game.players.map((p, i) => ({ name: p.name, score: p.score, bot: !!(room.seats[i]?.bot || room.seats[i]?.vacant) })),
            },
          ]
        : [],
    );
  }

  gameView(room: Room, playerId: string) {
    const index = room.seats.findIndex((s) => s.playerId === playerId);
    return room.game && index >= 0 ? getPlayerView(room.game, index) : null;
  }
}
