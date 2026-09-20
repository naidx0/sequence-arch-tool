import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeStroke, rdp, strokePath, type Point } from './index.js';

/* ---------------------------------------------------------------------------
 * Deterministic synthetic strokes. NO Math.random anywhere — every wobble comes
 * from a fixed integer/sinusoid pattern so a failing test is always reproducible.
 * ------------------------------------------------------------------------- */

/** Small, fixed, index-driven jitter in the range [-3, 3]. */
function wob(i: number): number {
  return ((i * 37) % 7) - 3;
}

/** Sample a straight segment a→b into `n` intermediate points with perpendicular
 *  jitter, so an edge of a hand-drawn shape is never geometrically perfect. */
function segment(a: Point, b: Point, n: number, jitter = true): Point[] {
  const out: Point[] = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // unit normal
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const j = jitter ? wob(i) : 0;
    out.push({ x: a.x + dx * t + nx * j, y: a.y + dy * t + ny * j });
  }
  return out;
}

function approx(actual: number, expected: number, tol: number, msg: string): void {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} not within ${tol} of ${expected}`);
}

/* ---------------------------------------------------------------------------- */

test('axis-aligned wobbly square → box with the right rect', () => {
  // A 200×200 box rooted at (100,100), traced badly with per-point jitter.
  const pts = [
    ...segment({ x: 100, y: 100 }, { x: 300, y: 100 }, 10),
    ...segment({ x: 300, y: 100 }, { x: 300, y: 300 }, 10),
    ...segment({ x: 300, y: 300 }, { x: 100, y: 300 }, 10),
    ...segment({ x: 100, y: 300 }, { x: 100, y: 100 }, 10),
  ];
  const r = recognizeStroke(pts);
  assert.equal(r.kind, 'box');
  if (r.kind !== 'box') return;
  approx(r.rect.x, 100, 8, 'rect.x');
  approx(r.rect.y, 100, 8, 'rect.y');
  approx(r.rect.width, 200, 12, 'rect.width');
  approx(r.rect.height, 200, 12, 'rect.height');
  assert.ok(r.confidence > 0.5, `confidence ${r.confidence} should be > 0.5`);
});

test('rotated square → box', () => {
  // A square (half-side 100) about (250,250), rotated 30°, traced with jitter.
  const theta = Math.PI / 6;
  const c = { x: 250, y: 250 };
  const s = 100;
  const corner = (sx: number, sy: number): Point => ({
    x: c.x + (sx * s * Math.cos(theta) - sy * s * Math.sin(theta)),
    y: c.y + (sx * s * Math.sin(theta) + sy * s * Math.cos(theta)),
  });
  const a = corner(-1, -1);
  const b = corner(1, -1);
  const d = corner(1, 1);
  const e = corner(-1, 1);
  const pts = [
    ...segment(a, b, 8),
    ...segment(b, d, 8),
    ...segment(d, e, 8),
    ...segment(e, a, 8),
  ];
  const r = recognizeStroke(pts);
  assert.equal(r.kind, 'box');
  if (r.kind !== 'box') return;
  assert.ok(r.confidence > 0, 'confidence should be positive');
});

test('closed rough ellipse → box', () => {
  // Parametric ellipse a=150,b=100 about (200,180), sampled + sinusoidal wobble.
  const pts: Point[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const wobble = 4 * Math.sin(t * 5); // deterministic radial ripple
    pts.push({
      x: 200 + (150 + wobble) * Math.cos(t),
      y: 180 + (100 + wobble) * Math.sin(t),
    });
  }
  const r = recognizeStroke(pts);
  assert.equal(r.kind, 'box');
  if (r.kind !== 'box') return;
  // bounding box of the ellipse ≈ x∈[46,354], y∈[76,284]
  approx(r.rect.width, 300, 20, 'ellipse bbox width');
  approx(r.rect.height, 200, 20, 'ellipse bbox height');
});

test('nearly-straight stroke with jitter → line with correct endpoints', () => {
  const startPt = { x: 100, y: 100 };
  const endPt = { x: 500, y: 140 };
  // Exact endpoints, jittered interior.
  const mid = segment(startPt, endPt, 20).slice(1);
  const pts = [startPt, ...mid, endPt];
  const r = recognizeStroke(pts);
  assert.equal(r.kind, 'line');
  if (r.kind !== 'line') return;
  assert.deepEqual(r.start, startPt);
  assert.deepEqual(r.end, endPt);
  assert.ok(r.confidence > 0.5, `confidence ${r.confidence} should be > 0.5`);
});

test('zigzag open stroke → scribble', () => {
  // Sharp sawtooth marching rightward: open, large chord deviation.
  const pts: Point[] = [];
  for (let i = 0; i <= 8; i++) {
    pts.push({ x: 100 + i * 50, y: 100 + (i % 2) * 160 });
  }
  const r = recognizeStroke(pts);
  assert.equal(r.kind, 'scribble');
});

test('5-point tiny stroke → scribble', () => {
  const pts: Point[] = [
    { x: 200, y: 200 },
    { x: 204, y: 202 },
    { x: 207, y: 206 },
    { x: 205, y: 209 },
    { x: 201, y: 207 },
  ];
  const r = recognizeStroke(pts);
  assert.equal(r.kind, 'scribble');
});

test('L-shaped open stroke → scribble (not line)', () => {
  // Down then right: a right-angle corner, endpoints far apart (open).
  const pts = [
    ...segment({ x: 100, y: 100 }, { x: 100, y: 300 }, 10, false),
    ...segment({ x: 100, y: 300 }, { x: 300, y: 300 }, 10, false),
    { x: 300, y: 300 },
  ];
  const r = recognizeStroke(pts);
  assert.equal(r.kind, 'scribble');
});

test('rdp preserves endpoints and drops collinear jitter', () => {
  const line: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0.2 },
    { x: 20, y: -0.1 },
    { x: 30, y: 0.15 },
    { x: 40, y: 0 },
  ];
  const out = rdp(line, 1);
  assert.deepEqual(out[0], { x: 0, y: 0 });
  assert.deepEqual(out[out.length - 1], { x: 40, y: 0 });
  assert.ok(out.length < line.length, 'collinear points should be simplified away');
});

test('empty and degenerate inputs are scribble, never throw', () => {
  assert.equal(recognizeStroke([]).kind, 'scribble');
  assert.equal(recognizeStroke([{ x: 1, y: 1 }]).kind, 'scribble');
  assert.equal(recognizeStroke([{ x: 1, y: 1 }, { x: 2, y: 2 }]).kind, 'scribble');
});

/* ---------------------------------------------------------------------------
 * strokePath — the LIVE smoothing (fluidity). Pure, deterministic, and it must
 * pass THROUGH every input point (a smoothing that drifts off the pen is worse
 * than the jagged polyline). It never feeds the recognizer, so these are purely
 * about the rendered curve.
 * ------------------------------------------------------------------------- */

test('strokePath: empty or single point yields no path', () => {
  assert.equal(strokePath([]), '');
  assert.equal(strokePath([{ x: 5, y: 5 }]), '');
});

test('strokePath: two points is a straight line segment through both', () => {
  const d = strokePath([{ x: 0, y: 0 }, { x: 10, y: 20 }]);
  assert.equal(d, 'M 0 0 L 10 20');
});

test('strokePath: 3+ points is a cubic spline that starts at the first point', () => {
  const d = strokePath([
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
  ]);
  assert.ok(d.startsWith('M 0 0'), 'path starts (moveto) at the first point');
  assert.ok(d.includes('C'), 'uses cubic bezier segments');
});

test('strokePath: the curve passes through every input point (no drift)', () => {
  const pts: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 12 },
    { x: 25, y: 4 },
    { x: 40, y: 18 },
  ];
  const d = strokePath(pts);
  // Each interior/final point is a bezier segment endpoint — the last three
  // coords of a `C ...` group. The final input point must terminate the path.
  assert.ok(d.trimEnd().endsWith('40 18'), 'ends exactly at the last input point');
  // Every non-first input point appears as a token-bounded segment endpoint (a
  // space-delimited coord pair), not merely as a coincidental substring of some
  // control-point coordinate.
  for (const p of pts.slice(1)) {
    const re = new RegExp(`(?:^| )${p.x} ${p.y}(?: |$)`);
    assert.ok(re.test(d), `curve reaches point ${p.x},${p.y}`);
  }
});

test('strokePath: deterministic — same points in, same string out', () => {
  const pts: Point[] = [
    { x: 1, y: 2 },
    { x: 3, y: 8 },
    { x: 9, y: 5 },
  ];
  assert.equal(strokePath(pts), strokePath(pts));
});

test('strokePath: near-duplicate points are de-duped, never throws', () => {
  const d = strokePath([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 30, y: 30 },
  ]);
  // After dedupe only two distinct points remain → straight segment.
  assert.equal(d, 'M 0 0 L 30 30');
});
