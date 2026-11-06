import { VolumeX, X } from 'lucide-react';
import { useState } from 'react';
import type { BotLevel, ChatMessage, RoomView, Session } from '../../server/src/protocol';
import { Avatar } from './Avatar';
import { HiveLoader } from './Bee';
import { ChatPanel, KickButton, MuteButton } from './Chat';
import { TIME_CONTROLS } from '@gof/engine';
import { LEVEL_LABELS, errorLabel } from './labels';
import { socket } from './socket';

/** Scores de fin de partie de Gang of Four proposés à l'hôte (le serveur accepte les mêmes). */
const TARGET_SCORES = [50, 100, 200];
/** Places du salon selon le jeu : le minimum pour lancer, et le maximum. */
const SEAT_COUNTS: Record<RoomView['game'], { min: number; max: number; name: string }> = {
  gof: { min: 3, max: 4, name: 'Gang of Four' },
  slots: { min: 2, max: 2, name: 'Duel Jackpot' },
  battleship: { min: 2, max: 2, name: 'Bataille navale' },
  reversi: { min: 2, max: 2, name: 'Reversi' },
  chess: { min: 2, max: 2, name: 'Échecs' },
};
/** Temps par tour proposés (0 : pas de minuteur). */
const TURN_SECONDS = [0, 30, 60];
/** Emplacement des quatre places autour de la table, dans l'ordre d'arrivée à partir de la sienne. */
const SEATS = ['bottom', 'left', 'top', 'right'] as const;
/** Niveaux de bot proposés à l'hôte. */
const BOT_LEVELS = Object.entries(LEVEL_LABELS) as [BotLevel, string][];

export function Lobby({
  room,
  session,
  messages,
  admin,
  felt,
  onLeave,
}: {
  room: RoomView;
  session: Session;
  messages: ChatMessage[];
  /** L'admin peut, comme l'hôte, couper le chat d'un joueur. */
  admin: boolean;
  /** Couleur de tapis choisie par le joueur, la même que sur la table. */
  felt?: string;
  onLeave: () => void;
}) {
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [targetScore, setTargetScore] = useState(100);
  const counts = SEAT_COUNTS[room.game] ?? SEAT_COUNTS.gof;
  const maxSeats = counts.max;
  const gof = room.game === 'gof';
  const [turnSeconds, setTurnSeconds] = useState(0);
  const chess = room.game === 'chess';
  const [timeControl, setTimeControl] = useState('5+0');
  const isHost = room.hostId === session.playerId;
  // Places dans l'ordre d'arrivée, en commençant par la sienne (en bas) ; les places vides restent à la fin.
  const mine = Math.max(0, room.players.findIndex((p) => p.id === session.playerId));
  const seated = [...room.players.slice(mine), ...room.players.slice(0, mine)];
  const seats = Array.from({ length: maxSeats }, (_, i) => seated[i]);
  // Au-delà de quatre, les places ne tiennent plus autour du tapis : elles s'alignent en dessous.
  // À deux, on se fait face : sa place en bas, l'adversaire en haut.
  const at = (i: number) => (maxSeats > 4 ? 'list' : maxSeats === 2 ? (['bottom', 'top'] as const)[i] : SEATS[i]);
  const link = `${location.origin}${location.pathname}?salon=${room.code}`;

  async function start() {
    const result = await socket.emitWithAck('game:start', gof ? { targetScore, turnSeconds } : chess ? { timeControl } : { turnSeconds });
    if (!result.ok) setError(errorLabel(result.error));
  }

  async function addBot(level: BotLevel) {
    const result = await socket.emitWithAck('room:addBot', { level });
    if (!result.ok) setError(errorLabel(result.error));
  }

  async function removeBot(botId: string) {
    const result = await socket.emitWithAck('room:removeBot', { botId });
    if (!result.ok) setError(errorLabel(result.error));
  }

  async function mute(playerId: string, muted: boolean) {
    const result = await socket.emitWithAck('room:mute', { playerId, muted });
    if (!result.ok) setError(errorLabel(result.error));
  }

  async function kick(playerId: string) {
    const result = await socket.emitWithAck('room:kick', { playerId });
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
    <main className={`lobby game-${room.game} felt-${felt || 'vert'}`}>
      <div className="panel">
        {/* La table vue de dessus : sa propre place en bas, les autres autour, le code du salon sur le tapis. */}
        <div className={`lobby-table ${maxSeats > 4 ? 'many' : ''}`}>
          <div className="lobby-felt">
            <p className="lobby-game">
              {counts.name}
              {room.training && ' · entraînement'}
            </p>
            <p className="muted">Code du salon</p>
            <div className="room-code">{room.code}</div>
            <button onClick={copy}>{copied ? 'Lien copié' : "Copier le lien d'invitation"}</button>
            <h2>
              Joueurs ({room.players.length}/{maxSeats})
            </h2>
          </div>
          <ul className="lobby-seats">
            {seats.map((p, i) =>
              p ? (
                <li key={p.id} className={`lobby-seat at-${at(i)} ${p.connected ? '' : 'offline'}`}>
                  <Avatar name={p.name} look={p} bot={p.bot} />
                  <span className="lobby-seat-name">{p.name}</span>
                  {p.title && <span className="seat-title">{p.title}</span>}
                  <span className="lobby-seat-tags">
                    {p.bot && <span className={`tag level-${p.level ?? 'normal'}`}>bot {LEVEL_LABELS[p.level ?? 'normal'].toLowerCase()}</span>}
                    {p.id === room.hostId && <span className="tag">hôte</span>}
                    {p.id === session.playerId && <span className="tag you">toi</span>}
                    {(isHost || admin) && !p.bot && p.id !== session.playerId ? (
                      <>
                        <MuteButton name={p.name} muted={p.muted} onClick={() => mute(p.id, !p.muted)} />
                        <KickButton name={p.name} onKick={() => kick(p.id)} />
                      </>
                    ) : (
                      p.muted && (
                        <span className="tag" title="Chat coupé">
                          <VolumeX />
                        </span>
                      )
                    )}
                    {p.bot && isHost && (
                      <button className="remove-bot" aria-label={`Retirer ${p.name}`} onClick={() => removeBot(p.id)}>
                        <X />
                      </button>
                    )}
                  </span>
                </li>
              ) : (
                <li key={`libre-${i}`} className={`lobby-seat empty at-${at(i)}`}>
                  <span className="lobby-seat-name">Place libre</span>
                  {isHost && room.training ? (
                    <span className="bot-levels" role="group" aria-label="Ajouter un bot">
                      <small>Ajouter un bot</small>
                      {BOT_LEVELS.map(([level, label]) => (
                        <button key={level} className={`link small level-${level}`} onClick={() => addBot(level)}>
                          {label}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <span className="muted small">En attente d’un joueur…</span>
                  )}
                </li>
              ),
            )}
          </ul>
        </div>

        {isHost && gof && (
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
        {isHost && chess && (
          <div className="target-score">
            <span className="muted">Cadence</span>
            <div className="segmented wrap" role="radiogroup" aria-label="Cadence">
              {TIME_CONTROLS.map((c) => (
                <button key={c.id} role="radio" aria-checked={timeControl === c.id} className={timeControl === c.id ? 'on' : ''} onClick={() => setTimeControl(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {isHost && !chess && (
          <div className="target-score">
            <span className="muted">Temps par tour</span>
            <div className="segmented" role="radiogroup" aria-label="Temps par tour">
              {TURN_SECONDS.map((seconds) => (
                <button
                  key={seconds}
                  role="radio"
                  aria-checked={turnSeconds === seconds}
                  className={turnSeconds === seconds ? 'on' : ''}
                  onClick={() => setTurnSeconds(seconds)}
                >
                  {seconds === 0 ? 'Illimité' : `${seconds} s`}
                </button>
              ))}
            </div>
          </div>
        )}
        {room.players.length < counts.min && (
          <HiveLoader text={counts.min - room.players.length > 1 ? `En attente de ${counts.min - room.players.length} joueurs…` : 'En attente d’un joueur…'} />
        )}
        {!room.training && (
          <p className="muted small lobby-note">Le salon est visible dans les salons actifs : les collègues peuvent le rejoindre depuis la page du jeu.</p>
        )}
        {isHost ? (
          <button className="primary" disabled={room.players.length < counts.min} onClick={start}>
            {room.players.length < counts.min
              ? `En attente : il faut ${counts.min === counts.max ? '' : 'au moins '}${counts.min} joueurs (${room.players.length}/${counts.min})`
              : 'Lancer la partie'}
          </button>
        ) : (
          <p className="muted">L'hôte lancera la partie dès que tout le monde est là.</p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={leave}>
          Quitter le salon
        </button>
      </div>
      <div className="panel lobby-chat">
        <h2>Chat</h2>
        <ChatPanel messages={messages} me={session.playerId} muted={room.players.some((p) => p.id === session.playerId && p.muted)} />
      </div>
    </main>
  );
}
