import assert from 'node:assert';
import { test } from 'node:test';
import type { SeqDiagramV1 } from '@sequence/schema';
import { renderSeqDiagramSvg } from './renderSeqDiagramSvg.js';
import {
  SEQ_CARD_H,
  SEQ_CARD_W,
  SEQ_EMPTY_MIN_H,
  SEQ_EMPTY_MIN_W,
  SEQ_MIN_VIEW_H,
  SEQ_MIN_VIEW_W,
  boardDisplayDoc,
  docWithExpandedRollup,
  seqDiagramContentBounds,
  seqDiagramNodeRects,
  seqDiagramSheetBounds,
  viewBoxFromSvg,
} from './seqDiagramLayout.js';

test('seqDiagramLayout: CARD_W is the layered-flow card width', () => {
  assert.strictEqual(SEQ_CARD_W, 110);
});

test('seqDiagramLayout: CARD_H fits title and subtitle', () => {
  assert.strictEqual(SEQ_CARD_H, 64);
});

test('seqDiagramLayout: empty sheet uses sketch floor', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-flow',
    title: 'Empty',
    grounded: { graphId: 'empty' },
    nodes: [],
    edges: [],
  };
  const bounds = seqDiagramSheetBounds(doc);
  assert.strictEqual(bounds.width, SEQ_EMPTY_MIN_W);
  assert.strictEqual(bounds.height, SEQ_EMPTY_MIN_H);
  assert.ok(bounds.width >= 640);
  assert.ok(bounds.height >= 400);
});

test('seqDiagramLayout: sheet bounds match SVG viewBox', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-sequence',
    title: 'Three',
    grounded: { graphId: 't' },
    nodes: [
      { id: 'a', label: 'a', kind: 'service', role: 'participant' },
      { id: 'b', label: 'b', kind: 'service', role: 'participant' },
      { id: 'c', label: 'c', kind: 'service', role: 'participant' },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', family: 'http' }],
  };
  const bounds = seqDiagramSheetBounds(doc);
  const viewBox = viewBoxFromSvg(renderSeqDiagramSvg(doc));
  assert.ok(viewBox);
  assert.strictEqual(bounds.width, viewBox!.width);
  assert.strictEqual(bounds.height, viewBox!.height);
});

test('seqDiagramLayout: content bounds tighter than sheet when MIN_VIEW pads', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-flow',
    title: 'Single column',
    grounded: { graphId: 'narrow' },
    layout: { engine: 'layered-flow' },
    nodes: [{ id: 'a', label: 'a', kind: 'service', role: 'participant' }],
    edges: [],
  };
  const sheet = seqDiagramSheetBounds(doc);
  const content = seqDiagramContentBounds(doc);
  assert.ok(sheet.width >= SEQ_MIN_VIEW_W);
  assert.ok(sheet.height >= SEQ_MIN_VIEW_H);
  assert.ok(content.width < sheet.width);
  assert.ok(content.height < sheet.height);
});

test('seqDiagramLayout: positioned design node rects match render overrides', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-flow',
    title: 'Drawn',
    grounded: { graphId: 'draw', origin: 'design' },
    layout: { engine: 'layered-flow' },
    nodes: [
      { id: 'design:draw-1', label: 'Intake', kind: 'service', role: 'participant' },
      { id: 'svc:b', label: 'B', kind: 'service' },
    ],
    edges: [{ id: 'e1', from: 'design:draw-1', to: 'svc:b', family: 'http' }],
  };
  const overrides = { 'design:draw-1': { x: 220, y: 140 } };
  const layoutRects = seqDiagramNodeRects(doc, overrides);
  const renderRects = seqDiagramNodeRects(doc, overrides);
  const drawRect = layoutRects.find((r) => r.nodeId === 'design:draw-1');
  assert.ok(drawRect);
  assert.strictEqual(drawRect!.x, 220);
  assert.strictEqual(drawRect!.y, 140);
  assert.deepStrictEqual(
    layoutRects.find((r) => r.nodeId === 'design:draw-1'),
    renderRects.find((r) => r.nodeId === 'design:draw-1'),
  );
});

test('seqDiagramLayout: TD direction packs a chain vertically, not wide', () => {
  const doc: SeqDiagramV1 = {
    version: 1,
    kind: 'service-flow',
    title: 'Work depth',
    grounded: { graphId: 'work-td' },
    layout: { engine: 'layered-flow', direction: 'TD' },
    nodes: [
      { id: 'svc:a', label: 'A', kind: 'service', role: 'participant' },
      { id: 'svc:b', label: 'B', kind: 'service' },
      { id: 'svc:c', label: 'C', kind: 'service' },
    ],
    edges: [
      { id: 'e1', from: 'svc:a', to: 'svc:b', family: 'http' },
      { id: 'e2', from: 'svc:b', to: 'svc:c', family: 'http' },
    ],
  };
  const rects = seqDiagramNodeRects(doc);
  const a = rects.find((r) => r.nodeId === 'svc:a');
  const b = rects.find((r) => r.nodeId === 'svc:b');
  const c = rects.find((r) => r.nodeId === 'svc:c');
  assert.ok(a && b && c);
  // Later layers grow DOWN (owner: tree / top-to-bottom), not to the right.
  assert.ok(b!.y > a!.y, `expected b below a, got ${a!.y} -> ${b!.y}`);
  assert.ok(c!.y > b!.y, `expected c below b, got ${b!.y} -> ${c!.y}`);
  assert.ok(b!.x <= a!.x, `expected no rightward drift, got ${a!.x} -> ${b!.x}`);
  assert.ok(c!.x <= a!.x, `expected no rightward drift, got ${a!.x} -> ${c!.x}`);
});
