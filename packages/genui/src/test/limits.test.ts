import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GENUI_LIMITS, SpecStream, type UIOp } from '../index.js';

/* A card is a status, not a page: past 200 elements the extra ops are dropped and the agent is told, once. */

const el = (i: number, parent = 'root'): string => JSON.stringify({ op: 'el', id: `n${i}`, type: 'Text', props: { text: `line ${i}` }, parent });
const ROOT = JSON.stringify({ op: 'el', id: 'root', type: 'Stack', props: {}, children: [] });

function run(lines: string[], chunk: number): { stream: SpecStream; issues: string[]; applied: number } {
  const stream = new SpecStream();
  const text = lines.join('\n') + '\n';
  const issues: string[] = [];
  let applied = 0;
  for (let i = 0; i < text.length; i += chunk) {
    const r = stream.push(text.slice(i, i + chunk));
    applied += r.applied.length;
    issues.push(...r.issues.map((x) => `${x.code}|${x.severity}|${x.path}|${x.message}`));
  }
  const e = stream.end();
  applied += e.applied.length;
  issues.push(...e.issues.map((x) => `${x.code}|${x.severity}|${x.path}|${x.message}`));
  return { stream, issues, applied };
}

test('the limits are the ones the handoff names', () => {
  assert.equal(GENUI_LIMITS.surfacesPerTurn, 8);
  assert.equal(GENUI_LIMITS.elementsPerSurface, 200);
});

test('ops that would make a 201st element are dropped, the spec stays at 200, and one diagnostic names the drop', () => {
  const lines = [ROOT, ...Array.from({ length: 249 }, (_, i) => el(i))];
  const { stream, issues } = run(lines, 1_000_000);
  assert.equal(Object.keys(stream.spec.elements).length, GENUI_LIMITS.elementsPerSurface);
  assert.ok(stream.spec.elements.n198, 'the 199th child (the 200th element) was kept');
  assert.equal(stream.spec.elements.n199, undefined, 'the 201st was dropped');
  assert.equal(stream.spec.elements.n248, undefined);
  const limit = issues.filter((i) => i.startsWith('LIMIT_EXCEEDED'));
  assert.equal(limit.length, 1, 'one diagnostic per push, not one per dropped op');
  assert.match(limit[0]!, /\|error\|/);
  assert.match(limit[0]!, /at most 200 elements/);
  assert.match(limit[0]!, /50 ops dropped/);
  /* Streamed in small chunks the diagnostics are one per chunk that dropped something, and they add up to the same 50. */
  const small = run(lines, 4096).issues.filter((i) => i.startsWith('LIMIT_EXCEEDED'));
  assert.ok(small.length >= 1 && small.length <= 5);
  assert.equal(small.reduce((n, i) => n + Number(/(\d+) ops dropped/.exec(i)![1]), 0), 50);
});

test('at the cap, an update to an element that exists still lands (props merge is not a new element)', () => {
  const lines = [ROOT, ...Array.from({ length: 199 }, (_, i) => el(i)), JSON.stringify({ op: 'el', id: 'n5', type: 'Text', props: { text: 'changed' } }), el(999)];
  const { stream } = run(lines, 4096);
  assert.equal(stream.spec.elements.n5!.props.text, 'changed');
  assert.equal(stream.spec.elements.n999, undefined);
});

test('removing an element frees room', () => {
  const lines = [ROOT, ...Array.from({ length: 199 }, (_, i) => el(i)), JSON.stringify({ op: 'remove', path: '/elements/n0' }), el(500)];
  const { stream } = run(lines, 4096);
  assert.ok(stream.spec.elements.n500);
  assert.equal(stream.spec.elements.n0, undefined);
});

test('a whole-map replace cannot go round the cap, and neither can a pointer add', () => {
  const big: Record<string, unknown> = {};
  for (let i = 0; i < 250; i++) big[`m${i}`] = { type: 'Text', props: { text: 'x' } };
  const stream = new SpecStream();
  const r = stream.push(JSON.stringify({ op: 'replace', path: '/elements', value: big }) + '\n');
  assert.equal(Object.keys(stream.spec.elements).length, 0);
  assert.equal(r.issues[0]?.code, 'LIMIT_EXCEEDED');
  const ok = stream.push(JSON.stringify({ op: 'add', path: '/elements/a', value: { type: 'Text', props: { text: 'a' } } }) + '\n');
  assert.equal(ok.issues.length, 0);
  assert.ok(stream.spec.elements.a);
});

test('the same ops give the same spec at every chunk size', () => {
  const lines = [ROOT, ...Array.from({ length: 230 }, (_, i) => el(i))];
  const ref = JSON.stringify(run(lines, 100000).stream.spec);
  for (const size of [1, 7, 64, 513]) assert.equal(JSON.stringify(run(lines, size).stream.spec), ref, `chunk ${size}`);
});

test('applyOps (a tool call, a repair reply) is capped too and reports what it dropped', () => {
  const stream = new SpecStream();
  const ops: UIOp[] = [{ op: 'el', id: 'root', type: 'Stack', props: {} }];
  for (let i = 0; i < 230; i++) ops.push({ op: 'el', id: `n${i}`, type: 'Text', props: { text: 'x' }, parent: 'root' });
  const issues = stream.applyOps(ops);
  assert.equal(Object.keys(stream.spec.elements).length, 200);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.code, 'LIMIT_EXCEEDED');
});
