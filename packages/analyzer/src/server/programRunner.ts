/**
 * P8 — the LIVE half of server-side program runs.
 *
 * THE GAP THIS CLOSES, stated as the plan states it: `runProgram` executed in
 * the BROWSER, so there was no run id, no run list, no server resume, and
 * closing the tab killed a run. `docs/CANON.md` marks "we're better at agent
 * workflows" as ✗ NOT TRUE for exactly this reason.
 *
 * THE ONE STRUCTURAL RULE: **a run's lifetime is not a request's lifetime.**
 * `POST /api/program/run` registers a run and returns; the driver below keeps
 * going with no reader attached. Everything else follows from that:
 *
 *  - The run's `AbortSignal` comes from THIS module's own `AbortController`, not
 *    from `requestAbort(res)`. Wiring the request's signal in would have made
 *    every disconnect a cancellation, which is precisely the bug being fixed.
 *  - Stopping a run is therefore an explicit act: `POST /api/program/runs/:id/cancel`.
 *  - Watching a run is a separate, resumable act: the SSE feed, replayable from
 *    `since=` because every event is committed to the durable log in
 *    `programRunStore.ts` BEFORE any subscriber sees it.
 *
 * CANCELLATION REUSES WAVE 1'S MECHANISM AND INVENTS NOTHING. Wave 1 item 1.3
 * threaded an `AbortSignal` down to the metered provider wrapper and made the
 * charge lose the race (`repoServer.ts`'s `raceAbort` / `callProviderMeteredWithUsage`).
 * The scheduler in `@sequence/schema` already accepts `opts.signal` and already
 * hands it to executors as `ctx.signal`. So cancel here is: abort one controller
 * → the scheduler launches no further node work and abandons the in-flight await
 * → the gateway executor's provider call loses the race → `recordUse` is never
 * reached. There is no second cancellation path, and no metering code in this
 * file at all.
 *
 * WHAT THIS MODULE DOES NOT DO, AND WHAT IT NOW DOES. It still does not resume
 * a run BY ITSELF across a process restart: nothing sweeps `.sequence/` at boot
 * and quietly picks work back up, so a run whose process went away is still
 * reported `interrupted`, with its last real checkpoint, and never `running`.
 * That remains an honest absence rather than a fabricated continuation.
 *
 * What changed is that `interrupted` is no longer a DEAD END. `resume` used to
 * accept `paused` alone, which meant a run halted by its own budget or by a
 * dev-server restart had a complete checkpoint on disk and no way to use it —
 * the only recovery was to start over and pay again. `resume` now picks up any
 * of `paused` / `stopped` / `interrupted`, and `retry` additionally picks up
 * `failed` while re-running named nodes. Both are still an EXPLICIT act by a
 * caller; neither happens on its own.
 */

import {
  runProgram,
  type ArchGraph,
  type NodeExecutor,
  type Program,
  type ProgramExecutors,
  type ProgramState,
  type NodeResult,
  type RunCheckpoint,
  type RunNote,
  type RunResult,
} from '@sequence/schema';
import type {
  ProgramRunEvent,
  ProgramRunRecord,
  ProgramRunStatus,
  ProgramRunSummary,
} from '@sequence/api-types';
import {
  newRunId,
  openRunLog,
  listRunRecords,
  readRunEvents,
  readRunRecord,
  writeRunRecord,
  type ProgramRunEventInput,
  type RunLog,
} from './programRunStore.js';
import { deltaOf, type FileNumstat } from './runChangeStats.js';

/** Wall-clock budget applied when the caller names none. */
export const DEFAULT_RUN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The largest wall-clock budget a caller may ask for.
 *
 * WAS ONE HOUR, and one hour is not a budget for the thing this engine is for.
 * Every surface that starts a run sent no budget at all, so every UI-started
 * run was held to {@link DEFAULT_RUN_TIMEOUT_MS} — ten minutes — and even a
 * hand-written HTTP call could not ask for more than sixty. The product's own
 * plan states its Phase 5 exit criterion as "30+ minute run survives browser
 * refresh"; an agentic task that edits a repository and verifies its own work
 * is measured in hours.
 *
 * TWELVE HOURS AND NOT UNBOUNDED. The ceiling is what stops a wedged run from
 * spending until someone notices, and a run that is genuinely working is
 * emitting checkpoints, so a longer budget is something a caller ASKS for
 * rather than something every run silently gets: the default is unchanged.
 */
export const MAX_RUN_TIMEOUT_MS = 12 * 60 * 60 * 1000;

/** Node-visit budget applied when the caller names none. */
export const DEFAULT_RUN_MAX_STEPS = 200;

/** The largest node-visit budget a caller may ask for. */
export const MAX_RUN_MAX_STEPS = 2_000;

/**
 * How many runs may be executing in one server at once.
 *
 * A ceiling rather than a queue, and a refusal rather than a silent wait,
 * because a run that is "accepted" and then sits invisible behind seven others
 * is the run-list lying about what is happening. A refusal with a number in it
 * is something a user can act on.
 */
export const MAX_LIVE_RUNS = 8;

/** Everything an executor factory is told about the run it is being built for. */
export interface RunExecutionContext {
  runId: string;
  repoRoot: string;
  /**
   * The metering identity of the caller who STARTED the run — captured at start
   * and used for the whole run. A later request from someone else must never
   * change who a running program's provider calls are charged to.
   */
  identity: string;
  /** The run's abort signal. Handed to the scheduler, which hands it to executors. */
  signal: AbortSignal;
}

/** What a factory hands back: the two injected executors, plus teardown. */
export interface BuiltExecutors {
  executors: ProgramExecutors;
  /**
   * Called in a `finally` after the run settles — completion, failure, or
   * cancel alike. This is where a spawned ACP agent gets SIGTERM→SIGKILL'd, so
   * a cancelled run leaves no orphaned subprocess still billing somewhere.
   */
  dispose?: () => Promise<void>;
}

export interface ProgramRunnerDeps {
  /** Build the executors for one run. Called exactly once per run, at start. */
  makeExecutors: (ctx: RunExecutionContext) => BuiltExecutors;
  /**
   * The live ArchGraph for `checker` nodes. Read at start; absent ⇒ checker
   * nodes error honestly ("no grounded graph") rather than passing by default.
   */
  groundedGraph?: () => ArchGraph | null;
  /** Injectable clock (tests pass a fake). */
  now?: () => number;
  /** Ceiling on concurrently executing runs. Defaults to {@link MAX_LIVE_RUNS}. */
  maxLiveRuns?: number;
  /**
   * Sample the working tree's line counts, for a run's change stats.
   *
   * INJECTED rather than imported so the runner's tests stay free of git, and
   * so a host that cannot measure simply does not pass one: absent means the
   * run records no `changed`, which every surface renders as nothing at all
   * rather than as zero.
   */
  snapshotTree?: (repoRoot: string) => Promise<FileNumstat[] | null>;
}

export interface StartRunInput {
  repoRoot: string;
  program: Program;
  identity: string;
  inputs?: Record<string, string>;
  timeoutMs?: number;
  maxSteps?: number;
  sourceDiagramId?: string;
  sourceDiagramHash?: string;
}

/** The outcome of a cancel request, told apart honestly. */
export interface CancelOutcome {
  /** false ⇒ no such run has ever been recorded for this repo (the route 404s). */
  found: boolean;
  /** true ⇒ an abort was delivered to a run executing in THIS process. */
  cancelled: boolean;
  status: ProgramRunStatus;
  /**
   * Why nothing happened, when nothing happened. Present only on a refusal.
   *
   * `{ found: true, cancelled: false }` alone says the run exists and was left
   * alone, which is three different answers wearing one shape — already
   * finished, no checkpoint to pick up, a node id the program never declared.
   * A caller that has to guess between them tells the reader nothing.
   */
  reason?: string;
}

/**
 * The statuses `resume` will pick up.
 *
 * `stopped` and `interrupted` are here because their checkpoints are complete —
 * see the argument in `restart`. `completed`, `completed-with-violations` and
 * `failed` are not, because restarting one of those is a new run, not a resume.
 */
const RESUMABLE_STATUSES: ReadonlySet<ProgramRunStatus> = new Set<ProgramRunStatus>([
  'paused',
  'stopped',
  'interrupted',
]);

/**
 * The statuses `retry` will pick up: everything `resume` accepts, plus `failed`.
 *
 * `failed` is the whole point. One provider 429 at minute 40 of an hour-long
 * run currently discards every completed node, because a failed run is not
 * paused so Resume never appears and nothing re-runs one node.
 */
const RETRYABLE_STATUSES: ReadonlySet<ProgramRunStatus> = new Set<ProgramRunStatus>([
  ...RESUMABLE_STATUSES,
  'failed',
]);

export interface ProgramRunner {
  /** Register and begin a run. Returns as soon as it is registered. */
  start(input: StartRunInput): ProgramRunRecord;
  /** Every run recorded for this repo, newest first, with live status reconciled. */
  list(repoRoot: string): ProgramRunSummary[];
  /** One run plus its whole committed log; `undefined` when unknown. */
  read(repoRoot: string, runId: string): { run: ProgramRunRecord; events: ProgramRunEvent[] } | undefined;
  /** Committed events with `seq > since`. */
  events(repoRoot: string, runId: string, since: number): ProgramRunEvent[];
  /** Deliver an abort to a live run. */
  cancel(repoRoot: string, runId: string): CancelOutcome;
  /**
   * Start a halted run again from its last checkpoint.
   *
   * `pause` set `pauseRequested` and nothing ever cleared it, so a paused run
   * was paused for good — while `runProgram` had supported resuming from a
   * checkpoint since Harness W4 and the checkpoint was already being persisted
   * on every node. The primitive was complete; every layer above it was
   * missing, and a notification was telling users the run "can be resumed".
   *
   * Accepts `paused`, `stopped` and `interrupted` — see
   * {@link RESUMABLE_STATUSES}. A `completed`, `completed-with-violations` or
   * `failed` run is refused with a `reason`.
   */
  resume(repoRoot: string, runId: string): CancelOutcome;
  /**
   * Re-execute named nodes of a halted run, keeping every other completed
   * node's work.
   *
   * `RunOptions.resume.retryNodeIds` has been implemented and unit-tested in
   * the scheduler since Harness W4 (`packages/schema/src/scheduler.ts`) and was
   * reachable from nowhere: no runner method, no route, no control. So a run
   * that lost one node to a transient provider error threw away everything
   * before it. This is the door.
   */
  retry(repoRoot: string, runId: string, nodeIds: readonly string[]): CancelOutcome;
  /**
   * Ask a live run to stop at the next node boundary, RESUMABLY.
   *
   * Not cancel. Cancel aborts mid-node and the run is over; this lets the node
   * in flight finish and halts before the next, which is what makes the
   * scheduler's `paused` status resumable from its own checkpoint.
   *
   * It is the producer "Waiting on you" never had: `shouldPause` is the only
   * thing that yields `paused`, and nothing called it — so the activity view's
   * bucket counted zero on every real list, honestly and uselessly. A run the
   * person paused is a run that needs the person, which is the one reading of
   * that bucket that invents no policy about what else might pause a run.
   */
  pause(repoRoot: string, runId: string): CancelOutcome;
  /** Is this run executing in this process right now? */
  isLive(runId: string): boolean;
  /**
   * Attach to a live run's feed. Returns an unsubscribe, or `undefined` when the
   * run is not live — which is the caller's signal that the durable log is
   * already complete and there is nothing further to wait for.
   */
  subscribe(runId: string, fn: (event: ProgramRunEvent) => void): (() => void) | undefined;
  /** How many runs are executing right now. */
  liveCount(): number;
  /** Abort every live run (server shutdown). Resolves when their drivers settle. */
  disposeAll(): Promise<void>;
}

/** Thrown by {@link ProgramRunner.start} when the concurrency ceiling is reached. */
export class TooManyRunsError extends Error {
  constructor(public readonly limit: number) {
    super(`too many program runs already executing (${limit}) — wait for one to finish or cancel it`);
    this.name = 'TooManyRunsError';
  }
}

interface LiveRun {
  runId: string;
  repoRoot: string;
  /**
   * The metering identity of the caller who started this run. Held HERE and not
   * on the persisted record: it is a user id, and `.sequence/` lives inside the
   * user's repository — a directory that gets committed. A run's charge-to
   * identity is process state, not project memory.
   */
  identity: string;
  record: ProgramRunRecord;
  controller: AbortController;
  /**
   * The person asked this run to stop RESUMABLY.
   *
   * Held here rather than on the persisted record, like `identity` above and
   * for a related reason: it is a live-process intent, and a record that came
   * back from disk saying "pause requested" would describe a wish nobody can
   * still grant.
   */
  pauseRequested?: boolean;
  log: RunLog;
  subscribers: Set<(event: ProgramRunEvent) => void>;
  settled: Promise<void>;
  /**
   * The working tree as it was when this run was accepted. A PROMISE, because
   * `start` returns synchronously and must not wait on git; it is awaited once
   * at the end, where a few milliseconds cost nothing.
   *
   * Rejection is folded to null at the call site: a run must never fail
   * because a statistic could not be gathered.
   */
  treeAtStart?: Promise<FileNumstat[] | null>;
  /**
   * Another run shared the working tree during this one's window.
   *
   * Set on BOTH sides when a second run starts while this one is live - the
   * newcomer is polluted by what is already running, and everything already
   * running is polluted by the newcomer.
   */
  overlapping?: boolean;
}

/**
 * Open a run's change-stats window, and mark the overlap on BOTH sides.
 *
 * A second run starting while others are live pollutes their numbers as much
 * as theirs pollute its: one working tree cannot be attributed two ways. So
 * everything currently in flight is flagged too, not just the newcomer.
 */
function beginChangeWindow(
  run: LiveRun,
  live: Map<string, LiveRun>,
  snapshotTree: ((repoRoot: string) => Promise<FileNumstat[] | null>) | undefined,
): void {
  if (!snapshotTree) return;
  if (live.size > 0) {
    run.overlapping = true;
    for (const other of live.values()) other.overlapping = true;
  }
  /* Not awaited: `start` answers synchronously and must not wait on git. The
     rejection is folded here so no unhandled rejection escapes. */
  run.treeAtStart = snapshotTree(run.repoRoot).catch(() => null);
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

/* ══════════════════════════════════════════════════════════════════════════
   MODEL OUTPUT → A JSON-TYPED STATE SLOT
   ══════════════════════════════════════════════════════════════════════════

   THE MEASUREMENT THAT FORCED THIS. A real `review-loop` run declared
   `claimedNodeIds: 'json'` in its state shape. The value stored under that key
   was a ~600-character English paragraph:

     "Here is an example of proposed claimedNodeIds … ```json\n["node123", …]\n```
      … Let me know if you have any other questions!"

   The harness wrote that prose verbatim into a json-typed slot and handed it to
   the grounded checker, whose `parseClaimedNodeIds` falls back to "treat the
   whole string as one id" — so the checker reported the entire paragraph as a
   single `ungrounded node id: …`. The checker was right and useless.

   Fenced and prefaced JSON is not a malfunction of local and weak models, it is
   their NORMAL output. So the value is EXTRACTED here rather than being blamed
   on the model.

   THE TWO THINGS THIS IS NOT ALLOWED TO DO, because either would be the
   fabrication this repo exists to refuse:
    - it never passes a string through into a json slot on the quiet. A value
      that cannot be parsed is the node's honest `error`, carrying the first
      part of what actually came back so the reader can see it;
    - it never substitutes an empty array (or `null`, or `{}`) for a value it
      could not read. A fabricated empty array reads downstream as "the model
      claimed nothing", which is a measurement nobody made.
*/

/** What {@link extractJsonValue} found, or why it found nothing. */
export type JsonExtraction = { ok: true; value: unknown } | { ok: false; reason: string };

/** Every ```-fenced block in `text`, innermost content only, in order. */
function fencedBlocks(text: string): string[] {
  const out: string[] = [];
  const fence = /```[a-zA-Z0-9_+-]*[ \t]*\r?\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) out.push(m[1]);
  return out;
}

/**
 * Every BALANCED `[...]` / `{...}` span in `text`, string- and escape-aware.
 *
 * Balanced rather than "first bracket to last bracket": a paragraph that
 * mentions `[see below]` before the real array would otherwise produce one
 * span running from the wrong opener to the right closer, which parses as
 * nothing and hides the value that is really there.
 */
function balancedSpans(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length && out.length < 8; i++) {
    const open = text[i];
    if (open !== '[' && open !== '{') continue;
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j; // no nested re-scan from inside a span we already captured
          break;
        }
      }
    }
  }
  return out;
}

/**
 * The ONE repair, and deliberately only one: a trailing comma before a closing
 * bracket, which is the single most common way a model's otherwise-good JSON
 * fails `JSON.parse`.
 *
 * Anything more ambitious — swapping quote styles, closing an unterminated
 * array, unescaping smart quotes — starts guessing at what the model MEANT,
 * and a guessed value written into a typed slot is indistinguishable
 * downstream from one the model actually produced. String-aware, so a comma
 * inside a string literal is never touched.
 */
function repairJson(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let k = i + 1;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (k < text.length && (text[k] === ']' || text[k] === '}')) continue; // drop it
    }
    out += c;
  }
  return out;
}

function tryParse(candidate: string): JsonExtraction | null {
  const trimmed = candidate.trim();
  if (trimmed === '') return null;
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return null;
  }
}

/**
 * Read a JSON value out of model prose: the whole string first, then any fenced
 * block, then any balanced JSON span, and only then the same candidates with
 * the trailing-comma repair applied.
 *
 * Order matters. A model that answered with clean JSON must get exactly its own
 * value back, so the unmodified whole string is tried before anything is cut
 * out of it and long before anything is rewritten.
 */
export function extractJsonValue(text: string): JsonExtraction {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'the answer was empty' };

  const candidates: string[] = [];
  const add = (c: string): void => {
    const t = c.trim();
    if (t !== '' && !candidates.includes(t)) candidates.push(t);
  };
  add(trimmed);
  for (const block of fencedBlocks(trimmed)) add(block);
  /* Longest first: a balanced span IS structurally a JSON value, so when a
     paragraph contains several the biggest is the payload and the smaller ones
     are usually fragments inside it or asides around it. */
  for (const span of balancedSpans(trimmed).sort((a, b) => b.length - a.length)) add(span);

  for (const candidate of candidates) {
    const direct = tryParse(candidate);
    if (direct) return direct;
  }
  for (const candidate of candidates) {
    const repaired = tryParse(repairJson(candidate));
    if (repaired) return repaired;
  }
  return {
    ok: false,
    reason:
      'it is not JSON, contains no fenced JSON block, and contains no balanced JSON value ' +
      '(even after removing trailing commas)',
  };
}

/** Which shared-state keys the program itself declares as `json`. */
function jsonStateKeys(program: Program): Set<string> {
  const keys = new Set<string>();
  const take = (shape: Record<string, string> | undefined): void => {
    for (const [key, type] of Object.entries(shape ?? {})) if (type === 'json') keys.add(key);
  };
  take(program.state?.shape);
  for (const node of program.nodes) if (node.kind === 'state') take(node.state?.shape);
  return keys;
}

/** At most `max` characters of `text`, with an honest marker when it was cut. */
function excerpt(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}… (${oneLine.length} characters)`;
}

/**
 * Wrap the injected executors so a STRING written into a `json`-declared state
 * slot is parsed before the scheduler stores it.
 *
 * Wrapped here rather than inside the scheduler because the scheduler is pure
 * and knows nothing about where a value came from; this is a property of the
 * seam between a model and a typed store, which is exactly what this module
 * owns. Values that are already structured (an ACP turn result object, an array
 * a mock executor returned) are passed through untouched — the defect is prose
 * in a typed slot, not structure in one.
 */
export function withTypedStateWrites(
  program: Program,
  executors: ProgramExecutors,
): ProgramExecutors {
  const jsonKeys = jsonStateKeys(program);
  if (jsonKeys.size === 0) return executors;

  const wrap =
    (inner: NodeExecutor): NodeExecutor =>
    async (node, state, ctx) => {
      const result = await inner(node, state, ctx);
      if (!result.ok) return result;
      const outKey = node.kind === 'agent' ? node.agent?.outKey : node.command?.outKey;
      if (outKey === undefined || !jsonKeys.has(outKey)) return result;
      if (typeof result.value !== 'string') return result;
      const parsed = extractJsonValue(result.value);
      if (parsed.ok) return { ...result, value: parsed.value };
      return {
        ok: false,
        error:
          `${node.kind} node '${node.id}' writes state key '${outKey}', which this program ` +
          `declares as json, and the answer cannot be read as JSON: ${parsed.reason}. ` +
          `The answer began: ${excerpt(result.value)}`,
      };
    };

  return { agent: wrap(executors.agent), command: wrap(executors.command) };
}

/**
 * WHY THIS RUN'S RESULT IS NOT ACCEPTABLE — read off the run, never composed.
 *
 * Both producers are things the PROGRAM declared about itself, so a program
 * that declares no gate can never populate this and no surface is told a run
 * passed a check nobody ran:
 *
 *  - a `checker` node that actually REACHED a terminal `done` and wrote `'no'`
 *    into the `outKey` it declares. The `done` requirement is load-bearing:
 *    `review-loop` seeds `checkerOk: 'no'` in its initial state, so a run
 *    cancelled before the checker ever ran would otherwise be accused of a
 *    violation the checker never made.
 *  - the scheduler's own `loop-cap-reached` note, which it emits only when a
 *    loop exhausted its `maxIterations` while its predicate was STILL TRUE. A
 *    forced exit is not a finish, and it is the exact signal that told the
 *    measured run its verify loop never converged.
 */
function runViolations(
  program: Program,
  state: ProgramState,
  nodeResults: Record<string, NodeResult>,
  notes: readonly RunNote[],
): string[] {
  const out: string[] = [];
  for (const node of program.nodes) {
    if (node.kind !== 'checker' || !node.checker) continue;
    if (nodeResults[node.id]?.status !== 'done') continue;
    if (state[node.checker.outKey] !== 'no') continue;
    const declared = node.checker.violationsKey ? state[node.checker.violationsKey] : undefined;
    const text = typeof declared === 'string' ? declared.trim() : '';
    out.push(
      text !== ''
        ? text
        : `${node.title || node.id}: the grounded checker rejected this run's claims`,
    );
  }
  for (const note of notes) {
    if (note.kind !== 'loop-cap-reached') continue;
    out.push(
      note.detail !== undefined && note.detail !== ''
        ? note.detail
        : `${note.nodeId}: the loop exited at its iteration cap with its condition still true`,
    );
  }
  return [...new Set(out)];
}

function countNodes(nodeResults: Record<string, NodeResult>): { done: number; error: number } {
  let done = 0;
  let error = 0;
  for (const r of Object.values(nodeResults)) {
    if (r.status === 'done') done += 1;
    else if (r.status === 'error') error += 1;
  }
  return { done, error };
}

/**
 * The first executor error in the run, verbatim.
 *
 * A run-level `error` string has to come from somewhere real. This takes an
 * executor's own message rather than composing a summary sentence, because a
 * composed sentence is a claim the engine did not make.
 */
function firstNodeError(nodeResults: Record<string, NodeResult>): string | undefined {
  for (const r of Object.values(nodeResults)) {
    if (r.status === 'error' && r.error) return r.error;
  }
  return undefined;
}

/**
 * Reconcile a record READ FROM DISK against what this process is actually doing.
 *
 * A record says `running` because that is what it said when it was last written.
 * If no supervisor in this process owns it, nothing is advancing it, and saying
 * `running` to a client would be the exact defect class this build is held to —
 * a surface asserting something the engine never supplied. `interrupted` says
 * what is true: the driver went away, and the checkpoint below is as far as it
 * really got.
 *
 * NOT WRITTEN BACK. Reconciliation is a read-time view, not a mutation: a second
 * process reading the same repo must not stamp `interrupted` onto a run the
 * first process is still driving.
 */
function reconcile(record: ProgramRunRecord, isLive: boolean): ProgramRunRecord {
  if (record.status !== 'running' || isLive) return record;
  return { ...record, status: 'interrupted' };
}

function toSummary(record: ProgramRunRecord): ProgramRunSummary {
  const { program: _program, state: _state, nodeResults: _n, notes: _notes, checkpoint: _c, ...summary } = record;
  return summary;
}

export function createProgramRunner(deps: ProgramRunnerDeps): ProgramRunner {
  const now = deps.now ?? Date.now;
  const maxLive = deps.maxLiveRuns ?? MAX_LIVE_RUNS;
  const snapshotTree = deps.snapshotTree;
  const live = new Map<string, LiveRun>();

  /**
   * Commit one event, then tell the watchers.
   *
   * THE ORDER IS THE WHOLE DESIGN and it is enforced by the shape of the code,
   * not by a comment asking for care: `log.append` returns the committed row
   * with its `seq`, so there is literally nothing to hand a subscriber until the
   * write has happened. That is ml-harness §1.1's argument — replay is
   * idempotent by construction rather than by timing — expressed as a function
   * signature.
   *
   * The record is persisted between the two, so a client that reacts to an event
   * by fetching the run cannot read a record older than the event that prompted
   * it.
   */
  function commit(run: LiveRun, input: ProgramRunEventInput): ProgramRunEvent {
    const event = run.log.append(input);
    run.record.lastEventSeq = event.seq;
    persist(run);
    for (const fn of [...run.subscribers]) {
      try {
        fn(event);
      } catch {
        /* a broken subscriber must never stop the run — it is a watcher, not a participant */
      }
    }
    return event;
  }

  function persist(run: LiveRun): void {
    try {
      writeRunRecord(run.repoRoot, run.record);
    } catch {
      /*
       * Best-effort by design. A run whose record cannot be written is still a
       * real run in flight; killing it because the disk hiccuped would trade a
       * degraded read surface for a lost execution. The event log is the
       * authority for replay and is written by its own call.
       */
    }
  }

  async function drive(
    run: LiveRun,
    opts: {
      timeoutMs: number;
      maxSteps: number;
      graph: ArchGraph | null;
      /**
       * Pick up from a prior checkpoint instead of the start.
       *
       * `runProgram` has supported this since Harness W4 — "completed nodes are
       * skipped" — and nothing above it ever passed one, so a paused run was
       * paused permanently: `pause` set `pauseRequested`, and nothing anywhere
       * cleared it or restarted the scheduler.
       */
      resumeFrom?: RunCheckpoint;
      /**
       * Nodes to RE-EXECUTE even though the checkpoint records them as done.
       *
       * The scheduler has implemented this since Harness W4 and nothing above
       * it ever passed one, so a run that lost a single node to a provider 429
       * threw away every completed node with it. Only meaningful alongside
       * `resumeFrom`.
       */
      retryNodeIds?: readonly string[];
    },
  ): Promise<void> {
    const program = run.record.program;
    commit(run, {
      type: 'run:started',
      runId: run.runId,
      programId: program.id,
      nodeIds: program.nodes.map((n) => n.id),
    });

    let built: BuiltExecutors | undefined;
    let result: RunResult | undefined;
    let fatal: string | undefined;
    try {
      built = deps.makeExecutors({
        runId: run.runId,
        repoRoot: run.repoRoot,
        identity: run.identity,
        signal: run.controller.signal,
      });
      result = await runProgram(program, withTypedStateWrites(program, built.executors), {
        ...(opts.resumeFrom
          ? {
              resume: {
                checkpoint: opts.resumeFrom,
                ...(opts.retryNodeIds && opts.retryNodeIds.length > 0
                  ? { retryNodeIds: opts.retryNodeIds }
                  : {}),
              },
            }
          : {}),
        onEvent: (evt) => {
          if (evt.status === 'done' || evt.status === 'error') {
            run.record.nodeResults[evt.nodeId] = {
              status: evt.status,
              ...(evt.error !== undefined ? { error: evt.error } : {}),
              ...(evt.detail !== undefined ? { detail: evt.detail } : {}),
            };
            const counts = countNodes(run.record.nodeResults);
            run.record.nodesDone = counts.done;
            run.record.nodesError = counts.error;
          }
          commit(run, {
            type: 'node:status',
            nodeId: evt.nodeId,
            status: evt.status,
            ...(evt.error !== undefined ? { error: evt.error } : {}),
            ...(evt.detail !== undefined ? { detail: evt.detail } : {}),
          });
        },
        onNote: (note: RunNote) => {
          run.record.notes.push(note);
          commit(run, {
            type: 'run:note',
            nodeId: note.nodeId,
            kind: note.kind,
            ...(note.detail !== undefined ? { detail: note.detail } : {}),
          });
        },
        onCheckpoint: (cp: RunCheckpoint) => {
          run.record.checkpoint = cp;
          run.record.steps = cp.steps;
          run.record.state = cp.state;
          persist(run);
        },
        timeoutMs: opts.timeoutMs,
        maxSteps: opts.maxSteps,
        /*
         * THE CALLER `shouldPause` NEVER HAD. It is the only thing that
         * produces the scheduler's `paused` status, and `programRunner` did not
         * pass it — so "Waiting on you" counted zero on every real list.
         *
         * Checked before each node body, so the node in flight finishes and the
         * run halts on a boundary it can be resumed from. That is the whole
         * difference from cancel, which aborts mid-node and ends the run.
         */
        shouldPause: () => run.pauseRequested === true,
        signal: run.controller.signal,
        ...(opts.graph ? { groundedGraph: opts.graph } : {}),
      });
    } catch (e) {
      /*
       * The scheduler is documented never to throw for a node failure — it
       * records one. Reaching here means something below it broke (an executor
       * factory, a disposal). It is reported as a run-level failure with the
       * real message rather than swallowed into a `completed`.
       */
      fatal = (e as Error).message || String(e);
    } finally {
      if (built?.dispose) {
        try {
          await built.dispose();
        } catch {
          /* teardown is best-effort; it must not change the run's recorded outcome */
        }
      }
    }

    const finishedAt = now();
    let status: ProgramRunStatus;
    let error: string | undefined;
    if (result) {
      status = result.status;
      run.record.state = result.finalState;
      run.record.steps = result.steps;
      run.record.checkpoint = result.checkpoint;
      run.record.notes = result.notes;
      run.record.nodeResults = result.nodeResults;
      const counts = countNodes(result.nodeResults);
      run.record.nodesDone = counts.done;
      run.record.nodesError = counts.error;
      error = status === 'failed' ? firstNodeError(result.nodeResults) : undefined;
    } else {
      status = 'failed';
      error = fatal ?? 'the run ended without a result';
    }

    /*
     * THE RUN'S OWN GATES, ASKED BEFORE THE STATUS IS WRITTEN DOWN.
     *
     * Recorded for EVERY terminal status, because a run that was stopped
     * mid-way after its checker had already rejected the claims is still a run
     * whose reader needs to know that — but only a `completed` is RENAMED. A
     * `failed` run already carries an executor's own message and calling it
     * something else would bury it; a `stopped` one halted for a reason of its
     * own. `completed` is the only word that was actively false.
     */
    const violations = result
      ? runViolations(program, run.record.state, run.record.nodeResults, run.record.notes)
      : [];
    if (violations.length > 0) run.record.violations = violations;
    else delete run.record.violations;
    if (status === 'completed' && violations.length > 0) status = 'completed-with-violations';

    run.record.status = status;
    run.record.finishedAt = finishedAt;
    if (error !== undefined) run.record.error = error;

    /*
     * WHAT THIS RUN CHANGED. Measured here, at the one point every run passes
     * through, so a cancelled or failed run reports its edits too - those are
     * exactly the runs a reader most needs the number for.
     *
     * Wrapped whole: a run's recorded outcome must never depend on whether a
     * statistic could be gathered.
     */
    if (run.treeAtStart) {
      try {
        const before = await run.treeAtStart;
        const after = before ? await snapshotTree?.(run.repoRoot) : null;
        if (before && after) {
          run.record.changed = deltaOf(before, after, run.overlapping === true);
        }
      } catch {
        /* No stats. ABSENT, never zero - the surfaces tell those apart. */
      }
    }

    commit(run, {
      type: 'run:finished',
      status,
      steps: run.record.steps,
      state: run.record.state,
      ...(error !== undefined ? { error } : {}),
      ...(violations.length > 0 ? { violations } : {}),
    });

    // Only now is the run no longer live. A subscriber that saw `run:finished`
    // has already had it; one that arrives after this reads the durable log.
    live.delete(run.runId);
    run.subscribers.clear();
  }

  /**
   * The shared body of `resume` and `retry`: pick a settled run's checkpoint up
   * and drive it again.
   *
   * ONE FUNCTION BECAUSE THEY ARE ONE ACT with one extra argument. The only
   * difference is which statuses are eligible and whether any completed node is
   * forced to run a second time; every other rule — the checkpoint must exist,
   * the concurrency ceiling still applies, the terminal fields of the previous
   * segment must be cleared — is identical, and stating it twice is how the two
   * paths drift.
   */
  function restart(
    repoRoot: string,
    runId: string,
    eligible: ReadonlySet<ProgramRunStatus>,
    retryNodeIds?: readonly string[],
  ): CancelOutcome {
    /* A run that is still live is not parked; it is either running or about to
       notice a pause it has already been asked for. Restarting the scheduler
       underneath it would run nodes twice. */
    const alive = live.get(runId);
    if (alive) {
      return {
        found: true,
        cancelled: false,
        status: alive.record.status,
        reason: 'this run is still executing in this process',
      };
    }

    const stored = readRunRecord(repoRoot, runId);
    if (!stored) return { found: false, cancelled: false, status: 'interrupted' };

    /*
     * WHICH STATUSES MAY BE PICKED UP, and the correction that widened it.
     *
     * This used to be `paused` alone. But `scheduler.ts` states the checkpoint
     * contract as "paused = user/soft halt, resumable; stopped = budget/abort
     * (also resumable)", and the checkpoint written for a budget stop is
     * complete — `snapshot('stopped')`. `interrupted` is `reconcile()`'s
     * read-time verdict on a record whose driver went away, and its checkpoint
     * is likewise whole. So a run halted at minute 55 by a ten-minute budget or
     * by a dev-server restart had every completed node and every paid-for
     * provider answer sitting on disk and no route, button or verb that would
     * pick them up. Only `completed` / `completed-with-violations` / `failed`
     * are still refused by `resume`: restarting one of those would re-execute
     * work the record says is over, and "resume" would quietly mean "run
     * again" — a different act with a different bill. `retry` is the door for
     * `failed`, and it takes the node ids as its argument for exactly that
     * reason.
     */
    const effective = reconcile(stored, false).status;
    if (!eligible.has(effective)) {
      return {
        found: true,
        cancelled: false,
        status: effective,
        reason: `a ${effective} run cannot be picked up from here`,
      };
    }
    if (!stored.checkpoint) {
      /* Halted before the first node reached a terminal status, so there is
         nothing to pick up FROM. Saying so beats silently starting over. */
      return {
        found: true,
        cancelled: false,
        status: effective,
        reason: 'this run has no checkpoint — no node ever reached a terminal status',
      };
    }
    if (retryNodeIds !== undefined) {
      if (retryNodeIds.length === 0) {
        return {
          found: true,
          cancelled: false,
          status: effective,
          reason: 'retry needs at least one node id; retrying nothing is a resume',
        };
      }
      /* An id the program does not declare would be silently ignored by the
         scheduler's `retrySet`, and the caller would be told the retry started
         while nothing was re-run. */
      const declared = new Set(stored.program.nodes.map((n) => n.id));
      const unknown = retryNodeIds.filter((id) => !declared.has(id));
      if (unknown.length > 0) {
        return {
          found: true,
          cancelled: false,
          status: effective,
          reason: `this run's program declares no node ${unknown.map((id) => `'${id}'`).join(', ')}`,
        };
      }
    }
    if (live.size >= maxLive) throw new TooManyRunsError(maxLive);

    /*
     * THE PREVIOUS SEGMENT'S TERMINAL FIELDS DO NOT SURVIVE. A record that says
     * `running` while still carrying `finishedAt` makes every elapsed figure on
     * every surface measure to the moment the run stopped LAST time, and a
     * surviving `cancelledAt` makes `cancel` believe it has already committed
     * its `run:cancelled` row so a second Stop would abort silently. `error`
     * and `violations` belong to the segment that produced them and are
     * recomputed at the end of this one.
     */
    const { finishedAt: _f, cancelledAt: _c, error: _e, violations: _v, ...carried } = stored;
    const record: ProgramRunRecord = { ...carried, status: 'running' };
    if (retryNodeIds !== undefined) {
      /* Drop the retried nodes' recorded outcomes so the live record does not
         show a stale error beside a node that is running again. The scheduler
         does the same to the checkpoint's copy. */
      const kept: Record<string, NodeResult> = {};
      for (const [id, result] of Object.entries(record.nodeResults)) {
        if (!retryNodeIds.includes(id)) kept[id] = result;
      }
      record.nodeResults = kept;
      const counts = countNodes(kept);
      record.nodesDone = counts.done;
      record.nodesError = counts.error;
    }

    const run: LiveRun = {
      runId,
      repoRoot,
      /*
       * The metering identity is process state by design — it is a user id,
       * and `.sequence/` gets committed — so it did NOT survive the halt. An
       * empty identity meters the resumed work to nobody rather than
       * inventing an attribution, which is the honest failure here.
       */
      identity: '',
      record,
      controller: new AbortController(),
      pauseRequested: false,
      log: openRunLog(repoRoot, runId, now),
      subscribers: new Set(),
      settled: Promise.resolve(),
    };

    writeRunRecord(repoRoot, run.record);
    beginChangeWindow(run, live, snapshotTree);
    live.set(runId, run);

    run.settled = drive(run, {
      /* THE RUN'S OWN BUDGETS, not this module's defaults. `maxSteps` is
         cumulative (the scheduler carries `steps` forward from the
         checkpoint); `timeoutMs` is a fresh wall clock for this segment,
         which is what `ProgramRunSummary.timeoutMs` says it is. */
      timeoutMs: clamp(stored.timeoutMs, DEFAULT_RUN_TIMEOUT_MS, MAX_RUN_TIMEOUT_MS),
      maxSteps: clamp(stored.maxSteps, DEFAULT_RUN_MAX_STEPS, MAX_RUN_MAX_STEPS),
      graph: deps.groundedGraph?.() ?? null,
      resumeFrom: stored.checkpoint,
      ...(retryNodeIds ? { retryNodeIds } : {}),
    }).catch(() => {
      /* `drive` records every failure as a run-level one; this exists so an
         unexpected fault cannot surface as an unhandled rejection. */
      live.delete(runId);
    });

    return { found: true, cancelled: true, status: 'running' };
  }

  return {
    start(input: StartRunInput): ProgramRunRecord {
      if (live.size >= maxLive) throw new TooManyRunsError(maxLive);

      const startedAt = now();
      const runId = newRunId(startedAt);
      const program: Program =
        input.inputs && Object.keys(input.inputs).length > 0
          ? {
              ...input.program,
              state: {
                shape: input.program.state?.shape ?? {},
                initial: { ...input.program.state?.initial, ...input.inputs },
              },
            }
          : input.program;

      const initialState: ProgramState = { ...program.state?.initial };
      /* Clamped ONCE, here, and written onto the record — so `resume` reads the
         budgets this run is actually held to instead of substituting the
         module defaults under a run that asked for something else. */
      const timeoutMs = clamp(input.timeoutMs, DEFAULT_RUN_TIMEOUT_MS, MAX_RUN_TIMEOUT_MS);
      const maxSteps = clamp(input.maxSteps, DEFAULT_RUN_MAX_STEPS, MAX_RUN_MAX_STEPS);
      const record: ProgramRunRecord = {
        runId,
        programId: program.id,
        programName: program.name || program.id,
        status: 'running',
        startedAt,
        lastEventSeq: 0,
        steps: 0,
        nodesTotal: program.nodes.length,
        nodesDone: 0,
        nodesError: 0,
        timeoutMs,
        maxSteps,
        program,
        state: initialState,
        nodeResults: {},
        notes: [],
        ...(input.sourceDiagramId ? { sourceDiagramId: input.sourceDiagramId } : {}),
        ...(input.sourceDiagramHash ? { sourceDiagramHash: input.sourceDiagramHash } : {}),
      };

      const run: LiveRun = {
        runId,
        repoRoot: input.repoRoot,
        identity: input.identity,
        record,
        controller: new AbortController(),
        log: openRunLog(input.repoRoot, runId, now),
        subscribers: new Set(),
        settled: Promise.resolve(),
      };
      // Written BEFORE the driver starts, so the run is readable from the moment
      // `POST /api/program/run` answers — never a run id a client cannot look up.
      writeRunRecord(run.repoRoot, run.record);
      beginChangeWindow(run, live, snapshotTree);
      live.set(runId, run);

      const graph = deps.groundedGraph?.() ?? null;
      run.settled = drive(run, {
        timeoutMs,
        maxSteps,
        graph,
      }).catch(() => {
        /*
         * `drive` already converts every failure into a recorded run-level one.
         * This catch exists so an unexpected fault cannot surface as an
         * unhandled rejection that takes the whole server down with it.
         */
        live.delete(runId);
      });

      return record;
    },

    list(repoRoot: string): ProgramRunSummary[] {
      return listRunRecords(repoRoot).map((rec) => toSummary(reconcile(rec, live.has(rec.runId))));
    },

    read(repoRoot, runId) {
      const stored = readRunRecord(repoRoot, runId);
      if (!stored) return undefined;
      return {
        run: reconcile(stored, live.has(runId)),
        events: readRunEvents(repoRoot, runId, 0),
      };
    },

    events(repoRoot, runId, since) {
      return readRunEvents(repoRoot, runId, since);
    },

    cancel(repoRoot, runId): CancelOutcome {
      // Scoped to the repo the caller is attached to. Run ids are unique across
      // repos, so an id that belongs to another repo's run would otherwise be
      // cancellable from a session that cannot even read it — the authorisation
      // and the action would be checking different things.
      const found = live.get(runId);
      const run = found && found.repoRoot === repoRoot ? found : undefined;
      if (run) {
        if (run.record.cancelledAt === undefined) {
          const requestedAt = now();
          run.record.cancelledAt = requestedAt;
          // Committed BEFORE the abort so the log records the intent even if the
          // unwind is instantaneous. `cancelledAt` on the record is what later
          // distinguishes "stopped because the user said so" from "stopped
          // because a budget ran out" — the scheduler reports both as `stopped`
          // and this module does not invent a status to tell them apart.
          commit(run, { type: 'run:cancelled', requestedAt });
        }
        run.controller.abort();
        return { found: true, cancelled: true, status: run.record.status };
      }
      const stored = readRunRecord(repoRoot, runId);
      if (!stored) return { found: false, cancelled: false, status: 'interrupted' };
      return { found: true, cancelled: false, status: reconcile(stored, false).status };
    },

    resume(repoRoot, runId): CancelOutcome {
      return restart(repoRoot, runId, RESUMABLE_STATUSES);
    },

    retry(repoRoot, runId, nodeIds): CancelOutcome {
      return restart(repoRoot, runId, RETRYABLE_STATUSES, nodeIds);
    },

    pause(repoRoot, runId) {
      const found = live.get(runId);
      const run = found && found.repoRoot === repoRoot ? found : undefined;
      if (run) {
        if (!run.pauseRequested) {
          run.pauseRequested = true;
          /* Committed BEFORE the scheduler notices, so the log records the
             INTENT even when the halt is instantaneous — the same reason cancel
             commits first. */
          commit(run, { type: 'run:note', nodeId: '', kind: 'paused' });
        }
        return { found: true, cancelled: true, status: run.record.status };
      }
      const stored = readRunRecord(repoRoot, runId);
      if (!stored) return { found: false, cancelled: false, status: 'interrupted' };
      /* A run that is not live cannot be paused, and saying "paused" about a
         finished run would put it in a bucket it can never leave. */
      return { found: true, cancelled: false, status: reconcile(stored, false).status };
    },

    isLive: (runId) => live.has(runId),

    subscribe(runId, fn) {
      const run = live.get(runId);
      if (!run) return undefined;
      run.subscribers.add(fn);
      return () => {
        run.subscribers.delete(fn);
      };
    },

    liveCount: () => live.size,

    async disposeAll(): Promise<void> {
      const running = [...live.values()];
      for (const run of running) run.controller.abort();
      await Promise.all(running.map((r) => r.settled.catch(() => {})));
    },
  };
}
