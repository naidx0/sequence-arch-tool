/**
 * THE GOAL RUN — one turn per step, until the plan is worked down or a named
 * thing stops it.
 *
 * Owner, 2026-09-17: "Goal right now just sets you a personal goal. If you look
 * at ML Harness, the goals there are more straightforward: once you create a
 * goal, you can tell the agent to work on the goal, and that way we can enforce
 * long-running tasks even with weaker models."
 *
 * THE LAST SIX WORDS ARE THE DESIGN. Sequence's ask loop is already good at
 * spending a turn well — sixteen tool rounds, an evidence ledger, an
 * unproductive-round rule. What it cannot do is spend TWENTY turns on one job,
 * because every turn needs a person to type into it, and the thing that decides
 * whether to keep going is the model's own prose. A model that says "that
 * should do it" ends the work whether or not the work is done, and weaker
 * models say it sooner.
 *
 * So the deciding moves OUT of the model. This file is a loop over a plan on
 * disk. Before each turn it reads the plan, takes the FIRST open step, and asks
 * for that one step. After the turn it looks at the plan again. The step either
 * has its box ticked or it does not, and that — not a sentence — is the whole
 * verdict. Ported from ML Harness `app/longrun.py`, including its constants,
 * its stop vocabulary, and the two rules below that it paid for in measured
 * failures.
 *
 * ── RULE ONE: ACCEPTANCE IS A CHECKBOX, NEVER A PHRASE ──────────────────────
 *
 * Nothing in this file reads the answer text to decide whether a step
 * finished. `markStepDone` writes `[x]`; a step is done when the plan says so.
 * The model's words are read for exactly one purpose — the REASON a step was
 * parked, which is a quote, not a verdict.
 *
 * ── RULE TWO: A TURN THAT PRODUCED NOTHING COSTS THE STEP NO STRIKE ─────────
 *
 * An empty reply, a provider hiccup, or a turn that narrated and called no tool
 * says NOTHING about whether the step is doable. Charging it to the step is how
 * a run parks a perfectly good plan because the connection dropped twice. Each
 * of those has its own counter, its own ceiling, and its own stop reason, and
 * every one of them `continue`s past the strike.
 *
 * ── WHY THE STATE IS A FILE ─────────────────────────────────────────────────
 *
 * `.sequence/sessions/<id>/goal-run.json`, rewritten atomically at every
 * transition — `programRunStore.ts`'s pattern and its argument. Stop is a
 * PERSISTED ROW, so pressing Stop in a second window ends the run: the loop
 * re-reads the row at the top of every iteration and a `running: false` it did
 * not write is somebody else's Stop. It is also why a restart reports
 * `engine_restarted` rather than a phantom `running` — a row still marked
 * running when this process starts is orphaned by definition, because a live
 * worker cannot predate the process that owns it.
 *
 * NOTHING IN HERE TALKS TO A PROVIDER. `takeTurn` is injected, so the tests run
 * the real loop against a fake pipeline and every stop reason is produced by a
 * case that produces only it.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { GoalAuditVerdict, GoalRunState, GoalRunStopReason, PlanStep } from '@sequence/api-types';
import { SEQUENCE_DIR } from './store.js';
import { firstOpenStep, openSteps, parkStep, planCounts } from './goalPlan.js';

/* ───────────────────────────── the constants ──────────────────────────────
   Every one of these is ML Harness's, at its value, because each was set by
   watching the failure it bounds. They are exported so the tests name the
   number rather than re-typing it — a test that hard-codes 4 and a loop that
   uses 5 both pass and disagree. */

/** The ceiling on turns. `longrun.py:TURN_CAP`. */
export const GOAL_RUN_TURN_CAP = 24;

/**
 * How many REAL attempts a step gets before it is parked. `longrun.py:STRIKES`.
 *
 * Two, not one: the first failure is often the model learning what the step
 * actually needs, and one strike parks a step the second attempt would have
 * finished. Not three: a third attempt on a step two honest tries could not
 * move is money spent to be told the same thing again.
 */
export const GOAL_RUN_STRIKES = 2;

/** Consecutive parks that mean the PLAN is wrong. `longrun.py:PARKS_IN_A_ROW`. */
export const GOAL_RUN_PARKS_IN_A_ROW = 3;

/** Strike-taking turns with nothing ticked before one rewrite is offered. */
export const GOAL_RUN_REPLAN_AFTER = 3;

/** Empty replies in a row that mean the model has stopped answering. */
export const GOAL_RUN_HOLLOW_TURNS = 4;

/** Turns in a row that announced a move and called no tool. */
export const GOAL_RUN_NARRATION_TURNS = 4;

/** Consecutive provider failures before the run gives up. `longrun.py:630`. */
export const GOAL_RUN_PROVIDER_FAILURES = 2;

/**
 * A GOAL WITH NO PLAN IS STILL SOMETHING TO WORK ON.
 *
 * Owner, 2026-09-17: "once you create a goal, you can tell the agent to work
 * on the goal." The first cut refused to start until a plan existed, which put
 * a step between the person and the button they were promised — they had to
 * know to ask for a plan first. So a run may start on a bare goal: its first
 * turns are PLAN turns, aimed at nothing, whose one job is `write_plan`. They
 * cost no strike (there is no step to strike), and there are three of them —
 * a model that cannot write a plan from a goal in three tries will not write
 * one in twenty-four, and the honest ending says so.
 */
export const GOAL_RUN_PLAN_TURNS = 3;

/** The run's file inside the session directory. */
export const GOAL_RUN_FILE = 'goal-run.json';

/* ──────────────────────────────── the nudges ─────────────────────────────── */

/**
 * WHEN THREE STRIKE-TAKING TURNS HAVE TICKED NOTHING, THE STEPS ARE THE PROBLEM.
 *
 * ML Harness's REPLAN_NUDGE, reworded for Sequence's tool names. Offered ONCE
 * per run: a loop that keeps asking for a rewrite spends the whole cap on
 * rewrites, and the second rewrite is written by the same model that wrote the
 * first one from the same information.
 *
 * It is a SCAFFOLD, not a chat message. It reaches the model as this turn's
 * question and is never written into `chat.json` as something the person said —
 * a person who scrolls back and finds themselves saying words they never typed
 * has lost the ability to trust the transcript, which is the one thing a
 * transcript is for.
 */
export const REPLAN_NUDGE =
  'Three turns have passed and no step of this plan has been ticked, so the STEPS are the ' +
  'problem rather than the effort. Rewrite the REMAINING open steps now with `write_plan`, ' +
  'keeping what is already ticked or parked exactly as it is: every open step must name an ' +
  'action and what to do it to — ideally the tool and its arguments — so that reading the line ' +
  'tells you the call to make. A step that is a condition rather than an action ("baseline ' +
  'measured", "tests passing") is a gate, and a gate is not a step. Then work the first one.';

/**
 * WHEN A TURN ANNOUNCED A MOVE AND CALLED NO TOOL.
 *
 * ML Harness's NARRATION_NUDGE. It costs the step no strike — the whole point —
 * so without this the run would take four identical narrating turns and stop,
 * having told the model nothing. The nudge is the only thing that changes
 * between them.
 */
export const NARRATION_NUDGE =
  'That turn announced a move and called no tool, so the step is exactly where it was. Call the ' +
  'tool the first open step names, NOW. Do not ask the person — nobody is waiting to answer. Do ' +
  'not say you are ready to start; start.';

/**
 * THE SECOND NARRATED TURN GETS THE READ DONE FOR IT (carrying-harness plan,
 * wave A7: narration to action).
 *
 * A model that announced the same move twice and called nothing is not going
 * to call it on the third asking. So the harness makes the first move itself:
 * when the step names a file the repository has, `deps.readForStep` reads it
 * and the scaffold carries the content, so the only thing left for the model
 * to do is the edit. Without a file to read the scaffold still hardens — the
 * one call it must make is named, and prose before it is forbidden.
 */
export function narrationNudgeHard(step: PlanStep, read: HarnessRead | null): string {
  const head =
    'Two turns in a row announced a move on this step and called no tool. The step is exactly ' +
    'where it was, and the run can see that.';
  if (read) {
    return (
      `${head} So the harness made the first move for you: here is ${read.path}, read in full` +
      `${read.truncated ? ' (cut at the size cap)' : ''}. Do NOT read it again — make the change ` +
      'the step names with `propose_files` in THIS reply, before any prose, then `mark_step_done`.\n\n' +
      `--- ${read.path} ---\n${read.text}\n--- end of ${read.path} ---`
    );
  }
  return (
    `${head} Your FIRST token this reply is a tool call, not a sentence: \`read_file\` on the file ` +
    `the step names, or \`locate_symbol\` on the name it uses. The step: ${step.text}`
  );
}

/** What `deps.readForStep` hands back — one file, read by the harness. */
export interface HarnessRead {
  path: string;
  text: string;
  truncated: boolean;
}

/**
 * THE SCAFFOLD FOR THE FIRST TURN ON A HARNESS-WRITTEN PLAN (wave A6). The
 * model is told who wrote the steps, so it does not treat them as its own
 * earlier decision and so a person reading the transcript can see the seam.
 */
export function skeletonScaffold(stepText: string): string {
  return (
    'Two turns wrote no plan, so the harness wrote one from the files the goal names — a read ' +
    'per file, one change, one re-read. Rewrite the open steps with `write_plan` if you see a ' +
    `better one; otherwise ${aimScaffold(stepText)}`
  );
}

/**
 * THE COMPLETION AUDIT'S SCAFFOLD (wave A4). Short, like `aimScaffold`: the
 * audit voice in the goal section (`goalPlan.renderGoalSection`, `audit`)
 * carries the procedure and the verdict line. This is the user-seat sentence
 * that says which turn this is.
 */
export const AUDIT_SCAFFOLD =
  'This is the completion audit: verify the goal against the files with tools, then end on ' +
  'one line `VERDICT: PASS | PARTIAL | FAIL — what was and was not verified`.';

/**
 * READ THE VERDICT LINE, AND ONLY THE VERDICT LINE.
 *
 * Rule one of this file says nothing reads prose for a verdict, and this does
 * not break it: the audit turn is asked for exactly one machine-shaped line,
 * and the run ends on THAT line or falls back to the reason it had before the
 * audit — a model that wrote three paragraphs and no VERDICT line has not
 * passed anything. The LAST match wins, because a model that reasons out loud
 * writes "if X then VERDICT: PASS" on the way to its actual line.
 */
export function parseAuditVerdict(text: string): { verdict: GoalAuditVerdict; note: string } | null {
  let found: { verdict: GoalAuditVerdict; note: string } | null = null;
  for (const m of text.matchAll(/^\s*[*_`#>\s-]*VERDICT\s*:\s*[*_`]*(PASS|PARTIAL|FAIL)(?![A-Za-z])[*_`]*\s*(?:[—–:-]+\s*)?(.*)$/gim)) {
    const note = (m[2] ?? '').trim().replace(/\s+/g, ' ').replace(/[*_`]+$/, '').slice(0, 220);
    found = { verdict: m[1]!.toUpperCase() as GoalAuditVerdict, note };
  }
  return found;
}

const AUDITED_REASON: Record<GoalAuditVerdict, GoalRunStopReason> = {
  PASS: 'audited_pass',
  PARTIAL: 'audited_partial',
  FAIL: 'audited_fail',
};

/**
 * The question a goal-run turn carries when nothing else is scaffolding it.
 *
 * SHORT ON PURPOSE. The step itself, the plan, and the marching orders are all
 * in the goal section of the prompt (`goalPlan.renderGoalSection`, live voice),
 * which is assembled from the session's own state. Restating them here would
 * give the model two statements of its job, free to disagree — and the one in
 * the prompt is the one the plan tools are keyed to.
 */
/** The scaffold for a plan turn — a run that has a goal and no steps yet. */
export const PLAN_NUDGE =
  'A run has started on this goal and there is no plan yet. Write it NOW with `write_plan`: two ' +
  'to six steps, each an ACTION naming what to do and what to do it to — the tool and its ' +
  'arguments where you can — so that reading the line tells you the call to make. A condition ' +
  '("file exists", "tests pass") is a gate, not a step. Then work the first step, with tools, ' +
  'this same turn. Do not ask the person what they want; the goal is what they want, in their words.';

export function aimScaffold(stepText: string): string {
  return `Work this step of the plan now, with tools: ${stepText}`;
}

/* ─────────────────────────────── the stored row ──────────────────────────── */

export interface GoalRunRecord extends GoalRunState {
  version: 1;
  sessionId: string;
  /**
   * The process that started it. RECORDED, NEVER PROBED.
   *
   * It is here so a person reading the file can see which engine owned the run,
   * and for nothing else. Asking the operating system whether that pid is alive
   * is the check this repository has been burned by twice — an exited child
   * reads alive while its handle is open, and `OpenProcess` succeeds on pids
   * that have exited. Liveness here is decided by one rule with no races in it:
   * a row still marked running when THIS process boots was orphaned, because a
   * live worker cannot predate the process that owns it.
   */
  pid: number;
}

function runFile(repoRoot: string, sessionId: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, 'sessions', sessionId, GOAL_RUN_FILE);
}

/**
 * Write via temp + rename.
 *
 * The row is rewritten on every transition while the poller may be reading it.
 * A plain write truncates first, so a concurrent read has a real window in
 * which it sees an empty file and the goalbar reports no run at all —
 * mid-run, which is exactly when somebody is watching.
 */
function writeRecord(repoRoot: string, record: GoalRunRecord): void {
  const file = runFile(repoRoot, record.sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, file);
}

/** The run row, or `undefined` when there has never been one (or it is unreadable). */
export function readGoalRun(repoRoot: string, sessionId: string): GoalRunRecord | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(runFile(repoRoot, sessionId), 'utf8')) as GoalRunRecord;
    if (raw?.version !== 1 || typeof raw.sessionId !== 'string') return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

/**
 * THE STATE ANY WINDOW READS. Never a throw and never a 404: a session that has
 * never been run is a session with a stopped run of zero turns, which is what
 * the goalbar has to draw anyway.
 */
export function goalRunState(repoRoot: string, sessionId: string): GoalRunState {
  const row = readGoalRun(repoRoot, sessionId);
  if (!row) return { running: false, turns: 0, cap: GOAL_RUN_TURN_CAP };
  const { version: _v, sessionId: _s, pid: _p, ...state } = row;
  return state;
}

/**
 * ONE HUMAN SENTENCE PER STOP REASON.
 *
 * Separate from the reason code and produced by the same call, so the two can
 * never drift into a screen that says `turn_cap` with the sentence for a park.
 * Ported from `longrun.py:_finish`, whose vocabulary exists because one word
 * for all of these told the reader nothing: "the run stopped" is true of a
 * finished plan, a dead provider and a plan made of gates, and the right next
 * action is different for each.
 */
export interface StopFacts {
  cap?: number;
  turns?: number;
  counts?: { done: number; parked: number; total: number };
  n?: number;
  error?: string;
  /** The audit's own words after its verdict (audited endings only). */
  note?: string;
  /** How the run reached the audit: the plan ran out, or the turns did. */
  at?: 'worked_down' | 'cap';
}

export function stopSentence(reason: GoalRunStopReason, facts: StopFacts): string {
  const done = facts.counts?.done ?? 0;
  const parked = facts.counts?.parked ?? 0;
  const auditedAt =
    facts.at === 'cap'
      ? `on the last of its ${facts.cap ?? GOAL_RUN_TURN_CAP} turns`
      : `after the plan was worked down (${done} done, ${parked} parked)`;
  const auditNote = facts.note ? ` · ${facts.note}` : '';
  switch (reason) {
    case 'audited_pass':
      return `audited PASS ${auditedAt} · every requirement of the goal was verified${auditNote}`;
    case 'audited_partial':
      return (
        `audited PARTIAL ${auditedAt} · some requirements were verified and some were not — read ` +
        `the audit before calling this done${auditNote}`
      );
    case 'audited_fail':
      return `audited FAIL ${auditedAt} · the goal's end state is not there${auditNote}`;
    case 'plan_worked_down':
      return parked === 0
        ? `plan worked down · every step is ticked (${done})`
        : `plan worked down · ${done} done, ${parked} parked`;
    case 'parked_more_than_it_did':
      return (
        `${done} done, ${parked} parked · more of this plan was skipped than done, so read the ` +
        'parked lines before running it again'
      );
    case 'nothing_could_be_worked':
      return (
        `not one of the ${parked} steps could be done · this plan needs rewriting as steps that ` +
        'name a tool and what it takes'
      );
    case 'the_plan_could_not_be_worked':
      return (
        `${facts.n ?? GOAL_RUN_PARKS_IN_A_ROW} steps in a row could not be done · the plan is the ` +
        'problem rather than the effort. Rewrite the open steps as actions, then run it again'
      );
    case 'turn_cap':
      return `the run took its ${facts.cap ?? GOAL_RUN_TURN_CAP} turns and handed back · ${done} done, ${parked} parked`;
    case 'stopped_by_hand':
      return `stopped by hand after ${facts.turns ?? 0} turn${facts.turns === 1 ? '' : 's'}`;
    case 'provider_failed':
      return 'the connection failed twice in a row · nothing was lost, start the run again';
    case 'the_model_stopped_answering':
      return (
        `${facts.n ?? GOAL_RUN_HOLLOW_TURNS} turns in a row came back with nothing · nothing was ` +
        'parked, because a turn that produced nothing says nothing about the steps'
      );
    case 'the_model_only_narrated':
      return (
        `${facts.n ?? GOAL_RUN_NARRATION_TURNS} turns in a row announced a move and called no ` +
        'tool · nothing was parked, because narration is not evidence a step is undoable'
      );
    case 'turn_failed':
      return `the turn failed · ${facts.error ?? 'no reason given'}`;
    case 'engine_restarted':
      return (
        'the engine stopped while this run was working · nothing it had already done was lost, ' +
        'and starting it again picks up at the first open step'
      );
    case 'not_building':
      return 'a run works the plan down, and Plan mode does not run steps — switch to Build first';
    case 'nothing_open':
      return 'every step is ticked or parked, so there is nothing for a run to work down';
    case 'no_plan_written':
      return (
        `${facts.n ?? GOAL_RUN_PLAN_TURNS} turns were spent asking for a plan and none was written · ` +
        'nothing was parked, because there were no steps to park. Write the steps yourself, or ' +
        'say the goal more concretely, then run it again'
      );
  }
}

/* ──────────────────────────────── boot reaping ───────────────────────────── */

/**
 * EVERY ROW STILL MARKED RUNNING AT BOOT IS ORPHANED.
 *
 * Not "probably" — by definition. This process has just started, so it owns no
 * worker, and a row claiming a live one is describing an engine that is gone.
 * `programRunner.ts` reaches the same conclusion by the same argument and says
 * so in its own header.
 *
 * The alternative — leaving it and checking liveness later — is the thing this
 * must not do. A phantom `running` means the goalbar shows Stop on a run that
 * will never advance, the person presses it, and nothing happens; and the 409
 * on start means they cannot start a real one either. A run reported as
 * interrupted is recoverable in one click; a phantom is not recoverable at all.
 */
export function reapGoalRuns(repoRoot: string): string[] {
  const dir = path.join(repoRoot, SEQUENCE_DIR, 'sessions');
  let ids: string[];
  try {
    ids = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const reaped: string[] = [];
  for (const id of ids) {
    const row = readGoalRun(repoRoot, id);
    if (!row || !row.running) continue;
    writeRecord(repoRoot, {
      ...row,
      running: false,
      lastStopReason: 'engine_restarted',
      lastStopSentence: stopSentence('engine_restarted', {}),
      finishedAt: new Date().toISOString(),
    });
    reaped.push(id);
  }
  return reaped;
}

/* ──────────────────────────────── one turn ───────────────────────────────── */

/**
 * WHAT ONE TURN DID, as the loop needs to read it.
 *
 * Deliberately thin, and every field is a FACT rather than a judgement. The
 * loop does the judging; a `GoalTurnOutcome` that carried "the step is done"
 * would be the pipeline deciding, which puts the verdict back inside the thing
 * being judged.
 */
export interface GoalTurnOutcome {
  /**
   * `ok` the turn ran · `provider-failed` the connection did not · `threw` the
   * pipeline itself failed. The last two exist separately because a provider
   * hiccup is retried and a pipeline throw is not.
   */
  kind: 'ok' | 'provider-failed' | 'threw';
  /** What the model said. Read ONLY for a park reason — never for a verdict. */
  text: string;
  /**
   * How many tools it actually called. The narration rule keys on THIS and not
   * on the prose, because "announced a move and called no tool" is a claim
   * about calls.
   */
  toolCallsMade: number;
  /** The plan as the turn left it — the one thing that decides the step. */
  plan: PlanStep[];
  error?: string;
}

/** What the loop needs from the world, so a test can be the world. */
export interface GoalRunnerDeps {
  repoRoot: string;
  sessionId: string;
  /**
   * TAKE ONE TURN. One ask, no new user message, one scaffold.
   *
   * It is awaited, so turns are serial by construction: a run can never have
   * two of its own turns in flight, which is the "one ask at a time" property
   * this loop needs and the only one it can enforce by itself.
   */
  /**
   * `aimingAt` is null on a PLAN turn — a goal with no steps yet — and on the
   * AUDIT turn, which `audit: true` marks: that turn verifies the goal against
   * the files and ends on a verdict line (wave A4).
   */
  takeTurn: (args: GoalTurnArgs) => Promise<GoalTurnOutcome>;
  /** Read the plan back from disk — the loop trusts the file, not its memory. */
  readPlan: () => PlanStep[];
  /** Write the plan when the loop itself parks a step. */
  writePlan: (plan: readonly PlanStep[]) => void;
  /**
   * A PLAN THE HARNESS CAN WRITE when two plan turns wrote none (wave A6):
   * `goalPlan.skeletonFromGoal` over the repository, or null when the goal
   * names no file the repository has. Absent ⇒ the third plan turn runs as
   * before and the run may end `no_plan_written`.
   */
  planSkeleton?: () => PlanStep[] | null;
  /**
   * THE READ THE HARNESS MAKES on the second narrated turn (wave A7): the one
   * file the step names, or null when it names none the repository has.
   */
  readForStep?: (step: PlanStep) => HarnessRead | null;
  /** Optional clock seam for tests. */
  now?: () => Date;
}

export interface GoalTurnArgs {
  aimingAt: PlanStep | null;
  scaffold: string;
  plan: readonly PlanStep[];
  /** True on the one completion-audit turn. */
  audit?: boolean;
}

/* ─────────────────────────────── start / stop ────────────────────────────── */

export type StartGoalRunResult =
  | { ok: true; state: GoalRunState; done: Promise<GoalRunState> }
  | { ok: false; status: 400 | 409; reason: GoalRunStopReason | 'already_running'; message: string; state: GoalRunState };

/**
 * REFUSALS AT THE DOOR, and they are the same two ML Harness refuses on.
 *
 * `not_building` — Plan mode does not run steps, and letting a run start in
 * Plan and then discovering there are no mutating tools would burn the cap on
 * turns that could never tick anything. The belt already refuses
 * `mark_step_done` outside Build (`askToolsForJobMode`); this is the other half,
 * stated where the person can read it.
 *
 * `nothing_open` — there is nothing to aim at. A run that starts here would take
 * one turn, find no open step, and stop, which looks exactly like a broken
 * button.
 */
export function goalRunDoorRefusal(
  deps: GoalRunnerDeps,
  permission?: string,
): Exclude<StartGoalRunResult, { ok: true }> | null {
  const { repoRoot, sessionId } = deps;
  const state = (): GoalRunState => goalRunState(repoRoot, sessionId);
  if (readGoalRun(repoRoot, sessionId)?.running === true) {
    return {
      ok: false,
      status: 409,
      reason: 'already_running',
      message: 'a run is already working this plan down',
      state: state(),
    };
  }
  if (permission !== 'build') {
    return { ok: false, status: 400, reason: 'not_building', message: stopSentence('not_building', {}), state: state() };
  }
  /* An EMPTY plan is not `nothing_open` — it is a goal the run will plan for
     (GOAL_RUN_PLAN_TURNS). Only a plan whose every step is already ticked or
     parked has nothing to aim at. */
  const planAtDoor = deps.readPlan();
  if (planAtDoor.length > 0 && openSteps(planAtDoor).length === 0) {
    return { ok: false, status: 400, reason: 'nothing_open', message: stopSentence('nothing_open', {}), state: state() };
  }
  return null;
}

export function startGoalRun(
  deps: GoalRunnerDeps,
  opts: { permission?: string; cap?: number },
): StartGoalRunResult {
  const { repoRoot, sessionId } = deps;
  /*
   * THE SAME CHECK THE ROUTE ALREADY MADE, AND IT RUNS AGAIN ANYWAY.
   *
   * The route asks first so that pressing Work on goal in Plan mode says
   * "switch to Build" rather than "connect your AI key" — the refusal the
   * person can act on, not the first one the handler happens to reach. Asking
   * again here is not belt-and-braces: `startGoalRun` is also called by the
   * tests and by any later caller, and a door that only closes when someone
   * remembers to close it is not a door.
   */
  const refused = goalRunDoorRefusal(deps, opts.permission);
  if (refused) return refused;
  const cap = Number.isFinite(opts.cap) && (opts.cap as number) > 0 ? Math.floor(opts.cap as number) : GOAL_RUN_TURN_CAP;
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  const record: GoalRunRecord = {
    version: 1,
    sessionId,
    pid: process.pid,
    running: true,
    turns: 0,
    cap,
    startedAt,
  };
  /*
   * THE ROW IS WRITTEN BEFORE THE LOOP IS STARTED, not after.
   *
   * The route answers as soon as this returns, and the goalbar's very next poll
   * reads the file. A row written after the first `await` leaves a window in
   * which the person has pressed the button, the button has said yes, and the
   * state says no run exists — which reads as a button that did nothing.
   */
  writeRecord(repoRoot, record);
  const done = workGoalRun(deps);
  return { ok: true, state: goalRunState(repoRoot, sessionId), done };
}

/**
 * STOP IS A PERSISTED ROW, WHICH IS WHY ANY WINDOW CAN DO IT.
 *
 * It does not cancel anything and does not need to: the loop re-reads this row
 * at the top of every iteration, so the turn in flight finishes — its work is
 * the person's whether or not they pressed Stop — and no next turn starts.
 *
 * Idempotent. Stopping a run that is not running is not an error; it is a
 * person pressing a button that describes the state they already want, and
 * answering 400 to that is the product being pedantic at somebody.
 */
export function stopGoalRun(repoRoot: string, sessionId: string): GoalRunState {
  const row = readGoalRun(repoRoot, sessionId);
  if (!row || !row.running) return goalRunState(repoRoot, sessionId);
  writeRecord(repoRoot, {
    ...row,
    running: false,
    lastStopReason: 'stopped_by_hand',
    lastStopSentence: stopSentence('stopped_by_hand', { turns: row.turns }),
    finishedAt: new Date().toISOString(),
  });
  return goalRunState(repoRoot, sessionId);
}

/* ──────────────────────────────── the loop ───────────────────────────────── */

/**
 * WORK THE PLAN DOWN. The order of the checks below IS the design.
 *
 * Read it as: what could be true after a turn, in the order that makes the
 * cheapest correct decision first. The three "the turn produced nothing" cases
 * come before the strike, because charging a step for a dead connection is the
 * failure rule two exists to prevent, and a check placed after the strike
 * cannot prevent it.
 */
export async function workGoalRun(deps: GoalRunnerDeps): Promise<GoalRunState> {
  const { repoRoot, sessionId } = deps;
  const clock = deps.now ?? ((): Date => new Date());

  /** Per-step, keyed by id. A park clears the key — the step is no longer open. */
  const strikes = new Map<string, number>();
  let hollow = 0;
  let narrated = 0;
  let failures = 0;
  /** Strike-taking turns since anything was last ticked. Drives the replan. */
  let barren = 0;
  let parkedInARow = 0;
  let askedForARewrite = false;
  let scaffold: string | null = null;
  /** Plan turns taken while the plan was empty. Bounded by GOAL_RUN_PLAN_TURNS. */
  let planTurns = 0;

  const finish = (
    reason: GoalRunStopReason,
    facts: StopFacts,
    audit?: { lastVerdict?: GoalAuditVerdict; lastAuditNote?: string },
  ): GoalRunState => {
    const row = readGoalRun(repoRoot, sessionId);
    if (row) {
      writeRecord(repoRoot, {
        ...row,
        running: false,
        lastStopReason: reason,
        lastStopSentence: stopSentence(reason, facts),
        ...(audit?.lastVerdict === undefined ? {} : { lastVerdict: audit.lastVerdict }),
        ...(audit?.lastAuditNote === undefined ? {} : { lastAuditNote: audit.lastAuditNote }),
        finishedAt: clock().toISOString(),
      });
    }
    return goalRunState(repoRoot, sessionId);
  };

  /**
   * THE COMPLETION AUDIT (carrying-harness plan, wave A4), ported from MiniMax
   * Code's Completion Audit. One more turn, aimed at nothing, whose scaffold
   * asks for evidence per requirement and a VERDICT line; the run ends on that
   * verdict. `before` is the reason the run had earned WITHOUT the audit, and
   * it is what the run ends on when the audit turn yields no verdict — a
   * fallback that keeps `plan_worked_down` and `turn_cap` meaning what they
   * meant, with `lastAuditNote` saying why no verdict was read. A ticked plan
   * is a set of claims; this is where the claims meet the files.
   */
  const auditThen = async (before: GoalRunStopReason, at: 'worked_down' | 'cap'): Promise<GoalRunState> => {
    const row = readGoalRun(repoRoot, sessionId);
    const plan = deps.readPlan();
    const outcome = await deps.takeTurn({ aimingAt: null, scaffold: AUDIT_SCAFFOLD, plan, audit: true });
    const after = readGoalRun(repoRoot, sessionId);
    if (after) writeRecord(repoRoot, { ...after, turns: after.turns + 1 });
    const facts: StopFacts = { cap: row?.cap ?? GOAL_RUN_TURN_CAP, counts: planCounts(deps.readPlan()), at };
    if (outcome.kind !== 'ok') {
      return finish(before, facts, {
        lastAuditNote: `the audit turn did not run (${outcome.error ?? outcome.kind})`,
      });
    }
    const read = parseAuditVerdict(outcome.text);
    if (!read) {
      return finish(before, facts, { lastAuditNote: 'the audit turn wrote no VERDICT line, so no verdict was read' });
    }
    return finish(AUDITED_REASON[read.verdict], { ...facts, ...(read.note === '' ? {} : { note: read.note }) }, {
      lastVerdict: read.verdict,
      lastAuditNote: read.note,
    });
  };

  for (;;) {
    /* 1. SOMEBODY ELSE'S STOP. Read from disk, never from a flag in this
          closure: the whole reason Stop works from a second window (or a second
          process) is that this row is the only thing either of them consults. */
    const row = readGoalRun(repoRoot, sessionId);
    if (!row || !row.running) return goalRunState(repoRoot, sessionId);

    /* 2. THE CAP, CHECKED BEFORE THE TURN. After would spend the turn and then
          refuse to count it, which is the same money for a worse record. */
    if (row.turns >= row.cap) {
      return finish('turn_cap', { cap: row.cap, counts: planCounts(deps.readPlan()) });
    }

    /* 2a. THE LAST ALLOWED TURN IS THE AUDIT (wave A4), when there is still a
          step open to be honest about. It REPLACES the last work turn rather
          than adding one, so a cap of N is still N turns; a run of one turn
          has no work to audit and keeps its bare `turn_cap`. */
    if (row.turns === row.cap - 1 && row.turns > 0 && firstOpenStep(deps.readPlan()) !== undefined) {
      return auditThen('turn_cap', 'cap');
    }

    /* 3. IS THERE ANYTHING LEFT? Four endings, and they are four because the
          right next action differs: a finished plan needs nothing, a
          mostly-parked one needs reading, an entirely-parked one needs
          rewriting. One reason for all three would tell the reader none of it. */
    const plan = deps.readPlan();

    /* 3a. NO PLAN YET. A plan turn: aimed at nothing, scaffolded to write the
          steps, and never a strike — there is no step to charge. Three of them
          is the bound (GOAL_RUN_PLAN_TURNS); the connection rule still applies. */
    if (plan.length === 0) {
      planTurns += 1;
      if (planTurns > GOAL_RUN_PLAN_TURNS) {
        return finish('no_plan_written', { n: GOAL_RUN_PLAN_TURNS });
      }
      /* 3b. THE HARNESS WRITES THE PLAN (wave A6) in place of the LAST plan
            turn: two turns that wrote nothing are the evidence a third would
            not, and a skeleton from the files the goal names gives the model
            one concrete step to work instead of a third request for a list.
            Null (the goal names no file here) ⇒ the third plan turn as before. */
      if (planTurns === GOAL_RUN_PLAN_TURNS && deps.planSkeleton) {
        const skeleton = deps.planSkeleton();
        const first = skeleton ? firstOpenStep(skeleton) : undefined;
        if (skeleton && first) {
          deps.writePlan(skeleton);
          scaffold = skeletonScaffold(first.text);
          continue;
        }
      }
      const planOutcome = await deps.takeTurn({ aimingAt: null, scaffold: PLAN_NUDGE, plan });
      const afterPlan = readGoalRun(repoRoot, sessionId);
      if (afterPlan) writeRecord(repoRoot, { ...afterPlan, turns: afterPlan.turns + 1 });
      if (planOutcome.kind === 'threw') {
        return finish('turn_failed', { ...(planOutcome.error === undefined ? {} : { error: planOutcome.error }) });
      }
      if (planOutcome.kind === 'provider-failed') {
        failures += 1;
        if (failures >= GOAL_RUN_PROVIDER_FAILURES) {
          return finish('provider_failed', { counts: planCounts(deps.readPlan()) });
        }
        continue;
      }
      failures = 0;
      continue;
    }

    const aiming = firstOpenStep(plan);
    if (!aiming) {
      const counts = planCounts(plan);
      /* A WORKED-DOWN PLAN IS AUDITED (wave A4): the ticks are the model's
         claims and the audit checks them against the files. The two endings
         that already say the PLAN failed are not audited — there is nothing
         claimed to verify, and the parked lines are the reading. */
      if (counts.parked === 0) return auditThen('plan_worked_down', 'worked_down');
      if (counts.done === 0) return finish('nothing_could_be_worked', { counts });
      if (counts.parked > counts.done) return finish('parked_more_than_it_did', { counts });
      return auditThen('plan_worked_down', 'worked_down');
    }

    /* 4. ONE TURN, AIMED AT ONE STEP. */
    const outcome = await deps.takeTurn({
      aimingAt: aiming,
      scaffold: scaffold ?? aimScaffold(aiming.text),
      plan,
    });
    const after = readGoalRun(repoRoot, sessionId);
    if (after) writeRecord(repoRoot, { ...after, turns: after.turns + 1 });
    scaffold = null;

    /* 5. THE PIPELINE ITSELF FAILED. Not retried: a throw is a defect, and
          twenty-three more attempts at a defect is twenty-three more of it. */
    if (outcome.kind === 'threw') {
      return finish('turn_failed', { ...(outcome.error === undefined ? {} : { error: outcome.error }) });
    }

    /* 6. THE CONNECTION FAILED. NO STRIKE — rule two. A dead provider says
          nothing about whether the step can be done, and parking a good step
          because the network blinked is the exact failure. Two in a row is the
          bound; one is a hiccup worth retrying, three is a pattern. */
    if (outcome.kind === 'provider-failed') {
      failures += 1;
      if (failures >= GOAL_RUN_PROVIDER_FAILURES) {
        return finish('provider_failed', { counts: planCounts(deps.readPlan()) });
      }
      continue;
    }
    failures = 0;

    /* The plan as the TURN left it — read from the turn's own outcome rather
       than from a second disk read, so another window's edit between the turn
       and this line cannot be mistaken for the turn's work. */
    const planAfter = outcome.plan;
    const stillOpen = planAfter.some((s) => s.id === aiming.id && s.status === 'open');

    /* 7. NOTHING CAME BACK AT ALL. NO STRIKE — rule two, and the honest reading
          is that the model has stopped answering, not that the step is hard. */
    if (outcome.text.trim() === '' && outcome.toolCallsMade === 0) {
      hollow += 1;
      if (hollow >= GOAL_RUN_HOLLOW_TURNS) {
        return finish('the_model_stopped_answering', { n: hollow, counts: planCounts(planAfter) });
      }
      continue;
    }
    hollow = 0;

    /* 8. IT TALKED AND CALLED NOTHING. NO STRIKE — rule two. This is the
          commonest weak-model failure and the reason the nudge exists: four
          identical narrating turns with nothing between them teach the model
          nothing, so the nudge is the one thing that changes. */
    if (stillOpen && outcome.toolCallsMade === 0) {
      narrated += 1;
      if (narrated >= GOAL_RUN_NARRATION_TURNS) {
        return finish('the_model_only_narrated', { n: narrated, counts: planCounts(planAfter) });
      }
      /* The first narrated turn is nudged; the second and later get the read
         done for them (wave A7). The counter still ends the run at four — a
         model that narrates past a file handed to it is not going to act —
         and the stop is decided first so the last turn costs no read. */
      scaffold =
        narrated === 1 ? NARRATION_NUDGE : narrationNudgeHard(aiming, deps.readForStep?.(aiming) ?? null);
      continue;
    }
    narrated = 0;

    if (stillOpen) {
      /* 9. A REAL ATTEMPT THAT DID NOT CLOSE THE STEP. This one costs a strike:
            tools were called, the step was worked, and it is still open. */
      const n = (strikes.get(aiming.id) ?? 0) + 1;
      strikes.set(aiming.id, n);
      barren += 1;
      if (n >= GOAL_RUN_STRIKES) {
        /* THE MODEL'S OWN LAST WORDS ARE THE REASON. Not a sentence we write:
           the person deciding whether to rewrite this step needs the thing that
           actually stopped it, and "could not be completed" tells them nothing
           they did not already know from the `[!]`. */
        const parked = parkStep(planAfter, aiming.id, lastWords(outcome.text));
        deps.writePlan(parked);
        strikes.delete(aiming.id);
        parkedInARow += 1;
        if (parkedInARow >= GOAL_RUN_PARKS_IN_A_ROW) {
          return finish('the_plan_could_not_be_worked', { n: parkedInARow, counts: planCounts(parked) });
        }
      }
    } else {
      /* 10. THE STEP CLOSED. Everything that was counting against it resets —
             including `narrated`, because a run that is moving is not a run
             that is narrating, whatever the last few turns looked like. */
      strikes.delete(aiming.id);
      barren = 0;
      parkedInARow = 0;
      narrated = 0;
    }

    /* 11. ONE REWRITE, ONCE. See REPLAN_NUDGE for why it is not offered twice. */
    if (barren >= GOAL_RUN_REPLAN_AFTER && !askedForARewrite) {
      askedForARewrite = true;
      barren = 0;
      scaffold = REPLAN_NUDGE;
    }
  }
}

/**
 * THE SENTENCE A PARK IS FILED UNDER — the model's own last words.
 *
 * The LAST paragraph's first sentence, because a model's closing paragraph is
 * where it says what went wrong and its opening paragraph is where it says what
 * it is about to try. Markdown furniture is stripped from the front so the
 * reason does not arrive as "## What I found".
 *
 * It is a QUOTE, not a verdict. Nothing downstream parses it, nothing branches
 * on it, and if it is useless the `[!]` still says the step was not done.
 */
export function lastWords(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== '');
  const last = paragraphs[paragraphs.length - 1];
  if (last === undefined) return 'the model said nothing about why';
  const sentence = last.split(/(?<=[.!?])\s+/)[0] ?? last;
  return sentence.replace(/^[*\-#>\s]+/, '').slice(0, 220) || last.slice(0, 220);
}
