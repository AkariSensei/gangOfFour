import { type PlayingCard, type PresidentTitle, checkPresidentPlay, presidentPlayable, titleOf } from '@gof/engine';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { ChatMessage, PresidentGameView, RoomView } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { ChatButton, KickButton, MuteButton } from './Chat';
import { PlayingCardBack, PlayingCardView, playingCardLabel, rankName } from './PlayingCard';
import { PauseOverlay, ReactionButton, TurnBanner, useCountdown, useDelayed, useReactions } from './Table';
import { useAutoPass } from './autoPass';
import { LEVEL_LABELS, errorLabel } from './labels';
import { socket } from './socket';
import { useTurnAlert, useTurnNotifications } from './turnAlert';

export const TITLE_LABELS: Record<PresidentTitle, string> = {
  president: 'Président',
  vicePresident: 'Vice-président',
  neutral: 'Neutre',
  viceTrou: 'Vice-trou',
  trou: 'Trou',
};
const TITLE_ICONS: Record<PresidentTitle, string> = { president: '👑', vicePresident: '🎩', neutral: '', viceTrou: '🧹', trou: '🕳️' };

/** Les erreurs dont le message de Gang of Four ne convient pas au Président. */
const PRESIDENT_ERRORS: Record<string, string> = {
  invalidCombination: 'Pose des cartes de même valeur (une à quatre).',
  tooWeak: 'Il faut une valeur au moins égale à celle de la table.',
};
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const presidentError = (error: string) => PRESIDENT_ERRORS[error] ?? errorLabel(error);

/** Temps d'affichage des dernières cartes posées avant le résumé de fin de manche. */
const SUMMARY_DELAY_MS = 2200;

/** Titre de chaque joueur à la manche précédente (aucun pendant la première). */
function previousTitles(game: PresidentGameView): (PresidentTitle | null)[] {
  const order = game.lastRound?.order;
  const n = game.players.length;
  return game.players.map((_, i) => {
    const place = order?.indexOf(i) ?? -1;
    return place >= 0 ? titleOf(place, n) : null;
  });
}

/** Place de sortie d'un joueur dans la manche en cours (« 1er », « 2e »…), ou null s'il joue encore. */
function placeLabel(game: PresidentGameView, index: number): string | null {
  const place = game.finished.indexOf(index);
  if (place >= 0) return place === 0 ? '1er' : `${place + 1}e`;
  return game.endedOnTwo.includes(index) ? 'Fini sur un 2' : null;
}

function TitleBadge({ title }: { title: PresidentTitle | null }) {
  if (!title || title === 'neutral') return null;
  return (
    <span className={`p-title title-${title}`}>
      {TITLE_ICONS[title]} {TITLE_LABELS[title]}
    </span>
  );
}

/** Le centre de la table : les cartes à battre, les poses d'avant en retrait, et « X ou rien ». */
function Center({ game }: { game: PresidentGameView }) {
  const plays = game.trick.filter((e): e is { playerIndex: number; cards: PlayingCard[] } => e.cards !== null);
  const top = plays.at(-1);
  const earlier = plays.slice(-3, -1);
  if (game.phase === 'exchange') {
    return (
      <div className="p-center">
        <p className="p-center-note">Échange de cartes</p>
        <ul className="p-gifts">
          {game.gifts.map((g) => (
            <li key={g.from} className={g.done ? 'done' : ''}>
              <strong>{game.players[g.to]!.name}</strong> donne {g.count === 2 ? 'ses 2 meilleures cartes' : 'sa meilleure carte'} à{' '}
              <strong>{game.players[g.from]!.name}</strong>, qui lui en rend {g.count} {g.done ? '✓' : '…'}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (!top) {
    return (
      <div className="p-center">
        <p className="p-center-note">{game.phase === 'playing' ? `${game.players[game.currentPlayer]!.name} ouvre le pli` : ''}</p>
      </div>
    );
  }
  const closed = !game.table;
  return (
    <div className={`p-center ${closed ? 'closed' : ''}`}>
      <div className="p-pile">
        {earlier.map((e, k) => (
          <div key={`${e.playerIndex}-${k}`} className="p-play earlier" style={{ '--k': earlier.length - k } as CSSProperties}>
            {e.cards.map((c) => (
              <PlayingCardView key={c.id} card={c} small />
            ))}
          </div>
        ))}
        <div className="p-play top" key={top.cards.map((c) => c.id).join()}>
          {top.cards.map((c) => (
            <PlayingCardView key={c.id} card={c} />
          ))}
        </div>
      </div>
      <p className="p-center-note">
        {game.players[top.playerIndex]!.name}
        {closed ? ' remporte le pli' : ''}
      </p>
      {game.forcedRank !== null && !closed && <span className="p-forced">{capitalize(rankName(game.forcedRank))} ou rien !</span>}
    </div>
  );
}

/** Fin de manche (ou de partie) : les places, les points gagnés et le total de chacun. */
function RoundSummary({ game, onNext, onRematch, onExit }: { game: PresidentGameView; onNext: () => void; onRematch: () => void; onExit: () => void }) {
  const result = game.lastRound!;
  const over = game.phase === 'gameOver';
  const n = game.players.length;
  const ranking = [...game.players.keys()].sort((a, b) => game.players[b]!.score - game.players[a]!.score);
  return (
    <div className="overlay" role="dialog" aria-label={over ? 'Fin de la partie' : 'Fin de la manche'}>
      <div className="panel modal pop-in p-summary">
        <h2>{over ? 'Fin de la partie' : `Fin de la manche ${game.round} / ${game.rounds}`}</h2>
        {over && (
          <p className="p-winner">
            🏆 {game.winners.map((i) => game.players[i]!.name).join(' et ')} {game.winners.length > 1 ? 'gagnent' : 'gagne'} avec{' '}
            {game.players[game.winners[0]!]!.score} points
          </p>
        )}
        <ol className="p-places">
          {result.order.map((player, place) => (
            <li key={player} className={player === game.you ? 'me' : ''}>
              <span className="p-place">{place + 1}</span>
              <span className="p-place-name">
                {game.players[player]!.name}
                {result.endedOnTwo.includes(player) && <small> · fini sur un 2</small>}
              </span>
              <TitleBadge title={titleOf(place, n)} />
              <span className="p-points">+{result.points[player]}</span>
            </li>
          ))}
        </ol>
        <div className="p-totals">
          {ranking.map((i) => (
            <span key={i} className={game.winners.includes(i) ? 'winner' : ''}>
              {game.players[i]!.name} <strong>{game.players[i]!.score}</strong>
            </span>
          ))}
        </div>
        {!over && n >= 3 && (
          <p className="muted small">
            Manche suivante : le Trou donne ses 2 meilleures cartes au Président{n >= 4 ? ', le Vice-trou sa meilleure au Vice-président' : ''}.
          </p>
        )}
        <div className="p-summary-actions">
          {over ? (
            <>
              {game.you >= 0 && (
                <button className="primary" onClick={onRematch}>
                  Revanche
                </button>
              )}
              <button className="ghost" onClick={onExit}>
                Retour à l’accueil
              </button>
            </>
          ) : (
            game.you >= 0 && (
              <button className="primary" onClick={onNext}>
                Manche suivante
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** La table du Président : les adversaires en haut, les cartes posées au centre, sa main en bas. */
export function PresidentTable({
  game,
  room,
  messages,
  admin,
  felt,
  onLeave,
}: {
  game: PresidentGameView;
  room: RoomView;
  messages: ChatMessage[];
  admin: boolean;
  felt?: string;
  onLeave: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const me = game.you;
  const spectator = me < 0;
  const n = game.players.length;
  const moderator = admin || (!spectator && room.hostId === game.players[me]?.id);
  const hostGone = room.players.find((p) => p.id === room.hostId)?.connected === false;
  const canPause = moderator || (!spectator && hostGone);
  const myTurn = game.phase === 'playing' && game.currentPlayer === me;
  const gift = game.phase === 'exchange' ? game.gifts.find((g) => !g.done) : undefined;
  const mustGive = !!gift && gift.from === me && game.currentPlayer === me;
  const { autoPass, toggleAutoPass } = useAutoPass(room, game.players[me]?.id);
  const playable = useMemo(() => (myTurn && game.table ? presidentPlayable(game.hand, game.table, game.forcedRank) : null), [myTurn, game.hand, game.table, game.forcedRank]);
  const passingAlone = autoPass && playable?.size === 0;
  const notifications = useTurnNotifications();
  const reactions = useReactions();
  const titles = previousTitles(game);
  useTurnAlert(mustGive ? 'À toi de rendre des cartes' : myTurn && !passingAlone ? 'À toi de jouer !' : null, notifications.state === 'on');

  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  useEffect(() => {
    setTurnEndsAt(room.turnRemainingMs === null || room.paused ? null : Date.now() + room.turnRemainingMs);
  }, [room]);
  const running = useCountdown(turnEndsAt);
  const countdown = room.paused && room.turnRemainingMs !== null ? Math.ceil(room.turnRemainingMs / 1000) : running;
  const secondsLeft = countdown === null ? null : Math.min(countdown, room.turnSeconds);
  const roundFinished = game.phase === 'roundOver' || game.phase === 'gameOver';
  const showSummary = useDelayed(roundFinished, SUMMARY_DELAY_MS);

  useEffect(() => {
    setSelected((s) => s.filter((id) => game.hand.some((c) => c.id === id)));
  }, [game.hand]);
  useEffect(() => setError(''), [game.currentPlayer, game.phase]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const selectedCards = selected.map((id) => game.hand.find((c) => c.id === id)).filter((c): c is PlayingCard => !!c);

  /**
   * Choisir ses cartes : pour suivre, un clic prend d'un coup autant de cartes de cette valeur que la table en demande ;
   * pour ouvrir, on ajoute ou retire des cartes de la même valeur (une autre valeur repart de zéro).
   */
  function toggle(card: PlayingCard) {
    setError('');
    if (mustGive) {
      setSelected((s) => (s.includes(card.id) ? s.filter((id) => id !== card.id) : [...s, card.id].slice(-gift!.count)));
      return;
    }
    const count = game.table?.cards.length;
    if (count) {
      if (selected.includes(card.id)) return setSelected([]);
      const same = game.hand.filter((c) => c.rank === card.rank);
      const picked = [card, ...same.filter((c) => c.id !== card.id)].slice(0, count);
      setSelected(picked.map((c) => c.id));
      return;
    }
    setSelected((s) => {
      if (s.includes(card.id)) return s.filter((id) => id !== card.id);
      const sameRank = s.filter((id) => game.hand.find((c) => c.id === id)?.rank === card.rank);
      return [...sameRank, card.id];
    });
  }

  const hint = useMemo(() => {
    if (mustGive) {
      const left = gift!.count - selectedCards.length;
      return left > 0
        ? { text: `Choisis ${left} carte${left > 1 ? 's' : ''} à rendre à ${game.players[gift!.to]!.name}`, ok: false }
        : { text: `Donner ${selectedCards.map(playingCardLabel).join(' et ')}`, ok: true };
    }
    if (!myTurn) return null;
    if (selectedCards.length === 0) {
      if (!game.table) return { text: 'Pose une ou plusieurs cartes de même valeur', ok: true };
      if (playable?.size === 0) return { text: autoPass ? 'Rien ne passe : tu passes' : 'Rien ne passe : tu peux passer', ok: false };
      const count = game.table.cards.length;
      return {
        text:
          game.forcedRank !== null
            ? `${capitalize(rankName(game.forcedRank))} ou rien : ${count > 1 ? `${count} cartes de cette valeur` : 'cette valeur'}, ou passe`
            : `${count} carte${count > 1 ? 's' : ''} de même valeur, au moins ${rankName(game.table.rank)}`,
        ok: true,
      };
    }
    const problem = checkPresidentPlay(selectedCards, game.table, game.forcedRank);
    if (problem) return { text: presidentError(problem), ok: false };
    const ending = selectedCards.length === game.hand.length && selectedCards[0]!.rank === 15;
    return { text: ending ? 'Attention : finir sur un 2 te fait Trou' : `${selectedCards.length > 1 ? `${selectedCards.length} × ` : ''}${rankName(selectedCards[0]!.rank)}`, ok: !ending };
  }, [selectedCards, mustGive, gift, myTurn, game.table, game.forcedRank, game.hand, playable, autoPass, game.players]);

  async function send(result: Promise<{ ok: true } | { ok: false; error: string }>) {
    const r = await result;
    if (r.ok) setSelected([]);
    else setError(presidentError(r.error));
  }

  async function exit() {
    await socket.emitWithAck('room:leave');
    onLeave();
  }

  function leave() {
    const question = 'Quitter la partie ? Un bot jouera à ta place.';
    if (spectator || game.phase === 'gameOver' || confirm(question)) void exit();
  }

  const canModerate = (index: number) => {
    const p = room.players[index];
    return moderator && !!p && !p.bot && !p.vacant;
  };

  async function moderate(result: Promise<{ ok: true } | { ok: false; error: string }>) {
    const r = await result;
    if (!r.ok) setError(errorLabel(r.error));
  }

  // Les autres joueurs, dans l'ordre du jeu à partir du suivant ; un spectateur les voit tous.
  const others = spectator ? [...game.players.keys()] : Array.from({ length: n - 1 }, (_, k) => (me + k + 1) % n);
  const current = game.players[game.currentPlayer];

  let status: string;
  if (game.phase === 'exchange') {
    status = mustGive
      ? `Tu as reçu ${gift!.received?.map(playingCardLabel).join(' et ')} de ${game.players[gift!.to]!.name}. Choisis ${gift!.count === 2 ? '2 cartes' : 'une carte'} à lui rendre.`
      : `${game.players[gift?.from ?? 0]!.name} choisit les cartes à rendre…`;
  } else if (game.phase !== 'playing') {
    status = game.phase === 'gameOver' ? 'Fin de la partie' : 'Fin de la manche';
  } else if (!spectator && game.players[me]!.out) {
    status = `Tu as fini ${placeLabel(game, me)} · les autres continuent`;
  } else if (myTurn) {
    status = passingAlone ? 'Rien ne passe : tu passes automatiquement…' : game.table ? 'À toi de jouer !' : 'À toi d’ouvrir le pli !';
  } else if (!spectator && game.players[me]!.passed) {
    status = `Tu as passé · ${current?.name} réfléchit…`;
  } else {
    status = `${current?.name} réfléchit…`;
  }
  const bannerText = mustGive ? 'Choisis les cartes à rendre' : myTurn && !passingAlone ? (game.table ? 'À toi de jouer !' : 'À toi d’ouvrir !') : null;
  const turnKey = `${game.round}-${game.phase}-${game.trick.length}-${game.currentPlayer}`;
  const myAction = myTurn || mustGive;
  const mid = (game.hand.length - 1) / 2;

  return (
    <main className={`table-screen president-table${room.paused ? ' paused' : ''} felt-${felt || 'vert'}`}>
      <header className="table-header">
        <div className="header-left">
          <span className="round">
            Manche {game.round} / {game.rounds}
          </span>
          <span className="direction">Président</span>
          {room.turnSeconds > 0 && <span className="direction">⏱ {room.turnSeconds} s par tour</span>}
          {room.spectators > 0 && <span className="direction">👀 {room.spectators}</span>}
        </div>
        <div className="scores">
          {game.players.map((p, i) => (
            <span key={p.id} className={`score-chip ${i === me ? 'me' : ''}`}>
              {p.name} <strong>{p.score}</strong>
            </span>
          ))}
        </div>
        <div className="header-right">
          <ChatButton messages={messages} me={game.players[me]?.id ?? ''} muted={room.players[me]?.muted} />
          {!spectator && <ReactionButton />}
          {canPause && !room.paused && game.phase !== 'gameOver' && (
            <button className="icon" onClick={() => void moderate(socket.emitWithAck('room:pause', { paused: true }))} title="Mettre la partie en pause">
              ⏸
            </button>
          )}
          {!spectator && notifications.state !== 'unsupported' && (
            <button
              className={`icon${notifications.state === 'on' ? '' : ' off'}`}
              onClick={() => void notifications.toggle()}
              disabled={notifications.state === 'denied'}
              title="Recevoir une notification quand ton tour arrive et que tu es sur un autre onglet"
              aria-pressed={notifications.state === 'on'}
            >
              {notifications.state === 'on' ? '🔔' : '🔕'}
            </button>
          )}
          {!spectator && (
            <button
              className={`icon${autoPass ? '' : ' off'}`}
              onClick={toggleAutoPass}
              title={autoPass ? 'Passe auto : tu passes tout seul quand rien ne passe (cliquer pour couper)' : 'Passe auto coupée (cliquer pour activer)'}
              aria-pressed={autoPass}
            >
              ⏭
            </button>
          )}
          <button className="link" onClick={leave}>
            Quitter
          </button>
        </div>
      </header>

      <div className="felt p-felt">
        <ul className="p-opponents">
          {others.map((i) => {
            const p = game.players[i]!;
            const seat = room.players[i];
            const place = placeLabel(game, i);
            const reaction = reactions[seat?.id ?? ''];
            const active = (game.phase === 'playing' || game.phase === 'exchange') && game.currentPlayer === i;
            return (
              <li key={p.id} className={`p-opponent ${active ? 'active' : ''} ${p.out ? 'out' : ''} ${seat?.connected === false ? 'offline' : ''}`}>
                {reaction && (
                  <span key={reaction.id} className="reaction" aria-hidden>
                    {reaction.emoji}
                  </span>
                )}
                <Avatar name={p.name} look={seat} bot={!!(seat?.bot || seat?.vacant)} />
                <span className="p-opponent-text">
                  <strong>{p.name}</strong>
                  <small>
                    <span className="p-bot-level">
                      {seat?.bot ? `bot ${LEVEL_LABELS[seat.level ?? 'normal'].toLowerCase()} · ` : seat?.away ? 'un bot joue pour lui · ' : ''}
                    </span>
                    {place ?? `${p.cardCount} carte${p.cardCount > 1 ? 's' : ''}`}
                  </small>
                </span>
                <TitleBadge title={titles[i]!} />
                {!p.out && (
                  <span className="p-backs" aria-hidden>
                    {Array.from({ length: Math.min(p.cardCount, 8) }, (_, k) => (
                      <PlayingCardBack key={k} />
                    ))}
                  </span>
                )}
                {game.phase === 'playing' && p.passed && !p.out && <span className="bubble">Passe</span>}
                {canModerate(i) && (
                  <span className="p-moderate">
                    <MuteButton name={p.name} muted={!!seat?.muted} onClick={() => void moderate(socket.emitWithAck('room:mute', { playerId: seat!.id, muted: !seat!.muted }))} />
                    <KickButton name={p.name} onKick={() => void moderate(socket.emitWithAck('room:kick', { playerId: seat!.id }))} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <Center game={game} />
      </div>

      {spectator ? (
        <section className="my-area spectating">
          <div className="my-bar">
            <div className="status">👀 Tu regardes la partie · {status}</div>
          </div>
        </section>
      ) : (
        <section className={`my-area ${(myTurn && !passingAlone) || mustGive ? 'active' : ''}`}>
          {myAction && secondsLeft !== null && (
            <div className="turn-timer" aria-hidden>
              <div className={`turn-timer-fill ${secondsLeft <= 10 ? 'urgent' : ''}`} style={{ width: `${(100 * secondsLeft) / room.turnSeconds}%` }} />
            </div>
          )}
          <div className="my-bar">
            <div className="status">
              {((myTurn && !passingAlone) || mustGive) && <span className="dot" aria-hidden />}
              {status}
              {secondsLeft !== null && <span className={`countdown ${myAction && secondsLeft <= 10 ? 'urgent' : ''}`}>⏱ {secondsLeft} s</span>}
            </div>
            <div className="my-tools">
              <TitleBadge title={titles[me]!} />
              <span className="my-count">
                <strong>{game.hand.length}</strong> carte{game.hand.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <div className="hand p-hand" style={{ '--count': game.hand.length } as CSSProperties}>
            {game.hand.map((c, i) => (
              <PlayingCardView
                key={c.id}
                card={c}
                selected={selected.includes(c.id)}
                dimmed={playable !== null && !playable.has(c.id)}
                onClick={() => toggle(c)}
                style={{ '--offset': i - mid, '--i': i } as CSSProperties}
              />
            ))}
          </div>
          <div className="controls" hidden={roundFinished}>
            <span className={`hint ${hint ? (hint.ok ? 'ok' : 'bad') : ''}`}>{hint?.text}</span>
            {mustGive ? (
              <button
                className="primary"
                disabled={selected.length !== gift!.count}
                onClick={() => send(socket.emitWithAck('game:giveCards', { cardIds: selected }))}
              >
                Donner
              </button>
            ) : (
              <>
                {selected.length > 0 && (
                  <button className="ghost" onClick={() => setSelected([])}>
                    Annuler
                  </button>
                )}
                <button disabled={!myTurn || !game.table} onClick={() => send(socket.emitWithAck('game:pass'))}>
                  Passer
                </button>
                <button
                  className="primary"
                  disabled={!myTurn || selected.length === 0}
                  onClick={() => send(socket.emitWithAck('game:play', { cardIds: selected }))}
                >
                  Jouer
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {error && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}
      <TurnBanner key={bannerText ? turnKey : 'none'} text={bannerText} />
      {showSummary && game.lastRound && (
        <RoundSummary
          game={game}
          onNext={() => void send(socket.emitWithAck('game:nextRound'))}
          onRematch={() => void send(socket.emitWithAck('game:rematch'))}
          onExit={() => void exit()}
        />
      )}
      {room.paused && <PauseOverlay onResume={canPause ? () => void moderate(socket.emitWithAck('room:pause', { paused: false })) : undefined} />}
    </main>
  );
}
