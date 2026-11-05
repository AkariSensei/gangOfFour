import { ChevronUp } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type { IdeaView } from '../../server/src/protocol';
import { wallText } from '../../server/src/wallText';
import { errorLabel } from './labels';
import { socket } from './socket';

const STATUS_LABELS: Record<IdeaView['status'], string> = {
  new: 'Nouveau',
  planned: 'Prévu',
  done: 'Fait',
  declined: 'Pas pour l’instant',
};
const KIND_LABELS: Record<IdeaView['kind'], string> = { idea: 'Idée', bug: 'Bug' };
const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

type Filter = 'all' | IdeaView['kind'];

/** Le mur, rechargé dès que quelqu'un y change quelque chose. */
function useIdeas(): IdeaView[] | null {
  const [ideas, setIdeas] = useState<IdeaView[] | null>(null);
  useEffect(() => {
    const load = async () => {
      const result = await socket.emitWithAck('community:list');
      if (result.ok) setIdeas(result.ideas);
    };
    void load();
    socket.on('community:changed', load);
    socket.on('connect', load);
    return () => {
      socket.off('community:changed', load);
      socket.off('connect', load);
    };
  }, []);
  return ideas;
}

/**
 * Écran « Communauté » : le mur des idées et des bugs. Chacun propose, vote pour ce qu'il veut voir arriver et commente ;
 * l'admin indique où en est chaque demande.
 */
export function CommunityScreen({ admin }: { admin: boolean }) {
  const ideas = useIdeas();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function run(action: Promise<{ ok: true } | { ok: false; error: string }>) {
    setError('');
    const result = await action;
    if (!result.ok) setError(errorLabel(result.error));
    return result.ok;
  }

  const shown = (ideas ?? []).filter((i) => filter === 'all' || i.kind === filter);
  return (
    <div className="community">
      <NewIdea onPost={(kind, title, text) => run(socket.emitWithAck('community:post', { kind, title, text }))} />
      <div className="community-head">
        <h2>Le mur</h2>
        <div className="segmented" role="tablist" aria-label="Filtrer">
          {(
            [
              ['all', 'Tout'],
              ['idea', 'Idées'],
              ['bug', 'Bugs'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {ideas === null && <p className="muted">Chargement…</p>}
      {ideas && shown.length === 0 && <p className="muted">Rien pour l’instant : lance la première idée</p>}
      <ul className="ideas">
        {shown.map((idea) => (
          <li key={idea.id} className={`idea status-${idea.status}`}>
            <button
              type="button"
              className={`vote ${idea.voted ? 'on' : ''}`}
              aria-pressed={idea.voted}
              aria-label={idea.voted ? `Retirer mon vote (${idea.votes})` : `Voter pour (${idea.votes})`}
              onClick={() => void run(socket.emitWithAck('community:vote', { id: idea.id, on: !idea.voted }))}
            >
              <ChevronUp aria-hidden />
              <strong>{idea.votes}</strong>
            </button>
            <div className="idea-body">
              <button type="button" className="idea-title" aria-expanded={open === idea.id} onClick={() => setOpen(open === idea.id ? null : idea.id)}>
                {idea.title}
              </button>
              <div className="idea-meta">
                <span className={`idea-kind kind-${idea.kind}`}>{KIND_LABELS[idea.kind]}</span>
                <span className={`idea-status status-${idea.status}`}>{STATUS_LABELS[idea.status]}</span>
                <span className="muted">
                  {idea.author} · {dateFormat.format(new Date(idea.createdAt))}
                  {idea.comments.length > 0 && ` · ${idea.comments.length} commentaire${idea.comments.length > 1 ? 's' : ''}`}
                </span>
              </div>
              {open === idea.id && (
                <IdeaDetails
                  idea={idea}
                  admin={admin}
                  onComment={(text) => run(socket.emitWithAck('community:comment', { id: idea.id, text }))}
                  onStatus={(status) => void run(socket.emitWithAck('community:status', { id: idea.id, status }))}
                  onRemove={(commentId) => {
                    if (!commentId && !confirm('Retirer cette idée du mur ?')) return;
                    void run(socket.emitWithAck('community:remove', { id: idea.id, ...(commentId ? { commentId } : {}) }));
                  }}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Proposer une idée ou signaler un bug. */
function NewIdea({ onPost }: { onPost: (kind: IdeaView['kind'], title: string, text: string) => Promise<boolean> }) {
  const [kind, setKind] = useState<IdeaView['kind']>('idea');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onPost(kind, title, text);
    setBusy(false);
    if (ok) {
      setTitle('');
      setText('');
    }
  }

  return (
    <form className="panel new-idea" onSubmit={submit}>
      <div className="new-idea-head">
        <h2>Une idée, un bug ?</h2>
        <div className="segmented" role="radiogroup" aria-label="Type">
          {(['idea', 'bug'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(wallText(e.target.value))}
        maxLength={80}
        placeholder={kind === 'idea' ? 'Ton idée en une phrase' : 'Le problème en une phrase'}
        aria-label="Titre"
      />
      <textarea
        value={text}
        onChange={(e) => setText(wallText(e.target.value, true))}
        maxLength={1000}
        rows={3}
        placeholder={kind === 'idea' ? 'Les détails, si tu veux' : 'Ce que tu faisais, sur quel appareil, ce qui s’est passé…'}
        aria-label="Détails"
      />
      <p className="muted small new-idea-note">Lettres, chiffres et ponctuation simple : les symboles et les dessins en caractères ne passent pas</p>
      <button type="submit" className="primary" disabled={busy || !title.trim()}>
        Publier
      </button>
    </form>
  );
}

/** Le détail d'une idée : son texte, ses commentaires, et pour l'admin de quoi changer son statut. */
function IdeaDetails({
  idea,
  admin,
  onComment,
  onStatus,
  onRemove,
}: {
  idea: IdeaView;
  admin: boolean;
  onComment: (text: string) => Promise<boolean>;
  onStatus: (status: IdeaView['status']) => void;
  onRemove: (commentId?: string) => void;
}) {
  const [text, setText] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onComment(text)) setText('');
  }

  return (
    <div className="idea-details">
      {idea.text && <p className="idea-text">{idea.text}</p>}
      {idea.comments.length > 0 && (
        <ul className="idea-comments">
          {idea.comments.map((c) => (
            <li key={c.id}>
              <strong>{c.author}</strong> <span className="muted small">{dateFormat.format(new Date(c.at))}</span>
              <p>{c.text}</p>
              {admin && (
                <button type="button" className="link small" onClick={() => onRemove(c.id)}>
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="idea-reply" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(wallText(e.target.value))} maxLength={500} placeholder="Ajouter un commentaire" aria-label="Commentaire" />
        <button type="submit" disabled={!text.trim()}>
          Envoyer
        </button>
      </form>
      {(admin || idea.mine) && (
        <div className="idea-admin">
          {admin && (
            <label>
              Statut{' '}
              <select value={idea.status} onChange={(e) => onStatus(e.target.value as IdeaView['status'])}>
                {(Object.keys(STATUS_LABELS) as IdeaView['status'][]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="danger" onClick={() => onRemove()}>
            Retirer l’idée
          </button>
        </div>
      )}
    </div>
  );
}
