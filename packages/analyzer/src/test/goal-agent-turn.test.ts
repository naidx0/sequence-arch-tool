import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { PlanStep } from '@sequence/api-types';
import { createSession, readSessionGoal, updateSession } from '../server/sessionsStore.js';
import { GOAL_RUN_NO_PROGRESS_TURNS, readGoalRun, startGoalRun, type GoalRunnerDeps } from '../server/goalRunner.js';
import { goalToolCall } from '../server/goalAgentTools.js';
import { sequenceMcpServer } from '../server/sequenceMcp.js';
import { makeAcpTakeTurn, planFromText } from '../server/goalAgentTurn.js';

/**
 * A GOAL RUN DRIVEN BY AN AGENT, against a fake agent.
 *
 * The real loop, the real plan store and the real `goal` tool executor run; only
 * the agent behind `runNode` is a function in the test. Each case produces one
 * ending: ticks through the tool, ticks in text only, ticks nothing.
 */

function freshRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-goal-agent-'));
}

function seed(repo: string, texts: string[]): string {
  const made = createSession(repo);
  const plan: PlanStep[] = texts.map((text, i) => ({ id: `s${i + 1}`, text, status: 'open' }));
  updateSession(repo, made.id, { goal: 'work the plan down', plan });
  return made.id;
}

type Agent = (prompt: string, call: number) => string;

function deps(repo: string, id: string, agent: Agent, prompts: string[] = []): GoalRunnerDeps {
  let calls = 0;
  const readPlan = (): PlanStep[] => readSessionGoal(repo, id).plan ?? [];
  const writePlan = (plan: readonly PlanStep[]): void => {
    updateSession(repo, id, { plan: [...plan] });
  };
  return {
    repoRoot: repo,
    sessionId: id,
    readPlan,
    writePlan,
    takeTurn: makeAcpTakeTurn({
      readPlan,
      writePlan,
      goal: () => readSessionGoal(repo, id).goal,
      runNode: async (prompt) => {
        calls += 1;
        prompts.push(prompt);
        return { text: agent(prompt, calls), stopReason: 'end_turn' };
      },
    }),
  };
}

async function run(d: GoalRunnerDeps): Promise<void> {
  const started = startGoalRun(d, { permission: 'build' });
  assert.ok(started.ok, 'run refused');
  await started.done;
}

test('an ACP takeTurn that ticks step 1 then 2 through the goal tool works the plan down in 2 work turns, then audits', async () => {
  const repo = freshRepo();
  const id = seed(repo, ['Edit a.ts to add the guard', 'Edit b.ts to use the guard']);
  const prompts: string[] = [];
  const d = deps(
    repo,
    id,
    (prompt, call) => {
      if (call === 3) return 'VERDICT: PASS — both files changed';
      const word = call === 1 ? 'a.ts' : 'b.ts';
      const r = goalToolCall(repo, id, { op: 'mark_step_done', step: word });
      assert.ok(!r.isError, r.text);
      return `done with ${word}`;
    },
    prompts,
  );
  await run(d);
  const row = readGoalRun(repo, id)!;
  assert.strictEqual(row.running, false);
  assert.strictEqual(row.lastStopReason, 'audited_pass');
  assert.strictEqual(row.turns, 3, 'two work turns and the one audit turn');
  assert.deepStrictEqual((readSessionGoal(repo, id).plan ?? []).map((s) => s.status), ['done', 'done']);
  assert.match(prompts[0]!, /`goal`/, 'the agent is told which tool ticks');
  assert.match(prompts[0]!, /Edit a\.ts to add the guard/, 'and which step is next');
});

test('an agent that ignores the tool but prints the checklist is read exactly: only exact open lines are ticked', async () => {
  const repo = freshRepo();
  const id = seed(repo, ['Edit a.ts to add the guard', 'Edit b.ts to use the guard']);
  const d = deps(repo, id, (_p, call) => {
    if (call === 1) return '- [x] Edit a.ts to add the guard\n- [x] Edit b.ts to use the guard (nearly)';
    if (call === 2) return '- [x] edit  B.ts to use the guard';
    return 'VERDICT: PARTIAL — not checked';
  });
  await run(d);
  const plan = readSessionGoal(repo, id).plan ?? [];
  assert.deepStrictEqual(plan.map((s) => s.status), ['done', 'done']);
  assert.strictEqual(readGoalRun(repo, id)!.lastStopReason, 'audited_partial');
});

test('planFromText never un-ticks, never edits a step, and writes a plan only when there is none', () => {
  const plan: PlanStep[] = [
    { id: 's1', text: 'Read a.ts', status: 'done' },
    { id: 's2', text: 'Edit a.ts', status: 'open' },
  ];
  assert.strictEqual(planFromText(plan, '- [ ] Read a.ts\nprose [x] Edit a.ts', 's2'), null);
  assert.strictEqual(planFromText(plan, '- [x] Edit a.ts', 's1'), null, 'only the aimed step can be ticked');
  const next = planFromText(plan, '- [x] Edit a.ts', 's2');
  assert.deepStrictEqual(next?.map((s) => s.status), ['done', 'done']);
  const fresh = planFromText([], '- [ ] Read a.ts with read_file\n- [ ] Edit a.ts to add the guard');
  assert.deepStrictEqual(fresh?.map((s) => s.text), ['Read a.ts with read_file', 'Edit a.ts to add the guard']);
  assert.strictEqual(planFromText([], 'no checklist here'), null);
});

test('an agent that moves nothing on the plan ends the run no_progress after three turns and parks nothing', async () => {
  const repo = freshRepo();
  const id = seed(repo, ['Edit a.ts to add the guard', 'Edit b.ts to use the guard']);
  const prompts: string[] = [];
  const d = deps(repo, id, () => 'I looked at it and it seems fine.', prompts);
  await run(d);
  const row = readGoalRun(repo, id)!;
  assert.strictEqual(row.lastStopReason, 'no_progress');
  assert.strictEqual(row.turns, GOAL_RUN_NO_PROGRESS_TURNS);
  assert.deepStrictEqual((readSessionGoal(repo, id).plan ?? []).map((s) => s.status), ['open', 'open'], 'no step was parked');
  assert.match(prompts[1]!, /did not change the plan/, 'the second turn carries the tick nudge');
});

test('an agent that cannot be reached twice in a row ends the run provider_failed', async () => {
  const repo = freshRepo();
  const id = seed(repo, ['Edit a.ts to add the guard']);
  const readPlan = (): PlanStep[] => readSessionGoal(repo, id).plan ?? [];
  const d: GoalRunnerDeps = {
    repoRoot: repo,
    sessionId: id,
    readPlan,
    writePlan: (p) => void updateSession(repo, id, { plan: [...p] }),
    takeTurn: makeAcpTakeTurn({
      readPlan,
      writePlan: () => {},
      goal: () => undefined,
      runNode: async () => {
        throw new Error('agent exited');
      },
    }),
  };
  await run(d);
  assert.strictEqual(readGoalRun(repo, id)!.lastStopReason, 'provider_failed');
});

test('the goal tool changes nothing unless a run is live for the chat, and refuses what the built-in tools refuse', () => {
  const repo = freshRepo();
  const id = seed(repo, ['Edit a.ts to add the guard']);
  const idle = goalToolCall(repo, id, { op: 'mark_step_done', step: 'a.ts' });
  assert.ok(idle.isError);
  assert.deepStrictEqual((readSessionGoal(repo, id).plan ?? []).map((s) => s.status), ['open']);
  const seen: string[] = [];
  const d = deps(repo, id, () => {
    seen.push(goalToolCall(repo, id, { op: 'mark_step_done', step: 'nothing like it' }).text);
    seen.push(goalToolCall(repo, id, { op: 'write_plan', steps: [] }).text);
    seen.push(goalToolCall(repo, id, { op: 'bogus' }).text);
    return 'VERDICT: FAIL';
  });
  const started = startGoalRun(d, { permission: 'build', cap: 1 });
  assert.ok(started.ok);
  return started.done.then(() => {
    assert.match(seen[0]!, /no open step contains those words/);
    assert.match(seen[1]!, /empty list is not a plan/);
    assert.match(seen[2]!, /op must be/);
  });
});

test('a session started for a goal run carries the chat, app address and run key the goal tool uses; an ordinary session carries neither', () => {
  const plain = sequenceMcpServer('/repo', { entry: '/x/mcp.js' });
  assert.ok(plain && !('SEQUENCE_GOAL_CHAT' in (plain.env ?? {})));
  const goal = sequenceMcpServer('/repo', { entry: '/x/mcp.js', goal: { chat: 'c1', url: 'http://127.0.0.1:9', key: 'k1' } });
  assert.strictEqual(goal?.env?.SEQUENCE_GOAL_CHAT, 'c1');
  assert.strictEqual(goal?.env?.SEQUENCE_GOAL_URL, 'http://127.0.0.1:9');
  assert.strictEqual(goal?.env?.SEQUENCE_GOAL_KEY, 'k1');
});
