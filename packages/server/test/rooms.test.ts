import { describe, expect, it } from 'vitest';
import { RoomManager } from '../src';

function roomWith(count: number) {
  const rooms = new RoomManager();
  const host = rooms.create('Alice');
  if (!host.ok) throw new Error(host.error);
  const others = ['Bruno', 'Chloé', 'David', 'Emma'].slice(0, count - 1).map((name) => {
    const s = rooms.join(host.code, name);
    if (!s.ok) throw new Error(s.error);
    return s;
  });
  return { rooms, host, others };
}

describe('RoomManager', () => {
  it('crée un salon avec un code de 4 lettres et en fait son hôte', () => {
    const { rooms, host } = roomWith(1);
    expect(host.code).toMatch(/^[A-Z]{4}$/);
    expect(rooms.get(host.code)!.hostId).toBe(host.playerId);
  });

  it('refuse un pseudo vide et nettoie les espaces', () => {
    const rooms = new RoomManager();
    expect(rooms.create('   ')).toEqual({ ok: false, error: 'invalidName' });
    const s = rooms.create('  Alice  ');
    expect(s.ok && rooms.get(s.code)!.seats[0]!.name).toBe('Alice');
  });

  it('accepte le code en minuscules et refuse un cinquième joueur', () => {
    const { rooms, host } = roomWith(4);
    expect(rooms.join(host.code.toLowerCase(), 'Emma')).toEqual({ ok: false, error: 'roomFull' });
    expect(rooms.join('ZZZZ', 'Emma')).toEqual({ ok: false, error: 'roomNotFound' });
  });

  it('ne laisse que l\'hôte lancer la partie, à partir de 3 joueurs', () => {
    const two = roomWith(2);
    expect(two.rooms.start(two.host.code, two.host.playerId)).toEqual({ ok: false, error: 'notEnoughPlayers' });

    const { rooms, host, others } = roomWith(3);
    expect(rooms.start(host.code, others[0]!.playerId)).toEqual({ ok: false, error: 'notHost' });
    expect(rooms.start(host.code, host.playerId)).toEqual({ ok: true });
    expect(rooms.join(host.code, 'Emma')).toEqual({ ok: false, error: 'gameAlreadyStarted' });
  });

  it('transmet l\'hôte quand il quitte le salon avant la partie, et supprime le salon vide', () => {
    const { rooms, host, others } = roomWith(2);
    rooms.leave(host.code, host.playerId);
    expect(rooms.get(host.code)!.hostId).toBe(others[0]!.playerId);
    rooms.leave(host.code, others[0]!.playerId);
    expect(rooms.get(host.code)).toBeUndefined();
  });

  it('garde le siège pendant la partie et permet de le reprendre avec le jeton', () => {
    const { rooms, host, others } = roomWith(4);
    rooms.start(host.code, host.playerId);
    rooms.leave(host.code, others[0]!.playerId);
    expect(rooms.get(host.code)!.seats).toHaveLength(4);
    expect(rooms.get(host.code)!.seats[1]!.connected).toBe(false);

    expect(rooms.rejoin(host.code, 'mauvais-jeton')).toEqual({ ok: false, error: 'roomNotFound' });
    expect(rooms.rejoin(host.code, others[0]!.token)).toMatchObject({ ok: true, playerId: others[0]!.playerId });
    expect(rooms.get(host.code)!.seats[1]!.connected).toBe(true);
  });

  it('déduit le siège du joueur et refuse de jouer à sa place', () => {
    const { rooms, host, others } = roomWith(4);
    rooms.start(host.code, host.playerId, 42);
    const room = rooms.get(host.code)!;
    const current = room.seats[room.game!.currentPlayer]!;
    const someoneElse = [host, ...others].find((s) => s.playerId !== current.playerId)!;
    expect(rooms.act(host.code, someoneElse.playerId, { type: 'play', cardIds: ['m1'] })).toEqual({
      ok: false,
      error: 'notYourTurn',
    });
    expect(rooms.act(host.code, current.playerId, { type: 'play', cardIds: ['m1'] })).toEqual({ ok: true });
  });

  it('ne montre à chaque joueur que sa propre main', () => {
    const { rooms, host, others } = roomWith(4);
    rooms.start(host.code, host.playerId);
    const room = rooms.get(host.code)!;
    const view = rooms.gameView(room, others[1]!.playerId)!;
    expect(view.you).toBe(2);
    expect(view.hand).toEqual(room.game!.players[2]!.hand);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(room.game!.players[0]!.hand));
  });
});
