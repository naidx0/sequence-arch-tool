/* ══════════════════════════════════════════════════════════════════════════
   BOARDS — the client half: fetch, write as ops, and hear about changes
   packages/web2/src/canvas/boards/boardsClient.ts

   One EventSource on `/api/boards/events` for the whole tab, opened by the
   first surface that listens and closed by the last. The server fires it on
   its own writes and when the boards folder changes on disk, which is how a
   shape the agent drew through the MCP (another process) appears with no
   reload (lab/specs/r8-boards.md §3).

   Which whiteboard is showing is a per-project choice kept in localStorage —
   the Whiteboard surface opens the board you were last on.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { WbItem } from '../../whiteboard/whiteboardModel';
import { onWorkspaceSwitched } from '../../sessions/workspaceEvents';
import { useActiveSessionIdIfAny } from '../../state/connect';
import type { BoardDoc, BoardMeta, BoardOp, BoardsIndex, LinkableBoards } from './boardsModel';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* the status is the message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

const headers = { 'content-type': 'application/json' };

/**
 * THE CHAT THESE CALLS ARE FOR. Spaces belong to a chat: the list is that chat's, a new Space is recorded in it, and
 * removing one removes it from it. Set by `useBoardsIndex` (every surface that lists boards uses it), so a caller that
 * only creates or removes needs no chat argument. Null (no chat open): the whole project, as before.
 */
let boardsChat: string | null = null;
const chatQuery = (chat: string | null): string => (chat ? `?chat=${encodeURIComponent(chat)}` : '');

export const boardsApi = {
  list: (chat: string | null = boardsChat) => fetch(`/api/boards${chatQuery(chat)}`).then((r) => json<BoardsIndex>(r)),
  linkable: (chat: string) => fetch(`/api/boards/linkable${chatQuery(chat)}`).then((r) => json<LinkableBoards>(r)),
  link: (id: string, chat: string) =>
    fetch(`/api/boards/${encodeURIComponent(id)}/link`, { method: 'POST', headers, body: JSON.stringify({ chat }) }).then((r) => json<BoardMeta>(r)),
  get: (id: string) => fetch(`/api/boards/${encodeURIComponent(id)}`).then((r) => json<BoardDoc>(r)),
  create: (name: string, chat: string | null = boardsChat) =>
    fetch('/api/boards', { method: 'POST', headers, body: JSON.stringify({ name, kind: 'whiteboard', ...(chat ? { chat } : {}) }) }).then((r) => json<BoardMeta>(r)),
  rename: (id: string, name: string) =>
    fetch(`/api/boards/${encodeURIComponent(id)}`, { method: 'PATCH', headers, body: JSON.stringify({ name }) }).then((r) => json<BoardMeta>(r)),
  /** Remove from this chat: unlinks while another chat holds it, deletes with the last one (`deleted` says which). */
  remove: (id: string, chat: string | null = boardsChat) =>
    fetch(`/api/boards/${encodeURIComponent(id)}${chatQuery(chat)}`, { method: 'DELETE' }).then((r) => json<{ ok: true; deleted?: boolean }>(r)),
  ops: (id: string, ops: BoardOp[]) =>
    fetch(`/api/boards/${encodeURIComponent(id)}/ops`, { method: 'POST', headers, body: JSON.stringify({ ops }) }).then((r) => json<BoardDoc>(r)),
};

/**
 * ONE FIRST SPACE PER KEY, however many times it is asked. Opening Spaces with none makes one; a double open, a
 * StrictMode double effect or two mounted surfaces share the one request while it is in flight.
 */
const firstSpaces = new Map<string, { p: Promise<BoardMeta | null>; at: number }>();
/** A made Space is remembered this long, so a second surface whose list was fetched before it landed does not make another. */
const FIRST_SPACE_MEMORY_MS = 5000;
export function ensureFirstSpace(key: string, make: () => Promise<BoardMeta>): Promise<BoardMeta | null> {
  const live = firstSpaces.get(key);
  if (live && Date.now() - live.at < FIRST_SPACE_MEMORY_MS) return live.p;
  const p = make().then(
    (meta) => meta,
    () => {
      firstSpaces.delete(key);
      return null;
    },
  );
  firstSpaces.set(key, { p, at: Date.now() });
  return p;
}


/* ── the change stream ──────────────────────────────────────────────── */

type Listener = () => void;
const listeners = new Set<Listener>();
let source: { close: () => void } | null = null;

function openStream(): void {
  if (source || typeof EventSource === 'undefined') return;
  const es = new EventSource('/api/boards/events');
  es.onmessage = (e: MessageEvent) => {
    let type = '';
    try {
      type = (JSON.parse(String(e.data)) as { type?: string }).type ?? '';
    } catch {
      return;
    }
    if (type !== 'boards') return;
    for (const l of [...listeners]) l();
  };
  source = es;
}

/* The boards of another workspace: reopen the stream (the server watches the attached repo's boards) and refresh. */
onWorkspaceSwitched(() => {
  if (source) {
    source.close();
    source = null;
    openStream();
  }
  for (const l of [...listeners]) l();
});

/** Hear every boards change while mounted. */
export function useBoardsChanged(listener: Listener, enabled = true): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => {
    if (!enabled) return undefined;
    const l = () => ref.current();
    listeners.add(l);
    openStream();
    return () => {
      listeners.delete(l);
      if (listeners.size === 0 && source) {
        source.close();
        source = null;
      }
    };
  }, [enabled]);
}

/** Test seam: drop the shared stream so the next listener opens a fresh one. */
export function resetBoardsStreamForTests(): void {
  firstSpaces.clear();
  indexes.clear();
  source?.close();
  source = null;
  listeners.clear();
}

/* ── the index ──────────────────────────────────────────────────────── */

/* One scoped snapshot for the host and every surface. The last subscriber drops
   it, so returning to a project learns its history afresh rather than replaying it. */
function createIndex(chat: string | null) {
  let snapshot: { index: BoardsIndex | null; failed: boolean } = { index: null, failed: false };
  const subs = new Set<() => void>();
  let generation = 0;
  let pending = false;
  let again = false;
  const publish = (next: typeof snapshot) => { snapshot = next; for (const l of subs) l(); };
  const refresh = () => {
    if (pending) { again = true; return; }
    pending = true;
    const mine = generation;
    let answer: Promise<BoardsIndex>;
    try { answer = boardsApi.list(chat); } catch { answer = Promise.reject(); }
    void answer.then((next) => {
      if (mine !== generation) return;
      if (!next || !Array.isArray(next.boards)) publish({ ...snapshot, failed: true });
      else publish({ index: next, failed: false });
    }, () => { if (mine === generation) publish({ ...snapshot, failed: true }); }).finally(() => {
      if (mine !== generation) return;
      pending = false;
      if (again && subs.size) { again = false; refresh(); }
    });
  };
  return {
    get: () => snapshot,
    refresh,
    subscribe(l: () => void) {
      subs.add(l);
      if (subs.size === 1) { listeners.add(refresh); openStream(); refresh(); }
      return () => {
        subs.delete(l);
        if (subs.size) return;
        generation += 1;
        pending = false;
        again = false;
        listeners.delete(refresh);
        snapshot = { index: null, failed: false };
        if (!listeners.size) { source?.close(); source = null; }
      };
    },
    adopt(meta: BoardMeta) {
      if (snapshot.index && !snapshot.index.boards.some((b) => b.id === meta.id)) {
        publish({ ...snapshot, index: { ...snapshot.index, boards: [...snapshot.index.boards, meta] } });
      }
    },
  };
}
const indexes = new Map<string, ReturnType<typeof createIndex>>();
const emptyIndex = { index: null, failed: false };
const noIndex = () => emptyIndex;
const noListen = () => () => {};

export function useBoardsIndex(enabled = true, project?: string): { index: BoardsIndex | null; refresh: () => void; failed: boolean; adopt: (meta: BoardMeta) => void } {
  const chat = useActiveSessionIdIfAny();
  boardsChat = chat;
  const key = `${project ?? ''}\u0000${chat ?? ''}`;
  const shared = useMemo(() => {
    let entry = indexes.get(key);
    if (!entry) { entry = createIndex(chat); indexes.set(key, entry); }
    return entry;
  }, [key, chat]);
  const snapshot = useSyncExternalStore(enabled ? shared.subscribe : noListen, enabled ? shared.get : noIndex, noIndex);
  return { ...snapshot, refresh: shared.refresh, adopt: shared.adopt };
}

/* ── one board's items ──────────────────────────────────────────────── */

/** Answers can land out of order; a board never steps back to an older revision. */
function newer(cur: BoardDoc | null, next: BoardDoc): BoardDoc {
  if (!cur || cur.id !== next.id) return next;
  return next.rev > cur.rev ? next : cur;
}

export interface BoardDocState {
  /** Null until the first answer. */
  doc: BoardDoc | null;
  /** Write a change as ops; the store applies them to the latest file. */
  write: (ops: BoardOp[]) => Promise<void>;
  error: string | null;
}

export function useBoardDoc(id: string | null, enabled = true, project = ''): BoardDocState {
  const key = `${project}\u0000${id ?? ''}`;
  const [entry, setEntry] = useState<{ key: string; doc: BoardDoc } | null>(null);
  const doc = entry?.key === key ? entry.doc : null;
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  /* The board this hook is showing NOW: an answer for any other board is not this one's to report. */
  const keyRef = useRef(key);
  keyRef.current = key;
  const load = useCallback(() => {
    if (!id) return;
    const mine = ++seq.current;
    boardsApi.get(id).then(
      (next) => {
        if (mine !== seq.current || keyRef.current !== key) return;
        /* Same rev: nothing new, keep the object (no re-render, no re-adopt). */
        setEntry((cur) => ({ key, doc: newer(cur?.key === key ? cur.doc : null, next) }));
        setError(null);
      },
      (e: Error) => {
        if (mine === seq.current && keyRef.current === key) setError(e.message);
      },
    );
  }, [id, key]);
  useEffect(() => {
    setEntry(null);
    /* A failure belongs to the board it happened on: a deleted board's 404 must not outlive it on the next one. */
    setError(null);
    seq.current += 1;
    if (enabled) load();
  }, [enabled, load]);
  useBoardsChanged(load, enabled && id !== null);
  const write = useCallback(
    async (ops: BoardOp[]) => {
      if (!id || ops.length === 0) return;
      try {
        const next = await boardsApi.ops(id, ops);
        if (keyRef.current !== key) return;
        setEntry((cur) => ({ key, doc: newer(cur?.key === key ? cur.doc : null, next) }));
        setError(null);
      } catch (e) {
        /* A save that fails after the person has moved to another Space (or the board is gone) is not that Space's error. */
        if (keyRef.current !== key) return;
        setError((e as Error).message);
        load();
      }
    },
    [id, key, load],
  );
  return { doc, write, error };
}

/* ── which whiteboard is showing ────────────────────────────────────── */

const activeListeners = new Set<() => void>();
let activeMemo: Record<string, string> = {};

function activeKey(project: string): string {
  return `sequence.boards.active.${project}`;
}

export function getActiveWhiteboard(project: string): string | null {
  if (activeMemo[project]) return activeMemo[project]!;
  try {
    return window.localStorage.getItem(activeKey(project));
  } catch {
    return null;
  }
}

export function setActiveWhiteboard(project: string, id: string): void {
  activeMemo = { ...activeMemo, [project]: id };
  try {
    window.localStorage.setItem(activeKey(project), id);
  } catch {
    /* remembered for this tab only */
  }
  for (const l of [...activeListeners]) l();
}

export function useActiveWhiteboard(project: string): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    activeListeners.add(l);
    return () => {
      activeListeners.delete(l);
    };
  }, []);
  return getActiveWhiteboard(project);
}

/** Items as the store has them, typed for the surfaces. */
export type BoardItems = readonly WbItem[];
