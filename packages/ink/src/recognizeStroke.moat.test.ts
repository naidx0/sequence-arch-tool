/**
 * P3 — stroke geometry maps to grounded shape kinds used by design + board ink.
 * Spec: docs/tier-3-test-spec.md (file no longer exists; the living record is docs/adr/ADR-010-three-tier-completion-program.md)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeStroke, INK_THRESHOLDS } from './index.js';

/** Node kinds the design canvas InkOverlay can create from a box picker. */
const DESIGN_NODE_KINDS = new Set(['service', 'datastore', 'topic']);

function boxStroke(x: number, y: number, size: number) {
  const pts: { x: number; y: number }[] = [];
  const corners = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
    { x, y },
  ];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    for (let t = 0; t < 12; t++) {
      const f = t / 12;
      pts.push({
        x: a.x + (b.x - a.x) * f + ((t * 5) % 7) - 3,
        y: a.y + (b.y - a.y) * f + ((t * 11) % 7) - 3,
      });
    }
  }
  return pts;
}

test('box stroke → kind box with confidence (design node picker path)', () => {
  const r = recognizeStroke(boxStroke(100, 100, 200));
  assert.equal(r.kind, 'box');
  if (r.kind === 'box') {
    assert.ok(r.confidence > 0);
    assert.ok(r.rect.width >= INK_THRESHOLDS.MIN_DIAGONAL);
    assert.ok(DESIGN_NODE_KINDS.size === 3);
  }
});

test('straight line stroke → kind line (edge connect path)', () => {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 30; i++) {
    pts.push({ x: 100 + i * 8, y: 200 + ((i * 3) % 5) - 2 });
  }
  const r = recognizeStroke(pts);
  assert.equal(r.kind, 'line');
});

test('scribble does not invent box or line', () => {
  const r = recognizeStroke([
    { x: 0, y: 0 },
    { x: 50, y: 80 },
    { x: 100, y: 10 },
    { x: 150, y: 90 },
  ]);
  assert.equal(r.kind, 'scribble');
});
