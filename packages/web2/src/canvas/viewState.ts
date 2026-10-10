/* ══════════════════════════════════════════════════════════════════════════
   BOARD VIEW STATE — what the reader has opened, and the URL that keeps it
   packages/web2/src/canvas/viewState.ts

   docs/research/overhaul-formats-v2.md §3.2. Pure: the state, its URL-hash
   form, the 50-box budget rule, the focus neighbourhood and path tracing.

   THE HASH is bare tokens joined by '.', so a view survives a reload and can
   be shared: `#map.f-svc_orders.p1.x-svc_orders+svc_payments`.
     map|flow|grid|diff|hotspots   the view (always first)
     x-<id>+<id>                   expanded, in the order they were expanded
     f-<id>  p<1..3>               focus and its proximity in hops
     h-<id>+<id>                   hidden
     o-<id>+<id>                   the drawn-alone path (Focus on a group, one
                                   level per id) — an addition to §3.2, which
                                   has no token for it
     i                             imports shown
     lr | tb                       a direction the reader chose; absent = the
                                   pane's shape decides (§3.2 says default LR;
                                   a tall pane fits a top-down layout larger)
     ao0                           agent overlay off
   An id is URL-encoded, with ':' written as '_' (so `svc:orders` reads
   `svc_orders`) and a literal '_', '.' or '+' escaped, so every id
   round-trips.
   ══════════════════════════════════════════════════════════════════════════ */

export type BoardView = 'map' | 'flow' | 'grid' | 'diff' | 'hotspots';

export interface BoardViewState {
  view: BoardView;
  /** Ids opened in place, least recently expanded first. */
  expanded: string[];
  focus?: string;
  proximity: 1 | 2 | 3;
  hidden: string[];
  showImports: boolean;
  /** null: chosen by the pane's shape. */
  dir: 'LR' | 'TB' | null;
  agentOverlay: boolean;
  /** Groups drawn alone, outermost first. */
  opened: string[];
}

export const DEFAULT_VIEW_STATE: BoardViewState = {
  view: 'map',
  expanded: [],
  proximity: 1,
  hidden: [],
  showImports: false,
  dir: null,
  agentOverlay: true,
  opened: [],
};

const VIEWS: readonly BoardView[] = ['map', 'flow', 'grid', 'diff', 'hotspots'];

export function encodeId(id: string): string {
  return encodeURIComponent(id)
    .replace(/_/g, '%5F')
    .replace(/\./g, '%2E')
    .replace(/\+/g, '%2B')
    .replace(/%3A/gi, '_');
}

export function decodeId(token: string): string {
  try {
    return decodeURIComponent(token.replace(/_/g, '%3A'));
  } catch {
    return token;
  }
}

const list = (ids: readonly string[]) => ids.map(encodeId).join('+');
const unlist = (s: string) => s.split('+').filter(Boolean).map(decodeId);

export function toHash(state: BoardViewState): string {
  const t: string[] = [state.view];
  if (state.opened.length) t.push(`o-${list(state.opened)}`);
  if (state.focus) {
    t.push(`f-${encodeId(state.focus)}`);
    t.push(`p${state.proximity}`);
  }
  if (state.expanded.length) t.push(`x-${list(state.expanded)}`);
  if (state.hidden.length) t.push(`h-${list(state.hidden)}`);
  if (state.showImports) t.push('i');
  if (state.dir) t.push(state.dir === 'TB' ? 'tb' : 'lr');
  if (!state.agentOverlay) t.push('ao0');
  return `#${t.join('.')}`;
}

/** Reads a hash back; anything it does not recognise is ignored, so an old or
 *  hand-edited link still opens the board. */
export function fromHash(hash: string): BoardViewState {
  const out: BoardViewState = { ...DEFAULT_VIEW_STATE, expanded: [], hidden: [], opened: [] };
  const body = hash.replace(/^#/, '');
  if (!body) return out;
  for (const token of body.split('.')) {
    if ((VIEWS as readonly string[]).includes(token)) out.view = token as BoardView;
    else if (token.startsWith('x-')) out.expanded = unlist(token.slice(2));
    else if (token.startsWith('h-')) out.hidden = unlist(token.slice(2));
    else if (token.startsWith('o-')) out.opened = unlist(token.slice(2));
    else if (token.startsWith('f-')) out.focus = decodeId(token.slice(2));
    else if (/^p[123]$/.test(token)) out.proximity = Number(token.slice(1)) as 1 | 2 | 3;
    else if (token === 'i') out.showImports = true;
    else if (token === 'tb') out.dir = 'TB';
    else if (token === 'lr') out.dir = 'LR';
    else if (token === 'ao0') out.agentOverlay = false;
  }
  return out;
}

/** True when a hash is a board view (so the board does not claim other hashes). */
export function isBoardHash(hash: string): boolean {
  const first = hash.replace(/^#/, '').split('.')[0] ?? '';
  return (VIEWS as readonly string[]).includes(first);
}

/**
 * THE BUDGET RULE. Expanding `id` puts it last (most recent). While the board
 * would draw more than `budget` boxes, the least recently expanded SIBLING of
 * `id` (same parent, or both top-level) is collapsed. Whatever is still over
 * rolls into the group's +N chip (compositeDocument caps the members).
 *
 * `boxesFor` counts the boxes a list would draw with no cap.
 */
export function expandWithBudget(
  expanded: readonly string[],
  id: string,
  parentOf: (id: string) => string | undefined,
  boxesFor: (expanded: readonly string[]) => number,
  budget = 50,
): string[] {
  let next = [...expanded.filter((e) => e !== id), id];
  const parent = parentOf(id);
  while (boxesFor(next) > budget) {
    const victim = next.find((e) => e !== id && parentOf(e) === parent);
    if (!victim) break;
    /* Collapsing a group also collapses anything expanded inside it. */
    next = collapse(next, victim, parentOf);
  }
  return next;
}

/** Collapse `id` and everything expanded inside it. */
export function collapse(
  expanded: readonly string[],
  id: string,
  parentOf: (id: string) => string | undefined,
): string[] {
  const drop = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of expanded) {
      const p = parentOf(e);
      if (p && drop.has(p) && !drop.has(e)) {
        drop.add(e);
        grew = true;
      }
    }
  }
  return expanded.filter((e) => !drop.has(e));
}

/** Ids within `hops` of `focus` over the drawn edges, either direction. */
export function neighbourhood(
  focus: string,
  edges: ReadonlyArray<{ source: string; target: string }>,
  hops: number,
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const seen = new Set([focus]);
  let frontier = [focus];
  for (let h = 0; h < hops; h += 1) {
    const next: string[] = [];
    for (const id of frontier) for (const n of adj.get(id) ?? []) if (!seen.has(n)) (seen.add(n), next.push(n));
    frontier = next;
  }
  return seen;
}

/** The shortest directed path from `start` to `end` over the drawn edges (an
 *  undirected one if no directed path exists), as node and edge ids; null when
 *  the two are not connected. */
export function tracePath(
  start: string,
  end: string,
  edges: ReadonlyArray<{ id: string; source: string; target: string }>,
): { nodeIds: string[]; edgeIds: string[]; directed: boolean } | null {
  const run = (directed: boolean) => {
    const adj = new Map<string, Array<{ to: string; edge: string }>>();
    const add = (a: string, b: string, edge: string) =>
      (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, edge });
    for (const e of edges) {
      add(e.source, e.target, e.id);
      if (!directed) add(e.target, e.source, e.id);
    }
    const prev = new Map<string, { from: string; edge: string }>();
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === end) break;
      for (const { to, edge } of adj.get(cur) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        prev.set(to, { from: cur, edge });
        queue.push(to);
      }
    }
    if (start !== end && !prev.has(end)) return null;
    const nodeIds = [end];
    const edgeIds: string[] = [];
    let cur = end;
    while (cur !== start) {
      const p = prev.get(cur)!;
      edgeIds.unshift(p.edge);
      nodeIds.unshift(p.from);
      cur = p.from;
    }
    return { nodeIds, edgeIds, directed };
  };
  return run(true) ?? run(false);
}
