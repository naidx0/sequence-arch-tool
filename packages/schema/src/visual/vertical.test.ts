import assert from 'node:assert/strict';
import { test } from 'node:test';

import { placeFlow } from './diagrams.js';
import { findComponent, renderVisual } from './index.js';

const chain = (k: number, direction?: string) => ({
  direction,
  nodes: Array.from({ length: k }, (_, i) => ({ id: `n${i}`, label: `Step ${i + 1}` })),
  edges: Array.from({ length: k - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
});
const parse = (raw: unknown) => findComponent('flow')!.parse(raw) as Parameters<typeof placeFlow>[0];

test('flow prefers vertical: a 6-step chain is a column at any width, asked or not; a short one may run across', () => {
  for (const w of [340, 440, 760, 1200]) {
    for (const d of [undefined, 'LR', 'TB']) {
      const pl = placeFlow(parse(chain(6, d)), w);
      assert.notEqual(pl.mode, 'LR', `6 steps, ${d ?? 'auto'} at ${w}`);
      assert.ok(pl.height >= pl.width, `6 steps are taller than wide (${pl.width}x${pl.height}) ${d ?? 'auto'} at ${w}`);
      assert.ok(renderVisual('flow', chain(6, d), { width: w }).width <= w);
    }
  }
  assert.equal(placeFlow(parse(chain(3)), 760).mode, 'LR', 'three steps still run across when they fit');
});

test('titles are centred: the heading sits on the middle of the drawing, anchored middle', () => {
  for (const w of [340, 440, 760]) {
    for (const id of ['line', 'bar', 'flow', 'sequence', 'timeline', 'donut']) {
      const r = renderVisual(id, { ...(findComponent(id)!.example as object), title: 'A centred title' }, { width: w });
      const m = /<text x="([\d.]+)" y="14" font-size="14" font-weight="600"[^>]*text-anchor="middle"/.exec(r.svg);
      assert.ok(m, `${id}@${w}: title is anchored middle`);
      assert.ok(Math.abs(Number(m![1]) - r.width / 2) <= 1, `${id}@${w}: title x ${m![1]} is the middle of ${r.width}`);
    }
  }
});
