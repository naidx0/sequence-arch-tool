import assert from 'node:assert';
import { test } from 'node:test';
import { structuralTheme } from './structuralTheme.js';

test('structuralTheme: steel scale literals match the v1 Structural brand book', () => {
  const t = structuralTheme();
  assert.strictEqual(t.canvas, '#121517');
  assert.strictEqual(t.panelFill, '#191D20');
  assert.strictEqual(t.nodeFill, '#21262A');
  assert.strictEqual(t.nodeBorder, '#2E3439');
  assert.strictEqual(t.frameStroke, '#2E3439');
  assert.strictEqual(t.text, '#EEF1F3');
  assert.strictEqual(t.muted, '#98A2AA');
  assert.strictEqual(t.lineSoft, '#262B2F');
  assert.strictEqual(t.lineDim, '#6B747C');
});

test('structuralTheme: signal accent literals match the v1 Structural brand book', () => {
  const t = structuralTheme();
  assert.strictEqual(t.accent, '#F25C05');
  assert.strictEqual(t.accentText, '#FF8A3D');
});

test('structuralTheme: edge hues match app meaning-locked tokens (styles.css)', () => {
  const t = structuralTheme();
  assert.strictEqual(t.edge.http, '#5aa9ff');
  assert.strictEqual(t.edge.grpc, '#a78bfa');
  assert.strictEqual(t.edge.queue, '#ffd426');
  assert.strictEqual(t.edge.db, '#30d158');
  assert.notStrictEqual(t.edge.http, t.accent);
  assert.notStrictEqual(t.edge.grpc, t.accent);
  assert.notStrictEqual(t.edge.queue, t.accent);
  assert.notStrictEqual(t.edge.db, t.accent);
});
