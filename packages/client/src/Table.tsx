import { type Card, type PlayerView, analyzeCombination, canBeat } from '@gof/engine';
import { useEffect, useMemo, useState } from 'react';
import type { RoomView } from '../../server/src/protocol';
import { CardView } from './CardView';
import { cardLabel, combinationLabel, errorLabel } from './labels';
import { socket } from './socket';

type Seat = 'right' | 'top' | 'left';

/** Place les adversaires autour de la table : le suivant (sens antihoraire) à droite, puis en face, puis à gauche. */
function seatsFor(count: number): Seat[] {
  return count === 3 ? ['right', 'left'] : ['right', 'top', 'left'];
}

function Opponent({ game, index, seat, connected }: { game: PlayerView; index: number; seat: Seat; connected: boolean }) {
  const p = game.players[index]!;
  const active = game.phase === 'playing' && game.currentPlayer === index;
  return (
    <div className={`opponent seat-${seat} ${active ? 'active' : ''} ${connected ? '' : 'offline'}`}>
      <div className="opponent-name">
        {p.name}
        {!connected && <span className="tag">déconnecté</span>}
      </div>
      <div className="card-backs" aria-label={`${p.cardCount} cartes`}>
        {Array.from({ length: Math.min(p.cardCount, 16) }, (_, i) => (
          <span key={i} className="card-back" />
        ))}
      </div>
      <div className="opponent-meta">
        {p.cardCount} carte{p.cardCount > 1 ? 's' : ''} · {p.score} pt{p.score > 1 ? 's' : ''}
        {p.cardCount === 1 && game.phase === 'playing' && <span className="last-card">Carte !</span>}
      </div>
    </div>
  );
}

function Scoreboard({ game }: { game: PlayerView }) {
  return (
    <aside className="scoreboard">
      <h3>Manche {game.round}</h3>
      <ol>
        {game.players.map((p, i) => (
          <li key={p.id} className={i === game.you ? 'me' : ''}>
            <span>{p.name}</span>
            <strong>{p.score}</strong>
          </li>
        ))}
      </ol>
      <p className="muted small-text">Partie en 100 points, le plus petit score gagne.</p>
    </aside>
  );
}

function RoundOver({ game, onExit }: { game: PlayerView; onExit: () => void }) {
  const r = game.lastRound!;
  const over = game.phase === 'gameOver';
  const ranking = game.players.map((p, i) => ({ ...p, i })).sort((a, b) => a.score - b.score);
  return (
    <div className="overlay">
      <div className="panel modal">
        <h2>{over ? 'Partie terminée !' : `${game.players[r.winnerIndex]!.name} remporte la manche`}</h2>
        {over && <p className="winner">🏆 {game.winners.map((i) => game.players[i]!.name).join(' et ')}</p>}
        <table className="results">
          <thead>
            <tr>
              <th>Joueur</th>
              <th>Manche</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((p) => (
              <tr key={p.id} className={p.i === game.you ? 'me' : ''}>
                <td>{p.name}</td>
                <td>+{r.penalties[p.i]}</td>
                <td>{p.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {over ? (
          <button className="primary" onClick={onExit}>
            Retour à l'accueil
          </button>
        ) : (
          <>
            <p className="muted">
              {game.players[r.loserIndex]!.name} donnera sa meilleure carte à {game.players[r.winnerIndex]!.name}.
            </p>
            <button className="primary" onClick={() => socket.emitWithAck('game:nextRound')}>
              Manche suivante
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Table({ game, room, onLeave }: { game: PlayerView; room: RoomView; onLeave: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');

  // La main change à chaque coup : on oublie la sélection des cartes qui ne sont plus là.
  useEffect(() => {
    setSelected((s) => s.filter((id) => game.hand.some((c) => c.id === id)));
  }, [game.hand]);
  useEffect(() => setError(''), [game.currentPlayer, game.phase]);

  const me = game.you;
  const n = game.players.length;
  const myTurn = game.phase === 'playing' && game.currentPlayer === me;
  const exchange = game.exchange;
  const mustGive = game.phase === 'exchange' && exchange?.winnerIndex === me;
  const selectedCards = selected.map((id) => game.hand.find((c) => c.id === id)).filter((c): c is Card => !!c);

  const hint = useMemo(() => {
    if (mustGive) return selectedCards.length === 1 ? `Donner ${cardLabel(selectedCards[0]!)}` : 'Choisis une carte à donner';
    if (selectedCards.length === 0) return myTurn ? (game.table ? 'Choisis tes cartes ou passe' : 'À toi d\'ouvrir le pli') : '';
    const combo = analyzeCombination(selectedCards);
    if (!combo) return 'Combinaison invalide';
    const label = combinationLabel(combo.type, combo.cards.length);
    if (game.table && !canBeat(combo, game.table.combination)) return `${label} : trop faible`;
    return label;
  }, [selectedCards, myTurn, mustGive, game.table]);

  function toggle(card: Card) {
    setError('');
    if (mustGive) return setSelected([card.id]);
    setSelected((s) => (s.includes(card.id) ? s.filter((id) => id !== card.id) : [...s, card.id]));
  }

  async function send(result: Promise<{ ok: true } | { ok: false; error: string }>) {
    const r = await result;
    if (r.ok) setSelected([]);
    else setError(errorLabel(r.error));
  }

  async function exit() {
    await socket.emitWithAck('room:leave');
    onLeave();
  }

  function leave() {
    if (confirm('Quitter la partie ? Les autres joueurs ne pourront plus la terminer sans toi.')) void exit();
  }

  const opponents = seatsFor(n).map((seat, k) => ({ seat, index: (me + k + 1) % n }));
  const current = game.players[game.currentPlayer]!;
  const tablePlayer = game.table ? game.players[game.table.playerIndex]! : null;

  let status: string;
  if (game.phase === 'exchange') {
    status = mustGive
      ? `Tu as reçu ${cardLabel(exchange!.loserCard)} de ${game.players[exchange!.loserIndex]!.name}. Choisis une carte à lui rendre.`
      : `${game.players[exchange!.loserIndex]!.name} a donné ${cardLabel(exchange!.loserCard)} à ${game.players[exchange!.winnerIndex]!.name}, qui choisit une carte à rendre…`;
  } else if (game.phase !== 'playing') {
    status = 'Fin de la manche';
  } else if (myTurn) {
    status = game.mustPlayMultiOne ? 'À toi ! Ouvre la partie avec le 1 multicolore.' : 'À toi de jouer !';
  } else {
    status = `${current.name} réfléchit…`;
  }

  return (
    <main className={`table-screen players-${n}`}>
      <header className="table-header">
        <span>
          Salon <strong>{room.code}</strong> · Sens {game.direction === 1 ? '↺ antihoraire' : '↻ horaire'}
        </span>
        <button className="link" onClick={leave}>
          Quitter
        </button>
      </header>

      <div className="felt">
        {opponents.map(({ seat, index }) => (
          <Opponent key={index} game={game} index={index} seat={seat} connected={room.players[index]?.connected ?? true} />
        ))}

        <div className="center-pile">
          {game.table && tablePlayer ? (
            <>
              <div className="pile-label">
                {tablePlayer.name} · {combinationLabel(game.table.combination.type, game.table.combination.cards.length)}
              </div>
              <div className="pile-cards">
                {game.table.combination.cards.map((c) => (
                  <CardView key={c.id} card={c} small />
                ))}
              </div>
            </>
          ) : (
            <div className="pile-empty">{game.phase === 'playing' ? `${current.name} ouvre un nouveau pli` : ''}</div>
          )}
          {exchange?.winnerCard && game.phase === 'playing' && game.table === null && (
            <p className="muted small-text">
              Échange : {game.players[exchange.loserIndex]!.name} a donné {cardLabel(exchange.loserCard)},{' '}
              {game.players[exchange.winnerIndex]!.name} a rendu {cardLabel(exchange.winnerCard)}.
            </p>
          )}
        </div>
      </div>

      <section className={`my-area ${myTurn || mustGive ? 'active' : ''}`}>
        <div className="status">{status}</div>
        <div className="hand">
          {game.hand.map((c) => (
            <CardView key={c.id} card={c} selected={selected.includes(c.id)} onClick={() => toggle(c)} />
          ))}
        </div>
        <div className="controls">
          <span className="hint">{hint}</span>
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
        {error && <p className="error">{error}</p>}
      </section>

      <Scoreboard game={game} />
      {(game.phase === 'roundOver' || game.phase === 'gameOver') && game.lastRound && (
        <RoundOver game={game} onExit={exit} />
      )}
    </main>
  );
}
