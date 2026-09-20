import type { ProgramRunEvent, ProgramRunStatus, ProgramRunSummary } from '@sequence/api-types';
import type { NodeStatus } from '@sequence/schema';

/* ══════════════════════════════════════════════════════════════════════════
   P9 — THE ACTIVITY VIEW'S ARITHMETIC
   packages/web2/src/activity/activityModel.ts

   React-free, DOM-free, fetch-free. Everything the list decides — which word a
   run's state is written as, which hue that word may spend, which bucket it
   falls in, and how many runs are in each bucket — is decided here, once, as a
   pure function of what `GET /api/program/runs` actually returned.

   ── WHY THIS SURFACE EXISTS ──────────────────────────────────────────────
   §5.2 of docs/research/v2-architecture-and-gaps.md: "multi-agent work is
   unusable without 'which of my N threads needs me' answerable from outside
   the app." Codex answers it with Cmd+Opt+U over Unread / Running / Waiting /
   Blocked; Cursor 3 answers it with one sidebar over local, cloud, mobile,
   Slack and GitHub agents. Sequence had nothing until server-side runs landed,
   and a run list is exactly what they expose.

   ── THE ONE RULE THIS FILE IS HELD TO ────────────────────────────────────
   Every recent defect in this package was one failure: a surface asserting
   something the engine never supplied. So the mapping below is TOTAL over
   `ProgramRunStatus` and closed: there is no default arm, no "unknown state"
   fallback and no state this file can render that the engine cannot produce.
   If `@sequence/api-types` grows a seventh status, `RUN_STATES` stops
   typechecking and `activityModel.test.ts` goes red on the same commit — which
   is the point, because the alternative is a row silently rendering the empty
   string for a state nobody mapped.

   ── THE SEVEN STATES, AND WHERE EACH WORD AND HUE COMES FROM ─────────────
   The register is docs/brand/graphite/pages/12-the-agentic-surfaces.html
   §12.5, which fixes five run states — queued · running · done · error ·
   paused — "each an alias (--st-*) rather than a verdict token, so what a state
   is worth is decided once", and §12.7's hue ledger, which says what each token
   is allowed to claim. §12.5 also fixes the rule this surface obeys without
   exception: "Every state is written out as a word as well as drawn as a dot,
   and the word carries the hue too: no state in this product is communicated by
   colour alone."

   Four of the engine's six statuses land on a sheet row directly:

     running    → "Running"      --st-active  (--info)   "in flight — a notice,
                                                          not a verdict"
     paused     → "Paused"       --st-stalled (--spills) "stalled, and waiting
                                                          on you"
     completed  → "Done"         --st-done    (--fits)   "it ran and it passed"
     failed     → "Error"        --st-failed  (--wont)   "it ran and it failed"

   The other two are not on the sheet because the sheet was drawn before
   server-side runs existed, and both get `--unknown` for the reason §12.6
   gives that token — "not known, and refusing to guess":

     stopped      a budget guard, an executor-await timeout or a caller's Stop
                  forced a loud halt (`RunResult['status']`, packages/schema).
                  Nothing failed a check and nothing passed one, so it is NOT
                  --wont: §12.6 is explicit that painting a non-failure red
                  "teaches the reader to distrust every other red on the screen,
                  which is the only defence the product has".
     interrupted  `programRunner.ts`'s `reconcile()` — the record on disk says
                  running and no supervisor in this process owns it. Its own
                  doc comment refuses both `running` ("a lie — nothing is
                  advancing it") and `failed` ("also a lie — nothing failed").
                  Where it got to is exactly what is not known.

   The seventh, `completed-with-violations`, arrived after a real run was
   measured: the engine reported `completed` with `nodesError: 0` on a run whose
   own grounded checker had rejected its claims and whose verify loop had
   exited at its cap with the predicate still true. It takes `--st-failed`,
   because the reader's one hard requirement here is not being told that run
   passed. See its entry in `RUN_STATES` below.

   ── AND A NOTE ABOUT `paused`, NOW RESOLVED ──────────────────────────────
   This used to read: "`programRunner.ts` does not pass `shouldPause` to
   `runProgram`, and `paused` is the only status `runProgram` produces from it.
   So today the 'Waiting on you' bucket counts zero on every real list."

   It does pass it now. `POST /api/program/runs/:id/pause` sets the flag the
   scheduler's guard reads, so a run halts at a node BOUNDARY — the node in
   flight finishes — and lands in `paused`, resumable from the checkpoint the
   scheduler already writes. That is the difference from cancel, which aborts
   mid-node and ends the run.

   The bucket was never removed and its count was never faked while it read
   zero, which is why nothing here had to change when it stopped: the number
   beside it is a count over the list the engine actually returned, which is a
   measurement whatever it comes to. A filter that disappeared when its count
   hit zero would also disappear the moment the answer was "nothing needs you",
   which is the single most useful answer this surface has.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The question the surface answers: which of my N runs needs me?
 *
 * Four, and they are not the engine's six. `finished` folds three terminal
 * statuses together because from the reader's seat they are one answer — this
 * one is over — and the ROW still writes out which of the three it was. The
 * bucket is the triage; the word is the truth.
 */
export type ActivityBucket = 'running' | 'waiting' | 'blocked' | 'finished';

/** The filter, including the unfiltered case. */
export type ActivityFilter = ActivityBucket | 'all';

/**
 * The hue role a state may spend, named rather than written as a `var()`.
 *
 * A `var(--st-active)` returned from this module would put colour in a
 * React-free arithmetic file and make the token indirection unreachable from
 * the stylesheet. The stylesheet selects on `[data-tone]`; this decides which
 * tone, and `activity.css` decides once what each tone is worth.
 */
export type StateTone = 'neutral' | 'active' | 'stalled' | 'blocked' | 'done' | 'failed';

export interface RunStateRender {
  /** The word on screen. Never abbreviated, never a colour on its own. */
  readonly word: string;
  readonly tone: StateTone;
  readonly bucket: ActivityBucket;
  /**
   * The one animated state. §12.5: "Running is the only animated object on the
   * surface, and it pulses rather than spins: a spinner says 'wait', a pulse
   * says 'still true'."
   */
  readonly live: boolean;
  /** Whether the engine still owns work that its cancel route can abort. */
  readonly cancellable: boolean;
  /**
   * Whether `POST /api/program/runs/:id/resume` will pick this run up.
   *
   * TRANSCRIBED FROM `RESUMABLE_STATUSES` in
   * `packages/analyzer/src/server/programRunner.ts`, not decided here. The
   * runner refuses `completed`, `completed-with-violations` and `failed`
   * because restarting one of those is a new run; it accepts the three halts
   * whose checkpoint is complete. A surface that offered Resume on a status the
   * engine refuses would be a button that does nothing, which is the same
   * defect as a fabricated number wearing a different shape.
   *
   * NOT SUFFICIENT ON ITS OWN: the engine also refuses a run with no
   * checkpoint, and only the full record says whether there is one. The caller
   * asks both.
   */
  readonly resumable: boolean;
  /** One short clause saying what this state means, for the row's title. */
  readonly meaning: string;
}

/**
 * Every status the engine can report, and nothing else.
 *
 * `Record<ProgramRunStatus, …>` is deliberate: an added status is a compile
 * error here rather than a blank cell on screen.
 */
export const RUN_STATES: Record<ProgramRunStatus, RunStateRender> = {
  running: {
    word: 'Running',
    tone: 'active',
    bucket: 'running',
    live: true,
    cancellable: true,
    resumable: false,
    meaning: 'a supervisor in the engine is advancing this run right now',
  },
  paused: {
    word: 'Paused',
    tone: 'stalled',
    bucket: 'waiting',
    live: false,
    cancellable: false,
    resumable: true,
    meaning: 'the scheduler stopped at a gate and is waiting on you',
  },
  interrupted: {
    word: 'Interrupted',
    tone: 'blocked',
    bucket: 'blocked',
    live: false,
    cancellable: false,
    resumable: true,
    meaning:
      'the record says running and no supervisor owns it — the process driving this run went away',
  },
  completed: {
    word: 'Done',
    tone: 'done',
    bucket: 'finished',
    live: false,
    cancellable: false,
    resumable: false,
    meaning: 'the scheduler walked to a natural end with no node in error',
  },
  /*
   * THE STATE THIS SURFACE USED TO RENDER AS "DONE", IN GREEN.
   *
   * A measured `review-loop` run finished with `nodesError: 0` while its own
   * grounded checker had written `checkerOk: 'no'` and the scheduler had noted
   * that the verify loop exited at its cap with the predicate still true. The
   * row said Done. §12.6's argument about not painting a non-failure red cuts
   * the other way here: this IS a failure — the run's own declared gate
   * rejected the result — and the one thing the reader must not be told is that
   * it passed. It spends `--st-failed` for that reason, and the word says which
   * kind of failure it is so it is never confused with a node that errored.
   *
   * `finished`, not `blocked`: it is over, and the reasons are on the row.
   * Parking a terminal state in a bucket that feeds the "needs you" badge would
   * make that badge permanently non-zero, which is how a badge stops being
   * read.
   */
  'completed-with-violations': {
    word: 'Violations',
    tone: 'failed',
    bucket: 'finished',
    live: false,
    cancellable: false,
    resumable: false,
    meaning:
      'it ran to its end with no node in error, and the run’s own grounded checks rejected the result',
  },
  failed: {
    word: 'Error',
    tone: 'failed',
    bucket: 'finished',
    live: false,
    cancellable: false,
    resumable: false,
    meaning: 'a node errored, and the run carries that node’s own message',
  },
  stopped: {
    word: 'Stopped',
    tone: 'blocked',
    bucket: 'finished',
    live: false,
    cancellable: false,
    resumable: true,
    meaning: 'a budget, a timeout or a Stop halted this run before it ended',
  },
};

/** Every status the engine can report, as a list, so a test can iterate it. */
export const RUN_STATUSES = Object.keys(RUN_STATES) as readonly ProgramRunStatus[];

export function stateOf(status: ProgramRunStatus): RunStateRender {
  return RUN_STATES[status];
}

export function bucketOf(status: ProgramRunStatus): ActivityBucket {
  return RUN_STATES[status].bucket;
}

export interface BucketDef {
  readonly id: ActivityFilter;
  /** Written out. "Waiting" alone does not say waiting on WHOM. */
  readonly label: string;
}

/**
 * The filter bar, in the order a reader triages.
 *
 * All first because it is the list; then the two that need the reader, in the
 * order they need them; then running, which needs nothing; then finished, which
 * is the archive. Codex's own order is Unread/Running/Waiting/Blocked — Unread
 * has no counterpart here, because nothing in Sequence records that a run has
 * been read, and a bucket whose predicate the engine cannot supply is precisely
 * the fabrication this package exists to refuse.
 */
export const ACTIVITY_BUCKETS: readonly BucketDef[] = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting on you' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'running', label: 'Running' },
  { id: 'finished', label: 'Finished' },
];

/** One count per filter, over the runs the engine actually listed. */
export type BucketCounts = Record<ActivityFilter, number>;

export function countByBucket(runs: readonly ProgramRunSummary[]): BucketCounts {
  const counts: BucketCounts = { all: runs.length, running: 0, waiting: 0, blocked: 0, finished: 0 };
  for (const run of runs) counts[bucketOf(run.status)] += 1;
  return counts;
}

export function filterRuns(
  runs: readonly ProgramRunSummary[],
  filter: ActivityFilter,
): ProgramRunSummary[] {
  return filter === 'all' ? [...runs] : runs.filter((run) => bucketOf(run.status) === filter);
}

/**
 * How many runs are asking for the reader. THE HEADLINE NUMBER.
 *
 * Waiting plus blocked, and not running: a run that is advancing does not need
 * anybody, and counting it here would make the badge permanently non-zero and
 * therefore permanently ignorable.
 */
export function needsYou(runs: readonly ProgramRunSummary[]): number {
  const counts = countByBucket(runs);
  return counts.waiting + counts.blocked;
}

/* ── what a run is allowed to spend ──────────────────────────────────────── */

/**
 * One offerable run budget. `value === null` means SEND NOTHING and let the
 * engine's own default apply — which is not the same as sending the number that
 * happens to be its default today.
 */
export interface BudgetChoice {
  readonly label: string;
  readonly value: number | null;
}

/**
 * ══ THE TEN-MINUTE CEILING NOBODY COULD SEE ══════════════════════════════
 *
 * `PostProgramRunRequest` has carried `timeoutMs` and `maxSteps` since the run
 * route was written, and no client ever sent either — so every run started from
 * this product was held to `DEFAULT_RUN_TIMEOUT_MS` (ten minutes) and
 * `DEFAULT_RUN_MAX_STEPS` (200 node visits), and at exactly ten minutes the
 * node in flight lost its race, was recorded as an error, and the run ended
 * `stopped`. A two-hour agentic task was not expressible from any surface.
 *
 * A SHORT LIST OF NAMED DURATIONS, NOT A NUMBER FIELD. A free millisecond input
 * invites a number nobody can read back ("is 5400000 ninety minutes?") and puts
 * the burden of unit arithmetic on the reader; these are the shapes a person
 * actually wants — a quick check, a working session, an overnight run.
 *
 * THE ENGINE STILL CLAMPS. These are an ask. The run's record carries the
 * budgets it was actually held to, which is where the truth is read.
 */
export const RUN_TIME_BUDGETS: readonly BudgetChoice[] = [
  { label: '10 minutes (engine default)', value: null },
  { label: '30 minutes', value: 30 * 60 * 1000 },
  { label: '2 hours', value: 2 * 60 * 60 * 1000 },
  { label: '8 hours', value: 8 * 60 * 60 * 1000 },
  { label: '12 hours', value: 12 * 60 * 60 * 1000 },
];

/** The same, for the node-visit budget the scheduler counts against. */
export const RUN_STEP_BUDGETS: readonly BudgetChoice[] = [
  { label: '200 steps (engine default)', value: null },
  { label: '500 steps', value: 500 },
  { label: '2000 steps', value: 2000 },
];

export interface RunProgress {
  readonly done: number;
  readonly error: number;
  readonly total: number;
}

/**
 * The node ledger, or `null` when there is no denominator.
 *
 * `nodesTotal` is `program.nodes.length`, carried on the summary "so a client
 * never counts its own frames". A run whose program declares no node has
 * nothing to be a fraction of, and "0 of 0" is the F1 defect in miniature — a
 * count printed where the truth is that there is nothing to count. The caller
 * renders nothing for `null`.
 */
export function progressOf(run: ProgramRunSummary): RunProgress | null {
  if (!Number.isFinite(run.nodesTotal) || run.nodesTotal <= 0) return null;
  return { done: run.nodesDone, error: run.nodesError, total: run.nodesTotal };
}

/**
 * How long this run has been going, or how long it took.
 *
 * Both ends are epoch milliseconds the engine supplied — `startedAt` always,
 * `finishedAt` once terminal — and `now` is passed in rather than read, so this
 * stays pure and a test can pin the clock. A terminal run measures to its own
 * `finishedAt` and therefore stops moving; a live one measures to now.
 */
export function spanMs(run: ProgramRunSummary, now: number): number {
  const end = run.finishedAt ?? now;
  return Math.max(0, end - run.startedAt);
}

/**
 * A duration as one short token: `4s`, `12m`, `3h`, `2d`.
 *
 * Coarse on purpose. A row that reads `1m 43.2s` re-renders every frame and
 * says nothing more than `1m`; §12.2's rule that a row is "one short clause"
 * applies to its right cluster as much as to its verb.
 */
export function spanLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * What a run is running, as one line.
 *
 * `programName` is documented as "the program's `name`, or its id when it
 * declares no name" — the engine has already done the falling back, so this
 * does none of its own. An empty string means the engine sent an empty string,
 * and the caller says so rather than substituting the run id, which would put
 * an identifier in the slot reserved for a name and read as one.
 */
export function programLabel(run: ProgramRunSummary): string | null {
  const name = run.programName?.trim() ?? '';
  return name === '' ? null : name;
}

/* ── one run, opened: what the durable log says about each of its steps ───── */

/**
 * The scheduler's four per-node states, in the same register as the run's own.
 *
 * `queued` is `--st-neutral`, which §12.7 is careful to call "an alias of
 * --ink-3, not a hue at all" — "nothing yet" is not a claim about anything and
 * spends no colour.
 */
export const NODE_STATES: Record<NodeStatus, { readonly word: string; readonly tone: StateTone }> =
  {
    queued: { word: 'Queued', tone: 'neutral' },
    running: { word: 'Running', tone: 'active' },
    done: { word: 'Done', tone: 'done' },
    error: { word: 'Error', tone: 'failed' },
  };

/** Every node status the scheduler emits, as a list, so a test can iterate it. */
export const NODE_STATUSES = Object.keys(NODE_STATES) as readonly NodeStatus[];

/**
 * Fold a run's committed log into the last status each node reached.
 *
 * THE LOG IS THE SOURCE, NOT `nodeResults`. `ProgramRunRecord.nodeResults` only
 * ever holds the two TERMINAL outcomes (`NodeResult['status']` is
 * `'done' | 'error'`), so a node that is queued or executing right now is absent
 * from it — and a surface that read only that map would draw an opened, live run
 * as a list of blanks with no way to tell "not started" from "running now". The
 * log carries all four, in order, and its `seq` is gap-free by construction.
 *
 * A NODE WITH NO EVENT IS ABSENT FROM THE RESULT, and the caller draws that
 * absence rather than assuming `queued`. The scheduler emits `queued` for the
 * nodes it has queued; a node it has not reached has had nothing said about it,
 * and "Queued" would be this surface saying it on the scheduler's behalf.
 */
export function nodeStatesFrom(
  events: readonly ProgramRunEvent[],
): Readonly<Record<string, NodeStatus>> {
  const out: Record<string, NodeStatus> = {};
  /* Ascending `seq`, not array order: `readRunEvents` returns oldest-first
     today, but the last writer wins only if "last" is decided by the number the
     log assigned rather than by the order a caller happened to concatenate in. */
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    if (event.type === 'node:status') out[event.nodeId] = event.status;
  }
  return out;
}

/**
 * The one-line change summary a run row shows, or null.
 *
 * NULL IS A REAL ANSWER and the caller must render nothing for it. A run that
 * is still going has not been measured; a repository git could not read has
 * not been measured. "no files changed" is a MEASUREMENT, and showing it for
 * "not measured" is the guess this product exists not to make.
 */
export function changedLabel(run: Pick<ProgramRunSummary, 'changed'>): string | null {
  const c = run.changed;
  if (!c) return null;
  if (c.files === 0) return 'no files changed';
  const parts = [`${c.files} ${c.files === 1 ? 'file' : 'files'}`];
  if (c.added > 0) parts.push(`+${c.added}`);
  if (c.removed > 0) parts.push(`-${c.removed}`);
  if (c.uncountedFiles > 0) parts.push(`${c.uncountedFiles} not counted`);
  const line = parts.join(' ');
  /* THE CAVEAT TRAVELS WITH THE NUMBER. Two runs sharing one working tree
     cannot be told apart - the information is not there to recover - so the
     number says so where it is read, not in a tooltip nobody opens. */
  return c.overlapping ? `${line} (shared with another run)` : line;
}
