/**
 * `AcpSessionCache` — the server half of ACP session continuity (r31).
 *
 * The `/api/acp/run-node` handler spawns a real coding-agent subprocess per turn.
 * When the web client sends a stable `sessionKey` (`${runScope}::${agentRef}`,
 * omitted when a node opts out via `shareSession === false`), two turns that share
 * a key must run on ONE live ACP session so the agent keeps its context — exactly
 * the anti-priming semantics {@link module:executor} gives an in-process Program
 * run, but here across independent HTTP requests.
 *
 * This is a PER-SERVER-INSTANCE cache: it is closure state created once in
 * `createRepoServer`, alongside the other per-instance caches (usageStore,
 * dailyLimiter), so it never bleeds across server instances or across tests.
 *
 * WHAT IT GUARANTEES
 *  - REUSE: the first `run(key, …)` spawns + starts + opens a session; every later
 *    `run` with the same key reuses that live `{ client, sessionId }` — no second
 *    spawn, no second `newSession`.
 *  - SERIALIZE: turns on one key never interleave. Each `run` chains behind the
 *    prior turn on a per-entry `turnLock` (mirrors the acp executor's `turnLock`
 *    and `AcpClient`'s internal `turnQueue`), so two nodes on the same session
 *    can't prompt at once (an ACP session is single-turn).
 *  - RACE-FREE CREATE: concurrent first-callers await the SAME creation promise, so
 *    exactly one client is spawned + one session opened per key.
 *
 * HYGIENE (the part that matters on a long-lived server)
 *  - A turn that throws in a way that kills the client disposes the entry (unless
 *    the caller says the throw was an expected abort — a client disconnect must NOT
 *    tear down a session other requests still share). A dead agent surfaces as the
 *    next turn's throw → dispose → transparent re-create.
 *  - An idle TTL (default 10 min, reset on every use) disposes an untouched session
 *    so an abandoned key never pins a subprocess forever. The timer is `unref`'d so
 *    it never keeps the process alive.
 *  - A hard cap (default 8 live sessions) LRU-evicts + disposes the oldest, so a
 *    runaway client can't spawn unbounded subprocesses.
 *  - `disposeAll()` (wired to the server's `close` event) tears every session down
 *    on shutdown.
 *
 * The `sessionKey` is an OPAQUE string: this module never parses, trusts, or logs
 * its contents — it is only ever a Map key.
 */

import type { AcpAgentClient } from '@sequence/acp';

/** Default idle TTL: a session untouched this long is disposed. */
export const ACP_SESSION_IDLE_TTL_MS = 10 * 60 * 1000;
/** Default cap on concurrent live sessions (mirrors MAX_TERMINALS). */
export const ACP_SESSION_MAX = 8;

/** A live cached session plus its serialization + lifecycle state. */
interface Entry {
  readonly key: string;
  readonly client: AcpAgentClient;
  readonly sessionId: string;
  /**
   * Per-session critical section. Each `run` chains its turn after the prior turn
   * on this key, so concurrent callers serialize (never interleave) on the one
   * session. Predecessor failures don't block successors.
   */
  turnLock: Promise<unknown>;
  /** Idle-TTL timer; cleared while in use, rescheduled after each use. */
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set once when the entry is torn down so disposal is idempotent. */
  disposed: boolean;
}

/** What the handler's factory returns: a started client with an open session. */
export interface CreatedSession {
  client: AcpAgentClient;
  sessionId: string;
}

export interface AcpSessionRunOptions {
  /**
   * Decide, from the error a failed turn threw, whether to DISPOSE the cached
   * entry. Default: dispose on any throw (a throw means the client/stream broke).
   * The handler passes `() => !signal.aborted` so a client DISCONNECT (which
   * aborts the in-flight turn) leaves the shared session alive for other requests,
   * while a genuine agent/stream death still tears it down.
   */
  disposeOnError?: (err: unknown) => boolean;
}

export interface AcpSessionCache {
  /**
   * Reuse (or create on first use) the live session for `key`, then run one turn
   * on it via `use`, SERIALIZED behind any in-flight turn on the same key.
   */
  run<T>(
    key: string,
    create: () => Promise<CreatedSession>,
    use: (client: AcpAgentClient, sessionId: string) => Promise<T>,
    opts?: AcpSessionRunOptions
  ): Promise<T>;
  /** Dispose every live session (server shutdown). */
  disposeAll(): Promise<void>;
  /** Live session count (tests / observability). */
  size(): number;
}

export interface AcpSessionCacheOptions {
  /** Idle TTL in ms (default {@link ACP_SESSION_IDLE_TTL_MS}). `0`/∞ disables the timer. */
  ttlMs?: number;
  /** Max concurrent live sessions (default {@link ACP_SESSION_MAX}). */
  maxSessions?: number;
}

/**
 * Build a per-instance ACP session cache. Constructor-injectable `ttlMs` /
 * `maxSessions` let the locking tests drive a tiny TTL / small cap without fake
 * timers; production uses the defaults.
 */
export function createAcpSessionCache(opts: AcpSessionCacheOptions = {}): AcpSessionCache {
  const ttlMs = opts.ttlMs ?? ACP_SESSION_IDLE_TTL_MS;
  const maxSessions = Math.max(1, opts.maxSessions ?? ACP_SESSION_MAX);

  // In-flight creations, deduped per key so concurrent first-callers await ONE
  // spawn. Resolved live entries move to `live` (insertion order == LRU order).
  const pending = new Map<string, Promise<Entry>>();
  const live = new Map<string, Entry>();

  function clearIdle(entry: Entry): void {
    if (entry.idleTimer !== undefined) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
  }

  function scheduleIdle(entry: Entry): void {
    clearIdle(entry);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
    const t = setTimeout(() => {
      void disposeEntry(entry);
    }, ttlMs);
    // Never let the idle timer keep the process alive.
    (t as { unref?: () => void }).unref?.();
    entry.idleTimer = t;
  }

  async function disposeEntry(entry: Entry): Promise<void> {
    if (entry.disposed) return;
    entry.disposed = true;
    clearIdle(entry);
    // Only unmap if the key still points at THIS entry — a later re-create under
    // the same key must not be evicted by an older entry's TTL/error disposal.
    if (live.get(entry.key) === entry) live.delete(entry.key);
    await entry.client.dispose().catch(() => {});
  }

  /** After inserting a new entry, LRU-evict+dispose until we're within the cap. */
  function enforceCap(): void {
    while (live.size > maxSessions) {
      const oldestKey = live.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = live.get(oldestKey);
      if (oldest) void disposeEntry(oldest);
      else live.delete(oldestKey);
    }
  }

  function ensure(key: string, create: () => Promise<CreatedSession>): Promise<Entry> {
    const existing = live.get(key);
    if (existing && !existing.disposed) return Promise.resolve(existing);
    let p = pending.get(key);
    if (!p) {
      p = (async (): Promise<Entry> => {
        const { client, sessionId } = await create();
        return {
          key,
          client,
          sessionId,
          turnLock: Promise.resolve(),
          idleTimer: undefined,
          disposed: false,
        };
      })();
      // Register SYNCHRONOUSLY (before any await) so a second concurrent caller
      // dedupes onto this same creation.
      pending.set(key, p);
      p.then(
        (entry) => {
          if (pending.get(key) === p) pending.delete(key);
          if (entry.disposed) return; // disposed mid-create (e.g. shutdown) — drop it
          live.set(key, entry);
          scheduleIdle(entry);
          enforceCap();
        },
        () => {
          if (pending.get(key) === p) pending.delete(key); // failed create caches nothing
        }
      );
    }
    return p;
  }

  async function run<T>(
    key: string,
    create: () => Promise<CreatedSession>,
    use: (client: AcpAgentClient, sessionId: string) => Promise<T>,
    runOpts: AcpSessionRunOptions = {}
  ): Promise<T> {
    const entry = await ensure(key, create);

    // Mark in-use: stop the idle countdown, and move to MRU position for LRU.
    clearIdle(entry);
    if (live.get(key) === entry) {
      live.delete(key);
      live.set(key, entry);
    }

    // Grab the per-key turn lock SYNCHRONOUSLY (no await between read + install) so
    // concurrent runs queue deterministically in call order.
    const prior = entry.turnLock;
    let release!: () => void;
    entry.turnLock = new Promise<void>((r) => {
      release = r;
    });

    try {
      await prior.catch(() => undefined);
      // If the entry was disposed while we waited our turn (TTL, eviction, or a
      // sibling turn's error), transparently re-create under the same key.
      if (entry.disposed) {
        release();
        return run(key, create, use, runOpts);
      }
      return await use(entry.client, entry.sessionId);
    } catch (e) {
      const dispose = runOpts.disposeOnError ? runOpts.disposeOnError(e) : true;
      if (dispose) await disposeEntry(entry);
      throw e;
    } finally {
      release();
      // Restart the idle countdown only if the session survived this turn.
      if (!entry.disposed) scheduleIdle(entry);
    }
  }

  async function disposeAll(): Promise<void> {
    const liveEntries = [...live.values()];
    live.clear();
    const pendingCreations = [...pending.values()];
    pending.clear();
    await Promise.all([
      ...liveEntries.map((e) => disposeEntry(e)),
      // A creation still in flight: await it, then dispose whatever it produced.
      ...pendingCreations.map((p) => p.then((e) => disposeEntry(e)).catch(() => {})),
    ]);
  }

  return { run, disposeAll, size: () => live.size };
}
