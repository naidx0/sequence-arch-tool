/**
 * FULL-TEXT SEARCH OVER CHATS (claims U48).
 *
 * The sidebar's "Search chats" used to match titles and goals only. This scans
 * the words people and agents actually wrote: the stored chat turns
 * (`sessions/<id>/chat.json`) and the agent runs (`agent-runs.json`: prompt and
 * reply text). Newest chat first, case-insensitive, each chat capped at
 * `maxBytes` of scanned text, and the whole scan held to a time budget: when
 * it runs out the result says `truncated` rather than pretending it looked
 * everywhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import { hasUnsavedRuns, readAgentRuns } from './agentChatStore.js';
import { readSessionChat, readSessionIndex } from './sessionsStore.js';
import { SEQUENCE_DIR } from './store.js';

export interface ChatSearchHit {
  chatId: string;
  title: string;
  snippet: string;
  at: string;
}

export interface ChatSearchResult {
  hits: ChatSearchHit[];
  /** The time budget or the hit limit stopped the scan before every chat was read. */
  truncated: boolean;
}

export interface ChatSearchOpts {
  limit: number;
  maxBytes: number;
  /** Total milliseconds the scan may spend. Default 200. */
  budgetMs?: number;
  /** Test seam. */
  now?: () => number;
}

const SNIPPET_RADIUS = 48;

function snippetAround(text: string, at: number, len: number): string {
  const from = Math.max(0, at - SNIPPET_RADIUS);
  const to = Math.min(text.length, at + len + SNIPPET_RADIUS);
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`;
}

/** The chat's searchable passages, each with the time it was written, capped at `maxBytes` characters in all. */
function passages(root: string, chatId: string, maxBytes: number): { text: string; at: string }[] {
  const out: { text: string; at: string }[] = [];
  let used = 0;
  const take = (text: unknown, at: string): void => {
    if (typeof text !== 'string' || text === '' || used >= maxBytes) return;
    const piece = text.length > maxBytes - used ? text.slice(0, maxBytes - used) : text;
    used += piece.length;
    out.push({ text: piece, at });
  };
  const runs = readAgentRuns(root, chatId);
  /* Newest first, so the cap drops the oldest words. */
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!;
    const at = new Date(r.endedAt || r.startedAt || 0).toISOString();
    take(r.prompt, at);
    take(r.text, at);
  }
  const turns = readSessionChat(root, chatId).turns;
  for (let i = turns.length - 1; i >= 0; i--) take(turns[i]!.text, turns[i]!.at ?? '');
  return out;
}

/** Needles with no JSON-escapable characters appear verbatim in the stored files, so a file without them cannot match. */
const PLAIN = /^[A-Za-z0-9 .:_-]+$/;

/**
 * FALSE only when both stored files were read and neither contains the needle. Any read failure answers true, so the
 * full path decides. Saves parsing hundreds of chats that cannot match.
 */
function mayContain(root: string, chatId: string, needle: string): boolean {
  if (!PLAIN.test(needle) || hasUnsavedRuns(root, chatId)) return true;
  const dir = path.join(root, SEQUENCE_DIR, 'sessions', chatId);
  for (const leaf of ['chat.json', 'agent-runs.json']) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, leaf), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      return true;
    }
    if (raw.toLowerCase().includes(needle)) return true;
  }
  return false;
}

export function searchChats(root: string, q: string, opts: ChatSearchOpts): ChatSearchResult {
  const needle = q.trim().toLowerCase();
  const now = opts.now ?? (() => performance.now());
  if (needle.length === 0) return { hits: [], truncated: false };
  const index = readSessionIndex(root);
  if (!index) return { hits: [], truncated: false };
  const started = now();
  const budget = opts.budgetMs ?? 200;
  const chats = [...index.sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  const hits: ChatSearchHit[] = [];
  for (const chat of chats) {
    if (now() - started > budget) return { hits, truncated: true };
    if (hits.length >= opts.limit) return { hits, truncated: true };
    if (!mayContain(root, chat.id, needle)) continue;
    for (const p of passages(root, chat.id, opts.maxBytes)) {
      const at = p.text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      hits.push({ chatId: chat.id, title: chat.title, snippet: snippetAround(p.text, at, needle.length), at: p.at || chat.updatedAt });
      break;
    }
  }
  return { hits, truncated: false };
}
