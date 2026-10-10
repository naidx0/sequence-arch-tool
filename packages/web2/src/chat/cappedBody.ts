/* ══════════════════════════════════════════════════════════════════════════
   A CAPPED BODY, LOADED WHEN IT IS ASKED FOR (S6)
   packages/web2/src/chat/cappedBody.ts

   The server cuts any tool output, diff or file body over 8 KB to its first
   8 KB and says so on the event (analyzer streamBodies.ts):

     capped: [{ at: ['update','update','rawOutput','aggregatedOutput'],
                id: '<32 hex>', bytes: 812345, shownBytes: 8190 }]

   `at` is the path to the cut string inside the event; the string stays in
   its old place. GET /api/stream-body?id=<id>&chat=<chat> returns the whole
   body (text/plain, 404 for an unknown id). "Show all (N KB)" fetches it and
   puts it back at `at`.
   ══════════════════════════════════════════════════════════════════════════ */

export interface CappedBody {
  /** Where the cut string is in the event, as keys and array indexes. */
  at: (string | number)[];
  id: string;
  /** The whole body's UTF-8 length. */
  bytes: number;
  /** The UTF-8 length of what the event carries. */
  shownBytes: number;
}

const BODY_ID = /^[0-9a-f]{32}$/;

/** The event's valid `capped` entries (none when it has none). */
export function cappedOf(event: unknown): CappedBody[] {
  const list = (event as { capped?: unknown } | null)?.capped;
  if (!Array.isArray(list)) return [];
  const out: CappedBody[] = [];
  for (const c of list as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue;
    if (typeof c.id !== 'string' || !BODY_ID.test(c.id)) continue;
    if (!Array.isArray(c.at) || !c.at.every((k) => typeof k === 'string' || typeof k === 'number')) continue;
    if (typeof c.bytes !== 'number' || typeof c.shownBytes !== 'number') continue;
    out.push({ at: c.at as (string | number)[], id: c.id, bytes: c.bytes, shownBytes: c.shownBytes });
  }
  return out;
}

export function streamBodyUrl(id: string, chatId: string | null): string {
  return `/api/stream-body?id=${encodeURIComponent(id)}${chatId ? `&chat=${encodeURIComponent(chatId)}` : ''}`;
}

/** "48 KB" / "1.2 MB": the whole size, on the "Show all" button. */
export function byteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A copy of `value` with the string at `at` replaced; the rest is shared. */
export function withStringAt<T>(value: T, at: readonly (string | number)[], text: string): T {
  if (at.length === 0) return text as unknown as T;
  const [head, ...rest] = at;
  if (Array.isArray(value)) {
    const next = value.slice();
    next[head as number] = withStringAt(value[head as number], rest, text);
    return next as unknown as T;
  }
  const o = (value ?? {}) as Record<string | number, unknown>;
  return { ...o, [head!]: withStringAt(o[head!], rest, text) } as T;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Whole bodies already fetched, by id: one asked for twice is fetched once. */
const loaded = new Map<string, string>();

export async function fetchStreamBody(id: string, chatId: string | null, f: Fetch = (i, init) => fetch(i, init)): Promise<string> {
  const have = loaded.get(id);
  if (have !== undefined) return have;
  const r = await f(streamBodyUrl(id, chatId));
  if (r.status === 404) throw new Error('The full output is no longer kept.');
  if (!r.ok) throw new Error(`The full output could not be loaded (${r.status}).`);
  const text = await r.text();
  loaded.set(id, text);
  return text;
}

/** Tests only. */
export function resetStreamBodies(): void {
  loaded.clear();
}
