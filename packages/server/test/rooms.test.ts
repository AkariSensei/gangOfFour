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

  it("garde l'avatar et la couleur choisis seulement s'ils sont dans la liste", () => {
    const rooms = new RoomManager();
    const host = rooms.create('Alice', { avatar: '🦊', color: '#3b82c4' });
    if (!host.ok) throw new Error(host.error);
    rooms.join(host.code, 'Bruno', { avatar: '<script>', color: 'red' });
    rooms.join(host.code, 'Chloé');
    const players = rooms.roomView(rooms.get(host.code)!).players;
    expect(players.map(({ avatar, color }) => ({ avatar, color }))).toEqual([
      { avatar: '🦊', color: '#3b82c4' },
      { avatar: undefined, color: undefined },
      { avatar: undefined, color: undefined },
    ]);
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

  it('applique le score de fin choisi par l\'hôte, ou 100 par défaut', () => {
    const a = roomWith(3);
    a.rooms.start(a.host.code, a.host.playerId, { targetScore: 50 });
    expect(a.rooms.get(a.host.code)!.game!.config.targetScore).toBe(50);
    const b = roomWith(3);
    b.rooms.start(b.host.code, b.host.playerId, { targetScore: 7 });
    expect(b.rooms.get(b.host.code)!.game!.config.targetScore).toBe(100);
  });

  it('relance une partie terminée avec les mêmes joueurs et réglages, seulement une fois finie', () => {
    const { rooms, host, others } = roomWith(3);
    rooms.start(host.code, host.playerId, { targetScore: 50, turnSeconds: 30 });
    expect(rooms.rematch(host.code, others[0]!.playerId)).toEqual({ ok: false, error: 'wrongPhase' });
    const room = rooms.get(host.code)!;
    room.game = { ...room.game!, phase: 'gameOver' };
    room.recorded = true;
    expect(rooms.rematch(host.code, 'inconnu')).toEqual({ ok: false, error: 'notInRoom' });
    expect(rooms.rematch(host.code, others[0]!.playerId)).toEqual({ ok: true });
    expect(room.game.phase).not.toBe('gameOver');
    expect(room.game.config.targetScore).toBe(50);
    expect(room.turnSeconds).toBe(30);
    expect(room.recorded).toBe(false);
    expect(room.game.players.map((p) => p.id)).toEqual(room.seats.map((s) => s.playerId));
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
    rooms.start(host.code, host.playerId, { seed: 42 });
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

  it('laisse l\'hôte ajouter et retirer des bots avant la partie, puis lancer à 3 avec un seul autre humain', () => {
    const { rooms, host, others } = roomWith(2);
    expect(rooms.addBot(host.code, others[0]!.playerId)).toEqual({ ok: false, error: 'notHost' });
    expect(rooms.addBot(host.code, host.playerId)).toEqual({ ok: true });
    expect(rooms.addBot(host.code, host.playerId)).toEqual({ ok: true });
    expect(rooms.addBot(host.code, host.playerId)).toEqual({ ok: false, error: 'roomFull' });
    const bots = rooms.get(host.code)!.seats.filter((s) => s.bot);
    expect(bots.map((b) => b.name)).toEqual(['Robot Ada', 'Robot Alan']);

    expect(rooms.removeBot(host.code, host.playerId, others[0]!.playerId)).toEqual({ ok: true });
    expect(rooms.get(host.code)!.seats).toHaveLength(4); // un humain ne se retire pas comme un bot
    expect(rooms.removeBot(host.code, host.playerId, bots[1]!.playerId)).toEqual({ ok: true });
    expect(rooms.get(host.code)!.seats).toHaveLength(3);

    expect(rooms.start(host.code, host.playerId)).toEqual({ ok: true });
    expect(rooms.addBot(host.code, host.playerId)).toEqual({ ok: false, error: 'gameAlreadyStarted' });
  });

  it('ne donne jamais l\'hôte à un bot, et supprime un salon où il ne reste que des bots', () => {
    const { rooms, host, others } = roomWith(2);
    rooms.addBot(host.code, host.playerId);
    rooms.leave(host.code, host.playerId);
    expect(rooms.get(host.code)!.hostId).toBe(others[0]!.playerId);
    rooms.leave(host.code, others[0]!.playerId);
    expect(rooms.get(host.code)).toBeUndefined();
  });

  it('dit quel bot doit agir, et ne compte pas les bots pour savoir si un salon est abandonné', () => {
    const { rooms, host } = roomWith(1);
    rooms.addBot(host.code, host.playerId);
    rooms.addBot(host.code, host.playerId);
    rooms.start(host.code, host.playerId, { seed: 3 });
    const room = rooms.get(host.code)!;
    const game = room.game!;
    const actor = game.phase === 'cut' ? game.dealer : game.phase === 'exchange' ? game.exchange!.winnerIndex : game.currentPlayer;
    expect(rooms.botToAct(host.code)).toBe(actor === 0 ? null : room.seats[actor]);
    rooms.setConnected(host.code, host.playerId, false);
    expect(rooms.isAbandoned(host.code)).toBe(true);
  });
});
