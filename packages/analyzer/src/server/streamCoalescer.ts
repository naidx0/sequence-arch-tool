/* ══════════════════════════════════════════════════════════════════════════
   S6 — LONG CHATS STAY SMOOTH: FEWER, FATTER TEXT FRAMES
   packages/analyzer/src/server/streamCoalescer.ts

   An agent streams its reply a token or two at a time, and every token was a
   socket write, a parse and a render on the page. This merges consecutive text
   deltas of one stream within a 50 ms window into one frame. The rules:

     - Only TEXT merges, and only with text of exactly the same kind (the same
       event with only the text different: an agent message never merges with
       a thought, nor a chunk carrying its own _meta with one that does not).
     - Anything that is not text (a tool start or update, an approval request,
       an error, the turn ending or settling) first flushes the pending text,
       then goes out at once. It never waits for the window, and nothing is
       ever reordered.
     - The merged text is the parts joined, so the reader's concatenation is
       byte for byte what it was before; a lone chunk goes out as the very
       object it came in as.

   Sources: T3 ThreadLiveEventCoalescer.ts, Synara orchestrationEventCoalescing
   (MIT), per lab/specs/build-spec-parts-4-7.html Part 4 S6.
   ══════════════════════════════════════════════════════════════════════════ */

/** The merge window, per stream. */
export const STREAM_COALESCE_MS = 50;

/** A pending run is flushed early once it holds this much text (a frame stays bounded). */
export const MAX_PENDING_TEXT_CHARS = 16 * 1024;

export interface CoalesceClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemCoalesceClock: CoalesceClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** A text delta: what may merge with it (`key`) and its text. */
export interface TextPart {
  key: string;
  text: string;
}

export interface CoalescerOptions<E, M> {
  textOf: (event: E) => TextPart | null;
  /** The event with its text replaced (built from the first of a merged run). */
  withText: (event: E, text: string) => E;
  /** Write one frame. `meta` is the last merged event's (the ask stream's log seq). */
  write: (event: E, meta: M | undefined) => void;
  windowMs?: number;
  clock?: CoalesceClock;
}

interface Pending<E, M> {
  first: E;
  key: string;
  parts: string[];
  chars: number;
  meta: M | undefined;
}

export class StreamCoalescer<E, M = undefined> {
  private pending: Pending<E, M> | null = null;
  private timer: unknown = null;
  private closed = false;
  private readonly windowMs: number;
  private readonly clock: CoalesceClock;
  /** Frames written, and events pushed (for measurement). */
  frames = 0;
  events = 0;

  constructor(private readonly opts: CoalescerOptions<E, M>) {
    this.windowMs = opts.windowMs ?? STREAM_COALESCE_MS;
    this.clock = opts.clock ?? systemCoalesceClock;
  }

  push(event: E, meta?: M): void {
    if (this.closed) return;
    this.events += 1;
    const part = this.windowMs > 0 ? this.opts.textOf(event) : null;
    if (part) {
      const p = this.pending;
      if (p && p.key === part.key) {
        p.parts.push(part.text);
        p.chars += part.text.length;
        p.meta = meta;
        if (p.chars >= MAX_PENDING_TEXT_CHARS) this.flush();
        return;
      }
      this.flush();
      this.pending = { first: event, key: part.key, parts: [part.text], chars: part.text.length, meta };
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.windowMs);
      return;
    }
    /* Not text: the text before it goes first, then it, now. */
    this.flush();
    this.emit(event, meta);
  }

  /** Write the pending text, if any, now. */
  flush(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.emit(p.parts.length === 1 ? p.first : this.opts.withText(p.first, p.parts.join('')), p.meta);
  }

  /** The stream is ending: flush, and accept nothing after. */
  close(): void {
    this.flush();
    this.closed = true;
  }

  /** The reader is gone: drop the pending text and the timer. */
  dispose(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.closed = true;
  }

  private emit(event: E, meta: M | undefined): void {
    this.frames += 1;
    this.opts.write(event, meta);
  }
}

/**
 * Every adjacent run of mergeable text joined, independent of timing: the
 * canonical form of a stream. A coalesced stream and the stream it came from
 * have the same canonical form, which is how a recorded golden (one frame per
 * token) is compared with a live, coalesced run.
 */
export function mergeAdjacentText<E>(events: readonly E[], textOf: (e: E) => TextPart | null, withText: (e: E, text: string) => E): E[] {
  const out: E[] = [];
  let run: { first: E; key: string; parts: string[] } | null = null;
  const end = (): void => {
    if (run) out.push(run.parts.length === 1 ? run.first : withText(run.first, run.parts.join('')));
    run = null;
  };
  for (const e of events) {
    const part = textOf(e);
    if (part && run && run.key === part.key) {
      run.parts.push(part.text);
      continue;
    }
    end();
    if (part) run = { first: e, key: part.key, parts: [part.text] };
    else out.push(e);
  }
  end();
  return out;
}

/* ───────────────────────── the two streams' shapes ───────────────────────── */

type Json = Record<string, unknown>;

const ACP_TEXT_KINDS = new Set(['agent_message_chunk', 'agent_thought_chunk']);

/** run-node: an `acp:update` whose update is an agent message or thought chunk of text. */
export function acpTextOf(event: Json): TextPart | null {
  if (event.type !== 'acp:update') return null;
  const n = event.update as Json | undefined;
  const u = n?.update as Json | undefined;
  if (!u || !ACP_TEXT_KINDS.has(String(u.sessionUpdate))) return null;
  const c = u.content as Json | undefined;
  if (!c || c.type !== 'text' || typeof c.text !== 'string') return null;
  return { key: JSON.stringify(acpWithText(event, '')), text: c.text };
}

export function acpWithText(event: Json, text: string): Json {
  const n = event.update as Json;
  const u = n.update as Json;
  return { ...event, update: { ...n, update: { ...u, content: { ...(u.content as Json), text } } } };
}

/** The ask stream: a bare `delta` or `reasoning` fragment. */
export function askTextOf(event: { type: string; text?: unknown }): TextPart | null {
  if (event.type !== 'delta' && event.type !== 'reasoning') return null;
  if (typeof event.text !== 'string' || Object.keys(event).length !== 2) return null;
  return { key: event.type, text: event.text };
}

export function askWithText<E extends { type: string }>(event: E, text: string): E {
  return { ...event, text };
}
