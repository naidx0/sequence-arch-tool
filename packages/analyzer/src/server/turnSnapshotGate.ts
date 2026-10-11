/**
 * THE TURN-START SNAPSHOT NEVER DELAYS A TURN (S2b, first item).
 *
 * Measured on codeforge (2,809 files): a cold whole-tree snapshot takes
 * ~3.9 s, a warm one ~0.1 s. The snapshot exists for one reason: so the
 * agent's FIRST write of the turn can be undone. Nothing before that write
 * needs it, so nothing before that write waits for it:
 *
 *   turn starts   the snapshot is started and NOT awaited; the agent's prompt
 *                 (Claude's UserPromptSubmit hook, codex's turn/started) is
 *                 answered at once
 *   a read, a
 *   thought       never passes through here at all
 *   a write       waits for that turn's snapshot (only the first write can
 *                 actually wait: once it has resolved every later one passes
 *                 straight on), then records its paths, then is allowed
 *
 * The other half is {@link IdleWarmer}: the shadow index is built in idle
 * time after a project opens, so even the first snapshot is usually warm.
 *
 * `blockTurnStart` is the OLD path (await the snapshot before answering the
 * turn start), kept only so a test can show the difference it makes.
 */

export interface SnapshotOps {
  beginTurn: (root: string, sessionId: string, opts: { turnId?: string; chatTurnId?: string }) => Promise<unknown>;
  trackWrites: (root: string, sessionId: string, paths: string[], opts: { turnId?: string }) => Promise<unknown>;
  /** Resolves once the snapshot work queued for `root` has finished (snapshot.ts snapshotsIdle). */
  idle?: (root: string) => Promise<unknown>;
}

export class TurnSnapshotGate {
  /** The running turn-start snapshot per repo and session. */
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly ops: SnapshotOps,
    private readonly opts: { blockTurnStart?: boolean } = {},
  ) {}

  private key(root: string, sessionId: string): string {
    return `${root}\0${sessionId}`;
  }

  /** A turn starts. Resolves at once (the snapshot carries on behind it) unless `blockTurnStart`. */
  startTurn(root: string, sessionId: string, opts: { turnId?: string; chatTurnId?: string } = {}): Promise<void> {
    const taken = this.ops.beginTurn(root, sessionId, opts).then(
      () => undefined,
      () => undefined,
    );
    this.pending.set(this.key(root, sessionId), taken);
    return this.opts.blockTurnStart ? taken : Promise.resolve();
  }

  /**
   * Every snapshot this gate started, and the shadow work queued behind them,
   * has finished. Shutdown waits for it: a turn-start snapshot runs git in the
   * repository's shadow store and can outlive a short turn, and on Windows a
   * folder a process is still working in cannot be removed.
   */
  settled(): Promise<void> {
    const roots = new Set([...this.pending.keys()].map((k) => k.slice(0, k.indexOf('\0'))));
    return Promise.all([...this.pending.values(), ...[...roots].map((r) => this.ops.idle?.(r))]).then(
      () => undefined,
      () => undefined,
    );
  }

  /** A write is about to land: wait for the turn's snapshot, then record the paths. */
  async beforeWrite(root: string, sessionId: string, paths: string[], opts: { turnId?: string } = {}): Promise<void> {
    const taking = this.pending.get(this.key(root, sessionId));
    if (taking) await taking;
    if (paths.length) await this.ops.trackWrites(root, sessionId, paths, opts);
  }
}

/** A clock the warmer can be driven by in tests. */
export interface IdleClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

const systemIdleClock: IdleClock = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    (t as { unref?: () => void }).unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * WARM THE SHADOW WHEN NOTHING IS RUNNING. After a project opens, wait
 * `delayMs`; if an agent turn is running then, look again later; otherwise
 * build the shadow index once (`warm`). One warm per root per server.
 */
export class IdleWarmer {
  private readonly done = new Set<string>();
  private readonly timers = new Map<string, unknown>();
  private readonly clock: IdleClock;

  constructor(
    private readonly warm: (root: string) => Promise<unknown>,
    private readonly busy: () => boolean,
    opts: { delayMs?: number; retryMs?: number; clock?: IdleClock } = {},
  ) {
    this.clock = opts.clock ?? systemIdleClock;
    this.delayMs = opts.delayMs ?? 1500;
    this.retryMs = opts.retryMs ?? 5000;
  }

  private readonly delayMs: number;
  private readonly retryMs: number;

  /** A project opened (or the server started on one). */
  schedule(root: string, ms = this.delayMs): void {
    if (this.done.has(root) || this.timers.has(root)) return;
    this.timers.set(
      root,
      this.clock.setTimeout(() => {
        this.timers.delete(root);
        if (this.busy()) {
          this.schedule(root, this.retryMs);
          return;
        }
        this.done.add(root);
        void this.warm(root).catch(() => this.done.delete(root));
      }, ms),
    );
  }

  /** Server shutdown. */
  cancelAll(): void {
    for (const t of this.timers.values()) this.clock.clearTimeout(t);
    this.timers.clear();
  }
}
