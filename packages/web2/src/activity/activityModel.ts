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
   exited at its cap with the predicate still true. It is "Done with problems"
   in the amber tone (H8; never the done green, never the failure red), because
   the reader's one hard requirement here is not being told that run passed.
   See its entry in `RUN_STATES` below.

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
  /** One plain sentence saying what this state means, for the row's tooltip. No engine words. */
  readonly meaning: string;
  /**
   * H8: the one short plain-language reason line that follows the word on a row ("Waiting for you to resume"), or null
   * where the word already says it all (Running, Done). `reasonOf` refines it with a count where the run carries one.
   */
  readonly reason: string | null;
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
    meaning: 'This workflow is working right now.',
    reason: null,
  },
  paused: {
    word: 'Paused',
    tone: 'stalled',
    bucket: 'waiting',
    live: false,
    cancellable: false,
    resumable: true,
    meaning: 'This workflow stopped between steps and is waiting for you to resume it.',
    reason: 'Waiting for you to resume',
  },
  interrupted: {
    word: 'Interrupted',
    tone: 'blocked',
    bucket: 'blocked',
    live: false,
    cancellable: false,
    resumable: true,
    meaning: 'The app that was running this workflow went away before it finished. You can pick it up again.',
    reason: 'The app closed while it ran',
  },
  completed: {
    word: 'Done',
    tone: 'done',
    bucket: 'finished',
    live: false,
    cancellable: false,
    resumable: false,
    meaning: 'This workflow finished and nothing went wrong.',
    reason: null,
  },
  /*
   * THE STATE THIS SURFACE USED TO RENDER AS "DONE", IN GREEN.
   *
   * A measured `review-loop` run finished with `nodesError: 0` while its own
   * grounded checker had written `checkerOk: 'no'` and the scheduler had noted
   * that the verify loop exited at its cap with the predicate still true. The
   * row said Done. §12.6's argument about not painting a non-failure red cuts
   * the other way here: the run's own declared gate rejected the result, and
   * the one thing the reader must not be told is that it passed. H8: it is
   * "Done with problems" in the amber tone (shared with Paused), with a
   * warning icon, so it is neither the done green nor the red of a step that
   * failed.
   *
   * `finished`, not `blocked`: it is over, and the reasons are on the row.
   * Parking a terminal state in a bucket that feeds the "needs you" badge would
   * make that badge permanently non-zero, which is how a badge stops being
   * read.
   */
  'completed-with-violations': {
    word: 'Done with problems',
    tone: 'stalled',
    bucket: 'finished',
    live: false,
    cancellable: false,
    resumable: false,
    meaning: 'This workflow reached the end, but its own checks rejected the result.',
    reason: 'A check rejected the result',
  },
  failed: {
    word: 'Failed',
    tone: 'failed',
    bucket: 'finished',
    live: false,
    cancellable: false,
    resumable: false,
    meaning: 'A step of this workflow failed, so it ended.',
    reason: 'A step failed',
  },
  stopped: {
    word: 'Stopped',
    tone: 'blocked',
    bucket: 'finished',
    live: false,
    cancellable: false,
    resumable: true,
    meaning: 'This workflow was stopped before it finished, by a limit or by someone pressing Stop.',
    reason: 'Ended before the last step',
  },
};

/** Every status the engine can report, as a list, so a test can iterate it. */
export const RUN_STATUSES = Object.keys(RUN_STATES) as readonly ProgramRunStatus[];

/**
 * H8: a status this build does not know (a newer engine) must not crash the pane. It draws as a muted, finished row whose
 * word is the raw status, offering no control: nothing is claimed about a state nobody mapped.
 */
function unknownState(status: string): RunStateRender {
  return {
    word: status,
    tone: 'neutral',
    bucket: 'finished',
    live: false,
    cancellable: false,
    resumable: false,
    meaning: 'This build does not know this state.',
    reason: null,
  };
}

export function stateOf(status: ProgramRunStatus): RunStateRender {
  return RUN_STATES[status] ?? unknownState(String(status));
}

export function bucketOf(status: ProgramRunStatus): ActivityBucket {
  return stateOf(status).bucket;
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
  { id: 'waiting', label: 'Paused' },
  { id: 'blocked', label: 'Interrupted' },
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
  { label: '10 minutes (default)', value: null },
  { label: '30 minutes', value: 30 * 60 * 1000 },
  { label: '2 hours', value: 2 * 60 * 60 * 1000 },
  { label: '8 hours', value: 8 * 60 * 60 * 1000 },
  { label: '12 hours', value: 12 * 60 * 60 * 1000 },
];

/** The same, for the node-visit budget the scheduler counts against. */
export const RUN_STEP_BUDGETS: readonly BudgetChoice[] = [
  { label: '200 steps (default)', value: null },
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
 * The workflow's own name, or null when the engine sent an empty one. Kept for callers that need to know whether a name
 * exists; the screen is written under `workflowTitle`.
 */
export function programLabel(run: ProgramRunSummary): string | null {
  const name = run.programName?.trim() ?? '';
  return name === '' ? null : name;
}

/**
 * H8: the title a row and its opened panel are written under. The workflow's name; when the engine could only fall back to
 * the program's id (`prog-sweep`), that slug is read as words ("Sweep"), never shown as an identifier; an empty name is
 * "Untitled workflow", never a run id and never the word "Program".
 */
export function workflowTitle(run: Pick<ProgramRunSummary, 'programName' | 'programId'>): string {
  const name = run.programName?.trim() ?? '';
  if (name === '') return 'Untitled workflow';
  if (name !== run.programId) return name;
  const words = name
    .replace(/^(prog|program|wf|workflow)[-_:]/i, '')
    .replace(/[-_:]+/g, ' ')
    .trim();
  return words === '' ? 'Untitled workflow' : words.charAt(0).toUpperCase() + words.slice(1);
}

/** H8: the plain reason line for a row, or null. A count replaces the generic sentence where the run carries one. */
export function reasonOf(run: Pick<ProgramRunSummary, 'status' | 'violations'>): string | null {
  if (run.status === 'completed-with-violations') {
    const n = run.violations?.length ?? 0;
    if (n > 0) return `${n} ${n === 1 ? 'check' : 'checks'} failed`;
  }
  return stateOf(run.status).reason;
}

/**
 * H8: progress as a person says it. A run still going (or halted partway) is "Step 2 of 3", the step it is on; a run that has
 * ended says how many steps got done, never a step it did not reach. Null when the program declares no step.
 */
export function stepsLabel(run: ProgramRunSummary): string | null {
  const p = progressOf(run);
  if (p === null) return null;
  if (run.status === 'running' || run.status === 'paused' || run.status === 'interrupted') {
    return `Step ${Math.min(p.done + 1, p.total)} of ${p.total}`;
  }
  /* A run that reached its end may legitimately have run fewer steps than the program declares (a branch follows one arm), so
     "N of M" would contradict "Done". It says how many ran. "N of M" stays where the gap is the news: stopped, failed. */
  if (run.status === 'completed' || run.status === 'completed-with-violations') {
    return p.done === 0 ? null : `${p.done} ${p.done === 1 ? 'step' : 'steps'} ran`;
  }
  return `${p.done} of ${p.total} ${p.total === 1 ? 'step' : 'steps'} done`;
}

/** H8: how long ago, in words: "just now", "4m ago", "3h ago", "2d ago". A live run says "Started 4m ago"; a finished one counts from its end. */
export function agoLabel(run: ProgramRunSummary, now: number): string {
  const ms = Math.max(0, now - (run.finishedAt ?? run.startedAt));
  if (ms < 10_000) return run.status === 'running' ? 'Started just now' : 'just now';
  return `${run.status === 'running' ? 'Started ' : ''}${spanLabel(ms)} ago`;
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
    queued: { word: 'Waiting', tone: 'neutral' },
    running: { word: 'Running', tone: 'active' },
    done: { word: 'Done', tone: 'done' },
    error: { word: 'Failed', tone: 'failed' },
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


/**
 * Whether a run can be commanded right now, and one true sentence saying why or why not (the Commandable / Locked chip's tooltip).
 * Commandable = the run can be stopped (cancellable) or picked back up (resumable, and the record carries a checkpoint, which is
 * the engine's own condition for a resume). Everything else is Locked: it can only be read.
 */
export function runControl(status: ProgramRunStatus, hasCheckpoint: boolean): { commandable: boolean; copy: string } {
  const s = stateOf(status);
  const commandable = s.cancellable || (s.resumable && hasCheckpoint);
  const noCheckpoint = 'it has nowhere to pick up from, so it can only be read.';
  const copy: Record<ProgramRunStatus, string> = {
    running: 'Running now: Pause and Cancel run are on this row.',
    paused: hasCheckpoint ? 'Paused between steps and waiting for you: Resume picks it up where it stopped.' : `Paused, but ${noCheckpoint}`,
    interrupted: hasCheckpoint ? 'The app closed while it ran: Resume picks it up where it stopped.' : `The app closed while it ran, and ${noCheckpoint}`,
    stopped: hasCheckpoint ? 'Ended before the last step (a limit or a Stop): Resume continues where it stopped.' : `Ended before the last step, and ${noCheckpoint}`,
    completed: 'Finished cleanly: nothing is left to control, only to read.',
    'completed-with-violations': 'Finished, and its own checks rejected the result: nothing is left to control, only to read.',
    failed: 'A step failed and the run ended: nothing is left to control, only to read.',
  };
  return { commandable, copy: copy[status] ?? 'This state is not known to this build, so it can only be read.' };
}
