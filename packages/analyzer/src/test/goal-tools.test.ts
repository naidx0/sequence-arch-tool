import assert from 'node:assert';
import { test } from 'node:test';
import type { PlanStep } from '@sequence/api-types';
import { askToolsForJobMode, executeAskTool, type AskToolContext } from '../server/askTools.js';

/**
 * THE TWO PLAN TOOLS — who is offered them, and what they refuse.
 *
 * The belt half exists because of `board-tools-wired.test.ts`'s scar, pointed
 * the other way: a tool the executor handles but the belt never offers is
 * unreachable code with a clean build and a green suite, and a tool the belt
 * offers where it has no job is a provider round the person pays for a refusal.
 *
 * The permission half is the line that makes "a goal run must run in Build"
 * true inside the belt rather than only at the door. Plan mode's contract is
 * that the turn ends in words; a Plan turn that could tick steps would walk a
 * plan to all-done having written nothing — a progress display that lies.
 */

function ctx(plan: PlanStep[], persisted: PlanStep[][]): AskToolContext {
  return {
    resolveReadable: () => null,
    repoRoot: '/tmp/nowhere',
    designMode: false,
    question: 'work the plan',
    goalPlan: plan,
    persistPlan: (next: readonly PlanStep[]) => {
      persisted.push([...next]);
    },
  } as unknown as AskToolContext;
}

/* ---------------------------------- the belt ------------------------------ */

test('a session with NO goal is offered neither plan tool', () => {
  for (const permission of ['plan', 'build']) {
    const belt = askToolsForJobMode('code', permission, { goalDepth: 'none' });
    assert.ok(!belt.includes('write_plan'), `write_plan leaked into ${permission} with no goal`);
    assert.ok(!belt.includes('mark_step_done'));
  }
});

test('a goal with no steps yet is offered write_plan only — there is nothing to tick', () => {
  const belt = askToolsForJobMode('code', 'build', { goalDepth: 'goal' });
  assert.ok(belt.includes('write_plan'));
  assert.ok(!belt.includes('mark_step_done'));
});

test('Build with a plan gets both; PLAN MODE NEVER GETS mark_step_done', () => {
  const build = askToolsForJobMode('code', 'build', { goalDepth: 'plan' });
  assert.ok(build.includes('write_plan'));
  assert.ok(build.includes('mark_step_done'));

  const planMode = askToolsForJobMode('code', 'plan', { goalDepth: 'plan' });
  assert.ok(planMode.includes('write_plan'), 'breaking a job into steps IS what Plan mode is for');
  assert.ok(
    !planMode.includes('mark_step_done'),
    'Plan mode could tick steps it had not done — a progress display that lies',
  );
});

test('a teach turn is offered neither, whatever the goal', () => {
  const belt = askToolsForJobMode('code', 'build', { teach: true, goalDepth: 'plan' });
  assert.ok(!belt.includes('write_plan'));
  assert.ok(!belt.includes('mark_step_done'));
});

test('the plan tools change nothing else about the belt', () => {
  const without = askToolsForJobMode('code', 'build', { goalDepth: 'none' });
  const with_ = askToolsForJobMode('code', 'build', { goalDepth: 'plan' });
  assert.deepStrictEqual(
    with_.filter((t) => t !== 'write_plan' && t !== 'mark_step_done'),
    [...without],
  );
});

/* -------------------------------- the executor ---------------------------- */

test('write_plan persists immediately and names the first open step', async () => {
  const persisted: PlanStep[][] = [];
  const result = await executeAskTool(
    'write_plan',
    { steps: ['Read askTools.ts with read_file', 'Add the guard'] },
    ctx([{ id: 's1', text: 'An old step', status: 'done' }], persisted),
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(persisted.length, 1, 'the plan reached disk before the model was answered');
  assert.deepStrictEqual(persisted[0]!.map((s) => s.status), ['done', 'open', 'open']);
  assert.match(result.content ?? '', /Work the FIRST open step now/);
  assert.match(result.content ?? '', /Read askTools\.ts with read_file/);
});

test('write_plan refuses a gate and persists NOTHING', async () => {
  const persisted: PlanStep[][] = [];
  const result = await executeAskTool('write_plan', { steps: ['baseline measured'] }, ctx([], persisted));
  assert.strictEqual(result.ok, false);
  assert.match(result.evidence ?? '', /refused: write_plan — .*condition, not an action/);
  assert.strictEqual(persisted.length, 0);
});

test('mark_step_done ticks, persists, and points at the next step', async () => {
  const persisted: PlanStep[][] = [];
  const result = await executeAskTool(
    'mark_step_done',
    { step: 'read askTools' },
    ctx(
      [
        { id: 's1', text: 'Read askTools.ts with read_file', status: 'open' },
        { id: 's2', text: 'Add the guard', status: 'open' },
      ],
      persisted,
    ),
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(persisted[0]!.map((s) => s.status), ['done', 'open']);
  assert.match(result.content ?? '', /Go STRAIGHT ON to the next open step/);
  assert.match(result.content ?? '', /Add the guard/);
});

test('mark_step_done refuses an ambiguous match, lists the candidates, persists nothing', async () => {
  const persisted: PlanStep[][] = [];
  const result = await executeAskTool(
    'mark_step_done',
    { step: 'read the' },
    ctx(
      [
        { id: 's1', text: 'Read the parser', status: 'open' },
        { id: 's2', text: 'Read the writer', status: 'open' },
      ],
      persisted,
    ),
  );
  assert.strictEqual(result.ok, false);
  assert.match(result.evidence ?? '', /more than one open step/);
  assert.match(result.evidence ?? '', /"Read the parser"; "Read the writer"/);
  assert.strictEqual(persisted.length, 0);
});

test('a settled plan tells the model to say so and stop, rather than to keep ticking', async () => {
  const result = await executeAskTool(
    'mark_step_done',
    { step: 'read the parser' },
    ctx([{ id: 's1', text: 'Read the parser', status: 'done' }], []),
  );
  assert.strictEqual(result.ok, false);
  assert.match(result.evidence ?? '', /no open step to tick/);
});
