import { Eye, Pause, Timer } from 'lucide-react';
import { BOARD, type ReversiView } from '@gof/engine';
import { type CSSProperties, useEffect, useState } from 'react';
import type { ChatMessage, RoomView } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { Bee } from './Bee';
import { ChatButton } from './Chat';
import { RatingChange, useRatingChange } from './RatingChange';
import { PauseOverlay, ReactionButton, useCountdown, useReactions } from './Table';
import { errorLabel } from './labels';
import { socket } from './socket';
import { useTurnAlert, useTurnNotifications } from './turnAlert';

const COLUMNS = 'abcdefgh';
/** « d3 » : la lettre de la colonne, puis le numéro de la ligne. */
export const squareName = (cell: number) => `${COLUMNS[cell % BOARD]}${Math.floor(cell / BOARD) + 1}`;
/** Le joueur 0 joue les pions orange, le joueur 1 les pions crème. */
export const DISC_NAMES = ['orange', 'crème'];

/** Un pion. Sa clé change avec sa couleur, donc il se retourne (animation) quand il change de camp. */
export function DiscView({ owner, fresh }: { owner: 0 | 1; fresh?: boolean }) {
  return <span className={`disc disc-${owner} ${fresh ? 'fresh' : 'flip'}`} aria-hidden />;
}

/** Les deux joueurs, leurs pions et la part du plateau de chacun. */
function ScoreBar({ game, room }: { game: ReversiView; room: RoomView }) {
  const [a, b] = game.players.map((p) => p.discs) as [number, number];
  const reactions = useReactions();
  return (
    <section className="reversi-score">
      {game.players.map((p, i) => {
        const reaction = reactions[room.players[i]?.id ?? ''];
        const active = game.phase === 'playing' && game.currentPlayer === i;
        return (
          <div key={p.id} className={`reversi-player p${i} ${active ? 'active' : ''}`}>
            {reaction && (
              <span key={reaction.id} className="reaction" aria-hidden>
                {reaction.emoji}
              </span>
            )}
            <Avatar name={p.name} look={room.players[i]} bot={!!room.players[i]?.bot} />
            <span className="reversi-player-text">
              <strong>
                {active && <span className="turn-token" aria-hidden />}
                {i === game.you ? 'Toi' : p.name}
              </strong>
              <small>
                pions {DISC_NAMES[i]}
                {room.players[i]?.bot && room.players[i]?.level ? ` · bot` : ''}
              </small>
            </span>
            <span className="reversi-count">
              <DiscView owner={i as 0 | 1} fresh />
              {p.discs}
            </span>
          </div>
        );
      })}
      <div className="reversi-share" aria-label={`${a} pions orange, ${b} pions crème`}>
        <span className="reversi-share-0" style={{ flexGrow: a }} />
        <span className="reversi-share-1" style={{ flexGrow: b }} />
      </div>
    </section>
  );
}

/** La table du Reversi : le plateau au centre, les deux joueurs au-dessus avec leurs pions. */
export function ReversiTable({
  game,
  room,
  messages,
  admin,
  onLeave,
}: {
  game: ReversiView;
  room: RoomView;
  messages: ChatMessage[];
  admin: boolean;
  felt?: string;
  onLeave: () => void;
}) {
  const [error, setError] = useState('');
  const [endOpen, setEndOpen] = useState(true);
  const me = game.you;
  const spectator = me < 0;
  const notifications = useTurnNotifications();
  const rating = useRatingChange(game.phase === 'gameOver');
  const myTurn = game.phase === 'playing' && game.currentPlayer === me;
  useTurnAlert(myTurn ? 'À toi de jouer' : null, notifications.state === 'on');
  const moderator = admin || (!spectator && room.hostId === game.players[me]?.id);
  const hostGone = room.players.find((p) => p.id === room.hostId)?.connected === false;
  const canPause = moderator || (!spectator && hostGone);
  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  useEffect(() => {
    setTurnEndsAt(room.turnRemainingMs === null || room.paused ? null : Date.now() + room.turnRemainingMs);
  }, [room]);
  const countdown = useCountdown(turnEndsAt);
  useEffect(() => {
    if (game.phase !== 'gameOver') setEndOpen(true);
  }, [game.phase]);

  async function send(result: Promise<{ ok: true } | { ok: false; error: string }>) {
    const r = await result;
    if (!r.ok) setError(errorLabel(r.error));
  }
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(t);
  }, [error]);
  async function exit() {
    await socket.emitWithAck('room:leave');
    onLeave();
  }
  function leave() {
    if (spectator || game.phase === 'gameOver' || room.training || confirm('Quitter la partie ? Ton adversaire ne pourra plus la finir.')) void exit();
  }

  const last = game.lastMove;
  const legal = new Set(myTurn ? game.legal : []);
  const name = (i: number) => (i === me ? 'Toi' : game.players[i]!.name);
  let status: string;
  if (game.phase === 'gameOver') status = 'Partie terminée';
  else if (last?.skipped) {
    const blocked = 1 - game.currentPlayer;
    status = myTurn ? `${name(blocked)} n’a aucun coup : tu rejoues` : `${name(blocked) === 'Toi' ? 'Tu n’as' : `${name(blocked)} n’a`} aucun coup, ${game.players[game.currentPlayer]!.name} rejoue…`;
  } else status = myTurn ? 'À toi : pose un pion qui encadre ceux de l’autre' : `${game.players[game.currentPlayer]!.name} réfléchit…`;

  const [a, b] = game.players.map((p) => p.discs);
  return (
    <main className={`table-screen reversi-table${room.paused ? ' paused' : ''}`}>
      <header className="table-header">
        <div className="header-left">
          <span className="round">Reversi</span>
          <span className="beta-badge">Bêta</span>
          {room.training && (
            <span className="training-tag" title="Entraînement contre un bot : ne compte pas dans les classements et ne rapporte rien">
              Entraînement
            </span>
          )}
          {countdown !== null && game.phase === 'playing' && (
            <span className="direction">
              <Timer /> {Math.min(countdown, room.turnSeconds)} s
            </span>
          )}
          {room.spectators > 0 && (
            <span className="direction">
              <Eye /> {room.spectators}
            </span>
          )}
        </div>
        <div className="header-right">
          <ChatButton messages={messages} me={game.players[me]?.id ?? ''} muted={room.players[me]?.muted} />
          {!spectator && <ReactionButton />}
          {canPause && !room.paused && game.phase !== 'gameOver' && (
            <button className="icon" onClick={() => void send(socket.emitWithAck('room:pause', { paused: true }))} title="Mettre la partie en pause">
              <Pause />
            </button>
          )}
          <button className="link" onClick={leave}>
            Quitter
          </button>
        </div>
      </header>

      <div className="reversi-main">
        <ScoreBar game={game} room={room} />
        <p className={`reversi-status ${myTurn ? 'active' : ''}`} role="status">
          {status}
        </p>
        <div className="reversi-board-wrap">
          <div className="reversi-board" role="grid" aria-label="Plateau">
            {game.board.map((owner, cell) => {
              const playable = legal.has(cell);
              const isLast = last?.cell === cell;
              const flipped = last?.flipped.includes(cell);
              const content =
                owner === -1 ? (
                  playable ? (
                    <span className={`reversi-hint p${me}`} aria-hidden />
                  ) : null
                ) : (
                  <DiscView key={`${cell}-${owner}`} owner={owner} fresh={isLast} />
                );
              const classes = ['reversi-cell', playable && 'playable', isLast && 'last', flipped && 'flipped'].filter(Boolean).join(' ');
              return playable ? (
                <button
                  key={cell}
                  type="button"
                  className={classes}
                  onClick={() => void send(socket.emitWithAck('game:move', { cell }))}
                  aria-label={`Jouer en ${squareName(cell)}`}
                  title={squareName(cell)}
                  style={{ '--i': cell } as CSSProperties}
                >
                  {content}
                </button>
              ) : (
                <span key={cell} className={classes} aria-label={owner === -1 ? squareName(cell) : `${squareName(cell)} : ${DISC_NAMES[owner]}`}>
                  {content}
                </span>
              );
            })}
          </div>
        </div>
        <p className="muted small reversi-foot">
          {last ? `Dernier coup : ${name(last.playerIndex)} en ${squareName(last.cell)}, ${last.flipped.length} pion${last.flipped.length > 1 ? 's' : ''} retourné${last.flipped.length > 1 ? 's' : ''}` : 'Les pions orange commencent'}
        </p>
      </div>

      {error && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}
      {game.phase === 'gameOver' && !endOpen && (
        <button type="button" className="primary naval-end-reopen" onClick={() => setEndOpen(true)}>
          Fin de la partie
        </button>
      )}
      {game.phase === 'gameOver' && endOpen && (
        <div className="overlay" role="dialog" aria-label="Fin de la partie">
          <div className="panel modal pop-in duel-over">
            <Bee
              mood={game.winners.length > 1 ? 'surprised' : spectator ? 'happy' : game.winners.includes(me) ? 'victory' : 'sad'}
              motion={game.winners.length === 1 && game.winners.includes(me) ? 'hop' : undefined}
              className="end-bee"
            />
            <h2>
              {game.winners.length > 1
                ? 'Égalité'
                : spectator
                  ? `${game.players[game.winners[0]!]!.name} gagne`
                  : game.winners.includes(me)
                    ? 'Tu gagnes la partie'
                    : 'Perdu'}
            </h2>
            <p className="reversi-final">
              <span>
                <DiscView owner={0} fresh /> {a}
              </span>
              <span>
                <DiscView owner={1} fresh /> {b}
              </span>
            </p>
            <RatingChange change={rating} />
            <div className="duel-actions">
              {!spectator && (
                <button className="primary" onClick={() => void send(socket.emitWithAck('game:rematch'))}>
                  Revanche
                </button>
              )}
              <button className="ghost" onClick={() => setEndOpen(false)}>
                Voir le plateau
              </button>
              <button className="ghost" onClick={() => void exit()}>
                Retour à l’accueil
              </button>
            </div>
          </div>
        </div>
      )}
      {room.paused && (
        <PauseOverlay onResume={canPause ? () => void send(socket.emitWithAck('room:pause', { paused: false })) : undefined} />
      )}
    </main>
  );
}
