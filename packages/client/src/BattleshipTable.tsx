import { Anchor, Eye, Pause, RotateCw, Shuffle, Timer, Trophy, Waves } from 'lucide-react';
import { type BattleshipView, FLEET, GRID, type Ship, randomFleet, shipAt, validFleet } from '@gof/engine';
import { useEffect, useMemo, useState } from 'react';
import type { ChatMessage, RoomView } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { ChatButton } from './Chat';
import { PauseOverlay, ReactionButton, useCountdown, useReactions } from './Table';
import { errorLabel } from './labels';
import { socket } from './socket';
import { useTurnAlert, useTurnNotifications } from './turnAlert';

const LETTERS = 'ABCDEFGHIJ';
/** « B7 » : la lettre de la ligne, puis le numéro de la colonne. */
export const cellName = (cell: number) => `${LETTERS[Math.floor(cell / GRID)]}${(cell % GRID) + 1}`;
const CELLS = Array.from({ length: GRID * GRID }, (_, c) => c);

/** Ce que montre une case d'une grille. */
interface CellLook {
  ship?: boolean;
  /** Bateau coulé (le sien, ou celui de l'adversaire une fois coulé). */
  sunk?: boolean;
  shot?: 'miss' | 'hit' | 'sunk';
  selected?: boolean;
  last?: boolean;
}

/** Une grille de 10 × 10 avec ses repères (A à J, 1 à 10). `onCell` rend les cases cliquables. */
function Grid({
  look,
  onCell,
  canClick,
  label,
  small,
}: {
  look: (cell: number) => CellLook;
  onCell?: (cell: number) => void;
  canClick?: (cell: number) => boolean;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`naval-grid ${small ? 'small' : ''}`} role="grid" aria-label={label}>
      <span className="naval-corner" />
      {Array.from({ length: GRID }, (_, c) => (
        <span key={`c${c}`} className="naval-axis">
          {c + 1}
        </span>
      ))}
      {Array.from({ length: GRID }, (_, r) => [
        <span key={`r${r}`} className="naval-axis">
          {LETTERS[r]}
        </span>,
        ...CELLS.slice(r * GRID, r * GRID + GRID).map((cell) => {
          const l = look(cell);
          const classes = ['naval-cell', l.ship && 'ship', l.sunk && 'sunk', l.shot, l.selected && 'selected', l.last && 'last'].filter(Boolean).join(' ');
          const clickable = !!onCell && (canClick?.(cell) ?? true);
          return clickable ? (
            <button key={cell} type="button" className={`${classes} clickable`} onClick={() => onCell!(cell)} aria-label={cellName(cell)} />
          ) : (
            <span key={cell} className={classes} aria-label={cellName(cell)} />
          );
        }),
      ])}
    </div>
  );
}

/** Le bateau qui contient cette case, s'il y en a un. */
const shipOf = (ships: Ship[], cell: number) => ships.findIndex((s) => s.cells.includes(cell));
const isVertical = (ship: Ship) => ship.cells.length > 1 && ship.cells[1]! - ship.cells[0]! === GRID;

/**
 * Placement de la flotte : elle part placée au hasard. On choisit un bateau en cliquant dessus, puis une case pour
 * l'y déplacer, ou « Pivoter » pour le tourner ; « Mélanger » replace tout au hasard.
 */
function Placement({ onReady }: { onReady: (ships: Ship[]) => void }) {
  const [ships, setShips] = useState<Ship[]>(() => randomFleet(Math.random));
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState('');

  function tryChange(index: number, start: number, vertical: boolean) {
    const moved = shipAt(start, ships[index]!.cells.length, vertical);
    const next = moved && ships.map((s, i) => (i === index ? moved : s));
    if (!next || !validFleet(next)) return setHint('Pas la place ici : les bateaux ne se touchent pas, même par un coin.');
    setHint('');
    setShips(next);
  }

  function click(cell: number) {
    const owner = shipOf(ships, cell);
    if (owner >= 0) {
      setSelected(owner === selected ? null : owner);
      setHint('');
      return;
    }
    if (selected === null) return setHint('Clique d’abord sur un bateau pour le choisir.');
    tryChange(selected, cell, isVertical(ships[selected]!));
  }

  return (
    <section className="naval-placement">
      <h2>Place ta flotte</h2>
      <p className="muted">
        Clique sur un bateau pour le choisir, puis sur une case pour l’y déplacer. Les bateaux ne se touchent pas, même par un
        coin.
      </p>
      <Grid label="Ta flotte" look={(cell) => ({ ship: shipOf(ships, cell) >= 0, selected: selected !== null && ships[selected]!.cells.includes(cell) })} onCell={click} />
      <ul className="naval-fleet-list">
        {ships.map((s, i) => (
          <li key={i}>
            <button type="button" className={`link small ${selected === i ? 'on' : ''}`} onClick={() => setSelected(selected === i ? null : i)}>
              {FLEET[i]?.name} · {s.cells.length}
            </button>
          </li>
        ))}
      </ul>
      {hint && <p className="hint bad">{hint}</p>}
      <div className="naval-placement-actions">
        <button type="button" disabled={selected === null} onClick={() => selected !== null && tryChange(selected, ships[selected]!.cells[0]!, !isVertical(ships[selected]!))}>
          <RotateCw /> Pivoter
        </button>
        <button
          type="button"
          onClick={() => {
            setShips(randomFleet(Math.random));
            setSelected(null);
            setHint('');
          }}
        >
          <Shuffle /> Mélanger
        </button>
        <button type="button" className="primary big" onClick={() => onReady(ships)}>
          Prêt
        </button>
      </div>
    </section>
  );
}

const RESULT_LABELS = { miss: 'À l’eau', hit: 'Touché', sunk: 'Touché-coulé' } as const;

/** La table de la bataille navale : le placement, puis la grille de l'adversaire (où l'on tire) et la sienne. */
export function BattleshipTable({
  game,
  room,
  messages,
  admin,
  onLeave,
}: {
  game: BattleshipView;
  room: RoomView;
  messages: ChatMessage[];
  admin: boolean;
  felt?: string;
  onLeave: () => void;
}) {
  const [error, setError] = useState('');
  const me = game.you;
  const spectator = me < 0;
  const other = spectator ? 1 : 1 - me;
  const reactions = useReactions();
  const notifications = useTurnNotifications();
  const myTurn = game.phase === 'playing' && game.currentPlayer === me;
  useTurnAlert(myTurn ? 'À toi de tirer' : null, notifications.state === 'on');
  const moderator = admin || (!spectator && room.hostId === game.players[me]?.id);
  const hostGone = room.players.find((p) => p.id === room.hostId)?.connected === false;
  const canPause = moderator || (!spectator && hostGone);
  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  useEffect(() => {
    setTurnEndsAt(room.turnRemainingMs === null || room.paused ? null : Date.now() + room.turnRemainingMs);
  }, [room]);
  const countdown = useCountdown(turnEndsAt);

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
    if (spectator || game.phase === 'gameOver' || room.training || confirm('Quitter la bataille ? Ton adversaire ne pourra plus la finir.')) void exit();
  }

  // Les cases de chaque grille : les tirs de l'un sont sur la grille de l'autre.
  const shotsOn = (player: number) => new Map(game.players[1 - player]!.shots.map((s) => [s.cell, s.result]));
  const sunkCells = (player: number) => new Set((game.revealed[player] ?? []).flatMap((s) => s.cells));
  const last = game.lastShot;
  const onEnemy = useMemo(() => shotsOn(other), [game]);
  const enemySunk = useMemo(() => sunkCells(other), [game]);
  const onMine = useMemo(() => (spectator ? shotsOn(0) : shotsOn(me)), [game]);
  const myShipCells = useMemo(
    () => new Set((spectator ? (game.revealed[0] ?? []) : (game.myShips ?? [])).flatMap((s) => s.cells)),
    [game],
  );
  const mineSunk = useMemo(() => sunkCells(spectator ? 0 : me), [game]);
  const ownIndex = spectator ? 0 : me;

  const youName = (i: number) => (i === me ? 'Toi' : game.players[i]!.name);
  let status: string;
  if (game.phase === 'placing') {
    const waiting = game.players.filter((p) => !p.ready).map((p) => (p.id === game.players[me]?.id ? 'toi' : p.name));
    status = spectator || game.players[me]?.ready ? `En attente : ${waiting.join(' et ')} place${waiting.length > 1 ? 'nt' : ''} sa flotte…` : 'Place ta flotte, puis clique sur « Prêt »';
  } else if (game.phase === 'gameOver') {
    status = 'Bataille terminée';
  } else {
    status = myTurn ? 'À toi de tirer : choisis une case chez l’adversaire' : `${game.players[game.currentPlayer]!.name} vise…`;
  }

  return (
    <main className={`table-screen naval-table${room.paused ? ' paused' : ''}`}>
      <header className="table-header">
        <div className="header-left">
          <span className="round">Bataille navale</span>
          <span className="beta-badge">Bêta</span>
          {room.training && (
            <span className="training-tag" title="Entraînement contre un bot : ne compte pas dans les classements et ne rapporte rien">
              Entraînement
            </span>
          )}
          {countdown !== null && game.phase === 'playing' && <span className="direction">
              <Timer /> {Math.min(countdown, room.turnSeconds)} s
            </span>}
          {room.spectators > 0 && <span className="direction">
              <Eye /> {room.spectators}
            </span>}
        </div>
        <div className="header-right">
          <ChatButton messages={messages} me={game.players[me]?.id ?? ''} muted={room.players[me]?.muted} />
          {!spectator && <ReactionButton />}
          {canPause && !room.paused && game.phase !== 'gameOver' && (
            <button className="icon" onClick={() => void send(socket.emitWithAck('room:pause', { paused: true }))} title="Mettre la bataille en pause">
              <Pause />
            </button>
          )}
          <button className="link" onClick={leave}>
            Quitter
          </button>
        </div>
      </header>

      <div className={`naval-status ${myTurn ? 'active' : ''}`} role="status">
        {last && game.phase !== 'placing' && (
          <span key={`${last.playerIndex}-${last.cell}`} className={`naval-last ${last.result}`}>
            {youName(last.playerIndex)} · {cellName(last.cell)} : {RESULT_LABELS[last.result]}
          </span>
        )}
        <span>{status}</span>
      </div>

      {game.phase === 'placing' && !spectator && !game.players[me]!.ready ? (
        <Placement onReady={(ships) => void send(socket.emitWithAck('game:place', { ships }))} />
      ) : (
        <div className="naval-boards">
          {[other, ownIndex].map((p, k) => {
            const enemy = k === 0;
            const reaction = reactions[room.players[p]?.id ?? ''];
            return (
              <section key={p} className={`naval-board ${enemy ? 'enemy' : 'own'} ${game.phase === 'playing' && game.currentPlayer !== p ? 'targeted' : ''}`}>
                <header className="naval-board-head">
                  {reaction && (
                    <span key={reaction.id} className="reaction" aria-hidden>
                      {reaction.emoji}
                    </span>
                  )}
                  <Avatar name={game.players[p]!.name} look={room.players[p]} bot={!!room.players[p]?.bot} />
                  {game.phase === 'playing' && game.currentPlayer === p && <span className="turn-token" title="À son tour" />}
                  <strong>{enemy ? (spectator ? game.players[p]!.name : `Chez ${game.players[p]!.name}`) : spectator ? game.players[p]!.name : 'Ta flotte'}</strong>
                  <span className="naval-afloat">
                    {game.players[p]!.ready ? `${game.players[p]!.afloat} / ${FLEET.length} à flot` : 'place sa flotte…'}
                  </span>
                </header>
                <Grid
                  label={enemy ? 'Grille de l’adversaire' : 'Ta flotte'}
                  small={!enemy}
                  look={(cell) =>
                    enemy
                      ? { shot: onEnemy.get(cell), sunk: enemySunk.has(cell), ship: enemySunk.has(cell), last: last?.playerIndex !== p && last?.cell === cell }
                      : { ship: myShipCells.has(cell), shot: onMine.get(cell), sunk: mineSunk.has(cell), last: last?.playerIndex !== ownIndex && last?.cell === cell }
                  }
                  onCell={enemy && myTurn ? (cell) => void send(socket.emitWithAck('game:shoot', { cell })) : undefined}
                  canClick={(cell) => !onEnemy.has(cell)}
                />
              </section>
            );
          })}
        </div>
      )}

      {error && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}
      {game.phase === 'gameOver' && (
        <div className="overlay" role="dialog" aria-label="Fin de la bataille">
          <div className="panel modal pop-in duel-over">
            <div className="trophy" aria-hidden>
              {game.winners.includes(me) ? <Trophy /> : spectator ? <Anchor /> : <Waves />}
            </div>
            <h2>
              {spectator
                ? `${game.players[game.winners[0]!]!.name} gagne`
                : game.winners.includes(me)
                  ? 'Victoire, flotte adverse coulée'
                  : 'Ta flotte est coulée…'}
            </h2>
            <p className="muted small">
              {game.players.map((p) => `${p.name} : ${p.shots.length} tirs, ${p.afloat} bateau${p.afloat > 1 ? 'x' : ''} à flot`).join(' · ')}
            </p>
            <div className="duel-actions">
              {!spectator && (
                <button className="primary" onClick={() => void send(socket.emitWithAck('game:rematch'))}>
                  Revanche
                </button>
              )}
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
