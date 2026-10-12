#!/usr/bin/env node
/*
 * Label every stroke of DiDi (Digital Ink Diagram data, Google, CC BY 4.0) with
 * what it draws, by geometry against the prompt diagram the person copied.
 *
 *   node tools/bench/ink-didi-label.mjs <drawings.ndjson> <xdotDir> <pngsize.json> <out.jsonl>
 *
 * Data: https://storage.googleapis.com/digital_ink_diagram_data/ (diagrams_20200131.ndjson,
 * xdot/<label_id>.xdot, png/<label_id>.png). People were shown a Graphviz flowchart and drew
 * it over the shown image, so the prompt's nodes and edges, mapped into the writing guide the
 * way the DiDi colab maps the PNG, sit under the ink.
 *
 * Labels (per stroke):
 *   rect | ellipse | diamond | parallelogram | octagon   one stroke drew the whole node outline
 *   part        one stroke drew a piece of a node outline (multi-stroke shape)
 *   text        the stroke sits inside a node and does not trace its outline (handwriting)
 *   arrow       one stroke drew a whole edge with its head
 *   line        one stroke drew a whole edge shaft without the head
 *   arrowhead   a short stroke at an edge's tip (the head drawn on its own)
 *   shaft-part  a piece of an edge shaft
 * Strokes no element claims, or two elements claim, are written with label null (dropped).
 *
 * This file only reads the drawings and the prompts; it never looks at a model.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const PARTIAL = new Set(['part', 'text', 'arrowhead', 'shaft-part']);
const SHAPE = { box: 'rect', oval: 'ellipse', ellipse: 'ellipse', diamond: 'diamond', parallelogram: 'parallelogram', octagon: 'octagon' };

/** Parse the xdot we need: bb, nodes (pos, width, height, shape) and edge splines. */
export function parseXdot(src) {
  const bb = /bb="([\d.]+),([\d.]+),([\d.]+),([\d.]+)"/.exec(src);
  const H = Number(bb[4]);
  const nodes = [];
  const edges = [];
  // Statements end at "];" — split on that, keep the head before "[".
  for (const stmt of src.split('];')) {
    const open = stmt.lastIndexOf('[');
    if (open < 0) continue;
    const head = stmt.slice(0, open).trim().split('\n').pop().trim();
    const body = stmt.slice(open + 1);
    const attr = (k) => {
      const m = new RegExp(`(?:^|[\\s,])${k}="?([^",\\]]*(?:,[^",\\]]*)*?)"?(?:,\\s*\\n|\\s*$|,\\s*[a-z_]+=)`, 'm').exec(body);
      return m ? m[1] : undefined;
    };
    if (head.includes('->')) {
      const pm = /pos="([^"]*)"/.exec(body);
      if (!pm) continue;
      const toks = pm[1].replace(/\\\n/g, '').trim().split(/\s+/);
      let tip = null;
      const pts = [];
      for (const t of toks) {
        if (t.startsWith('e,')) {
          const [x, y] = t.slice(2).split(',').map(Number);
          tip = { x, y };
        } else if (t.startsWith('s,')) {
          // start arrow: ignore (none in DiDi)
        } else {
          const [x, y] = t.split(',').map(Number);
          pts.push({ x, y });
        }
      }
      edges.push({ ctrl: pts, tip });
    } else if (/^"?\w+"?$/.test(head) && head !== 'graph' && head !== 'node' && head !== 'edge') {
      const pos = /pos="([\d.]+),([\d.]+)"/.exec(body);
      const w = /width=([\d.]+)/.exec(body);
      const h = /height=([\d.]+)/.exec(body);
      const sh = /shape=(\w+)/.exec(body);
      if (!pos || !w || !h || !sh) continue;
      void attr;
      nodes.push({
        cx: Number(pos[1]),
        cy: Number(pos[2]),
        w: Number(w[1]) * 72,
        h: Number(h[1]) * 72,
        shape: SHAPE[sh[1]] ?? sh[1],
      });
    }
  }
  return { W: Number(bb[3]), H, nodes, edges };
}

/* Each Graphviz shape's outline in its own half-size box, y down. The parallelogram's
   slant (0.4 of the half-width) was read off the rendered prompts. */
const BAND = 0.22;
const OUTLINES = {
  rect: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }],
  diamond: [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }],
  parallelogram: [{ x: -0.6, y: -1 }, { x: 1, y: -1 }, { x: 0.6, y: 1 }, { x: -1, y: 1 }],
  octagon: [
    { x: -0.6, y: -1 }, { x: 0.6, y: -1 }, { x: 1, y: -0.4 }, { x: 1, y: 0.4 },
    { x: 0.6, y: 1 }, { x: -0.6, y: 1 }, { x: -1, y: 0.4 }, { x: -1, y: -0.4 },
  ],
  ellipse: Array.from({ length: 32 }, (_, i) => ({ x: Math.cos((i / 32) * 2 * Math.PI), y: Math.sin((i / 32) * 2 * Math.PI) })),
};

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
}

/** Map the prompt into writing-guide coordinates (the DiDi colab's PNG placement). */
function placer(g, png, guide) {
  const [imw, imh] = png;
  const k = 96 / 72; // dot renders at 96 dpi with a 4-point pad
  const scale = Math.min(guide.width / imw, guide.height / imh);
  const ox = (guide.width - scale * imw) / 2;
  const oy = (guide.height - scale * imh) / 2;
  return {
    pt: (x, y) => ({ x: ox + scale * (x + 4) * k, y: oy + scale * (g.H - y + 4) * k }),
    len: (v) => v * scale * k,
  };
}

/** Label one drawing's strokes. Exported for the test. */
export function labelDrawing(ink, g, png) {
  const P = placer(g, png, ink.writing_guide);
  const nodes = g.nodes.map((n) => {
    const c = P.pt(n.cx, n.cy);
    return { ...n, gx: c.x, gy: c.y, gw: P.len(n.w), gh: P.len(n.h) };
  });
  const edges = g.edges.map((e) => {
    const ctrl = e.ctrl.map((p) => P.pt(p.x, p.y));
    const poly = [];
    for (let i = 0; i + 3 < ctrl.length + 0 && i + 3 <= ctrl.length - 1; i += 3) {
      for (let s = 0; s < 12; s++) poly.push(bezier(ctrl[i], ctrl[i + 1], ctrl[i + 2], ctrl[i + 3], s / 12));
    }
    poly.push(ctrl[ctrl.length - 1]);
    const tip = e.tip ? P.pt(e.tip.x, e.tip.y) : poly[poly.length - 1];
    poly.push(tip);
    let len = 0;
    const cum = [0];
    for (let i = 1; i < poly.length; i++) {
      len += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
      cum.push(len);
    }
    return { poly, cum, len, tip, head: P.len(10) };
  });

  return ink.drawing.map((s) => {
    const pts = s[0].map((x, i) => ({ x, y: s[1][i] }));
    const claims = [];
    for (const [ni, n] of nodes.entries()) {
      const hw = n.gw / 2;
      const hh = n.gh / 2;
      if (hw <= 0 || hh <= 0) continue;
      const outline = OUTLINES[n.shape] ?? OUTLINES.rect;
      let ring = 0;
      let inside = 0;
      const bins = new Set();
      for (const p of pts) {
        const dx = (p.x - n.gx) / hw;
        const dy = (p.y - n.gy) / hh;
        // Distance to the node's own outline, in half-size units (y down, as on screen).
        let d = Infinity;
        for (let i = 0; i < outline.length; i++) {
          d = Math.min(d, segDist({ x: dx, y: dy }, outline[i], outline[(i + 1) % outline.length]).d);
        }
        if (d <= BAND) {
          ring++;
          bins.add(Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 24) % 24);
        } else if (pointInPoly(dx, dy, outline)) inside++;
      }
      const ringFrac = ring / pts.length;
      const cover = bins.size / 24;
      const insideFrac = inside / pts.length;
      if (ringFrac >= 0.8 && cover >= 0.8) claims.push({ label: n.shape, score: ringFrac + cover, elem: `n${ni}` });
      else if (ringFrac >= 0.8 && cover >= 0.08 && cover < 0.8) claims.push({ label: 'part', score: ringFrac, elem: `n${ni}`, nodeShape: n.shape });
      else if (insideFrac >= 0.9 && cover < 0.5) claims.push({ label: 'text', score: insideFrac, elem: `n${ni}` });
    }
    for (const [ei, e] of edges.entries()) {
      const tol = Math.max(14, e.head * 1.2);
      let near = 0;
      const lbins = new Set();
      let headOff = 0;
      let nearTip = 0;
      const last = e.poly[e.poly.length - 2];
      for (const p of pts) {
        let best = { d: Infinity, s: 0 };
        for (let i = 1; i < e.poly.length; i++) {
          const r = segDist(p, e.poly[i - 1], e.poly[i]);
          if (r.d < best.d) best = { d: r.d, s: e.cum[i - 1] + r.t * (e.cum[i] - e.cum[i - 1]) };
        }
        if (best.d <= tol) {
          near++;
          lbins.add(Math.min(9, Math.floor((best.s / Math.max(e.len, 1e-6)) * 10)));
        }
        const dt = Math.hypot(p.x - e.tip.x, p.y - e.tip.y);
        if (dt <= e.head * 2.2) {
          nearTip++;
          // off the shaft's final direction = a head barb
          if (segDist(p, last, e.tip).d > e.head * 0.25) headOff++;
        }
      }
      const nearFrac = near / pts.length;
      const cover = lbins.size / 10;
      if (nearFrac >= 0.85 && cover >= 0.7) {
        claims.push({ label: headOff >= 2 ? 'arrow' : 'line', score: nearFrac + cover, elem: `e${ei}` });
      } else if (nearTip / pts.length >= 0.85) {
        claims.push({ label: 'arrowhead', score: 1, elem: `e${ei}` });
      } else if (nearFrac >= 0.85 && cover >= 0.2) {
        claims.push({ label: 'shaft-part', score: nearFrac, elem: `e${ei}` });
      }
    }
    let label = null;
    let elem = null;
    let nodeShape = null;
    if (claims.length === 1) {
      label = claims[0].label;
      elem = claims[0].elem;
      nodeShape = claims[0].nodeShape ?? null;
    }
    else if (claims.length > 1) {
      const kinds = new Set(claims.map((c) => c.label));
      if (kinds.size === 1) {
        label = claims[0].label;
        elem = claims[0].elem;
        nodeShape = claims[0].nodeShape ?? null;
      } // e.g. text inside two touching nodes: same answer
      else {
        // One element traced WHOLE beats pieces of others: an arrow that runs into a
        // node's outline band is still the arrow.
        const whole = claims.filter((c) => !PARTIAL.has(c.label));
        if (whole.length === 1) {
          label = whole[0].label;
          elem = whole[0].elem;
        }
      }
    }
    return { label, elem, nodeShape, x: s[0], y: s[1], t: s[2] };
  });
}

async function main() {
  const [, , ndjsonPath, xdotDir, pngSizePath, outPath] = process.argv;
  if (!outPath) {
    console.error('usage: ink-didi-label.mjs <drawings.ndjson> <xdotDir> <pngsize.json> <out.jsonl>');
    process.exit(2);
  }
  const pngSize = JSON.parse(fs.readFileSync(pngSizePath, 'utf8'));
  const out = fs.createWriteStream(outPath);
  const rl = readline.createInterface({ input: fs.createReadStream(ndjsonPath) });
  const counts = {};
  let drawings = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const ink = JSON.parse(line);
    const xf = path.join(xdotDir, `${ink.label_id}.xdot`);
    if (!fs.existsSync(xf) || !pngSize[ink.label_id]) continue;
    const g = parseXdot(fs.readFileSync(xf, 'utf8'));
    const labelled = labelDrawing(ink, g, pngSize[ink.label_id]);
    drawings++;
    labelled.forEach((s, i) => {
      const k = `${ink.split}:${s.label}`;
      counts[k] = (counts[k] ?? 0) + 1;
      out.write(
        JSON.stringify({ key: ink.key, split: ink.split, label_id: ink.label_id, i, label: s.label, elem: s.elem, nodeShape: s.nodeShape, x: s.x, y: s.y, t: s.t }) + '\n',
      );
    });
  }
  out.end();
  console.log(JSON.stringify({ drawings, counts }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
