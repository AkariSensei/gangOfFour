import { Eye, Pause, Timer } from 'lucide-react';
import { SLOT_SYMBOLS, type SlotSpin, type SlotSymbol, type SlotsView, payoutOf } from '@gof/engine';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { ChatMessage, RoomView } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { Bee } from './Bee';
import { ChatButton } from './Chat';
import { PauseOverlay, ReactionButton, useCountdown, useReactions } from './Table';
import { RatingChange, useRatingChange } from './RatingChange';
import { errorLabel } from './labels';
import { socket } from './socket';
import { useTurnAlert, useTurnNotifications } from './turnAlert';

export const SLOT_NAMES: Record<SlotSymbol, string> = {
  cherry: 'cerise',
  lemon: 'citron',
  orange: 'orange',
  grape: 'raisin',
  bell: 'cloche',
  star: 'étoile',
  seven: '7',
};
const SLOT_ICONS: Record<SlotSymbol, string> = { cherry: '🍒', lemon: '🍋', orange: '🍊', grape: '🍇', bell: '🔔', star: '⭐', seven: '7' };

/** Durée de rotation des rouleaux : le premier s'arrête au bout de SPIN_MS, les suivants REEL_GAP_MS après. */
const SPIN_MS = 900;
const REEL_GAP_MS = 400;
/** Le résultat s'affiche juste après l'arrêt du dernier rouleau. */
const ROLL_MS = SPIN_MS + 2 * REEL_GAP_MS + 150;

/** Un symbole des rouleaux (le 7 est dessiné, les autres sont des émojis). */
export function SlotIcon({ symbol }: { symbol: SlotSymbol }) {
  return symbol === 'seven' ? <span className="slot-seven">7</span> : <span className="slot-emoji">{SLOT_ICONS[symbol]}</span>;
}

/** Ce qu'a donné un tirage, en mots. */
function spinLabel(spin: SlotSpin): string {
  const [a, b, c] = spin.reels;
  if (a === b && b === c) return a === 'seven' ? 'Jackpot 7-7-7' : `Trois × ${SLOT_NAMES[a]}`;
  if (spin.win > 0) return 'Deux symboles identiques';
  return 'Rien cette fois';
}

/** Un rouleau : il défile tant que `rolling`, puis s'arrête sur son symbole. */
function Reel({ symbol, rolling, index }: { symbol: SlotSymbol | null; rolling: boolean; index: number }) {
  return (
    <span className={`reel ${rolling ? 'rolling' : symbol ? 'landed' : 'idle'}`} style={{ '--reel': index } as CSSProperties}>
      {rolling ? (
        <span className="reel-strip" aria-hidden>
          {[...SLOT_SYMBOLS, ...SLOT_SYMBOLS].map((s, i) => (
            <span key={i} className="reel-cell">
              <SlotIcon symbol={s} />
            </span>
          ))}
        </span>
      ) : (
        <span className="reel-cell">{symbol ? <SlotIcon symbol={symbol} /> : <span className="reel-empty">?</span>}</span>
      )}
    </span>
  );
}

/** Dernier tirage de chaque joueur, et celui qui tourne encore à l'écran (les rouleaux défilent un instant). */
function useRolling(game: SlotsView) {
  const ids = game.players.map((_, i) => {
    const last = game.spins.filter((s) => s.playerIndex === i).at(-1);
    return last ? `${last.round}-${i}` : '';
  });
  const seen = useRef<string[] | null>(null);
  // Heure de départ des rouleaux de chaque joueur ; l'écran se redessine à chaque arrêt de rouleau.
  const [startedAt, setStartedAt] = useState<Record<number, number>>({});
  const [, redraw] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    // Au premier affichage, rien ne tourne : on montre les derniers tirages tels quels.
    const before = seen.current;
    seen.current = ids;
    if (!before) return;
    ids.forEach((id, player) => {
      if (!id || id === before[player]) return;
      setStartedAt((s) => ({ ...s, [player]: Date.now() }));
      for (const delay of [SPIN_MS, SPIN_MS + REEL_GAP_MS, SPIN_MS + 2 * REEL_GAP_MS, ROLL_MS]) {
        timers.current.push(setTimeout(() => redraw((n) => n + 1), delay + 20));
      }
    });
  }, [ids.join('|')]);
  const elapsed = (player: number) => Date.now() - (startedAt[player] ?? 0);
  return {
    /** Les rouleaux de ce joueur tournent encore (le résultat n'est pas encore montré). */
    rolling: (player: number) => elapsed(player) < ROLL_MS,
    /** Ce rouleau-ci tourne encore. */
    reel: (player: number, index: number) => elapsed(player) < SPIN_MS + index * REEL_GAP_MS,
  };
}

/** Une machine : le joueur, son solde vers l'objectif, ses rouleaux et son dernier résultat. */
function Machine({
  game,
  index,
  room,
  rolling,
  reelRolling,
  reaction,
  onSpin,
}: {
  game: SlotsView;
  index: number;
  room: RoomView;
  rolling: boolean;
  reelRolling: (reel: number) => boolean;
  reaction?: { id: string; emoji: string };
  onSpin?: () => void;
}) {
  const player = game.players[index]!;
  const seat = room.players[index];
  const last = game.spins.filter((s) => s.playerIndex === index).at(-1);
  // Pendant que les rouleaux tournent, le solde affiché reste celui d'avant le tirage.
  const balance = rolling && last ? last.balance - last.win + last.stake : player.balance;
  const active = game.phase === 'playing' && game.currentPlayer === index;
  const mine = index === game.you;
  const progress = Math.max(0, Math.min(100, (balance / game.goal) * 100));
  const reels = last?.reels ?? [null, null, null];
  const result = last && !rolling ? last : null;
  const triple = result && payoutOf(result.reels) > 2;

  return (
    <section className={`machine ${mine ? 'mine' : ''} ${active ? 'active' : ''} ${triple ? 'big-win' : ''}`}>
      {reaction && (
        <span key={reaction.id} className="reaction" aria-hidden>
          {reaction.emoji}
        </span>
      )}
      <header className="machine-head">
        <Avatar name={player.name} look={seat} bot={!!(seat?.bot || seat?.vacant)} />
        <span className="machine-who">
          <strong>
            {active && <span className="turn-token" aria-hidden />}
            {mine ? 'Toi' : player.name}
          </strong>
          <small>{active ? (mine ? 'À toi de tirer' : 'Tire…') : seat?.connected === false ? 'Déconnecté' : 'En attente'}</small>
        </span>
        <span className={`machine-balance ${balance <= 0 ? 'broke' : ''}`}>{balance} €</span>
      </header>
      <div className="machine-goal" aria-label={`${balance} € sur ${game.goal} €`}>
        <span className="machine-goal-fill" style={{ width: `${progress}%` }} />
        <span className="machine-goal-start">100 €</span>
        <span className="machine-goal-end">{game.goal} €</span>
      </div>
      <div className="reels" role="img" aria-label={last ? last.reels.map((r) => SLOT_NAMES[r]).join(', ') : 'Pas encore de tirage'}>
        {reels.map((symbol, i) => (
          <Reel key={`${last?.round ?? 0}-${i}`} symbol={symbol} rolling={reelRolling(i)} index={i} />
        ))}
      </div>
      <p className={`machine-result ${result ? (result.win > 0 ? 'win' : 'lose') : ''}`}>
        {rolling
          ? 'Les rouleaux tournent…'
          : result
            ? `${spinLabel(result)} · ${result.win > 0 ? `+${result.win - result.stake}` : `−${result.stake}`} €`
            : 'Pas encore tiré'}
      </p>
      {onSpin && (
        <button type="button" className="primary big spin-button" disabled={!active || rolling} onClick={onSpin}>
          Tirer · {Math.min(game.stake, player.balance)} €
        </button>
      )}
    </section>
  );
}

/** Fin du duel : le gagnant et les soldes, la revanche ou le retour. */
function DuelOver({
  game,
  rating,
  onRematch,
  onExit,
}: {
  game: SlotsView;
  rating: ReturnType<typeof useRatingChange>;
  onRematch: () => void;
  onExit: () => void;
}) {
  const won = game.winners.includes(game.you);
  const shared = game.winners.length > 1;
  return (
    <div className="overlay" role="dialog" aria-label="Fin du duel">
      <div className="panel modal pop-in duel-over">
        <Bee mood={shared ? 'surprised' : won ? 'victory' : game.you < 0 ? 'happy' : 'sad'} motion={won ? 'hop' : undefined} className="end-bee" />
        <h2>{shared ? 'Égalité' : game.you < 0 ? `${game.players[game.winners[0]!]!.name} gagne` : won ? 'Tu gagnes le duel' : 'Perdu'}</h2>
        <div className="duel-balances">
          {game.players.map((p, i) => (
            <span key={p.id} className={game.winners.includes(i) ? 'winner' : ''}>
              {p.name} <strong>{p.balance} €</strong>
            </span>
          ))}
        </div>
        <RatingChange change={rating} />
        <p className="muted small">Duel joué en {game.round} tour{game.round > 1 ? 's' : ''}.</p>
        <div className="duel-actions">
          {game.you >= 0 && (
            <button className="primary" onClick={onRematch}>
              Revanche
            </button>
          )}
          <button className="ghost" onClick={onExit}>
            Retour à l’accueil
          </button>
        </div>
      </div>
    </div>
  );
}

/** La table du duel de machines à sous : sa machine et celle de l'adversaire, face à face. */
export function SlotsTable({
  game,
  room,
  messages,
  admin,
  onLeave,
}: {
  game: SlotsView;
  room: RoomView;
  messages: ChatMessage[];
  admin: boolean;
  felt?: string;
  onLeave: () => void;
}) {
  const [error, setError] = useState('');
  const me = game.you;
  const spectator = me < 0;
  const roll = useRolling(game);
  // Le serveur annonce les points dès la fin du duel, avant que l'écran de fin ne s'ouvre : on écoute dès la table.
  const rating = useRatingChange(game.phase === 'gameOver');
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
  // La fin s'affiche une fois les derniers rouleaux arrêtés.
  const anyRolling = game.players.some((_, i) => roll.rolling(i));
  const showEnd = game.phase === 'gameOver' && !anyRolling;

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
    if (spectator || game.phase === 'gameOver' || room.training || confirm('Quitter le duel ? Ton adversaire ne pourra plus le finir.')) void exit();
  }

  // Sa propre machine en premier (à gauche, ou en bas sur téléphone) ; un spectateur voit l'hôte d'abord.
  const order = spectator ? [0, 1] : [me, 1 - me];
  const last = game.spins.at(-1);

  return (
    <main className={`table-screen slots-table${room.paused ? ' paused' : ''}`}>
      <header className="table-header">
        <div className="header-left">
          <span className="round">Duel Jackpot</span>
          <span className="beta-badge">Bêta</span>
          {room.training && (
            <span className="training-tag" title="Entraînement contre un bot : ne compte pas dans les classements et ne rapporte rien">
              Entraînement
            </span>
          )}
          <span className="direction">
            Tour {game.round} · mise {game.stake} €{game.nextStake !== game.stake && ` (puis ${game.nextStake} €)`}
          </span>
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
            <button className="icon" onClick={() => void send(socket.emitWithAck('room:pause', { paused: true }))} title="Mettre le duel en pause">
              <Pause />
            </button>
          )}
          <button className="link" onClick={leave}>
            Quitter
          </button>
        </div>
      </header>

      <div className="machines">
        {order.map((i, k) => (
          <Machine
            key={i}
            game={game}
            index={i}
            room={room}
            rolling={roll.rolling(i)}
            reelRolling={(reel) => roll.reel(i, reel)}
            reaction={reactions[room.players[i]?.id ?? '']}
            onSpin={!spectator && k === 0 ? () => void send(socket.emitWithAck('game:spin')) : undefined}
          />
        ))}
        <span className="machines-versus" aria-hidden>
          VS
        </span>
      </div>

      <footer className="slots-footer">
        <p className="muted small">
          Chacun tire à son tour avec la mise du tour, qui monte de 5 € tous les trois tours. À la fin d’un tour, si l’un est à
          0 € ou l’autre à {game.goal} €, le plus riche gagne.
        </p>
        {last && <p className="muted small">Dernier tirage : {game.players[last.playerIndex]!.name}, tour {last.round}.</p>}
      </footer>

      {error && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}
      {showEnd && <DuelOver game={game} rating={rating} onRematch={() => void send(socket.emitWithAck('game:rematch'))} onExit={() => void exit()} />}
      {room.paused && (
        <PauseOverlay onResume={canPause ? () => void send(socket.emitWithAck('room:pause', { paused: false })) : undefined} />
      )}
    </main>
  );
}
