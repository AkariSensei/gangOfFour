import { randomInt, randomUUID } from 'node:crypto';
import { type Action, type ActionError, type GameState, applyAction, createGame, getPlayerView } from '@gof/engine';
import type { RoomError, RoomView, Session } from './protocol';

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 3;
const MAX_NAME_LENGTH = 20;
/** Scores de fin de partie que l'hôte peut choisir. */
export const TARGET_SCORES = [50, 100, 200];
const DEFAULT_TARGET_SCORE = 100;

export interface StartOptions {
  seed?: number;
  targetScore?: number;
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
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
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

  private seat(room: Room, name: string): Session {
    const seat: Seat = { playerId: randomUUID(), token: randomUUID(), name, connected: true };
    room.seats.push(seat);
    return { code: room.code, playerId: seat.playerId, token: seat.token };
  }

  create(rawName: unknown): Result<Session> {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'invalidName' };
    const room: Room = { code: this.newCode(), hostId: '', seats: [], game: null };
    const session = this.seat(room, name);
    room.hostId = session.playerId;
    this.rooms.set(room.code, room);
    return { ok: true, ...session };
  }

  join(code: string, rawName: unknown): Result<Session> {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'invalidName' };
    const room = this.get(code);
    if (!room) return { ok: false, error: 'roomNotFound' };
    if (room.game) return { ok: false, error: 'gameAlreadyStarted' };
    if (room.seats.length >= MAX_PLAYERS) return { ok: false, error: 'roomFull' };
    return { ok: true, ...this.seat(room, name) };
  }

  rejoin(code: string, token: string): Result<Session> {
    const room = this.get(code);
    const seat = room?.seats.find((s) => s.token === token);
    if (!room || !seat) return { ok: false, error: 'roomNotFound' };
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

  /** Le bot qui doit agir maintenant dans ce salon (jouer, rendre une carte ou couper), s'il y en a un. */
  botToAct(code: string): Seat | null {
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
    const seat = room.seats[index];
    return seat?.bot ? seat : null;
  }

  delete(code: string): void {
    this.rooms.delete(code.toUpperCase());
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
      players: room.seats.map((s) => ({ id: s.playerId, name: s.name, connected: s.connected, bot: s.bot ?? false })),
      started: room.game !== null,
    };
  }

  gameView(room: Room, playerId: string) {
    const index = room.seats.findIndex((s) => s.playerId === playerId);
    return room.game && index >= 0 ? getPlayerView(room.game, index) : null;
  }
}
