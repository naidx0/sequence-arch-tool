/**
 * Programs — `repoServer.ts`, the `/api/program/*` family.
 *
 * HISTORY, kept because it is the reason the rest of this file exists. When
 * `@sequence/api-types` was extracted there was no `POST /api/program/run`: the
 * workflow engine ran in the BROWSER (`runProgram` was executed from
 * `packages/web/src/programs/ProgramGraph.tsx:594`), so there was no run id, no
 * list, no status and no server resume — closing the tab killed a run and two
 * windows could not watch one. That was gap G1/P8, "the single largest hole
 * under the 'better at agent workflows' claim".
 *
 * The strategy and run-log routes below predate that fix. Everything from
 * "P8 — SERVER-SIDE RUNS" down is the fix.
 */

import type {
  Program,
  ProgramState,
  ProgramRunLogRow,
  NodeStatus,
  NodeResult,
  RunNote,
  RunCheckpoint,
} from '@sequence/schema';

/* --------------------- GET /api/program/strategy -------------------------- */

export type GetProgramStrategyRequest = void;

/**
 * `.sequence/program.md` — human-edited loop rules. Key-free read.
 * **404 `{ error }` when the file is absent**, which is the normal case; a client
 * must treat that as "no strategy", not as a failure.
 *
 * `editAllowlist` is the parsed "Agent may edit" section, present only when the
 * markdown declares one. When it IS present the server enforces it on `PUT
 * /api/file` and `POST /api/prompt-file` — a path outside it is a 403.
 */
export interface GetProgramStrategyResponse {
  /** Always the literal `.sequence/program.md`. */
  path: string;
  content: string;
  editAllowlist?: string[];
}

/* -------------------- POST /api/program/run-log --------------------------- */

/**
 * The harness-owned experiment log. Agents cannot write `.sequence/runs/results.tsv`
 * through `/api/file` (it is under the reserved `.sequence` root); this append-only
 * route is the only way in.
 *
 * The body must be a complete row — every field is required and a partial row is a
 * 400, not a merge.
 */
export type PostProgramRunLogRequest = ProgramRunLogRow;

export interface PostProgramRunLogResponse {
  ok: true;
  /** Always the literal `.sequence/runs/results.tsv`. */
  path: string;
}

/* --------------------- GET /api/program/run-log --------------------------- */

export type GetProgramRunLogRequest = void;

/**
 * GUARD ASYMMETRY, read off the handler and carried here because it is a real
 * difference a client can observe: this GET runs `requireRepo()` but **not**
 * `requireOwner()`, while its POST twin runs both. On a hosted bind a non-owner
 * can therefore read the run log of a repo they did not attach. Noted in the
 * plan's §3.2; W0.5 records it, it does not fix it.
 */
export interface GetProgramRunLogResponse {
  rows: ProgramRunLogRow[];
}

/* ==========================================================================
 * P8 — SERVER-SIDE RUNS
 * ==========================================================================
 *
 * THE EVENT-LOG SHAPE IS ADOPTED, and the reason is written down rather than
 * implied. `docs/research/ml-harness-adoption.md` §1.1 argues that committing
 * every event to a durable, id-numbered log BEFORE yielding it, using the row id
 * as the SSE event id, and replaying from `since=`, makes replay idempotent
 * **by construction rather than by timing**. Sequence's ask stream does the
 * opposite: `writeSseEvent` emits `data:` with no `id:` line at all, so a
 * dropped connection loses the turn.
 *
 * Program runs adopt the log shape in full:
 *  - `ProgramRunEvent.seq` is assigned by an append-only file, is 1-based and
 *    gap-free, and is committed to disk BEFORE any subscriber sees it;
 *  - it is emitted as the SSE `id:` line on `GET /api/program/runs/:id/events`;
 *  - a reconnecting client passes it back as `?since=` (or as the standard
 *    `Last-Event-ID` header, which a browser `EventSource` sends by itself) and
 *    receives exactly the events it missed — no duplicates, no gaps, and no
 *    dependence on how fast it reconnected.
 *
 * WHAT IS NOT ADOPTED, and why. ml-harness has no client store because its
 * transcript is a fold over the log. That argument is about a chat surface and
 * is settled elsewhere (plan §5). Here the log is the run's transport and its
 * durability; it is not a ruling on how `packages/web2` holds state.
 *
 * WHAT IS NOT CHANGED. The ask stream still has no `id:` line. That gap is real
 * and it belongs to the ask path's owner — retrofitting it from here would mean
 * two lanes editing one framing function.
 */

/**
 * Where a run is, as the server knows it.
 *
 * Five of the seven come straight from the scheduler's own `RunResult['status']`
 * plus the live `running`. The sixth, `interrupted`, exists because the honest
 * answer to "the record on disk says running but no supervisor in this process
 * owns it" is neither `running` (a lie — nothing is advancing it) nor `failed`
 * (also a lie — nothing failed). It means: the process that was driving this run
 * went away, and `checkpoint` is the last state it actually reached.
 *
 * ── THE SEVENTH, AND THE MEASUREMENT THAT FORCED IT ──────────────────────
 * A real `review-loop` run was launched and read back. Its record said
 * `status: 'completed'`, `nodesError: 0` — while its own final state said
 * `checkerOk: 'no'`, `violations: 'ungrounded node id: …'`, and its log carried
 * `loop exited at its maxIterations cap (3) with the predicate still true`. The
 * run categorically failed the objective it declares, and every surface read it
 * as a success. `docs/research/agent-workflow-mega-plan.md`'s own scorecard row
 * W5 — "% runs marked done with checker violations", target 0%, "Fail → gate
 * bug" — was failing in production against this exact record.
 *
 * `completed-with-violations` is that run: the scheduler walked to a natural
 * end with no node in error, AND something the run itself declared as its gate
 * says the result is not acceptable. It is not `failed` — no executor errored,
 * and calling it failed would erase the difference between "a node broke" and
 * "the work is finished and wrong". It is not `completed` — that word is the
 * lie being removed. The reasons travel with it in
 * {@link ProgramRunSummary.violations}, verbatim from the checker and the
 * scheduler's own notes; nothing here composes one.
 */
export type ProgramRunStatus =
  | 'running'
  | 'completed'
  | 'completed-with-violations'
  | 'failed'
  | 'stopped'
  | 'paused'
  | 'interrupted';

/** One row of `GET /api/program/runs`. Every figure here is measured, never assumed. */
/**
 * What a run changed on disk, measured as the DIFFERENCE between the working
 * tree when it started and when it finished.
 *
 * A delta rather than a total, so a run is never credited with edits that were
 * already there when it began.
 */
export interface RunChangeStats {
  /** Files this run added lines to, removed lines from, created or deleted. */
  files: number;
  added: number;
  removed: number;
  /**
   * Files whose lines could not be counted - binary, or a new file past the
   * size cap. Carried so a surface says "not counted" instead of implying zero.
   */
  uncountedFiles: number;
  /**
   * True when another run shared the working tree during this one's window, so
   * these numbers may include its edits. Not recoverable - one tree cannot be
   * attributed two ways - so it is DECLARED and travels with the number.
   */
  overlapping?: boolean;
}

export interface ProgramRunSummary {
  runId: string;
  programId: string;
  /** The program's `name`, or its id when it declares no name. */
  programName: string;
  status: ProgramRunStatus;
  /** Epoch ms the run was accepted (not when its first node started). */
  startedAt: number;
  /** Epoch ms the run reached a terminal status. Absent while it is still going. */
  finishedAt?: number;
  /** Epoch ms `POST /api/program/runs/:id/cancel` was accepted, if it ever was. */
  cancelledAt?: number;
  /**
   * The highest `seq` committed to this run's event log. THE RESUME CURSOR: a
   * client that has seen up to N reconnects with `?since=N`. 0 means the log is
   * empty, which is only true for a run that has not emitted yet.
   */
  lastEventSeq: number;
  /** Node visits executed, from the scheduler. */
  steps: number;
  /** `program.nodes.length` — the denominator, carried so a client never counts its own frames. */
  nodesTotal: number;
  /**
   * HOW MUCH OF THE TREE THIS RUN MOVED, measured with git so that an agent
   * writing through its own tooling is counted the same as one writing through
   * ours. ABSENT means not measured - a run still going, or a repository git
   * could not read - and absent is NOT zero: a surface must show nothing
   * rather than "no files changed", which is a measurement.
   */
  changed?: RunChangeStats;
  /** Nodes whose executor actually resolved ok. */
  nodesDone: number;
  /** Nodes whose executor errored. */
  nodesError: number;
  /** The run-level reason, when there is one. Never invented for a clean finish. */
  error?: string;
  /**
   * WHY THIS RUN'S RESULT IS NOT ACCEPTABLE, in the words of whatever decided
   * that — never in words composed here.
   *
   * Two producers today, and both are things the run declared about itself:
   *  - a `checker` node that RAN and wrote `'no'` into its own `outKey`
   *    contributes the joined string it wrote to its `violationsKey`;
   *  - a loop that exited at its `maxIterations` cap with its predicate still
   *    true contributes the scheduler's own `loop-cap-reached` note detail.
   *
   * ABSENT means nothing declared a violation — NOT that the run was checked
   * and passed. A program with no checker and no capped loop can never populate
   * this, and a surface must not read its absence as a verdict.
   *
   * Carried on the SUMMARY (not only the record) because the run list is where
   * the "completed with zero errors" lie was read, and a row cannot correct it
   * from a field it does not receive.
   */
  violations?: string[];
  /**
   * The budgets this run is actually being held to, AFTER the server's clamp —
   * not what the caller asked for.
   *
   * Persisted because `resume` had nothing to read and substituted the module
   * defaults: a run started with `maxSteps: 2000` and paused at step 500 came
   * back with `maxSteps: 200`, tripped the step guard before its first node,
   * and landed `stopped` on a budget it never asked for.
   *
   * `maxSteps` is CUMULATIVE across resumes — the scheduler carries the step
   * count forward from the checkpoint, so this is the total node-visit budget
   * for the run's whole life. `timeoutMs` is PER SEGMENT: the scheduler
   * computes its deadline as `now + timeoutMs` each time it is driven, so a
   * resumed run gets this budget again from the moment it restarts. That is
   * stated here rather than silently done, because the two readings differ by
   * hours on a long run.
   */
  timeoutMs?: number;
  maxSteps?: number;
  /** Architecture board source when run was launched from a diagram. */
  sourceDiagramId?: string;
  sourceDiagramHash?: string;
}

/** The full record — `GET /api/program/runs/:runId`. */
export interface ProgramRunRecord extends ProgramRunSummary {
  /** The program AS SUBMITTED, stored with the run so a reader needs no client. */
  program: Program;
  /** The scheduler's shared state at the last committed transition. */
  state: ProgramState;
  nodeResults: Record<string, NodeResult>;
  /** Loud run-level signals (a loop that hit its cap). */
  notes: RunNote[];
  /**
   * The scheduler's durable snapshot. Present once at least one node has reached
   * a terminal status; this is what a resume would be handed.
   */
  checkpoint?: RunCheckpoint;
}

/**
 * One committed row of a run's log.
 *
 * `seq` is assigned by the append, is 1-based and gap-free within a run, and is
 * the SSE `id:`. `at` is epoch ms at commit time.
 */
export type ProgramRunEvent =
  | {
      seq: number;
      at: number;
      type: 'run:started';
      runId: string;
      programId: string;
      /** Every node id in the program, in declared order — the denominator, stated once. */
      nodeIds: string[];
    }
  | {
      seq: number;
      at: number;
      type: 'node:status';
      nodeId: string;
      status: NodeStatus;
      /** Present only on `status:'error'`, and only with the executor's own message. */
      error?: string;
      /** Measured sidecar on done/error (e.g. command exit + stdout). */
      detail?: string;
    }
  | {
      seq: number;
      at: number;
      type: 'run:note';
      nodeId: string;
      kind: RunNote['kind'];
      detail?: string;
    }
  | {
      seq: number;
      at: number;
      type: 'run:cancelled';
      /** Committed when cancel is ACCEPTED, before the scheduler unwinds. */
      requestedAt: number;
    }
  | {
      seq: number;
      at: number;
      type: 'run:finished';
      status: ProgramRunStatus;
      steps: number;
      state: ProgramState;
      error?: string;
      /**
       * The same list {@link ProgramRunSummary.violations} carries, committed
       * to the durable log so a reader replaying the stream learns WHY a run
       * ended `completed-with-violations` without also fetching the record.
       */
      violations?: string[];
    };

/* --------------------- POST /api/program/run ------------------------------ */

/**
 * Start a run. The response comes back as soon as the run is REGISTERED — before
 * any node executes — because the run's lifetime is not this request's lifetime.
 * That is the point of the route: the client may close immediately and the run
 * continues.
 */
export interface PostProgramRunRequest {
  /** Validated with `validateProgram`; a 400 lists every problem. */
  program: Program;
  /** Merged over the program's declared initial state, exactly as the CLI's `--input k=v`. */
  inputs?: Record<string, string>;
  /** Wall-clock budget for the whole run. Server-clamped. */
  timeoutMs?: number;
  /** Hard cap on node visits. Server-clamped. */
  maxSteps?: number;
  /** Source diagram graph id when launched from Architecture board. */
  sourceDiagramId?: string;
  /** Content hash of source `.seqd` at launch. */
  sourceDiagramHash?: string;
}

/** 202 Accepted — the run exists and is registered; it has not necessarily started a node. */
export interface PostProgramRunResponse {
  runId: string;
  status: ProgramRunStatus;
  startedAt: number;
  /**
   * Where this client should resume the event stream from: always 0.
   *
   * NOT "how many events exist" — the run may already have committed its
   * `run:started` row by the time this response is serialized. It is the
   * caller's CURSOR, and a caller that has seen nothing has a cursor of zero.
   * Returning the run's true committed count here would read as helpful and
   * would silently skip every event the client had not yet been sent.
   */
  lastEventSeq: number;
}

/** 400 body when `validateProgram` rejects the submitted graph. */
export interface ProgramInvalidResponse {
  error: string;
  /** One line per problem, verbatim from `validateProgram`. */
  problems: string[];
}

/* --------------------- GET /api/program/runs ------------------------------ */

export type GetProgramRunsRequest = void;

/** Newest first, by `startedAt`. */
export interface GetProgramRunsResponse {
  runs: ProgramRunSummary[];
}

/* ------------------- GET /api/program/runs/:runId ------------------------- */

export type GetProgramRunRequest = void;

/** 404 `{ error }` when no run with that id has ever been recorded for this repo. */
export interface GetProgramRunResponse {
  run: ProgramRunRecord;
  /** The whole committed log, oldest first. The same rows the SSE stream replays. */
  events: ProgramRunEvent[];
}

/* --------------- GET /api/program/runs/:runId/events (SSE) ---------------- */

/**
 * The resumable feed. Query `?since=N` (or the `Last-Event-ID` header) replays
 * every event with `seq > N` from the durable log and then streams live ones;
 * `since` wins when both are present.
 *
 * Each frame carries an `id:` line holding the event's `seq`, then the usual
 * `data:` line holding the JSON. The `id:` line is the difference between this
 * stream and the ask stream: it is what makes a reconnect exact instead of
 * hopeful.
 *
 * The response ENDS after the `run:finished` frame — there is nothing further to
 * wait for. Connecting to an already-finished run therefore replays the whole
 * log and closes, which is the same code path as a live tail.
 *
 * Disconnecting from this stream does NOT stop the run. Cancelling does, and
 * cancelling is a separate, explicit route.
 */
export type GetProgramRunEventsRequest = void;

/* ------------- POST /api/program/runs/:runId/cancel ----------------------- */

export type PostProgramRunCancelRequest = void;

/**
 * `status` is what the run is at the moment cancel was processed — `running`
 * means the abort was delivered and the scheduler is unwinding (the terminal
 * status arrives on the event stream), and a terminal status means the run had
 * already finished and nothing was cancelled.
 *
 * `cancelled:false` with a terminal status is the honest "too late", not an
 * error: 200, because the caller's intent — this run must not keep going — is
 * already satisfied.
 */
export interface PostProgramRunCancelResponse {
  ok: true;
  runId: string;
  /** true ⇒ an abort was actually delivered to a live run in this process. */
  cancelled: boolean;
  status: ProgramRunStatus;
}
