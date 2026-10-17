/* ══════════════════════════════════════════════════════════════════════════
   WHICH TURNS OF A CHAT WERE REVERTED
   packages/web2/src/rewind/revertedMarks.ts

   The Opus walk of 2026-10-15: "After restore the chat still says 'I changed README.md' with no reverted marker."
   Rewind puts files back; the turn that wrote them stays in the transcript, and said nothing. A restore (a checkpoint,
   or Revert to here on an agent turn) records the span of the chat's time it undid: from the moment the point was
   taken to the moment of the restore. A turn that began inside a span is drawn with "Reverted". Undo revert takes the
   span back.

   Kept in this browser, per chat (the reverted files are on disk and in the engine's own record; this is only the
   words under the turn). A storage that is not there means no marks, never an error.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

export interface RevertSpan {
  from: number;
  to: number;
}

const KEY = 'sequence.reverted.v1';
const MAX_SPANS = 20;

let cache: Record<string, RevertSpan[]> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function read(): Record<string, RevertSpan[]> {
  if (cache) return cache;
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const out: Record<string, RevertSpan[]> = {};
    for (const [chat, spans] of Object.entries(parsed)) {
      if (!Array.isArray(spans)) continue;
      const clean = spans.filter((s): s is RevertSpan => !!s && typeof (s as RevertSpan).from === 'number' && typeof (s as RevertSpan).to === 'number');
      if (clean.length) out[chat] = clean;
    }
    cache = out;
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Record<string, RevertSpan[]>): void {
  cache = next;
  version += 1;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* no storage: the marks last as long as the page */
  }
  for (const l of [...listeners]) l();
}

/** The chat's turns that began in [from, to] were reverted. */
export function markReverted(chatId: string, from: number, to: number = Date.now()): void {
  if (!chatId || !Number.isFinite(from)) return;
  const now = read();
  const spans = [...(now[chatId] ?? []), { from, to: Math.max(from, to) }].slice(-MAX_SPANS);
  write({ ...now, [chatId]: spans });
}

/** Undo revert: the span that began at `from` is taken back. */
export function clearReverted(chatId: string, from: number): void {
  const now = read();
  const spans = (now[chatId] ?? []).filter((s) => s.from !== from);
  if (spans.length === (now[chatId] ?? []).length) return;
  const next = { ...now };
  if (spans.length) next[chatId] = spans;
  else delete next[chatId];
  write(next);
}

/** Was a turn that began at `at` in this chat reverted? */
export function isRevertedAt(chatId: string | null | undefined, at: number): boolean {
  if (!chatId || !Number.isFinite(at)) return false;
  return (read()[chatId] ?? []).some((s) => at >= s.from && at <= s.to);
}

/** Tests: forget everything held in memory and in storage. */
export function resetRevertedMarks(): void {
  cache = {};
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    /* nothing to remove */
  }
  version += 1;
  for (const l of [...listeners]) l();
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const snapshot = (): number => version;

/** Re-draws the caller when a mark changes; read the answer with {@link isRevertedAt}. */
export function useRevertedMarks(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
