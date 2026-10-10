/* ══════════════════════════════════════════════════════════════════════════
   DIFF AND HOTSPOTS — what the branch changes, and where change is risky
   packages/web2/src/canvas/views/historyModel.ts

   Pure. Both views put git history (GET /api/git/branch-files, GET
   /api/git/churn, analyzer gitHistory.ts) onto the boxes the Map draws:
   a changed file belongs to the deepest drawn box above it (the scan's file
   node, or for a file the scan has no node for, such as a deleted one, the
   drawn box whose path holds it).

   Diff: a box is "changed" when the branch changes any file under it, and
   "added" when every file the scan has under it is new on the branch. A line
   is "touched" when an edge it stands for has evidence in a changed file.
   A module the branch deleted whole has no box (the scan is of this
   checkout), so it is drawn as a ghost: a directory one level below a drawn
   group (or beside the top-level boxes) where every deleted file was, no
   scanned file remains, and at least one deleted file has an extension the
   scan reads (so a removed docs folder is not drawn as code).

   Hotspots: heat(box) = sum over files under it of pageRank(file) x commits
   to that file in the window = commits x centrality, where centrality is
   the commit-weighted mean pageRank of its changed files, shown relative to
   the most central box (1). Rank 1 is the riskiest box; a box with no heat
   has no rank.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ArchGraph } from '@sequence/schema';

import { liftTo } from '../composite.js';
import type { ViewBox } from './viewModel.js';

export interface BranchFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  from?: string;
}

const posix = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** path -> the drawn box it belongs to, for every path the scan knows plus
 *  any path under a drawn box's own path. */
export function boxOfPath(graph: ArchGraph, boxes: readonly ViewBox[]): (path: string) => string | undefined {
  const drawn = new Set(boxes.map((b) => b.id));
  const lift = liftTo(graph, drawn);
  const byPath = new Map<string, string>();
  for (const n of graph.nodes) if (n.path) byPath.set(posix(n.path), n.id);
  const dirs = graph.nodes
    .filter((n) => n.path && n.kind !== 'file')
    .map((n) => ({ dir: posix(n.path!).replace(/\/$/, ''), id: n.id }))
    .sort((a, b) => b.dir.length - a.dir.length);
  return (path: string) => {
    const p = posix(path);
    const exact = byPath.get(p);
    if (exact) return lift(exact);
    const holder = dirs.find((d) => d.dir !== '' && (p === d.dir || p.startsWith(`${d.dir}/`)));
    return holder ? lift(holder.id) : undefined;
  };
}

export interface DiffBox {
  id: string;
  status: 'added' | 'changed';
  files: BranchFile[];
}

export interface DiffLine {
  source: string;
  target: string;
  /** Evidence lines in changed files. */
  links: number;
}

export interface DiffModel {
  boxes: DiffBox[];
  lines: DiffLine[];
  /** Modules the branch deleted whole, drawn as ghosts. */
  removed: RemovedBox[];
  /** Changed files that land on no drawn box (docs, root files). */
  elsewhere: BranchFile[];
}

/** Ghost box ids start with this; they are never scan ids. */
export const REMOVED_PREFIX = 'removed:';

export interface RemovedBox {
  id: string;
  label: string;
  /** The deleted directory. */
  dir: string;
  /** The drawn group it sat in; absent beside the top-level boxes. */
  parentId?: string;
  files: BranchFile[];
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const under = (p: string, dir: string) => dir === '' || p.startsWith(`${dir}/`);
const extOf = (p: string) => (/\.[^./]+$/.exec(p)?.[0] ?? '').toLowerCase();

/** The modules the branch deleted whole (see the header). */
export function removedModules(graph: ArchGraph, boxes: readonly ViewBox[], files: readonly BranchFile[]): RemovedBox[] {
  const deleted = files.filter((f) => f.status === 'deleted');
  if (deleted.length === 0) return [];
  const live = new Set<string>();
  const exts = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind !== 'file' || !n.path) continue;
    const p = posix(n.path);
    exts.add(extOf(p));
    for (let d = dirOf(p); d !== ''; d = dirOf(d)) live.add(d);
  }
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const containers = boxes.flatMap((b) => {
    const n = nodeById.get(b.id);
    const dir = n?.path && n.kind !== 'file' ? posix(n.path).replace(/\/$/, '') : '';
    return dir ? [{ id: b.id, dir, parent: b.parentId ?? '' }] : [];
  });
  const framed = new Set(boxes.flatMap((b) => (b.parentId ? [b.parentId] : [])));
  const drawnDirs = new Set(containers.map((c) => c.dir));
  /* Where a ghost would sit beside its siblings: the parent directories of
     the boxes drawn at that level ('' is the top level). */
  const rootsAt = (parent: string) => [...new Set(containers.filter((c) => c.parent === parent).map((c) => dirOf(c.dir)))];
  const longest = <T>(xs: T[], len: (x: T) => number) => xs.sort((a, b) => len(b) - len(a))[0];
  const out = new Map<string, RemovedBox>();
  for (const f of deleted) {
    const p = posix(f.path);
    const holder = longest(
      containers.filter((c) => under(p, c.dir)),
      (c) => c.dir.length,
    );
    /* Inside a closed box the deletion is a change to that box. */
    if (holder && !framed.has(holder.id)) continue;
    const root = longest(
      rootsAt(holder?.id ?? '').filter((d) => under(p, d) && (!holder || under(d, holder.dir) || d === holder.dir)),
      (d) => d.length,
    );
    if (root === undefined) continue;
    const rest = root === '' ? p : p.slice(root.length + 1);
    const slash = rest.indexOf('/');
    if (slash < 0) continue;
    const dir = (root === '' ? '' : `${root}/`) + rest.slice(0, slash);
    if (live.has(dir) || drawnDirs.has(dir)) continue;
    const id = `${REMOVED_PREFIX}${dir}`;
    const box = out.get(id) ?? { id, label: dir.slice(dir.lastIndexOf('/') + 1), dir, ...(holder ? { parentId: holder.id } : {}), files: [] };
    box.files.push(f);
    out.set(id, box);
  }
  return [...out.values()]
    .filter((b) => b.files.some((f) => exts.has(extOf(posix(f.path)))))
    .map((b) => ({ ...b, files: b.files.sort((x, y) => x.path.localeCompare(y.path)) }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

/** What the Map draws for a diff: a status per box, and the ghosts. */
export interface DiffMarks {
  marks: Record<string, 'added' | 'changed' | 'removed'>;
  ghosts: Array<{ id: string; label: string; parentId?: string }>;
}

export function diffMarks(model: DiffModel): DiffMarks {
  const marks: DiffMarks['marks'] = {};
  for (const b of model.boxes) marks[b.id] = b.status;
  for (const r of model.removed) marks[r.id] = 'removed';
  return {
    marks,
    ghosts: model.removed.map((r) => ({ id: r.id, label: r.label, ...(r.parentId ? { parentId: r.parentId } : {}) })),
  };
}

export function diffModel(
  graph: ArchGraph,
  allBoxes: readonly ViewBox[],
  pairs: ReadonlyArray<{ source: string; target: string }>,
  files: readonly BranchFile[],
): DiffModel {
  /* The ghosts this model drew come back in the Map's boxes: not inputs. */
  const boxes = allBoxes.filter((b) => !b.id.startsWith(REMOVED_PREFIX));
  const removed = removedModules(graph, boxes, files);
  const onGhost = new Set(removed.flatMap((r) => r.files));
  const boxOf = boxOfPath(graph, boxes);
  const changed = new Map<string, BranchFile[]>();
  const elsewhere: BranchFile[] = [];
  for (const f of files) {
    if (onGhost.has(f)) continue;
    const id = boxOf(f.path) ?? (f.from ? boxOf(f.from) : undefined);
    if (!id) {
      elsewhere.push(f);
      continue;
    }
    const list = changed.get(id) ?? [];
    list.push(f);
    changed.set(id, list);
  }
  /* "added": every file the scan has under the box is new on the branch. */
  const drawn = new Set(boxes.map((b) => b.id));
  const lift = liftTo(graph, drawn);
  const scanFiles = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (n.kind !== 'file' || !n.path) continue;
    const id = lift(n.id);
    if (!id) continue;
    const list = scanFiles.get(id) ?? [];
    list.push(posix(n.path));
    scanFiles.set(id, list);
  }
  const added = new Set(files.filter((f) => f.status === 'added').map((f) => posix(f.path)));
  const order = new Map(boxes.map((b, i) => [b.id, i]));
  const outBoxes: DiffBox[] = [...changed.entries()]
    .map(([id, fs]) => {
      const own = scanFiles.get(id) ?? [];
      const status: DiffBox['status'] = own.length > 0 && own.every((p) => added.has(p)) ? 'added' : 'changed';
      return { id, status, files: [...fs].sort((a, b) => a.path.localeCompare(b.path)) };
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const changedPaths = new Set(files.flatMap((f) => [posix(f.path), ...(f.from ? [posix(f.from)] : [])]));
  const wanted = new Set(pairs.map((p) => `${p.source}->${p.target}`));
  const links = new Map<string, number>();
  for (const e of graph.edges) {
    const a = lift(e.srcId);
    const b = lift(e.dstId);
    if (!a || !b || a === b) continue;
    const k = `${a}->${b}`;
    if (!wanted.has(k)) continue;
    const n = (e.evidence ?? []).filter((ev) => changedPaths.has(posix(ev.file))).length;
    if (n > 0) links.set(k, (links.get(k) ?? 0) + n);
  }
  const outLines: DiffLine[] = pairs
    .filter((p) => links.has(`${p.source}->${p.target}`))
    .map((p) => ({ source: p.source, target: p.target, links: links.get(`${p.source}->${p.target}`)! }));
  return { boxes: outBoxes, lines: outLines, removed, elsewhere: elsewhere.sort((a, b) => a.path.localeCompare(b.path)) };
}

export interface HotBox {
  id: string;
  heat: number;
  commits: number;
  /** Commit-weighted mean pageRank of the box's changed files, over the
   *  highest on the board (1). heat is proportional to commits x centrality. */
  centrality: number;
  /** 1 = riskiest; boxes with no heat have none. */
  rank: number;
}

export function heatModel(graph: ArchGraph, boxes: readonly ViewBox[], churn: Readonly<Record<string, number>>): HotBox[] {
  const drawn = new Set(boxes.map((b) => b.id));
  const lift = liftTo(graph, drawn);
  const heat = new Map<string, { heat: number; commits: number }>();
  const counts = new Map(Object.entries(churn).map(([p, n]) => [posix(p), n]));
  for (const n of graph.nodes) {
    if (n.kind !== 'file' || !n.path) continue;
    const c = counts.get(posix(n.path)) ?? 0;
    if (c === 0) continue;
    const id = lift(n.id);
    if (!id) continue;
    const pr = typeof n.meta?.pageRank === 'number' ? n.meta.pageRank : 0;
    const h = heat.get(id) ?? { heat: 0, commits: 0 };
    h.heat += pr * c;
    h.commits += c;
    heat.set(id, h);
  }
  const label = new Map(boxes.map((b) => [b.id, b.label]));
  const hot = [...heat.entries()].filter(([, h]) => h.heat > 0);
  const top = Math.max(0, ...hot.map(([, h]) => h.heat / h.commits));
  return hot
    .sort((a, b) => b[1].heat - a[1].heat || (label.get(a[0]) ?? a[0]).localeCompare(label.get(b[0]) ?? b[0]))
    .map(([id, h], i) => ({
      id,
      heat: Math.round(h.heat * 1000) / 1000,
      commits: h.commits,
      centrality: Math.round((h.heat / h.commits / top) * 100) / 100,
      rank: i + 1,
    }));
}
