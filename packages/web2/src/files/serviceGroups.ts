import type { GetArchGraphResponse } from '@sequence/api-types';

import { buildRailRows } from '../rail/railModel';
import { flattenFileTree } from './filesModel';
import type { FileRow, FileStatus, FileTreeNode, RepoPath } from './filesModel';

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THE SCAN KNOWS ABOUT SERVICES, AS THE FILES TREE NEEDS IT
   packages/web2/src/files/serviceGroups.ts

   Two of the four pieces the retired Index rail left to Files (owner ruling,
   docs/plans/0.1.9/HANDOFF.md, 2026-10-14) are pure functions of the scan:

     unscannedNote   "N source files outside every service were not read - ..."
     groupByService  the files of each board card (service, datastore, topic),
                     for the optional group-by-service view

   Both read the arch graph as it is and invent nothing: no `unscanned` field
   (an older scan, a static origin) is no note, and a card with no files under
   it is no group.
   ═══════════════════════════════════════════════════════════════════════════ */

type ScannedGraph = GetArchGraphResponse;

/**
 * The disclosure sentence, or null when there is nothing to disclose.
 *
 * Counted from `graph.unscanned` (the scanner's own list of directories holding
 * source files that no service claimed), the two biggest regions named, the
 * rest counted. A graph without the field says nothing: the absence of the
 * field is not a claim that nothing was missed, and "0 files" would be one.
 */
export function unscannedNote(graph: ScannedGraph | null | undefined): string | null {
  const regions = (graph as { unscanned?: { dir: string; files: number }[] } | null | undefined)?.unscanned;
  if (!regions || regions.length === 0) return null;
  const files = regions.reduce((n, r) => n + r.files, 0);
  if (files === 0) return null;
  const named = regions
    .slice(0, 2)
    .map((r) => `${r.dir} (${r.files})`)
    .join(', ');
  const rest = regions.length > 2 ? `, +${regions.length - 2} more` : '';
  return `${files} source file${files === 1 ? '' : 's'} outside every service ${files === 1 ? 'was' : 'were'} not read — ${named}${rest}.`;
}

export interface ServiceGroup {
  /** The board card's node id. */
  id: string;
  /** The card's label: the service's own name. */
  label: string;
  /** The files the scan put under this card, in path order. */
  paths: readonly RepoPath[];
}

/** The card -> files table the rail's rows already derive, without the function rungs. */
export function groupByService(graph: ScannedGraph | null | undefined): ServiceGroup[] {
  if (!graph) return [];
  const groups: { id: string; label: string; paths: RepoPath[] }[] = [];
  for (const row of buildRailRows(graph, null)) {
    if (row.rung === 'card') groups.push({ id: row.id, label: row.label, paths: [] });
    else if (row.rung === 'file') groups[groups.length - 1]?.paths.push(row.path);
  }
  return groups.filter((g) => g.paths.length > 0);
}

/** Label for the files no card claims. Said as what it is, not as a service. */
export const UNGROUPED_LABEL = 'Outside every service';

export interface GroupHeader {
  id: string;
  label: string;
  /** Files of this group that the filter leaves visible. */
  count: number;
  /** Whether the group lists its files (the reader's choice, else open only when everything fits the cap). */
  open: boolean;
}

/** What the grouped list draws, in order. `row` points into {@link GroupedRows.rows}. */
export type GroupItem =
  | { type: 'head'; header: GroupHeader }
  | { type: 'row'; index: number }
  | { type: 'more'; id: string; label: string; omitted: number };

export interface GroupedRows {
  /** The file rows actually listed (what the keyboard walks), in order. */
  rows: FileRow[];
  /** Heads, rows and "+N more in <service>" rows, in the order they are drawn. */
  items: GroupItem[];
  /** Always 0: a capped group says so on its own "+N more" row. */
  omitted: number;
}

/** The directory every path in the list shares (no trailing slash), '' when none. */
function commonDir(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((p) => p.split('/').slice(0, -1));
  const first = split[0]!;
  let n = first.length;
  for (const parts of split) {
    let i = 0;
    while (i < n && i < parts.length && parts[i] === first[i]) i += 1;
    n = i;
  }
  return first.slice(0, n).join('/');
}

/**
 * `dirs` (folders per row) written out row by row with the folders that tell nothing replaced by `…`: the ones most
 * rows share (`agents`, `skills`) go first, and a folder is blanked only while the row still reads differently from every
 * other row. Runs of blanks are one `…`.
 */
function blankedKeys(dirs: readonly string[][]): string[] {
  const shared = new Map<string, number>();
  for (const d of dirs) for (const seg of new Set(d)) shared.set(seg, (shared.get(seg) ?? 0) + 1);
  const draw = (d: readonly string[], blank: ReadonlySet<number>): string => {
    const parts: string[] = [];
    d.forEach((seg, j) => {
      if (!blank.has(j)) parts.push(seg);
      else if (parts[parts.length - 1] !== '…') parts.push('…');
    });
    return parts.length === 0 ? '' : `${parts.join('/')}/`;
  };
  const keys = dirs.map((d) => draw(d, new Set()));
  const taken = new Map<string, number>(keys.map((k, i) => [k, i]));
  dirs.forEach((d, i) => {
    const blank = new Set<number>();
    const order = d.map((_, j) => j).sort((x, y) => (shared.get(d[y]!) ?? 0) - (shared.get(d[x]!) ?? 0) || x - y);
    for (const j of order) {
      if (blank.size + 1 >= d.length) break; /* a row keeps at least one folder: "…/" alone says nothing */
      blank.add(j);
      const next = draw(d, blank);
      const owner = taken.get(next);
      if (owner !== undefined && owner !== i) blank.delete(j);
      else {
        taken.delete(keys[i]!);
        keys[i] = next;
        taken.set(next, i);
      }
    }
  });
  return keys;
}

/** A folder hint this many characters or fewer is taken as soon as it tells the set apart, in preference order. */
const SHORT_NEED = 24;

/**
 * Two rows of one group with the SAME file name (`noMiddleDot.test.ts` in `src/` and in `src/settings/`, `SKILL.md` under
 * `.agents/` and under `.cursor/`) read the same unless their folders show. Gives each the fewest folders of its
 * directory that tell the set apart (`dirNeed`: `settings/`, or `.agents/…/` when it is the front that differs), which the
 * renderer then refuses to cut.
 */
export function markSharedNames(rows: readonly FileRow[]): void {
  const byName = new Map<string, FileRow[]>();
  for (const r of rows) {
    const set = byName.get(r.label);
    if (set) set.push(r);
    else byName.set(r.label, [r]);
  }
  for (const set of byName.values()) {
    if (set.length < 2) continue;
    const segs = set.map((r) => (r.dir ? r.dir.split('/') : []));
    const longest = Math.max(...segs.map((x) => x.length));
    /* WHICH FOLDERS TELL THE SET APART: a run anywhere in the directory (the nearest, `settings/`; the first,
       `.agents/…/`; a middle one, `…/shopfront/…/`), or the first folder AND the nearest (`.agents/…/agency-loop/`)
       when no one run does. The shortest text that makes every row of the set read differently wins; a row whose
       directory is too short for the pattern shows all of it. */
    const whole = (x: string[]) => (x.length === 0 ? '' : `${x.join('/')}/`);
    const run = (x: string[], fromEnd: boolean, offset: number, len: number): string => {
      const start = fromEnd ? x.length - offset - len : offset;
      const end = start + len;
      if (x.length === 0 || start < 0 || end > x.length) return whole(x);
      const lead = start > 0 && !(fromEnd && offset === 0) ? '…/' : '';
      const trail = end < x.length ? '…/' : '';
      return `${lead}${x.slice(start, end).join('/')}/${trail}`;
    };
    const ends = (x: string[], front: number, back: number): string =>
      x.length === 0 || front + back >= x.length ? whole(x) : `${x.slice(0, front).join('/')}/…/${x.slice(-back).join('/')}/`;
    const patterns: ((x: string[]) => string)[] = [];
    for (let len = 1; len < longest; len += 1) {
      for (const fromEnd of [true, false]) {
        for (let offset = 0; offset + len <= longest; offset += 1) patterns.push((x) => run(x, fromEnd, offset, len));
      }
    }
    for (let front = 1; front < longest; front += 1) {
      for (let back = 1; front + back < longest; back += 1) patterns.push((x) => ends(x, front, back));
    }
    patterns.push(whole);
    let best: string[] | null = null;
    let bestCost = Infinity;
    let bestMax = Infinity;
    for (const pattern of patterns) {
      const keys = segs.map(pattern);
      if (new Set(keys).size !== set.length) continue;
      const cost = keys.reduce((n, k) => n + k.length, 0);
      if (cost < bestCost) {
        best = keys;
        bestCost = cost;
        bestMax = Math.max(...keys.map((k) => k.length));
      }
      /* The first in the order above that is short enough wins: the nearest folder reads better than the shortest. */
      if (bestMax <= SHORT_NEED) break;
    }
    /* No short pattern did it: write each row with only the folders that tell it apart from the rest. */
    if (bestMax > SHORT_NEED) {
      const keys = blankedKeys(segs);
      const cost = keys.reduce((n, k) => n + k.length, 0);
      if (cost < bestCost && new Set(keys).size === set.length) {
        best = keys;
        bestCost = cost;
      }
    }
    set.forEach((r, i) => {
      r.dirNeed = best![i]!;
      r.dirNeedSet = best!;
    });
  }
}

/**
 * The visible files of `nodes` (so the filter still applies), regrouped under
 * the services that own them. Files no card claims come last, under
 * {@link UNGROUPED_LABEL}. Rows are flat (a service's files are listed by path
 * relative to what they share): a directory can span two services, and a
 * directory row drawn twice would be one expansion key for two rows.
 *
 * EVERY GROUP'S HEAD IS ALWAYS LISTED, with its file count; the files are what
 * folds. A group is open by the reader's say (`groupOpen`), and otherwise open
 * only when all the visible files fit the cap: on a 900-file service the first
 * group used to fill the cap and the other services could not be reached. The
 * cap now applies to each open group on its own, and a capped group ends in a
 * "+N more in <service>" row (`showAll` lifts it for that group).
 *
 * A row's label is its file NAME and `dir` the directory it sits in, relative
 * to what the group shares, so the renderer can cut the directory first and
 * never the name.
 */
export function groupedRows(
  nodes: FileTreeNode[],
  groups: readonly ServiceGroup[],
  options: {
    status?: ReadonlyMap<RepoPath, FileStatus> | null;
    progress?: ReadonlySet<RepoPath> | null;
    cap: number;
    groupOpen?: ReadonlyMap<string, boolean> | null;
    showAll?: ReadonlySet<string> | null;
  },
): GroupedRows {
  const flat = flattenFileTree(nodes, {
    expanded: 'all',
    status: options.status ?? null,
    progress: options.progress ?? null,
    cap: Number.MAX_SAFE_INTEGER,
  });
  const visible = new Map<string, FileRow>();
  for (const row of flat.rows) if (row.kind === 'file') visible.set(row.path, row);

  const place = (row: FileRow, cut: number): FileRow => {
    const rel = row.path.slice(cut);
    const slash = rel.lastIndexOf('/');
    return { ...row, label: rel.slice(slash + 1), dir: slash < 0 ? '' : rel.slice(0, slash), depth: 1 };
  };

  const claimed = new Set<string>();
  const sections: { id: string; label: string; rows: FileRow[] }[] = [];
  for (const group of groups) {
    const prefix = commonDir(group.paths);
    const cut = prefix === '' ? 0 : prefix.length + 1;
    const rows: FileRow[] = [];
    for (const path of group.paths) {
      claimed.add(path);
      const row = visible.get(path);
      if (row) rows.push(place(row, cut));
    }
    if (rows.length > 0) sections.push({ id: group.id, label: group.label, rows });
  }
  const restPaths: string[] = [];
  for (const path of visible.keys()) if (!claimed.has(path)) restPaths.push(path);
  if (restPaths.length > 0) {
    const prefix = commonDir(restPaths);
    const cut = prefix === '' ? 0 : prefix.length + 1;
    sections.push({ id: 'ungrouped', label: UNGROUPED_LABEL, rows: restPaths.map((p) => place(visible.get(p)!, cut)) });
  }

  for (const section of sections) {
    const names = section.rows.map((r) => r.label);
    for (const row of section.rows) row.peers = names;
    markSharedNames(section.rows);
  }

  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  const fits = total <= options.cap;
  const rows: FileRow[] = [];
  const items: GroupItem[] = [];
  for (const section of sections) {
    const open = options.groupOpen?.get(section.id) ?? fits;
    items.push({ type: 'head', header: { id: section.id, label: section.label, count: section.rows.length, open } });
    if (!open) continue;
    const shown = options.showAll?.has(section.id) === true ? section.rows : section.rows.slice(0, options.cap);
    for (const row of shown) {
      items.push({ type: 'row', index: rows.length });
      rows.push(row);
    }
    if (shown.length < section.rows.length) {
      items.push({ type: 'more', id: section.id, label: section.label, omitted: section.rows.length - shown.length });
    }
  }
  return { rows, items, omitted: 0 };
}

/** The group that owns a path, or a directory (the group holding the most files under it); null when none does. */
export function groupOfPath(groups: readonly ServiceGroup[], target: string): string | null {
  let best: { id: string; n: number } | null = null;
  for (const group of groups) {
    if (group.paths.includes(target as RepoPath)) return group.id;
    const n = group.paths.filter((p) => p.startsWith(`${target}/`)).length;
    if (n > 0 && (best === null || n > best.n)) best = { id: group.id, n };
  }
  return best?.id ?? null;
}
