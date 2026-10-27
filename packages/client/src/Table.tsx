import { type Card, type Cut, type PlayerView, type TrickEntry, COLOR_RANK, analyzeCombination, canBeat, playableCards } from '@gof/engine';
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, Look, RoomView } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { ChatButton, KickButton, MuteButton } from './Chat';
import { CardView, cardImage } from './CardView';
import { cardLabel, combinationLabel, errorLabel } from './labels';
import { socket } from './socket';
import { useTurnAlert } from './turnAlert';
import { useAutoPass } from './autoPass';

type Seat = 'right' | 'top' | 'left' | 'bottom';
type SortMode = 'value' | 'color';

/** Place les adversaires autour de la table : le suivant (sens antihoraire) à droite, puis en face, puis à gauche. */
function seatsFor(count: number): Seat[] {
  return count === 3 ? ['right', 'left'] : ['right', 'top', 'left'];
}

/** Places de tous les joueurs pour un spectateur, qui n'a pas de siège : le premier joueur en bas. */
function spectatorSeats(count: number): Seat[] {
  return ['bottom', ...seatsFor(count)];
}

/** Dernier geste de chaque joueur dans le pli en cours, pour afficher « Passe » à côté de lui. */
function lastMoves(trick: TrickEntry[]): Map<number, TrickEntry> {
  const moves = new Map<number, TrickEntry>();
  for (const entry of trick) moves.set(entry.playerIndex, entry);
  return moves;
}

function Opponent({
  game,
  index,
  seat,
  connected,
  bot,
  away,
  look,
  move,
  muted,
  onMute,
  onKick,
}: {
  game: PlayerView;
  index: number;
  seat: Seat;
  connected: boolean;
  bot: boolean;
  away: boolean;
  look?: Look;
  move?: TrickEntry;
  muted: boolean;
  /** Présent seulement pour l'hôte et l'admin : couper ou rendre le chat de ce joueur. */
  onMute?: () => void;
  onKick?: () => void;
}) {
  const p = game.players[index]!;
  const active = game.phase === 'playing' && game.currentPlayer === index;
  const giving = game.phase === 'exchange' && game.exchange?.winnerIndex === index;
  return (
    <div className={`opponent seat-${seat} ${active || giving ? 'active' : ''} ${connected ? '' : 'offline'}`}>
      <Avatar name={p.name} look={look} bot={bot} />
      <div className="opponent-info">
        <div className="opponent-name">
          {p.name}
          {game.dealer === index && <span className="tag">donneur</span>}
          {away ? <span className="tag">🤖 bot</span> : !connected && <span className="tag">hors ligne</span>}
          {onMute ? <MuteButton name={p.name} muted={muted} onClick={onMute} /> : muted && <span className="tag">🔇</span>}
          {onKick && <KickButton name={p.name} onKick={onKick} />}
        </div>
        <div className="opponent-meta">
          <span className="count">{p.cardCount}</span> carte{p.cardCount > 1 ? 's' : ''} · {p.score} pt{p.score > 1 ? 's' : ''}
        </div>
      </div>
      <div className="mini-fan" aria-hidden>
        {Array.from({ length: Math.min(p.cardCount, 16) }, (_, i) => (
          <span key={i} className="card-back" />
        ))}
      </div>
      {p.cardCount === 1 && game.phase === 'playing' && <span className="bubble alert">Carte !</span>}
      {move && move.combination === null && game.phase === 'playing' && !active && <span className="bubble">Passe</span>}
    </div>
  );
}

function Scores({ game }: { game: PlayerView }) {
  const best = Math.min(...game.players.map((p) => p.score));
  const tied = game.players.every((p) => p.score === best);
  return (
    <div className="scores" aria-label="Scores">
      {game.players.map((p, i) => (
        <span key={p.id} className={`score-pill ${i === game.you ? 'me' : ''} ${p.score === best && !tied ? 'leader' : ''}`}>
          {p.name} <strong>{p.score}</strong>
        </span>
      ))}
    </div>
  );
}

/** Temps minimal d'affichage du résumé avant qu'on puisse lancer la suite, pour que chacun ait le temps de le lire. */
const RECAP_MIN_MS = 8000;

function RoundOver({ game, onExit }: { game: PlayerView; onExit: () => void }) {
  const r = game.lastRound!;
  const over = game.phase === 'gameOver';
  const [readUntil] = useState(() => Date.now() + RECAP_MIN_MS);
  const wait = useCountdown(readUntil) || 0;
  const suffix = wait > 0 ? ` (${wait})` : '';
  const ranking = game.players.map((p, i) => ({ ...p, i })).sort((a, b) => a.score - b.score);
  const winnerNames = game.winners.map((i) => game.players[i]!.name).join(' et ');
  return (
    <div className="overlay">
      <div className="panel modal pop-in">
        {over ? (
          <>
            <div className="trophy" aria-hidden>
              🏆
            </div>
            <h2>{winnerNames} gagne la partie !</h2>
          </>
        ) : (
          <h2>{game.players[r.winnerIndex]!.name} remporte la manche {game.round}</h2>
        )}
        <table className="results">
          <thead>
            <tr>
              <th />
              <th>Joueur</th>
              <th>Cartes restantes</th>
              <th>Manche</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((p, rank) => (
              <tr key={p.id} className={p.i === game.you ? 'me' : ''}>
                <td className="rank">{rank + 1}</td>
                <td>{p.name}</td>
                <td>
                  <div className="leftover">
                    {r.hands[p.i]!.length === 0
                      ? '—'
                      : r.hands[p.i]!.map((c) => <img key={c.id} src={cardImage(c)} alt={cardLabel(c)} title={cardLabel(c)} />)}
                  </div>
                </td>
                <td className={r.penalties[p.i] === 0 ? 'zero' : 'penalty'}>+{r.penalties[p.i]}</td>
                <td>
                  <strong>{p.score}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {over ? (
          <div className="end-actions">
            {game.you >= 0 && (
              <button className="primary big" disabled={wait > 0} onClick={() => socket.emitWithAck('game:rematch')}>
                Revanche{suffix}
              </button>
            )}
            <button className={game.you >= 0 ? 'big' : 'primary big'} onClick={onExit}>
              Retour à l'accueil
            </button>
          </div>
        ) : (
          <>
            <p className="muted">
              {game.players[r.loserIndex]!.name} donnera sa meilleure carte à {game.players[r.winnerIndex]!.name}.
            </p>
            {game.you < 0 ? (
              <p className="muted">La manche suivante commence quand un joueur la lance.</p>
            ) : (
              <button className="primary big" disabled={wait > 0} onClick={() => socket.emitWithAck('game:nextRound')}>
                Manche suivante{suffix}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Grosse annonce au centre de l'écran quand le tour du joueur arrive, qui s'efface d'elle-même. */
/**
 * Grosse annonce au centre quand c'est à soi d'agir. Elle reste affichée jusqu'à ce que le joueur l'ait vue
 * (clic n'importe où, ou touche Entrée / Échap).
 */
function TurnBanner({ text }: { text: string | null }) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!text || seen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') setSeen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [text, seen]);
  if (!text || seen) return null;
  return (
    <div className="turn-banner" role="alertdialog" aria-label={text} onClick={() => setSeen(true)}>
      <div className="turn-banner-box">
        <div className="turn-banner-title">{text}</div>
        <button className="turn-banner-ok" autoFocus>
          J'ai vu
        </button>
      </div>
    </div>
  );
}

/** Fin de manche : le paquet ramassé, vu de côté. Le donneur clique entre deux cartes pour le couper. */
function CutDeck({ game }: { game: PlayerView }) {
  const mine = game.dealer === game.you;
  const [hover, setHover] = useState(0);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const size = game.deckSize;
  // Le dessus du paquet est à gauche : cliquer sur la carte i coupe les i cartes de gauche (au moins une).
  const position = (i: number) => Math.min(Math.max(i, 1), size - 1);

  async function cutAt(i: number) {
    setSent(true);
    const result = await socket.emitWithAck('game:cut', { position: position(i) });
    if (!result.ok) {
      setSent(false);
      setError(errorLabel(result.error));
    }
  }

  return (
    <div className="center-pile">
      <div className="pile-label">
        {mine ? 'À toi de couper le paquet : clique là où tu veux couper' : `${game.players[game.dealer]!.name} coupe le paquet…`}
      </div>
      <div
        className={`cut-deck pop-in ${mine && !sent ? 'mine' : ''}`}
        style={{ '--size': size } as CSSProperties}
        onMouseLeave={() => setHover(0)}
      >
        {Array.from({ length: size }, (_, i) => (
          <button
            key={i}
            type="button"
            className={`cut-card ${mine && hover > 0 && i < position(hover) ? 'lifted' : ''}`}
            disabled={!mine || sent}
            onMouseEnter={() => setHover(i)}
            onClick={() => void cutAt(i)}
            aria-label={`Couper ${position(i)} cartes`}
          />
        ))}
      </div>
      <div className="pile-empty">
        {error ||
          (mine
            ? hover > 0
              ? `${position(hover)} carte${position(hover) > 1 ? 's' : ''} du dessus passent dessous`
              : `Ensuite, ${game.players[(game.dealer - 1 + game.players.length) % game.players.length]!.name} distribue.`
            : 'La nouvelle manche commence juste après.')}
      </div>
    </div>
  );
}

/** Rappel de l'échange de début de manche : les deux cartes données, visibles par tous jusqu'à la fin du premier pli. */
function ExchangeRecap({ game }: { game: PlayerView }) {
  const exchange = game.exchange!;
  const loser = game.players[exchange.loserIndex]!.name;
  const winner = game.players[exchange.winnerIndex]!.name;
  return (
    <div className="exchange-recap pop-in" aria-label="Échange de cartes">
      <div className="exchange-row">
        <CardView card={exchange.loserCard} />
        <span>
          {loser} <span aria-hidden>→</span> {winner}
        </span>
      </div>
      <div className="exchange-row">
        {exchange.winnerCard ? <CardView card={exchange.winnerCard} key={exchange.winnerCard.id} /> : <span className="card card-back pending" />}
        <span>
          {winner} <span aria-hidden>→</span> {loser}
        </span>
      </div>
    </div>
  );
}

/** Durée de l'animation de la coupe, montrée à toute la table avant la distribution. */
const CUT_ANIMATION_MS = 1800;

/** La coupe vient d'avoir lieu : les cartes du dessus se soulèvent et passent sous le paquet, sous les yeux de tous. */
function CutAnimation({ game, cut }: { game: PlayerView; cut: Cut }) {
  const rest = cut.deckSize - cut.position;
  const strips = (count: number) => Array.from({ length: count }, (_, i) => <span key={i} className="cut-card" />);
  return (
    <div className="center-pile">
      <div className="pile-label">
        {cut.playerIndex === game.you ? 'Tu as coupé le paquet' : `${game.players[cut.playerIndex]!.name} a coupé le paquet`}
      </div>
      <div
        className="cut-deck cutting"
        style={{ '--size': cut.deckSize, '--top': cut.position, '--rest': rest } as CSSProperties}
        aria-hidden
      >
        <div className="cut-part cut-top">{strips(cut.position)}</div>
        <div className="cut-part cut-rest">{strips(rest)}</div>
      </div>
      <div className="pile-empty">
        {cut.position} carte{cut.position > 1 ? 's' : ''} du dessus passent dessous
      </div>
    </div>
  );
}

/** Le centre de la table : la combinaison à battre, les coups précédents du pli en retrait, ou l'échange de cartes. */
function CenterPile({ game, cut }: { game: PlayerView; cut: Cut | null }) {
  const plays = game.trick.filter((e) => e.combination);
  const top = game.table;
  const exchange = game.exchange;

  if (game.phase === 'cut') return <CutDeck game={game} />;
  if (cut) return <CutAnimation game={game} cut={cut} />;

  if (game.phase === 'exchange' && exchange) {
    return (
      <div className="center-pile">
        <div className="pile-label">
          {game.players[exchange.loserIndex]!.name} donne sa meilleure carte à {game.players[exchange.winnerIndex]!.name}
        </div>
        <div className="pile-cards pop-in">
          <CardView card={exchange.loserCard} />
        </div>
      </div>
    );
  }

  if (!top) {
    const current = game.players[game.currentPlayer]!;
    const lastPlay = plays[plays.length - 1];
    // Manche finie : la table est vidée, mais on garde en évidence la dernière carte posée le temps que chacun la voie.
    const finished = game.phase === 'roundOver' || game.phase === 'gameOver';
    return (
      <div className="center-pile">
        {lastPlay && (game.phase === 'playing' || finished) && (
          <div className={finished ? 'pile-cards final pop-in' : 'pile-cards faded'}>
            {lastPlay.combination!.cards.map((c) => (
              <CardView key={c.id} card={c} />
            ))}
          </div>
        )}
        {lastPlay && finished && <div className="pile-label">{game.players[lastPlay.playerIndex]!.name} termine la manche</div>}
        {game.phase === 'playing' && (
          <div className="pile-empty">
            {game.currentPlayer === game.you ? 'À toi d’ouvrir un nouveau pli' : `${current.name} ouvre un nouveau pli`}
          </div>
        )}
      </div>
    );
  }

  const previous = plays.slice(-3, -1);
  const tablePlayer = game.players[top.playerIndex]!;
  return (
    <div className="center-pile">
      <div className="pile-stack">
        {previous.map((e, i) => (
          <div key={i} className="pile-cards previous" style={{ '--depth': previous.length - i } as CSSProperties}>
            {e.combination!.cards.map((c) => (
              <CardView key={c.id} card={c} />
            ))}
          </div>
        ))}
        <div className={`pile-cards top fly-in from-${sideOf(game, top.playerIndex)}`} key={top.combination.cards.map((c) => c.id).join()}>
          {top.combination.cards.map((c) => (
            <CardView key={c.id} card={c} />
          ))}
        </div>
      </div>
      <div className={`pile-label ${top.combination.type === 'gang' ? 'gang' : ''}`}>
        {tablePlayer.name} · {combinationLabel(top.combination.type, top.combination.cards.length)}
      </div>
    </div>
  );
}

/** Côté de la table d'où arrivent les cartes d'un joueur : le bas pour soi, sinon la place de l'adversaire. */
function sideOf(game: PlayerView, index: number): Seat | 'bottom' {
  const n = game.players.length;
  if (game.you < 0) return spectatorSeats(n)[index]!;
  return index === game.you ? 'bottom' : seatsFor(n)[(index - game.you - 1 + n) % n]!;
}

function sortHand(hand: Card[], mode: SortMode): Card[] {
  if (mode === 'value') return hand;
  return [...hand].sort((a, b) => COLOR_RANK[a.color] - COLOR_RANK[b.color] || a.value - b.value);
}

/**
 * Applique l'ordre choisi à la main par glisser-déposer. Une carte reçue en cours de manche (échange) se glisse
 * juste avant la première carte rangée qui la suit dans le tri, plutôt qu'en bout de main.
 */
function orderHand(sorted: Card[], order: string[] | null): Card[] {
  if (!order) return sorted;
  const byId = new Map(sorted.map((c) => [c.id, c]));
  const result = order.flatMap((id) => byId.get(id) ?? []);
  const placed = new Set(result.map((c) => c.id));
  const rank = new Map(sorted.map((c, i) => [c.id, i]));
  for (const card of sorted) {
    if (placed.has(card.id)) continue;
    const at = result.findIndex((c) => rank.get(c.id)! > rank.get(card.id)!);
    result.splice(at < 0 ? result.length : at, 0, card);
  }
  return result;
}

/** Distance (en pixels) au-delà de laquelle un appui sur une carte devient un glisser plutôt qu'un clic. */
const DRAG_THRESHOLD = 8;

/** Secondes restantes avant `endsAt` (horloge locale), recalculées quatre fois par seconde. */
function useCountdown(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [endsAt]);
  return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** Temps d'affichage de la dernière carte posée avant le résumé de fin de manche. */
const SUMMARY_DELAY_MS = 2200;

/** Vrai seulement `delay` ms après que `on` est devenu vrai ; repasse à faux dès que `on` retombe. */
function useDelayed(on: boolean, delay: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!on) {
      setReady(false);
      return;
    }
    const t = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(t);
  }, [on, delay]);
  return ready;
}

/** Durée de l'effet Gang (la même que son animation CSS). */
const GANG_BURST_MS = 1800;

/** Grand effet à l'écran quand un Gang est posé : flash, secousse de la table et nom du Gang. */
function GangBurst({ label, player }: { label: string; player: string }) {
  return (
    <div className="gang-burst" aria-hidden>
      <div className="gang-burst-text">
        <span className="gang-burst-name">{label}</span>
        <span className="gang-burst-player">{player}</span>
      </div>
    </div>
  );
}

/** Coup préparé avant son tour, joué automatiquement dès que le tour arrive. */
type Planned = ({ type: 'play'; cardIds: string[] } | { type: 'pass' }) & { round: number; trickLength: number };

export function Table({
  game,
  room,
  messages,
  admin,
  onLeave,
}: {
  game: PlayerView;
  room: RoomView;
  messages: ChatMessage[];
  /** L'admin peut, comme l'hôte, couper le chat d'un joueur. */
  admin: boolean;
  onLeave: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('value');
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [planned, setPlanned] = useState<Planned | null>(null);

  const me = game.you;
  const spectator = me < 0;
  const moderator = admin || (!spectator && room.hostId === game.players[me]?.id);
  const n = game.players.length;
  const myTurn = game.phase === 'playing' && game.currentPlayer === me;
  const exchange = game.exchange;
  const mustGive = game.phase === 'exchange' && exchange?.winnerIndex === me;
  const mustCut = game.phase === 'cut' && game.dealer === me;
  useTurnAlert(myTurn || mustGive || mustCut);
  const { autoPass, toggleAutoPass } = useAutoPass(room, game.players[me]?.id);
  // Minuteur : le serveur envoie le temps restant ; on en déduit l'heure de fin sur l'horloge locale.
  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  useEffect(() => {
    setTurnEndsAt(room.turnRemainingMs === null ? null : Date.now() + room.turnRemainingMs);
  }, [room]);
  const countdown = useCountdown(turnEndsAt);
  // Fin de manche : on laisse voir la dernière carte posée avant d'ouvrir le résumé.
  const roundFinished = game.phase === 'roundOver' || game.phase === 'gameOver';
  const showSummary = useDelayed(roundFinished, SUMMARY_DELAY_MS);
  const secondsLeft = countdown === null ? null : Math.min(countdown, room.turnSeconds);
  const myAction = myTurn || mustGive || mustCut;
  // L'annonce change de texte à chaque nouveau tour (le compteur de cartes jouées la relance).
  const bannerText = myTurn
    ? game.table
      ? 'À toi de jouer !'
      : 'À toi d’ouvrir !'
    : mustGive
      ? 'Choisis une carte à rendre'
      : mustCut
        ? 'À toi de couper !'
        : null;
  const turnKey = `${game.round}-${game.phase}-${game.trick.length}-${game.currentPlayer}`;

  // La main change à chaque coup : on oublie la sélection des cartes qui ne sont plus là.
  useEffect(() => {
    setSelected((s) => s.filter((id) => game.hand.some((c) => c.id === id)));
  }, [game.hand]);
  useEffect(() => setError(''), [game.currentPlayer, game.phase]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(t);
  }, [error]);

  // La coupe vient d'avoir lieu : toute la table la voit (seulement si on était là pendant la coupe, pas en revenant).
  const [cutShown, setCutShown] = useState<Cut | null>(null);
  const previousPhase = useRef(game.phase);
  const dealDelay = useRef(0);
  useEffect(() => {
    const cutDone = previousPhase.current === 'cut' && game.phase !== 'cut' && game.lastCut;
    previousPhase.current = game.phase;
    if (!cutDone) return;
    dealDelay.current = CUT_ANIMATION_MS;
    setCutShown(game.lastCut);
  }, [game.phase, game.round]);
  useEffect(() => {
    if (!cutShown) return;
    const t = setTimeout(() => setCutShown(null), CUT_ANIMATION_MS);
    return () => clearTimeout(t);
  }, [cutShown]);

  // Nouvelle main : les cartes arrivent une à une, comme une distribution (seulement pendant ce court moment,
  // pour ne pas rejouer l'animation quand on range sa main). Après une coupe, la distribution attend la fin de l'animation.
  const [dealing, setDealing] = useState<{ delay: number } | null>(() => (game.hand.length >= 10 ? { delay: 0 } : null));
  const handSize = game.hand.length;
  const previousHandSize = useRef(0);
  useEffect(() => {
    const grew = handSize >= 10 && previousHandSize.current < 10;
    previousHandSize.current = handSize;
    if (!grew) return;
    const delay = dealDelay.current;
    dealDelay.current = 0;
    setDealing({ delay });
    const t = setTimeout(() => setDealing(null), 1500 + delay);
    return () => clearTimeout(t);
  }, [handSize]);

  // Nouvelle manche, nouvelle main : l'ordre rangé à la main pour la manche d'avant ne veut plus rien dire
  // (les cartes gardent le même identifiant d'une manche à l'autre, il mélangerait la nouvelle main).
  useEffect(() => setOrder(null), [game.round]);

  // L'échange reste affiché jusqu'à la fin du premier pli : le pli est fini quand la table est vidée après des coups.
  const [firstTrickDone, setFirstTrickDone] = useState(0);
  const trickOver = game.phase === 'playing' && !game.table && game.trick.length > 0;
  useEffect(() => {
    if (trickOver) setFirstTrickDone(game.round);
  }, [trickOver, game.round]);
  const showExchange =
    !!exchange && (game.phase === 'exchange' || (game.phase === 'playing' && firstTrickDone !== game.round && !trickOver));

  // Un Gang vient d'être posé : on le fête (une fois par Gang, grâce à sa clé).
  const top = game.table;
  const gang =
    top?.combination.type === 'gang'
      ? {
          key: top.combination.cards.map((c) => c.id).join(),
          label: combinationLabel('gang', top.combination.cards.length),
          player: game.players[top.playerIndex]!.name,
        }
      : null;
  // Pendant l'effet, l'annonce « À toi » attend : les deux se superposeraient.
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!gang) return;
    setCelebrating(true);
    const t = setTimeout(() => setCelebrating(false), GANG_BURST_MS);
    return () => clearTimeout(t);
  }, [gang?.key]);

  const hand = useMemo(() => orderHand(sortHand(game.hand, sortMode), order), [game.hand, sortMode, order]);

  // Glisser-déposer : la carte saisie prend la place de la carte la plus proche du doigt (ou de la souris).
  function onPointerDown(e: PointerEvent<HTMLButtonElement>, card: Card) {
    if (e.button !== 0) return;
    suppressClick.current = false;
    drag.current = { id: card.id, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragging(d.id);
    }
    const elements = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-card]') ?? [])];
    let nearest: string | null = null;
    let best = Infinity;
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (dist < best) {
        best = dist;
        nearest = el.dataset.card!;
      }
    }
    if (!nearest || nearest === d.id) return;
    const ids = hand.map((c) => c.id);
    const from = ids.indexOf(d.id);
    const to = ids.indexOf(nearest);
    ids.splice(from, 1);
    ids.splice(to, 0, d.id);
    setOrder(ids);
  }

  function onPointerUp() {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
    setDragging(null);
  }

  function changeSort() {
    setOrder(null);
    setSortMode((m) => (m === 'value' ? 'color' : 'value'));
  }
  const selectedCards = selected.map((id) => game.hand.find((c) => c.id === id)).filter((c): c is Card => !!c);

  // Cartes qui peuvent battre la table, pour mettre les autres en retrait (règle « Carte ! » comprise).
  const playable = useMemo(() => {
    if (!myTurn || !game.table) return null;
    const nextPlayer = game.players[(me + game.direction + n) % n]!;
    return playableCards(game.hand, game.table.combination, nextPlayer.cardCount === 1);
  }, [myTurn, game.table, game.hand, game.players, game.direction, me, n]);

  const hint = useMemo(() => {
    if (planned?.type === 'pass') return { text: 'Passe prévue : tu passeras dès que ce sera ton tour', ok: true };
    if (planned?.type === 'play') return { text: 'Coup prévu : il partira dès que ce sera ton tour (s\'il passe encore)', ok: true };
    if (mustGive) return selectedCards.length === 1 ? `Donner ${cardLabel(selectedCards[0]!)}` : 'Choisis la carte à rendre';
    if (selectedCards.length === 0) return playable?.size === 0 ? (autoPass ? 'Rien ne passe : tu passes' : 'Rien ne passe : tu peux passer') : '';
    const combo = analyzeCombination(selectedCards);
    if (!combo) return { text: 'Combinaison invalide', ok: false };
    const label = combinationLabel(combo.type, combo.cards.length);
    const target = game.table?.combination;
    if (target && combo.type !== 'gang' && target.type !== 'gang' && combo.cards.length !== target.cards.length) {
      const count = target.cards.length;
      return { text: `${label} · il faut ${count} carte${count > 1 ? 's' : ''}`, ok: false };
    }
    if (target && !canBeat(combo, target)) return { text: `${label} · trop faible`, ok: false };
    return { text: label, ok: true };
  }, [selectedCards, mustGive, game.table, playable, planned, autoPass]);

  function toggle(card: Card) {
    // Le clic qui termine un glisser ne sélectionne pas la carte.
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setError('');
    setPlanned(null);
    if (mustGive) return setSelected([card.id]);
    setSelected((s) => (s.includes(card.id) ? s.filter((id) => id !== card.id) : [...s, card.id]));
  }

  async function send(result: Promise<{ ok: true } | { ok: false; error: string }>) {
    const r = await result;
    if (r.ok) setSelected([]);
    else setError(errorLabel(r.error));
  }

  /** L'hôte et l'admin modèrent les autres joueurs humains (pas les bots, ni une place tenue par un bot). */
  const canModerate = (index: number) => {
    const p = room.players[index];
    return moderator && !!p && !p.bot && !p.vacant;
  };

  async function kick(playerId: string) {
    const r = await socket.emitWithAck('room:kick', { playerId });
    if (!r.ok) setError(errorLabel(r.error));
  }

  async function mute(playerId: string, muted: boolean) {
    const r = await socket.emitWithAck('room:mute', { playerId, muted });
    if (!r.ok) setError(errorLabel(r.error));
  }

  // Un coup préparé ne vaut que pour le pli en cours : il est oublié quand un nouveau pli ou une nouvelle manche commence.
  const trickLength = game.trick.length;
  const previousTrick = useRef({ round: game.round, length: trickLength });
  useEffect(() => {
    const prev = previousTrick.current;
    if (game.round !== prev.round || trickLength < prev.length || game.phase !== 'playing') setPlanned(null);
    previousTrick.current = { round: game.round, length: trickLength };
  }, [game.round, trickLength, game.phase]);

  // Le tour arrive : le coup préparé part tout seul, s'il est encore possible.
  useEffect(() => {
    if (!myTurn || !planned) return;
    setPlanned(null);
    // Nouveau pli entre-temps (le pli a été remporté) : le coup préparé ne vaut plus.
    if (game.round !== planned.round || game.trick.length < planned.trickLength) return;
    if (planned.type === 'pass') {
      if (game.table) void send(socket.emitWithAck('game:pass'));
      else setError('Tu ouvres le pli : passer n\'est pas possible, à toi de choisir.');
      return;
    }
    const cards = planned.cardIds.map((id) => game.hand.find((c) => c.id === id));
    const combo = cards.every((c) => c) ? analyzeCombination(cards as Card[]) : null;
    if (!combo || (game.table && !canBeat(combo, game.table.combination))) {
      setError('Ton coup préparé ne passe plus : à toi de choisir.');
      return;
    }
    void send(socket.emitWithAck('game:play', { cardIds: planned.cardIds }));
  }, [myTurn, planned]);

  async function exit() {
    await socket.emitWithAck('room:leave');
    onLeave();
  }

  function leave() {
    if (spectator || confirm('Quitter la partie ? Les autres joueurs ne pourront plus la terminer sans toi.')) void exit();
  }

  // Le spectateur voit tous les joueurs autour de la table ; un joueur voit les autres à partir de sa place.
  const opponents = spectator
    ? spectatorSeats(n).map((seat, index) => ({ seat, index }))
    : seatsFor(n).map((seat, k) => ({ seat, index: (me + k + 1) % n }));
  const moves = lastMoves(game.trick);
  const current = game.players[game.currentPlayer]!;

  let status: string;
  if (game.phase === 'cut') {
    status = game.dealer === me ? 'À toi de couper le paquet.' : `${game.players[game.dealer]!.name} coupe le paquet…`;
  } else if (game.phase === 'exchange') {
    status = mustGive
      ? `Tu as reçu ${cardLabel(exchange!.loserCard)} de ${game.players[exchange!.loserIndex]!.name}. Choisis une carte à lui rendre.`
      : `${game.players[exchange!.winnerIndex]!.name} choisit une carte à rendre à ${game.players[exchange!.loserIndex]!.name}…`;
  } else if (game.phase !== 'playing') {
    status = 'Fin de la manche';
  } else if (myTurn) {
    status = game.mustPlayMultiOne ? 'À toi ! Ouvre la partie avec le 1 multicolore.' : 'À toi de jouer !';
  } else {
    status = `${current.name} réfléchit…`;
  }

  const myMove = moves.get(me);

  // On peut préparer son coup pendant le tour des autres, sauf si on a déjà passé ce pli.
  const canPlan = game.phase === 'playing' && !myTurn && !game.mustPlayMultiOne && myMove?.combination !== null;
  const mid = (hand.length - 1) / 2;

  return (
    <main className={`table-screen players-${n}`}>
      <header className="table-header">
        <div className="header-left">
          <span className="round">Manche {game.round}</span>
          <span className="direction" title="La partie s'arrête quand un joueur atteint ce score">
            en {game.targetScore} pts
          </span>
          <span className="direction" title="Sens de jeu de la manche">
            {game.direction === 1 ? '↺ antihoraire' : '↻ horaire'}
          </span>
          {room.turnSeconds > 0 && (
            <span className="direction" title="Temps pour jouer : après, tu passes automatiquement">
              ⏱ {room.turnSeconds} s par tour
            </span>
          )}
          {game.dealer === me && (
            <span className="direction" title="Tu as distribué les cartes de cette manche">
              Tu es donneur
            </span>
          )}
          {room.spectators > 0 && (
            <span className="direction" title="Personnes qui regardent la partie">
              👀 {room.spectators}
            </span>
          )}
        </div>
        <Scores game={game} />
        <div className="header-right">
          <ChatButton messages={messages} me={game.players[me]?.id ?? ''} muted={room.players[me]?.muted} />
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

      <div className={`felt ${celebrating ? 'shake' : ''}`}>
        {opponents.map(({ seat, index }) => (
          <Opponent
            key={index}
            game={game}
            index={index}
            seat={seat}
            connected={room.players[index]?.connected ?? true}
            bot={!!(room.players[index]?.bot || room.players[index]?.vacant)}
            away={room.players[index]?.away ?? false}
            look={room.players[index]}
            move={moves.get(index)}
            muted={room.players[index]?.muted ?? false}
            onMute={canModerate(index) ? () => void mute(room.players[index]!.id, !room.players[index]!.muted) : undefined}
            onKick={canModerate(index) ? () => void kick(room.players[index]!.id) : undefined}
          />
        ))}
        <CenterPile game={game} cut={cutShown} />
        {showExchange && !cutShown && <ExchangeRecap game={game} />}
      </div>

      {spectator ? (
        <section className="my-area spectating">
          <div className="my-bar">
            <div className="status">👀 Tu regardes la partie · {status}</div>
          </div>
        </section>
      ) : (
        <section className={`my-area ${myTurn || mustGive ? 'active' : ''}`}>
          {myAction && secondsLeft !== null && (
            <div className="turn-timer" aria-hidden>
              <div
                className={`turn-timer-fill ${secondsLeft <= 10 ? 'urgent' : ''}`}
                style={{ width: `${(100 * secondsLeft) / room.turnSeconds}%` }}
              />
            </div>
          )}
          <div className="my-bar">
            <div className="status">
              {(myTurn || mustGive) && <span className="dot" aria-hidden />}
              {status}
              {secondsLeft !== null && (
                <span
                  className={`countdown ${myAction && secondsLeft <= 10 ? 'urgent' : ''}`}
                  title={myAction ? 'À zéro, tu passes automatiquement' : 'Temps restant pour ce joueur'}
                >
                  ⏱ {secondsLeft} s
                </span>
              )}
              {myMove?.combination === null && game.phase === 'playing' && !myTurn && <span className="bubble inline">Tu as passé</span>}
            </div>
            <div className="my-tools">
              <span className="my-count">
                <strong>{hand.length}</strong> carte{hand.length > 1 ? 's' : ''}
              </span>
              <button className="link small" onClick={changeSort} title="Tu peux aussi glisser les cartes pour les ranger à ta façon">
                Trier par {sortMode === 'value' ? 'couleur' : 'valeur'}
              </button>
            </div>
          </div>

          <div
            className={`hand ${dealing ? 'dealing' : ''}`}
            style={{ '--count': hand.length, '--deal-delay': `${dealing?.delay ?? 0}ms` } as CSSProperties}
          >
            {hand.map((c, i) => (
              <CardView
                key={c.id}
                card={c}
                selected={selected.includes(c.id)}
                dimmed={playable !== null && !playable.has(c.id)}
                dragging={dragging === c.id}
                onClick={() => toggle(c)}
                style={{ '--offset': i - mid, '--i': i } as CSSProperties}
                handlers={{
                  onPointerDown: (e) => onPointerDown(e, c),
                  onPointerMove,
                  onPointerUp,
                  onPointerCancel: onPointerUp,
                }}
              />
            ))}
          </div>

          <div className="controls" hidden={roundFinished}>
            <span className={`hint ${typeof hint === 'object' ? (hint.ok ? 'ok' : 'bad') : ''}`}>
              {typeof hint === 'object' ? hint.text : hint}
            </span>
            {mustGive ? (
              <button
                className="primary"
                disabled={selected.length !== 1}
                onClick={() => send(socket.emitWithAck('game:giveCard', { cardId: selected[0]! }))}
              >
                Donner
              </button>
            ) : (
              <>
                {selected.length > 0 && !planned && (
                  <button className="ghost" onClick={() => setSelected([])}>
                    Annuler
                  </button>
                )}
                {myTurn ? (
                  <>
                    <button disabled={!game.table} onClick={() => send(socket.emitWithAck('game:pass'))}>
                      Passer
                    </button>
                    <button
                      className="primary"
                      disabled={selected.length === 0}
                      onClick={() => send(socket.emitWithAck('game:play', { cardIds: selected }))}
                    >
                      Jouer
                    </button>
                  </>
                ) : planned ? (
                  <button className="ghost" onClick={() => setPlanned(null)}>
                    Annuler {planned.type === 'pass' ? 'la passe prévue' : 'le coup prévu'}
                  </button>
                ) : (
                  // Pas encore son tour : on prépare son coup (ou sa passe), joué dès que le tour arrive.
                  <>
                    <button
                      disabled={!canPlan}
                      onClick={() => {
                        setSelected([]);
                        setPlanned({ type: 'pass', round: game.round, trickLength: game.trick.length });
                      }}
                      title="Passer automatiquement quand ce sera ton tour"
                    >
                      Passer à mon tour
                    </button>
                    <button
                      className="primary"
                      disabled={!canPlan || typeof hint !== 'object' || !hint.ok}
                      onClick={() => setPlanned({ type: 'play', cardIds: selected, round: game.round, trickLength: game.trick.length })}
                      title="Jouer ces cartes automatiquement quand ce sera ton tour"
                    >
                      Jouer à mon tour
                    </button>
                  </>
                )}
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
      {gang && celebrating && <GangBurst label={gang.label} player={gang.player} />}
      <TurnBanner key={bannerText ? turnKey : 'none'} text={planned || celebrating || cutShown ? null : bannerText} />
      {showSummary && game.lastRound && <RoundOver game={game} onExit={exit} />}
    </main>
  );
}
