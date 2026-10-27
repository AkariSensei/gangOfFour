import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GameState, createGame } from '@gof/engine';
import { describe, expect, it } from 'vitest';
import { AccountStore, GameHistory, monthOf } from '../src';

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

  it('fait un classement du mois à l\'heure de Paris', () => {
    const history = new GameHistory();
    history.record(finished({ Alice: 20, Bruno: 104, David: 60 }), new Date('2026-09-30T22:30:00Z')); // déjà le 1er octobre à Paris
    history.record(finished({ Alice: 101, Bruno: 30, David: 50 }), new Date('2026-10-15T12:00:00Z'));
    history.record(finished({ Alice: 10, Chloé: 50, David: 40 }), new Date('2026-09-30T20:00:00Z'));
    expect(monthOf(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10');
    expect(history.leaderboard(10, '2026-10').map((e) => [e.name, e.games, e.wins])).toEqual([
      ['Alice', 2, 1],
      ['Bruno', 2, 1],
      ['David', 2, 0],
    ]);
    expect(history.leaderboard(10, '2026-09').map((e) => e.name)).toEqual(['Alice', 'David', 'Chloé']);
    expect(history.leaderboard(10, '2026-11')).toEqual([]);
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

  it('calcule les badges d\'un joueur', () => {
    const history = new GameHistory();
    const first = finished({ Alice: 15, Bruno: 104, Chloé: 60 });
    first.round = 11;
    first.stats = [
      { roundsWon: 6, gangs: 1, worstRound: 10 },
      { roundsWon: 0, gangs: 0, worstRound: 80 },
      { roundsWon: 1, gangs: 0, worstRound: 18 },
    ];
    history.record(first);
    history.record(finished({ Alice: 30, Bruno: 50, Chloé: 60 }));
    history.record(finished({ Alice: 90, Bruno: 50, Chloé: 60 }));
    const badges = (name: string) => Object.fromEntries(history.profile(name)!.badges.map((b) => [b.id, `${b.value}/${b.goal}`]));
    expect(badges('Alice')).toMatchObject({
      'first-win': '1/1',
      'games-10': '3/10',
      'streak-3': '2/3',
      'gang-1': '1/1',
      'clean-win': '1/1',
      steamroller: '5/5',
      marathon: '10/10',
      scapegoat: '0/1',
    });
    expect(badges('Bruno')).toMatchObject({ 'first-win': '1/1', scapegoat: '1/1', 'clean-win': '0/1' });
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
