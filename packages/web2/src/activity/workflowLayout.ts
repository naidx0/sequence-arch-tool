/* ══════════════════════════════════════════════════════════════════════════
   THE WORKFLOW GRAPH LAYOUT (round 12)
   packages/web2/src/activity/workflowLayout.ts (was workflowGraph.ts: on Windows and macOS that name collides with WorkflowGraph.tsx)

   A run's program is a control-flow graph (nodes and kind-tagged edges). This
   lays it out for reading, top to bottom (the Agents pane is a narrow column):

     - RANK  = a node's longest forward distance from a start (back-edges, the
       loops' returns, are split off first, so the rest is acyclic).
     - COLUMN = a node stays in its first parent's column; a parent's later
       children (the loop's exit, a branch's other arm) take the next free
       column to the right. So a loop's body is one column going down and its
       exit branches off beside it, and the picture has no crossings.
     - A LOOP is its return arc down the LEFT side (out of the step the loop
       returns from, into the loop node), plus a tinted region around the steps
       inside it, so which steps repeat is visible at a glance.
     - Column width follows the room the pane has (`width`), down to a floor, so
       at 1024 the whole graph, arc and label included, fits the pane.

   Pure; no DOM, no clock.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Program, ProgramEdge } from '@sequence/schema';

export const GRAPH_NODE_H = 40;
export const GRAPH_GAP_X = 12;
export const GRAPH_GAP_Y = 22;
export const GRAPH_PAD = 10;
/** Room on the left for one return arc and its rotated label. */
export const GRAPH_LOOP_LANE = 26;
export const GRAPH_COL_MIN = 96;
export const GRAPH_COL_MAX = 168;
/** Under this a column drops its kind badge (the kind stays in the tooltip). */
export const GRAPH_COL_KIND = 140;
/** The loop region reaches this far past the steps inside it. */
export const GRAPH_REGION_PAD = 5;

export interface GraphNode {
  id: string;
  title: string;
  kind: string;
  rank: number;
  col: number;
  x: number;
  y: number;
  w: number;
  /** The loop node's iteration cap, when it declares one. */
  cap: number | null;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: ProgramEdge['kind'];
  label: string | null;
  /** A back-edge: it returns to a step at or before its source. */
  back: boolean;
  /** Which return lane a back-edge uses (0 = nearest the nodes). */
  lane: number;
}

/** The steps a loop repeats: the loop node (the back-edge's target) and everything on a path from it to the return. */
export interface GraphRegion {
  edgeId: string;
  nodeIds: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  regions: GraphRegion[];
  width: number;
  height: number;
  loops: number;
  cols: number;
  colW: number;
}

export function layoutWorkflow(program: Pick<Program, 'nodes' | 'edges'>, opts: { width?: number } = {}): WorkflowGraph {
  const ids = new Set(program.nodes.map((n) => n.id));
  const edges = program.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const out = new Map<string, ProgramEdge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);

  /* Back-edges: declared loop-back edges, plus any edge a depth-first walk
     finds closing a cycle (a retry arc authored as a plain seq edge). */
  const back = new Set<string>(edges.filter((e) => e.kind === 'loop-back' || e.from === e.to).map((e) => e.id));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      if (back.has(e.id)) continue;
      const s = state.get(e.to);
      if (s === 1) back.add(e.id);
      else if (s === undefined) visit(e.to);
    }
    state.set(id, 2);
  };
  const hasIn = new Set(edges.filter((e) => !back.has(e.id)).map((e) => e.to));
  for (const n of program.nodes) if (!hasIn.has(n.id) && !state.has(n.id)) visit(n.id);
  for (const n of program.nodes) if (!state.has(n.id)) visit(n.id);

  const forward = edges.filter((e) => !back.has(e.id));
  const fwdOut = new Map<string, ProgramEdge[]>();
  const fwdIn = new Map<string, ProgramEdge[]>();
  /* A loop's body arm is listed before its exit, a branch's true arm before its false: the first child keeps the column. */
  const armOrder = (e: ProgramEdge) => (e.kind === 'loop-body' || e.kind === 'branch-true' ? 0 : 1);
  for (const e of [...forward].sort((a, b) => armOrder(a) - armOrder(b))) {
    fwdOut.set(e.from, [...(fwdOut.get(e.from) ?? []), e]);
    fwdIn.set(e.to, [...(fwdIn.get(e.to) ?? []), e]);
  }

  /* Longest-path rank over the forward edges (acyclic now). */
  const rank = new Map<string, number>(program.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < program.nodes.length; pass++) {
    let moved = false;
    for (const e of forward) {
      const r = (rank.get(e.from) ?? 0) + 1;
      if (r > (rank.get(e.to) ?? 0)) {
        rank.set(e.to, r);
        moved = true;
      }
    }
    if (!moved) break;
  }

  /* Columns, walking by rank then declared order. */
  const col = new Map<string, number>();
  const taken = new Set<string>(); // `${rank}:${col}`
  const free = (r: number, c: number) => !taken.has(`${r}:${c}`);
  const claim = (id: string, c: number) => {
    const r = rank.get(id) ?? 0;
    while (!free(r, c)) c += 1;
    col.set(id, c);
    taken.add(`${r}:${c}`);
  };
  const ordered = [...program.nodes].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  for (const n of ordered) {
    const parents = (fwdIn.get(n.id) ?? []).map((e) => e.from).filter((p) => col.has(p));
    if (parents.length === 0) {
      claim(n.id, 0);
      continue;
    }
    /* The first parent whose arm this is: a parent's first child stays in its column, later children move right of it. */
    const first = parents[0]!;
    const siblings = fwdOut.get(first) ?? [];
    const idx = siblings.findIndex((e) => e.to === n.id);
    const base = Math.min(...parents.map((p) => col.get(p) ?? 0));
    claim(n.id, idx <= 0 ? base : (col.get(first) ?? 0) + idx);
  }

  const cols = Math.max(1, ...[...col.values()].map((c) => c + 1));
  const backEdges = edges.filter((e) => back.has(e.id));
  const rankOf = (id: string) => rank.get(id) ?? 0;
  /* A longer return takes the outer lane so a short arc never crosses a long one. */
  const byReach = [...backEdges].sort((a, b) => Math.abs(rankOf(b.from) - rankOf(b.to)) - Math.abs(rankOf(a.from) - rankOf(a.to)));
  const lane = new Map<string, number>(byReach.map((e, i) => [e.id, byReach.length - 1 - i]));
  const lanes = backEdges.length;

  const originX = GRAPH_PAD + lanes * GRAPH_LOOP_LANE;
  const avail = opts.width ?? GRAPH_COL_MAX * cols + GRAPH_GAP_X * (cols - 1) + originX + GRAPH_PAD;
  const fit = (avail - originX - GRAPH_PAD - GRAPH_GAP_X * (cols - 1)) / cols;
  const colW = Math.floor(Math.max(GRAPH_COL_MIN, Math.min(GRAPH_COL_MAX, fit)));

  const placed: GraphNode[] = program.nodes.map((n) => {
    const r = rank.get(n.id) ?? 0;
    const c = col.get(n.id) ?? 0;
    return {
      id: n.id,
      title: n.title,
      kind: n.kind,
      rank: r,
      col: c,
      x: originX + c * (colW + GRAPH_GAP_X),
      y: GRAPH_PAD + r * (GRAPH_NODE_H + GRAPH_GAP_Y),
      w: colW,
      cap: n.loop ? n.loop.maxIterations : null,
    };
  });
  const at = new Map(placed.map((n) => [n.id, n]));

  /* The steps inside each loop: reachable from the loop node, and able to reach the step that returns. */
  const reach = (from: string, next: (id: string) => string[]) => {
    const seen = new Set<string>([from]);
    const stack = [from];
    while (stack.length) for (const t of next(stack.pop()!)) if (!seen.has(t)) (seen.add(t), stack.push(t));
    return seen;
  };
  const regions: GraphRegion[] = [];
  for (const e of backEdges) {
    const down = reach(e.to, (id) => (fwdOut.get(id) ?? []).map((x) => x.to));
    const up = reach(e.from, (id) => (fwdIn.get(id) ?? []).map((x) => x.from));
    const members = [...down].filter((id) => up.has(id));
    if (!members.includes(e.to)) members.push(e.to);
    const boxes = members.map((id) => at.get(id)!).filter(Boolean);
    const x0 = Math.min(...boxes.map((b) => b.x)) - GRAPH_REGION_PAD;
    const y0 = Math.min(...boxes.map((b) => b.y)) - GRAPH_REGION_PAD;
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + GRAPH_REGION_PAD;
    const y1 = Math.max(...boxes.map((b) => b.y + GRAPH_NODE_H)) + GRAPH_REGION_PAD;
    regions.push({ edgeId: e.id, nodeIds: members, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  const maxRank = Math.max(0, ...placed.map((n) => n.rank));
  return {
    nodes: placed,
    edges: edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label ?? null,
      back: back.has(e.id),
      lane: lane.get(e.id) ?? 0,
    })),
    regions,
    width: originX + cols * colW + (cols - 1) * GRAPH_GAP_X + GRAPH_PAD,
    height: GRAPH_PAD * 2 + (maxRank + 1) * GRAPH_NODE_H + maxRank * GRAPH_GAP_Y,
    loops: lanes,
    cols,
    colW,
  };
}

/** How many pairs of forward edges cross, each taken as the straight line from the foot of its source to the top of its target. */
export function countCrossings(g: WorkflowGraph): number {
  const at = new Map(g.nodes.map((n) => [n.id, n]));
  const segs = g.edges
    .filter((e) => !e.back)
    .map((e) => {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      return { from: e.from, to: e.to, x1: a.x + a.w / 2, y1: a.y + GRAPH_NODE_H, x2: b.x + b.w / 2, y2: b.y };
    });
  const side = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!;
      const t = segs[j]!;
      if (s.from === t.from || s.to === t.to || s.from === t.to || s.to === t.from) continue;
      const d1 = side(s.x1, s.y1, s.x2, s.y2, t.x1, t.y1);
      const d2 = side(s.x1, s.y1, s.x2, s.y2, t.x2, t.y2);
      const d3 = side(t.x1, t.y1, t.x2, t.y2, s.x1, s.y1);
      const d4 = side(t.x1, t.y1, t.x2, t.y2, s.x2, s.y2);
      if (d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) n += 1;
    }
  }
  return n;
}
