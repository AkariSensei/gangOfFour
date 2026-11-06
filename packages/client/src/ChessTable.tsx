import { ArrowDownUp, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy, ExternalLink, Eye, Flag, Handshake, Pause, Trophy, Users } from 'lucide-react';
import {
  type ChessEnd,
  type ChessMove,
  type ChessView,
  TIME_CONTROLS,
  chessReplay,
  inCheck,
  kingSquare,
  makeMove,
  moveCode,
  parseFen,
  premoveTargets,
  squareName,
  toPgn,
} from '@gof/engine';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, RoomView } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { ChatButton } from './Chat';
import { RatingChange, useRatingChange } from './RatingChange';
import { PauseOverlay, ReactionButton, useReactions } from './Table';
import { errorLabel } from './labels';
import { SITE_NAME } from './site';
import { socket } from './socket';
import { useTurnAlert, useTurnNotifications } from './turnAlert';

const PIECE_LETTERS = ' PNBRQK';
/** Image d'une pièce : « wN » pour un cavalier blanc. */
const pieceSrc = (p: number) => `/pieces/${p > 0 ? 'w' : 'b'}${PIECE_LETTERS[Math.abs(p)]}.svg`;
const PIECE_NAMES = ['', 'pion', 'cavalier', 'fou', 'tour', 'dame', 'roi'];
/** Pièces au départ, par type (pion, cavalier, fou, tour, dame), et leur valeur. */
const START_COUNT = [0, 8, 2, 2, 2, 1];
const WORTH = [0, 1, 3, 3, 5, 9];
const PROMOTIONS = [5, 2, 4, 3];

export const END_LABELS: Record<ChessEnd, string> = {
  checkmate: 'Échec et mat',
  resign: 'Abandon',
  time: 'Temps écoulé',
  abandon: 'Adversaire parti',
  stalemate: 'Pat',
  repetition: 'Triple répétition',
  fiftyMoves: 'Règle des 50 coups',
  material: 'Matériel insuffisant',
  agreement: 'Nulle par accord',
  timeVsMaterial: 'Temps écoulé, mais plus de quoi mater',
  aborted: 'Partie annulée',
};

/** Temps de pendule : « 4:59 », puis les dixièmes sous les dix secondes (« 0:08,4 »). */
export function clockText(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10_000) return `0:0${Math.floor(safe / 1000)},${Math.floor((safe % 1000) / 100)}`;
  const total = Math.ceil(safe / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Un coup en notation algébrique, la pièce dessinée plutôt qu'écrite (« Cf3 » s'affiche avec un petit cavalier). */
function San({ san, white }: { san: string; white: boolean }) {
  const type = 'NBRQK'.indexOf(san[0] ?? '');
  if (type < 0) return <>{san}</>;
  return (
    <>
      <img className="figurine" src={pieceSrc((type + 2) * (white ? 1 : -1))} alt={PIECE_NAMES[type + 2]} />
      {san.slice(1)}
    </>
  );
}

/** Rafraîchit l'affichage tant qu'une pendule tourne. */
function useTicking(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [active]);
}

/** Pièces prises par chaque camp, et l'avance de matériel des blancs (négative si les noirs mènent). */
function material(board: number[]) {
  const count = (side: 1 | -1) => START_COUNT.map((_, type) => board.filter((p) => p === side * type).length);
  const white = count(1);
  const black = count(-1);
  const taken = (left: number[]) => START_COUNT.flatMap((n, type) => (type === 0 ? [] : Array.from({ length: Math.max(0, n - left[type]!) }, () => type)));
  const worth = (left: number[]) => left.reduce((sum, n, type) => sum + n * WORTH[type]!, 0);
  // Les noirs ont perdu ces pièces : les blancs les ont prises (et inversement).
  return { byWhite: taken(black).reverse(), byBlack: taken(white).reverse(), lead: worth(white) - worth(black) };
}

/** Un joueur : avatar, nom, pièces prises, avance de matériel et pendule. */
function PlayerBar({
  game,
  room,
  index,
  board,
  receivedAt,
  position,
}: {
  game: ChessView;
  room: RoomView;
  index: number;
  board: number[];
  receivedAt: number;
  position: 'top' | 'bottom';
}) {
  const reactions = useReactions();
  const player = game.players[index];
  const seat = room.players[index];
  const white = index === game.white;
  const { byWhite, byBlack, lead } = material(board);
  const taken = white ? byWhite : byBlack;
  const ahead = white ? lead : -lead;
  const clock = game.clock;
  const running = clock?.running === index && game.phase === 'playing' && !room.paused;
  const left = clock ? (clock.remaining[index] ?? 0) - (running ? performance.now() - receivedAt : 0) : null;
  const active = game.phase === 'playing' && game.currentPlayer === index;
  const reaction = reactions[seat?.id ?? ''];
  return (
    <div className={`chess-player ${position} ${active ? 'active' : ''}`}>
      {reaction && (
        <span key={reaction.id} className="reaction" aria-hidden>
          {reaction.emoji}
        </span>
      )}
      <Avatar name={player?.name ?? ''} look={seat} bot={!!seat?.bot} />
      <span className="chess-player-text">
        <strong>
          {active && <span className="turn-token" aria-hidden />}
          {index === game.you ? 'Toi' : player?.name}
          {seat?.bot && <small className="chess-tag">bot</small>}
          {seat && !seat.bot && !seat.connected && <small className="chess-tag away">{seat.away ? 'parti' : 'déconnecté'}</small>}
        </strong>
        <span className="chess-taken" aria-label={`${taken.length} pièces prises`}>
          {taken.map((type, i) => (
            <img key={i} src={pieceSrc(white ? -type : type)} alt="" />
          ))}
          {ahead > 0 && <span className="chess-lead">+{ahead}</span>}
        </span>
      </span>
      {left !== null && (
        <span className={`chess-clock ${running ? 'running' : ''} ${left < 20_000 ? 'low' : ''}`} role="timer" aria-label={`Pendule de ${player?.name}`}>
          {clockText(left)}
        </span>
      )}
    </div>
  );
}

/** La table des échecs : l'échiquier, les deux joueurs avec leur pendule, et la feuille de partie. */
export function ChessTable({
  game,
  room,
  messages,
  admin,
  onLeave,
}: {
  game: ChessView;
  room: RoomView;
  messages: ChatMessage[];
  admin: boolean;
  felt?: string;
  onLeave: () => void;
}) {
  const me = game.you;
  const spectator = me < 0;
  const playing = game.phase === 'playing';
  const myTurn = playing && game.currentPlayer === me;
  const notifications = useTurnNotifications();
  useTurnAlert(myTurn ? 'À toi de jouer' : null, notifications.state === 'on');
  const rating = useRatingChange(game.phase === 'gameOver');
  const receivedAt = useMemo(() => performance.now(), [game]);
  useTicking(playing && !room.paused && ((game.clock !== null && game.clock.running !== null) || game.firstMoveMs !== null));

  const [error, setError] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; x: number; y: number; moved: boolean; wasSelected: boolean } | null>(null);
  const [promotion, setPromotion] = useState<{ from: number; to: number } | null>(null);
  const [premove, setPremove] = useState<ChessMove | null>(null);
  /** Coup envoyé, montré tout de suite sur l'échiquier en attendant la réponse du serveur. */
  const [pending, setPending] = useState<ChessMove | null>(null);
  /** Coup revu dans la feuille de partie (null : la position en direct). */
  const [ply, setPly] = useState<number | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [endOpen, setEndOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  /** Dernier coup joué d'ici par glisser-déposer : inutile de le faire glisser une seconde fois. */
  const draggedMove = useRef<number | null>(null);

  const positions = useMemo(() => chessReplay(parseFen(game.startFen), game.moves), [game.startFen, game.moves]);
  const live = ply === null || ply >= game.moves.length;
  const shownPly = live ? game.moves.length : ply;
  const shown = positions[shownPly] ?? positions[positions.length - 1]!;
  const optimistic = useMemo(() => {
    if (!pending || !live) return null;
    try {
      return makeMove(parseFen(game.fen), moveCode(pending.from, pending.to, pending.promotion ?? 0));
    } catch {
      return null;
    }
  }, [pending, live, game.fen]);
  const board = optimistic?.board ?? shown.board;
  const lastMove = optimistic ? pending : (game.moves[shownPly - 1] ?? null);
  const checkSquare = optimistic ? (inCheck(optimistic) ? kingSquare(optimistic.board, optimistic.turn) : -1) : live ? game.check : inCheck(shown) ? kingSquare(shown.board, shown.turn) : -1;

  const myColor = me === game.white ? 1 : -1;
  const whiteAtBottom = (spectator ? true : myColor === 1) !== flipped;
  const bottomIndex = whiteAtBottom ? game.white : 1 - game.white;
  const topIndex = 1 - bottomIndex;
  const canMove = !spectator && playing && live && !room.paused && !pending;
  const legalFrom = (from: number) => game.legal.filter((m) => m.from === from);
  const targets = useMemo(() => {
    if (selected === null) return new Set<number>();
    if (myTurn) return new Set(legalFrom(selected).map((m) => m.to));
    return new Set(premoveTargets(board, selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, myTurn, game, board]);

  // Nouvelle position du serveur : le coup en attente est arrivé (ou a été refusé).
  useEffect(() => {
    setPending(null);
    setSelected((s) => (s !== null && Math.sign(game.board[s] ?? 0) === myColor ? s : null));
  }, [game, myColor]);
  // Le prémouvement part dès que vient son tour, s'il est permis ; sinon il s'efface.
  useEffect(() => {
    if (!myTurn || !premove) return;
    const move = game.legal.find((m) => m.from === premove.from && m.to === premove.to && (m.promotion ?? 5) === (premove.promotion ?? 5));
    setPremove(null);
    if (move) send(move);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);
  useEffect(() => {
    if (!playing) {
      setPremove(null);
      setSelected(null);
    } else setEndOpen(true);
  }, [playing]);
  // La feuille suit le dernier coup.
  useEffect(() => {
    if (live && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [game.moves.length, live]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(t);
  }, [error]);
  useEffect(() => {
    if (!confirmResign) return;
    const t = setTimeout(() => setConfirmResign(false), 3000);
    return () => clearTimeout(t);
  }, [confirmResign]);
  // Flèches du clavier : revoir la partie coup par coup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const last = game.moves.length;
      const at = ply ?? last;
      const go = (n: number) => setPly(n >= last ? null : Math.max(0, n));
      if (e.key === 'ArrowLeft') go(at - 1);
      else if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowUp' || e.key === 'Home') go(0);
      else if (e.key === 'ArrowDown' || e.key === 'End') go(last);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ply, game.moves.length]);

  async function request(result: Promise<{ ok: true } | { ok: false; error: string }>) {
    const r = await result;
    if (!r.ok) {
      setPending(null);
      setError(errorLabel(r.error));
    }
    return r.ok;
  }
  function send(move: ChessMove) {
    setPending(move);
    setSelected(null);
    void request(socket.emitWithAck('game:chessMove', move));
  }

  /** Essaie le coup de `from` vers `to` : joué si c'est permis, préparé si c'est le tour de l'autre. */
  function attempt(from: number, to: number) {
    if (from === to) return;
    if (myTurn) {
      const moves = legalFrom(from).filter((m) => m.to === to);
      if (moves.length === 0) {
        setSelected(Math.sign(board[to] ?? 0) === myColor ? to : null);
        return;
      }
      if (moves.length > 1) {
        setPromotion({ from, to });
        setSelected(null);
        return;
      }
      send(moves[0]!);
      return;
    }
    // Pendant le tour de l'autre : un prémouvement (promu en dame s'il le faut).
    if (premoveTargets(board, from).includes(to)) {
      const piece = Math.abs(board[from] ?? 0);
      const last = Math.floor(to / 8) === (myColor === 1 ? 7 : 0);
      setPremove({ from, to, ...(piece === 1 && last ? { promotion: 5 } : {}) });
    }
    setSelected(null);
  }

  /** Case sous le pointeur, selon le sens de l'échiquier. */
  function squareAt(x: number, y: number): number | null {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return whiteAtBottom ? (7 - row) * 8 + col : row * 8 + (7 - col);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button === 2) {
      setPremove(null);
      setSelected(null);
      return;
    }
    if (!canMove || promotion) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (sq === null) return;
    const mine = Math.sign(board[sq] ?? 0) === myColor;
    if (selected !== null && targets.has(sq) && !mine) {
      attempt(selected, sq);
      return;
    }
    if (!mine) {
      setSelected(null);
      if (!myTurn) setPremove(null);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: sq, x: e.clientX, y: e.clientY, moved: false, wasSelected: selected === sq });
    setSelected(sq);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moved });
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const target = squareAt(e.clientX, e.clientY);
    setDrag(null);
    if (drag.moved) {
      if (target !== null && target !== drag.from) {
        draggedMove.current = game.moves.length + 1;
        attempt(drag.from, target);
      }
    } else if (drag.wasSelected) setSelected(null);
  }

  async function exit() {
    await socket.emitWithAck('room:leave');
    onLeave();
  }
  async function leave() {
    if (spectator || !playing) return void exit();
    // Quitter une partie en cours, c'est l'abandonner.
    if (!room.training && !confirm('Quitter la partie ? Elle compte comme un abandon.')) return;
    await socket.emitWithAck('game:resign');
    void exit();
  }
  function resign() {
    if (!confirmResign) return setConfirmResign(true);
    setConfirmResign(false);
    void request(socket.emitWithAck('game:resign'));
  }
  const pgn = () => toPgn(game, new Date(), `${SITE_NAME} (${location.host})`);
  async function copyPgn() {
    try {
      await navigator.clipboard.writeText(pgn());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Impossible de copier : ton navigateur l’a refusé');
    }
  }
  // Lichess lit la partie dans l'adresse, les espaces remplacés par des soulignés.
  const lichessUrl = () => `https://lichess.org/analysis/pgn/${encodeURIComponent((pgn().split('\n\n')[1] ?? '').trim().replace(/\s+/g, '_'))}`;

  const opponent = 1 - me;
  const opponentSeat = spectator ? undefined : room.players[opponent];
  const name = (i: number) => (i === me ? 'Toi' : (game.players[i]?.name ?? ''));
  const control = TIME_CONTROLS.find((c) => c.id === game.timeControl);
  const firstMoveLeft = game.firstMoveMs !== null ? Math.max(0, game.firstMoveMs - (performance.now() - receivedAt)) : null;

  let status: string;
  if (!live) status = shownPly === 0 ? 'Tu revois la position de départ' : `Tu revois le coup ${Math.ceil(shownPly / 2)} des ${shownPly % 2 === 1 ? 'blancs' : 'noirs'}`;
  else if (!playing) status = game.end ? END_LABELS[game.end] : 'Partie terminée';
  else if (firstMoveLeft !== null) status = myTurn ? `Joue ton premier coup : ${Math.ceil(firstMoveLeft / 1000)} s, sinon la partie est annulée` : `${name(game.currentPlayer)} joue son premier coup…`;
  else if (myTurn) status = game.check >= 0 ? 'Échec : à toi de jouer' : 'À toi de jouer';
  else if (spectator) status = `Trait aux ${game.currentPlayer === game.white ? 'blancs' : 'noirs'}`;
  else status = premove ? `Prémouvement prêt : ${squareName(premove.from)}-${squareName(premove.to)}` : `${name(game.currentPlayer)} réfléchit…`;

  const rows = [];
  for (let i = 0; i < game.moves.length; i += 2) rows.push(i);
  const slide = !optimistic && live && lastMove && draggedMove.current !== game.moves.length ? lastMove : null;
  const dragSize = boardRef.current ? boardRef.current.getBoundingClientRect().width / 8 : 0;

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = whiteAtBottom ? (7 - row) * 8 + col : row * 8 + (7 - col);
      const piece = board[sq] ?? 0;
      const light = (Math.floor(sq / 8) + (sq % 8)) % 2 === 1;
      const classes = [
        'chess-square',
        light ? 'light' : 'dark',
        lastMove && (lastMove.from === sq || lastMove.to === sq) && 'last',
        selected === sq && 'selected',
        premove && (premove.from === sq || premove.to === sq) && 'premove',
        checkSquare === sq && 'check',
        targets.has(sq) && (piece !== 0 ? 'target capture' : 'target'),
      ]
        .filter(Boolean)
        .join(' ');
      // Le dernier coup adverse glisse de sa case de départ.
      const slideStyle =
        slide && slide.to === sq
          ? ({
              '--dx': `${((slide.from % 8) - (slide.to % 8)) * (whiteAtBottom ? 100 : -100)}%`,
              '--dy': `${(Math.floor(slide.to / 8) - Math.floor(slide.from / 8)) * (whiteAtBottom ? 100 : -100)}%`,
            } as CSSProperties)
          : undefined;
      squares.push(
        <div key={sq} className={classes} data-square={squareName(sq)}>
          {col === 0 && <span className="coord rank">{Math.floor(sq / 8) + 1}</span>}
          {row === 7 && <span className="coord file">{'abcdefgh'[sq % 8]}</span>}
          {piece !== 0 && (
            <img
              key={slideStyle ? `${sq}-${game.moves.length}` : sq}
              className={`chess-piece ${drag?.moved && drag.from === sq ? 'lifted' : ''} ${slideStyle ? 'slide' : ''}`}
              style={slideStyle}
              src={pieceSrc(piece)}
              alt={`${piece > 0 ? 'Blanc' : 'Noir'} : ${PIECE_NAMES[Math.abs(piece)]} en ${squareName(sq)}`}
              draggable={false}
            />
          )}
        </div>,
      );
    }
  }

  const promotionFile = promotion ? (whiteAtBottom ? promotion.to % 8 : 7 - (promotion.to % 8)) : 0;
  const promotionAtTop = promotion ? (Math.floor(promotion.to / 8) === 7) === whiteAtBottom : true;

  return (
    <main className={`table-screen chess-table${room.paused ? ' paused' : ''}`}>
      <header className="table-header">
        <div className="header-left">
          <span className="round">Échecs</span>
          <span className="beta-badge">Bêta</span>
          <span className="direction">{control ? control.label : 'Sans pendule'}</span>
          {room.training && (
            <span className="training-tag" title="Entraînement contre un bot : ne compte pas dans les classements et ne rapporte rien">
              Entraînement
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
          {(admin || room.training) && playing && !room.paused && (
            <button className="icon" onClick={() => void request(socket.emitWithAck('room:pause', { paused: true }))} title="Mettre la partie en pause">
              <Pause />
            </button>
          )}
          <button className="link" onClick={() => void leave()}>
            Quitter
          </button>
        </div>
      </header>

      <div className="chess-main">
        <div className="chess-board-column">
          <PlayerBar game={game} room={room} index={topIndex} board={board} receivedAt={receivedAt} position="top" />
          <div className="chess-board-frame">
            <div
              ref={boardRef}
              className={`chess-board ${canMove ? 'interactive' : ''} ${drag?.moved ? 'dragging' : ''}`}
              role="grid"
              aria-label="Échiquier"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              onContextMenu={(e) => e.preventDefault()}
            >
              {squares}
              {promotion && (
                <div className="chess-promotion" style={{ '--file': promotionFile } as CSSProperties} data-top={promotionAtTop}>
                  {PROMOTIONS.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        send({ ...promotion, promotion: type });
                        setPromotion(null);
                      }}
                      aria-label={`Promouvoir en ${PIECE_NAMES[type]}`}
                    >
                      <img src={pieceSrc(type * myColor)} alt="" draggable={false} />
                    </button>
                  ))}
                  <button type="button" className="chess-promotion-cancel" onPointerDown={(e) => e.stopPropagation()} onClick={() => setPromotion(null)} aria-label="Annuler">
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>
          <PlayerBar game={game} room={room} index={bottomIndex} board={board} receivedAt={receivedAt} position="bottom" />
        </div>

        <aside className="chess-side">
          <p className={`chess-status ${myTurn && live ? 'active' : ''}`} role="status">
            {status}
          </p>
          {playing && !spectator && game.drawOffer === opponent && (
            <div className="chess-offer" role="alert">
              <span>{name(opponent)} propose la nulle</span>
              <div>
                <button type="button" className="primary" onClick={() => void request(socket.emitWithAck('game:draw', { answer: 'accept' }))}>
                  Accepter
                </button>
                <button type="button" className="ghost" onClick={() => void request(socket.emitWithAck('game:draw', { answer: 'decline' }))}>
                  Refuser
                </button>
              </div>
            </div>
          )}
          {playing && opponentSeat?.away && !opponentSeat.connected && (
            <div className="chess-offer" role="alert">
              <span>{opponentSeat.name} est parti depuis une minute</span>
              <div>
                <button type="button" className="primary" onClick={() => void request(socket.emitWithAck('game:claim'))}>
                  Réclamer la victoire
                </button>
              </div>
            </div>
          )}
          <ol className="chess-moves" ref={listRef} aria-label="Feuille de partie">
            {rows.length === 0 && <li className="chess-moves-empty">Les blancs commencent</li>}
            {rows.map((i) => (
              <li key={i}>
                <span className="chess-move-number">{i / 2 + 1}.</span>
                {[i, i + 1].map((j) => {
                  const m = game.moves[j];
                  if (!m) return <span key={j} />;
                  return (
                    <button key={j} type="button" className={`chess-move ${shownPly === j + 1 ? 'current' : ''}`} onClick={() => setPly(j + 1 >= game.moves.length ? null : j + 1)}>
                      <San san={m.san} white={j % 2 === 0} />
                    </button>
                  );
                })}
              </li>
            ))}
          </ol>
          <div className="chess-nav" role="group" aria-label="Revoir la partie">
            <button type="button" className="icon" onClick={() => setPly(0)} disabled={shownPly === 0} title="Début">
              <ChevronFirst />
            </button>
            <button type="button" className="icon" onClick={() => setPly(Math.max(0, shownPly - 1))} disabled={shownPly === 0} title="Coup précédent">
              <ChevronLeft />
            </button>
            <button type="button" className="icon" onClick={() => setPly(shownPly + 1 >= game.moves.length ? null : shownPly + 1)} disabled={live} title="Coup suivant">
              <ChevronRight />
            </button>
            <button type="button" className="icon" onClick={() => setPly(null)} disabled={live} title="Position actuelle">
              <ChevronLast />
            </button>
            <button type="button" className="icon" onClick={() => setFlipped((f) => !f)} title="Retourner l’échiquier">
              <ArrowDownUp />
            </button>
          </div>
          {playing && !spectator && (
            <div className="chess-actions">
              <button
                type="button"
                className="ghost"
                disabled={!game.canOfferDraw}
                onClick={() => void request(socket.emitWithAck('game:draw', { answer: 'offer' }))}
                title={game.drawOffer === me ? 'Proposition envoyée' : 'Proposer la nulle'}
              >
                <Handshake /> {game.drawOffer === me ? 'Nulle proposée' : 'Proposer nulle'}
              </button>
              <button type="button" className={confirmResign ? 'danger' : 'ghost'} onClick={resign}>
                <Flag /> {confirmResign ? 'Confirmer' : 'Abandonner'}
              </button>
            </div>
          )}
          {!playing && (
            <div className="chess-actions">
              <button type="button" className="ghost" onClick={() => void copyPgn()}>
                <Copy /> {copied ? 'PGN copiée' : 'Copier la PGN'}
              </button>
              <a className="button ghost" href={lichessUrl()} target="_blank" rel="noreferrer" title="Analyser la partie sur Lichess">
                <ExternalLink /> Lichess
              </a>
            </div>
          )}
        </aside>
      </div>

      {drag?.moved && board[drag.from] ? (
        <img
          className="chess-drag"
          src={pieceSrc(board[drag.from]!)}
          alt=""
          style={{ left: drag.x, top: drag.y, width: dragSize, height: dragSize }}
          draggable={false}
        />
      ) : null}
      {error && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}
      {!playing && !endOpen && (
        <button type="button" className="primary naval-end-reopen" onClick={() => setEndOpen(true)}>
          Fin de la partie
        </button>
      )}
      {!playing && endOpen && (
        <div className="overlay" role="dialog" aria-label="Fin de la partie">
          <div className="panel modal pop-in duel-over chess-over">
            <div className="trophy" aria-hidden>
              {game.winners.length === 0 ? <Users /> : game.winners.includes(me) || spectator ? <Trophy /> : <Flag />}
            </div>
            <h2>
              {game.end === 'aborted'
                ? 'Partie annulée'
                : game.winners.length === 0
                  ? 'Nulle'
                  : spectator
                    ? `${game.players[game.winners[0]!]!.name} gagne`
                    : game.winners.includes(me)
                      ? 'Tu gagnes la partie'
                      : 'Perdu'}
            </h2>
            <p className="muted">
              {game.end ? END_LABELS[game.end] : ''}
              {game.end === 'aborted' ? ' : elle ne compte pas' : ` · ${Math.ceil(game.moves.length / 2)} coups`}
            </p>
            <RatingChange change={rating} />
            <div className="duel-actions">
              {!spectator && (
                <button className="primary" onClick={() => void request(socket.emitWithAck('game:rematch'))}>
                  Revanche
                </button>
              )}
              <button className="ghost" onClick={() => setEndOpen(false)}>
                Voir l’échiquier
              </button>
              <button className="ghost" onClick={() => void exit()}>
                Retour à l’accueil
              </button>
            </div>
          </div>
        </div>
      )}
      {room.paused && <PauseOverlay onResume={admin || room.training ? () => void request(socket.emitWithAck('room:pause', { paused: false })) : undefined} />}
    </main>
  );
}
