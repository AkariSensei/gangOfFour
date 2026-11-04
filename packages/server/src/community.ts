import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IdeaView, RoomError } from './protocol';

/**
 * Le mur de la communauté : chacun y poste une idée ou un bug, les autres votent et commentent, l'admin indique où en
 * est chaque demande. Gardé dans un fichier JSON (ou en mémoire sans fichier).
 */
export type IdeaKind = 'idea' | 'bug';
export type IdeaStatus = 'new' | 'planned' | 'done' | 'declined';
export const IDEA_STATUSES: IdeaStatus[] = ['new', 'planned', 'done', 'declined'];

export interface Idea {
  id: string;
  kind: IdeaKind;
  title: string;
  text: string;
  author: string;
  createdAt: string;
  status: IdeaStatus;
  /** Comptes qui ont voté pour. */
  votes: string[];
  comments: { id: string; author: string; text: string; at: string }[];
}

export const TITLE_MAX = 80;
export const TEXT_MAX = 1000;
export const COMMENT_MAX = 500;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: RoomError };

/** Texte propre : sans caractères de contrôle (les retours à la ligne restent), coupé à la longueur permise. */
function clean(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string') return '';
  const kept = multiline ? value.replace(/[^\P{C}\n]/gu, '') : value.replace(/\p{C}/gu, '');
  return kept.trim().slice(0, max);
}

export class CommunityStore {
  private ideas: Idea[] = [];

  constructor(private file?: string) {
    if (!file) return;
    try {
      this.ideas = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      this.ideas = [];
    }
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.ideas, null, 1));
      renameSync(tmp, this.file);
    } catch (error) {
      console.error("Impossible d'enregistrer la communauté :", error);
    }
  }

  get(id: unknown): Idea | undefined {
    return typeof id === 'string' ? this.ideas.find((i) => i.id === id) : undefined;
  }

  /**
   * Le mur vu par un joueur, le plus voté d'abord (les demandes faites ou refusées en dernier). `name` donne le pseudo
   * actuel d'un compte.
   */
  view(viewer: string | undefined, name: (account: string) => string): IdeaView[] {
    const closed = (i: Idea) => (i.status === 'done' || i.status === 'declined' ? 1 : 0);
    return [...this.ideas]
      .sort((a, b) => closed(a) - closed(b) || b.votes.length - a.votes.length || b.createdAt.localeCompare(a.createdAt))
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        text: i.text,
        author: name(i.author),
        mine: i.author === viewer,
        createdAt: i.createdAt,
        status: i.status,
        votes: i.votes.length,
        voted: !!viewer && i.votes.includes(viewer),
        comments: i.comments.map((c) => ({ id: c.id, author: name(c.author), text: c.text, at: c.at })),
      }));
  }

  post(author: string, kind: unknown, title: unknown, text: unknown, now = new Date()): Result<{ idea: Idea }> {
    const cleanTitle = clean(title, TITLE_MAX);
    if (!cleanTitle) return { ok: false, error: 'emptyMessage' };
    const idea: Idea = {
      id: randomUUID(),
      kind: kind === 'bug' ? 'bug' : 'idea',
      title: cleanTitle,
      text: clean(text, TEXT_MAX, true),
      author,
      createdAt: now.toISOString(),
      status: 'new',
      // On vote d'office pour sa propre idée.
      votes: [author],
      comments: [],
    };
    this.ideas.push(idea);
    this.save();
    return { ok: true, idea };
  }

  vote(account: string, id: unknown, on: boolean): Result {
    const idea = this.get(id);
    if (!idea) return { ok: false, error: 'ideaNotFound' };
    idea.votes = idea.votes.filter((v) => v !== account);
    if (on) idea.votes.push(account);
    this.save();
    return { ok: true };
  }

  comment(author: string, id: unknown, text: unknown, now = new Date()): Result {
    const idea = this.get(id);
    if (!idea) return { ok: false, error: 'ideaNotFound' };
    const body = clean(text, COMMENT_MAX, true);
    if (!body) return { ok: false, error: 'emptyMessage' };
    idea.comments.push({ id: randomUUID(), author, text: body, at: now.toISOString() });
    this.save();
    return { ok: true };
  }

  /** L'admin indique où en est une demande. */
  setStatus(id: unknown, status: unknown): Result {
    const idea = this.get(id);
    if (!idea) return { ok: false, error: 'ideaNotFound' };
    if (!IDEA_STATUSES.includes(status as IdeaStatus)) return { ok: false, error: 'invalidStatus' };
    idea.status = status as IdeaStatus;
    this.save();
    return { ok: true };
  }

  /** Retire une idée (son auteur ou l'admin), ou un commentaire (son auteur ou l'admin). */
  remove(account: string, admin: boolean, id: unknown, commentId?: unknown): Result {
    const idea = this.get(id);
    if (!idea) return { ok: false, error: 'ideaNotFound' };
    if (commentId !== undefined) {
      const comment = idea.comments.find((c) => c.id === commentId);
      if (!comment) return { ok: false, error: 'ideaNotFound' };
      if (!admin && comment.author !== account) return { ok: false, error: 'notAdmin' };
      idea.comments = idea.comments.filter((c) => c !== comment);
    } else {
      if (!admin && idea.author !== account) return { ok: false, error: 'notAdmin' };
      this.ideas = this.ideas.filter((i) => i !== idea);
    }
    this.save();
    return { ok: true };
  }
}
