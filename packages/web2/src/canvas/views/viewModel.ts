/* ══════════════════════════════════════════════════════════════════════════
   BOARD VIEWS — the shared model the Grid and Flow views read
   packages/web2/src/canvas/views/viewModel.ts

   Pure. Both views show exactly what the Map shows: the boxes it draws and
   the lines it draws (one per directed pair, edgeLines.ts), so a view differs
   from the Map only in how it presents them. Stream 3b, Slice B; the A/B that
   decides whether a view ships is registered in lab/log.md (2026-10-05).
   ══════════════════════════════════════════════════════════════════════════ */

export interface ViewBox {
  id: string;
  label: string;
  /** The group this box is drawn inside, if any. */
  parentId?: string;
}

export interface ViewLine {
  source: string;
  target: string;
  /** What the line stands for ("2 http · 14 imports"), when known. */
  title?: string;
  /** How many edges the line merges; 1 when it is one. */
  count: number;
}

export type SwitchableView = 'map' | 'grid' | 'flow' | 'diff' | 'hotspots';

/**
 * Which views can be opened. A view joins only after it wins its A/B
 * (registered in lab/log.md, 2026-10-05; tools/measure/board-views-ab.mjs):
 *   grid  won on 3 of 3 repos: kept.
 *   flow  won on 1 of 3 (ml-harness only): discarded, left here disabled.
 *   diff      won on 3 of 3 repos (one scored run): kept.
 *   hotspots  won on 3 of 3 repos (one scored run): kept.
 */
export const VIEW_ENABLED: Readonly<Record<SwitchableView, boolean>> = {
  map: true,
  grid: true,
  flow: false,
  diff: true,
  hotspots: true,
};

/** The views the switcher offers, in order: Map first. */
export const SWITCHER_VIEWS: readonly SwitchableView[] = (['map', 'grid', 'diff', 'hotspots', 'flow'] as const).filter(
  (v) => VIEW_ENABLED[v],
);

/** Ctrl/Cmd+1..N picks the Nth view; anything else is not a view shortcut. */
export function viewForShortcut(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  views: readonly SwitchableView[] = SWITCHER_VIEWS,
): SwitchableView | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  if (!/^[1-5]$/.test(e.key)) return null;
  return views[Number(e.key) - 1] ?? null;
}

/** One line per directed pair between two drawn boxes, self pairs dropped. */
export function linesOf(
  boxes: readonly ViewBox[],
  edges: ReadonlyArray<{ source: string; target: string; title?: string; label?: string; merged?: number }>,
): ViewLine[] {
  const ids = new Set(boxes.map((b) => b.id));
  const out = new Map<string, ViewLine>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    const k = `${e.source}->${e.target}`;
    const had = out.get(k);
    const title = e.title ?? e.label;
    if (had) {
      had.count += e.merged ?? 1;
      continue;
    }
    out.set(k, { source: e.source, target: e.target, ...(title ? { title } : {}), count: e.merged ?? 1 });
  }
  return [...out.values()];
}

/** Boxes in reading order: each group directly followed by its members,
 *  top-level boxes in the board's own order. */
export function readingOrder(boxes: readonly ViewBox[]): ViewBox[] {
  const ids = new Set(boxes.map((b) => b.id));
  const kids = new Map<string, ViewBox[]>();
  const roots: ViewBox[] = [];
  for (const b of boxes) {
    if (b.parentId && ids.has(b.parentId)) {
      const list = kids.get(b.parentId) ?? [];
      list.push(b);
      kids.set(b.parentId, list);
    } else roots.push(b);
  }
  const out: ViewBox[] = [];
  const walk = (b: ViewBox) => {
    out.push(b);
    for (const k of kids.get(b.id) ?? []) walk(k);
  };
  for (const r of roots) walk(r);
  return out;
}

/** The shortest directed path from `from` to `to` over the lines, as the
 *  lines walked in order; null when there is none; [] when from === to. */
export function shortestPath(lines: readonly ViewLine[], from: string, to: string): ViewLine[] | null {
  if (from === to) return [];
  const out = new Map<string, ViewLine[]>();
  for (const l of lines) {
    const list = out.get(l.source) ?? [];
    list.push(l);
    out.set(l.source, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.target.localeCompare(b.target));
  const prev = new Map<string, ViewLine>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const l of out.get(cur) ?? []) {
      if (seen.has(l.target)) continue;
      seen.add(l.target);
      prev.set(l.target, l);
      if (l.target === to) {
        const path: ViewLine[] = [];
        let at = to;
        while (at !== from) {
          const step = prev.get(at)!;
          path.unshift(step);
          at = step.source;
        }
        return path;
      }
      queue.push(l.target);
    }
  }
  return null;
}

/** A box's name in a view: its own label, with its group's when it is a
 *  member ("analyzer / Store"), so two members named index.ts differ. */
export function viewName(box: ViewBox, byId: ReadonlyMap<string, ViewBox>, display: (s: string) => string): string {
  const parent = box.parentId ? byId.get(box.parentId) : undefined;
  return parent ? `${display(parent.label)} / ${display(box.label)}` : display(box.label);
}
