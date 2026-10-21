import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SpecStream, applyOp, autoFix, buildAction, catalogPrompt, COMPONENT_TYPES, emptySpec, getAt, normaliseOp, parsePartialJson,
  repairJson, repairSpec, setAt, specFromPartialJson, validateSpec, type UISpec,
} from '../index.js';

const LINES = [
  '{"op":"el","id":"card","type":"Card","props":{"title":"Upgrade auth"},"children":["tl"]}',
  '{"op":"el","id":"tl","type":"Timeline","children":["s1","s2"]}',
  '{"op":"el","id":"s1","type":"TimelineItem","props":{"title":"Plan","status":"done"}}',
  '{"op":"el","id":"s2","type":"TimelineItem","props":{"title":"Run tests","status":"running"},"children":["p"]}',
  '{"op":"set","path":"/tests","value":{"passed":0,"total":42}}',
  '{"op":"el","id":"p","type":"Progress","props":{"label":"Tests","value":{"$state":"/tests/passed"},"max":{"$state":"/tests/total"}}}',
  '{"op":"set","path":"/tests/passed","value":36}',
];
const TEXT = '```genui\n' + LINES.join('\n') + '\n```\n';

const build = (text: string, size: number): UISpec => {
  const s = new SpecStream();
  for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
  s.end();
  return s.spec;
};

test('pointer writes copy only the path (untouched elements keep identity)', () => {
  const a = { elements: { x: { type: 'Text', props: { text: 'a' } }, y: { type: 'Text', props: { text: 'b' } } } };
  const b = setAt(a, '/elements/x/props/text', 'c');
  assert.equal(getAt(b, '/elements/x/props/text'), 'c');
  assert.equal(getAt(a, '/elements/x/props/text'), 'a');
  assert.equal(b.elements.y, a.elements.y);
  assert.deepEqual(setAt({}, '/a/0/b', 1), { a: [{ b: 1 }] });
});

test('partial JSON closes an unfinished value at the longest valid prefix', () => {
  assert.deepEqual(parsePartialJson('{"a":"hel')?.value, { a: 'hel' });
  assert.deepEqual(parsePartialJson('{"a":[1,2,')?.value, { a: [1, 2] });
  assert.deepEqual(parsePartialJson('{"a":1,"b"')?.value, { a: 1 });
  assert.deepEqual(parsePartialJson('{"a":1,"b":')?.value, { a: 1 });
  assert.deepEqual(parsePartialJson('{"a":tru')?.value, {});
  assert.deepEqual(parsePartialJson('{"c":["s1","s2"')?.value, { c: ['s1', 's2'] });
  assert.deepEqual(parsePartialJson('{"c":["s1","s')?.value, { c: ['s1', 's'] });
  assert.deepEqual(parsePartialJson('{"props":{"ti')?.value, { props: {} });
  assert.deepEqual(parsePartialJson('{"a":"x\\')?.value, { a: 'x' });
  assert.equal(parsePartialJson('{"a":1}')?.complete, true);
  assert.equal(parsePartialJson(''), undefined);
});

test('repairJson fixes the usual model mistakes and says which', () => {
  assert.deepEqual(repairJson('{"a":1,}')?.value, { a: 1 });
  assert.deepEqual(repairJson("{'a':'b'}")?.value, { a: 'b' });
  assert.deepEqual(repairJson('{op:"el",id:"x"}')?.value, { op: 'el', id: 'x' });
  assert.deepEqual(repairJson('{"a":True,"b":None}')?.value, { a: true, b: null });
  assert.deepEqual(repairJson('{"t":"Lena\'s key, rotated: yes",}')?.value, { t: "Lena's key, rotated: yes" });
  assert.ok(repairJson('{"a":1,}')!.fixes.includes('removed a trailing comma'));
  assert.equal(repairJson('not json'), undefined);
});

test('the stream builds the same spec whatever the chunking', () => {
  const whole = build(TEXT, TEXT.length);
  for (const size of [1, 3, 7, 64]) assert.deepEqual(build(TEXT, size), whole);
  assert.equal(whole.root, 'card');
  assert.equal(getAt(whole.state, '/tests/passed'), 36);
  assert.ok(validateSpec(whole, 'final').ok);
});

test('preview shows the in-flight line without committing it', () => {
  const s = new SpecStream();
  s.push(LINES[0] + '\n{"op":"el","id":"t","type":"Text","props":{"text":"Half way thro');
  assert.equal(s.preview().elements.t?.props.text, 'Half way thro');
  assert.equal('t' in s.spec.elements, false);
  s.push('ugh"}}\n');
  assert.equal((s.spec.elements as UISpec['elements']).t?.props.text, 'Half way through');
  /* a half-written set never previews (36 would flash as 3) */
  s.push('{"op":"set","path":"/n","value":3');
  assert.equal(s.preview().state.n, undefined);
  s.push('6}\n');
  assert.equal(s.spec.state.n, 36);
  /* a half-written remove never runs */
  s.push('{"op":"remove","path":"/elements/ca');
  assert.ok(s.preview().elements.card);
});

test('a bad line is reported and the stream goes on', () => {
  const s = new SpecStream();
  const r = s.push('nonsense here\n' + LINES[0] + '\n{"op":"warp"}\n');
  assert.equal(r.issues.length, 2);
  assert.equal(r.issues[0]!.code, 'PARSE_ERROR');
  assert.equal(r.issues[1]!.code, 'BAD_OP');
  assert.ok(s.spec.elements.card);
});

test('normalise reads a bare element and props beside type', () => {
  const n = normaliseOp({ id: 'x', type: 'Text', text: 'hi' });
  assert.ok('op' in n);
  if ('op' in n) {
    assert.deepEqual(n.op, { op: 'el', id: 'x', type: 'Text', props: { text: 'hi' } });
    assert.equal(n.fixes.length, 2);
  }
  const set = normaliseOp({ op: 'set', path: 'state.tests.passed', value: 1 });
  assert.ok('op' in set && set.op.op === 'set' && set.op.path === '/tests/passed');
});

test('el merges props, re-parents, and remove unhooks children', () => {
  let s = build(TEXT, 50);
  s = applyOp(s, { op: 'el', id: 's2', type: 'TimelineItem', props: { status: 'done' } });
  assert.equal(s.elements.s2!.props.title, 'Run tests');
  assert.deepEqual(s.elements.s2!.children, ['p']);
  s = applyOp(s, { op: 'el', id: 'b', type: 'Badge', props: { label: 'Open', tone: 'success' }, parent: 'card' });
  assert.deepEqual(s.elements.card!.children, ['tl', 'b']);
  s = applyOp(s, { op: 'remove', path: '/elements/b' });
  assert.deepEqual(s.elements.card!.children, ['tl']);
});

test('validator: streaming is lenient about what has not arrived, final is not', () => {
  const s = new SpecStream();
  s.push(LINES[0] + '\n');
  const live = validateSpec(s.spec, 'streaming');
  assert.ok(live.ok);
  assert.equal(live.issues[0]!.code, 'MISSING_CHILD');
  assert.equal(live.issues[0]!.severity, 'warning');
  assert.equal(validateSpec(s.spec, 'final').ok, false);
});

test('validator codes carry paths and hints', () => {
  const spec: UISpec = {
    ...emptySpec(),
    root: 'c',
    elements: {
      c: { type: 'Card', props: { title: 'x' }, children: ['h', 'z', 'b'] },
      h: { type: 'Heading', props: { text: 'x' }, children: ['c'] },
      z: { type: 'Zorp', props: {} },
      b: { type: 'Button', props: { label: 'Go', action: { name: 'go' } } },
      tl: { type: 'Timeline', props: {}, children: ['h'] },
    },
  };
  const codes = validateSpec(spec).issues.map((i) => i.code).sort();
  assert.deepEqual(codes, ['CYCLE', 'ORPHAN', 'UNALLOWED_CHILD', 'UNALLOWED_CHILD', 'UNDECLARED_ACTION', 'UNKNOWN_COMPONENT']);
  const bad = validateSpec({ ...spec, elements: { c: { type: 'Progress', props: { value: 'x', max: 3 } } }, root: 'c' }).issues[0]!;
  assert.equal(bad.path, '/elements/c/props/value');
  assert.match(bad.hint ?? '', /number/);
});

test('autoFix lossless: aliases, synonyms, coercions, stray props, root; idempotent', () => {
  const spec: UISpec = {
    ...emptySpec(),
    elements: {
      c: { type: 'card', props: { heading: 'Ship' }, children: ['r', 'r'] },
      r: { type: 'Row', props: {}, children: ['p', 'k'] },
      p: { type: 'progress_bar', props: { current: '7', total: '10' } },
      k: { type: 'Check', props: { name: 'Lint', state: 'passed' } },
    },
  };
  const { spec: fixed, fixes } = autoFix(spec, { phase: 'final' });
  assert.ok(validateSpec(fixed).ok, JSON.stringify(validateSpec(fixed).issues));
  assert.ok(fixes.every((f) => !f.lossy));
  assert.equal(fixed.elements.r!.props.direction, 'row');
  assert.equal(fixed.elements.p!.props.value, 7);
  assert.equal(fixed.elements.k!.props.status, 'pass');
  assert.equal(fixed.root, 'c');
  assert.equal(autoFix(fixed, { phase: 'final' }).fixes.length, 0);
});

test('lossy fallback: unknown -> text, dangling pruned, unallowed moved, all reported as lossy', () => {
  const spec: UISpec = {
    ...emptySpec(),
    root: 'c',
    elements: {
      c: { type: 'Card', props: { title: 'x' }, children: ['tl', 'gone'] },
      tl: { type: 'Timeline', props: {}, children: ['t'] },
      t: { type: 'Sparkline', props: { label: 'Latency' } },
    },
  };
  const { spec: fixed, fixes } = autoFix(spec, { phase: 'final', lossy: true });
  assert.ok(validateSpec(fixed).ok, JSON.stringify(validateSpec(fixed).issues));
  assert.equal(fixed.elements.t!.type, 'Text');
  assert.deepEqual(fixed.elements.c!.children, ['tl', 't']);
  assert.ok(fixes.length >= 3 && fixes.every((f) => f.lossy));
});

test('repair loop: lossless first, then the agent (text reply), no fallback needed', async () => {
  const spec = build(TEXT + '{"op":"el","id":"b","type":"Button","props":{"label":"Fix","action":"Fix Failures"},"parent":"card"}\n', 9);
  const events: string[] = [];
  const out = await repairSpec(spec, {
    surfaceId: 's',
    agent: async (d) => {
      assert.match(d.prompt, /UNDECLARED_ACTION/);
      return '{"op":"add","path":"/actions/fix_failures","value":{"description":"Fix the failing tests"}}';
    },
    onEvent: (e) => events.push(e.type),
  });
  assert.deepEqual(events, ['fixed', 'ask', 'agent-patched', 'clean']);
  assert.equal(out.rounds, 1);
  assert.equal(out.usedFallback, false);
  assert.ok(out.fixes.some((f) => f.by === 'agent'));
  assert.ok(validateSpec(out.spec).ok);
});

test('repair loop: a silent agent ends in the lossy fallback, and the result still validates', async () => {
  const spec = build(TEXT + '{"op":"el","id":"z","type":"Sparkline","props":{"title":"Latency"},"parent":"card"}\n', 5);
  const events: string[] = [];
  const out = await repairSpec(spec, { surfaceId: 's', agent: async () => null, onEvent: (e) => events.push(e.type) });
  assert.deepEqual(events, ['ask', 'agent-silent', 'fallback', 'clean']);
  assert.ok(out.usedFallback);
  assert.ok(validateSpec(out.spec).ok);
});

test('repair loop: an agent that keeps failing is bounded by maxRounds', async () => {
  const spec = build(TEXT + '{"op":"el","id":"z","type":"Sparkline","props":{},"parent":"card"}\n', 5);
  let calls = 0;
  const out = await repairSpec(spec, { surfaceId: 's', maxRounds: 2, agent: async () => (calls++, '{"op":"el","id":"z","type":"Sparkline2","props":{}}') });
  assert.equal(calls, 2);
  assert.ok(out.usedFallback);
  assert.equal(out.spec.elements.z, undefined);
});

test('actions: only declared, not while busy unless whileBusy, params bind to state', () => {
  let spec = build(TEXT, 100);
  spec = applyOp(spec, { op: 'el', id: 'b', type: 'Button', props: { label: 'Go', action: { name: 'go', params: { n: { $state: '/tests/passed' } } } }, parent: 'card' });
  assert.equal(buildAction(spec, 's', 'b', false).ok, false);
  spec = applyOp(spec, { op: 'add', path: '/actions/go', value: { description: 'go' } });
  const ok = buildAction(spec, 's', 'b', false, 1);
  assert.ok(ok.ok && ok.action.params.n === 36);
  assert.equal(buildAction(spec, 's', 'b', true).ok, false);
  spec = applyOp(spec, { op: 'merge', path: '/actions/go', value: { whileBusy: true } });
  assert.equal(buildAction(spec, 's', 'b', true).ok, true);
});

test('whole-spec mode renders from a partial JSON object', () => {
  const s = specFromPartialJson('{"root":"c","elements":{"c":{"type":"Card","props":{"title":"Hel');
  assert.equal(s?.elements.c?.props.title, 'Hel');
});

test('the prompt names every component and op', () => {
  const p = catalogPrompt();
  for (const t of COMPONENT_TYPES) assert.ok(p.includes(`- ${t} {`), t);
  for (const op of ['"op":"el"', '"op":"set"', '"op":"status"', 'ui.diagnostics']) assert.ok(p.includes(op), op);
});
