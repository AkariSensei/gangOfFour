import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GameState, createGame } from '@gof/engine';
import { describe, expect, it } from 'vitest';
import { AccountStore, GameHistory, seasonOf, seasonOfDay } from '../src';

function finished(scores: Record<string, number>): GameState {
  const names = Object.keys(scores);
  const game = createGame(
    names.map((name, i) => ({ id: `p${i}`, name })),
    1,
  );
  game.players.forEach((p) => (p.score = scores[p.name]!));
  const best = Math.min(...game.players.map((p) => p.score));
  game.winners = game.players.flatMap((p, i) => (p.score === best ? [i] : []));
  game.phase = 'gameOver';
  return game;
}

describe('GameHistory', () => {
  it('suit le compte et pas le pseudo, et rend les parties d\'avant les comptes au compte qui prend le pseudo', () => {
    const accounts = new AccountStore();
    accounts.signIn({ sub: 'a', email: 'a@exemple.fr' });
    accounts.signIn({ sub: 'b', email: 'b@exemple.fr' });
    accounts.update('b', { name: 'Bob' });
    const history = new GameHistory(undefined, accounts);
    // Partie d'avant les comptes : « alice » revient au compte qui prend le pseudo Alice, même renommé ensuite.
    history.record(finished({ alice: 10, Bruno: 120, David: 40 }));
    accounts.update('a', { name: 'Alice' });
    history.claim('Alice', 'a');
    // Bob jouait sous un pseudo usurpé « Bruno » ? Impossible : son compte compte, quel que soit le nom à la table.
    history.record(finished({ Alice: 50, Bruno: 20, Chloé: 60 }), new Date(), [], ['a', 'b']);
    accounts.update('a', { name: 'Alicia' });
    expect(history.leaderboard().map((e) => [e.name, e.games, e.wins])).toEqual([
      ['Bob', 1, 1],
      ['Alicia', 2, 1],
      ['David', 1, 0],
      ['Chloé', 1, 0],
      ['Bruno', 1, 0],
    ]);
    expect(history.profile('alicia')).toMatchObject({ name: 'Alicia', games: 2 });
    expect(history.recent(1)[0]!.players.map((p) => p.name)).toEqual(['Alicia', 'Bob', 'Chloé']);
    expect(history.recent(1)[0]!.players[0]).not.toHaveProperty('account');
  });

  it("oublie les liens d'invitation au bout d'une semaine, et garde comptes et liens dans le fichier", () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gof-')), 'comptes.json');
    const accounts = new AccountStore(file);
    const result = accounts.createInvite(undefined, 0);
    if (!result.ok) throw new Error(result.error);
    expect(new AccountStore(file).findInvite(result.invite.code, 1000)).toBeDefined();
    expect(accounts.findInvite(result.invite.code, 8 * 24 * 3600 * 1000)).toBeUndefined();
    expect(accounts.register(result.invite.code, 'camille', 'motdepasse', 8 * 24 * 3600 * 1000)).toEqual({ ok: false, error: 'invalidInvite' });
    // Le mot de passe n'est jamais gardé en clair.
    const fresh = accounts.createInvite();
    if (!fresh.ok) throw new Error(fresh.error);
    expect(accounts.register(fresh.invite.code, 'camille', 'motdepasse').ok).toBe(true);
    expect(readFileSync(file, 'utf8')).not.toContain('motdepasse');
    expect(new AccountStore(file).passwordSignIn('camille', 'motdepasse').ok).toBe(true);
  });

  it('signe des sessions que personne ne peut fabriquer, et les coupe pour un compte bloqué', () => {
    const accounts = new AccountStore();
    accounts.signIn({ sub: 'a', email: 'a@exemple.fr' });
    const session = accounts.session('a');
    expect(accounts.fromSession(session)?.id).toBe('a');
    expect(accounts.fromSession(session.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeUndefined();
    expect(accounts.fromSession(session, Date.now() + 400 * 24 * 3600 * 1000)).toBeUndefined();
    expect(new AccountStore().fromSession(session)).toBeUndefined();
    accounts.update('a', { blocked: true });
    expect(accounts.fromSession(session)).toBeUndefined();
    expect(accounts.signIn({ sub: 'a', email: 'a@exemple.fr' })).toEqual({ ok: false, error: 'blocked' });
  });

  it('classe par victoires, puis taux de victoire, puis score moyen', () => {
    const history = new GameHistory();
    history.record(finished({ Alice: 20, Bruno: 104, Chloé: 60 }));
    history.record(finished({ Alice: 101, Bruno: 30, Chloé: 50 }));
    history.record(finished({ alice: 10, Bruno: 120, David: 40 }));
    expect(history.leaderboard().map((e) => [e.name, e.games, e.wins, e.averageScore])).toEqual([
      ['alice', 3, 2, 44],
      ['Bruno', 3, 1, 85],
      ['David', 1, 0, 40],
      ['Chloé', 2, 0, 55],
    ]);
    expect(history.recent(1)[0]!.players.find((p) => p.winner)!.name).toBe('alice');
  });

  it('fait un classement de la saison à l\'heure de Paris', () => {
    const history = new GameHistory();
    history.record(finished({ Alice: 20, Bruno: 104, David: 60 }), new Date('2026-11-30T23:30:00Z')); // déjà le 1er décembre à Paris
    history.record(finished({ Alice: 101, Bruno: 30, David: 50 }), new Date('2027-01-15T12:00:00Z'));
    history.record(finished({ Alice: 10, Chloé: 50, David: 40 }), new Date('2026-11-30T20:00:00Z'));
    expect(seasonOf(new Date('2026-11-30T23:30:00Z')).id).toBe('2026-hiver');
    expect(history.leaderboard(10, '2026-hiver').map((e) => [e.name, e.games, e.wins])).toEqual([
      ['Alice', 2, 1],
      ['Bruno', 2, 1],
      ['David', 2, 0],
    ]);
    expect(history.leaderboard(10, '2026-automne').map((e) => e.name)).toEqual(['Alice', 'David', 'Chloé']);
    expect(history.leaderboard(10, '2027-printemps')).toEqual([]);
    // Les parties d'un autre jeu ne comptent pas dans le classement de Gang of Four.
    expect(history.leaderboard(10, undefined, undefined, 'president')).toEqual([]);
  });

  it("découpe l'année en quatre saisons, l'hiver à cheval sur deux années", () => {
    expect(seasonOfDay('2026-11-04')).toEqual({ id: '2026-automne', name: "Saison d'automne 2026", start: '2026-09-01', end: '2026-11-30' });
    expect(seasonOfDay('2027-02-28')).toEqual({ id: '2026-hiver', name: "Saison d'hiver 2026-2027", start: '2026-12-01', end: '2027-02-28' });
    expect(seasonOfDay('2028-02-10').end).toBe('2028-02-29');
    expect(seasonOfDay('2027-03-01')).toMatchObject({ id: '2027-printemps', name: 'Saison de printemps 2027', end: '2027-05-31' });
    expect(seasonOfDay('2027-08-31')).toMatchObject({ id: '2027-ete', name: "Saison d'été 2027", start: '2027-06-01' });
  });

  it('enregistre dans un fichier et le relit au démarrage', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gof-')), 'data', 'parties.json');
    new GameHistory(file).record(finished({ Alice: 20, Bruno: 104, Chloé: 60 }));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
    expect(new GameHistory(file).leaderboard()[0]).toMatchObject({ name: 'Alice', wins: 1 });
  });

  it('démarre avec un historique vide si le fichier est absent ou illisible', () => {
    expect(new GameHistory('/chemin/inexistant/parties.json').leaderboard()).toEqual([]);
  });

  it('garde les bots dans l\'historique mais pas dans le classement', () => {
    const history = new GameHistory();
    history.record(finished({ Alice: 20, 'Robot Ada': 104, 'Robot Alan': 60 }), new Date(), [1, 2]);
    expect(history.recent(1)[0]!.players.filter((p) => p.bot).map((p) => p.name)).toEqual(['Robot Ada', 'Robot Alan']);
    expect(history.leaderboard().map((e) => e.name)).toEqual(['Alice']);
  });

  it('construit la fiche d\'un joueur à partir de ses parties', () => {
    const history = new GameHistory();
    const first = finished({ Alice: 20, Bruno: 104, Chloé: 60 });
    first.stats = [
      { roundsWon: 3, gangs: 1, worstRound: 10 },
      { roundsWon: 0, gangs: 0, worstRound: 32 },
      { roundsWon: 1, gangs: 2, worstRound: 18 },
    ];
    history.record(first, new Date('2026-10-26T10:00:00Z'));
    history.record(finished({ alice: 101, Bruno: 30, Chloé: 50 }), new Date('2026-10-26T11:00:00Z'));
    expect(history.profile('ALICE')).toMatchObject({
      name: 'alice',
      games: 2,
      wins: 1,
      averageScore: 61,
      bestScore: 20,
      roundsWon: 3,
      gangs: 1,
      worstRound: 10,
      recent: [
        { score: 101, winner: false, rank: 3, players: 3 },
        { score: 20, winner: true, rank: 1, players: 3 },
      ],
    });
    expect(history.profile('David')).toBeNull();
  });

  it('retient le niveau des bots, et range sur la fiche les parties seul contre eux par niveau', () => {
    const history = new GameHistory();
    history.record(finished({ Alice: 10, Bruno: 50, Chloé: 60 }));
    history.record(finished({ Alice: 0, 'Robot Ada': 50, 'Robot Alan': 60 }), new Date(), [1, 2], [], [undefined, 'normal', 'normal']);
    history.record(finished({ Alice: 5, 'Robot Ada': 50, 'Robot Alan': 60 }), new Date(), [1, 2], [], [undefined, 'hard', 'easy']);
    expect(history.recent(1)[0]!.players.map((p) => p.botLevel)).toEqual([undefined, 'hard', 'easy']);
    // Le niveau d'une table est celui de son bot le plus fort.
    expect(history.profile('Alice')!.vsBots).toEqual([
      { level: 'easy', games: 0, wins: 0 },
      { level: 'normal', games: 1, wins: 1 },
      { level: 'hard', games: 1, wins: 1 },
    ]);
  });

  it('tire le niveau des seules parties, en ligne ou contre des bots tous difficiles', () => {
    const history = new GameHistory();
    // Première en ligne à trois : 110 XP. Contre des bots moyens : rien. Contre des bots difficiles : 110 de plus.
    history.record(finished({ Alice: 10, Bruno: 50, Chloé: 60 }), new Date(), [], ['a', 'b', 'c']);
    history.record(finished({ Alice: 0, 'Robot Ada': 50, 'Robot Alan': 60 }), new Date(), [1, 2], ['a'], [undefined, 'normal', 'normal']);
    expect(history.progressOfAccount('a')).toMatchObject({ xp: 110, level: 2 });
    history.record(finished({ Alice: 0, 'Robot Ada': 50, 'Robot Alan': 60 }), new Date(), [1, 2], ['a'], [undefined, 'hard', 'hard']);
    expect(history.progressOfAccount('a').xp).toBe(220);
    expect(history.unlocksOfAccount('a').frames).toEqual(['bronze']);
  });

  it('compte la série de jours joués, avec les parties qui rapportent de l’expérience', () => {
    const history = new GameHistory();
    const at = (day: string) => new Date(`${day}T12:00:00Z`);
    history.record(finished({ Alice: 10, Bruno: 50, Chloé: 60 }), at('2026-11-02'), [], ['a', 'b', 'c']);
    history.record(finished({ Alice: 10, Bruno: 50, Chloé: 60 }), at('2026-11-03'), [], ['a', 'b', 'c']);
    // Seule contre des bots faciles : ne compte pas pour la série.
    history.record(finished({ Alice: 0, 'Robot Ada': 50, 'Robot Alan': 60 }), at('2026-11-04'), [1, 2], ['a'], [undefined, 'easy', 'easy']);
    expect(history.dailyOfAccount('a', at('2026-11-04'))).toEqual({ day: '2026-11-04', streak: 2, playedToday: false });
    expect(history.dailyOfAccount('a', at('2026-11-06'))).toMatchObject({ streak: 0 });
  });

  it('sépare les parties en ligne de celles jouées seul contre des bots', () => {
    const history = new GameHistory();
    // En ligne : deux personnes (et un bot) ; seul contre les bots : une personne et deux bots.
    history.record(finished({ Alice: 10, Bob: 50, 'Robot Ada': 90 }), new Date(), [2], ['a', 'b']);
    history.record(finished({ Alice: 60, 'Robot Ada': 5, 'Robot Alan': 90 }), new Date(), [1, 2], ['a']);
    history.record(finished({ Chloé: 0, 'Robot Ada': 50, 'Robot Alan': 90 }), new Date(), [1, 2], ['c']);
    expect(history.leaderboard(10, undefined, 'online').map((e) => [e.name, e.games, e.wins])).toEqual([
      ['Alice', 1, 1],
      ['Bob', 1, 0],
    ]);
    expect(history.leaderboard(10, undefined, 'bots').map((e) => [e.name, e.games, e.wins])).toEqual([
      ['Chloé', 1, 1],
      ['Alice', 1, 0],
    ]);
    // Sans précision, toutes les parties comptent.
    expect(history.leaderboard().find((e) => e.name === 'Alice')).toMatchObject({ games: 2, wins: 1 });
    // Le record de série ne compte que les parties du type demandé.
    history.record(finished({ Chloé: 0, 'Robot Ada': 50, 'Robot Alan': 90 }), new Date(), [1, 2], ['c']);
    expect(history.bestStreak('bots')).toEqual({ name: 'Chloé', wins: 2 });
    expect(history.bestStreak('online')).toBeNull();
  });

  it('garde la plus longue série de victoires d\'un compte', () => {
    const history = new GameHistory();
    expect(history.bestStreak()).toBeNull();
    const play = (scores: Record<string, number>) => history.record(finished(scores), new Date(), [2], ['a', 'b']);
    play({ Alice: 10, Bob: 50, Bot: 0 }); // le bot gagne : la série d'Alice ne démarre pas
    play({ Alice: 10, Bob: 50, Bot: 90 });
    expect(history.bestStreak()).toBeNull();
    play({ Alice: 10, Bob: 10, Bot: 90 }); // victoire partagée
    play({ Alice: 10, Bob: 50, Bot: 90 });
    play({ Alice: 50, Bob: 10, Bot: 90 });
    play({ Alice: 50, Bob: 10, Bot: 90 });
    play({ Alice: 50, Bob: 10, Bot: 90 });
    expect(history.bestStreak()).toEqual({ name: 'Alice', wins: 3 }); // égalité : Alice l'a atteint en premier
    play({ Alice: 10, Bob: 10, Bot: 90 });
    expect(history.bestStreak()).toEqual({ name: 'Bob', wins: 4 });
  });

  it('remet le classement à zéro en archivant les parties, sans les effacer du fichier', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gof-')), 'history.json');
    const history = new GameHistory(file);
    const play = (scores: Record<string, number>) => history.record(finished(scores), new Date(), [2], ['a', 'b']);
    play({ Alice: 10, Bob: 50, Bot: 90 });
    play({ Alice: 10, Bob: 50, Bot: 90 });
    history.resetRanking();
    expect(history.leaderboard()).toEqual([]);
    expect(history.recent()).toEqual([]);
    expect(history.bestStreak()).toBeNull();
    expect(history.profile('Alice')).toBeNull();
    expect(history.isRanked('a')).toBe(false);
    play({ Alice: 50, Bob: 10, Bot: 90 });
    expect(history.leaderboard().map((e) => [e.name, e.wins, e.games])).toEqual([
      ['Bob', 1, 1],
      ['Alice', 0, 1],
    ]);
    expect(new GameHistory(file).leaderboard()).toHaveLength(2);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(3);
  });

  it('retire un compte du classement, des records et de sa fiche', () => {
    const history = new GameHistory();
    const play = (scores: Record<string, number>) => history.record(finished(scores), new Date(), [2], ['a', 'b']);
    play({ Alice: 10, Bob: 50, Bot: 90 });
    play({ Alice: 10, Bob: 50, Bot: 90 });
    history.removeFromRanking('a');
    expect(history.leaderboard().map((e) => e.name)).toEqual(['Bob']);
    expect(history.bestStreak()).toBeNull();
    expect(history.profile('Alice')).toBeNull();
    expect(history.isRanked('a')).toBe(false);
    expect(history.recent()[0]!.players.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Bot']);
    // Ses parties suivantes comptent à nouveau.
    play({ Alice: 10, Bob: 50, Bot: 90 });
    expect(history.leaderboard()[0]).toMatchObject({ name: 'Alice', wins: 1, games: 1 });
  });

});
