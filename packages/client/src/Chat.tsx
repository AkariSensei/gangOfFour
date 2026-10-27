import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../server/src/protocol';
import { errorLabel } from './labels';
import { socket } from './socket';

/** Liste des messages du salon et champ pour écrire. */
export function ChatPanel({
  messages,
  me,
  muted = false,
  autoFocus = false,
}: {
  messages: ChatMessage[];
  me: string;
  /** L'hôte ou l'admin a coupé le chat de ce joueur. */
  muted?: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const list = useRef<HTMLOListElement>(null);

  // Toujours montrer le dernier message.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const result = await socket.emitWithAck('chat:send', { text });
    if (result.ok) {
      setText('');
      setError('');
    } else setError(errorLabel(result.error));
  }

  return (
    <div className="chat">
      <ol className="chat-list" ref={list}>
        {messages.length === 0 && <li className="chat-empty">Pas encore de message.</li>}
        {messages.map((m) => (
          <li key={m.id} className={m.playerId === me ? 'mine' : ''}>
            <span className="chat-name">{m.name}</span> {m.text}
          </li>
        ))}
      </ol>
      <form className="chat-form" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder={muted ? '🔇 Chat coupé' : 'Écrire un message…'}
          aria-label="Message"
          autoFocus={autoFocus}
          disabled={muted}
        />
        <button type="submit" disabled={muted || !text.trim()}>
          Envoyer
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Bouton du chat pendant la partie : compte les messages non lus et montre brièvement le dernier reçu. */
export function ChatButton({ messages, me, muted }: { messages: ChatMessage[]; me: string; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const [readCount, setReadCount] = useState(messages.length);
  const [preview, setPreview] = useState<ChatMessage | null>(null);
  const last = messages[messages.length - 1];

  useEffect(() => {
    if (open) setReadCount(messages.length);
  }, [open, messages.length]);

  // Un message d'un autre joueur, chat fermé : on l'affiche quelques secondes.
  useEffect(() => {
    if (!last || open || last.playerId === me) return;
    setPreview(last);
    const t = setTimeout(() => setPreview(null), 4000);
    return () => clearTimeout(t);
  }, [last?.id]);

  const unread = open ? 0 : messages.slice(readCount).filter((m) => m.playerId !== me).length;
  return (
    <div className="chat-anchor">
      <button className="icon" onClick={() => setOpen((o) => !o)} title="Chat du salon" aria-expanded={open}>
        💬{unread > 0 && <span className="chat-badge">{unread}</span>}
      </button>
      {open && (
        <div className="chat-popover panel">
          <ChatPanel messages={messages} me={me} muted={muted} autoFocus />
        </div>
      )}
      {!open && preview && (
        <button className="chat-preview" onClick={() => setOpen(true)}>
          <span className="chat-name">{preview.name}</span> {preview.text}
        </button>
      )}
    </div>
  );
}

/** Bouton de l'hôte ou de l'admin pour couper ou rendre le chat d'un joueur. */
export function MuteButton({ name, muted, onClick }: { name: string; muted: boolean; onClick: () => void }) {
  const label = muted ? `Rendre le chat à ${name}` : `Couper le chat de ${name}`;
  return (
    <button className={`mute ${muted ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={muted} onClick={onClick}>
      {muted ? '🔇' : '🔈'}
    </button>
  );
}

/** Bouton de l'hôte ou de l'admin pour exclure un joueur, après confirmation. */
export function KickButton({ name, onKick }: { name: string; onKick: () => void }) {
  return (
    <button
      className="kick"
      title={`Exclure ${name}`}
      aria-label={`Exclure ${name}`}
      onClick={() => confirm(`Exclure ${name} ? Un bot prendra sa place.`) && onKick()}
    >
      ✕
    </button>
  );
}
