/**
 * WHAT THE GOALBAR SAYS ABOUT A GOAL RUN — pure, and pure on purpose.
 *
 * Every rule here is a decision a reader acts on: whether the button starts a
 * run or stops one, why it is disabled, how the last run ended and whether that
 * ending was a good one. None of it is drawing.
 *
 * ── WHY A MODULE AND NOT A `useMemo` INSIDE THE BAR ─────────────────────────
 *
 * ML Harness learned this one the expensive way and wrote its answer down in
 * `frontend/src/lib/theBuildKeepsGoing.ts`: the rule that decides whether to
 * keep going must be a TESTED FUNCTION, never a phrase the model says and never
 * a condition buried in a render. A stop rule inside a component can only be
 * checked by rendering the component, so the cases nobody thought to render are
 * the cases nobody checks — and those are exactly the ones that matter (the run
 * that ended while the tab was closed, the plan with nothing open, the mode
 * switched mid-run).
 *
 * ── THE SENTENCE IS THE SERVER'S, AND THAT IS DELIBERATE ────────────────────
 *
 * `lastStopSentence` arrives on the wire. This module decides WHETHER to show
 * it and HOW it reads, and never composes its own. A second vocabulary here
 * would be free to drift from `goalRunner.stopSentence`, and the failure would
 * be a screen that says one thing while the run file says another — the
 * two-surfaces-disagreeing defect, with no test that could see it because each
 * half would be right about itself.
 */

import type { GoalRunState, GoalRunStopReason, PlanStep } from '@sequence/api-types';

/** What the mode control under the composer is set to. */
export type GoalRunMode = 'plan' | 'build' | 'teach';

export interface GoalRunButton {
  label: string;
  disabled: boolean;
  /** The tooltip — and when disabled, it is the ONLY place the reason appears. */
  title: string;
  /** `start` POSTs the run · `stop` POSTs the stop · `none` is a disabled button. */
  action: 'start' | 'stop' | 'none';
}

/**
 * THE BUTTON, AND ITS REASON.
 *
 * A DISABLED CONTROL WITH NO EXPLANATION IS A BUG REPORT. The two things that
 * can disable it are both fixable in one move by the person looking at it —
 * switch to Build, or write a plan — and neither is guessable from a greyed-out
 * rectangle. So `title` is never empty and never generic.
 *
 * STOP IS NEVER DISABLED WHILE A RUN IS LIVE, whatever the mode says. Somebody
 * who switches to Plan mid-run must still be able to end the run; a Stop that
 * greys out because of a control unrelated to it is the worst possible moment
 * for this product to be pedantic.
 */
export function goalRunButton(input: {
  mode: GoalRunMode;
  plan: readonly PlanStep[];
  run: GoalRunState;
}): GoalRunButton {
  if (input.run.running) {
    return {
      label: 'Stop',
      disabled: false,
      title: `Stop the run — turn ${input.run.turns} of ${input.run.cap}. The turn in flight finishes; no new one starts.`,
      action: 'stop',
    };
  }
  const open = input.plan.filter((s) => s.status === 'open');
  if (input.mode !== 'build') {
    return {
      label: 'Work on goal',
      disabled: true,
      title:
        'A run works the plan down, and Plan mode does not run steps. Switch to Build under the chat box first.',
      action: 'none',
    };
  }
  if (input.plan.length === 0) {
    /* A bare goal is workable: the run's first turns write the plan
       (owner, 2026-09-17: create a goal, tell the agent to work on it). */
    return {
      label: 'Work on goal',
      disabled: false,
      title: 'No plan yet — the run writes one from the goal, then works it down one step per turn.',
      action: 'start',
    };
  }
  if (open.length === 0) {
    return {
      label: 'Work on goal',
      disabled: true,
      title: 'Every step is ticked or parked, so there is nothing for a run to work down.',
      action: 'none',
    };
  }
  return {
    label: 'Work on goal',
    disabled: false,
    title: `Work the plan down one step per turn, starting with: ${open[0]!.text}`,
    action: 'start',
  };
}

/**
 * HOW THE LAST RUN ENDED, FOR THE READER'S EYE.
 *
 * Four tones and not two, because "it stopped" hides the difference that
 * decides what to do next:
 *
 *   `done`      the plan was worked down — nothing to do
 *   `attention` it ran and the PLAN was the problem — read the parked lines
 *   `failed`    the MODEL or the connection was the problem — try again
 *   `neutral`   a cap, a Stop, a restart — a boundary, not a verdict
 *
 * The three AUDITED endings (carrying-harness plan, wave A4) map onto the same
 * four: a PASS is done, a PARTIAL needs the reader's eye on what was not
 * verified, a FAIL is the goal not reached — the model's problem, so `failed`.
 *
 * `goalRunner.stopSentence` carries the same distinction in words; this is the
 * same distinction in one token a stylesheet can use.
 */
export type GoalRunTone = 'done' | 'attention' | 'failed' | 'neutral';

export function goalRunTone(reason: GoalRunStopReason | undefined): GoalRunTone {
  switch (reason) {
    case 'plan_worked_down':
    case 'audited_pass':
      return 'done';
    case 'parked_more_than_it_did':
    case 'nothing_could_be_worked':
    case 'the_plan_could_not_be_worked':
    case 'audited_partial':
      return 'attention';
    case 'provider_failed':
    case 'the_model_stopped_answering':
    case 'the_model_only_narrated':
    case 'turn_failed':
    case 'audited_fail':
      return 'failed';
    default:
      return 'neutral';
  }
}

export interface GoalRunLastLine {
  text: string;
  tone: GoalRunTone;
}

/**
 * THE LAST RUN'S SENTENCE, or `null` when there is nothing honest to say.
 *
 * `null` for a session that has never run — an empty state is not a result, and
 * a bar that says "no runs yet" spends a line telling the reader something the
 * absence of everything else already told them.
 *
 * `null` WHILE A RUN IS LIVE, too: the previous run's verdict sitting under a
 * progress bar reads as this run's, and a reader glancing at "plan worked down"
 * while the thing is mid-grind has been told the opposite of the truth.
 *
 * NO LONGER A ROW OF ITS OWN. It used to be printed under the plan as
 * `Last run: …` and the owner read the bar in a narrow window and asked for the
 * row to go (walk-4-white-glass-plan.md §2): a third line under a list that is
 * itself now collapsed is a line nobody's eye is near. `goalRunRestLine` below
 * folds this sentence into the bar's own second line, which is where the eye
 * already is. This stays exported because it is the rule — whether there is
 * anything to say at all — and `goalRunRestLine` is its one caller.
 */
export function goalRunLastLine(run: GoalRunState): GoalRunLastLine | null {
  if (run.running) return null;
  const sentence = run.lastStopSentence?.trim();
  if (!sentence) return null;
  return { text: sentence, tone: goalRunTone(run.lastStopReason) };
}

export interface GoalRunRestLine {
  text: string;
  tone: GoalRunTone;
}

/**
 * THE BAR'S SECOND LINE WHILE NOTHING IS RUNNING — the counterpart to
 * `goalRunNowLine`, and the reason a COLLAPSED bar loses nothing.
 *
 * The plan list under the bar is closed by default now, so this one line is the
 * whole of what a reader sees about a plan they have not opened. It therefore
 * has to carry both things they would have gone looking for:
 *
 *   FINISHED   `Finished · 0 of 1 done · stopped by hand`
 *              The count first, because it is the fact; the server's own
 *              sentence last, because it is the reason. The word "Finished"
 *              matches the status pill beside it rather than inventing a second
 *              vocabulary for the same state.
 *   NOT YET    `1 of 3 done, 1 parked · Next: Add the guard`
 *              A plan that has never run has no outcome to fold, so the line
 *              spends its tail on the step a run would start at — the one thing
 *              a collapsed list would otherwise hide.
 *
 * The sentence is still the SERVER's, never composed here (see this file's
 * header). The tone rides along so the stylesheet can colour the line without
 * re-deriving why it ended.
 */
export function goalRunRestLine(
  run: GoalRunState,
  plan: readonly PlanStep[],
): GoalRunRestLine | null {
  if (run.running) return null;
  const progress = goalPlanProgress(plan);
  if (progress.total === 0) return null;

  const counted = `${progress.done} of ${progress.total} done`;
  const last = goalRunLastLine(run);
  if (last) return { text: `Finished · ${counted} · ${last.text}`, tone: last.tone };

  const parked = progress.parked > 0 ? `, ${progress.parked} parked` : '';
  const next = plan.find((s) => s.status === 'open');
  return {
    text: next ? `${counted}${parked} · Next: ${next.text}` : `${counted}${parked}`,
    tone: 'neutral',
  };
}

export interface GoalPlanProgress {
  done: number;
  parked: number;
  open: number;
  total: number;
  /** `2/5` — what the bar prints beside the track. */
  label: string;
  /** 0‥1 for the progress track's transform. */
  fraction: number;
}

/**
 * DONE OVER TOTAL, with parked counted in the DENOMINATOR and not the
 * numerator.
 *
 * A parked step is not progress and it is not gone. Counting it as done would
 * let a run that skipped everything report a full bar; dropping it from the
 * total would make a plan shrink as it failed, which is the cheerful-lying
 * direction. Five steps with three done and one parked is `3/5`, and the
 * missing fifth is the reader's to notice.
 */
export function goalPlanProgress(plan: readonly PlanStep[]): GoalPlanProgress {
  let done = 0;
  let parked = 0;
  let open = 0;
  for (const s of plan) {
    if (s.status === 'done') done += 1;
    else if (s.status === 'parked') parked += 1;
    else open += 1;
  }
  const total = plan.length;
  return {
    done,
    parked,
    open,
    total,
    label: `${done}/${total}`,
    fraction: total === 0 ? 0 : done / total,
  };
}

/**
 * How many turns a run may spend asking for a plan before it gives up —
 * `GOAL_RUN_PLAN_TURNS` in `packages/analyzer/src/server/goalRunner.ts`, which
 * owns it. Mirrored rather than imported because web2 does not depend on the
 * analyzer package; unlike `run.cap` it never travels on the wire.
 *
 * This one IS a real bound: a run with no plan after three turns stops with
 * `no_plan_written`. So it belongs in the line, where `cap` does not.
 */
export const GOAL_RUN_PLAN_TURNS = 3;

export interface GoalRunNowLine {
  /** What the bar prints. */
  text: string;
  /** The tooltip — and the ONLY place the safety ceiling is named. */
  title: string;
}

/**
 * THE LINE UNDER THE GOAL WHILE A RUN IS WORKING — where in the PLAN, then how
 * many turns it has taken.
 *
 * ── WHY THE CAP LEFT THE LINE (owner, 2026-09-18) ───────────────────────────
 *
 * It used to read `turn 3 of 24`, and the owner read the 24 the only way that
 * string can be read: *"it shows turn 1 of 24. Why is there 24 turns, right?
 * If it's a four-part plan…"*. `X of Y` is the shape a progress readout has,
 * so a reader takes Y for the amount of work. `run.cap` is not the amount of
 * work — it is a SAFETY CEILING inherited from ML Harness's `longrun.py`, the
 * number of turns after which the run stops itself whatever is left. Printing
 * it beside a four-step plan tells the reader a four-step plan is 24 turns
 * long, which is false in both directions: most runs never reach it, and a run
 * that does has not finished anything.
 *
 * So the line now leads with the thing that IS the work — `step 2 of 4` — and
 * keeps the turn count as a bare count, which is honest without implying a
 * denominator. The ceiling is still reachable, in `title`, where a tooltip is
 * read by somebody who is already asking "how long can this go on".
 *
 * PLANNING TURNS ARE DIFFERENT. Before a plan exists there is no step to name,
 * and the bound that applies is `GOAL_RUN_PLAN_TURNS` — a real one, three turns
 * and then the run stops. `Planning · turn 1 of 3` is therefore true in exactly
 * the way `turn 1 of 24` was not.
 */
export function goalRunNowLine(run: GoalRunState, plan: readonly PlanStep[]): GoalRunNowLine | null {
  if (!run.running) return null;
  const title = `stops by itself after ${run.cap} turns`;
  const turn = `turn ${run.turns + 1}`;

  /* No plan yet — the run is spending its planning turns. */
  if (plan.length === 0) {
    return { text: `Planning · ${turn} of ${GOAL_RUN_PLAN_TURNS}`, title };
  }

  const at = plan.findIndex((s) => s.status === 'open');
  if (at < 0) return { text: `Working · ${turn}`, title };
  return { text: `Working · step ${at + 1} of ${plan.length} · ${plan[at].text} · ${turn}`, title };
}
