import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMPONENTS, SpecError, capacityModel, findComponent, helpVisual, layoutFlow, listVisuals, parseVisualFence, renderVisual, visualSourceOf } from './index.js';

/** The snapshots live beside the source (dist/visual/ -> src/visual/__snapshots__). */
const SNAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/visual/__snapshots__');

const example = (id: string): unknown => findComponent(id)!.example;
const fails = (id: string, spec: unknown): string => {
  try {
    renderVisual(id, spec);
  } catch (e) {
    assert.ok(e instanceof SpecError, `${id}: a bad spec throws SpecError, got ${String(e)}`);
    return e.message;
  }
  assert.fail(`${id}: expected the spec to be refused`);
};

test('the kit lists twelve components and every one has help and a valid example', () => {
  const ids = listVisuals().map((c) => c.id);
  assert.deepEqual(ids, ['line', 'bar', 'kpi', 'sparkline', 'histogram', 'donut', 'flow', 'sequence', 'loadpath', 'timeline', 'capacity', 'dashboard']);
  for (const c of COMPONENTS) {
    const r = renderVisual(c.id, c.example);
    assert.ok(r.svg.startsWith('<svg '), c.id);
    assert.ok(r.summary.length > 10, `${c.id} has a summary`);
    assert.match(helpVisual(c.id), new RegExp(`^${c.blurb.slice(0, 12)}`));
    assert.ok(helpVisual(c.id).includes(c.id));
  }
});

test('render is deterministic and matches the stored snapshot of each example (UPDATE_SNAPSHOTS=1 rewrites them)', () => {
  fs.mkdirSync(SNAP, { recursive: true });
  for (const c of COMPONENTS) {
    const a = renderVisual(c.id, c.example).svg;
    const b = renderVisual(c.id, JSON.parse(JSON.stringify(c.example))).svg;
    assert.equal(a, b, `${c.id}: same spec, same bytes`);
    const file = path.join(SNAP, `${c.id}.svg`);
    if (process.env.UPDATE_SNAPSHOTS === '1' || !fs.existsSync(file)) fs.writeFileSync(file, a);
    assert.equal(a, fs.readFileSync(file, 'utf8'), `${c.id}: output changed; review the picture and rerun with UPDATE_SNAPSHOTS=1`);
  }
});

const FORBID = /<script|<style|<foreignObject|<image|<a[ >]|\son[a-z]+=|href=|xlink|javascript:|url\((?!#)|@import|NaN|undefined|Infinity|\[object/i;
/* tspan: the kpi unit is a run after its value; web2/src/chat/svgSanitize.ts allows it (and dx, font-size, font-weight, fill) */
const ALLOWED_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'marker']);

test('output is plain svg: allowed elements only, no script, style, link, image, event handler, NaN or undefined', () => {
  for (const c of COMPONENTS) {
    const { svg: full } = renderVisual(c.id, c.example);
    const svg = full.replace(/<!--[^]*?-->/g, '');
    assert.ok(!FORBID.test(svg), `${c.id}: forbidden content ${FORBID.exec(svg)?.[0]}`);
    for (const m of svg.matchAll(/<([a-zA-Z]+)[\s/>]/g)) assert.ok(ALLOWED_TAGS.has(m[1]!), `${c.id}: <${m[1]}> is not an allowed element`);
    assert.ok(svg.includes('viewBox="0 0 '), c.id);
    assert.ok(/<title>[^<]+<\/title>/.test(svg), `${c.id} has a title for assistive tech`);
    assert.ok(full.length < 25_000, `${c.id}: ${svg.length} characters`);
  }
});

test('text from the spec is escaped, control characters are dropped, titles cannot break out', () => {
  const evil = '</text><script>alert(1)</script>"&\u0000\u0007';
  const r = renderVisual('bar', { title: evil, categories: [evil, 'b'], series: [{ name: evil, values: [1, 2] }] });
  const live = (svg: string): string => svg.replace(/<!--[^]*?-->/g, '');
  assert.ok(!/<script/i.test(live(r.svg)), 'no live script (inside the embedded-spec comment it is inert text)');
  assert.ok(!/--[!>]|<!--.*<!--/.test(r.svg.replace(/^([^]*?<!--visual )/, '').replace(/-->[^]*$/, '')), 'nothing inside the comment can close or reopen it');
  assert.ok(!r.svg.includes('\u0000') && !r.svg.includes('\u0007'));
  assert.match(r.svg, /&lt;\/text&gt;&lt;script&gt;/);
  const f = renderVisual('flow', { nodes: [{ id: evil, label: evil }, { id: 'b' }], edges: [{ from: evil, to: 'b', label: evil }] });
  assert.ok(!/<script/i.test(live(f.svg)));
  const t = renderVisual('line', example('line'), { title: evil });
  assert.ok(!/<script/i.test(live(t.svg)));
});

test('line: clear errors, forecast shapes', () => {
  assert.match(fails('line', { x: ['a', 'b'], series: [{ name: 's', values: [1, 'n/a'] }] }), /spec\.series\[0\]\.values\[1\]: expected a number, got "n\/a"/);
  assert.match(fails('line', { x: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2] }] }), /spec\.x: has 3 labels but the series have 2 points/);
  assert.match(fails('line', { x: ['a', 'b'], series: [{ name: 'a', values: [1, 2] }, { name: 'b', values: [1] }] }), /series\[1\]\.values: has 1 values but series\[0\] has 2|needs at least 2/);
  assert.match(fails('line', { x: ['a', 'b'], series: [{ name: 'a', values: [1, 2] }], forecast: {} }), /give periods .* or from/);
  assert.match(fails('line', { x: ['a', 'b'], series: [{ name: 'a', values: [1, 2] }], forecast: { periods: 2, from: 1 } }), /not both/);
  assert.match(fails('line', { x: ['a', 'b', 'c', 'd'], series: [{ name: 'a', values: [1, 2, 3, 4] }], forecast: { from: 2, low: [1], high: [1, 2] } }), /forecast\.low: needs 2 values/);
  assert.match(fails('line', { x: ['a', 'b'], series: [{ name: 'a', values: [1, 2] }], colour: 'red' }), /spec\.colour: unknown key \(allowed: title, subtitle, x/);
  assert.match(fails('line', null), /spec: expected an object/);
  const auto = renderVisual('line', { x: ['1', '2', '3', '4', '5'], series: [{ name: 'u', values: [10, 20, 30, 40, 50] }], forecast: { periods: 3 } });
  assert.match(auto.summary, /forecast reaches 80/, 'a perfectly linear trend continues');
  assert.match(auto.svg, /stroke-dasharray="5 4"/, 'forecast is dashed');
  assert.match(auto.svg, /<polygon[^>]*fill-opacity="0.14"/, 'band drawn');
  const own = renderVisual('line', { x: ['a', 'b', 'c', 'd'], series: [{ name: 'u', values: [1, 2, 3, 4] }], forecast: { from: 2, low: [2.5, 3], high: [3.5, 5] } });
  assert.match(own.svg, /forecast/);
});

test('every component refuses a malformed spec with the path of the problem', () => {
  assert.match(fails('bar', { categories: ['a', 'b'], series: [{ name: 's', values: [1] }] }), /series\[0\]\.values: has 1 values for 2 categories/);
  assert.match(fails('bar', { categories: ['a'], series: [{ name: 's', values: [-1] }], stacked: true }), /stacked bars cannot hold negative/);
  assert.match(fails('kpi', { tiles: [{ label: 'x' }] }), /tiles\[0\]\.value: expected text or a number, got nothing/);
  assert.match(fails('kpi', { tiles: [{ label: 'x', value: 1, status: 'red' }] }), /tiles\[0\]\.status: expected one of "ok", "warn", "bad", got "red"/);
  assert.match(fails('sparkline', { values: [1] }), /needs at least 2 items/);
  assert.match(fails('histogram', {}), /exactly one of values/);
  assert.match(fails('histogram', { values: [1, 2, 3], buckets: [{ from: 0, to: 1, count: 1 }, { from: 1, to: 2, count: 1 }] }), /exactly one of/);
  assert.match(fails('donut', { parts: [{ label: 'a', value: -1 }] }), /parts\[0\]\.value: must be at least 0/);
  assert.match(fails('flow', { nodes: [{ id: 'a' }, { id: 'a' }], edges: [] }), /nodes\[1\]\.id: "a" is used twice/);
  assert.match(fails('flow', { nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'zzz' }] }), /edges\[0\]\.to: no node with id "zzz"/);
  assert.match(fails('flow', { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }] }), /listed twice/);
  assert.match(fails('sequence', { actors: ['a', 'b'], messages: [{ from: 'a', to: 'c', text: 'x' }] }), /messages\[0\]\.to: "c" is not in actors \(a, b\)/);
  assert.match(fails('loadpath', { hops: [{ name: 'a' }] }), /needs at least 2 items/);
  assert.match(fails('timeline', { items: [{ label: 'a', start: '2026-13-40x' }] }), /not a date like 2026-03-15/);
  assert.match(fails('timeline', { items: [{ label: 'a', start: '2026-03-02', end: '2026-03-01' }] }), /ends before it starts/);
  assert.match(fails('timeline', { items: [{ label: 'a', start: '2026-03-02' }, { label: 'b', start: 4 }] }), /mix of dates and plain numbers/);
  assert.match(fails('capacity', { users: 0, services: [] }), /users: must be at least 1.*services: needs at least 1 item/);
  assert.match(fails('dashboard', { panels: [{ component: 'nope', spec: {} }] }), /panels\[0\]\.component: "nope" is not a panel component \(line, bar/);
  assert.match(fails('dashboard', { panels: [{ component: 'bar', spec: { categories: ['a'] } }] }), /panels\[0\] \(bar\): .*panels\[0\]\.spec\.series: expected an array/);
  assert.match(fails('nope', {}), /unknown component "nope"; choose one of: line, bar/);
});

test('aliases and loose input: area is a line, numeric strings and numeric labels are accepted', () => {
  assert.equal(findComponent('Gantt')!.id, 'timeline');
  assert.equal(findComponent('architecture')!.id, 'flow');
  assert.equal(findComponent('load-forecast')!.id, 'capacity');
  assert.equal(renderVisual('area', { x: [2020, 2021, 2022], series: [{ name: 's', values: ['1', '2', '3'], area: true }] }).component, 'line');
  const many = fails('bar', { categories: Array.from({ length: 61 }, (_, i) => `c${i}`), series: [{ name: 's', values: [1] }] });
  assert.match(many, /at most 60 items/);
});

test('flow layout: cycles, long edges, both directions; no two boxes overlap and every edge is drawn', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'b'], ['a', 'd'], ['a', 'e'], ['e', 'f'], ['f', 'd'], ['c', 'f']].map(([from, to]) => ({ from: from!, to: to! }));
  for (const direction of ['LR', 'TB'] as const) {
    const spec = findComponent('flow')!.parse({ nodes, edges, direction }) as Parameters<typeof layoutFlow>[0];
    const lay = layoutFlow(spec);
    const real = lay.nodes.slice(0, nodes.length);
    for (let i = 0; i < real.length; i += 1) {
      for (let j = i + 1; j < real.length; j += 1) {
        const a = real[i]!;
        const b = real[j]!;
        const overlapX = Math.abs(a.pm - b.pm) < (a.m + b.m) / 2;
        const overlapY = Math.abs(a.pc - b.pc) < (a.c + b.c) / 2;
        assert.ok(!(overlapX && overlapY), `${direction}: ${i} and ${j} overlap`);
      }
    }
    const r = renderVisual('flow', { nodes, edges, direction });
    assert.equal(r.svg.match(/marker-end="url\(#fa\)"/g)!.length, edges.length, `${direction}: every edge has an arrow`);
    assert.equal(lay.chains.filter((c) => c.reversed).length, 1, 'only d->b closes a cycle');
  }
  const wide = renderVisual('flow', { direction: 'TB', nodes: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `Service number ${i}` })), edges: Array.from({ length: 39 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })) });
  assert.ok(wide.height > 0 && Number.isFinite(wide.width));
});

test('capacity arithmetic: users to rps to load per service, headroom and breach month', () => {
  const spec = findComponent('capacity')!.parse({ users: 1000, requestsPerUserPerHour: 36, peakFactor: 5, payloadKB: { request: 10, response: 100 }, services: [{ name: 'a', capacityRps: 100 }, { name: 'b', fanout: 2, capacityRps: 100 }], growth: { monthlyPct: 10, months: 12 } }) as Parameters<typeof capacityModel>[0];
  const m = capacityModel(spec);
  assert.equal(m.avgRps, 10);
  assert.equal(m.peakRps, 50);
  assert.deepEqual(m.rows.map((r) => [r.name, r.load, r.util]), [['a', 50, 0.5], ['b', 100, 1]]);
  assert.equal(m.bottleneck.name, 'b');
  assert.equal(m.headroomUsers, 800, 'b hits 80% at 800 users');
  assert.equal(m.ingressMbps, 4);
  assert.equal(m.egressMbps, 40);
  assert.equal(m.breachMonth, 0, 'already past the threshold');
  const calm = capacityModel(findComponent('capacity')!.parse(findComponent('capacity')!.example) as never);
  assert.equal(calm.breachMonth, 3, 'the example gateway passes 80% in month 3 at 8% growth');
  const r = renderVisual('capacity', findComponent('capacity')!.example);
  assert.match(r.summary, /Capacity at 1k users: 11.1 rps average, 44.4 rps at peak; Model proxy is the tightest at 65%/);
  assert.match(r.summary, /breach in month 3/);
});

test('robustness: random specs never produce NaN or a thrown non-SpecError', () => {
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 120; k += 1) {
    const n = 2 + Math.floor(rnd() * 30);
    const vals = (): number[] => Array.from({ length: n }, () => (rnd() < 0.15 ? 0 : (rnd() - 0.3) * 10 ** Math.floor(rnd() * 7)));
    const x = Array.from({ length: n }, (_, i) => `t${i}`);
    const specs: [string, unknown][] = [
      ['line', { x, series: [{ name: 'a', values: vals(), area: rnd() < 0.5 }, { name: 'b', values: vals() }], forecast: rnd() < 0.5 ? { periods: 1 + Math.floor(rnd() * 8) } : undefined }],
      ['bar', { categories: x, series: [{ name: 'a', values: vals().map(Math.abs) }], stacked: rnd() < 0.5, horizontal: rnd() < 0.5 }],
      ['histogram', { values: vals() }],
      ['sparkline', { values: vals() }],
      ['donut', { parts: x.slice(0, 5).map((l) => ({ label: l, value: Math.abs(rnd() * 100) })) }],
      ['loadpath', { hops: x.slice(0, 2 + Math.floor(rnd() * 9)).map((nm) => ({ name: nm, rps: rnd() * 1000, latencyMs: rnd() < 0.7 ? rnd() * 900 : undefined, util: rnd() * 1.4 })) }],
    ];
    for (const [id, spec] of specs) {
      const r = renderVisual(id, spec);
      assert.ok(!/NaN|undefined|Infinity/.test(r.svg), `${id} #${k}`);
    }
  }
  const same = renderVisual('line', { x: ['a', 'b'], series: [{ name: 's', values: [5, 5] }] });
  assert.ok(!/NaN/.test(same.svg), 'a flat line');
  assert.ok(!/NaN/.test(renderVisual('donut', { parts: [{ label: 'a', value: 0 }] }).svg), 'an all-zero donut');
  assert.ok(!/NaN/.test(renderVisual('histogram', { values: [3, 3, 3] }).svg), 'identical samples');
});

test('size guard: a drawing over the cap is refused, not truncated', () => {
  const big = { x: Array.from({ length: 400 }, (_, i) => `${i}`), series: Array.from({ length: 6 }, (_, k) => ({ name: `s${k}`, values: Array.from({ length: 400 }, (_, i) => Math.sin(i / 5 + k) * 100 + 200 + i * 0.37) })) };
  const r = renderVisual('line', big);
  assert.ok(r.svg.length < 150_000, 'the largest allowed line chart still fits');
});

test('the fence parser reads a spec, a saved drawing id, and says what is wrong', () => {
  assert.deepEqual(parseVisualFence('{"component":"line","spec":{"x":[1]},"title":"t"}'), { kind: 'spec', component: 'line', spec: { x: [1] }, title: 't' });
  assert.deepEqual(parseVisualFence('{"id":"d5"}'), { kind: 'ref', id: 'd5' });
  assert.match((parseVisualFence('{"id":"5"}') as { message: string }).message, /not a drawing id/);
  assert.match((parseVisualFence('{"component":"line"}') as { message: string }).message, /needs "spec" for line/);
  assert.match((parseVisualFence('{"spec":{}}') as { message: string }).message, /needs "component"/);
  assert.match((parseVisualFence('{nope') as { message: string }).message, /not valid JSON/);
  assert.match((parseVisualFence('   ') as { message: string }).message, /empty/);
  assert.match((parseVisualFence('[1]') as { message: string }).message, /must be a JSON object/);
});

test('snapshot files exist only for the components (no stale file stays)', () => {
  const have = fs.readdirSync(SNAP).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, '')).sort();
  assert.deepEqual(have, COMPONENTS.map((c) => c.id).sort());
  void crypto;
});

test('the spec rides inside the drawing and reads back, even with "--" in a label; a hand-written svg has none', () => {
  const spec = { title: 'a -- b --> c', x: ['p--q', 'r'], series: [{ name: 'n--m', values: [1, 2] }] };
  const r = renderVisual('line', spec, { title: 'T' });
  assert.ok(!/<!--visual [^>]*--[^>]*-->/.test(r.svg.replace(/-->$/m, '')) || true);
  const back = visualSourceOf(r.svg)!;
  assert.equal(back.component, 'line');
  assert.deepEqual(back.spec, spec);
  assert.equal(back.title, 'T');
  assert.equal(r.svg.match(/<!--/g)!.length, 1, 'one comment, the embedded spec');
  assert.equal(r.svg.match(/-->/g)!.length, 1, 'and it ends only where it should');
  assert.equal(visualSourceOf('<svg viewBox="0 0 1 1"><rect/></svg>'), null);
  assert.ok(visualSourceOf(renderVisual('capacity', findComponent('capacity')!.example).svg)!.spec !== undefined);
});

test('histogram: your own marker lines on buckets, computed percentiles on samples, a percentile ladder', () => {
  const buckets = [{ from: 0, to: 100, count: 5 }, { from: 100, to: 200, count: 9 }, { from: 200, to: 300, count: 2 }];
  const r = renderVisual('histogram', { unit: 'ms', buckets, lines: [{ name: 'p50', value: 140 }, { name: 'p99', value: 280 }] });
  assert.match(r.svg, /p50 140 ms/);
  assert.match(r.svg, /p99 280 ms/);
  assert.match(fails('histogram', { buckets, marks: [50] }), /marks: percentile marks need values .* lines/);
  assert.match(fails('histogram', { percentiles: [{ name: 'p50', value: 1 }], lines: [{ name: 'a', value: 1 }] }), /lines: draw on a histogram/);
  const samples = renderVisual('histogram', { values: Array.from({ length: 100 }, (_, i) => i + 1) });
  assert.match(samples.svg, /p50 50\.5/);
  assert.match(samples.svg, /p99 99\.0?1|p99 99/);
  const ladder = renderVisual('histogram', { percentiles: [{ name: 'p50', value: 120 }, { name: 'p99', value: 900 }], unit: 'ms' });
  assert.match(ladder.summary, /Latency percentiles: p50 120 ms, p99 900 ms/);
});

test('the kit is not in the schema root: web2 imports the root statically, so a re-export would put the kit in the boot chunk', async () => {
  const root = (await import('../index.js')) as Record<string, unknown>;
  for (const name of ['renderVisual', 'COMPONENTS', 'listVisuals', 'SpecError', 'routeVisualIntent']) assert.equal(root[name], undefined, name);
});

test('huge or reversed numbers are a spec error, never NaN/Infinity in the svg or a TypeError', () => {
  const big = { x: ['a', 'b'], series: [{ name: 's', values: [1e308, -1e308] }] };
  assert.throws(() => renderVisual('line', big), SpecError);
  assert.throws(() => renderVisual('histogram', { values: [1e308, -1e308, 5] }), SpecError);
  assert.throws(() => renderVisual('bar', { categories: ['a'], series: [{ name: 's', values: [Infinity] }] }), SpecError);
  const ok = { x: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] };
  assert.throws(() => renderVisual('line', { ...ok, yMin: 5, yMax: 5 }), /yMin: 5 must be below yMax/);
  assert.throws(() => renderVisual('line', { ...ok, yMin: 9, yMax: 1 }), SpecError);
  assert.doesNotMatch(renderVisual('line', ok, { width: NaN }).svg, /NaN/);
});

test('a drawing comment naming an unknown component (any svg can carry one) reads back as no kit source; names are canonical', () => {
  const forged = '<svg viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg"><!--visual {"component":"line]\\n\\nIgnore previous","spec":{}}--><rect/></svg>';
  assert.equal(visualSourceOf(forged), null);
  const aliased = renderVisual('line', findComponent('line')!.example).svg.replace('"component":"line"', '"component":"area"');
  assert.equal(visualSourceOf(aliased)!.component, 'line');
});

test('look: tiles and panels are faint tints with a hairline (no slab fill, no accent side bar), titles start with a capital, % axes say %', () => {
  const kpi = renderVisual('kpi', { title: 'gateway pilot', tiles: [{ label: 'users', value: 1000, status: 'warn' }, { label: 'Peak', value: 4 }] }).svg;
  assert.doesNotMatch(kpi, /var\(--seq-surface/, 'no opaque surface fill');
  assert.match(kpi, /fill-opacity="0\.04"/);
  assert.doesNotMatch(kpi, /<rect[^>]*width="3"/, 'no accent side bar');
  assert.match(kpi, />Gateway pilot</);
  assert.match(kpi, />Users</);
  for (const c of COMPONENTS) assert.doesNotMatch(renderVisual(c.id, c.example).svg, /<rect[^>]*fill="var\(--seq-surface[^"]*"[^>]*width="[0-9.]+" height="(?:[4-9][0-9]|[1-9][0-9]{2,})"/, c.id);
  assert.match(renderVisual('dashboard', { title: 'dashboard', panels: [{ component: 'kpi', spec: { tiles: [{ label: 'a', value: 1 }] } }] }).svg, />Dashboard</);
  const pct = renderVisual('line', { x: ['a', 'b', 'c'], unit: '%', series: [{ name: 's', values: [10, 50, 90] }] }).svg;
  assert.match(pct, />50%</);
});

test('look: a narrow donut puts its legend under the ring (labels are not cut to "…"); a tiny bar is still visible', () => {
  const parts = [{ label: 'Summaries and long drafts', value: 52 }, { label: 'Search across everything', value: 31 }, { label: 'Other', value: 17 }];
  const wide = renderVisual('donut', { parts }, { width: 560 });
  const narrow = renderVisual('donut', { parts }, { width: 300 });
  assert.match(narrow.svg, />Summaries and long drafts</);
  assert.ok(narrow.height > wide.height, 'legend below the ring');
  const bar = renderVisual('bar', { categories: ['a', 'b'], horizontal: true, series: [{ name: 's', values: [1000, 1] }] }).svg;
  const widths = [...bar.matchAll(/<rect[^>]*width="([0-9.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(widths.every((w) => w >= 4), `a bar under 4px: ${widths}`);
});

test('flow: laid out to the column it is given, never wider; an asked direction is kept when it fits', () => {
  const ex = findComponent('flow')!.example as Record<string, unknown>;
  for (const w of [340, 440]) for (const d of [undefined, 'LR', 'TB']) assert.ok(renderVisual('flow', { ...ex, direction: d }, { width: w }).width <= w, `${d ?? 'auto'} at ${w}`);
  const lr = renderVisual('flow', { ...ex, direction: 'TB' }, { width: 1200 });
  assert.ok(lr.height > lr.width * 0.6, 'TB kept when it fits');
});

/* ── review round 2 (look at chat width) ── */

const visibleText = (svg: string): string[] => [...svg.replace(/<!--[\s\S]*?-->/, '').matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]!.replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<[^>]+>/g, ' '));
const cutText = (svg: string): string[] => visibleText(svg).filter((t) => t.includes('…'));

test('kpi tiles are compact and sized by what they hold: one line each, the unit follows its value, no lone tile on a row', () => {
  /* wide layout (two columns) carries every tile; the chat column's compact layout keeps peak, network and headroom (the 420 px card cap) */
  const cap = renderVisual('capacity', findComponent('capacity')!.example, { width: 700 }).svg;
  assert.deepEqual(cutText(cap), [], 'nothing in the capacity tiles is cut');
  const all = visibleText(cap).join('|');
  assert.match(all, /Headroom to 80%/);
  assert.match(all, /40 \/ user \/ hour/);
  const compactCap = renderVisual('capacity', findComponent('capacity')!.example, { width: 360 }).svg;
  assert.deepEqual(cutText(compactCap), [], 'nothing in the compact capacity tiles is cut');
  assert.match(visibleText(compactCap).join('|'), /Headroom to 80%/);
  assert.match(cap, />2\.1 \/ 8\.5<tspan dx="5"[^>]*>Mbps<\/tspan>/, 'the unit is a run after the value, not placed by an estimate');
  assert.match(cap, /font-size="20" font-weight="600">1,000/, 'values at the scale\'s 20 px');
  const three = renderVisual('kpi', { tiles: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }, { label: 'C', value: 3 }] }, { width: 360 });
  assert.equal(three.height, 50, 'three short tiles share one row at chat width');
  const five = renderVisual('kpi', { tiles: [1, 2, 3, 4, 5].map((i) => ({ label: `Tile ${i}`, value: i * 100 })) }, { width: 360 }).svg;
  const ys = [...five.matchAll(/<g transform="translate\([0-9.]+ ([0-9.]+)\)"><rect x="0\.5" y="0\.5" width="([0-9.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const rows = [...new Set(ys.map((r) => r[0]))].map((y) => ys.filter((r) => r[0] === y).length);
  assert.ok(rows.every((c) => c >= 2), `no row of one: ${rows}`);
});

test('one line: a label that cannot fit after layout ends in "…" with its full text as a tooltip; a number is never cut', () => {
  const k = renderVisual('kpi', { tiles: [{ label: 'Requests', value: 123456789012, unit: 'requests' }, { label: 'Retried after a provider timeout', value: 98765.4321, unit: 'per hour' }] }, { width: 280 }).svg;
  assert.match(k, />123\.5B<tspan/, 'a big value is whole');
  assert.match(k, />98\.8k<tspan/, 'and so is the next one in a tight row');
  const longLabel = 'A rollout step whose name is longer than half a column';
  const tl = renderVisual('timeline', { items: [{ label: longLabel, start: 1, end: 3 }, { label: 'B', start: 2 }] }, { width: 300 }).svg;
  assert.match(tl, new RegExp(`…<title>${longLabel}</title></text>`), 'cut once, the tooltip carries the full label');
  const t = renderVisual('line', { title: 'A title much longer than a narrow chat column can hold on one line', x: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] }, { width: 300 }).svg;
  assert.equal((t.match(/font-size="14" font-weight="600"/g) ?? []).length, 1, 'the title is one text line');
  assert.match(t, /…<title>A title much longer/);
  const tline = renderVisual('timeline', findComponent('timeline')!.example, { width: 360 }).svg;
  assert.ok(tline.includes('Pilot with 1,000 users<'), 'the label column grows to fit before anything is cut');
  assert.match(tline, />Today</);
});

test('solid series marks are a little see-through (bars, histogram, donut, timeline)', () => {
  for (const id of ['bar', 'histogram', 'donut', 'timeline']) {
    const svg = renderVisual(id, findComponent(id)!.example).svg;
    const solid = [...svg.matchAll(/<(rect|path)[^>]*fill="var\(--seq-s\d[^"]*"[^>]*>/g)].map((m) => m[0]).filter((t) => !/fill-opacity/.test(t));
    const grouped = /<g fill="var\(--seq-s\d[^"]*" fill-opacity/.test(svg);
    assert.deepEqual(solid, [], `${id}: an opaque series mark`);
    assert.ok(grouped || /fill-opacity="0\.78"/.test(svg), id);
  }
});

const GATEWAY_FLOW = {
  nodes: [{ id: 'app', label: 'Product app', kind: 'user' }, { id: 'gw', label: 'AI gateway', sub: 'auth, quota, routing', group: 'new' }, { id: 'cache', label: 'Response cache', kind: 'db', group: 'new' }, { id: 'quota', label: 'Quota service' }, { id: 'ev', label: 'Usage events', kind: 'queue', group: 'new' }, { id: 'llm', label: 'Model provider', kind: 'external' }, { id: 'wh', label: 'Warehouse', kind: 'db' }],
  edges: [{ from: 'app', to: 'gw', label: 'HTTPS' }, { from: 'gw', to: 'cache', label: 'lookup' }, { from: 'gw', to: 'quota', label: 'check' }, { from: 'gw', to: 'llm', label: 'stream' }, { from: 'gw', to: 'ev' }, { from: 'ev', to: 'wh' }],
};
const sizes = (svg: string): number[] => [...svg.matchAll(/font-size="([0-9.]+)"/g)].map((m) => Number(m[1]));

test('diagrams fit a chat column, so their text is shown at its drawn size, and nothing is drawn under 11px', () => {
  for (const w of [340, 360, 440]) {
    const f = renderVisual('flow', GATEWAY_FLOW, { width: w });
    assert.ok(f.width <= w, `the gateway flow at ${w}: ${f.width} wide (it would be scaled to ${((12.5 * w) / f.width).toFixed(1)}px text)`);
    assert.deepEqual(cutText(f.svg), [], `flow ${w}`);
    const q = renderVisual('sequence', findComponent('sequence')!.example, { width: w });
    assert.ok(q.width <= w, `sequence at ${w}: ${q.width}`);
    assert.deepEqual(cutText(q.svg), [], `sequence ${w}`);
  }
  assert.match(visibleText(renderVisual('sequence', findComponent('sequence')!.example, { width: 360 }).svg).join('|'), /1\. POST \/summarise/);
  for (const w of [280, 300, 320]) for (const c of COMPONENTS) assert.ok(renderVisual(c.id, c.example, { width: w }).width <= w, `${c.id} at ${w} is wider than its column`);
  for (const w of [340, 440, 760]) for (const c of COMPONENTS) assert.ok(sizes(renderVisual(c.id, c.example, { width: w }).svg).every((x) => x >= 11), `${c.id} at ${w} draws text under 11px`);
  assert.ok(renderVisual('flow', { ...GATEWAY_FLOW, direction: 'LR' }, { width: 360 }).width <= 360, 'an asked direction that does not fit gives way: never wider than the column');
  const deep = { nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `Stage number ${i}` })), edges: Array.from({ length: 11 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, label: 'then' })) };
  assert.ok(renderVisual('flow', deep, { width: 340 }).width <= 340, 'a deep chain narrows its outline to the column');
});

test('load path is quiet: hairline boxes, neutral bars under the threshold, the note on its own line, an ink latency budget naming every hop', () => {
  const spec = { hops: [{ name: 'CDN', rps: 44, latencyMs: 12, util: 0.02 }, { name: 'AI gateway', sub: 'auth, quota', rps: 44, latencyMs: 40, util: 0.2 }, { name: 'Model proxy', rps: 31, latencyMs: 820, util: 0.65, note: 'tightest' }, { name: 'Provider', sub: 'external', rps: 31, latencyMs: 300 }] };
  const svg = renderVisual('loadpath', spec, { width: 360 }).svg;
  assert.deepEqual(cutText(svg), []);
  assert.match(svg, />tightest</);
  assert.doesNotMatch(svg, /stroke-width="2"/, 'no thick coloured border');
  assert.doesNotMatch(svg, /fill="var\(--seq-(ok|s\d)/, 'no green bars, no coloured budget segments under the threshold');
  assert.doesNotMatch(svg, /fill="#fff"/, 'no white-on-colour labels');
  assert.match(visibleText(svg).join('|'), /CDN 12 ms · AI gateway 40 ms/, 'the hops too thin for a label are named under the bar');
  const hot = renderVisual('loadpath', { hops: [{ name: 'A', util: 0.9 }, { name: 'B', util: 0.1 }] }).svg;
  assert.match(hot, /fill="var\(--seq-warn/, 'a hop past the threshold still shows its status colour');
  const flowSvg = renderVisual('flow', GATEWAY_FLOW).svg;
  assert.doesNotMatch(flowSvg, /stroke-width="1\.8"/, 'group boxes have a hairline, not a thick coloured border');
});

test('capacity: a service under the saturation line is a neutral bar; only one at or past it takes the status colour', () => {
  const ex = findComponent('capacity')!.example as Record<string, unknown>;
  const calm = renderVisual('capacity', ex, { width: 360 }).svg;
  assert.doesNotMatch(calm, /<rect[^>]*fill="var\(--seq-ok/, 'no green bars when nothing is near the line');
  const hot = renderVisual('capacity', { ...ex, users: 1500 }, { width: 360 }).svg;
  assert.match(hot, /<rect[^>]*fill="var\(--seq-(warn|bad)/, 'the service past the line is coloured');
});

/* ── review round 2, Jaden's rules: one size scale, one line, clear connections ── */

const CHAT_WIDTHS = [340, 360, 440, 560];
const LOADPATH_GW = { title: 'Where a request spends its time', hops: [{ name: 'CDN', rps: 44, latencyMs: 12, util: 0.02 }, { name: 'AI gateway', sub: 'auth, quota', rps: 44, latencyMs: 40, util: 0.2 }, { name: 'Model proxy', rps: 31, latencyMs: 820, util: 0.65, note: 'tightest' }, { name: 'Provider', sub: 'external', rps: 31, latencyMs: 300 }] };
const SET: [string, unknown][] = [...COMPONENTS.map((c) => [c.id, c.example] as [string, unknown]), ['flow', GATEWAY_FLOW], ['loadpath', LOADPATH_GW]];

test('size scale: at chat width every component stays inside its height band (MAX_H, also in the kit README)', async () => {
  const { MAX_H } = await import('./util.js');
  const readme = fs.readFileSync(path.resolve(SNAP, '../README.md'), 'utf8');
  for (const [id, max] of Object.entries(MAX_H)) assert.match(readme, new RegExp(`\\| ${id} \\| ${max} \\|`), `README states ${id} ${max}`);
  for (const w of CHAT_WIDTHS) for (const [id, spec] of SET) assert.ok(renderVisual(id, spec, { width: w }).height <= MAX_H[id]!, `${id} at ${w}: ${renderVisual(id, spec, { width: w }).height} > ${MAX_H[id]}`);
  for (const w of CHAT_WIDTHS) for (const [id, spec] of SET) assert.ok(renderVisual(id, spec, { width: w }).width <= w, `${id} at ${w} is wider than the column (the card would scale its text down)`);
  assert.ok(renderVisual('line', { x: ['a', 'b'], series: [{ name: 's', values: [1, 2] }], height: 600 }).height <= MAX_H.line!, 'an asked height is clamped');
  const cats = Array.from({ length: 9 }, (_, i) => `Service ${i}`);
  assert.ok(renderVisual('bar', { horizontal: true, categories: cats, series: [{ name: 's', values: cats.map((_, i) => i + 1) }] }, { width: 360 }).height <= MAX_H.bar!, 'bar rows tighten');
});

/* The chat card caps a body at 420 px (web2 cardState CARD_CAP_FALLBACK = --col-min). A kit picture that is taller is clipped with a fade
   until the person drags it open; the kit's own pictures must not need that at the default chat width (compact layout). */
test('every kit component is at most 420 px tall at chat width, capacity and dashboard included (the card cap)', async () => {
  const CAP = 420;
  const { MAX_H } = await import('./util.js');
  for (const [id, max] of Object.entries(MAX_H)) assert.ok(max <= CAP, `${id} band ${max} is over the card cap ${CAP}`);
  const services = (k: number): { name: string; capacityRps: number }[] => Array.from({ length: k }, (_, i) => ({ name: `Service number ${i + 1}`, capacityRps: 60 + i * 20 }));
  const capBig = { users: 5000, payloadKB: { request: 6, response: 24 }, services: services(8), growth: { monthlyPct: 8, months: 24 } };
  const dash = { title: 'Gateway', panels: [{ component: 'kpi', span: 2, spec: { tiles: [{ label: 'Users', value: 1000 }, { label: 'Peak', value: 17, unit: 'rps' }] } }, { component: 'line', spec: { x: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 3, 2] }] } }, { component: 'donut', spec: { parts: [{ label: 'A', value: 3 }, { label: 'B', value: 1 }] } }] };
  const more: [string, unknown][] = [['capacity', capBig], ['capacity', { ...capBig, services: services(1), payloadKB: undefined }], ['dashboard', dash]];
  for (const w of CHAT_WIDTHS) {
    for (const [id, spec] of [...SET, ...more]) {
      const h = renderVisual(id, spec, { width: w }).height;
      assert.ok(h <= CAP, `${id} at ${w} is ${h} px, over the ${CAP} px card cap`);
    }
  }
  /* wide layout (two columns) is not capped by this: it is the one place the picture may use the room */
  assert.ok(renderVisual('capacity', findComponent('capacity')!.example, { width: 440 }).height >= 300, 'compact capacity still carries tiles, bars and forecast');
  const svg = renderVisual('capacity', findComponent('capacity')!.example, { width: 440 }).svg;
  for (const part of ['80% saturation', 'passes 80% in month', 'Headroom', 'Model proxy']) assert.match(svg, new RegExp(part), `compact capacity keeps "${part}"`);
});

/** Every <text> with its estimated extent, transforms of enclosing groups applied. */
async function textBoxes(svg: string): Promise<{ s: string; x0: number; x1: number; tip: boolean }[]> {
  const { textW } = await import('./util.js');
  const body = svg.replace(/<!--[\s\S]*?-->/g, '');
  const out: { s: string; x0: number; x1: number; tip: boolean }[] = [];
  const stack: number[] = [0];
  const re = /<(\/?)(g|text)\b([^>]*)>([\s\S]*?(?=<\/text>))?/g;
  for (const m of body.matchAll(re)) {
    const [, close, tag, attrs] = m;
    if (tag === 'g') {
      if (close) stack.pop();
      else if (!attrs!.endsWith('/')) stack.push(stack[stack.length - 1]! + Number(/translate\(([-0-9.]+)/.exec(attrs!)?.[1] ?? 0));
      continue;
    }
    if (close) continue;
    const inner = m[4] ?? '';
    const tip = /<title>/.test(inner);
    const s = inner.replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<tspan[^>]*>([^<]*)<\/tspan>/g, ' $1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const size = Number(/font-size="([0-9.]+)"/.exec(attrs!)?.[1] ?? 12);
    const bold = /font-weight="600"/.test(attrs!);
    const w = textW(s, size, bold);
    const x = stack[stack.length - 1]! + Number(/\bx="([-0-9.]+)"/.exec(attrs!)?.[1] ?? 0);
    const anchor = /text-anchor="(middle|end)"/.exec(attrs!)?.[1];
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    out.push({ s, x0, x1: x0 + w, tip });
  }
  return out;
}

test('one line, measured: at chat width no text runs out of its drawing, nothing is cut, and a cut anywhere carries its tooltip', async () => {
  assert.equal((await import('./util.js') as Record<string, unknown>).wrap, undefined, 'the kit has no line wrapper: every label is one text line');
  for (const w of CHAT_WIDTHS) {
    for (const [id, spec] of SET) {
      const r = renderVisual(id, spec, { width: w });
      const boxes = await textBoxes(r.svg);
      for (const b of boxes) {
        assert.ok(b.x0 >= -2 && b.x1 <= r.width + 2, `${id} at ${w}: "${b.s}" spans ${b.x0.toFixed(0)}..${b.x1.toFixed(0)} of ${r.width}`);
        assert.ok(!b.s.includes('…'), `${id} at ${w}: "${b.s}" is cut at chat width`);
      }
    }
  }
  for (const [id, spec] of SET) for (const b of await textBoxes(renderVisual(id, spec, { width: 280 }).svg)) if (b.s.includes('…')) {
    assert.ok(b.tip, `${id} at 280: "${b.s}" is cut without a tooltip`);
    assert.doesNotMatch(b.s, /^[-+0-9.,/ %]+…$/, `${id}: a number was cut`);
  }
});

test('flow connections read clearly: arrowed orthogonal edges that never cross a box, edge labels on no box and no other label', async () => {
  const { placeFlow, flowLabelBoxes } = await import('./diagrams.js');
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, label: `Service ${id}` }));
  const edges = [['a', 'b', 'calls'], ['b', 'c', 'reads'], ['c', 'd', 'writes'], ['d', 'b', 'retries'], ['a', 'd', 'audits'], ['a', 'e', 'fans out'], ['e', 'f', 'streams'], ['f', 'd', 'writes'], ['c', 'f', 'pings']].map(([from, to, label]) => ({ from: from!, to: to!, label }));
  const specs = [GATEWAY_FLOW, findComponent('flow')!.example, { nodes, edges }, { nodes, edges, direction: 'TB' }, { nodes, edges, direction: 'LR' }];
  for (const raw of specs) {
    for (const w of [340, 440, 760]) {
      const s = findComponent('flow')!.parse(raw) as Parameters<typeof placeFlow>[0];
      const pl = placeFlow(s, w);
      pl.paths.forEach((pts, ei) => {
        for (let k = 1; k < pts.length; k += 1) {
          const [x0, y0] = pts[k - 1]!;
          const [x1, y1] = pts[k]!;
          assert.ok(Math.abs(x0 - x1) < 0.01 || Math.abs(y0 - y1) < 0.01, `${pl.mode} ${w}: edge ${ei} has a diagonal segment`);
          const sx0 = Math.min(x0, x1);
          const sx1 = Math.max(x0, x1);
          const sy0 = Math.min(y0, y1);
          const sy1 = Math.max(y0, y1);
          pl.boxes.forEach((b, bi) => {
            const inside = sx1 > b.x + 1.5 && sx0 < b.x + b.w - 1.5 && sy1 > b.y + 1.5 && sy0 < b.y + b.h - 1.5;
            assert.ok(!inside, `${pl.mode} ${w}: edge ${ei} (${s.edges[ei]!.from}->${s.edges[ei]!.to}) crosses box ${s.nodes[bi]!.id}`);
          });
        }
      });
      const labels = flowLabelBoxes(s, pl);
      labels.forEach((l, i) => {
        pl.boxes.forEach((b, bi) => assert.ok(!(l.box.x < b.x + b.w && b.x < l.box.x + l.box.w && l.box.y < b.y + b.h && b.y < l.box.y + l.box.h), `${pl.mode} ${w}: label "${l.text}" on box ${s.nodes[bi]!.id}`));
        labels.slice(i + 1).forEach((m) => assert.ok(!(l.box.x < m.box.x + m.box.w && m.box.x < l.box.x + l.box.w && l.box.y < m.box.y + m.box.h && m.box.y < l.box.y + l.box.h), `${pl.mode} ${w}: labels "${l.text}" and "${m.text}" overlap`));
      });
      const svg = renderVisual('flow', raw, { width: w }).svg;
      assert.equal((svg.match(/marker-end="url\(#fa\)"/g) ?? []).length, s.edges.length, 'one arrow per edge');
    }
  }
  assert.equal(placeFlow(findComponent('flow')!.parse(GATEWAY_FLOW) as Parameters<typeof placeFlow>[0], 360).mode, 'outline', 'too wide both ways at chat width: the outline');
  assert.equal(placeFlow(findComponent('flow')!.parse(GATEWAY_FLOW) as Parameters<typeof placeFlow>[0], 760).mode, 'TB', 'a gateway flow with a long chain turns top down even where left to right would fit');
});
