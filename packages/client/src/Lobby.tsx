import { useState } from 'react';
import type { RoomView, Session } from '../../server/src/protocol';
import { errorLabel } from './labels';
import { socket } from './socket';

/** Scores de fin de partie proposés à l'hôte (le serveur accepte les mêmes). */
const TARGET_SCORES = [50, 100, 200];

export function Lobby({ room, session, onLeave }: { room: RoomView; session: Session; onLeave: () => void }) {
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [targetScore, setTargetScore] = useState(100);
  const isHost = room.hostId === session.playerId;
  const link = `${location.origin}${location.pathname}?salon=${room.code}`;

  async function start() {
    const result = await socket.emitWithAck('game:start', { targetScore });
    if (!result.ok) setError(errorLabel(result.error));
  }

  async function addBot() {
    const result = await socket.emitWithAck('room:addBot');
    if (!result.ok) setError(errorLabel(result.error));
  }

  async function removeBot(botId: string) {
    const result = await socket.emitWithAck('room:removeBot', { botId });
    if (!result.ok) setError(errorLabel(result.error));
  }

  async function leave() {
    await socket.emitWithAck('room:leave');
    onLeave();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copie impossible, partage le code à la main.');
    }
  }

  return (
    <main className="lobby">
      <div className="panel">
        <p className="muted">Code du salon</p>
        <div className="room-code">{room.code}</div>
        <button onClick={copy}>{copied ? 'Lien copié !' : 'Copier le lien d\'invitation'}</button>

        <h2>Joueurs ({room.players.length}/4)</h2>
        <ul className="player-list">
          {room.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'offline'}>
              <span className="avatar" aria-hidden>
                {p.bot ? '🤖' : p.name.slice(0, 2).toUpperCase()}
              </span>
              {p.name}
              {p.bot && <span className="tag">bot</span>}
              {p.id === room.hostId && <span className="tag">hôte</span>}
              {p.id === session.playerId && <span className="tag you">toi</span>}
              {p.bot && isHost && (
                <button className="remove-bot" aria-label={`Retirer ${p.name}`} onClick={() => removeBot(p.id)}>
                  ✕
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: 4 - room.players.length }, (_, i) => (
            <li key={`empty-${i}`} className="empty">
              En attente…
            </li>
          ))}
        </ul>
        {isHost && room.players.length < 4 && (
          <button onClick={addBot}>🤖 Ajouter un bot</button>
        )}

        {isHost && (
          <div className="target-score">
            <span className="muted">Partie en</span>
            <div className="segmented" role="radiogroup" aria-label="Score de fin de partie">
              {TARGET_SCORES.map((score) => (
                <button
                  key={score}
                  role="radio"
                  aria-checked={targetScore === score}
                  className={targetScore === score ? 'on' : ''}
                  onClick={() => setTargetScore(score)}
                >
                  {score} pts
                </button>
              ))}
            </div>
          </div>
        )}
        {isHost ? (
          <button className="primary" disabled={room.players.length < 3} onClick={start}>
            {room.players.length < 3 ? 'Il faut au moins 3 joueurs' : 'Lancer la partie'}
          </button>
        ) : (
          <p className="muted">L'hôte lancera la partie dès que tout le monde est là.</p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={leave}>
          Quitter le salon
        </button>
      </div>
    </main>
  );
}
