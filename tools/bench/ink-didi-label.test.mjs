// node --test tools/bench/ink-didi-label.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXdot, labelDrawing } from './ink-didi-label.mjs';

const XDOT = `digraph G {
	graph [bb="0,0,293.94,36",
		rankdir=LR
	];
	node [label="\\N"];
	0	 [height=0.5,
		label="  lime  ",
		pos="39.396,18",
		shape=octagon,
		width=1.0943];
	1	 [height=0.5,
		label="  dark brown  ",
		pos="204.37,18",
		shape=parallelogram,
		width=2.4882];
	0 -> 1	 [pos="e,132.78,18 79.018,18 92.095,18 107.23,18 122.35,18"];
}`;

// png 403x59 drawn into a 403x59 guide: scale 1, so guide = (x+4)*4/3, (36-y+4)*4/3.
const g = (x, y) => [((x + 4) * 4) / 3, ((36 - y + 4) * 4) / 3];
function stroke(pts) {
  return [pts.map((p) => p[0]), pts.map((p) => p[1]), pts.map((_, i) => i)];
}
function trace(vertices, per = 10) {
  const out = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const [a, b] = [vertices[i], vertices[i + 1]];
    for (let k = 0; k < per; k++) out.push([a[0] + ((b[0] - a[0]) * k) / per, a[1] + ((b[1] - a[1]) * k) / per]);
  }
  out.push(vertices[vertices.length - 1]);
  return out;
}

test('parseXdot reads nodes, shapes and the edge spline with its tip', () => {
  const x = parseXdot(XDOT);
  assert.equal(x.nodes.length, 2);
  assert.deepEqual(x.nodes.map((n) => n.shape), ['octagon', 'parallelogram']);
  assert.ok(Math.abs(x.nodes[0].w - 1.0943 * 72) < 1e-6);
  assert.equal(x.edges.length, 1);
  assert.deepEqual(x.edges[0].tip, { x: 132.78, y: 18 });
  assert.equal(x.edges[0].ctrl.length, 4);
});

test('labelDrawing: a whole outline, handwriting inside it, an arrow, a stray mark', () => {
  const x = parseXdot(XDOT);
  const [cx, cy] = g(39.396, 18);
  const hw = ((1.0943 * 72) / 2) * (4 / 3);
  const hh = (36 / 2) * (4 / 3);
  const oct = [[-0.6, -1], [0.6, -1], [1, -0.4], [1, 0.4], [0.6, 1], [-0.6, 1], [-1, 0.4], [-1, -0.4], [-0.6, -1]].map(([u, v]) => [cx + u * hw, cy + v * hh]);
  const text = trace([[cx - 8, cy - 4], [cx - 4, cy + 4], [cx, cy - 4], [cx + 4, cy + 4]], 4);
  const [sx, sy] = g(79.018, 18);
  const [tx, ty] = g(132.78, 18);
  const head = 13;
  const arrow = trace([[sx, sy], [tx, ty], [tx - head, ty - head * 0.6], [tx, ty], [tx - head, ty + head * 0.6]]);
  const stray = trace([[120, 57], [135, 58]], 5);
  const ink = { writing_guide: { width: 403, height: 59 }, drawing: [stroke(trace(oct)), stroke(text), stroke(arrow), stroke(stray)] };
  const labels = labelDrawing(ink, x, [403, 59]).map((s) => s.label);
  assert.deepEqual(labels, ['octagon', 'text', 'arrow', null]);
});
