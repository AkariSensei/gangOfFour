import { describe, expect, it } from 'vitest';
import type { GameState, PlayerView } from '@gof/engine';
import { RoomManager } from '../src';

/** Un salon de `count` humains ; `training` : un entraînement, où l'hôte seul peut asseoir des bots. */
function roomWith(count: number, training = false) {
  const rooms = new RoomManager();
  const host = rooms.create('Alice', {}, undefined, 'gof', training);
  if (!host.ok) throw new Error(host.error);
  const others = ['Bruno', 'Chloé', 'David', 'Emma'].slice(0, count - 1).map((name) => {
    const s = rooms.join(host.code, name);
    if (!s.ok) throw new Error(s.error);
    return s;
  });
  return { rooms, host, others };
}

describe('RoomManager', () => {
  it('crée un salon avec un code de 4 chiffres et en fait son hôte', () => {
    const { rooms, host } = roomWith(1);
    expect(host.code).toMatch(/^[0-9]{4}$/);
    expect(rooms.get(host.code)!.hostId).toBe(host.playerId);
  });

  it('ne donne qu\'un siège par salon à un même compte', () => {
    const rooms = new RoomManager();
    const host = rooms.create('Alice', {}, 'compte-1');
    if (!host.ok) throw new Error(host.error);
    expect(rooms.join(host.code, 'Alice', {}, 'compte-1')).toEqual({ ok: false, error: 'alreadySeated' });
    expect(rooms.join(host.code, 'Bruno', {}, 'compte-2').ok).toBe(true);
    expect(rooms.join(host.code, 'Chloé').ok).toBe(true);
    expect(rooms.roomView(rooms.get(host.code)!).players[0]).not.toHaveProperty('account');
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
    expect((a.rooms.get(a.host.code)!.game as GameState).config.targetScore).toBe(50);
    const b = roomWith(3);
    b.rooms.start(b.host.code, b.host.playerId, { targetScore: 7 });
    expect((b.rooms.get(b.host.code)!.game as GameState).config.targetScore).toBe(100);
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
    expect((room.game as GameState).config.targetScore).toBe(50);
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
    // Depuis un nouvel onglet, on ne prend pas une place encore ouverte ailleurs.
    expect(rooms.rejoin(host.code, others[0]!.token, true)).toEqual({ ok: false, error: 'seatTaken' });
    rooms.leave(host.code, others[0]!.playerId);
    expect(rooms.rejoin(host.code, others[0]!.token, true)).toMatchObject({ ok: true });
  });

  it('déduit le siège du joueur et refuse de jouer à sa place', () => {
    const { rooms, host, others } = roomWith(4);
    rooms.start(host.code, host.playerId, { seed: 42 });
    const room = rooms.get(host.code)!;
    const current = room.seats[(room.game as GameState).currentPlayer]!;
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
    const view = rooms.gameView(room, others[1]!.playerId) as PlayerView;
    expect(view.you).toBe(2);
    const game = room.game as GameState;
    expect(view.hand).toEqual(game.players[2]!.hand);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(game.players[0]!.hand));
  });

  it('n\'accepte des bots qu\'à l\'entraînement, où personne d\'autre ne peut entrer', () => {
    // Une vraie table n'a que des humains.
    const real = roomWith(2);
    expect(real.rooms.addBot(real.host.code, real.host.playerId)).toEqual({ ok: false, error: 'trainingOnly' });

    const { rooms, host } = roomWith(1, true);
    expect(rooms.join(host.code, 'Bruno')).toEqual({ ok: false, error: 'trainingRoom' });
    expect(rooms.addBot(host.code, host.playerId)).toEqual({ ok: true });
    expect(rooms.addBot(host.code, host.playerId)).toEqual({ ok: true });
    expect(rooms.addBot(host.code, host.playerId)).toEqual({ ok: true });
    expect(rooms.addBot(host.code, host.playerId)).toEqual({ ok: false, error: 'roomFull' });
    const bots = rooms.get(host.code)!.seats.filter((s) => s.bot);
    expect(bots.map((b) => b.name)).toEqual(['Robot Ada', 'Robot Alan', 'Robot Grace']);
    // Sans niveau précisé, un bot est moyen ; le niveau se voit dans la vue du salon, qui dit aussi que c'est un entraînement.
    const view = rooms.roomView(rooms.get(host.code)!);
    expect(view.training).toBe(true);
    expect(view.players.filter((p) => p.bot).map((p) => p.level)).toEqual(['normal', 'normal', 'normal']);

    expect(rooms.removeBot(host.code, host.playerId, host.playerId)).toEqual({ ok: true });
    expect(rooms.get(host.code)!.seats).toHaveLength(4); // un humain ne se retire pas comme un bot
    expect(rooms.removeBot(host.code, host.playerId, bots[2]!.playerId)).toEqual({ ok: true });
    expect(rooms.get(host.code)!.seats).toHaveLength(3);

    expect(rooms.start(host.code, host.playerId)).toEqual({ ok: true });
    expect(rooms.addBot(host.code, host.playerId)).toEqual({ ok: false, error: 'gameAlreadyStarted' });
  });

  it('liste les salons d\'un jeu qui attendent des joueurs, sans les entraînements ni les parties lancées', () => {
    const rooms = new RoomManager();
    const waiting = rooms.create('Alice', {}, undefined, 'slots');
    const gof = rooms.create('Bruno');
    const training = rooms.create('Chloé', {}, undefined, 'slots', true);
    if (!waiting.ok || !gof.ok || !training.ok) throw new Error('salon');
    expect(rooms.open('slots')).toEqual([{ code: waiting.code, game: 'slots', host: 'Alice', players: 1, minPlayers: 2, maxPlayers: 2 }]);
    expect(rooms.open('gof').map((r) => r.code)).toEqual([gof.code]);
    // Lancée, ou l'hôte parti : le salon n'est plus proposé.
    rooms.join(gof.code, 'David');
    rooms.join(gof.code, 'Emma');
    rooms.start(gof.code, gof.playerId);
    expect(rooms.open('gof')).toEqual([]);
    rooms.setConnected(waiting.code, waiting.playerId, false);
    expect(rooms.open('slots')).toEqual([]);
  });

  it('donne à chaque bot le niveau choisi par l\'hôte, et moyen pour un niveau inconnu', () => {
    const { rooms, host } = roomWith(1, true);
    expect(rooms.addBot(host.code, host.playerId, 'hard')).toEqual({ ok: true });
    expect(rooms.addBot(host.code, host.playerId, 'easy')).toEqual({ ok: true });
    expect(rooms.addBot(host.code, host.playerId, 'expert')).toEqual({ ok: true });
    expect(rooms.get(host.code)!.seats.filter((s) => s.bot).map((s) => s.level)).toEqual(['hard', 'easy', 'normal']);
  });

  it('passe l\'hôte au joueur suivant, et supprime un salon où il ne reste que des bots', () => {
    const { rooms, host, others } = roomWith(2);
    rooms.leave(host.code, host.playerId);
    expect(rooms.get(host.code)!.hostId).toBe(others[0]!.playerId);
    const training = roomWith(1, true);
    training.rooms.addBot(training.host.code, training.host.playerId);
    training.rooms.leave(training.host.code, training.host.playerId);
    expect(training.rooms.get(training.host.code)).toBeUndefined();
  });

  it('dit quel bot doit agir, et ne compte pas les bots pour savoir si un salon est abandonné', () => {
    const { rooms, host } = roomWith(1, true);
    rooms.addBot(host.code, host.playerId);
    rooms.addBot(host.code, host.playerId);
    rooms.start(host.code, host.playerId, { seed: 3 });
    const room = rooms.get(host.code)!;
    const game = room.game as GameState;
    const actor = game.phase === 'cut' ? game.dealer : game.phase === 'exchange' ? game.exchange!.winnerIndex : game.currentPlayer;
    expect(rooms.botToAct(host.code)).toBe(actor === 0 ? null : room.seats[actor]);
    rooms.setConnected(host.code, host.playerId, false);
    expect(rooms.isAbandoned(host.code)).toBe(true);
  });
});
