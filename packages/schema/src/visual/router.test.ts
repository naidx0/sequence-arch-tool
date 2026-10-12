import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { VISUAL_HINT_PREFIX, routeVisualIntent, scoreClause, splitAsks, stripPasted } from './index.js';
import { BLIND_2, BLIND_3, BLIND_4, BLIND_4_SHA256, BLIND_5, BLIND_5_SHA256, BLIND_SET, DEV_5, DEV_SET, HELD_OUT, REVIEW_ADV, REVIEW_PASTE, type Labelled } from './routerSets.js';

function score(set: Labelled[]): { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; wrong: string[] } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const wrong: string[] = [];
  for (const r of set) {
    const fired = routeVisualIntent(r.text) !== null;
    if (fired && r.visual) tp += 1;
    else if (fired && !r.visual) (fp += 1, wrong.push(`FALSE HINT: ${r.text}`));
    else if (!fired && r.visual) (fn += 1, wrong.push(`MISSED: ${r.text}`));
    else tn += 1;
  }
  return { tp, fp, fn, tn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), wrong };
}

test('router on the dev set: precision and recall (printed), false hints rare', () => {
  assert.equal(DEV_SET.length, 60);
  assert.equal(DEV_SET.filter((r) => r.visual).length, 30);
  const s = score(DEV_SET);
  console.log(`dev set: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn})${s.wrong.length ? `\n  ${s.wrong.join('\n  ')}` : ''}`);
  assert.ok(s.precision >= 0.95, `precision ${s.precision}`);
  assert.ok(s.recall >= 0.9, `recall ${s.recall}`);
  assert.ok(s.fp <= 1, `false hints ${s.fp}`);
});

test('router on the held-out set (written after the rules were frozen)', () => {
  const s = score(HELD_OUT);
  console.log(`held-out: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn})${s.wrong.length ? `\n  ${s.wrong.join('\n  ')}` : ''}`);
  assert.ok(s.precision >= 0.85, `held-out precision ${s.precision}`);
  assert.ok(s.recall >= 0.7, `held-out recall ${s.recall}`);
});

test('the hint is one line naming real components, and the AI gateway request gets capacity', () => {
  const r = routeVisualIntent(DEV_SET[0]!.text)!;
  assert.ok(r.hint.startsWith(VISUAL_HINT_PREFIX));
  assert.ok(!r.hint.includes('\n'));
  assert.equal(r.components[0], 'capacity');
  assert.ok(r.components.length <= 3);
  const f = routeVisualIntent('forecast our API traffic for the next quarter')!;
  assert.deepEqual(f.components, ['line']);
  assert.match(f.hint, /line \(with forecast\)/);
});

test('silence is the default: empty, code, long text', () => {
  assert.equal(routeVisualIntent(''), null);
  assert.equal(routeVisualIntent('fix the typo in README'), null);
  assert.equal(routeVisualIntent('x'.repeat(50_000)), null);
  assert.ok(routeVisualIntent(`${'blah '.repeat(2000)} chart this`), 'an ask at the end of a long message is heard');
});

test('router on blind set 1 (first run 0.556 / 0.333 before the second tuning round; now a dev set)', () => {
  const s = score(BLIND_SET);
  console.log(`blind: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn})${s.wrong.length ? `\n  ${s.wrong.join('\n  ')}` : ''}`);
  assert.ok(s.precision >= 0.7 && s.recall >= 0.5, `blind precision ${s.precision} recall ${s.recall}`);
});

test('router on blind set 2 (written after the second tuning, run once): the honest number', () => {
  const s = score(BLIND_2);
  console.log(`blind 2: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn})${s.wrong.length ? `\n  ${s.wrong.join('\n  ')}` : ''}`);
  assert.ok(s.fp <= 2, `false hints ${s.fp}`);
});

test('blind set 3 (24 coding + 24 visual messages, written before the stricter-intent change, one look)', () => {
  const s = score(BLIND_3);
  console.log(`blind 3: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn})${s.wrong.length ? `\n  ${s.wrong.join('\n  ')}` : ''}`);
  assert.equal(BLIND_3.length, 48);
  assert.ok(s.precision >= 0.9, `blind 3 precision ${s.precision}`);
});

test('the ordinary coding messages the review found hinted do not get a hint (and a real ask still does)', () => {
  for (const t of [
    'the dashboard page is slow, can you look at why',
    'show me the files that handle auth flow',
    'show me what the pipeline yaml looks like',
    'display usage per day in the admin page',
    'chart.js vs recharts, which should we use',
    'the load test results show p99 at 2s, what should we do',
    'show me where the latency comes from in this handler',
  ]) assert.equal(routeVisualIntent(t), null, t);
  assert.ok(routeVisualIntent('show me a dashboard of signups and churn'));
  assert.ok(routeVisualIntent('chart p99 latency per day for the last month'));
});

test('dev set 5 (fresh phrasing, router lane): at most 1 false hint in 24 coding messages, recall stays high', () => {
  const s = score(DEV_5);
  console.log(`dev 5: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn})${s.wrong.length ? `\n  ${s.wrong.join('\n  ')}` : ''}`);
  assert.ok(s.fp <= 1, `false hints ${s.fp}`);
  assert.ok(s.recall >= 0.9, `recall ${s.recall}`);
});

test('all labelled sets together: false hints on coding messages at most 1 in 24', () => {
  const all = [...DEV_SET, ...HELD_OUT, ...BLIND_SET, ...BLIND_2, ...BLIND_3, ...DEV_5];
  const s = score(all);
  const coding = s.fp + s.tn;
  console.log(`all ${all.length}: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn}); false-hint rate ${(s.fp / coding).toFixed(3)}`);
  assert.ok(s.fp / coding <= 1 / 24);
  assert.ok(s.recall >= 0.9);
});

test('multi-ask messages: only the visual ask chooses the components, a coding ask next to it does not hint', () => {
  const a = routeVisualIntent('first fix the typo in the readme heading, and second plot the weekly deploy count from this list: 5, 7, 4, 9, 12');
  assert.ok(a, 'the plot ask is heard');
  const b = routeVisualIntent('fix the flow control bug in the parser, and then chart p99 latency per day for the last month');
  assert.ok(b);
  assert.ok(!b.components.includes('flow'), `flow belongs to the bug, got ${b.components}`);
  assert.equal(routeVisualIntent('chart.js is throwing in Panel.tsx; fix the dashboard bug and then explain the flow'), null);
  assert.deepEqual(splitAsks('summarize the doc, chart the error rate, and list the follow ups'), ['summarize the doc', 'chart the error rate', 'and list the follow ups'].map((t, i) => (i === 2 ? 'list the follow ups' : t)));
  assert.ok(routeVisualIntent('where will the bottleneck be when we hit 5k users? show it'), '"show it" belongs to the question before it');
});

test('intent structure: a drawing word used as a noun or in code is not a request', () => {
  for (const t of [
    'the plot function in utils throws when x is empty',
    'rename the Chart class to Plot in src/charts/Plot.ts',
    'TypeError: Cannot read properties of undefined (reading series) at renderChart (Chart.tsx:88)',
    'the dashboard is slow',
    'why is the graph blank',
    'forecast.py divides by zero when the window is 0',
  ]) assert.equal(routeVisualIntent(t), null, t);
  assert.ok(scoreClause('plot p95 latency per day').score >= 3);
  assert.ok(scoreClause('fix the plot function').score < 3);
  assert.ok(routeVisualIntent('um can you like draw me a picture of how the app talks to the backend, boxes and arrows is fine'), 'voice style');
});

test('blind set 4 (30 coding + 30 visual, sealed before the router was rewritten, looked at once): the honest number', () => {
  const bytes = `${BLIND_4.map((r) => `${r.visual ? 'Y' : 'N'}\t${r.text}`).join('\n')}\n`;
  assert.equal(createHash('sha256').update(bytes).digest('hex'), BLIND_4_SHA256, 'the set is the one that was sealed');
  const s = score(BLIND_4);
  console.log(`blind 4: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn})${s.wrong.length ? `\n  ${s.wrong.join('\n  ')}` : ''}`);
  assert.equal(BLIND_4.length, 60);
  assert.ok(s.fp <= 1, `false hints ${s.fp}`);
  assert.ok(s.recall >= 0.9, `recall ${s.recall}`);
});

test('M1: pasted code, diffs, traces, logs and commit lists are never requests (the reviewer\'s 8 probes)', () => {
  for (const r of REVIEW_PASTE) assert.equal(routeVisualIntent(r.text), null, r.text);
  for (const t of [
    '```js\ndraw(ctx, points)\n```',
    '```diff\n+  plot(series, opts)\n-  plot(series)\n```',
    'chart: add tooltip offset\ndraw: fix retina scaling',
    '- chart: fix legend\n- plot: dark mode colors',
    '2026-10-08T10:02:11Z ERROR chart render timeout',
    'abc1234 plot: add log scale',
    '    at drawChart (chart.js:10:5)',
    '> plot the weekly signups\n> as a bar chart',
    'chart = new Chart(ctx, cfg)',
    '  plot(data)',
  ]) assert.equal(routeVisualIntent(t), null, t);
  /* an unterminated fence swallows the rest, a closed one does not */
  assert.equal(routeVisualIntent('```js\nplot(a)\nplot the weekly signups as a bar chart'), null);
  assert.ok(routeVisualIntent('```js\nplot(a)\n```\nplot the weekly signups as a bar chart'), 'the ask after a closed fence is heard');
  assert.ok(routeVisualIntent('chart: p99 latency per day for the last month'), 'one terse "chart:" line is still an ask');
  assert.ok(!stripPasted('look:\n```\nplot(a)\n```\nthanks').includes('plot'));
  for (const t of ['draw(ctx, pts) breaks', 'chart.render() breaks', 'plot[0] is undefined', 'plot = None', 'I changed: graph layout spacing, chart padding']) assert.equal(routeVisualIntent(t), null, t);
});

test('S1: an ask after a long paste is heard, and reading stays fast', () => {
  const log = Array.from({ length: 150 }, (_, i) => `2026-10-08T10:${String(i % 60).padStart(2, '0')}:00Z INFO GET /api/items 200 ${40 + (i % 9)}ms`).join('\n');
  const msg = `${log}\nplot the request times per minute from this log`;
  assert.ok(msg.length > 6000);
  assert.ok(routeVisualIntent(msg), 'ask after the paste');
  /* the same paste as unfenced prose-like words (no markers to strip): head and tail are read */
  const prose = `${'the quick brown fox jumps over the lazy dog '.repeat(300)}. plot the weekly signups as a bar chart`;
  assert.ok(routeVisualIntent(prose), 'ask at the tail of long prose');
  for (const bad of ['draw '.repeat(40_000), '1,'.repeat(100_000), 'a/'.repeat(100_000), `${'x'.repeat(300_000)} chart this`, 'plot and '.repeat(20_000)]) routeVisualIntent(bad);
});

/* The router runs on every message before it is sent: 200 KB of paste plus voice text must stay in the
   low milliseconds (measured worst ~10 ms, typical 1-2 ms). The bound is 10x that for slow CI machines. */
const fill = (n: number, part: (i: number) => string): string => {
  let s = '';
  for (let i = 0; s.length < n; i += 1) s += part(i);
  return s.slice(0, n);
};
const rows = (line: string): string => fill(200_000, () => `${line}\n`);
const PASTE = [
  '```js\nconst x = draw(ctx, points)\nchart.render()\n```\n', '2026-10-08T10:00:00Z INFO GET /api/x 200 12ms\n', '    at Object.<anonymous> (/srv/app/src/chart.ts:12:5)\n',
  '- chart: fix legend\n- plot: dark mode\n', '+  plot(series, opts)\n-  plot(series)\n', 'a1b2c3d4 fix graph spacing\n', '> quoted reply about the chart\n', 'region,day,p99\nus,1,120\n', '$ pnpm test\n',
  'um yeah so like i want to see how the services talk to each other and then chart signups per week and fix the login bug\n',
  'so the thing is the dashboard is slow and i think we should plot the p99 latency by day for the last month\n',
];
const worstMs = (msg: string): number => {
  let worst = 0;
  for (let r = 0; r < 3; r += 1) {
    const t0 = performance.now();
    routeVisualIntent(msg);
    worst = Math.max(worst, performance.now() - t0);
  }
  return worst;
};

test('perf: 200 KB of mixed paste and voice text, and pathological line shapes, route in milliseconds', () => {
  const cases: Record<string, string> = {
    'mixed paste + voice': fill(200_000, (i) => PASTE[i % PASTE.length]!),
    'mixed, CRLF': fill(200_000, (i) => PASTE[i % PASTE.length]!.replace(/\n/g, '\r\n')),
    'voice only': fill(200_000, (i) => PASTE[9 + (i % 2)]!.replace('\n', ' ')),
    'tab runs (data-row backtracking)': rows(`a${'\t'.repeat(1998)}!`),
    'stack frame with many "("': rows(`at ${'( '.repeat(995)}`),
    'blank lines': `${'\n'.repeat(200_000)}chart this`,
    'space-newline pairs': `${' \n'.repeat(100_000)}x`,
    'long whitespace lines': rows(`$ ${'\t'.repeat(1996)}`),
    'one whitespace run': `${' \t'.repeat(100_000)}!`,
    'digit-run words': rows(`plot ${'1'.repeat(1990)}a`),
    'dash words': rows(`chart ${'a-'.repeat(997)}`),
  };
  for (const v of Object.values(cases)) routeVisualIntent(v); // warm up (regex compile, JIT)
  for (const [name, msg] of Object.entries(cases)) {
    const ms = worstMs(msg);
    assert.ok(ms < 100, `${name}: ${ms.toFixed(1)} ms (budget ~10 ms, CI bound 100 ms)`);
  }
});

test('ReDoS: exported helpers stay linear on adversarial input (no window or cap to hide behind)', () => {
  /* each of these was quadratic or worse before (seconds at this size): SPLIT's \s+ alternatives, PATH and
     MANY_NUMBERS from every character of a long run, the stack-frame and data-row patterns */
  const t0 = performance.now();
  splitAsks(`${' '.repeat(100_000)}x`);
  splitAsks(`${'\n \t'.repeat(50_000)}x`);
  scoreClause(`plot ${'a'.repeat(100_000)}`);
  scoreClause(`plot ${'a-'.repeat(50_000)}`);
  scoreClause(`plot ${'1'.repeat(100_000)}a`);
  scoreClause(`plot ${'draw '.repeat(20_000)}`);
  stripPasted(rows(`a${'\t'.repeat(1998)}!`));
  stripPasted(rows(`at ${'( '.repeat(995)}`));
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `adversarial inputs took ${ms.toFixed(0)} ms`);
});

test('a long paste is read from both ends; a fence opened before the end window stays open', () => {
  const code = Array.from({ length: 3000 }, (_, i) => `  draw(ctx, points[${i}]); chart.update();`).join('\n');
  assert.ok(routeVisualIntent(`\`\`\`ts\n${code}\n\`\`\`\nplot the memory use per minute from this run`), 'ask after a 120 KB fenced paste');
  assert.equal(routeVisualIntent(`\`\`\`\n${Array.from({ length: 6000 }, () => 'plot it by day').join('\n')}`), null, 'unclosed fence: the tail is still inside it');
  assert.ok(routeVisualIntent(`${'filler words here and there '.repeat(2000)}\nchart signups per week`), 'ask at the end of 56 KB of prose');
});

test('column-aligned tool output (kubectl, docker ps) is paste, not an ask', () => {
  const kubectl = 'NAME              READY   STATUS\nchart-api-7d9     1/1     Running\nplot-worker-2x    0/1     CrashLoopBackOff\nwhy is the plot worker crashing';
  assert.equal(routeVisualIntent(kubectl), null);
  assert.ok(!stripPasted(kubectl).includes('plot-worker'));
  assert.ok(routeVisualIntent('plot the latency.  Also chart errors per day.  Thanks'), 'double spaces after a sentence are typing, not columns');
});

test('S2: a bare "and" between two asks splits them (voice style)', () => {
  assert.ok(routeVisualIntent('fix the null check in the login handler and chart signups by week'));
  assert.ok(routeVisualIntent('draw me how the auth service talks to the gateway and fix the typo in the readme'));
  assert.deepEqual(splitAsks('fix the typo and plot weekly deploys'), ['fix the typo', 'plot weekly deploys']);
  assert.deepEqual(splitAsks('chart read and write latency'), ['chart read and write latency'], 'not before every verb-looking word');
  assert.equal(routeVisualIntent('fix the flow control bug in the parser and explain the flow'), null);
  const r = routeVisualIntent('fix the flow control bug in the parser and chart p99 latency per day for the last month')!;
  assert.ok(r && !r.components.includes('flow'));
});

test('S3 idioms: "draw on", "plot twist" and "flowchart-style docstring" are not requests', () => {
  for (const t of [
    'Draw on your experience with Postgres and tell me if this index is a good idea',
    'plot twist: the tests pass locally but fail in CI',
    'draw a conclusion from these benchmark numbers in words',
    'Implement a function graph(edges) that returns an adjacency list, and add a flowchart-style docstring explaining the algorithm',
  ]) assert.equal(routeVisualIntent(t), null, t);
  assert.ok(routeVisualIntent('draw the checkout flow'));
});

test('S4: "draw it out" for a system picks flow, not line; data asks still pick line', () => {
  assert.equal(routeVisualIntent('we have five microservices and nobody understands how they connect, can you draw it out for the new hires')!.components[0], 'flow');
  assert.equal(routeVisualIntent('we have a queue, three workers and a db, draw it out')!.components[0], 'flow');
  assert.equal(routeVisualIntent('sketch how the pieces fit')!.components[0], 'flow');
  assert.equal(routeVisualIntent('plot signups by week')!.components[0], 'line');
});

test('reviewer\'s 20 adversarial messages (dev set 6) incl. pie and side-by-side', () => {
  const s = score(REVIEW_ADV);
  console.log(`review 20: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn})${s.wrong.length ? `\n  ${s.wrong.join('\n  ')}` : ''}`);
  assert.equal(s.fp + s.fn, 0, s.wrong.join(' | '));
  assert.ok(routeVisualIntent('give me a breakdown of costs by team as a pie'));
  assert.ok(routeVisualIntent('compare latency across the three regions over the last week side by side'));
  assert.equal(routeVisualIntent('show the diff side by side'), null);
  assert.ok(routeVisualIntent('Muéstrame un gráfico de las ventas por mes'));
  assert.equal(routeVisualIntent('Zeichne ein Diagramm der Anmeldungen pro Woche'), null, 'German is not covered (documented)');
});

test('the hint comes back separate from the text: the router never touches or builds the message', () => {
  const message = 'chart p99 latency per day for the last month';
  const r = routeVisualIntent(message)!;
  assert.ok(r.hint.startsWith(VISUAL_HINT_PREFIX));
  assert.ok(!message.includes(r.hint) && !message.includes(VISUAL_HINT_PREFIX));
  assert.deepEqual(Object.keys(r).sort(), ['components', 'hint']);
  assert.equal(message, 'chart p99 latency per day for the last month');
});

test('blind set 5 (20 coding + 20 visual, sealed before the M1/S1-S4 fixes, one look): the honest number', () => {
  const bytes = `${BLIND_5.map((r) => `${r.visual ? 'Y' : 'N'}\t${r.text.replace(/\n/g, '\\n')}`).join('\n')}\n`;
  assert.equal(createHash('sha256').update(bytes).digest('hex'), BLIND_5_SHA256, 'the set is the one that was sealed');
  const s = score(BLIND_5);
  console.log(`blind 5: precision ${s.precision.toFixed(3)} recall ${s.recall.toFixed(3)} (tp ${s.tp} fp ${s.fp} fn ${s.fn} tn ${s.tn})${s.wrong.length ? `\n  ${s.wrong.join('\n  ')}` : ''}`);
  assert.equal(BLIND_5.length, 40);
  assert.equal(s.fp, 0, 'no false hint on pasted code, logs, diffs or voice');
  assert.ok(s.recall >= 0.75, `recall ${s.recall}`);
});
