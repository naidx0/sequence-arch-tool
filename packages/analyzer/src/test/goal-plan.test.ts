import assert from 'node:assert';
import { test } from 'node:test';
import {
  AUDIT_VERDICT_LINE,
  FIDELITY_CLAUSE,
  GOAL_NEEDS_WORDS,
  MAX_PLAN_STEPS,
  PARKED_MARK,
  firstOpenStep,
  pathTokensIn,
  skeletonFromGoal,
  goalFromFirstMessage,
  markStepDone,
  parkStep,
  parsePlanChecklist,
  planCounts,
  renderGoalSection,
  renderPlanChecklist,
  unparkStep,
  validatePlan,
  whyNotAnAction,
  writePlan,
} from '../server/goalPlan.js';
import type { PlanStep } from '@sequence/api-types';

/**
 * THE PLAN MODULE — parse, tick, park, and the two prompt voices.
 *
 * Every assertion here is about a rule `goalPlan.ts` states a reason for, and
 * the round-trip test exists because the render side and the parse side must
 * agree BYTE FOR BYTE on {@link PARKED_MARK}: an en dash on one side and an em
 * dash on the other produces a plan whose parked reasons silently vanish while
 * every step still looks parked, and nothing else in the system would notice.
 */

function plan(...rows: Array<[string, PlanStep['status'], string?]>): PlanStep[] {
  return rows.map(([text, status, why], i) => ({
    id: `s${i + 1}`,
    text,
    status,
    ...(why === undefined ? {} : { why }),
  }));
}

/* ------------------------------ checklist I/O ----------------------------- */

test('parsePlanChecklist reads open, done and parked marks', () => {
  const steps = parsePlanChecklist(
    [
      '# not a step',
      '- [ ] Read askTools.ts with read_file',
      '* [x] Add the goal section',
      `  - [!] Measure the baseline${PARKED_MARK}run_command refused: no such script`,
      '',
    ].join('\n'),
  );
  assert.deepStrictEqual(
    steps.map((s) => s.status),
    ['open', 'done', 'parked'],
  );
  assert.strictEqual(steps[2]!.text, 'Measure the baseline');
  assert.strictEqual(steps[2]!.why, 'run_command refused: no such script');
});

test('render → parse is a round trip, parked reason included', () => {
  const before = plan(
    ['Read the parser', 'done'],
    ['Add the guard', 'open'],
    ['Measure it', 'parked', 'no benchmark exists'],
  );
  const after = parsePlanChecklist(renderPlanChecklist(before));
  assert.deepStrictEqual(
    after.map((s) => [s.text, s.status, s.why]),
    before.map((s) => [s.text, s.status, s.why]),
  );
});

test('a parked step with no reason renders and parses as an honest placeholder', () => {
  const rendered = renderPlanChecklist([{ id: 's1', text: 'Do it', status: 'parked' }]);
  assert.ok(rendered.includes(PARKED_MARK));
  assert.strictEqual(parsePlanChecklist(rendered)[0]!.why, 'no reason recorded');
});

/* ------------------------------- validation ------------------------------- */

test('validatePlan accepts the empty plan — clearing is a thing a person does', () => {
  const v = validatePlan([]);
  assert.ok(v.ok && v.steps.length === 0);
});

test('validatePlan refuses garbage rather than repairing it', () => {
  for (const [raw, needle] of [
    ['not an array', 'must be an array'],
    [[{ text: 'x', status: 'open' }], 'non-empty "id"'],
    [[{ id: 'a', status: 'open' }], 'non-empty "text"'],
    [[{ id: 'a', text: 'x', status: 'nope' }], 'use one of'],
    [
      [
        { id: 'a', text: 'x', status: 'open' },
        { id: 'a', text: 'y', status: 'open' },
      ],
      'duplicate step id',
    ],
    [[{ id: 'a', text: 'x', status: 'done', why: 'because' }], 'must not carry a park reason'],
  ] as const) {
    const v = validatePlan(raw);
    assert.ok(!v.ok, `expected a refusal for ${JSON.stringify(raw)}`);
    assert.match(v.reason, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('validatePlan fills a missing park reason rather than refusing a person Park', () => {
  const v = validatePlan([{ id: 'a', text: 'x', status: 'parked' }]);
  assert.ok(v.ok);
  assert.strictEqual(v.steps[0]!.why, 'no reason recorded');
});

test('validatePlan refuses more than MAX_PLAN_STEPS', () => {
  const many = Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, i) => ({
    id: `s${i}`,
    text: `step ${i}`,
    status: 'open',
  }));
  const v = validatePlan(many);
  assert.ok(!v.ok);
  assert.match(v.reason, /at most 40 steps/);
});

/* --------------------------- an action, not a gate ------------------------ */

test('whyNotAnAction names a condition as a gate and lets a real step through', () => {
  assert.strictEqual(whyNotAnAction('Read askTools.ts with read_file'), null);
  assert.strictEqual(whyNotAnAction('Run the analyzer build and read the errors'), null);
  for (const gate of ['baseline measured', 'prompting exhausted', 'the tests passing']) {
    const why = whyNotAnAction(gate);
    assert.ok(why !== null, `"${gate}" should be refused as a gate`);
    assert.match(why, /condition, not an action|one word/);
  }
});

/* -------------------------------- write_plan ------------------------------ */

test('write_plan replaces the open steps and never touches done or parked', () => {
  const before = plan(
    ['Read the parser', 'done'],
    ['Measure it', 'parked', 'no benchmark'],
    ['Old step one', 'open'],
    ['Old step two', 'open'],
  );
  const out = writePlan(before, ['Add the guard to askTools.ts', 'Lock it with a test']);
  assert.ok(out.ok);
  assert.deepStrictEqual(
    out.steps.map((s) => [s.text, s.status]),
    [
      ['Read the parser', 'done'],
      ['Measure it', 'parked'],
      ['Add the guard to askTools.ts', 'open'],
      ['Lock it with a test', 'open'],
    ],
  );
  assert.strictEqual(out.steps[1]!.why, 'no benchmark', 'the parked reason survived the rewrite');
  assert.strictEqual(out.replaced, 2);
  assert.strictEqual(out.added, 2);
});

test('write_plan gives every new step an id no kept step already has', () => {
  const before = plan(['Read the parser', 'done'], ['Old', 'open']);
  const out = writePlan(before, ['New one', 'New two']);
  assert.ok(out.ok);
  assert.strictEqual(new Set(out.steps.map((s) => s.id)).size, out.steps.length);
});

test('write_plan refuses an empty list, a gate, and a duplicate of a kept step', () => {
  assert.match((writePlan([], []) as { reason: string }).reason, /empty list is not a plan/);
  assert.match(
    (writePlan([], ['baseline measured']) as { reason: string }).reason,
    /condition, not an action/,
  );
  const kept = plan(['Read the parser', 'done']);
  assert.match(
    (writePlan(kept, ['Read the parser']) as { reason: string }).reason,
    /already on the plan/,
  );
});

test('write_plan accepts steps handed back as rendered checklist lines', () => {
  const out = writePlan([], ['- [ ] Read the parser with read_file']);
  assert.ok(out.ok);
  assert.strictEqual(out.steps[0]!.text, 'Read the parser with read_file');
});

/* ------------------------------ mark_step_done ---------------------------- */

test('mark_step_done ticks the one open step the words match, and names the next', () => {
  const before = plan(['Read the parser', 'open'], ['Add the guard', 'open']);
  const out = markStepDone(before, 'READ   the  parser');
  assert.ok(out.ok);
  assert.strictEqual(out.steps[0]!.status, 'done');
  assert.strictEqual(out.next?.text, 'Add the guard');
  assert.deepStrictEqual(out.counts, { total: 2, open: 1, done: 1, parked: 0 });
});

test('mark_step_done refuses an ambiguous match rather than picking one', () => {
  const before = plan(['Read the parser', 'open'], ['Read the writer', 'open']);
  const out = markStepDone(before, 'read the');
  assert.ok(!out.ok);
  assert.match(out.reason, /more than one open step/);
  assert.strictEqual(out.matches?.length, 2);
});

test('mark_step_done says "already ticked" separately from "no such step"', () => {
  const before = plan(['Read the parser', 'done'], ['Add the guard', 'open']);
  const already = markStepDone(before, 'read the parser');
  assert.ok(!already.ok);
  assert.match(already.reason, /already ticked/);

  const missing = markStepDone(before, 'deploy to production');
  assert.ok(!missing.ok);
  assert.match(missing.reason, /no open step contains those words/);
});

test('mark_step_done refuses when nothing is open and when no words were sent', () => {
  assert.match(
    (markStepDone(plan(['Done', 'done']), 'done') as { reason: string }).reason,
    /no open step to tick/,
  );
  assert.match(
    (markStepDone(plan(['Open', 'open']), '   ') as { reason: string }).reason,
    /say a few words/,
  );
});

/* -------------------------------- park / unpark --------------------------- */

test('parkStep records the reason it was given and unpark drops it', () => {
  const before = plan(['Measure it', 'open']);
  const parked = parkStep(before, 's1', '  run_command\nrefused  ');
  assert.strictEqual(parked[0]!.status, 'parked');
  assert.strictEqual(parked[0]!.why, 'run_command refused');
  const back = unparkStep(parked, 's1');
  assert.strictEqual(back[0]!.status, 'open');
  assert.strictEqual(back[0]!.why, undefined);
});

test('parkStep never invents a reason it was not given', () => {
  assert.strictEqual(parkStep(plan(['x y', 'open']), 's1', '')[0]!.why, 'no reason recorded');
});

/* --------------------------------- the goal ------------------------------- */

test('a goal is adopted only from a message of at least GOAL_NEEDS_WORDS words', () => {
  assert.strictEqual(goalFromFirstMessage('hi'), null);
  assert.strictEqual(goalFromFirstMessage('what is this'), null);
  assert.strictEqual(GOAL_NEEDS_WORDS, 4);
  assert.strictEqual(
    goalFromFirstMessage('  make the goalbar work   properly '),
    'make the goalbar work properly',
  );
});

/* ------------------------------- the two voices --------------------------- */

test('no goal and no plan renders NOTHING — the prompt is unchanged', () => {
  assert.deepStrictEqual(renderGoalSection({ runLive: false }), []);
  assert.deepStrictEqual(renderGoalSection({ goal: '   ', plan: [], runLive: true }), []);
});

test('the IDLE voice says the goal is context and does not order a grind', () => {
  const text = renderGoalSection({
    goal: 'ship the goal run',
    plan: plan(['Read the parser', 'open']),
    runLive: false,
  }).join('\n');
  assert.match(text, /ship the goal run/);
  assert.match(text, /CONTEXT, not an order/);
  assert.doesNotMatch(text, /Work that step NOW/);
});

test('the LIVE voice names ONE step and forbids the three things instead of working', () => {
  const steps = plan(['Read the parser', 'done'], ['Add the guard', 'open'], ['Ship it', 'open']);
  const text = renderGoalSection({
    goal: 'ship the goal run',
    plan: steps,
    runLive: true,
    aimingAt: 'Add the guard',
  }).join('\n');
  assert.match(text, /THIS TURN'S STEP/);
  assert.match(text, /> Add the guard/);
  assert.doesNotMatch(text, /> Ship it/, 'only the aimed step is quoted as the order');
  assert.match(text, /DO NOT stop to summarise/);
  assert.match(text, /DO NOT ask what to do next/);
  assert.match(text, /DO NOT narrate/);
  assert.match(text, /mark_step_done/);
});

test('the LIVE voice with nothing open tells it to say so and stop', () => {
  const allDone = renderGoalSection({ goal: 'g g g g', plan: plan(['A', 'done']), runLive: true }).join('\n');
  assert.match(allDone, /every step is ticked \(1\)/);
  assert.match(allDone, /Say so in one line and stop/);

  const withParked = renderGoalSection({
    goal: 'g g g g',
    plan: plan(['A', 'done'], ['B', 'parked', 'no tool']),
    runLive: true,
  }).join('\n');
  assert.match(withParked, /1 parked as undoable/);
});

test('the live voice aims at the first open step when the caller names none', () => {
  const text = renderGoalSection({ plan: plan(['First', 'open'], ['Second', 'open']), runLive: true }).join('\n');
  assert.match(text, /> First/);
});

/* ─────────── the carrying-harness plan: fidelity (A5) and the audit (A4) ─── */

test('the FIDELITY CLAUSE is in the live voice and absent from the idle one', () => {
  const steps = plan(['Add the guard', 'open']);
  const live = renderGoalSection({ goal: 'ship the goal run', plan: steps, runLive: true }).join('\n');
  const idle = renderGoalSection({ goal: 'ship the goal run', plan: steps, runLive: false }).join('\n');
  assert.ok(live.includes(FIDELITY_CLAUSE), 'the exact clause, so a paraphrase cannot drift it');
  assert.ok(!idle.includes(FIDELITY_CLAUSE));
  assert.match(FIDELITY_CLAUSE, /not the easiest change that makes a check pass/);
  assert.match(FIDELITY_CLAUSE, /never tick a step you did not do/);
});

test('the AUDIT voice asks for evidence per requirement and a VERDICT line, and forbids doing the work', () => {
  const steps = plan(['Read the parser', 'done'], ['Add the guard', 'done'], ['Ship it', 'parked', 'no tool']);
  const text = renderGoalSection({ goal: 'ship the goal run', plan: steps, runLive: true, audit: true }).join('\n');
  assert.match(text, /THIS TURN IS THE COMPLETION AUDIT/);
  assert.match(text, /2 of 3 ticked, 1 parked\. A tick is a claim, not evidence/);
  assert.match(text, /VERIFY it with a tool THIS TURN/);
  assert.ok(text.includes(AUDIT_VERDICT_LINE));
  assert.match(text, /DO NOT tick, park or rewrite steps in this turn/);
  /* It is a different turn from a work turn, not a work turn with a footer. */
  assert.doesNotMatch(text, /Work that step NOW/);
  assert.doesNotMatch(text, /Nothing is left open/);
  /* And the flag means nothing when the run is not live. */
  const idle = renderGoalSection({ goal: 'ship the goal run', plan: steps, runLive: false, audit: true }).join('\n');
  assert.doesNotMatch(idle, /COMPLETION AUDIT/);
});

/* ───────────────────── the plan the harness writes (A6) ──────────────────── */

test('pathTokensIn finds paths, backticked names and bare names with an extension, in order, once', () => {
  assert.deepStrictEqual(
    pathTokensIn('Add a guard to src/parse.ts and `askTools.ts`, then update README.md (see src/parse.ts).'),
    ['askTools.ts', 'src/parse.ts', 'README.md'],
  );
  assert.deepStrictEqual(pathTokensIn('make it faster'), []);
  assert.deepStrictEqual(pathTokensIn('fix the bug in packages\\web2\\src\\App.tsx'), ['packages\\web2\\src\\App.tsx']);
});

test('skeletonFromGoal: a read per named file, one change, one re-read, every line an action', () => {
  const files: Record<string, string> = { 'parse.ts': 'src/parse.ts', 'askTools.ts': 'packages/analyzer/src/server/askTools.ts' };
  const resolve = (w: string): string | null => files[w] ?? null;
  const steps = skeletonFromGoal('Add a null guard to parse.ts and wire it in askTools.ts', resolve)!;
  assert.deepStrictEqual(
    steps.map((s) => s.text),
    [
      'Read src/parse.ts with read_file and note what the goal needs changed in it',
      'Read packages/analyzer/src/server/askTools.ts with read_file and note what the goal needs changed in it',
      'Make the change the goal describes (Add a null guard to parse.ts and wire it in askTools.ts) in src/parse.ts, packages/analyzer/src/server/askTools.ts with propose_files',
      'Re-read src/parse.ts with read_file and compare what is there against what the goal asked for',
    ],
  );
  assert.deepStrictEqual(steps.map((s) => s.status), ['open', 'open', 'open', 'open']);
  assert.deepStrictEqual(steps.map((s) => s.id), ['k1', 'k2', 'k3', 'k4']);
  for (const s of steps) assert.strictEqual(whyNotAnAction(s.text), null, s.text);
  /* A goal naming nothing the repository has is not given a plan of gates. */
  assert.strictEqual(skeletonFromGoal('make the parser faster', resolve), null);
  assert.strictEqual(skeletonFromGoal('fix nowhere.ts', resolve), null);
});

/* -------------------------------- small helpers --------------------------- */

test('firstOpenStep and planCounts read the plan the run reads', () => {
  const steps = plan(['A', 'done'], ['B', 'parked', 'why'], ['C', 'open'], ['D', 'open']);
  assert.strictEqual(firstOpenStep(steps)?.text, 'C');
  assert.deepStrictEqual(planCounts(steps), { total: 4, open: 2, done: 1, parked: 1 });
});

test('whyNotAnAction refuses tool markup handed back as a step (owner walk 2026-09-18)', () => {
  const garbage = ",{'id': '1', 'title': 'Write the note', 'status': 'pending'}]</param></fun";
  const reason = whyNotAnAction(garbage);
  assert.ok(reason && /markup|JSON/.test(reason), `expected a markup refusal, got ${reason}`);
  assert.ok(reason && /plain sentence/.test(reason), 'and it says what to send instead');
  /* Every fragment on its own is enough — braces, a tag, a quoted key. */
  for (const bad of ['{"text": "do x"}', 'Write it </param>', "'title': write the note"]) {
    assert.ok(whyNotAnAction(bad), `should refuse ${bad}`);
  }
  /* A real step with punctuation still passes. */
  assert.strictEqual(whyNotAnAction('Write memory/notes.md with write_file: three things Sequence does'), null);
});
