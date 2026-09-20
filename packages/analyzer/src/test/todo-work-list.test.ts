import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  diffTodos,
  parseTodos,
  remainingTodos,
  renderTodoSection,
  todosSettled,
  type TodoItem,
} from '../server/todoList.js';
import { askToolsForJobMode, executeAskTool } from '../server/askTools.js';

/*
 * THE VISIBLE WORK LIST.
 *
 * A turn may run sixteen rounds and the reader saw `step:start provider`
 * sixteen times — the pipeline's own phases, identical whatever the job was.
 * Plan mode meanwhile produced prose nothing executed. These tests lock the
 * join, and every rule in `todoList.ts` that exists because the alternative
 * lies to the reader.
 */

const LIST: TodoItem[] = [
  { id: 's1', title: 'Read the parser', status: 'done' },
  { id: 's2', title: 'Add the guard', status: 'active' },
  { id: 's3', title: 'Lock it with a test', status: 'pending' },
];

function items(raw: unknown): TodoItem[] {
  const r = parseTodos(raw);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.items;
}

describe('a work list refuses rather than repairs', () => {
  it('accepts a well-formed list', () => {
    assert.equal(items(LIST).length, 3);
  });

  it('TWO actives is refused — two things cannot both be happening now', () => {
    const r = parseTodos([
      { id: 'a', title: 'one', status: 'active' },
      { id: 'b', title: 'two', status: 'active' },
    ]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /exactly one step may be what is happening now/);
  });

  it('a BLOCKED step with no reason is refused', () => {
    // A blocked step that does not say why is indistinguishable from a
    // forgotten one, and that is the difference between "waiting for you" and
    // "nobody is coming".
    const r = parseTodos([{ id: 'a', title: 'Deploy', status: 'blocked' }]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /must say why/);
    assert.equal(parseTodos([{ id: 'a', title: 'Deploy', status: 'blocked', note: 'no creds' }]).ok, true);
  });

  it('an EMPTY list is refused — it is not a plan', () => {
    const r = parseTodos([]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /not a plan/);
  });

  it('duplicate ids, unknown statuses and non-objects are each refused by name', () => {
    for (const [raw, needle] of [
      [[{ id: 'a', title: 'x', status: 'done' }, { id: 'a', title: 'y', status: 'done' }], /duplicate step id/],
      [[{ id: 'a', title: 'x', status: 'doing' }], /use one of: pending, active, done, blocked/],
      [['a step'], /every step must be an object/],
      [[{ id: '', title: 'x', status: 'done' }], /non-empty "id"/],
      [[{ id: 'a', title: '  ', status: 'done' }], /non-empty "title"/],
      ['not an array', /must be an array/],
    ] as [unknown, RegExp][]) {
      const r = parseTodos(raw);
      assert.equal(r.ok, false, JSON.stringify(raw));
      assert.match(r.ok ? '' : r.reason, needle);
    }
  });
});

describe('the diff is what makes a round productive', () => {
  it('a step reaching done counts as advancement', () => {
    const after = LIST.map((i) => (i.id === 's2' ? { ...i, status: 'done' as const } : i));
    const d = diffTodos(LIST, after);
    assert.equal(d.advanced, true);
    assert.deepEqual(d.completed.map((i) => i.id), ['s2']);
  });

  it('re-sending the SAME list is not advancement — rounds cannot be bought', () => {
    assert.equal(diffTodos(LIST, LIST).advanced, false);
  });

  it('a step moving BACKWARD is not advancement either', () => {
    const back = [{ id: 's1', title: 'Read the parser', status: 'pending' as const }];
    assert.equal(diffTodos(LIST, back).advanced, false);
  });

  it('blocking a step is reported, and is not advancement', () => {
    const after = LIST.map((i) =>
      i.id === 's3' ? { ...i, status: 'blocked' as const, note: 'needs a decision' } : i,
    );
    const d = diffTodos(LIST, after);
    assert.deepEqual(d.blocked.map((i) => i.id), ['s3']);
    assert.equal(d.advanced, false);
  });

  it('settled means nothing is left to run — blocked counts as settled', () => {
    assert.equal(todosSettled(LIST), false);
    assert.equal(remainingTodos(LIST).length, 2);
    const settled: TodoItem[] = [
      { id: 'a', title: 'x', status: 'done' },
      { id: 'b', title: 'y', status: 'blocked', note: 'needs a key' },
    ];
    assert.equal(todosSettled(settled), true);
    // An empty list is not "settled" — nothing was ever declared.
    assert.equal(todosSettled([]), false);
  });
});

describe('the list the model is shown next round', () => {
  it('carries every step, its mark, and what to do next', () => {
    const text = renderTodoSection(LIST).join('\n');
    assert.match(text, /--- YOUR WORK LIST \(as you last set it\) ---/);
    assert.match(text, /\[x\] s1: Read the parser/);
    assert.match(text, /\[>\] s2: Add the guard/);
    assert.match(text, /\[ \] s3: Lock it with a test/);
    assert.match(text, /2 step\(s\) left/);
    assert.match(text, /never re-send a list that has lost steps you already finished/i);
  });

  it('tells a finished list to STOP, which is the commonest failure', () => {
    const done: TodoItem[] = [{ id: 'a', title: 'x', status: 'done' }];
    const text = renderTodoSection(done).join('\n');
    assert.match(text, /Do not call `update_todos` again — write the answer/);
  });

  it('an empty list renders NOTHING — the prompt is unchanged for every other turn', () => {
    assert.deepEqual(renderTodoSection([]), []);
  });
});

describe('the tool, through the real executor', () => {
  it('reports what CHANGED, not only what was sent', async () => {
    const r = await executeAskTool(
      'update_todos',
      { items: LIST.map((i) => (i.id === 's2' ? { ...i, status: 'done' } : i)) },
      { repoRoot: null, designMode: false, todos: LIST } as never,
    );
    assert.equal(r.ok, true);
    assert.match(r.evidence!, /3 step\(s\) — 1 done, 1 left/);
    assert.equal(r.todos?.length, 3);
    assert.match(r.content!, /Next: Lock it with a test/);
  });

  it('works with NO repository attached — a work list needs no repo', async () => {
    // Every other tool is refused without one, correctly: they would fabricate
    // file evidence. A list of intentions fabricates nothing.
    const r = await executeAskTool(
      'update_todos',
      { items: [{ id: 'a', title: 'Draft the outline', status: 'active' }] },
      { repoRoot: null, designMode: true } as never,
    );
    assert.equal(r.ok, true, r.evidence);
  });

  it('a refusal names the rule so the next round can fix it', async () => {
    const r = await executeAskTool(
      'update_todos',
      { items: [{ id: 'a', title: 'x', status: 'blocked' }] },
      { repoRoot: null, designMode: false } as never,
    );
    assert.equal(r.ok, false);
    assert.match(r.evidence, /^refused: update_todos — /);
  });

  it('a settled list is told to write the answer, not to keep listing', async () => {
    const r = await executeAskTool(
      'update_todos',
      { items: [{ id: 'a', title: 'x', status: 'done' }] },
      { repoRoot: null, designMode: false } as never,
    );
    assert.match(r.content!, /The list is settled\. Write the answer now/);
  });
});

describe('who is offered the list', () => {
  it('a TEACH turn is not — one concept per turn is the contract', () => {
    const belt = askToolsForJobMode('code', 'build', { teach: true });
    assert.ok(!belt.includes('update_todos'));
  });

  it('an ordinary turn is', () => {
    assert.ok(askToolsForJobMode('code', 'build').includes('update_todos'));
    assert.ok(askToolsForJobMode('code', 'plan').includes('update_todos'));
  });
});
