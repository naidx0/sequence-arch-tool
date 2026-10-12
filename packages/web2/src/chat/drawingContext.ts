import { createContext, useContext, useEffect, useState } from 'react';

/** Where a drawing came from: the chat and turn that showed it, and the project root (to make linked files repo-relative). */
export interface DrawingOrigin {
  chat: string | null;
  turn: string;
  repoRoot: string | null;
  /** The turn's start time (ms): the newest version of a drawing is the one from the latest turn. */
  at?: number;
  /** The message that started the turn: an `id=` update of another chat's drawing needs it to name the drawing. */
  prompt?: string;
}
export const DrawingContext = createContext<DrawingOrigin | null>(null);

/** A saved drawing's handle. */
export interface SavedDrawing {
  id: string;
  name: string;
  version: number;
  /** The drawing's title, when the server has one (the card header shows it). */
  title?: string;
}

/**
 * A link target as a path the file API accepts: relative to the project root, forward slashes.
 * An absolute path inside the root is cut to its relative part; one outside it, or one that climbs
 * with `..`, is null (the server's jail refuses absolute paths, so they are never sent).
 */
export function repoRelative(target: string, root: string | null): string | null {
  let p = target.trim().replace(/\\/g, '/');
  if (/^file:/i.test(p)) p = p.replace(/^file:\/\/\/?/i, '').replace(/^(?![A-Za-z]:)/, '/');
  const abs = p.startsWith('/') || /^[A-Za-z]:\//.test(p);
  if (abs) {
    if (!root) return null;
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const fold = /^[A-Za-z]:/.test(r) ? (s: string) => s.toLowerCase() : (s: string) => s;
    if (!fold(p).startsWith(`${fold(r)}/`)) return null;
    p = p.slice(r.length + 1);
  }
  p = p.replace(/^\.\//, '');
  if (p === '' || p.split('/').includes('..')) return null;
  return p;
}

/** Save a closed block as a drawing (once per source) and return its handle; null until saved or without a chat to file it under. */
export function useSavedDrawing(kind: 'svg' | 'html', source: string, ready: boolean, id: string | undefined): SavedDrawing | null {
  const origin = useContext(DrawingContext);
  const [saved, setSaved] = useState<SavedDrawing | null>(null);
  const chat = origin?.chat ?? null;
  const turn = origin?.turn ?? '';
  const at = origin?.at;
  const referenced = id !== undefined && (origin?.prompt ?? '').includes(`@drawing:${id}`);
  useEffect(() => {
    if (!ready || !chat || typeof fetch !== 'function' || source.trim() === '') return undefined;
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/drawings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat, turn, kind, source, ...(at !== undefined ? { at } : {}), ...(id ? { id, referenced } : {}) }) });
        if (!res.ok) return;
        const j = (await res.json()) as { drawing: { id: string }; name: string; version: number };
        if (live) setSaved({ id: j.drawing.id, name: j.name, version: j.version, title: (j.drawing as { title?: string }).title });
      } catch {
        /* an unsaved drawing is still drawn */
      }
    })();
    return () => {
      live = false;
    };
  }, [ready, chat, turn, at, referenced, kind, source, id]);
  return saved;
}
