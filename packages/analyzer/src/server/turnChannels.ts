/* ══════════════════════════════════════════════════════════════════════════
   A CHAT'S AGENT TURN OUTLIVES THE PAGE THAT STARTED IT
   packages/analyzer/src/server/turnChannels.ts

   Owner: several chats running agents in the background at once. A chat turn
   (POST /api/acp/run-node with a sessionKey, streamed) was cancelled the
   moment its HTTP stream closed. The page closes that stream on a reload, and
   opening a chat in another workspace IS a reload (V3App.openProject), so one
   reload stopped every agent the person had running, in every chat
   (e2e/multi-chat.mjs found it).

   A channel sits between the turn and whoever is watching it:
     push      every event the turn streams is kept (in order) and sent to
               every watcher;
     attach    a page that comes back (GET /api/acp/attach) is sent what it
               missed, then follows the turn live;
     grace     when the page that started the turn goes and nobody else
               watches, the turn keeps going for `graceMs`. If nobody attaches
               in that time the turn is ABANDONED: approvals waiting on a
               person are denied and the turn is stopped, as a closed stream
               always did (no agent left working for a page that is gone).
   An explicit Stop is never a disconnect: the page asks POST /api/acp/stop.
   ══════════════════════════════════════════════════════════════════════════ */

export interface TurnClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TurnChannelInfo {
  turnId: string;
  chatId: string | null;
  agentRef: string;
  /** What the person typed (never the agent's private copy). */
  prompt: string;
  startedAt: number;
}

export interface TurnWatcher {
  send(event: Record<string, unknown>): void;
  end(): void;
}

/**
 * How much a channel keeps for a page that comes back, in bytes of the events' JSON. A count let a few huge events
 * (whole files in tool output) hold ~160 MB for one turn. Past it the oldest go, and a page that comes back is told
 * first (acp:replay-truncated) so it can say so and take the saved record once the turn ends.
 */
export const MAX_KEPT_BYTES = 16 * 1024 * 1024;

export const DEFAULT_DETACH_GRACE_MS = 30_000;

export class TurnChannel {
  info: TurnChannelInfo;
  /** The kept events from `head` on (older entries are dropped and compacted away), with their sizes. */
  private kept: { event: Record<string, unknown>; bytes: number }[] = [];
  private head = 0;
  private keptBytes = 0;
  /** The turn's id: replayed even when trimming dropped it, because a page needs it before anything else. */
  private named: Record<string, unknown> | null = null;
  private namedDropped = false;
  /** More came than is kept: a page that comes back misses the oldest `dropped` events. */
  truncated = false;
  dropped = 0;
  private readonly watchers = new Set<TurnWatcher>();
  private readonly abandonFns = new Set<() => void>();
  private readonly endFns = new Set<() => void>();
  private ownerGone = false;
  private timer: unknown = null;
  ended = false;
  abandoned = false;
  /** Stop the turn now (an explicit Stop, or abandonment). */
  stop: () => void = () => {};

  constructor(
    info: TurnChannelInfo,
    private readonly opts: { clock: TurnClock; graceMs: number },
  ) {
    this.info = info;
  }

  push(event: Record<string, unknown>): void {
    if (this.ended) return;
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
    if (event.type === 'acp:turn-id' && this.named === null) this.named = event;
    this.kept.push({ event, bytes });
    this.keptBytes += bytes;
    /* The oldest go until the rest fit; the newest event is always kept. */
    while (this.keptBytes > MAX_KEPT_BYTES && this.head < this.kept.length - 1) {
      const gone = this.kept[this.head]!;
      this.head += 1;
      this.keptBytes -= gone.bytes;
      this.dropped += 1;
      this.truncated = true;
      if (gone.event === this.named) this.namedDropped = true;
    }
    if (this.head > 1024 && this.head * 2 > this.kept.length) {
      this.kept = this.kept.slice(this.head);
      this.head = 0;
    }
    for (const w of [...this.watchers]) w.send(event);
  }

  /** A page follows the turn: what it missed, then every event until the end. Returns how to stop following. */
  attach(w: TurnWatcher): () => void {
    if (this.truncated) {
      w.send({ type: 'acp:replay-truncated', dropped: this.dropped });
      if (this.namedDropped && this.named) w.send(this.named);
    }
    for (let i = this.head; i < this.kept.length; i += 1) w.send(this.kept[i]!.event);
    if (this.ended) {
      w.end();
      return () => {};
    }
    this.watchers.add(w);
    this.disarm();
    return () => {
      if (!this.watchers.delete(w)) return;
      if (this.ownerGone && this.watchers.size === 0) this.arm();
    };
  }

  /** The request that started the turn closed its stream (a reload, a closed tab, a workspace switch). */
  ownerClosed(): void {
    if (this.ended || this.ownerGone) return;
    this.ownerGone = true;
    if (this.watchers.size === 0) this.arm();
  }

  /** Nobody watches the turn any more, not even the page that started it. */
  get unwatched(): boolean {
    return this.ownerGone && this.watchers.size === 0;
  }

  onAbandoned(fn: () => void): () => void {
    if (this.abandoned) {
      fn();
      return () => {};
    }
    this.abandonFns.add(fn);
    return () => this.abandonFns.delete(fn);
  }

  onEnd(fn: () => void): void {
    if (this.ended) fn();
    else this.endFns.add(fn);
  }

  /** The turn is over: every watcher's stream ends, and nothing else is kept. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.disarm();
    for (const w of [...this.watchers]) w.end();
    this.watchers.clear();
    for (const fn of [...this.endFns]) fn();
    this.endFns.clear();
    this.abandonFns.clear();
  }

  private arm(): void {
    if (this.timer !== null || this.ended) return;
    this.timer = this.opts.clock.setTimeout(() => {
      this.timer = null;
      if (this.ended || this.watchers.size > 0) return;
      this.abandoned = true;
      for (const fn of [...this.abandonFns]) fn();
      this.abandonFns.clear();
      this.stop();
    }, this.opts.graceMs);
  }

  private disarm(): void {
    if (this.timer === null) return;
    this.opts.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}

/** The live chat turns of one server, by turn id. */
export class TurnChannels {
  private readonly byId = new Map<string, TurnChannel>();

  open(channel: TurnChannel): void {
    this.byId.set(channel.info.turnId, channel);
    channel.onEnd(() => {
      if (this.byId.get(channel.info.turnId) === channel) this.byId.delete(channel.info.turnId);
    });
  }

  get(turnId: string): TurnChannel | undefined {
    return this.byId.get(turnId);
  }

  /** What a page needs to follow every running chat turn again. */
  live(): (TurnChannelInfo & { truncated?: true })[] {
    return [...this.byId.values()].filter((c) => !c.ended).map((c) => ({ ...c.info, ...(c.truncated ? { truncated: true as const } : {}) }));
  }
}
