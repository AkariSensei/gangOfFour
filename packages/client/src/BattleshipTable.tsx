import { Anchor, Eye, Pause, RotateCw, Shuffle, Timer, Trophy, Waves } from 'lucide-react';
import { type BattleshipView, FLEET, GRID, type Ship, kindOf, randomFleet, shipAt, validFleet } from '@gof/engine';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, RoomView } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { ChatButton } from './Chat';
import { ShipArt } from './NavalShips';
import { PauseOverlay, ReactionButton, useCountdown, useReactions } from './Table';
import { RatingChange, useRatingChange } from './RatingChange';
import { errorLabel } from './labels';
import { socket } from './socket';
import { useTurnAlert, useTurnNotifications } from './turnAlert';

const LETTERS = 'ABCDEFGHIJ';
/** « B7 » : la lettre de la ligne, puis le numéro de la colonne. */
export const cellName = (cell: number) => `${LETTERS[Math.floor(cell / GRID)]}${(cell % GRID) + 1}`;
const CELLS = Array.from({ length: GRID * GRID }, (_, c) => c);
const RESULT_LABELS = { miss: 'À l’eau', hit: 'Touché', sunk: 'Touché-coulé' } as const;

const isVertical = (ship: Ship) => ship.cells.length > 1 && ship.cells[1]! - ship.cells[0]! === GRID;
/** Place d'une case dans la grille CSS (la première ligne et la première colonne portent les repères). */
const at = (cell: number): CSSProperties => ({ gridRow: Math.floor(cell / GRID) + 2, gridColumn: (cell % GRID) + 2 });
/** Place d'un bateau dans la grille CSS : il s'étend sur ses cases. */
const spanOf = (ship: Ship): CSSProperties => {
  const first = Math.min(...ship.cells);
  const vertical = isVertical(ship);
  return {
    gridRow: `${Math.floor(first / GRID) + 2} / span ${vertical ? ship.cells.length : 1}`,
    gridColumn: `${(first % GRID) + 2} / span ${vertical ? 1 : ship.cells.length}`,
  };
};

interface BoardShip extends Ship {
  kind: number;
  sunk?: boolean;
  /** État au placement : choisi, en train d'être déplacé, ou fantôme d'aperçu (permis ou non). */
  state?: 'selected' | 'dragging' | 'ghost' | 'ghost-bad';
  index?: number;
}

/**
 * Une grille de 10 × 10 en trois couches : l'eau (les cases), les navires par-dessus, et les impacts au-dessus.
 * `onCell` rend les cases cliquables ; `onShipDown` permet de saisir un navire (placement).
 */
function Board({
  label,
  ships,
  shots,
  taken,
  last,
  onCell,
  canClick,
  onShipDown,
  onShipDouble,
  small,
}: {
  label: string;
  ships: BoardShip[];
  shots: Map<number, 'miss' | 'hit' | 'sunk'>;
  /** Cases déjà prises par les autres navires, pendant le placement. */
  taken?: Set<number>;
  last?: number | null;
  onCell?: (cell: number) => void;
  canClick?: (cell: number) => boolean;
  onShipDown?: (e: ReactPointerEvent, index: number) => void;
  onShipDouble?: (index: number) => void;
  small?: boolean;
}) {
  return (
    <div className={`naval-grid ${small ? 'small' : ''}`} role="grid" aria-label={label}>
      <span className="naval-corner" />
      {Array.from({ length: GRID }, (_, c) => (
        <span key={`c${c}`} className="naval-axis" style={{ gridRow: 1, gridColumn: c + 2 }}>
          {c + 1}
        </span>
      ))}
      {Array.from({ length: GRID }, (_, r) => (
        <span key={`r${r}`} className="naval-axis" style={{ gridRow: r + 2, gridColumn: 1 }}>
          {LETTERS[r]}
        </span>
      ))}
      {CELLS.map((cell) => {
        const clickable = !!onCell && (canClick?.(cell) ?? true);
        const classes = ['naval-cell', taken?.has(cell) && 'taken', clickable && 'clickable'].filter(Boolean).join(' ');
        return clickable ? (
          <button key={cell} type="button" className={classes} style={at(cell)} data-cell={cell} onClick={() => onCell!(cell)} aria-label={cellName(cell)} title={cellName(cell)} />
        ) : (
          <span key={cell} className={classes} style={at(cell)} data-cell={cell} />
        );
      })}
      {ships.map((ship, k) => (
        <div
          key={`s${ship.index ?? k}-${ship.state ?? ''}`}
          className={`naval-ship ${ship.sunk ? 'sunk' : ''} ${ship.state ?? ''} ${onShipDown && !ship.state?.startsWith('ghost') ? 'grabbable' : ''}`}
          style={spanOf(ship)}
          onPointerDown={onShipDown && ship.index !== undefined && !ship.state?.startsWith('ghost') ? (e) => onShipDown(e, ship.index!) : undefined}
          onDoubleClick={onShipDouble && ship.index !== undefined ? () => onShipDouble(ship.index!) : undefined}
          title={FLEET[ship.kind]?.name}
        >
          <ShipArt kind={ship.kind} vertical={isVertical(ship)} />
        </div>
      ))}
      {[...shots].map(([cell, result]) => (
        <span key={`m${cell}`} className={`naval-mark ${result === 'miss' ? 'miss' : 'hit'} ${last === cell ? 'last' : ''}`} style={at(cell)} aria-label={`${cellName(cell)} : ${RESULT_LABELS[result]}`}>
          {result !== 'miss' && (
            <svg viewBox="0 0 40 40" aria-hidden>
              <path d="M20 3 L24 14 L35 9 L28 19 L38 24 L26 25 L29 37 L20 29 L11 37 L14 25 L2 24 L12 19 L5 9 L16 14 Z" />
            </svg>
          )}
        </span>
      ))}
    </div>
  );
}

/** La flotte d'un joueur en liste : chaque navire, barré s'il est coulé. */
function FleetStatus({ sunk }: { sunk: number[] }) {
  return (
    <ul className="naval-fleet-status" aria-label="Flotte">
      {FLEET.map((f, kind) => (
        <li key={kind} className={sunk.includes(kind) ? 'sunk' : ''} title={`${f.name}, ${f.size} cases${sunk.includes(kind) ? ', coulé' : ''}`}>
          <span className="naval-fleet-ship" style={{ '--size': f.size } as CSSProperties}>
            <ShipArt kind={kind} />
          </span>
          <span>{f.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Placement de la flotte : elle part placée au hasard. On fait glisser un navire pour le déplacer (ou on le choisit,
 * puis on touche une case), un double-clic ou « Pivoter » (touche R) le tourne. Les bateaux peuvent se toucher, mais
 * pas se chevaucher.
 */
function Placement({ onReady }: { onReady: (ships: Ship[]) => void }) {
  const [ships, setShips] = useState<Ship[]>(() => randomFleet(Math.random));
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState('');
  const [drag, setDrag] = useState<{ index: number; grab: number; moved: boolean; preview: Ship | null; valid: boolean } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const fleetWith = (index: number, ship: Ship | null) => (ship ? ships.map((s, i) => (i === index ? ship : s)) : null);
  function tryChange(index: number, start: number, vertical: boolean) {
    const next = fleetWith(index, shipAt(start, ships[index]!.cells.length, vertical));
    if (!next || !validFleet(next)) return setHint('Pas la place ici : un bateau ne peut pas en chevaucher un autre.');
    setHint('');
    setShips(next);
  }
  const rotate = (index: number) => tryChange(index, ships[index]!.cells[0]!, !isVertical(ships[index]!));

  // Touche R : pivoter le navire choisi.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && selected !== null) rotate(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Glisser-déposer : la case sous le doigt (ou la souris) donne la nouvelle place, la partie saisie restant sous le doigt.
  function onShipDown(e: ReactPointerEvent, index: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    const ship = ships[index]!;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const along = isVertical(ship) ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
    setSelected(index);
    setHint('');
    setDrag({ index, grab: Math.min(ship.cells.length - 1, Math.max(0, Math.floor(along * ship.cells.length))), moved: false, preview: null, valid: false });
  }
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const cell = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-cell]')?.dataset.cell;
      if (cell === undefined) return setDrag({ ...d, moved: true, preview: null, valid: false });
      const ship = ships[d.index]!;
      const vertical = isVertical(ship);
      const start = Number(cell) - d.grab * (vertical ? GRID : 1);
      // La partie saisie reste sur sa ligne (ou sa colonne) : pas de retour à la ligne d'un bord à l'autre.
      const sameLine = vertical || Math.floor(start / GRID) === Math.floor(Number(cell) / GRID);
      const preview = sameLine ? shipAt(start, ship.cells.length, vertical) : null;
      const next = fleetWith(d.index, preview);
      setDrag({ ...d, moved: true, preview, valid: !!next && validFleet(next) });
    };
    const up = () => {
      const d = dragRef.current;
      if (d?.moved && d.preview && d.valid) setShips(fleetWith(d.index, d.preview)!);
      else if (d?.moved) setHint('Pas la place ici : un bateau ne peut pas en chevaucher un autre.');
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag !== null, ships]);

  // Sans glisser (au doigt) : un navire choisi se pose sur la case touchée.
  function onCell(cell: number) {
    if (selected === null) return setHint('Touche d’abord un bateau pour le choisir.');
    tryChange(selected, cell, isVertical(ships[selected]!));
  }

  const focus = drag?.index ?? selected;
  const taken = useMemo(
    () => (focus === null ? new Set<number>() : new Set(ships.filter((_, i) => i !== focus).flatMap((s) => s.cells))),
    [ships, focus],
  );
  const shown: BoardShip[] = ships.map((s, i) => ({
    ...s,
    index: i,
    kind: kindOf(s, i),
    state: drag?.index === i && drag.moved ? 'dragging' : selected === i ? 'selected' : undefined,
  }));
  if (drag?.moved && drag.preview) shown.push({ ...drag.preview, kind: kindOf(ships[drag.index]!, drag.index), state: drag.valid ? 'ghost' : 'ghost-bad' });

  return (
    <section className="naval-placement">
      <div className="naval-placement-head">
        <h2>Place ta flotte</h2>
        <p className="muted">Fais glisser un bateau pour le déplacer, double-clic ou R pour le tourner. Les bateaux peuvent se toucher, pas se chevaucher.</p>
      </div>
      <Board label="Ta flotte" ships={shown} shots={new Map()} taken={taken} onCell={onCell} onShipDown={onShipDown} onShipDouble={rotate} />
      <ul className="naval-fleet-pick">
        {ships.map((s, i) => (
          <li key={i}>
            <button type="button" className={selected === i ? 'on' : ''} onClick={() => setSelected(selected === i ? null : i)}>
              <span className="naval-fleet-ship" style={{ '--size': s.cells.length } as CSSProperties}>
                <ShipArt kind={kindOf(s, i)} />
              </span>
              {FLEET[kindOf(s, i)]?.name}
            </button>
          </li>
        ))}
      </ul>
      <p className={`hint ${hint ? 'bad' : ''}`}>{hint || (selected === null ? 'Choisis un bateau pour le tourner' : `${FLEET[kindOf(ships[selected]!, selected)]?.name} choisi`)}</p>
      <div className="naval-placement-actions">
        <button type="button" disabled={selected === null} onClick={() => selected !== null && rotate(selected)}>
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
  const [endOpen, setEndOpen] = useState(true);
  const me = game.you;
  const spectator = me < 0;
  const other = spectator ? 1 : 1 - me;
  const ownIndex = spectator ? 0 : me;
  const reactions = useReactions();
  const notifications = useTurnNotifications();
  const rating = useRatingChange(game.phase === 'gameOver');
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
    if (spectator || game.phase === 'gameOver' || room.training || confirm('Quitter la bataille ? Ton adversaire ne pourra plus la finir.')) void exit();
  }

  // Les tirs de l'un tombent sur la grille de l'autre.
  const shotsOn = (player: number) => new Map(game.players[1 - player]!.shots.map((s) => [s.cell, s.result]));
  const onEnemy = useMemo(() => shotsOn(other), [game]);
  const onMine = useMemo(() => shotsOn(ownIndex), [game]);
  const enemyWrecks = game.revealed[other] ?? [];
  // Un navire est coulé quand toutes ses cases ont été touchées (à la fin, toute la flotte est montrée, coulée ou non).
  const sunkOn = (shots: Map<number, string>) => (ship: Ship) => ship.cells.every((c) => shots.has(c));
  const ownSunk = new Set((game.revealed[ownIndex] ?? []).filter(sunkOn(onMine)).map((s) => s.kind));
  const ownShips: BoardShip[] = spectator
    ? (game.revealed[0] ?? []).map((s) => ({ ...s, sunk: sunkOn(onMine)(s) }))
    : (game.myShips ?? []).map((s, i) => ({ ...s, kind: kindOf(s, i), sunk: ownSunk.has(kindOf(s, i)) }));
  const enemyShips: BoardShip[] = enemyWrecks.map((s) => ({ ...s, sunk: sunkOn(onEnemy)(s) }));
  const last = game.lastShot;

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
        {myTurn && <span className="turn-token" aria-hidden />}
        {last && game.phase !== 'placing' && (
          <span key={`${last.playerIndex}-${last.cell}`} className={`naval-last ${last.result}`}>
            {youName(last.playerIndex)} · {cellName(last.cell)} : {RESULT_LABELS[last.result]}
            {last.result === 'sunk' && last.ship !== undefined && ` (${FLEET[last.ship]?.name.toLowerCase()})`}
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
            const sunkKinds = (game.revealed[p] ?? []).filter(sunkOn(enemy ? onEnemy : onMine)).map((s) => s.kind);
            return (
              <section key={p} className={`naval-board ${enemy ? 'enemy' : 'own'} ${enemy && myTurn ? 'targeted' : ''}`}>
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
                <Board
                  label={enemy ? 'Grille de l’adversaire' : 'Ta flotte'}
                  small={!enemy}
                  ships={enemy ? enemyShips : ownShips}
                  shots={enemy ? onEnemy : onMine}
                  last={last && last.playerIndex !== p ? last.cell : null}
                  onCell={enemy && myTurn ? (cell) => void send(socket.emitWithAck('game:shoot', { cell })) : undefined}
                  canClick={(cell) => !onEnemy.has(cell)}
                />
                <FleetStatus sunk={sunkKinds} />
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
      {game.phase === 'gameOver' && !endOpen && (
        <button type="button" className="primary naval-end-reopen" onClick={() => setEndOpen(true)}>
          Fin de la bataille
        </button>
      )}
      {game.phase === 'gameOver' && endOpen && (
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
                  : 'Ta flotte est coulée'}
            </h2>
            <RatingChange change={rating} />
            <p className="muted small">
              {game.players.map((p) => `${p.name} : ${p.shots.length} tirs, ${p.afloat} bateau${p.afloat > 1 ? 'x' : ''} à flot`).join(' · ')}
            </p>
            <div className="duel-actions">
              {!spectator && (
                <button className="primary" onClick={() => void send(socket.emitWithAck('game:rematch'))}>
                  Revanche
                </button>
              )}
              <button className="ghost" onClick={() => setEndOpen(false)}>
                Voir les grilles
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
