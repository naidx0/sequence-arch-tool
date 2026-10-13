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

import { useCallback, useEffect, useRef, useState } from 'react';

import type { WbItem } from '../../whiteboard/whiteboardModel';
import { onWorkspaceSwitched } from '../../sessions/workspaceEvents';
import type { BoardDoc, BoardMeta, BoardOp, BoardsIndex } from './boardsModel';

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

export const boardsApi = {
  list: () => fetch('/api/boards').then((r) => json<BoardsIndex>(r)),
  get: (id: string) => fetch(`/api/boards/${encodeURIComponent(id)}`).then((r) => json<BoardDoc>(r)),
  create: (name: string) =>
    fetch('/api/boards', { method: 'POST', headers, body: JSON.stringify({ name, kind: 'whiteboard' }) }).then((r) => json<BoardMeta>(r)),
  rename: (id: string, name: string) =>
    fetch(`/api/boards/${encodeURIComponent(id)}`, { method: 'PATCH', headers, body: JSON.stringify({ name }) }).then((r) => json<BoardMeta>(r)),
  remove: (id: string) => fetch(`/api/boards/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  ops: (id: string, ops: BoardOp[]) =>
    fetch(`/api/boards/${encodeURIComponent(id)}/ops`, { method: 'POST', headers, body: JSON.stringify({ ops }) }).then((r) => json<BoardDoc>(r)),
};

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
  source?.close();
  source = null;
  listeners.clear();
}

/* ── the index ──────────────────────────────────────────────────────── */

export function useBoardsIndex(enabled = true, project?: string): { index: BoardsIndex | null; refresh: () => void; failed: boolean } {
  const [index, setIndex] = useState<BoardsIndex | null>(null);
  /* No answer at all (no server: a frontend-only build, a test): the
     surfaces fall back to what they did before boards had a store. */
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++seq.current;
    let answer: Promise<BoardsIndex>;
    try {
      answer = boardsApi.list();
    } catch {
      setFailed(true);
      return;
    }
    answer.then(
      (next) => {
        if (mine !== seq.current) return;
        if (!next || !Array.isArray(next.boards)) {
          setFailed(true);
          return;
        }
        setIndex(next);
        setFailed(false);
      },
      () => {
        if (mine === seq.current) setFailed(true);
      },
    );
  }, []);
  /* THE LIST BELONGS TO A PROJECT. When the project changes, the old project's list is dropped at once and any answer
     still in flight for it is ignored (the refresh below takes a newer sequence number), so a late answer from A never
     lands as B's list. */
  const seen = useRef(project);
  useEffect(() => {
    if (!enabled) return;
    if (seen.current !== project) {
      seen.current = project;
      seq.current += 1;
      setIndex(null);
    }
    refresh();
  }, [enabled, refresh, project]);
  useBoardsChanged(refresh, enabled);
  return { index, refresh, failed };
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

export function useBoardDoc(id: string | null, enabled = true): BoardDocState {
  const [doc, setDoc] = useState<BoardDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  /* The board this hook is showing NOW: an answer for any other board is not this one's to report. */
  const idRef = useRef(id);
  idRef.current = id;
  const load = useCallback(() => {
    if (!id) return;
    const mine = ++seq.current;
    boardsApi.get(id).then(
      (next) => {
        if (mine !== seq.current) return;
        /* Same rev: nothing new, keep the object (no re-render, no re-adopt). */
        setDoc((cur) => newer(cur, next));
        setError(null);
      },
      (e: Error) => {
        if (mine === seq.current) setError(e.message);
      },
    );
  }, [id]);
  useEffect(() => {
    setDoc(null);
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
        if (idRef.current !== id) return;
        setDoc((cur) => newer(cur, next));
        setError(null);
      } catch (e) {
        /* A save that fails after the person has moved to another Space (or the board is gone) is not that Space's error. */
        if (idRef.current !== id) return;
        setError((e as Error).message);
        load();
      }
    },
    [id, load],
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
