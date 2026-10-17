import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recognizeShape } from './shapeModel.js';
import { GROUP_IDLE_MS, GROUP_MAX_GAP, decideGroup, decidesAtOnce, joinsPending, runGapFrac, settleStrokes, type GroupStroke, type GroupVerdict } from './shapeGroup.js';
import { mouseStroke, outlines } from './mouseSim.js';
import type { P } from './shapeFeatures.js';

const rec = (pts: readonly P[], o: Parameters<typeof recognizeShape>[1]) => recognizeShape(pts, o);

/** Strokes from separate outlines, one after another, `gap` ms apart. */
function strokesFrom(parts: P[][], opts: { px?: number; jitter?: number; gap?: number; seed?: number; start?: number } = {}): GroupStroke[] {
  let clock = opts.start ?? 0;
  return parts.map((outline, i) => {
    const pts = mouseStroke(outline, { pxPerSample: opts.px ?? 8, jitter: opts.jitter ?? 0.6, seed: (opts.seed ?? 1) + i * 7 }, clock);
    const t1 = clock + (pts[pts.length - 1]?.t ?? 0);
    const s = { id: i + (opts.start ? 100 : 0), points: pts, t0: clock, t1 };
    clock = t1 + (opts.gap ?? 250);
    return s;
  });
}

const sidesOf = (x: number, y: number, w: number, h: number): P[][] => [
  [{ x, y }, { x: x + w, y }],
  [{ x: x + w, y }, { x: x + w, y: y + h }],
  [{ x: x + w, y: y + h }, { x, y: y + h }],
  [{ x, y: y + h }, { x, y }],
];

const decisions = (v: GroupVerdict[]) => v.map((x) => `${x.decision}:${x.ids.length}`);

test('a box drawn as four sides is ONE rect, not four lines', () => {
  const strokes = strokesFrom(sidesOf(100, 100, 220, 140));
  // Judged one at a time a side is only a side: never a box.
  const alone = settleStrokes(strokes, rec, { maxRun: 1 });
  assert.ok(!alone.some((v) => v.decision === 'rect'), `each side alone: ${decisions(alone)}`);
  const grouped = settleStrokes(strokes, rec);
  assert.deepEqual(decisions(grouped), ['rect:4']);
  const v = grouped[0]!;
  assert.ok(Math.abs(v.from!.x - 100) < 12 && Math.abs(v.to!.x - 320) < 12 && Math.abs(v.to!.y - 240) < 12);
});

test('two strokes make a box (an L and an L), and two halves make an ellipse', () => {
  const l1: P[] = [{ x: 400, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 260 }];
  const l2: P[] = [{ x: 100, y: 260 }, { x: 400, y: 260 }, { x: 400, y: 100 }];
  assert.deepEqual(decisions(settleStrokes(strokesFrom([l1, l2]), rec)), ['rect:2']);
  const e = outlines.ellipse(300, 200, 150, 90, 60);
  assert.deepEqual(decisions(settleStrokes(strokesFrom([e.slice(0, 31), e.slice(30)]), rec)), ['ellipse:2']);
});

test('a diamond in four strokes is one diamond', () => {
  const d = outlines.diamond(300, 200, 150, 100);
  const sides = [d.slice(0, 2), d.slice(1, 3), d.slice(2, 4), d.slice(3, 5)];
  assert.deepEqual(decisions(settleStrokes(strokesFrom(sides), rec)), ['diamond:4']);
});

test('strokes drawn far apart in time are not one shape', () => {
  const sides = sidesOf(100, 100, 220, 140);
  const strokes = strokesFrom(sides, { gap: GROUP_IDLE_MS + 400 });
  assert.ok(!settleStrokes(strokes, rec).some((v) => v.decision === 'rect'));
});

test('two boxes side by side stay two boxes', () => {
  const a = strokesFrom([outlines.rect(100, 100, 150, 90)]);
  const b = strokesFrom([outlines.rect(600, 100, 150, 90)], { start: a[0]!.t1 + 300 });
  assert.deepEqual(decisions(settleStrokes([...a, ...b], rec)), ['rect:1', 'rect:1']);
});

test('joinsPending needs both a short rest and a nearby stroke', () => {
  const [a] = strokesFrom([outlines.rect(100, 100, 100, 100)]);
  const near = { id: 9, points: [{ x: 210, y: 150 }, { x: 260, y: 150 }], t0: a!.t1 + 200, t1: a!.t1 + 400 };
  const far = { ...near, points: [{ x: 1500, y: 900 }, { x: 1550, y: 900 }] };
  const late = { ...near, t0: a!.t1 + GROUP_IDLE_MS + 1 };
  assert.equal(joinsPending([a!], near), true);
  assert.equal(joinsPending([a!], far), false);
  assert.equal(joinsPending([a!], late), false);
  assert.equal(joinsPending([], near), false);
});

test('a lone closed shape is decided at once; a bare line waits for company', () => {
  const [box] = strokesFrom([outlines.rect(100, 100, 220, 140)]);
  const [side] = strokesFrom([outlines.line(100, 100, 320, 100)]);
  assert.equal(decidesAtOnce([box!], { recognize: rec }), true);
  assert.equal(decidesAtOnce([side!], { recognize: rec }), false);
});

/* HANDWRITING NEVER JOINS. A word's letters, side by side, are many small strokes close together in time,
   which is exactly what a box's sides look like to a careless grouper. */
function word(x: number, y: number, letters: number, seed: number): P[][] {
  const out: P[][] = [];
  for (let i = 0; i < letters; i++) {
    const lx = x + i * 17;
    out.push(
      i % 3 === 0
        ? outlines.ellipse(lx + 6, y + 8, 6, 8, 16)
        : i % 3 === 1
          ? [{ x: lx, y }, { x: lx + 1, y: y + 18 }]
          : [{ x: lx, y: y + 16 }, { x: lx + 4, y }, { x: lx + 8, y: y + 16 }, { x: lx + 12, y }],
    );
  }
  void seed;
  return out;
}

test('handwriting beside a box stays ink', () => {
  const box = strokesFrom([outlines.rect(100, 100, 300, 160)], { px: 8 });
  const text = strokesFrom(word(150, 160, 7, 3), { px: 2.5, jitter: 0.4, gap: 120, start: box[0]!.t1 + 500 });
  const verdicts = settleStrokes([...box, ...text], rec);
  const snapped = verdicts.filter((v) => v.decision !== 'ink');
  assert.deepEqual(decisions(snapped), ['rect:1'], `only the box snaps: ${decisions(verdicts)}`);
});

test('handwriting alone, on an empty board, stays ink', () => {
  const text = strokesFrom(word(100, 100, 9, 5), { px: 2.5, jitter: 0.4, gap: 100 });
  const verdicts = settleStrokes(text, rec);
  assert.deepEqual(verdicts.filter((v) => v.decision !== 'ink'), [], decisions(verdicts).join(" "));
});

test('decideGroup returns every stroke exactly once, in draw order', () => {
  const strokes = strokesFrom([...sidesOf(100, 100, 220, 140), outlines.line(500, 100, 700, 100)]);
  const v = decideGroup(strokes, { recognize: rec });
  assert.deepEqual(v.flatMap((x) => x.ids).sort(), strokes.map((s) => s.id).sort());
});

/* ── A MOUSE OR A TRACKPAD, NOT A PEN ────────────────────────────────────── */
const MOUSE_HANDS = [
  { name: 'slow steady mouse', px: 3, jitter: 0.4 },
  { name: 'normal mouse', px: 9, jitter: 0.7 },
  { name: 'fast mouse', px: 22, jitter: 0.7 },
  { name: 'flick', px: 38, jitter: 1 },
  { name: 'trackpad', px: 7, jitter: 1.6 },
];
const SHAPES = [
  { want: 'rect', draw: (k: number) => outlines.rect(100, 100, 120 + 60 * k, 80 + 40 * k) },
  { want: 'ellipse', draw: (k: number) => outlines.ellipse(300, 200, 70 + 35 * k, 45 + 25 * k) },
  { want: 'diamond', draw: (k: number) => outlines.diamond(300, 200, 80 + 40 * k, 55 + 25 * k) },
];

test('a mouse or trackpad stroke is read like a pen stroke: shapes snap, at every speed', () => {
  let total = 0;
  let right = 0;
  let wrongSnap = 0;
  const misses: string[] = [];
  for (const hand of MOUSE_HANDS) {
    for (const shape of SHAPES) {
      for (let k = 0; k < 4; k++) {
        const pts = mouseStroke(shape.draw(k), { pxPerSample: hand.px, jitter: hand.jitter, seed: 11 + k * 5, drawn: 0.97 + 0.02 * k });
        const r = recognizeShape(pts, {});
        total++;
        if (r.decision === shape.want) right++;
        else {
          if (r.decision !== 'ink') wrongSnap++;
          misses.push(`${hand.name} ${shape.want}#${k} -> ${r.decision} ${r.confidence.toFixed(2)}`);
        }
      }
    }
  }
  assert.ok(right / total >= 0.85, `recall ${right}/${total}; misses: ${misses.join('; ')}`);
  assert.ok(wrongSnap / total <= 0.05, `wrong snaps ${wrongSnap}/${total}; ${misses.join('; ')}`);
});

test('a mouse arrow is a connector from the tail to the tip', () => {
  for (const hand of MOUSE_HANDS) {
    const pts = mouseStroke(outlines.arrow(100, 300, 420, 180), { pxPerSample: hand.px, jitter: hand.jitter, seed: 3 });
    const r = recognizeShape(pts, {});
    assert.equal(r.decision, 'connector', `${hand.name}: ${r.decision} ${r.confidence.toFixed(2)}`);
    assert.ok(Math.hypot(r.to!.x - 420, r.to!.y - 180) < 30, `${hand.name}: tip at ${r.to!.x},${r.to!.y}`);
    assert.ok(Math.hypot(r.from!.x - 100, r.from!.y - 300) < 30);
  }
});

test('a mouse scribble or a mouse-written letter stays ink', () => {
  const zig: P[] = Array.from({ length: 14 }, (_, i) => ({ x: 100 + i * 14, y: 100 + (i % 2) * 30 }));
  for (const hand of MOUSE_HANDS) {
    const scribble = recognizeShape(mouseStroke(zig, { pxPerSample: hand.px, jitter: hand.jitter, seed: 5 }), {});
    assert.equal(scribble.decision, 'ink', `${hand.name} scribble`);
    const o = recognizeShape(mouseStroke(outlines.ellipse(300, 300, 9, 12, 20), { pxPerSample: Math.min(hand.px, 4), jitter: 0.5, seed: 9 }), { boardDiag: 22 });
    assert.equal(o.decision, 'ink', `${hand.name} letter o beside other writing`);
  }
});

test('the same box drawn faster or slower, or at another zoom, reads the same', () => {
  const read = (px: number, scale: number) =>
    recognizeShape(
      mouseStroke(outlines.rect(100 * scale, 100 * scale, 200 * scale, 130 * scale), { pxPerSample: px * scale, jitter: 0.6, seed: 4 }),
      { boardDiag: 40 * scale },
    ).decision;
  for (const px of [3, 10, 30]) for (const scale of [0.5, 1, 3]) assert.equal(read(px, scale), 'rect', `px ${px} scale ${scale}`);
});

test('two boxes drawn one above the other, each in two strokes, never share a stroke', () => {
  const ls = (x: number, y: number, w: number, h: number): P[][] => [
    [{ x: x + w, y }, { x, y }, { x, y: y + h }],
    [{ x, y: y + h }, { x: x + w, y: y + h }, { x: x + w, y }],
  ];
  const strokes = strokesFrom([...ls(100, 100, 150, 90), ...ls(100, 250, 150, 90)], { gap: 200 });
  const v = settleStrokes(strokes, rec);
  for (const x of v) {
    const top = x.ids.filter((id) => Number(id) < 2).length;
    assert.ok(top === 0 || top === x.ids.length, `one verdict mixes both boxes: ${decisions(v)} ${JSON.stringify(v.map((y) => y.ids))}`);
  }
  assert.deepEqual(decisions(v), ['rect:2', 'rect:2']);
});

test('runGapFrac: the sides of one box meet, two separate shapes need a jump', () => {
  const box = strokesFrom(sidesOf(100, 100, 220, 140));
  assert.ok(runGapFrac(box) < GROUP_MAX_GAP, String(runGapFrac(box)));
  const apart = strokesFrom([...sidesOf(100, 100, 150, 90).slice(2), ...sidesOf(100, 250, 150, 90).slice(0, 2)]);
  assert.ok(runGapFrac(apart) > GROUP_MAX_GAP, String(runGapFrac(apart)));
});
