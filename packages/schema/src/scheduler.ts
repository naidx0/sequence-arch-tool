/**
 * The pure program-graph SCHEDULER — v14's graph-walking runtime.
 *
 * Given a {@link Program} (the model in `program.ts`) plus INJECTED executors
 * for the two non-deterministic node kinds (`agent`, `command`), this walks the
 * control-flow graph deterministically and returns an honest {@link RunResult}.
 *
 * THE SEAM (why this is unit-testable with zero network): the ONLY
 * non-deterministic work — a real metered AI call or a terminal command — is
 * supplied by the caller as a {@link NodeExecutor}. Tests inject mocks; the web
 * package will later inject the gateway (agent) and terminal (command). Nothing
 * in this file touches fs/network/LLM. Control flow (seq/parallel/branch/loop)
 * is DETERMINISTIC CODE here; branches/loops read a typed predicate over shared
 * state — never an LLM guess.
 *
 * HONEST STATUS (v13's delivery-truth, carried forward): a node emits `done`
 * ONLY after its injected executor actually resolves `ok`. A thrown/rejected
 * executor emits `error`, is recorded, and (per policy) stops the run or the
 * branch — never a fabricated `done`.
 *
 * NO HANG, FOR REAL: three independent brakes force a LOUD stop instead of an
 * infinite (or wedged) walk, and — the v14-review fix — they now bite EVEN WHILE
 * a single executor is awaiting, not only between nodes:
 *  - a global step budget (`maxSteps`) and a per-loop `maxIterations` cap bound
 *    the *number* of node visits;
 *  - a wall-clock budget (`timeoutMs`) bounds *elapsed time* — each executor
 *    await is RACED against the remaining budget, so a `command` node whose
 *    `whenDelivered` never resolves can no longer wedge the run forever; on
 *    timeout the node is recorded honestly (`error`) and the run ends `stopped`;
 *  - a caller `AbortSignal` (`opts.signal`) — Stop in the UI — aborts the run:
 *    no new node work is launched, an in-flight await is abandoned (and the
 *    signal is handed to executors via `ctx.signal` so abortable transports —
 *    fetch, a queued terminal command — cancel their own work), and the run
 *    resolves `stopped`. This is what makes "Stop" actually stop metered spend.
 *
 * SINGLE-EXECUTION (v14-review fix): each node runs AT MOST ONCE per forward
 * pass. Two parallel branches that reconverge on a shared descendant (a diamond,
 * or a shared `end` when a parallel node has no seq join) execute that node
 * exactly once — no double metered calls, no double events. Loop bodies are the
 * intended exception: each loop ITERATION opens a fresh visit epoch, so a body
 * legitimately repeats across iterations while a single pass can never
 * double-run a reconvergence node (see `visitEpoch`).
 */

import {
  evalPredicate,
  type Program,
  type ProgramNode,
  type ProgramEdge,
  type ProgramState,
} from './program.js';
import type { ArchGraph } from './index.js';
import { checkGraphMutation, parseClaimedNodeIds } from './graphChecker.js';

/** Live status of a single node as the graph executes. */
export type NodeStatus = 'queued' | 'running' | 'done' | 'error';

/** A streamed status event — the UI lights up the graph from these. */
export interface RunEvent {
  nodeId: string;
  status: NodeStatus;
  /** Wall-clock (or injected-clock) timestamp of the transition. */
  at: number;
  /** Present only on an `error` event: the executor's honest error string. */
  error?: string;
  /**
   * Measured sidecar on a terminal event — e.g. allowlisted command
   * `exit N` + truncated stdout. Never invent; omit when there is nothing measured.
   */
  detail?: string;
}

/**
 * Context handed to every injected executor. Minimal on purpose — the executor
 * gets the node, the live state (see below), and this. `steps` is the global
 * step index at which this node ran (for tracing/telemetry).
 */
export interface ExecContext {
  steps: number;
  /**
   * The run's abort signal, when the caller passed `opts.signal`. Abortable
   * executors (a fetch-backed AI call, a queued terminal command) SHOULD observe
   * it and cancel their own in-flight/pending work when it fires, so a stopped
   * run stops spending — the scheduler already abandons the await regardless.
   */
  signal?: AbortSignal;
}

/**
 * The INJECTED work seam. Resolves `{ ok: true, value?, detail? }` on success
 * (the value is written into state at the node's `outKey`, if any; `detail` is
 * recorded on the NodeResult for Activity) or `{ ok: false, error }` on a
 * handled failure. THROWING/REJECTING is also honored — it is caught and
 * treated as an error with the thrown message (so a real executor need not be
 * defensive). It is never assumed to have succeeded.
 *
 * Note the executor receives the SAME mutable state object the scheduler holds;
 * reads see prior nodes' writes. It should treat state as read-mostly and let
 * the scheduler perform the `outKey` write from its returned `value`.
 */
export type NodeExecutor = (
  node: ProgramNode,
  state: ProgramState,
  ctx: ExecContext
) => Promise<
  { ok: true; value?: unknown; detail?: string } | { ok: false; error: string }
>;

/** The two injected executors, one per non-deterministic node kind. */
export interface ProgramExecutors {
  agent: NodeExecutor;
  command: NodeExecutor;
}

/** What to do when a node's executor errors. */
export type ErrorPolicy = 'stop-run' | 'continue-siblings';

/**
 * Durable mid-run snapshot (harness W4). Serialize to localStorage / disk; on
 * soft restart, pass back via {@link RunOptions.resume} to continue without
 * re-running completed nodes. Partial failure: retry specific nodes via
 * `retryNodeIds` while keeping sibling successes.
 */
export interface RunCheckpoint {
  version: 1;
  programId: string;
  /** paused = user/soft halt, resumable; stopped = budget/abort (also resumable). */
  status: 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  state: ProgramState;
  nodeResults: Record<string, NodeResult>;
  steps: number;
  notes: RunNote[];
  /** Node ids that finished `done` — skipped on resume unless listed in retryNodeIds. */
  completedNodeIds: string[];
  updatedAt: number;
}

export interface RunOptions {
  /** Emitted on every node status transition, in order. */
  onEvent?: (evt: RunEvent) => void;
  /** Emitted for each loud run-level signal (e.g. a loop hitting its cap). */
  onNote?: (note: RunNote) => void;
  /** Hard cap on executed steps (node visits). Exceeded ⇒ loud 'stopped'. */
  maxSteps?: number;
  /** Hard wall-clock budget in ms. Exceeded ⇒ loud 'stopped'. */
  timeoutMs?: number;
  /**
   * Extra halt hook (harness W2): return true to stop the run loudly as
   * 'stopped' with budget reason — used for token/$ ceilings without embedding
   * metering in the pure scheduler.
   */
  shouldStop?: () => boolean;
  /**
   * Harness W4: return true to pause (status 'paused') — resumable from the
   * last checkpoint. Distinct from abort/budget stop.
   */
  shouldPause?: () => boolean;
  /**
   * Harness W4: resume from a prior checkpoint. Completed nodes are skipped
   * (state already applied); `retryNodeIds` force re-execution after a partial
   * failure.
   */
  resume?: {
    checkpoint: RunCheckpoint;
    retryNodeIds?: readonly string[];
  };
  /** Emitted after each node reaches a terminal status (done/error) — persist this. */
  onCheckpoint?: (cp: RunCheckpoint) => void;
  /**
   * Real ArchGraph for `checker` nodes (harness W1). Absent ⇒ checker nodes
   * error honestly ("no grounded graph").
   */
  groundedGraph?: ArchGraph;
  /** stop-run (default): first error halts everything. continue-siblings: let
   *  concurrent branches finish; the run still ends 'failed'. */
  onError?: ErrorPolicy;
  /** Injectable clock (tests pass a fake for deterministic timestamps/timeouts). */
  now?: () => number;
  /**
   * Caller abort (the UI's Stop). When it fires the run launches NO further node
   * work, abandons any in-flight executor await, and resolves `stopped`. The
   * signal is threaded to executors via {@link ExecContext.signal} so abortable
   * transports cancel their own work — the honest way to actually stop metered
   * spend, not merely stop watching.
   */
  signal?: AbortSignal;
}

/** Per-node terminal outcome recorded across the whole run. */
export interface NodeResult {
  status: 'done' | 'error';
  error?: string;
  /**
   * Optional measured sidecar (command exit + stdout). Distinct from `error`:
   * a `done` node may still carry detail the Activity pane must show.
   */
  detail?: string;
}

/**
 * A distinct, honest run-level signal that is neither a plain `done` nor an
 * `error`. Two cases:
 *
 *   loop-cap-reached  a loop that exited by hitting its `maxIterations` cap
 *                     while its predicate was STILL TRUE (a forced exit), which
 *                     must be distinguishable from a natural predicate-false
 *                     exit. The plan promised loops exit "loudly"; this is how.
 *   paused            a person asked the run to stop resumably. Recorded as an
 *                     intent when it is REQUESTED, not when the halt lands, so
 *                     the durable log says what was asked for even when the
 *                     scheduler stops on the very next boundary — the same
 *                     reason `run:cancelled` is committed before the abort.
 *
 * Also mirrored on `opts.onNote` for the UI.
 */
export interface RunNote {
  nodeId: string;
  kind: 'loop-cap-reached' | 'paused';
  detail?: string;
}

/** The honest result of a whole run. */
export interface RunResult {
  /** completed = walked to natural end, no errors; failed = a node errored;
   *  stopped = a budget/time guard, an executor-await timeout, or a caller
   *  abort (Stop) forced a loud halt; paused = shouldPause (resumable). */
  status: 'completed' | 'failed' | 'stopped' | 'paused';
  finalState: ProgramState;
  nodeResults: Record<string, NodeResult>;
  /** Total steps (node visits) executed. */
  steps: number;
  /** Loud, distinct run-level signals (e.g. a loop that hit its cap). */
  notes: RunNote[];
  /** Last durable snapshot — persist to survive soft restart. */
  checkpoint: RunCheckpoint;
}

/** Build a checkpoint from live run fields. */
export function buildCheckpoint(
  programId: string,
  status: RunCheckpoint['status'],
  state: ProgramState,
  nodeResults: Record<string, NodeResult>,
  steps: number,
  notes: RunNote[],
  now: () => number,
): RunCheckpoint {
  const completedNodeIds = Object.entries(nodeResults)
    .filter(([, r]) => r.status === 'done')
    .map(([id]) => id);
  return {
    version: 1,
    programId,
    status,
    state: { ...state },
    nodeResults: { ...nodeResults },
    steps,
    notes: [...notes],
    completedNodeIds,
    updatedAt: now(),
  };
}

/** Seed the shared store from the program's (and any state node's) declaration. */
function initState(program: Program): ProgramState {
  const state: ProgramState = {};
  if (program.state?.initial) Object.assign(state, program.state.initial);
  for (const n of program.nodes) {
    if (n.kind === 'state' && n.state?.initial) Object.assign(state, n.state.initial);
  }
  return state;
}

/**
 * Run a program. Walks from the single `start` node:
 *  - `seq` edges run their target next, in order;
 *  - a `parallel` node fans its outgoing `parallel` edges out CONCURRENTLY via
 *    `Promise.all` and joins before following its own `seq` edge;
 *  - a `branch` evaluates its predicate over state and follows branch-true /
 *    branch-false;
 *  - a `loop` repeats its `loop-body` WHILE the predicate holds, capped at
 *    `maxIterations` (then exits loudly), before following its `seq` exit;
 *  - `agent` / `command` call the injected executor and, on success, write the
 *    returned value into state at `outKey`.
 *
 * Deterministic control flow; the only non-determinism is the injected work.
 */
export async function runProgram(
  program: Program,
  executors: ProgramExecutors,
  opts: RunOptions = {}
): Promise<RunResult> {
  const now = opts.now ?? Date.now;
  const emit = (
    nodeId: string,
    status: NodeStatus,
    error?: string,
    detail?: string,
  ): void => {
    opts.onEvent?.({
      nodeId,
      status,
      at: now(),
      ...(error !== undefined ? { error } : {}),
      ...(detail !== undefined && detail !== '' ? { detail } : {}),
    });
  };
  const notes: RunNote[] = [];
  const note = (n: RunNote): void => {
    notes.push(n);
    opts.onNote?.(n);
  };
  const errorPolicy: ErrorPolicy = opts.onError ?? 'stop-run';
  const deadline = opts.timeoutMs !== undefined ? now() + opts.timeoutMs : undefined;
  const signal = opts.signal;

  const resumeCp = opts.resume?.checkpoint;
  const retrySet = new Set(opts.resume?.retryNodeIds ?? []);
  const skipDone = new Set(
    (resumeCp?.completedNodeIds ?? []).filter((id) => !retrySet.has(id)),
  );

  const state = resumeCp ? { ...resumeCp.state } : initState(program);
  // On retry of failed nodes, drop their prior error results so they re-run cleanly.
  const nodeResults: Record<string, NodeResult> = resumeCp
    ? Object.fromEntries(
        Object.entries(resumeCp.nodeResults).filter(([id]) => !retrySet.has(id)),
      )
    : {};
  // Seed visited for skipped-done nodes so reconvergence still single-executes.
  const visited = new Set<string>();
  let visitEpoch = 0;
  const visitKey = (id: string): string => `${visitEpoch}\0${id}`;
  // skipDone is consumed as we walk — so a later loop iteration can re-run body nodes.

  const nodeById = new Map(program.nodes.map((n) => [n.id, n]));

  // Outgoing edges per node, in declared order (stable, deterministic).
  const outByNode = new Map<string, ProgramEdge[]>();
  for (const e of program.edges) {
    const list = outByNode.get(e.from);
    if (list) list.push(e);
    else outByNode.set(e.from, [e]);
  }
  const outOf = (id: string): ProgramEdge[] => outByNode.get(id) ?? [];
  const firstEdge = (id: string, kind: ProgramEdge['kind']): ProgramEdge | undefined =>
    outOf(id).find((e) => e.kind === kind);

  let steps = resumeCp?.steps ?? 0;
  if (resumeCp?.notes?.length) notes.push(...resumeCp.notes);
  let failed = Object.values(nodeResults).some((r) => r.status === 'error');
  // 'budget' | 'time' | 'aborted' | 'paused' → loud halt; undefined otherwise.
  let stopReason: 'budget' | 'time' | 'aborted' | 'paused' | undefined;
  // Hard halt (guard stop, abort, OR a stop-run error): no further nodes execute.
  let halted = false;

  const snapshot = (status: RunCheckpoint['status']): RunCheckpoint => {
    const cp = buildCheckpoint(program.id, status, state, nodeResults, steps, notes, now);
    opts.onCheckpoint?.(cp);
    return cp;
  };

  /** Budget/time/abort/pause guard, checked before each node body runs. true = stop. */
  const guardTripped = (): boolean => {
    if (halted) return true;
    if (signal?.aborted) {
      stopReason = 'aborted';
      halted = true;
      return true;
    }
    if (opts.shouldPause?.()) {
      stopReason = 'paused';
      halted = true;
      return true;
    }
    if (opts.maxSteps !== undefined && steps >= opts.maxSteps) {
      stopReason = 'budget';
      halted = true;
      return true;
    }
    if (deadline !== undefined && now() >= deadline) {
      stopReason = 'time';
      halted = true;
      return true;
    }
    // W2: caller token/$ ceiling (or any external halt) — same loud 'stopped'.
    if (opts.shouldStop?.()) {
      stopReason = 'budget';
      halted = true;
      return true;
    }
    return false;
  };

  /**
   * Await an executor, but RACE it against the run's remaining time budget AND
   * the abort signal so a wedged executor (a `command` whose `whenDelivered`
   * never resolves) can no longer block forever (Finding B). Returns a tagged
   * outcome; the executor's own resolve/throw is captured (never lost) so the
   * scheduler still records honest success/error when it wins the race.
   */
  type ExecOutcome =
    | {
        kind: 'ok';
        value: { ok: true; value?: unknown; detail?: string } | { ok: false; error: string };
      }
    | { kind: 'throw'; error: string }
    | { kind: 'aborted' }
    | { kind: 'timeout' };

  const raceExecutor = (
    work: Promise<{ ok: true; value?: unknown; detail?: string } | { ok: false; error: string }>,
  ): Promise<ExecOutcome> => {
    if (signal?.aborted) return Promise.resolve({ kind: 'aborted' });
    const settled: Promise<ExecOutcome> = work.then(
      (value) => ({ kind: 'ok', value }) as ExecOutcome,
      (err) => ({ kind: 'throw', error: err instanceof Error ? err.message : String(err) }) as ExecOutcome
    );
    const racers: Promise<ExecOutcome>[] = [settled];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    if (signal) {
      racers.push(
        new Promise<ExecOutcome>((res) => {
          onAbort = () => res({ kind: 'aborted' });
          signal.addEventListener('abort', onAbort, { once: true });
        })
      );
    }
    if (deadline !== undefined) {
      const remaining = Math.max(0, deadline - now());
      racers.push(
        new Promise<ExecOutcome>((res) => {
          timer = setTimeout(() => res({ kind: 'timeout' }), remaining);
        })
      );
    }
    return Promise.race(racers).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort && signal) signal.removeEventListener('abort', onAbort);
    });
  };

  /** Record a loud abort/timeout of a node mid-await: honest `error` status, but
   *  the run status is driven by `stopReason` ('stopped'), NOT `failed`. */
  const recordStopped = (nodeId: string, reason: 'aborted' | 'time', message: string): void => {
    nodeResults[nodeId] = { status: 'error', error: message };
    emit(nodeId, 'error', message);
    stopReason = reason;
    halted = true;
    snapshot(reason === 'aborted' || reason === 'time' ? 'stopped' : 'stopped');
  };

  /** Record + emit an executor error, applying the error policy. */
  const recordError = (nodeId: string, error: string): void => {
    nodeResults[nodeId] = { status: 'error', error };
    emit(nodeId, 'error', error);
    failed = true;
    if (errorPolicy === 'stop-run') halted = true;
    snapshot(halted ? 'failed' : 'running');
  };

  const markDone = (nodeId: string, detail?: string): void => {
    nodeResults[nodeId] = {
      status: 'done',
      ...(detail !== undefined && detail !== '' ? { detail } : {}),
    };
    emit(nodeId, 'done', undefined, detail);
    snapshot('running');
  };

  /**
   * Resume path: node already `done` in a prior checkpoint — do not re-execute
   * (no double metered spend), but follow outgoing edges so the walk continues.
   */
  const followCompleted = async (node: ProgramNode, stopAt?: string): Promise<void> => {
    switch (node.kind) {
      case 'start':
      case 'state':
      case 'agent':
      case 'command':
      case 'checker': {
        const next = firstEdge(node.id, 'seq');
        if (next) await execFrom(next.to, stopAt);
        return;
      }
      case 'end':
        return;
      case 'parallel': {
        const branches = outOf(node.id).filter((e) => e.kind === 'parallel');
        const join = firstEdge(node.id, 'seq');
        const joinId = join?.to;
        await Promise.all(branches.map((e) => execFrom(e.to, joinId)));
        if (!halted && joinId) await execFrom(joinId, stopAt);
        return;
      }
      case 'branch': {
        const cond = node.branch ? evalPredicate(node.branch.condition, state) : false;
        const next = firstEdge(node.id, cond ? 'branch-true' : 'branch-false');
        if (next && !halted) await execFrom(next.to, stopAt);
        return;
      }
      case 'loop': {
        // Loop was fully done in the prior segment — take the seq exit only.
        const exit = firstEdge(node.id, 'seq');
        if (exit && !halted) await execFrom(exit.to, stopAt);
        return;
      }
      default:
        return;
    }
  };

  /**
   * Execute the node `nodeId` and its natural downstream. `stopAt` bounds a
   * sub-walk: reaching it returns control WITHOUT executing it (used so a
   * parallel branch stops at the join, and a loop body stops at the loop head
   * on its loop-back edge). Recursion depth is bounded by the graph's acyclic
   * structure (the only cycles are loop-backs, which stopAt terminates).
   */
  const execFrom = async (nodeId: string, stopAt?: string): Promise<void> => {
    if (halted) return;
    if (stopAt !== undefined && nodeId === stopAt) return;
    const node = nodeById.get(nodeId);
    if (!node) return;

    if (guardTripped()) return;

    // Single-execution (Finding C): a node reached again within THIS forward
    // pass (a reconvergence diamond, or a shared `end`) is a no-op — it already
    // ran, so it must not double-spend or double-emit. The check+claim is
    // synchronous (before any await), so two concurrent parallel branches racing
    // to a shared descendant resolve deterministically: the first claims it, the
    // second returns. A fresh `visitEpoch` per loop iteration keeps loop bodies
    // repeatable (see the loop case).
    const key = visitKey(nodeId);
    if (visited.has(key)) return;
    visited.add(key);

    // W4 resume: consume a prior-done skip, follow edges, no re-exec.
    if (skipDone.has(nodeId)) {
      skipDone.delete(nodeId);
      await followCompleted(node, stopAt);
      return;
    }

    switch (node.kind) {
      case 'start':
      case 'state': {
        // Structural: resolves synchronously, honestly done.
        emit(nodeId, 'queued');
        emit(nodeId, 'running');
        steps++;
        markDone(nodeId);
        const next = firstEdge(nodeId, 'seq');
        if (next) await execFrom(next.to, stopAt);
        return;
      }

      case 'end': {
        emit(nodeId, 'queued');
        emit(nodeId, 'running');
        steps++;
        markDone(nodeId);
        return; // terminal
      }

      case 'agent':
      case 'command': {
        emit(nodeId, 'queued');
        emit(nodeId, 'running'); // running BEFORE the await — honest
        const ctx: ExecContext = { steps, ...(signal ? { signal } : {}) };
        steps++;
        const executor = node.kind === 'agent' ? executors.agent : executors.command;
        // Race the executor against abort + the remaining time budget so a wedged
        // await (a command that never delivers) can't hang the run (Finding B),
        // and Stop abandons an in-flight call (Finding A). The executor's own
        // resolve/throw is preserved when it wins.
        const outcome = await raceExecutor(executor(node, state, ctx));
        if (outcome.kind === 'aborted') {
          recordStopped(nodeId, 'aborted', 'Stopped before this node completed.');
          return; // no fabricated done; no further work launched
        }
        if (outcome.kind === 'timeout') {
          recordStopped(nodeId, 'time', 'Timed out before this node completed.');
          return;
        }
        if (outcome.kind === 'throw') {
          recordError(nodeId, outcome.error);
          return; // branch stops; NO fabricated done
        }
        const result = outcome.value;
        if (!result.ok) {
          recordError(nodeId, result.error);
          return;
        }
        // Success: write outKey, then done (optional measured detail, e.g. command stdout).
        const outKey =
          node.kind === 'agent' ? node.agent?.outKey : node.command?.outKey;
        if (outKey !== undefined && result.value !== undefined) {
          state[outKey] = result.value;
        }
        markDone(nodeId, result.detail);
        const next = firstEdge(nodeId, 'seq');
        if (next && !halted) await execFrom(next.to, stopAt);
        return;
      }

      case 'checker': {
        // Grounded verifier — pure, no LLM. Needs opts.groundedGraph.
        emit(nodeId, 'queued');
        emit(nodeId, 'running');
        steps++;
        const cfg = node.checker;
        if (!cfg) {
          recordError(nodeId, 'checker node is missing checker config');
          return;
        }
        const graph = opts.groundedGraph;
        if (!graph) {
          recordError(nodeId, 'no grounded graph — checker cannot verify');
          return;
        }
        const claimed = parseClaimedNodeIds(state[cfg.claimedKey]);
        const verdict = checkGraphMutation(graph, { claimedNodeIds: claimed });
        state[cfg.outKey] = verdict.ok ? 'yes' : 'no';
        if (cfg.violationsKey) {
          state[cfg.violationsKey] = verdict.ok ? '' : verdict.violations.join('; ');
        }
        markDone(nodeId);
        const next = firstEdge(nodeId, 'seq');
        if (next && !halted) await execFrom(next.to, stopAt);
        return;
      }

      case 'parallel': {
        emit(nodeId, 'queued');
        emit(nodeId, 'running');
        steps++;
        const branches = outOf(nodeId).filter((e) => e.kind === 'parallel');
        const join = firstEdge(nodeId, 'seq');
        const joinId = join?.to;
        // Fan out CONCURRENTLY; each branch stops at the shared join (executed
        // once, below) so a join node is never run per-branch.
        await Promise.all(branches.map((e) => execFrom(e.to, joinId)));
        if (halted) {
          // A branch errored under stop-run (or a guard tripped) mid-fan-out:
          // the parallel node did NOT complete — never fabricate its `done`.
          return;
        }
        markDone(nodeId);
        if (joinId) await execFrom(joinId, stopAt);
        return;
      }

      case 'branch': {
        emit(nodeId, 'queued');
        emit(nodeId, 'running');
        steps++;
        const cond = node.branch
          ? evalPredicate(node.branch.condition, state)
          : false;
        markDone(nodeId);
        const next = firstEdge(nodeId, cond ? 'branch-true' : 'branch-false');
        if (next && !halted) await execFrom(next.to, stopAt);
        return;
      }

      case 'loop': {
        emit(nodeId, 'queued');
        emit(nodeId, 'running');
        steps++;
        const max = node.loop?.maxIterations ?? 0;
        const body = firstEdge(nodeId, 'loop-body');
        let i = 0;
        // Repeat WHILE the predicate holds, hard-capped at maxIterations.
        while (
          node.loop &&
          evalPredicate(node.loop.condition, state) &&
          i < max &&
          !halted
        ) {
          if (guardTripped()) break;
          // Fresh visit epoch per iteration: the body's nodes (incl. any
          // reconvergence diamond inside it) can run again this pass, while a
          // single pass still can't double-run a shared descendant.
          visitEpoch++;
          if (body) await execFrom(body.to, nodeId); // stopAt = loop head (loop-back returns)
          i++;
        }
        if (!halted) {
          // Loud cap (nit): the loop exhausted its iterations while the predicate
          // was STILL TRUE — a forced exit, not a natural predicate-false one.
          // Emit a distinct, honest signal so the two are never conflated.
          if (node.loop && max > 0 && i >= max && evalPredicate(node.loop.condition, state)) {
            note({
              nodeId,
              kind: 'loop-cap-reached',
              detail: `loop exited at its maxIterations cap (${max}) with the predicate still true`,
            });
          }
          markDone(nodeId);
          const exit = firstEdge(nodeId, 'seq');
          if (exit && !halted) await execFrom(exit.to, stopAt);
        }
        return;
      }

      default:
        return; // unknown kind: nothing to run
    }
  };

  const start = program.nodes.find((n) => n.kind === 'start');
  if (start) await execFrom(start.id);

  const status: RunResult['status'] =
    stopReason === 'paused'
      ? 'paused'
      : stopReason
        ? 'stopped'
        : failed
          ? 'failed'
          : 'completed';

  const checkpoint = snapshot(status);
  return { status, finalState: state, nodeResults, steps, notes, checkpoint };
}
