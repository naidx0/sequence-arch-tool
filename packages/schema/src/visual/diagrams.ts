/* ══════════════════════════════════════════════════════════════════════════
   THE VISUAL KIT: DIAGRAMS
   packages/schema/src/visual/diagrams.ts

   flow      boxes and arrows with automatic layered layout (cycles, long edges)
   sequence  actors, lifelines, messages
   loadpath  a request path with per-hop load, latency and utilisation
   timeline  gantt rows and milestones on a date or number axis
   ══════════════════════════════════════════════════════════════════════════ */

import { arr, bool, num, obj, oneOf, opt, run, str, strOrNum, type Problems } from './check.js';
import { header } from './charts.js';
import type { Component } from './types.js';
import { C, HAIR, MAX_H, SOFT, TINT, arrowDefs, clamp, el, fit, fmt, line1, g, n, niceTicks, series, text, textW, utilColor, utilFill, withUnit, type Frag } from './util.js';

const W = opt(num({ min: 280, max: 1200, int: true }));

/* ───────────────────────────── flow ───────────────────────────── */

const flowCheck = obj({
  title: opt(str({ max: 90 })),
  direction: opt(oneOf('LR', 'TB')),
  nodes: arr(obj({ id: str({ max: 40 }), label: opt(str({ max: 60 })), sub: opt(str({ max: 60 })), kind: opt(oneOf('service', 'db', 'queue', 'user', 'external')), group: opt(str({ max: 30 })) }), { min: 1, max: 40 }),
  edges: arr(obj({ from: str({ max: 40 }), to: str({ max: 40 }), label: opt(str({ max: 40 })) }), { max: 80 }),
  width: W,
});
export type FlowSpec = ReturnType<typeof flowCheck>;

function flowProblems(s: FlowSpec, p: Problems): void {
  const ids = new Set<string>();
  s.nodes.forEach((nd, i) => {
    if (ids.has(nd.id)) p.add(`spec.nodes[${i}].id: "${nd.id}" is used twice`);
    ids.add(nd.id);
  });
  const seen = new Set<string>();
  s.edges.forEach((e, i) => {
    for (const end of ['from', 'to'] as const) {
      if (!ids.has(e[end])) p.add(`spec.edges[${i}].${end}: no node with id "${e[end]}" (nodes: ${[...ids].slice(0, 8).join(', ')}${ids.size > 8 ? ', ...' : ''})`);
    }
    if (e.from === e.to) p.add(`spec.edges[${i}]: "${e.from}" points at itself`);
    const k = `${e.from}>${e.to}`;
    if (seen.has(k)) p.add(`spec.edges[${i}]: ${e.from} -> ${e.to} is listed twice; put both labels in one edge`);
    seen.add(k);
  });
}

interface LNode {
  real: boolean;
  /** Size along the layering axis and across it. */
  m: number;
  c: number;
  layer: number;
  /** Position along the layering axis / across it (centre). */
  pm: number;
  pc: number;
  w: number;
  h: number;
}
interface Chain {
  edge: number;
  nodes: number[];
  reversed: boolean;
}

/** The most steps a flow runs left to right before it turns top down (a 6-step chain is a column, not a strip). */
export const FLOW_MAX_ACROSS = 3;

/** Room in a layer gap: a lead out of the source, one 8 px track per source that turns there, and a leg into the target long enough for its label. */
const LEAD = 12;
const TRACK = 8;

/** Layered layout (orthogonal routing channels between layers). Exported for tests (positions are deterministic). */
export function layoutFlow(s: FlowSpec): { nodes: LNode[]; chains: Chain[]; width: number; height: number; direction: 'LR' | 'TB'; gapStart: number[]; track: Map<string, number> } {
  const dir = s.direction ?? 'LR';
  const idx = new Map(s.nodes.map((nd, i) => [nd.id, i]));
  const N = s.nodes.length;
  /* sizes: one line of label (and one of sub) */
  const nodes: LNode[] = s.nodes.map((nd) => {
    const label = nd.label ?? nd.id;
    const w = clamp(Math.max(textW(label, 12.5, true), nd.sub ? textW(nd.sub, 11) : 0) + 26, 84, 200);
    const h = nd.sub ? 46 : 34;
    return { real: true, w, h, m: dir === 'LR' ? w : h, c: dir === 'LR' ? h : w, layer: 0, pm: 0, pc: 0 };
  });
  /* cycle breaking: DFS in input order, an edge into the stack is a back edge */
  const out: number[][] = Array.from({ length: N }, () => []);
  s.edges.forEach((e, i) => out[idx.get(e.from)!]!.push(i));
  const state = new Array<number>(N).fill(0);
  const back = new Set<number>();
  for (let r = 0; r < N; r += 1) {
    if (state[r]) continue;
    const stack: [number, number][] = [[r, 0]];
    state[r] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const list = out[top[0]]!;
      if (top[1] >= list.length) {
        state[top[0]] = 2;
        stack.pop();
        continue;
      }
      const ei = list[top[1]++]!;
      const v = idx.get(s.edges[ei]!.to)!;
      if (state[v] === 1) back.add(ei);
      else if (state[v] === 0) {
        state[v] = 1;
        stack.push([v, 0]);
      }
    }
  }
  /* layering edges (low layer -> high layer) */
  const le = s.edges.map((e, i) => (back.has(i) ? { a: idx.get(e.to)!, b: idx.get(e.from)!, i } : { a: idx.get(e.from)!, b: idx.get(e.to)!, i }));
  const indeg = new Array<number>(N).fill(0);
  const adj: number[][] = Array.from({ length: N }, () => []);
  for (const e of le) {
    adj[e.a]!.push(e.b);
    indeg[e.b]! += 1;
  }
  const queue = [...Array(N).keys()].filter((i) => indeg[i] === 0);
  for (let qi = 0; qi < queue.length; qi += 1) {
    const u = queue[qi]!;
    for (const v of adj[u]!) {
      nodes[v]!.layer = Math.max(nodes[v]!.layer, nodes[u]!.layer + 1);
      indeg[v]! -= 1;
      if (indeg[v] === 0) queue.push(v);
    }
  }
  /* dummies for long edges */
  const chains: Chain[] = [];
  for (const e of le) {
    const chain = [e.a];
    for (let l = nodes[e.a]!.layer + 1; l < nodes[e.b]!.layer; l += 1) {
      nodes.push({ real: false, w: 0, h: 0, m: 0, c: 10, layer: l, pm: 0, pc: 0 });
      chain.push(nodes.length - 1);
    }
    chain.push(e.b);
    chains.push({ edge: e.i, nodes: chain, reversed: back.has(e.i) });
  }
  /* left to right, a box that several labelled edges enter grows tall enough to space their legs 18 px apart (a label each) */
  if (dir === 'LR') {
    const into = new Array<number>(N).fill(0);
    for (const ch of chains) if (s.edges[ch.edge]!.label) into[ch.nodes[ch.nodes.length - 1]!]! += 1;
    into.forEach((k, v) => {
      if (k < 2) return;
      nodes[v]!.h = Math.max(nodes[v]!.h, k * 18 + 6);
      nodes[v]!.c = nodes[v]!.h;
    });
  }
  const L = Math.max(...nodes.map((x) => x.layer)) + 1;
  const layers: number[][] = Array.from({ length: L }, () => []);
  nodes.forEach((x, i) => layers[x.layer]!.push(i));
  const up: number[][] = nodes.map(() => []);
  const down: number[][] = nodes.map(() => []);
  for (const ch of chains) {
    for (let k = 0; k + 1 < ch.nodes.length; k += 1) {
      down[ch.nodes[k]!]!.push(ch.nodes[k + 1]!);
      up[ch.nodes[k + 1]!]!.push(ch.nodes[k]!);
    }
  }
  /* crossing reduction: barycentre sweeps */
  const order = nodes.map(() => 0);
  layers.forEach((ly) => ly.forEach((v, i) => (order[v] = i)));
  for (let it = 0; it < 6; it += 1) {
    const downward = it % 2 === 0;
    const range = downward ? [...Array(L).keys()].slice(1) : [...Array(L).keys()].slice(0, -1).reverse();
    for (const l of range) {
      const nb = downward ? up : down;
      const bary = new Map<number, number>();
      for (const v of layers[l]!) {
        const ns = nb[v]!;
        bary.set(v, ns.length ? ns.reduce((a, u) => a + order[u]!, 0) / ns.length : order[v]!);
      }
      layers[l]!.sort((a, b) => bary.get(a)! - bary.get(b)! || order[a]! - order[b]!);
      layers[l]!.forEach((v, i) => (order[v] = i));
    }
  }
  /* cross axis: stack, then relax toward neighbours */
  const gapC = dir === 'LR' ? 22 : 24;
  layers.forEach((ly) => {
    let y = 0;
    for (const v of ly) {
      const x = nodes[v]!;
      x.pc = y + x.c / 2;
      y += x.c + (x.real ? gapC : 12);
    }
  });
  const sep = (a: number, b: number): number => (nodes[a]!.c + nodes[b]!.c) / 2 + (nodes[a]!.real && nodes[b]!.real ? gapC : 12);
  for (let it = 0; it < 10; it += 1) {
    const downward = it % 2 === 0;
    const range = downward ? [...Array(L).keys()] : [...Array(L).keys()].reverse();
    for (const l of range) {
      const ly = layers[l]!;
      const want = ly.map((v) => {
        const ns = [...up[v]!, ...down[v]!];
        const use = (downward ? up[v]! : down[v]!).length ? (downward ? up[v]! : down[v]!) : ns;
        return use.length ? use.reduce((a, u) => a + nodes[u]!.pc, 0) / use.length : nodes[v]!.pc;
      });
      const fwd = want.slice();
      for (let i = 1; i < ly.length; i += 1) fwd[i] = Math.max(fwd[i]!, fwd[i - 1]! + sep(ly[i - 1]!, ly[i]!));
      const bwd = want.slice();
      for (let i = ly.length - 2; i >= 0; i -= 1) bwd[i] = Math.min(bwd[i]!, bwd[i + 1]! - sep(ly[i]!, ly[i + 1]!));
      ly.forEach((v, i) => (nodes[v]!.pc = (fwd[i]! + bwd[i]!) / 2));
      for (let i = 1; i < ly.length; i += 1) nodes[ly[i]!]!.pc = Math.max(nodes[ly[i]!]!.pc, nodes[ly[i - 1]!]!.pc + sep(ly[i - 1]!, ly[i]!));
    }
  }
  /* snap a node onto its only neighbour's line when there is room, so single links are straight */
  for (let l = 0; l < L; l += 1) {
    const ly = layers[l]!;
    ly.forEach((v, i) => {
      const nb = [...up[v]!, ...down[v]!];
      if (nb.length !== 1) return;
      const want = nodes[nb[0]!]!.pc;
      const lo = i > 0 ? nodes[ly[i - 1]!]!.pc + sep(ly[i - 1]!, v) : -Infinity;
      const hi = i + 1 < ly.length ? nodes[ly[i + 1]!]!.pc - sep(v, ly[i + 1]!) : Infinity;
      if (want >= lo && want <= hi) nodes[v]!.pc = want;
    });
  }
  /* tracks: in each gap, one per source node with a segment that has to turn */
  const track = new Map<string, number>();
  const tracksIn = new Array<number>(L).fill(0);
  for (let l = 0; l + 1 < L; l += 1) {
    const srcs = new Set<number>();
    for (const ch of chains) {
      for (let k = 0; k + 1 < ch.nodes.length; k += 1) {
        const a = ch.nodes[k]!;
        const b = ch.nodes[k + 1]!;
        if (nodes[a]!.layer === l && Math.abs(nodes[a]!.pc - nodes[b]!.pc) > 0.5) srcs.add(a);
      }
    }
    [...srcs].sort((a, b) => nodes[a]!.pc - nodes[b]!.pc).forEach((a, k) => track.set(`${l}:${a}`, k));
    tracksIn[l] = srcs.size;
  }
  /* main axis: each gap is lead + tracks + a leg that holds the longest label entering the next layer */
  const legNeed = new Array<number>(L).fill(0);
  for (const ch of chains) {
    const e = s.edges[ch.edge]!;
    if (!e.label) continue;
    const tgt = ch.reversed ? ch.nodes[0]! : ch.nodes[ch.nodes.length - 1]!;
    const l = nodes[tgt]!.layer;
    legNeed[l] = Math.max(legNeed[l]!, dir === 'LR' ? textW(e.label, 11) + 26 : 30);
  }
  const layerM = layers.map((ly) => Math.max(0, ...ly.map((v) => nodes[v]!.m)));
  const gapStart: number[] = [];
  let acc = 0;
  layers.forEach((ly, l) => {
    acc += layerM[l]! / 2;
    for (const v of ly) nodes[v]!.pm = acc;
    acc += layerM[l]! / 2;
    gapStart.push(acc);
    acc += LEAD + Math.max(0, tracksIn[l]! - 1) * TRACK + Math.max(dir === 'LR' ? 30 : 22, legNeed[l + 1] ?? 0);
  });
  /* shift into view */
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of nodes) {
    /* dummies too: a long edge's lane must stay inside the drawing */
    lo = Math.min(lo, x.pc - x.c / 2);
    hi = Math.max(hi, x.pc + x.c / 2);
  }
  const pad = 8;
  for (const x of nodes) {
    x.pc += pad - lo;
    x.pm += pad;
  }
  for (let l = 0; l < gapStart.length; l += 1) gapStart[l]! += pad;
  const lastGap = LEAD + Math.max(0, tracksIn[L - 1]! - 1) * TRACK + Math.max(dir === 'LR' ? 30 : 22, legNeed[L] ?? 0);
  const mExtent = acc - lastGap + pad * 2;
  const cExtent = hi - lo + pad * 2;
  return { nodes, chains, width: dir === 'LR' ? mExtent : cExtent, height: dir === 'LR' ? cExtent : mExtent, direction: dir, gapStart, track };
}

function nodeShape(kind: string, w: number, h: number, stroke: string): string {
  const common = { ...TINT, stroke, 'stroke-width': 1 };
  if (kind === 'db') {
    const ry = 5;
    return (
      el('path', { ...common, d: `M0.5 ${ry}A${n(w / 2 - 0.5)} ${ry} 0 0 1 ${n(w - 0.5)} ${ry}V${n(h - ry)}A${n(w / 2 - 0.5)} ${ry} 0 0 1 0.5 ${n(h - ry)}Z` }) +
      el('path', { d: `M0.5 ${ry}A${n(w / 2 - 0.5)} ${ry} 0 0 0 ${n(w - 0.5)} ${ry}`, fill: 'none', stroke, 'stroke-width': 1 })
    );
  }
  if (kind === 'queue' || kind === 'user') return el('rect', { ...common, x: 0.5, y: 0.5, width: w - 1, height: h - 1, rx: (h - 1) / 2 });
  if (kind === 'external') return el('rect', { ...common, x: 0.5, y: 0.5, width: w - 1, height: h - 1, rx: 7, 'stroke-dasharray': '4 3' });
  return el('rect', { ...common, x: 0.5, y: 0.5, width: w - 1, height: h - 1, rx: 7 });
}

type Pt = [number, number];
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Placed {
  /** Node boxes in drawing coordinates, by node index. */
  boxes: Box[];
  /** One orthogonal polyline per edge (index = edge), arrow at the last point. */
  paths: Pt[][];
  width: number;
  height: number;
}

/** An orthogonal polyline with 4 px rounded corners. */
function orthoPath(pts: Pt[]): string {
  const p = pts.filter((q, i) => i === 0 || Math.abs(q[0] - pts[i - 1]![0]) + Math.abs(q[1] - pts[i - 1]![1]) > 0.01);
  let d = `M${n(p[0]![0])} ${n(p[0]![1])}`;
  for (let i = 1; i < p.length; i += 1) {
    const [x, y] = p[i]!;
    const next = p[i + 1];
    if (!next) {
      d += `L${n(x)} ${n(y)}`;
      break;
    }
    const [px, py] = p[i - 1]!;
    const r = Math.min(4, Math.hypot(x - px, y - py) / 2, Math.hypot(next[0] - x, next[1] - y) / 2);
    const ux = Math.sign(x - px);
    const uy = Math.sign(y - py);
    const vx = Math.sign(next[0] - x);
    const vy = Math.sign(next[1] - y);
    d += `L${n(x - ux * r)} ${n(y - uy * r)}Q${n(x)} ${n(y)} ${n(x + vx * r)} ${n(y + vy * r)}`;
  }
  return d;
}

/** Layered placement: orthogonal edges through the gaps' tracks, fan-ins spread along the target's side. */
function placeLayered(s: FlowSpec, lay: ReturnType<typeof layoutFlow>): Placed {
  const dir = lay.direction;
  const P = (m: number, c: number): Pt => (dir === 'LR' ? [m, c] : [c, m]);
  const boxes: Box[] = s.nodes.map((_, i) => {
    const x = lay.nodes[i]!;
    return dir === 'LR' ? { x: x.pm - x.w / 2, y: x.pc - x.h / 2, w: x.w, h: x.h } : { x: x.pc - x.w / 2, y: x.pm - x.h / 2, w: x.w, h: x.h };
  });
  /* incoming ends per real node, spread along its near side, ordered by where they come from */
  const inEnds = new Map<number, { ch: number; from: number }[]>();
  lay.chains.forEach((ch, ci) => {
    const k = ch.nodes.length;
    const to = ch.nodes[k - 1]!;
    const from = ch.nodes[k - 2]!;
    if (!inEnds.has(to)) inEnds.set(to, []);
    inEnds.get(to)!.push({ ch: ci, from });
  });
  const inOffset = new Map<number, number>();
  for (const [to, list] of inEnds) {
    list.sort((a, b) => lay.nodes[a.from]!.pc - lay.nodes[b.from]!.pc);
    const labelled = list.filter((e) => s.edges[lay.chains[e.ch]!.edge]!.label).length >= 2;
    const span = list.length < 2 ? 0 : Math.min(dir === 'LR' && labelled ? 18 : 14, (lay.nodes[to]!.c - 6) / (list.length - 1));
    list.forEach((e, i) => inOffset.set(e.ch, (i - (list.length - 1) / 2) * span));
  }
  const paths: Pt[][] = new Array(s.edges.length);
  lay.chains.forEach((ch, ci) => {
    const pts: Pt[] = [];
    for (let k = 0; k + 1 < ch.nodes.length; k += 1) {
      const a = lay.nodes[ch.nodes[k]!]!;
      const b = lay.nodes[ch.nodes[k + 1]!]!;
      const last = k + 2 === ch.nodes.length;
      const ac = a.pc;
      const bc = b.pc + (last ? inOffset.get(ci) ?? 0 : 0);
      const outM = a.pm + a.m / 2;
      const inM = b.pm - b.m / 2;
      if (k === 0) pts.push(P(outM, ac));
      else pts.push(P(a.pm, ac));
      if (Math.abs(ac - bc) > 0.5) {
        const t = lay.track.get(`${a.layer}:${ch.nodes[k]!}`) ?? 0;
        const cm = lay.gapStart[a.layer]! + LEAD + t * TRACK;
        pts.push(P(cm, ac), P(cm, bc));
      }
      pts.push(P(last ? inM : b.pm, bc));
    }
    paths[ch.edge] = ch.reversed ? pts.reverse() : pts;
  });
  return { boxes, paths, width: lay.width, height: lay.height };
}

/**
 * Outline placement for a narrow column: one node per row in depth-first order, children indented
 * under their parent and joined by a trunk and a short arrowed stub (the stub is as long as the
 * longest label on it); any other edge runs in a lane on the right. One-line labels, nothing crosses
 * a box, every arrow is visible, and it fits any column a few hundred px wide.
 */
function placeOutline(s: FlowSpec, reqWidth = Infinity): Placed {
  const idx = new Map(s.nodes.map((nd, i) => [nd.id, i]));
  const N = s.nodes.length;
  const kids: number[][] = Array.from({ length: N }, () => []);
  const indeg = new Array<number>(N).fill(0);
  s.edges.forEach((e, i) => {
    kids[idx.get(e.from)!]!.push(i);
    indeg[idx.get(e.to)!]! += 1;
  });
  const seen = new Array<boolean>(N).fill(false);
  const rows: { v: number; depth: number; viaEdge: number | null; parent: number | null }[] = [];
  const treeEdge = new Set<number>();
  const visit = (v: number, depth: number, via: number | null, parent: number | null): void => {
    seen[v] = true;
    rows.push({ v, depth, viaEdge: via, parent });
    for (const ei of kids[v]!) {
      const t = idx.get(s.edges[ei]!.to)!;
      if (seen[t]) continue;
      treeEdge.add(ei);
      visit(t, depth + 1, ei, v);
    }
  };
  for (let v = 0; v < N; v += 1) if (!seen[v] && indeg[v] === 0) visit(v, 0, null, null);
  for (let v = 0; v < N; v += 1) if (!seen[v]) visit(v, 0, null, null);
  const ROWGAP = 10;
  const TRUNK = 14;
  const stubOf = new Map<number, number>();
  for (let v = 0; v < N; v += 1) {
    const labels = kids[v]!.filter((ei) => treeEdge.has(ei)).map((ei) => (s.edges[ei]!.label ? textW(s.edges[ei]!.label!, 11) + 22 : 0));
    stubOf.set(v, Math.max(20, ...labels));
  }
  /* a deep outline narrows: stubs shrink (their labels are then cut, with a tooltip) and boxes end at the column */
  const nonTree = s.edges.length - treeEdge.size;
  const room = reqWidth - (nonTree ? 14 + nonTree * 10 : 0) - 2;
  const natural = (v: number): number => {
    const nd = s.nodes[v]!;
    return clamp(Math.max(textW(nd.label ?? nd.id, 12.5, true), nd.sub ? textW(nd.sub, 11) : 0) + 26, 84, 220);
  };
  const xNat: number[] = new Array(N).fill(0);
  for (const r of rows) xNat[r.v] = r.parent === null ? 0 : xNat[r.parent]! + TRUNK + stubOf.get(r.parent)!;
  const over = Math.max(0, ...rows.map((r) => xNat[r.v]! + natural(r.v) - room));
  const maxDepth = Math.max(1, ...rows.map((r) => r.depth));
  const shave = Math.min(over / maxDepth, Math.max(0, ...[...stubOf.values()].map((v) => v - 12)));
  if (shave > 0) for (const [v, st] of stubOf) stubOf.set(v, Math.max(12, st - shave));
  const boxes: Box[] = new Array(N);
  let y = 0;
  for (const r of rows) {
    const nd = s.nodes[r.v]!;
    const h = nd.sub ? 46 : 34;
    const x = r.parent === null ? 0 : boxes[r.parent]!.x + TRUNK + stubOf.get(r.parent)!;
    const w = Math.max(60, Math.min(natural(r.v), room - x));
    boxes[r.v] = { x, y, w, h };
    y += h + ROWGAP;
  }
  const paths: Pt[][] = new Array(s.edges.length);
  for (const r of rows) {
    if (r.viaEdge === null || r.parent === null) continue;
    const pb = boxes[r.parent]!;
    const b = boxes[r.v]!;
    const tx = pb.x + TRUNK;
    paths[r.viaEdge] = [[tx, pb.y + pb.h], [tx, b.y + b.h / 2], [b.x, b.y + b.h / 2]];
  }
  /* other edges: lanes on the right, outermost for the longest */
  const rest = s.edges.map((_, i) => i).filter((i) => !treeEdge.has(i));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  rest.sort((a, b) => {
    const span = (i: number): number => Math.abs(boxes[idx.get(s.edges[i]!.from)!]!.y - boxes[idx.get(s.edges[i]!.to)!]!.y);
    return span(a) - span(b);
  });
  rest.forEach((ei, k) => {
    const a = boxes[idx.get(s.edges[ei]!.from)!]!;
    const b = boxes[idx.get(s.edges[ei]!.to)!]!;
    const lane = right + 14 + k * 10;
    const ay = a.y + a.h / 2 + (b.y > a.y ? 5 : -5);
    const by = b.y + b.h / 2 + (b.y > a.y ? -5 : 5);
    paths[ei] = [[a.x + a.w, ay], [lane, ay], [lane, by], [b.x + b.w, by]];
  });
  const width = right + (rest.length ? 14 + rest.length * 10 : 0) + 2;
  return { boxes, paths, width, height: y - ROWGAP };
}

/** Point and direction at a share `t` of a polyline's length. */
function along(pts: Pt[], t: number): { p: Pt; horizontal: boolean; seg: number } {
  const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]));
  let target = lens.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < lens.length; i += 1) {
    if (target <= lens[i]! || i === lens.length - 1) {
      const f = lens[i]! ? Math.min(1, target / lens[i]!) : 0;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], horizontal: Math.abs(b[1] - a[1]) < 0.5, seg: i };
    }
    target -= lens[i]!;
  }
  return { p: pts[0]!, horizontal: true, seg: 0 };
}
const hit = (a: Box, b: Box, pad = 1): boolean => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Edge label boxes: on the last leg into the target first, then along the edge, never on a box or another label. */
export function flowLabelBoxes(s: FlowSpec, pl: Placed): { edge: number; box: Box; text: string; cut: boolean }[] {
  const out: { edge: number; box: Box; text: string; cut: boolean }[] = [];
  s.edges.forEach((e, ei) => {
    if (!e.label) return;
    const pts = pl.paths[ei]!;
    const lastLeg = pts.length - 2;
    const legLen = Math.hypot(pts[lastLeg + 1]![0] - pts[lastLeg]![0], pts[lastLeg + 1]![1] - pts[lastLeg]![1]);
    const legHorizontal = Math.abs(pts[lastLeg + 1]![1] - pts[lastLeg]![1]) < 0.5;
    const max = legHorizontal ? Math.max(24, legLen - 10) : 150;
    const t = fit(e.label, max, 11);
    const w = textW(t, 11) + 10;
    const h = 16;
    const total = pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]), 0);
    const legShare = total ? legLen / total : 1;
    const cands = [1 - legShare / 2, 1 - legShare / 3, 1 - (legShare * 2) / 3, ...Array.from({ length: 19 }, (_, i) => 0.95 - i * 0.05)];
    let pick: Box | null = null;
    /* on the line first; then just beside it (above or below a level leg, left or right of an upright one) */
    for (const shift of [0, 1, -1]) {
      for (const c of cands) {
        const { p, horizontal } = along(pts, c);
        const dx = horizontal ? 0 : shift * (w / 2 + 4);
        const dy = horizontal ? shift * (h / 2 + 3) : 0;
        const box = { x: p[0] - w / 2 + dx, y: p[1] - h / 2 + dy, w, h };
        if (pl.boxes.some((b) => hit(b, box)) || out.some((o) => hit(o.box, box, 2))) continue;
        pick = box;
        break;
      }
      if (pick) break;
    }
    if (!pick) {
      const { p } = along(pts, cands[0]!);
      pick = { x: p[0] - w / 2, y: p[1] - h / 2, w, h };
    }
    out.push({ edge: ei, box: pick, text: t, cut: t !== e.label });
  });
  return out;
}

/**
 * Placement the renderer uses at `reqWidth`, never wider than it when any placement fits: the asked
 * direction if it fits, else left to right, top down, then the outline (which narrows its indents to
 * the column). The chat passes its column width, so the text is shown at its drawn size.
 */
export function placeFlow(s: FlowSpec, reqWidth: number): Placed & { mode: 'LR' | 'TB' | 'outline' } {
  /* Vertical first: the chat column is narrow and tall. Left to right only while the chain is short (FLOW_MAX_ACROSS steps); a longer chain reads top down, asked or not. */
  const across = layoutFlow({ ...s, direction: 'LR' });
  const steps = 1 + Math.max(0, ...across.nodes.filter((x) => x.real).map((x) => x.layer));
  const order: ('LR' | 'TB')[] = s.direction === 'TB' || steps > FLOW_MAX_ACROSS ? ['TB', 'LR'] : ['LR', 'TB'];
  let narrowest: (Placed & { mode: 'LR' | 'TB' | 'outline' }) | null = null;
  for (const d of order) {
    const lay = layoutFlow({ ...s, direction: d });
    const pl = { ...placeLayered(s, lay), mode: d };
    if (pl.width <= reqWidth) return pl;
    if (!narrowest || pl.width < narrowest.width) narrowest = pl;
  }
  const ol = { ...placeOutline(s, reqWidth), mode: 'outline' as const };
  return ol.width <= reqWidth || ol.width < narrowest!.width ? ol : narrowest!;
}

function renderFlow(s: FlowSpec, reqWidth: number): Frag {
  const pl = placeFlow(s, reqWidth);
  /* The title is centred on the drawing as drawn: a flow narrower than the column is not centred on the column. */
  const hd = header(s.title, undefined, Math.max(pl.width, 200));
  const groups = [...new Set(s.nodes.map((x) => x.group).filter((x): x is string => !!x))];
  const legendH = groups.length ? 26 : 0;
  const ns = 'f';
  let body = arrowDefs(ns);
  for (const pts of pl.paths) body += el('path', { d: orthoPath(pts), fill: 'none', stroke: C.muted, 'stroke-width': 1.2, 'marker-end': `url(#${ns}a)`, 'stroke-linejoin': 'round' });
  let labels = '';
  for (const lb of flowLabelBoxes(s, pl)) {
    labels += el('rect', { x: lb.box.x, y: lb.box.y, width: lb.box.w, height: lb.box.h, rx: 8, fill: C.surface, stroke: C.edge, 'stroke-width': 0.8 });
    labels += text(lb.box.x + lb.box.w / 2, lb.box.y + lb.box.h / 2, lb.text, { size: 11, fill: C.muted, anchor: 'middle', mid: true, tip: s.edges[lb.edge]!.label });
  }
  let boxes = '';
  s.nodes.forEach((nd, i) => {
    const b = pl.boxes[i]!;
    const color = nd.group ? series(groups.indexOf(nd.group)) : C.edge;
    let inner = nodeShape(nd.kind ?? 'service', b.w, b.h, color);
    const top = nd.kind === 'db' ? 3 : 0;
    if (nd.sub) {
      inner += line1(b.w / 2, 16 + top, nd.label ?? nd.id, b.w - 14, { size: 12.5, bold: true, anchor: 'middle', mid: true });
      inner += line1(b.w / 2, 32 + top, nd.sub, b.w - 14, { size: 11, fill: C.muted, anchor: 'middle', mid: true });
    } else inner += line1(b.w / 2, b.h / 2 + top, nd.label ?? nd.id, b.w - 14, { size: 12.5, bold: true, anchor: 'middle', mid: true });
    boxes += g({ transform: `translate(${n(b.x)} ${n(b.y)})` }, inner);
  });
  let leg = '';
  if (groups.length) {
    let lx = 0;
    groups.forEach((gr, i) => {
      leg += el('rect', { x: lx, y: 0, width: 12, height: 10, rx: 3, ...TINT, stroke: series(i), 'stroke-width': 1 });
      leg += text(lx + 17, 5, gr, { size: 11, fill: C.muted, mid: true });
      lx += 17 + textW(gr, 11) + 18;
    });
  }
  const w = Math.max(pl.width, 200);
  const H = hd.h + pl.height + legendH;
  const svg = hd.svg + g({ transform: `translate(0 ${n(hd.h)})` }, body + boxes + labels) + (leg ? g({ transform: `translate(0 ${n(hd.h + pl.height + 10)})` }, leg) : '');
  const summary = `Flow${s.title ? ` "${s.title}"` : ''}: ${s.nodes.length} nodes, ${s.edges.length} edges; ` + s.edges.slice(0, 8).map((e) => `${e.from} to ${e.to}`).join(', ') + (s.edges.length > 8 ? ', ...' : '');
  return { w, h: H, svg, summary };
}

export const flow: Component<FlowSpec> = {
  id: 'flow',
  blurb: 'Architecture or process boxes and arrows, laid out automatically (left to right or top down).',
  shape:
    'flow {title?, direction?:"LR"|"TB", nodes:[{id, label?, sub?, kind?:"service"|"db"|"queue"|"user"|"external", group?}] (1-40), edges:[{from:id, to:id, label?}], width?}\n' +
    'reads best top down (more than 3 steps always are), labels of 1-4 words, at most 8 nodes.',
  example: {
    title: 'AI feature gateway',
    nodes: [{ id: 'app', label: 'Product app', kind: 'user' }, { id: 'gw', label: 'AI gateway', sub: 'auth, quota, routing', group: 'edge' }, { id: 'cache', label: 'Cache', kind: 'db', group: 'edge' }, { id: 'llm', label: 'Model provider', kind: 'external' }, { id: 'q', label: 'Usage events', kind: 'queue' }],
    edges: [{ from: 'app', to: 'gw', label: 'HTTPS' }, { from: 'gw', to: 'cache', label: 'lookup' }, { from: 'gw', to: 'llm', label: 'stream' }, { from: 'gw', to: 'q' }],
  },
  parse: (spec) => run('flow', flowCheck, spec, flowProblems),
  render: (s, w) => renderFlow(s, s.width ?? w),
};

/* ───────────────────────────── sequence ───────────────────────────── */

const seqCheck = obj({
  title: opt(str({ max: 90 })),
  actors: arr(str({ max: 30 }), { min: 2, max: 8 }),
  messages: arr(obj({ from: str({ max: 30 }), to: str({ max: 30 }), text: str({ max: 80 }), kind: opt(oneOf('call', 'return', 'async')), note: opt(str({ max: 80 })) }), { min: 1, max: 40 }),
  numbered: opt(bool()),
  width: W,
});
export type SeqSpec = ReturnType<typeof seqCheck>;

function seqProblems(s: SeqSpec, p: Problems): void {
  const names = new Set(s.actors);
  if (names.size !== s.actors.length) p.add('spec.actors: names must be different');
  s.messages.forEach((m, i) => {
    for (const end of ['from', 'to'] as const) if (!names.has(m[end])) p.add(`spec.messages[${i}].${end}: "${m[end]}" is not in actors (${s.actors.join(', ')})`);
  });
}

function renderSeq(s: SeqSpec, reqWidth: number): Frag {
  const hd = header(s.title, undefined, reqWidth);
  const n0 = s.actors.length;
  /* actor columns shrink to 60px (names cut with a tooltip only then) before the drawing gets wider than the column (and is scaled down) */
  const col = Math.max(60, Math.min(230, (reqWidth - 20) / n0));
  const width = Math.max(reqWidth, col * n0 + 20);
  const cx = (i: number): number => 10 + col / 2 + i * ((width - 20 - col) / Math.max(1, n0 - 1)) * (n0 === 1 ? 0 : 1);
  const boxW = Math.min(col - 6, 170);
  const top = hd.h;
  const bh = 30;
  const rows: number[] = [];
  let y = top + bh + 28;
  for (const m of s.messages) {
    rows.push(y);
    y += m.note ? 50 : 38;
  }
  const bottom = y - 6;
  const ns = 'q';
  let svg = hd.svg + arrowDefs(ns);
  let life = '';
  let boxes = '';
  s.actors.forEach((a, i) => {
    const x = cx(i);
    life += el('line', { x1: x, y1: top + bh, x2: x, y2: bottom });
    boxes += el('rect', { x: x - boxW / 2, y: top, width: boxW, height: bh, rx: 7, ...TINT, ...HAIR });
    boxes += line1(x, top + bh / 2, a, boxW - 12, { size: 12.5, bold: true, anchor: 'middle', mid: true });
  });
  svg += g({ stroke: C.edge, 'stroke-width': 1.2, 'stroke-dasharray': '4 4' }, life) + boxes;
  s.messages.forEach((m, i) => {
    const a = s.actors.indexOf(m.from);
    const b = s.actors.indexOf(m.to);
    const x0 = cx(a);
    const x1 = cx(b);
    const yy = rows[i]!;
    const label = (s.numbered ? `${i + 1}. ` : '') + m.text;
    const stroke = m.kind === 'return' ? C.muted : C.fg;
    const dash = m.kind === 'return' ? '5 3' : m.kind === 'async' ? '1.5 3' : undefined;
    if (a === b) {
      svg += el('path', { d: `M${n(x0)} ${n(yy - 8)}h26v16h-26`, fill: 'none', stroke, 'stroke-width': 1.4, 'stroke-dasharray': dash, 'marker-end': `url(#${ns}a)` });
      /* a label may run past the next lifeline (each message has its own row), up to the drawing's edge */
      const room = Math.max(60, width - x0 - 34);
      svg += line1(x0 + 32, yy, label, room, { mid: true });
      if (m.note) svg += line1(x0 + 32, yy + 15, m.note, room, { size: 11, fill: C.muted, mid: true });
    } else {
      const lo = Math.min(x0, x1);
      const span = Math.abs(x1 - x0);
      const dirn = x1 > x0 ? 1 : -1;
      svg += el('line', { x1: x0 + dirn * 1, y1: yy, x2: x1 - dirn * 1, y2: yy, stroke, 'stroke-width': 1.4, 'stroke-dasharray': dash, 'marker-end': `url(#${ns}a)` });
      /* centred on the arrow, but a label wider than the arrow may run past the lifelines (each message has its own row), kept inside the drawing */
      const centred = (t: string, size: number): { t: string; x: number } => {
        const f = fit(t, Math.max(span - 12, width - 8), size);
        const half = textW(f, size) / 2;
        return { t: f, x: clamp(lo + span / 2, 4 + half, width - 4 - half) };
      };
      const lt = centred(label, 12);
      svg += text(lt.x, yy - 7, lt.t, { anchor: 'middle' });
      if (m.note) {
        const nt = centred(m.note, 11);
        svg += text(nt.x, yy + 14, nt.t, { size: 11, fill: C.muted, anchor: 'middle' });
      }
    }
  });
  const sum = `Sequence${s.title ? ` "${s.title}"` : ''}: ${s.actors.join(', ')}; ` + s.messages.slice(0, 8).map((m) => `${m.from} to ${m.to}: ${m.text}`).join('; ') + (s.messages.length > 8 ? '; ...' : '');
  return { w: width, h: bottom + 8, svg, summary: sum };
}

export const sequence: Component<SeqSpec> = {
  id: 'sequence',
  blurb: 'Sequence diagram: actors with lifelines and ordered messages (call, return, async).',
  shape: 'sequence {title?, actors:[names] (2-8), messages:[{from, to, text, kind?:"call"|"return"|"async", note?}] in time order (1-40), numbered?, width?}',
  example: {
    title: 'One AI request',
    actors: ['App', 'Gateway', 'Cache', 'Model'],
    messages: [{ from: 'App', to: 'Gateway', text: 'POST /summarise' }, { from: 'Gateway', to: 'Cache', text: 'lookup', note: 'miss' }, { from: 'Gateway', to: 'Model', text: 'stream prompt', kind: 'async' }, { from: 'Model', to: 'Gateway', text: 'tokens', kind: 'return', note: '~900 ms' }, { from: 'Gateway', to: 'App', text: '200 + stream', kind: 'return' }],
    numbered: true,
  },
  parse: (spec) => run('sequence', seqCheck, spec, seqProblems),
  render: (s, w) => renderSeq(s, s.width ?? w),
};

/* ───────────────────────────── loadpath ───────────────────────────── */

const pathCheck = obj({
  title: opt(str({ max: 90 })),
  subtitle: opt(str({ max: 140 })),
  hops: arr(obj({ name: str({ max: 40 }), sub: opt(str({ max: 50 })), rps: opt(num({ min: 0 })), latencyMs: opt(num({ min: 0 })), util: opt(num({ min: 0, max: 5 })), note: opt(str({ max: 40 })) }), { min: 2, max: 12 }),
  threshold: opt(num({ min: 0.1, max: 1 })),
  width: W,
});
export type PathSpec = ReturnType<typeof pathCheck>;

function renderPath(s: PathSpec, width: number): Frag {
  const thr = s.threshold ?? 0.8;
  const hd = header(s.title, s.subtitle, width);
  const gap = 34;
  const per = clamp(Math.floor((width + gap) / (132 + gap)), 2, 5);
  const bw = (width - gap * (per - 1)) / per;
  const bh = s.hops.some((x) => x.note && x.util !== undefined) ? 102 : 88;
  const rowGap = 30;
  const rows = Math.ceil(s.hops.length / per);
  const ns = 'p';
  let svg = hd.svg + arrowDefs(ns);
  const pos = (i: number): { x: number; y: number } => {
    const r = Math.floor(i / per);
    const c0 = i % per;
    const c = r % 2 === 0 ? c0 : per - 1 - c0;
    return { x: c * (bw + gap), y: hd.h + r * (bh + rowGap) };
  };
  s.hops.forEach((h, i) => {
    const { x, y } = pos(i);
    const util = h.util;
    const hot = util !== undefined && util >= thr;
    /* a plain hairline box; a hot hop says so in its text and its bar, not with a coloured border */
    let inner = el('rect', { x: 0.5, y: 0.5, width: bw - 1, height: bh - 1, rx: 9, ...TINT, ...HAIR });
    inner += line1(10, 17, h.name, bw - 20, { size: 13, bold: true });
    if (h.sub) inner += line1(10, 31, h.sub, bw - 20, { size: 11, fill: C.muted });
    if (h.rps !== undefined) inner += text(10, 51, `${fmt(h.rps)} rps`, { size: 16, bold: true });
    if (h.latencyMs !== undefined) inner += text(bw - 10, 51, `${fmt(h.latencyMs)} ms`, { size: 11, fill: C.muted, anchor: 'end' });
    if (util !== undefined) {
      const bx = 10;
      const bwid = bw - 20;
      inner += el('rect', { x: bx, y: 60, width: bwid, height: 7, rx: 3.5, fill: C.edge, opacity: 0.7 });
      inner += el('rect', { x: bx, y: 60, width: Math.max(2, Math.min(1, util) * bwid), height: 7, rx: 3.5, ...utilFill(util, thr) });
      inner += el('line', { x1: bx + thr * bwid, y1: 57, x2: bx + thr * bwid, y2: 70, stroke: C.fg, 'stroke-width': 1, opacity: 0.55 });
      inner += line1(10, 82, `${Math.round(util * 100)}% of capacity`, bw - 20, { size: 11, fill: hot ? utilColor(util, thr) : C.muted });
      /* the note gets its own line (it used to share one with the share of capacity and was cut to "tighte…") */
      if (h.note) inner += line1(10, 96, h.note, bw - 20, { size: 11, fill: C.muted });
    } else if (h.note) inner += line1(10, 82, h.note, bw - 20, { size: 11, fill: C.muted });
    svg += g({ transform: `translate(${n(x)} ${n(y)})` }, inner);
    if (i + 1 < s.hops.length) {
      const nx = pos(i + 1);
      const sameRow = nx.y === y;
      if (sameRow) {
        const dirn = nx.x > x ? 1 : -1;
        const x0 = dirn > 0 ? x + bw : x;
        svg += el('line', { x1: x0 + dirn * 3, y1: y + bh / 2, x2: x0 + dirn * (gap - 4), y2: y + bh / 2, stroke: C.muted, 'stroke-width': 1.5, 'marker-end': `url(#${ns}a)` });
      } else {
        svg += el('line', { x1: x + bw / 2, y1: y + bh + 3, x2: x + bw / 2, y2: nx.y - 4, stroke: C.muted, 'stroke-width': 1.5, 'marker-end': `url(#${ns}a)` });
      }
    }
  });
  let h = hd.h + rows * bh + (rows - 1) * rowGap;
  /* latency budget */
  const lat = s.hops.map((x, i) => ({ name: x.name, ms: x.latencyMs ?? 0, i })).filter((x) => x.ms > 0);
  const total = lat.reduce((a, x) => a + x.ms, 0);
  if (lat.length >= 2) {
    /* Quiet: each hop a faint ink tint (alternating strength) with a hairline, labels in ink, no colour.
       A hop too thin for its label is named in a line under the bar, so every hop is accounted for. */
    h += 22;
    svg += text(0, h + 2, `Latency budget, ${fmt(total)} ms end to end`, { size: 11, fill: C.muted });
    let x = 0;
    let seg = '';
    const small: string[] = [];
    for (const [k, l] of lat.entries()) {
      const w = (l.ms / total) * width;
      seg += el('rect', { x: x + 0.5, y: h + 10, width: Math.max(1, w - 1), height: 18, rx: 3, ...TINT, 'fill-opacity': k % 2 ? 0.08 : 0.15, ...HAIR });
      const label = `${l.name} ${fmt(l.ms)}`;
      if (textW(label, 11) + 10 < w) seg += text(x + w / 2, h + 19, label, { size: 11, anchor: 'middle', mid: true });
      else small.push(`${l.name} ${fmt(l.ms)} ms`);
      x += w;
    }
    svg += seg;
    h += 34;
    if (small.length) {
      h += 14;
      svg += line1(0, h, small.join(' · '), width, { size: 11, fill: C.muted });
      h += 4;
    }
  }
  const hot = s.hops.filter((x) => x.util !== undefined).sort((a, b) => b.util! - a.util!)[0];
  const summary = `Load path${s.title ? ` "${s.title}"` : ''}: ${s.hops.map((x) => x.name).join(' to ')}` + (hot ? `; most loaded ${hot.name} at ${Math.round(hot.util! * 100)}% of capacity` : '') + (total > 0 ? `; ${fmt(total)} ms end to end` : '');
  return { w: width, h, svg, summary };
}

export const loadpath: Component<PathSpec> = {
  id: 'loadpath',
  blurb: 'A request path hop by hop with load (rps), latency and utilisation per hop, plus a latency budget bar.',
  shape: 'loadpath {title?, subtitle?, hops:[{name, sub?, rps?, latencyMs?, util? (0-1 = share of capacity), note?}] (2-12 in order), threshold? (saturation, default 0.8), width?}',
  example: { title: 'Request path at 1,000 users', hops: [{ name: 'CDN', rps: 17, latencyMs: 12, util: 0.02 }, { name: 'AI gateway', sub: 'auth, quota', rps: 17, latencyMs: 40, util: 0.34 }, { name: 'Model proxy', rps: 17, latencyMs: 820, util: 0.88, note: 'bottleneck' }, { name: 'Provider', sub: 'external', rps: 17, latencyMs: 300 }] },
  parse: (spec) => run('loadpath', pathCheck, spec),
  render: (s, w) => renderPath(s, s.width ?? w),
};

/* ───────────────────────────── timeline ───────────────────────────── */

const timeCheck = obj({
  title: opt(str({ max: 90 })),
  items: arr(obj({ label: str({ max: 60 }), start: strOrNum(), end: opt(strOrNum()), group: opt(str({ max: 30 })) }), { min: 1, max: 40 }),
  now: opt(strOrNum()),
  unit: opt(str({ max: 12 })),
  width: W,
});
export type TimeSpec = ReturnType<typeof timeCheck>;

const DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;
function toDay(v: string | number): { value: number; date: boolean } | null {
  if (typeof v === 'number') return { value: v, date: false };
  const m = DATE_RE.exec(v.trim());
  if (m) {
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1));
    if (Number.isNaN(t) || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    return { value: t / DAY, date: true };
  }
  const x = Number(v);
  return v.trim() !== '' && Number.isFinite(x) ? { value: x, date: false } : null;
}

function timeProblems(s: TimeSpec, p: Problems): void {
  let dates = 0;
  let plain = 0;
  const check = (v: string | number, path: string): number => {
    const t = toDay(v);
    if (!t) {
      p.add(`${path}: "${v}" is not a date like 2026-03-15 (or 2026-03) or a number`);
      return 0;
    }
    if (t.date) dates += 1;
    else plain += 1;
    return t.value;
  };
  s.items.forEach((it, i) => {
    const a = check(it.start, `spec.items[${i}].start`);
    if (it.end !== undefined) {
      const b = check(it.end, `spec.items[${i}].end`);
      if (b < a) p.add(`spec.items[${i}].end: ends before it starts`);
    }
  });
  if (s.now !== undefined) check(s.now, 'spec.now');
  if (dates > 0 && plain > 0) p.add('spec.items: mix of dates and plain numbers; use one kind');
}

function monthTicks(lo: number, hi: number, maxTicks: number): { v: number; label: string }[] {
  const out: { v: number; label: string; m: number; y: number }[] = [];
  const d0 = new Date(lo * DAY);
  let y = d0.getUTCFullYear();
  let m = d0.getUTCMonth();
  if (Date.UTC(y, m, 1) / DAY < lo) m += 1;
  for (;;) {
    const v = Date.UTC(y, m, 1) / DAY;
    if (v > hi) break;
    out.push({ v, label: '', m: ((m % 12) + 12) % 12, y: y + Math.floor(m / 12) });
    m += 1;
    if (out.length > 400) break;
  }
  const step = Math.max(1, Math.ceil(out.length / maxTicks));
  const thin = out.filter((_, i) => i % step === 0);
  return thin.map((t, i) => ({ v: t.v, label: i === 0 || t.m === 0 ? `${MONTHS[t.m]} ${t.y}` : MONTHS[t.m]! }));
}

function renderTime(s: TimeSpec, width: number): Frag {
  const hd = header(s.title, undefined, width);
  const rows = s.items.map((it) => ({ it, a: toDay(it.start)!.value, b: it.end === undefined ? null : toDay(it.end)!.value }));
  const isDate = toDay(s.items[0]!.start)!.date;
  let lo = Math.min(...rows.map((r) => r.a));
  let hi = Math.max(...rows.map((r) => r.b ?? r.a));
  const now = s.now === undefined ? null : toDay(s.now)!.value;
  if (now !== null) {
    lo = Math.min(lo, now);
    hi = Math.max(hi, now);
  }
  if (hi === lo) hi = lo + (isDate ? 7 : 1);
  const groups = [...new Set(s.items.map((x) => x.group).filter((x): x is string => !!x))];
  /* the label column takes what the longest label needs, up to half the width (one line; cut with a tooltip only past that) */
  const left = Math.min(width * 0.5, Math.max(...rows.map((r) => textW(r.it.label, 12)), 40) + 26);
  const pw = width - left - 16;
  const span = hi - lo;
  const pad = span * 0.02;
  const X = (v: number): number => left + ((v - (lo - pad)) / (span + pad * 2)) * pw;
  const axisY = hd.h + (groups.length ? 26 : 4) + 14;
  const rowH = 28;
  const topY = axisY + 8;
  let ticks: { v: number; label: string }[];
  if (isDate) {
    ticks = span < 75 ? Array.from({ length: Math.floor(span / 7) + 1 }, (_, i) => ({ v: lo + i * 7, label: (() => { const d = new Date((lo + i * 7) * DAY); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; })() })) : monthTicks(lo, hi, Math.max(3, Math.floor(pw / 56)));
  } else {
    ticks = niceTicks(lo, hi, 6).ticks.filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9).map((t) => ({ v: t, label: s.unit ? `${fmt(t)} ${s.unit}` : fmt(t) }));
  }
  let svg = hd.svg;
  if (groups.length) {
    let lx = 0;
    groups.forEach((gr, i) => {
      svg += el('rect', { x: lx, y: hd.h + 5, width: 12, height: 10, rx: 2, fill: series(i), 'fill-opacity': SOFT });
      svg += text(lx + 17, hd.h + 10, gr, { size: 11, fill: C.muted, mid: true });
      lx += 17 + textW(gr, 11) + 18;
    });
  }
  let grid = '';
  let tl = '';
  for (const t of ticks) {
    grid += el('line', { x1: X(t.v), y1: axisY + 2, x2: X(t.v), y2: topY + rows.length * rowH });
    tl += text(X(t.v), axisY - 2, t.label, { size: 11, fill: C.muted, anchor: 'middle' });
  }
  svg += g({ stroke: C.edge, opacity: 0.7 }, grid) + tl;
  rows.forEach((r, i) => {
    const y = topY + i * rowH;
    const color = r.it.group ? series(groups.indexOf(r.it.group)) : series(0);
    svg += line1(left - 10, y + rowH / 2, r.it.label, left - 16, { anchor: 'end', mid: true });
    if (r.b === null) {
      const x = X(r.a);
      svg += el('polygon', { points: `${n(x)},${n(y + rowH / 2 - 8)} ${n(x + 8)},${n(y + rowH / 2)} ${n(x)},${n(y + rowH / 2 + 8)} ${n(x - 8)},${n(y + rowH / 2)}`, fill: color });
    } else {
      svg += el('rect', { x: X(r.a), y: y + 5, width: Math.max(4, X(r.b) - X(r.a)), height: rowH - 10, rx: 4, fill: color, 'fill-opacity': SOFT });
    }
  });
  if (now !== null) {
    svg += el('line', { x1: X(now), y1: axisY + 2, x2: X(now), y2: topY + rows.length * rowH, stroke: C.bad, 'stroke-width': 1.3, 'stroke-dasharray': '4 3' });
    svg += text(X(now), topY + rows.length * rowH + 14, 'Today', { size: 11, fill: C.bad, anchor: 'middle' });
  }
  const H = topY + rows.length * rowH + (now !== null ? 22 : 8);
  return { w: width, h: H, svg, summary: `Timeline${s.title ? ` "${s.title}"` : ''}: ${rows.length} items from ${s.items[0]!.label} to ${s.items[s.items.length - 1]!.label}` };
}

export const timeline: Component<TimeSpec> = {
  id: 'timeline',
  blurb: 'Gantt rows and milestones on a date axis (or plain numbers such as weeks).',
  shape: 'timeline {title?, items:[{label, start, end? (omit = milestone), group?}] (1-40), start/end as "2026-03-15" | "2026-03" | numbers, now? (marks today), unit? (for number axes), width?}',
  example: { title: 'Rollout plan', now: '2026-04-10', items: [{ label: 'Gateway MVP', start: '2026-03-01', end: '2026-04-15', group: 'build' }, { label: 'Pilot with 1,000 users', start: '2026-04-15', end: '2026-05-31', group: 'rollout' }, { label: 'Load test', start: '2026-04-20', end: '2026-05-05', group: 'build' }, { label: 'General availability', start: '2026-06-15', group: 'rollout' }] },
  parse: (spec) => run('timeline', timeCheck, spec, timeProblems),
  render: (s, w) => renderTime(s, s.width ?? w),
};

export const DIAGRAMS = [flow, sequence, loadpath, timeline] as unknown as Component[];
void withUnit;
