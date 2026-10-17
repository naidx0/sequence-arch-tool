/* ══════════════════════════════════════════════════════════════════════════
   A TURN IS DONE WHEN THE AGENT SAYS SO; A TURN IS HUNG WHEN IT STOPS MOVING
   packages/acp/src/turnWatchdog.ts

   Design after Synara's acp/AcpTurnIdleWatchdog.ts (github.com/Emanuele-web04/
   synara, MIT, Copyright (c) Emanuele Di Pietro), as the build spec describes
   it (lab/specs/build-spec-parts-4-7.html, Part 6). Written here from that
   description; no Synara source was copied.

   Three states a turn can end in, kept apart:
     ended    the agent answered the turn (session/prompt returned a stop
              reason, or codex sent turn/completed). Only the agent decides it.
     settled  the server has finished with the ended turn: the agent's thread
              is recorded, the stream is closed. Nothing is still moving.
     hung     no REAL progress for `idleMs` while nobody was being asked a
              question. This is a backstop, not a deadline: there is no cap on
              how long a turn may run, only on how long it may sit still.

   PROGRESS is what the agent did (text, a tool call starting, finishing or
   printing, a plan step). Heartbeats (token usage, rate limits, status
   changes, MCP startup) are not progress: a turn that only heartbeats is
   still stuck. The client decides which is which (`onProgress`).

   PAUSED while an approval waits on a person: a question unanswered for an
   hour is the person's time, not the agent's. Pauses nest (two approvals at
   once), and the idle countdown starts afresh when the last one resolves.

   The clock is injectable so a test moves time instead of waiting for it.
   ══════════════════════════════════════════════════════════════════════════ */

export interface WatchdogClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemWatchdogClock: WatchdogClock = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    /* A watchdog never keeps the process alive on its own. */
    (t as { unref?: () => void }).unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Default: ten minutes without progress, and nobody asked anything. */
export const TURN_IDLE_MS = 10 * 60_000;

export type WatchdogState = 'running' | 'paused' | 'hung' | 'stopped';

export interface TurnWatchdogOptions {
  idleMs?: number;
  clock?: WatchdogClock;
  /** Called once, when the turn has sat still for `idleMs`. */
  onHung: (idleMs: number) => void;
}

export class TurnWatchdog {
  readonly idleMs: number;
  private readonly clock: WatchdogClock;
  private readonly onHung: (idleMs: number) => void;
  private timer: unknown = null;
  private pauses = 0;
  private current: WatchdogState = 'running';

  constructor(opts: TurnWatchdogOptions) {
    this.idleMs = opts.idleMs ?? TURN_IDLE_MS;
    this.clock = opts.clock ?? systemWatchdogClock;
    this.onHung = opts.onHung;
    this.arm();
  }

  get state(): WatchdogState {
    return this.current;
  }

  /** The agent did something real: the idle countdown starts over. */
  progress(): void {
    if (this.current === 'running') this.arm();
  }

  /**
   * A person is being asked something: no countdown until every pause is
   * released. Returns the release; calling it twice releases once.
   */
  pause(): () => void {
    if (this.current === 'hung' || this.current === 'stopped') return () => {};
    this.pauses += 1;
    this.current = 'paused';
    this.disarm();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pauses -= 1;
      if (this.pauses === 0 && this.current === 'paused') {
        this.current = 'running';
        this.arm();
      }
    };
  }

  /** The turn ended (or failed): the watchdog has nothing left to watch. */
  stop(): void {
    if (this.current === 'hung') return;
    this.current = 'stopped';
    this.disarm();
  }

  private arm(): void {
    this.disarm();
    if (!Number.isFinite(this.idleMs) || this.idleMs <= 0) return;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      if (this.current !== 'running') return;
      this.current = 'hung';
      this.onHung(this.idleMs);
    }, this.idleMs);
  }

  private disarm(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * ACP `session/update` kinds that are the agent doing something. Everything
 * else (`available_commands_update`, `current_mode_update`, `usage_update`,
 * `config_option_update`, `session_info_update`) is bookkeeping.
 */
const ACP_PROGRESS = new Set(['agent_message_chunk', 'agent_thought_chunk', 'user_message_chunk', 'tool_call', 'tool_call_update', 'plan']);

export function isAcpProgress(sessionUpdate: string): boolean {
  return ACP_PROGRESS.has(sessionUpdate);
}

/**
 * Codex app-server notifications that are the agent doing something: any
 * item or turn event (deltas, a tool starting or finishing or printing, the
 * plan, the diff). Thread status, token usage, rate limits, MCP startup and
 * warnings are heartbeats.
 */
export function isCodexProgress(method: string): boolean {
  return method.startsWith('item/') || method.startsWith('turn/');
}
