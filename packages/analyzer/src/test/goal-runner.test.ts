import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { PlanStep } from '@sequence/api-types';
import { createSession, readSessionGoal, updateSession } from '../server/sessionsStore.js';
import { markStepDone, parkStep } from '../server/goalPlan.js';
import {
  GOAL_RUN_HOLLOW_TURNS,
  GOAL_RUN_NARRATION_TURNS,
  GOAL_RUN_PARKS_IN_A_ROW,
  GOAL_RUN_PLAN_TURNS,
  GOAL_RUN_PROVIDER_FAILURES,
  GOAL_RUN_REPLAN_AFTER,
  GOAL_RUN_STRIKES,
  GOAL_RUN_TURN_CAP,
  NARRATION_NUDGE,
  PLAN_NUDGE,
  REPLAN_NUDGE,
  AUDIT_SCAFFOLD,
  goalRunState,
  lastWords,
  narrationNudgeHard,
  parseAuditVerdict,
  readGoalRun,
  reapGoalRuns,
  skeletonScaffold,
  startGoalRun,
  stopGoalRun,
  type GoalRunnerDeps,
  type GoalTurnOutcome,
} from '../server/goalRunner.js';

/**
 * THE LOOP, AGAINST A FAKE PIPELINE.
 *
 * `goalRunner.ts` owns no wiring precisely so that this file can drive the REAL
 * control flow — the real counters, the real order of checks, the real writes
 * to the real run file — while `takeTurn` is a function in this test. Nothing
 * here stubs the loop; the only thing replaced is the provider.
 *
 * ── EACH STOP REASON IS PRODUCED BY A CASE THAT PRODUCES ONLY IT ────────────
 *
 * That is the point of the file and the reason each scenario below is written
 * as a script of turn outcomes rather than as "run it and see". A probe that
 * trips two branches proves neither: if a run could reach
 * `the_model_only_narrated` through a path that also strikes, then a green test
 * would not tell us which rule fired. Every scenario below asserts the reason
 * AND the thing that must NOT have happened alongside it — for the three
 * "produced nothing" cases, that the plan was not parked.
 */

function freshRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-goal-run-'));
}

function seed(
  repo: string,
  steps: Array<[string, PlanStep['status'], string?]>,
): { id: string; plan: PlanStep[] } {
  const made = createSession(repo);
  const plan: PlanStep[] = steps.map(([text, status, why], i) => ({
    id: `s${i + 1}`,
    text,
    status,
    ...(why === undefined ? {} : { why }),
  }));
  updateSession(repo, made.id, { goal: 'work the plan down', plan });
  return { id: made.id, plan };
}

/** One turn's script. The loop's own state decides which of these it reaches. */
type Script = (args: {
  turn: number;
  plan: PlanStep[];
  aiming: PlanStep | null;
  /** True on the completion-audit turn (wave A4). */
  audit: boolean;
}) => Partial<GoalTurnOutcome>;

interface Harness {
  deps: GoalRunnerDeps;
  /** Every step the loop aimed at, in order — the record the assertions read. */
  aimed: string[];
  /** The scaffold the loop handed each turn, so a nudge can be asserted. */
  scaffolds: string[];
  turns: number;
}

function harness(repo: string, id: string, script: Script): Harness {
  /* The REAL reader, not a hand-rolled one: the loop's whole premise is that
     the plan on disk is the truth, and a test that read it a second way could
     pass while the production path read nothing. */
  const readPlan = (): PlanStep[] => readSessionGoal(repo, id).plan ?? [];
  const h: Harness = {
    aimed: [],
    scaffolds: [],
    turns: 0,
    deps: {
      repoRoot: repo,
      sessionId: id,
      readPlan,
      writePlan: (plan) => {
        updateSession(repo, id, { plan: [...plan] });
      },
      takeTurn: async ({ aimingAt, scaffold, plan, audit }) => {
        h.turns += 1;
        h.aimed.push(aimingAt === null ? (audit === true ? '(audit)' : '(plan)') : aimingAt.text);
        h.scaffolds.push(scaffold);
        const out = script({ turn: h.turns, plan: [...plan], aiming: aimingAt, audit: audit === true });
        const base: GoalTurnOutcome = {
          kind: 'ok',
          text: 'I had a look.',
          toolCallsMade: 1,
          plan: [...plan],
        };
        return { ...base, ...out };
      },
    },
  };
  return h;
}

/** A turn that ticked the step it was aimed at — the only thing that closes one. */
function ticked(plan: readonly PlanStep[], step: PlanStep): PlanStep[] {
  const out = markStepDone(plan, step.text);
  assert.ok(out.ok, `the test's own tick failed: ${out.ok ? '' : out.reason}`);
  return out.steps;
}

async function run(h: Harness, permission = 'build'): Promise<void> {
  const started = startGoalRun(h.deps, { permission });
  assert.ok(started.ok, `run refused: ${started.ok ? '' : started.message}`);
  await started.done;
}

/* ─────────────────────────── refusals at the door ────────────────────────── */

test('a run refuses to start in Plan mode — a plan does not run steps', () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open']]);
  const out = startGoalRun(harness(repo, id, () => ({})).deps, { permission: 'plan' });
  assert.ok(!out.ok);
  assert.strictEqual(out.status, 400);
  assert.strictEqual(out.reason, 'not_building');
  assert.match(out.message, /Plan mode does not run steps/);
  assert.strictEqual(goalRunState(repo, id).running, false, 'a refused start left no run row');
});

test('a run refuses to start with no open step', () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'done'], ['Measure it', 'parked', 'no tool']]);
  const out = startGoalRun(harness(repo, id, () => ({})).deps, { permission: 'build' });
  assert.ok(!out.ok);
  assert.strictEqual(out.status, 400);
  assert.strictEqual(out.reason, 'nothing_open');
});

test('a second start is a 409 while one is running, and the first row is untouched', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open']]);
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const h = harness(repo, id, () => ({}));
  const slow: GoalRunnerDeps = {
    ...h.deps,
    takeTurn: async (args) => {
      await gate;
      return h.deps.takeTurn(args);
    },
  };
  const first = startGoalRun(slow, { permission: 'build' });
  assert.ok(first.ok);
  const second = startGoalRun(slow, { permission: 'build' });
  assert.ok(!second.ok);
  assert.strictEqual(second.status, 409);
  assert.strictEqual(second.reason, 'already_running');
  stopGoalRun(repo, id);
  release!();
  await first.done;
});

/* ────────────────────────────── the happy path ───────────────────────────── */

test('plan_worked_down: one turn per step, each aimed at the first open one', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [
    ['Read the parser', 'open'],
    ['Add the guard', 'open'],
    ['Lock it with a test', 'open'],
  ]);
  const h = harness(repo, id, ({ plan, aiming, audit }) => (audit ? {} : { plan: ticked(plan, aiming!) }));
  /* The fake pipeline reports the plan; the REAL one persists it, so the test
     has to do that half too or the loop's next read finds nothing moved. */
  const deps: GoalRunnerDeps = {
    ...h.deps,
    takeTurn: async (args) => {
      const out = await h.deps.takeTurn(args);
      h.deps.writePlan(out.plan);
      return out;
    },
  };
  const started = startGoalRun(deps, { permission: 'build' });
  assert.ok(started.ok);
  const state = await started.done;

  /* Three work turns and then the COMPLETION AUDIT (wave A4): one more turn,
     aimed at nothing, asked for a verdict. This script's audit reply carries
     no VERDICT line, so the run keeps the reason it had earned and says why
     no verdict was read. */
  assert.deepStrictEqual(h.aimed, ['Read the parser', 'Add the guard', 'Lock it with a test', '(audit)']);
  assert.strictEqual(h.scaffolds[3], AUDIT_SCAFFOLD);
  assert.strictEqual(state.running, false);
  assert.strictEqual(state.lastStopReason, 'plan_worked_down');
  assert.match(state.lastStopSentence!, /every step is ticked \(3\)/);
  assert.strictEqual(state.lastVerdict, undefined);
  assert.match(state.lastAuditNote!, /wrote no VERDICT line/);
  assert.strictEqual(state.turns, 4);
});

/* ────────────────── the completion audit (carrying-harness plan, A4) ─────── */

test('audited_pass: a worked-down plan is audited, and the run ends on the VERDICT line', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open'], ['Add the guard', 'open']]);
  const h = harness(repo, id, ({ plan, aiming, audit }) =>
    audit
      ? { text: 'Requirements:\n1. guard present - src/parse.ts:40\n\nVERDICT: PASS — both requirements read back from the files', toolCallsMade: 2 }
      : { plan: ticked(plan, aiming!) },
  );
  const deps: GoalRunnerDeps = {
    ...h.deps,
    takeTurn: async (args) => {
      const out = await h.deps.takeTurn(args);
      h.deps.writePlan(out.plan);
      return out;
    },
  };
  const state = await (startGoalRun(deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; lastStopSentence?: string; lastVerdict?: string; lastAuditNote?: string; turns: number }> }).done;
  assert.strictEqual(state.lastStopReason, 'audited_pass');
  assert.strictEqual(state.lastVerdict, 'PASS');
  assert.strictEqual(state.lastAuditNote, 'both requirements read back from the files');
  assert.match(state.lastStopSentence!, /^audited PASS after the plan was worked down \(2 done, 0 parked\)/);
  assert.match(state.lastStopSentence!, /both requirements read back/);
  assert.strictEqual(state.turns, 3, 'two work turns and the audit');
});

test('audited_partial and audited_fail carry the audit\'s own words, and the plan is not touched', async () => {
  for (const [verdict, reason] of [['PARTIAL', 'audited_partial'], ['FAIL', 'audited_fail']] as const) {
    const repo = freshRepo();
    const { id } = seed(repo, [['Read the parser', 'open']]);
    const h = harness(repo, id, ({ plan, aiming, audit }) =>
      audit
        ? { text: `**VERDICT: ${verdict}** — the guard was verified, the test was not`, toolCallsMade: 1 }
        : { plan: ticked(plan, aiming!) },
    );
    const deps: GoalRunnerDeps = {
      ...h.deps,
      takeTurn: async (args) => {
        const out = await h.deps.takeTurn(args);
        h.deps.writePlan(out.plan);
        return out;
      },
    };
    const state = await (startGoalRun(deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; lastStopSentence?: string; lastVerdict?: string; lastAuditNote?: string }> }).done;
    assert.strictEqual(state.lastStopReason, reason);
    assert.strictEqual(state.lastVerdict, verdict);
    assert.strictEqual(state.lastAuditNote, 'the guard was verified, the test was not');
    assert.match(state.lastStopSentence!, new RegExp(`^audited ${verdict} `));
    /* The audit reports; it never ticks, parks or rewrites. */
    assert.deepStrictEqual(h.deps.readPlan().map((s) => s.status), ['done']);
  }
});

test('the last allowed turn is the audit, so a cap of N is still N turns and ends on the verdict', async () => {
  const repo = freshRepo();
  const { id } = seed(
    repo,
    Array.from({ length: 30 }, (_, i) => [`Alpha step number ${i}`, 'open'] as [string, PlanStep['status']]),
  );
  const h = harness(repo, id, ({ plan, aiming, audit }) =>
    audit
      ? { text: 'VERDICT: PARTIAL — steps 0 and 1 verified in the files; the rest were never started', toolCallsMade: 3 }
      : { text: 'Could not finish.', toolCallsMade: 1, plan: parkStep(plan, aiming!.id, 'skipping') },
  );
  const deps: GoalRunnerDeps = {
    ...h.deps,
    takeTurn: async (args) => {
      const out = await h.deps.takeTurn(args);
      h.deps.writePlan(out.plan);
      return out;
    },
  };
  const state = await (startGoalRun(deps, { permission: 'build', cap: 4 }) as { done: Promise<{ lastStopReason?: string; lastStopSentence?: string; turns: number; cap: number }> }).done;
  assert.deepStrictEqual(h.aimed.slice(3), ['(audit)'], 'the fourth and last turn is the audit');
  assert.strictEqual(state.turns, 4);
  assert.strictEqual(state.lastStopReason, 'audited_partial');
  assert.match(state.lastStopSentence!, /^audited PARTIAL on the last of its 4 turns/);
  assert.match(state.lastStopSentence!, /the rest were never started/);
});

test('an audit turn the connection fails ends on the pre-audit reason and says the audit did not run', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open']]);
  const h = harness(repo, id, ({ plan, aiming, audit }) =>
    audit ? { kind: 'provider-failed', text: '', toolCallsMade: 0, error: 'HTTP 503' } : { plan: ticked(plan, aiming!) },
  );
  const deps: GoalRunnerDeps = {
    ...h.deps,
    takeTurn: async (args) => {
      const out = await h.deps.takeTurn(args);
      h.deps.writePlan(out.plan);
      return out;
    },
  };
  const state = await (startGoalRun(deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; lastVerdict?: string; lastAuditNote?: string }> }).done;
  assert.strictEqual(state.lastStopReason, 'plan_worked_down');
  assert.strictEqual(state.lastVerdict, undefined);
  assert.match(state.lastAuditNote!, /did not run \(HTTP 503\)/);
});

test('parseAuditVerdict reads the LAST verdict line, through markdown, and nothing else', () => {
  assert.deepStrictEqual(parseAuditVerdict('VERDICT: PASS — all good'), { verdict: 'PASS', note: 'all good' });
  assert.deepStrictEqual(parseAuditVerdict('**VERDICT: partial** - the test was not run'), { verdict: 'PARTIAL', note: 'the test was not run' });
  assert.deepStrictEqual(parseAuditVerdict('- VERDICT: FAIL'), { verdict: 'FAIL', note: '' });
  assert.deepStrictEqual(
    parseAuditVerdict('If the guard were in place I would write VERDICT: PASS.\n\nIt is not.\n\nVERDICT: FAIL — no guard at src/parse.ts'),
    { verdict: 'FAIL', note: 'no guard at src/parse.ts' },
  );
  assert.strictEqual(parseAuditVerdict('I checked everything and it passes.'), null);
  assert.strictEqual(parseAuditVerdict('verdict: maybe'), null);
});

test('the scaffold names the step and is NEVER a nudge on a healthy turn', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open']]);
  const h = harness(repo, id, ({ plan, aiming, audit }) => (audit ? {} : { plan: ticked(plan, aiming!) }));
  const deps: GoalRunnerDeps = {
    ...h.deps,
    takeTurn: async (args) => {
      const out = await h.deps.takeTurn(args);
      h.deps.writePlan(out.plan);
      return out;
    },
  };
  await (startGoalRun(deps, { permission: 'build' }) as { done: Promise<unknown> }).done;
  /* The one work turn carries the plain aim; the audit that follows a
     worked-down plan (wave A4) carries the audit scaffold and nothing else. */
  assert.deepStrictEqual(h.scaffolds, ['Work this step of the plan now, with tools: Read the parser', AUDIT_SCAFFOLD]);
});

/* ─────────────────────── strike, park, and the plan verdict ───────────────── */

test('a real attempt that leaves the step open costs a strike; two park it with the model\'s own words', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Measure the baseline', 'open']]);
  const h = harness(repo, id, () => ({
    text: 'I looked at the scripts.\n\nThere is no benchmark script in this repository. I cannot measure it.',
    toolCallsMade: 2,
  }));
  const started = startGoalRun(h.deps, { permission: 'build' });
  assert.ok(started.ok);
  const state = await started.done;

  const plan = h.deps.readPlan();
  assert.strictEqual(plan[0]!.status, 'parked');
  assert.strictEqual(plan[0]!.why, 'There is no benchmark script in this repository.');
  assert.strictEqual(h.turns, GOAL_RUN_STRIKES, 'a step is parked after exactly two real attempts');
  /* One step, all parked: `nothing_could_be_worked` is the only ending this
     shape can reach, and that is what makes it a case producing only it. */
  assert.strictEqual(state.lastStopReason, 'nothing_could_be_worked');
  assert.match(state.lastStopSentence!, /not one of the 1 steps could be done/);
});

test('the_plan_could_not_be_worked: three parks in a row stop the run before the plan runs out', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [
    ['Alpha step', 'open'],
    ['Bravo step', 'open'],
    ['Charlie step', 'open'],
    ['Delta step', 'open'],
    ['Echo step', 'open'],
  ]);
  const h = harness(repo, id, () => ({ text: 'Blocked.', toolCallsMade: 1 }));
  const started = startGoalRun(h.deps, { permission: 'build' });
  assert.ok(started.ok);
  const state = await started.done;

  assert.strictEqual(state.lastStopReason, 'the_plan_could_not_be_worked');
  assert.match(state.lastStopSentence!, /3 steps in a row could not be done/);
  const plan = h.deps.readPlan();
  assert.strictEqual(plan.filter((s) => s.status === 'parked').length, GOAL_RUN_PARKS_IN_A_ROW);
  assert.strictEqual(
    plan.filter((s) => s.status === 'open').length,
    2,
    'it stopped rather than parking the whole plan',
  );
});

test('parked_more_than_it_did and plan_worked_down are different endings', async () => {
  /* One done, two parked — more skipped than done. */
  const repo = freshRepo();
  const { id } = seed(repo, [['Alpha step', 'done'], ['Bravo step', 'open'], ['Charlie step', 'open']]);
  const h = harness(repo, id, () => ({ text: 'Blocked.', toolCallsMade: 1 }));
  const state = await (startGoalRun(h.deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; lastStopSentence?: string }> }).done;
  assert.strictEqual(state.lastStopReason, 'parked_more_than_it_did');
  assert.match(state.lastStopSentence!, /more of this plan was skipped than done/);

  /* Two done, one parked — mostly worked. Entered by starting on a plan that
     already carries the park, so the only thing this run does is the tick. */
  const repo2 = freshRepo();
  const { id: id2 } = seed(repo2, [
    ['Alpha step', 'done'],
    ['Bravo step', 'parked', 'no tool for it'],
    ['Charlie step', 'open'],
  ]);
  const h2 = harness(repo2, id2, ({ plan, aiming, audit }) => (audit ? {} : { plan: ticked(plan, aiming!) }));
  const deps2: GoalRunnerDeps = {
    ...h2.deps,
    takeTurn: async (args) => {
      const out = await h2.deps.takeTurn(args);
      h2.deps.writePlan(out.plan);
      return out;
    },
  };
  const state2 = await (startGoalRun(deps2, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; lastStopSentence?: string }> }).done;
  assert.strictEqual(state2.lastStopReason, 'plan_worked_down');
  assert.match(state2.lastStopSentence!, /2 done, 1 parked/);
});

/* ────────── the three "produced nothing" rules — NO STRIKE, EVER ──────────── */

test('the_model_stopped_answering: four empty replies stop the run and park NOTHING', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open']]);
  const h = harness(repo, id, () => ({ text: '', toolCallsMade: 0 }));
  const state = await (startGoalRun(h.deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; lastStopSentence?: string }> }).done;

  assert.strictEqual(state.lastStopReason, 'the_model_stopped_answering');
  assert.strictEqual(h.turns, GOAL_RUN_HOLLOW_TURNS);
  assert.deepStrictEqual(
    h.deps.readPlan().map((s) => s.status),
    ['open'],
    'an empty turn says nothing about the step, so nothing was parked',
  );
  assert.match(state.lastStopSentence!, /nothing was parked/);
});

test('the_model_only_narrated: four tool-less turns stop the run, park NOTHING, and each is nudged', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open']]);
  const h = harness(repo, id, () => ({ text: 'I will now read the parser.', toolCallsMade: 0 }));
  const state = await (startGoalRun(h.deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; lastStopSentence?: string }> }).done;

  assert.strictEqual(state.lastStopReason, 'the_model_only_narrated');
  assert.strictEqual(h.turns, GOAL_RUN_NARRATION_TURNS);
  assert.deepStrictEqual(h.deps.readPlan().map((s) => s.status), ['open']);
  /* The nudge is the ONE thing that changes between otherwise identical turns —
     without it the run takes four turns and teaches the model nothing. */
  assert.strictEqual(h.scaffolds[0], 'Work this step of the plan now, with tools: Read the parser');
  /* Wave A7: the first narrated turn is nudged; the second and later get the
     hard form, which names the one call to make first. With no `readForStep`
     dep there is no file to hand over, so the hard form is the bare one. */
  const step = h.deps.readPlan()[0]!;
  const hard = narrationNudgeHard(step, null);
  assert.match(hard, /Your FIRST token this reply is a tool call/);
  assert.deepStrictEqual(h.scaffolds.slice(1), [NARRATION_NUDGE, hard, hard]);
});

test('the second narrated turn gets the read done for it when the step names a file (wave A7)', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Add the guard to src/parse.ts with propose_files', 'open']]);
  const h = harness(repo, id, () => ({ text: 'I will now add the guard.', toolCallsMade: 0 }));
  const reads: string[] = [];
  const deps: GoalRunnerDeps = {
    ...h.deps,
    readForStep: (step) => {
      reads.push(step.text);
      return { path: 'src/parse.ts', text: 'export function parse() {}', truncated: false };
    },
  };
  const state = await (startGoalRun(deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string }> }).done;
  assert.strictEqual(state.lastStopReason, 'the_model_only_narrated', 'the counter still ends the run at four');
  assert.strictEqual(h.scaffolds[1], NARRATION_NUDGE, 'the first narrated turn is only nudged');
  assert.match(h.scaffolds[2]!, /the harness made the first move for you: here is src\/parse\.ts/);
  assert.match(h.scaffolds[2]!, /--- src\/parse\.ts ---\nexport function parse\(\) \{\}\n--- end of src\/parse\.ts ---/);
  assert.match(h.scaffolds[2]!, /Do NOT read it again/);
  assert.strictEqual(reads.length, 2, 'one harness read per hard nudge that is sent; none for the soft one, none for the stop');
});

test('provider_failed: two failures in a row stop the run and park NOTHING', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open']]);
  const h = harness(repo, id, () => ({ kind: 'provider-failed' as const, text: '', toolCallsMade: 0 }));
  const state = await (startGoalRun(h.deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; lastStopSentence?: string }> }).done;

  assert.strictEqual(state.lastStopReason, 'provider_failed');
  assert.strictEqual(h.turns, GOAL_RUN_PROVIDER_FAILURES);
  assert.deepStrictEqual(h.deps.readPlan().map((s) => s.status), ['open']);
});

test('one provider failure between good turns is a hiccup, not a strike', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open'], ['Add the guard', 'open']]);
  const h = harness(repo, id, ({ turn, plan, aiming, audit }) =>
    turn === 1 || turn === 3
      ? { kind: 'provider-failed' as const, text: '', toolCallsMade: 0 }
      : audit
        ? {}
        : { plan: ticked(plan, aiming!) },
  );
  const deps: GoalRunnerDeps = {
    ...h.deps,
    takeTurn: async (args) => {
      const out = await h.deps.takeTurn(args);
      if (out.kind === 'ok') h.deps.writePlan(out.plan);
      return out;
    },
  };
  const state = await (startGoalRun(deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string }> }).done;
  assert.strictEqual(state.lastStopReason, 'plan_worked_down');
  assert.deepStrictEqual(h.deps.readPlan().map((s) => s.status), ['done', 'done']);
});

test('turn_failed: a pipeline throw stops the run and is NOT retried', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open']]);
  const h = harness(repo, id, () => ({ kind: 'threw' as const, error: 'digest is undefined', text: '', toolCallsMade: 0 }));
  const state = await (startGoalRun(h.deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; lastStopSentence?: string }> }).done;

  assert.strictEqual(state.lastStopReason, 'turn_failed');
  assert.strictEqual(h.turns, 1, 'a defect is not worth twenty-three more attempts');
  assert.match(state.lastStopSentence!, /digest is undefined/);
});

/* ───────────────────────────── cap, stop, replan ─────────────────────────── */

test('turn_cap: the run hands back after its turns rather than running forever', async () => {
  const repo = freshRepo();
  const { id } = seed(
    repo,
    Array.from({ length: 30 }, (_, i) => [`Alpha step number ${i}`, 'open'] as [string, PlanStep['status']]),
  );
  /* Never ticks, never strikes twice on the SAME step: each turn narrates once
     then works, so the step stays open and takes one strike per turn — with
     thirty steps the cap is the only thing this shape can reach. */
  const h = harness(repo, id, ({ plan, aiming, audit }) =>
    audit
      ? {}
      : {
          text: 'Could not finish.',
          toolCallsMade: 1,
          plan: parkStep(plan, aiming!.id, 'skipping'),
        },
  );
  const deps: GoalRunnerDeps = {
    ...h.deps,
    takeTurn: async (args) => {
      const out = await h.deps.takeTurn(args);
      h.deps.writePlan(out.plan);
      return out;
    },
  };
  const state = await (startGoalRun(deps, { permission: 'build', cap: 5 }) as { done: Promise<{ lastStopReason?: string; lastAuditNote?: string; turns: number; cap: number }> }).done;
  /* The fifth turn is the audit (wave A4); this script's reply to it carries no
     VERDICT line, so the cap keeps its own name and the note says why. */
  assert.strictEqual(h.aimed[4], '(audit)');
  assert.strictEqual(state.lastStopReason, 'turn_cap');
  assert.match(state.lastAuditNote!, /no VERDICT line/);
  assert.strictEqual(state.turns, 5);
  assert.strictEqual(state.cap, 5);
});

test('the default cap is ML Harness\'s', () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'open']]);
  const started = startGoalRun(harness(repo, id, () => ({})).deps, { permission: 'build' });
  assert.ok(started.ok);
  assert.strictEqual(started.state.cap, GOAL_RUN_TURN_CAP);
  stopGoalRun(repo, id);
});

test('stopped_by_hand: Stop is a persisted row, so another window ends the run', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Alpha step', 'open'], ['Bravo step', 'open'], ['Charlie step', 'open']]);
  const h = harness(repo, id, ({ turn }) => {
    /* The "other window" — it touches only the file, exactly as the route does. */
    if (turn === 2) stopGoalRun(repo, id);
    return { text: 'Working.', toolCallsMade: 1 };
  });
  const state = await (startGoalRun(h.deps, { permission: 'build' }) as { done: Promise<{ running: boolean; lastStopReason?: string; lastStopSentence?: string }> }).done;

  assert.strictEqual(state.running, false);
  assert.strictEqual(state.lastStopReason, 'stopped_by_hand');
  assert.strictEqual(h.turns, 2, 'the turn in flight finished; no third turn started');
  assert.match(state.lastStopSentence!, /stopped by hand after 1 turn\b/);
});

test('the replan nudge is offered once, after three barren strike turns', async () => {
  const repo = freshRepo();
  const { id } = seed(
    repo,
    Array.from({ length: 12 }, (_, i) => [`Alpha step number ${i}`, 'open'] as [string, PlanStep['status']]),
  );
  /*
   * A REAL ATTEMPT EVERY TURN THAT NEVER CLOSES THE STEP — the only shape in
   * which `barren` climbs at all. It is incremented on a STRIKE and nowhere
   * else (that is rule two: nothing that produced nothing may charge the plan),
   * so every other failure mode leaves it at zero and no rewrite is ever asked
   * for. Turns run: strike, strike+park, strike → the nudge is handed to turn
   * four.
   */
  const h = harness(repo, id, () => ({ text: 'Could not finish.', toolCallsMade: 1 }));
  await (startGoalRun(h.deps, { permission: 'build', cap: 10 }) as { done: Promise<unknown> }).done;

  const nudges = h.scaffolds.filter((s) => s === REPLAN_NUDGE);
  assert.strictEqual(nudges.length, 1, 'a rewrite is asked for once per run, never twice');
  assert.strictEqual(
    h.scaffolds.indexOf(REPLAN_NUDGE),
    GOAL_RUN_REPLAN_AFTER,
    'it arrives on the turn after the third barren one',
  );
});

/* ──────────────────────────── the durable row ────────────────────────────── */

test('the run row is on disk, and a restart reports engine_restarted not running', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Alpha step', 'open'], ['Bravo step', 'open']]);
  const h = harness(repo, id, ({ turn }) => {
    if (turn === 1) {
      /* Mid-run the file says running — that is what a second window reads. */
      assert.strictEqual(goalRunState(repo, id).running, true);
      assert.strictEqual(readGoalRun(repo, id)!.pid, process.pid);
      stopGoalRun(repo, id);
    }
    return {};
  });
  await (startGoalRun(h.deps, { permission: 'build' }) as { done: Promise<unknown> }).done;

  /* Forge the orphan the way a killed engine leaves one, then boot. */
  const row = readGoalRun(repo, id)!;
  fs.writeFileSync(
    path.join(repo, '.sequence', 'sessions', id, 'goal-run.json'),
    JSON.stringify({ ...row, running: true, lastStopReason: undefined, lastStopSentence: undefined }),
  );
  assert.strictEqual(goalRunState(repo, id).running, true, 'the forged orphan reads as running');

  const reaped = reapGoalRuns(repo);
  assert.deepStrictEqual(reaped, [id]);
  const after = goalRunState(repo, id);
  assert.strictEqual(after.running, false);
  assert.strictEqual(after.lastStopReason, 'engine_restarted');
  assert.match(after.lastStopSentence!, /picks up at the first open step/);
});

test('a session that never ran reads as a stopped run of zero turns, never a 404', () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Alpha step', 'open']]);
  assert.deepStrictEqual(goalRunState(repo, id), { running: false, turns: 0, cap: GOAL_RUN_TURN_CAP });
});

test('stopping a run that is not running is not an error', () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Alpha step', 'open']]);
  assert.strictEqual(stopGoalRun(repo, id).running, false);
});

/* ──────────────────────────────── park reasons ───────────────────────────── */

test('lastWords quotes the closing sentence, stripped of markdown furniture', () => {
  /* The LAST paragraph, because that is where a model says what went wrong —
     its opening paragraph says what it is about to try. */
  assert.strictEqual(
    lastWords('Here is what I tried.\n\n## Result\n\nThe script does not exist. I stopped there.'),
    'The script does not exist.',
  );
  /* Markdown furniture is stripped so a reason does not arrive as "## Result". */
  assert.strictEqual(lastWords('I looked.\n\n  ## No such script'), 'No such script');
  assert.strictEqual(
    lastWords('I read the file.\n\nThere is no such script. I stopped.'),
    'There is no such script.',
  );
  assert.strictEqual(lastWords(''), 'the model said nothing about why');
});

/* ── A GOAL WITH NO PLAN (owner, 2026-09-17: "once you create a goal, you can
   tell the agent to work on the goal") ─────────────────────────────────── */

test('a bare goal starts: the first turn is a PLAN turn aimed at nothing, and the run works what it writes', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, []);
  const h = harness(repo, id, ({ turn, plan, aiming, audit }) => {
    if (turn === 1) {
      /* The model's `write_plan` — persisted, as the real tool persists it. */
      const written: PlanStep[] = [{ id: 'p1', text: 'Write the note with write_file', status: 'open' }];
      updateSession(repo, id, { plan: written });
      return { plan: written, toolCallsMade: 1, text: 'Planned.' };
    }
    if (audit) return {};
    assert.ok(aiming, 'turn two aims at the step the plan turn wrote');
    return { plan: ticked(plan, aiming!), toolCallsMade: 2, text: 'Wrote it.' };
  });
  /* Write-through, as the happy-path test does: the real pipeline persists. */
  const deps: GoalRunnerDeps = {
    ...h.deps,
    takeTurn: async (args) => {
      const out = await h.deps.takeTurn(args);
      h.deps.writePlan(out.plan);
      return out;
    },
  };
  const started = startGoalRun(deps, { permission: 'build' });
  assert.ok(started.ok, 'an empty plan is not a refusal');
  const final = await started.done;
  assert.strictEqual(h.aimed[0], '(plan)');
  assert.strictEqual(h.scaffolds[0], PLAN_NUDGE);
  assert.strictEqual(h.aimed[1], 'Write the note with write_file');
  assert.strictEqual(h.aimed[2], '(audit)');
  assert.strictEqual(final.lastStopReason, 'plan_worked_down');
  assert.strictEqual(final.turns, 3, 'the plan turn, the work turn, the audit');
});

test('the harness writes the plan in place of the third plan turn when the goal names files (wave A6)', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, []);
  const skeleton: PlanStep[] = [
    { id: 'k1', text: 'Read src/a.ts with read_file and note what the goal needs changed in it', status: 'open' },
    { id: 'k2', text: 'Make the change the goal describes in src/a.ts with propose_files', status: 'open' },
  ];
  const h = harness(repo, id, ({ plan, aiming, audit }) => {
    if (audit) return { text: 'VERDICT: PASS — a.ts carries the change', toolCallsMade: 1 };
    if (aiming === null) return { text: 'What would you like me to do?', toolCallsMade: 0 };
    return { plan: ticked(plan, aiming), toolCallsMade: 2, text: 'Done.' };
  });
  let asked = 0;
  const deps: GoalRunnerDeps = {
    ...h.deps,
    planSkeleton: () => {
      asked += 1;
      return skeleton;
    },
    takeTurn: async (args) => {
      const out = await h.deps.takeTurn(args);
      h.deps.writePlan(out.plan);
      return out;
    },
  };
  const final = await (startGoalRun(deps, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; turns: number }> }).done;
  assert.deepStrictEqual(h.aimed, ['(plan)', '(plan)', skeleton[0]!.text, skeleton[1]!.text, '(audit)']);
  assert.strictEqual(asked, 1, 'the skeleton is asked for once, in place of the third plan turn');
  assert.strictEqual(h.scaffolds[2], skeletonScaffold(skeleton[0]!.text));
  assert.match(h.scaffolds[2]!, /the harness wrote one from the files the goal names/);
  assert.strictEqual(final.lastStopReason, 'audited_pass');
  assert.strictEqual(final.turns, 5);
});

test('a skeleton of null leaves the third plan turn and the no_plan_written ending as they were', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, []);
  const h = harness(repo, id, () => ({ text: 'What would you like me to do?', toolCallsMade: 0 }));
  const final = await (startGoalRun({ ...h.deps, planSkeleton: () => null }, { permission: 'build' }) as { done: Promise<{ lastStopReason?: string; turns: number }> }).done;
  assert.strictEqual(final.lastStopReason, 'no_plan_written');
  assert.strictEqual(final.turns, GOAL_RUN_PLAN_TURNS);
});

test('no_plan_written: three plan turns that write nothing stop the run, and park NOTHING', async () => {
  const repo = freshRepo();
  const { id } = seed(repo, []);
  const h = harness(repo, id, () => ({ text: 'What would you like me to do?', toolCallsMade: 0 }));
  const started = startGoalRun(h.deps, { permission: 'build' });
  assert.ok(started.ok);
  const final = await started.done;
  assert.strictEqual(final.lastStopReason, 'no_plan_written');
  assert.strictEqual(final.turns, GOAL_RUN_PLAN_TURNS);
  assert.deepStrictEqual(readSessionGoal(repo, id).plan ?? [], [], 'nothing was parked or invented');
  assert.ok(h.scaffolds.every((sc) => sc === PLAN_NUDGE), 'every plan turn carried the plan scaffold');
  assert.match(final.lastStopSentence ?? '', /none was written/);
});

test('a plan whose every step is ticked or parked is still refused — nothing to aim at', () => {
  const repo = freshRepo();
  const { id } = seed(repo, [['Read the parser', 'done']]);
  const out = startGoalRun(harness(repo, id, () => ({})).deps, { permission: 'build' });
  assert.ok(!out.ok);
  assert.strictEqual(out.reason, 'nothing_open');
});
