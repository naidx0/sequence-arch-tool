/* ══════════════════════════════════════════════════════════════════════════
   THE CHAT HEADER NAMES THE CHAT, NOT THE AGENT (round 9)
   packages/web2/src/chat/ChatTitle.tsx

   Jaden: "It just says Claude at the top of the chat... the Claude model is
   already specified bottom right, it shouldn't be top left as well... rename
   the chat to whatever's happening in the chat."

   The header shows the chat's title: the server's (auto-titled from the work
   once the agents builder lands that), the person's rename, or "New chat".
   A click turns it into a field; Enter or leaving the field saves, Escape
   puts it back. The model stays in the composer's model pill only.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SessionIndexEntry } from '@sequence/api-types';
import { useEffect, useRef, useState } from 'react';

import { createSessionsClient, type SessionsClient } from '../sessions/sessionsClient';
import { useAppState, useStore } from '../state';
import './r9.css';

const ID_DERIVED_TITLE = /^session[ -]\d+[\w-]*$/i;

/** What the header says for a chat: its title, or "New chat" for none (or an id-shaped placeholder). */
export function chatTitleOf(entry: Pick<SessionIndexEntry, 'title' | 'titleEdited'> | null | undefined): string {
  const written = entry?.title?.trim();
  if (!written) return 'New chat';
  if (!entry?.titleEdited && ID_DERIVED_TITLE.test(written)) return 'New chat';
  return written;
}

let shared: SessionsClient | null = null;
const defaultClient = (): SessionsClient => (shared ??= createSessionsClient());

export function ChatTitle({ client }: { client?: SessionsClient } = {}) {
  const state = useAppState();
  const store = useStore();
  const id = state.session.activeId;
  const entry = state.session.sessions.find((s) => s.id === id) ?? null;
  const title = chatTitleOf(entry);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(new Set<string>());
  const [saving, setSaving] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  useEffect(() => setEditing(false), [id]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  async function commit(): Promise<void> {
    setEditing(false);
    const next = draft.trim();
    if (!id || !next || next === title || pending.current.has(id)) return;
    pending.current.add(id);
    setSaving(id);
    setFailure(null);
    const before = store.getState();
    const original = before.session.sessions.find(s => s.id === id);
    if (!original) { pending.current.delete(id); setSaving(null); return; }
    /* Shown at once; the server's index replaces it when it answers. */
    store.dispatch({ type: 'session/index', sessions: before.session.sessions.map((s) => (s.id === id ? { ...s, title: next, titleEdited: true } : s)), activeId: before.session.activeId });
    const replace = (saved: Pick<SessionIndexEntry, 'title' | 'titleEdited'>) => {
      const current = store.getState();
      store.dispatch({ type: 'session/index', sessions: current.session.sessions.map(s => s.id === id && s.title === next && s.titleEdited
        ? { ...s, title: saved.title, titleEdited: saved.titleEdited } : s), activeId: current.session.activeId });
    };
    try {
      const res = await (client ?? defaultClient()).update(id, { title: next });
      if (res.outcome === 'error') throw new Error(res.message);
      // A whole server index may be stale by the time this request returns.
      const saved = res.body.index?.sessions.find(s => s.id === id);
      if (saved) replace(saved);
    } catch (error) {
      replace(original);
      if (live.current) setFailure({ id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      pending.current.delete(id);
      if (live.current) setSaving(current => current === id ? null : current);
    }
  }

  if (editing) {
    return (
      <input
        ref={input}
        className="r9-title-input s2-grow"
        data-testid="chat-title-input"
        aria-label="Chat name"
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(title);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span className="r9-title-wrap s2-grow">
    <button
      type="button"
      className="r9-title s2-grow"
      data-testid="chat-title"
      data-placeholder={title === 'New chat' || undefined}
      title="Rename this chat"
      aria-label={`Rename chat: ${title}`}
      disabled={!id || saving === id}
      aria-busy={saving === id || undefined}
      onClick={() => {
        setDraft(title);
        setEditing(true);
      }}
    >
      <span className="r9-title-text">{title}</span>
      <svg className="r9-title-pen" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </button>
    {failure?.id === id ? <span role="alert" className="r9-title-error">Could not rename chat: {failure.message}</span> : null}
    </span>
  );
}
