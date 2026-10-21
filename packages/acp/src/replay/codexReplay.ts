/* ══════════════════════════════════════════════════════════════════════════
   REPLAY A RECORDED AGENT SESSION IN PLACE OF THE AGENT PROCESS
   packages/acp/src/replay/codexReplay.ts

   T3 Code's approach (packages/effect-codex-app-server/src/replay.ts): only
   the provider process is replaced. Everything Sequence runs on top of it,
   the CodexAppServerClient adapter, the server's run-node stream, web2's run
   store, is the real code, fed the frames a real agent sent.

   HOW IT PLAYS. A cursor walks the fixture's frames in order.
     s2c   the agent spoke: the frame is written to the client after the
           recorded gap (on the replay's clock), with the client's own request
           id put back on a response.
     c2s   the client must speak: the replay waits until the client writes a
           message, checks it is the one the recording has here (same method;
           for an answer to an agent's request, the same id), and moves on.
   A message that is not what the recording expects is a DIVERGENCE: it is
   listed in `divergences`, and the replay stops rather than replay frames
   that no longer follow from what the client did. A test asserts the list is
   empty; that is what "the adapter behaves as it did against the real agent"
   means here.

   TWO WAYS TO RUN IT.
     `spawn`      an in-process child (stdin, stdout, stderr streams, kill,
                  exit) for `AcpClientConfig.spawn`, on any clock. With a
                  ManualClock, `drain()` fires the recorded gaps without
                  waiting for them.
     bin/codex.js a real process speaking stdio, for code that spawns the
                  agent itself (the analyzer's server): register it as the
                  agent's command.
   ══════════════════════════════════════════════════════════════════════════ */

import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type childProcess from 'node:child_process';

import { settle, systemClock, type ReplayClock, ManualClock } from './clock.js';
import { substitute, type Fixture, type Frame, type Json } from './fixture.js';

export interface ReplayOptions {
  /** The clock the recorded gaps are kept on. Default: the real one, at speed 0 (no gaps). */
  clock?: ReplayClock;
  /** 0 plays every gap as zero; 1 plays recorded time. Ignored by a ManualClock, which always keeps the gaps. */
  speed?: number;
  /** Placeholder -> value for this run, e.g. { '<CWD>': theTestsDir }. */
  values?: Record<string, string>;
}

export interface ReplayState {
  /** Frames played or matched so far. */
  cursor: number;
  total: number;
  /** True once every frame has been played. */
  finished: boolean;
  /** What the client did that the recording did not. Empty on a faithful replay. */
  divergences: string[];
  /** Every message the client sent, as received (placeholders put back). */
  received: Json[];
}

/**
 * The replay itself, IO-agnostic: `onSend` writes a line to the client,
 * `receive` takes a line from it.
 */
export class CodexReplay {
  readonly fixture: Fixture;
  private readonly clock: ReplayClock;
  private readonly speed: number;
  private readonly toLive: [string, string][];
  private readonly toRecorded: [string, string][];
  private cursor = 0;
  private lastT = 0;
  private inbox: Json[] = [];
  private waitingTimer: unknown = null;
  private stopped = false;
  /** recorded client request id -> the id this client used. */
  private readonly ids = new Map<unknown, unknown>();
  private activity = 0;
  readonly divergences: string[] = [];
  readonly received: Json[] = [];
  onSend: (line: string) => void = () => {};
  /** Called once when the last frame has played. */
  onFinished: () => void = () => {};

  constructor(fixture: Fixture, opts: ReplayOptions = {}) {
    this.fixture = fixture;
    this.clock = opts.clock ?? systemClock;
    this.speed = opts.clock instanceof ManualClock ? 1 : (opts.speed ?? 0);
    const values = opts.values ?? {};
    this.toLive = Object.entries(values);
    this.toRecorded = Object.entries(values).map(([k, v]) => [v, k]);
  }

  get state(): ReplayState {
    return {
      cursor: this.cursor,
      total: this.fixture.frames.length,
      finished: this.cursor >= this.fixture.frames.length,
      divergences: [...this.divergences],
      received: [...this.received],
    };
  }

  /** A counter that changes whenever the replay does anything (for `settle`). */
  get version(): number {
    return this.activity;
  }

  /** True while the next frame is the client's turn and it has not spoken. */
  get waitingOnClient(): boolean {
    const f = this.fixture.frames[this.cursor];
    return !this.stopped && f !== undefined && f.dir === 'c2s' && this.inbox.length === 0;
  }

  start(): void {
    this.pump();
  }

  /** One line the client wrote. */
  receive(line: string): void {
    if (!line.trim()) return;
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      this.diverge(`the client wrote a line that is not JSON: ${line.slice(0, 120)}`);
      return;
    }
    this.activity += 1;
    this.received.push(msg);
    this.inbox.push(substitute(msg, this.toRecorded));
    this.pump();
  }

  stop(): void {
    this.stopped = true;
    if (this.waitingTimer !== null) this.clock.clearTimeout(this.waitingTimer);
    this.waitingTimer = null;
  }

  private diverge(why: string): void {
    this.divergences.push(`frame ${this.cursor + 1}: ${why}`);
    this.activity += 1;
    this.stop();
  }

  private pump(): void {
    while (!this.stopped && this.waitingTimer === null) {
      const frame = this.fixture.frames[this.cursor];
      if (!frame) {
        this.activity += 1;
        this.onFinished();
        return;
      }
      if (frame.dir === 'c2s') {
        const got = this.inbox.shift();
        if (!got) return;
        if (!this.matches(frame, got)) return;
        this.cursor += 1;
        this.lastT = frame.t;
        this.activity += 1;
        continue;
      }
      const gap = Math.max(0, frame.t - this.lastT) * this.speed;
      if (gap > 0) {
        this.waitingTimer = this.clock.setTimeout(() => {
          this.waitingTimer = null;
          this.emit(frame);
          this.pump();
        }, gap);
        return;
      }
      this.emit(frame);
    }
  }

  private emit(frame: Frame): void {
    let msg = substitute(frame.msg, this.toLive);
    if (msg.method === undefined && msg.id !== undefined) {
      /* A response to the client: give it the client's own request id. */
      if (!this.ids.has(msg.id)) {
        this.diverge(`a recorded response to request ${String(msg.id)}, which this client never sent`);
        return;
      }
      msg = { ...msg, id: this.ids.get(msg.id) };
    }
    this.cursor += 1;
    this.lastT = frame.t;
    this.activity += 1;
    this.onSend(JSON.stringify(msg));
  }

  private matches(frame: Frame, got: Json): boolean {
    const want = frame.msg;
    if (typeof want.method === 'string') {
      if (got.method !== want.method) {
        this.diverge(`expected the client to send ${want.method}, it sent ${String(got.method ?? 'a response')}`);
        return false;
      }
      if (want.id !== undefined) {
        if (got.id === undefined) {
          this.diverge(`${want.method} should be a request, the client sent a notification`);
          return false;
        }
        this.ids.set(want.id, got.id);
      }
      return true;
    }
    /* An answer to one of the agent's requests. */
    if (got.method !== undefined || got.id !== want.id) {
      this.diverge(`expected the answer to request ${String(want.id)}, got ${String(got.method ?? `an answer to ${String(got.id)}`)}`);
      return false;
    }
    /* codex answers { decision }, ACP answers { outcome: { outcome, optionId } }. */
    const answerOf = (r: unknown): unknown => {
      const x = r as { decision?: unknown; outcome?: { outcome?: unknown; optionId?: unknown } } | undefined;
      return x?.decision ?? x?.outcome?.optionId ?? x?.outcome?.outcome;
    };
    const wantDecision = answerOf(want.result);
    const gotDecision = answerOf(got.result);
    if (wantDecision !== undefined && wantDecision !== gotDecision) {
      this.diverge(`the recording answered request ${String(want.id)} with ${String(wantDecision)}, the client answered ${String(gotDecision)}`);
      return false;
    }
    /* codex's question (item/tool/requestUserInput) is answered { answers }: the same answers, in the same order. */
    const wantAnswers = (want.result as { answers?: unknown } | undefined)?.answers;
    if (wantAnswers !== undefined) {
      const gotAnswers = (got.result as { answers?: unknown } | undefined)?.answers;
      if (JSON.stringify(wantAnswers) !== JSON.stringify(gotAnswers)) {
        this.diverge(`the recording answered request ${String(want.id)} with ${JSON.stringify(wantAnswers)}, the client answered ${JSON.stringify(gotAnswers ?? got.error ?? null)}`);
        return false;
      }
    }
    return true;
  }

  /**
   * Run the replay until it has nothing left to do on its own: every frame
   * played, or the client's turn and it has not spoken, or a divergence. On a
   * ManualClock the recorded gaps are fired as they come due. Never sleeps.
   */
  async drain(): Promise<void> {
    for (let guard = 0; guard < 100_000; guard++) {
      await settle(() => this.activity);
      const manual = this.clock instanceof ManualClock ? this.clock : null;
      if (this.waitingTimer !== null && manual) {
        manual.step();
        continue;
      }
      return;
    }
    throw new Error('drain: the replay did not come to rest');
  }
}

/* ── the in-process child ──────────────────────────────────────────────── */

export interface ReplayChild extends EventEmitter {
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface ReplayHandle {
  replay: CodexReplay;
  /** For `AcpClientConfig.spawn`. Each call starts a fresh replay of the same fixture. */
  spawn: typeof childProcess.spawn;
  /** The argv the client spawned with, per spawn. */
  spawned: { command: string; args: readonly string[] }[];
  drain(): Promise<void>;
}

/** A replay as a child process, for `AcpClientConfig.spawn`. */
export function replaySpawn(fixture: Fixture, opts: ReplayOptions = {}): ReplayHandle {
  const handle: ReplayHandle = {
    replay: new CodexReplay(fixture, opts),
    spawned: [],
    spawn: undefined as unknown as typeof childProcess.spawn,
    drain: () => handle.replay.drain(),
  };
  let first = true;
  const spawn = ((command: string, args: readonly string[] = []) => {
    handle.spawned.push({ command, args });
    if (!first) handle.replay = new CodexReplay(fixture, opts);
    first = false;
    const replay = handle.replay;
    const child = new EventEmitter() as ReplayChild;
    let buffer = '';
    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        buffer += String(chunk);
        let cut: number;
        while ((cut = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 1);
          replay.receive(line);
        }
        cb();
      },
    });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 40000 + handle.spawned.length;
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    child.kill = (signal: NodeJS.Signals | number = 'SIGTERM') => {
      if (child.exitCode !== null || child.signalCode !== null) return false;
      child.killed = true;
      replay.stop();
      child.signalCode = typeof signal === 'string' ? signal : 'SIGTERM';
      setImmediate(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit('exit', null, child.signalCode);
        child.emit('close', null, child.signalCode);
      });
      return true;
    };
    replay.onSend = (line) => child.stdout.write(line + '\n');
    setImmediate(() => replay.start());
    return child as unknown as childProcess.ChildProcess;
  }) as unknown as typeof childProcess.spawn;
  handle.spawn = spawn;
  return handle;
}
