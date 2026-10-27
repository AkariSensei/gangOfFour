import { randomInt, randomUUID } from 'node:crypto';
import { type Action, type ActionError, type GameState, applyAction, createGame, getPlayerView } from '@gof/engine';
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
  avatar?: string;
  color?: string;
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
}

/** Action de jeu telle qu'envoyée par un joueur : son siège est déduit du serveur, jamais du client. */
export type PlayerAction =
  | { type: 'play'; cardIds: string[] }
  | { type: 'pass' }
  | { type: 'giveCard'; cardId: string }
  | { type: 'nextRound' }
  | { type: 'cut'; position: number };

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: RoomError | ActionError };

function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  // Pas de caractères invisibles ou de contrôle, qui permettraient des pseudos vides ou trompeurs.
  const trimmed = name.replace(/[\p{C}]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** Garde seulement un avatar et une couleur de la liste proposée. */
function cleanLook(look: unknown): Look {
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

  private seat(room: Room, name: string, look: unknown): Session {
    const seat: Seat = { playerId: randomUUID(), token: randomUUID(), name, connected: true, ...cleanLook(look) };
    room.seats.push(seat);
    return { code: room.code, playerId: seat.playerId, token: seat.token };
  }

  create(rawName: unknown, look?: unknown): Result<Session> {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'invalidName' };
    const room: Room = { code: this.newCode(), hostId: '', seats: [], game: null };
    const session = this.seat(room, name, look);
    room.hostId = session.playerId;
    this.rooms.set(room.code, room);
    return { ok: true, ...session };
  }

  join(code: string, rawName: unknown, look?: unknown): Result<Session> {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'invalidName' };
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (room.game) return { ok: false, error: 'gameAlreadyStarted' };
    if (room.seats.length >= MAX_PLAYERS) return { ok: false, error: 'roomFull' };
    return { ok: true, ...this.seat(room, name, look) };
  }

  /** `onlyIfFree` : ne reprend pas un siège encore occupé par un autre onglet ouvert. */
  rejoin(code: string, token: string, onlyIfFree = false): Result<Session> {
    const room = this.get(code);
    const seat = room?.seats.find((s) => s.token === token);
    if (!room || !seat) return { ok: false, error: 'roomNotFound' };
    if (onlyIfFree && seat.connected) return { ok: false, error: 'seatTaken' };
    seat.connected = true;
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

  /** Le bot qui doit agir maintenant dans ce salon, s'il y en a un. */
  botToAct(code: string): Seat | null {
    const seat = this.seatToAct(code);
    return seat?.bot ? seat : null;
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

  act(code: string, playerId: string, action: PlayerAction): Result {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (!room.game) return { ok: false, error: 'gameNotStarted' };
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
        ...cleanLook(s),
      })),
      started: room.game !== null,
      turnSeconds: room.turnSeconds ?? 0,
      turnRemainingMs: null,
      spectators: 0,
    };
  }

  /** Ce que voit un spectateur : toute la table, mais aucune main (`you` vaut -1). */
  spectatorView(room: Room) {
    return room.game ? { ...getPlayerView(room.game, 0), you: -1, hand: [] } : null;
  }

  /** Parties en cours (ni en attente de joueurs, ni terminées), pour les spectateurs. */
  live(): { code: string; players: { name: string; score: number; bot: boolean }[]; round: number }[] {
    return this.all().flatMap((room) =>
      room.game && room.game.phase !== 'gameOver'
        ? [
            {
              code: room.code,
              round: room.game.round,
              players: room.game.players.map((p, i) => ({ name: p.name, score: p.score, bot: room.seats[i]?.bot ?? false })),
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
