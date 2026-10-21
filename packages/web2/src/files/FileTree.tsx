/* ══════════════════════════════════════════════════════════════════════════
   THE TREE — item 2.1
   packages/web2/src/files/FileTree.tsx

   The left half of the files panel: the repository as a tree you can walk with
   the keyboard, with one selected row and a mark on everything that changed.

   PRESENTATIONAL, WITHOUT EXCEPTION. No store, no fetch, no `useEffect`. Every
   piece of state it draws arrives as a prop and every gesture leaves as a
   callback, which is what lets the panel be mounted against a fixture in a test
   and against the live engine in the app with the same code path. The one thing
   it computes is the flattening, and that is computed here ON PURPOSE — see
   below.

   ── WHY THE FLATTEN LIVES INSIDE THIS COMPONENT ───────────────────────────
   The keyboard must navigate EXACTLY the rows on screen. If the parent
   flattened for the render and this component flattened again for the key
   handler, the two lists would agree until the first time one of them was
   passed a different cap or a different `expanded` set, and then Down would
   skip a row that is visibly there. One flatten, used by both, makes that
   disagreement unrepresentable rather than merely unlikely.

   ── THE FOUR NON-CHROMATIC CHANNELS, WHICH IS ALL THIS TREE SPENDS ────────
   Sheet 11.8 rule 2, written for the rail and binding here for the same reason:
   "No hue for a category. Height, indent, icon and type family tell the rows
   apart." A directory and a file differ by a chevron, a glyph, one indent step
   and a type family. Render this tree in greyscale and no row becomes
   ambiguous.

     SELECTION IS NEUTRAL, and that is sheet 11.4's explicit ruling — "selection
     is where the keyboard is, and is neutral". It gets `--state-selected`, the
     same fill the rail uses, and no hue.

     A CHANGED FILE GETS A LETTER, NOT A COLOUR. "This file is modified" is a
     fact about the world and not a verdict on it; spending --fits or --wont
     here would put the diff channel's own two hues on a row that is making no
     claim, and the diff — the one surface that legitimately owns them — would
     stop being the loudest thing in the panel. The letter is M/A/D/R/C/U/?,
     which a git user already reads, and the full word rides in the title and
     the accessible label so it survives a reader who does not.

   ── GLASS IS DELIBERATELY NOT HERE ────────────────────────────────────────
   Decision 14 closes with the limit, verbatim: "`backdrop-filter` costs a
   compositing layer per box. Glass goes on the chrome's fixed, small set of
   controls — never a list item, never a transcript row." A tree row is a list
   item and this tree can mount three hundred of them. Decision 16's frosted
   selection block names its selectors one at a time for the same reason, and
   `.files-row` is not among them.
   ══════════════════════════════════════════════════════════════════════════ */

import { isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, UIEvent } from 'react';

import { ConfirmDialog } from '../shell2/ConfirmDialog';
import { RailRow } from '../shell2/RailRow';

import { FILES } from './anchors';
import { FileContextMenu } from './FileContextMenu';
import type { FileMenuAction, FileMenuTarget } from './FileContextMenu';
import { canMoveInto, baseName, parentDir, validName } from './fileOpsModel';
import type { FileTreeOps } from './fileOpsModel';
import { FilesIcon } from './FilesIcon';
import { useBranchUi } from './branchUi';
import { useSymbolsUi } from './symbolsUi';
import { useGroupUi } from './groupUi';
import { groupedRows } from './serviceGroups';
import type { SymbolsUi } from './symbolsUi';
import { FILE_ROW_CAP, flattenFileTree, statusLetter, treeKeyAction } from './filesModel';
import type { FileRow, FileStatus, FileTreeNode, RepoPath, TreeKey } from './filesModel';

const NAV_KEYS: ReadonlySet<string> = new Set<TreeKey>([
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
  'Enter',
]);

/**
 * THE INDENT STOPS COMPOUNDING AT TEN LEVELS, AND THE NAME IS WHY.
 *
 * The rail could state that "the indent never compounds" because it is three
 * rungs deep by construction. A repository tree has no such bound, and at
 * `--rail-w` a twelfth indent step leaves under a hundred pixels for the
 * filename — so the row renders an ellipsis and nothing else, which is a row
 * that costs a line and says nothing. Past ten the rows stay aligned with each
 * other; the tree is still readable because collapsing single-child chains has
 * already removed most of the depth a monorepo carries.
 */
const MAX_INDENT = 10;
const NO_PEERS: readonly string[] = [];

/** Rows measured from the DOM once there is one: a rail row's height, the extra a group head carries above it (its margin), the tree's top padding. */
interface RowMetrics {
  row: number;
  headExtra: number;
  pad: number;
}
const DEFAULT_METRICS: RowMetrics = { row: 30, headExtra: 4, pad: 4 };
/** Where every entry of the list sits: `offs[i]` is the top of entry i (`offs[n]` the end), `keys` finds an entry by its key. */
interface RowLayout {
  keys: Map<string, number>;
  offs: number[];
  heads: Set<number>;
  pad: number;
  headExtra: number;
  /** True when only a window of the entries is mounted. */
  windowed: boolean;
}
const EMPTY_LAYOUT: RowLayout = { keys: new Map(), offs: [0], heads: new Set(), pad: 0, headExtra: 0, windowed: false };
/** A list this short is drawn whole: windowing it would save nothing. */
export const WINDOW_MIN = 120;
/** Rows kept mounted above and below the view, so a scroll (or a key repeat) lands on rows that exist. */
export const WINDOW_OVERSCAN = 8;
/** The height assumed for the first render, before the scroller has been measured. */
const ASSUMED_VIEW_PX = 900;

/** The entries [first, last) to mount for a view of `h` px scrolled to `top`. */
function windowOf(lay: RowLayout, top: number, h: number): [number, number] {
  const n = lay.offs.length - 1;
  const y0 = top - lay.pad;
  const y1 = y0 + h;
  /* the last entry starting at or above y0, and the first starting at or below y1 */
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lay.offs[mid]! <= y0) lo = mid;
    else hi = mid - 1;
  }
  const first = lo;
  lo = first;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lay.offs[mid]! >= y1) hi = mid;
    else lo = mid + 1;
  }
  return [Math.max(0, first - WINDOW_OVERSCAN), Math.min(n, lo + WINDOW_OVERSCAN)];
}
function sameWindow(lay: RowLayout, topA: number, topB: number, h: number): boolean {
  if (lay.offs.length - 1 <= WINDOW_MIN) return true;
  const a = windowOf(lay, topA, h);
  const b = windowOf(lay, topB, h);
  return a[0] === b[0] && a[1] === b[1];
}

export interface FileTreeProps {
  /** The tree, already filtered if the caller is filtering. */
  nodes: FileTreeNode[];
  /**
   * Expanded directory paths, or `'all'` — which is what a FILTERED tree wants,
   * since a reader who has just typed a query is asking to see the matches and
   * not to re-open the four directories above each one.
   */
  expanded: ReadonlySet<RepoPath> | 'all';
  /** The row the keyboard is on. Neutral, never a verdict. */
  selected: RepoPath | null;
  /** Files being edited right now (agent edit running, or an unsaved buffer): yellow, pulsing. */
  progress?: ReadonlySet<RepoPath> | null;
  /** Repo path → git status, for the changed marks. */
  status?: ReadonlyMap<RepoPath, FileStatus> | null;
  /** Mostly for tests; the product uses {@link FILE_ROW_CAP}. */
  cap?: number;
  /**
   * A folder (or file) a board card click revealed: drawn with the selected fill WITHOUT being
   * selected (a folder is not a file to load), and scrolled to the middle of the tree.
   */
  revealed?: RepoPath | null;
  /** Fires for every selection move, from the pointer and from the keyboard. */
  onSelect: (path: RepoPath) => void;
  /**
   * A directory's expansion should FLIP. Expand and collapse are one callback
   * because the caller owns the set and already knows which way it is going;
   * two callbacks would let a caller implement one and silently half-work.
   */
  onToggle: (path: RepoPath) => void;
  /** A file was activated — clicked, or Enter'd. */
  onOpen: (path: RepoPath) => void;
  /** Said when there is nothing to draw. Never a blank box. */
  emptyNote?: string;
  /** The tree's accessible name. */
  label?: string;
  /**
   * Round 9, ask 20: when present the tree can be organised — drag a row onto a
   * folder to move it, right-click for rename / new / duplicate / delete / copy
   * path / reveal, F2 and Delete from the keyboard. Absent, the tree is read-only
   * exactly as before.
   */
  ops?: FileTreeOps;
}

/** At most this many function rows per file before an "N more" row. */
const SYMBOL_CAP = 200;

/** A DOM id per function row (or its "more" row), for `aria-activedescendant`. */
function symbolId(key: string): string {
  return `files-fn-${key}`;
}

/** A DOM id per row, for `aria-activedescendant`. */
function rowId(path: RepoPath): string {
  return `files-row-${path}`;
}

/**
 * A name's two halves for a middle ellipsis: the tail is the extension and the
 * three characters before it (or the last six of a name with none), and never
 * gives way; the head gives way first.
 */
export function splitName(name: string): { head: string; tail: string } {
  const dot = name.lastIndexOf('.');
  const keep = dot > 0 ? Math.max(0, dot - 3) : Math.max(0, name.length - 6);
  return { head: name.slice(0, keep), tail: name.slice(keep) };
}


/**
 * A NAME IS NEVER CUT FROM THE FRONT. It shows whole when it fits `avail`; when it
 * does not, the middle goes: the start and the extension stay ("Doc…file",
 * "untr….ts"), with as much of the start as fits. `measure` is the width of a
 * string in the row's own font, injected so this is testable without a layout.
 * If not even "…" plus the tail fits, the elided form is still returned and CSS
 * clips its right edge, which never removes the start.
 */
export function elideName(name: string, avail: number, measure: (s: string) => number): { head: string; tail: string } {
  if (measure(name) <= avail) return { head: name, tail: '' };
  const dot = name.lastIndexOf('.');
  const tail = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : name.slice(Math.max(1, name.length - 4));
  const stem = name.slice(0, name.length - tail.length);
  if (stem.length <= 1) return { head: name, tail: '' };
  let k = stem.length - 1;
  while (k > 1 && measure(`${stem.slice(0, k)}…${tail}`) > avail) k -= 1;
  return { head: `${stem.slice(0, k)}…`, tail };
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/* PERF (019): one canvas measure per (font, string), ever, and one getComputedStyle per font change.
   Measuring is the cost of a grouped list (every row asks for its name, its peers' names and the
   cut candidates, again after each toggle, resize and font load), so a string measured once is
   remembered for the font it was measured in. The font string is read once and kept until the
   fonts load or the theme/root style changes; two rows with the same class share it. */
const widthCache = new Map<string, Map<string, number>>();
const charCache = new Map<string, Map<string, number>>();
const fontCache = new Map<string, string>();
const WIDTH_CACHE_MAX = 60000;
let fontWatch = false;
function dropFontCaches() {
  fontCache.clear();
  widthCache.clear();
  charCache.clear();
}
function watchFonts() {
  if (fontWatch || typeof document === 'undefined') return;
  fontWatch = true;
  try {
    document.fonts?.addEventListener?.('loadingdone', dropFontCaches);
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(dropFontCaches).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class', 'style', 'data-font', 'lang'],
      });
    }
  } catch {
    /* no font events: the caches simply live for the page, which is what a fixed font wants anyway */
  }
}
/** A text's width in the row's font. `fast` is the sum of its letters' widths (no kerning, so never narrower than the real width in practice): the
 *  many throwaway candidates a cut is searched through are priced with it, since a canvas measure of each, once per
 *  candidate per name, was the whole cost of opening a big group. */
type Measure = ((s: string) => number) & { fast: (s: string) => number };
function measurer(el: HTMLElement): Measure | null {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  const ctx = measureCtx;
  if (!ctx) return null;
  watchFonts();
  const fontKey = el.className;
  let font = fontCache.get(fontKey);
  if (font === undefined) {
    const cs = getComputedStyle(el);
    font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    fontCache.set(fontKey, font);
  }
  let widths = widthCache.get(font);
  if (!widths) {
    widths = new Map();
    widthCache.set(font, widths);
  }
  if (widths.size > WIDTH_CACHE_MAX) widths.clear();
  const w = widths;
  const f = font;
  let letters = charCache.get(f);
  if (!letters) {
    letters = new Map();
    charCache.set(f, letters);
  }
  const cw = letters;
  const exact = (s: string) => {
    const have = w.get(s);
    if (have !== undefined) return have;
    if (ctx.font !== f) ctx.font = f;
    const width = ctx.measureText(s).width;
    w.set(s, width);
    return width;
  };
  exact.fast = (s: string) => {
    let sum = 0;
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i]!;
      let v = cw.get(ch);
      if (v === undefined) {
        if (ctx.font !== f) ctx.font = f;
        v = ctx.measureText(ch).width;
        cw.set(ch, v);
      }
      sum += v;
    }
    return sum;
  };
  return exact;
}

/* ONE ResizeObserver for every name, and it reports only a CHANGED WIDTH: the first callback an
   observer makes on `observe` and the ticks that change only the height used to re-fit every row. */
type WidthWatch = { last: number; run: () => void };
const widthWatches = new WeakMap<Element, WidthWatch>();
let sharedObserver: ResizeObserver | null | undefined;
function observeWidth(el: HTMLElement, run: () => void): () => void {
  if (sharedObserver === undefined) {
    sharedObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              const watch = widthWatches.get(entry.target);
              if (!watch) continue;
              const width = Math.round((entry.target as HTMLElement).clientWidth);
              if (width === watch.last) continue;
              watch.last = width;
              watch.run();
            }
          });
  }
  if (!sharedObserver) return () => undefined;
  widthWatches.set(el, { last: Math.round(el.clientWidth), run });
  sharedObserver.observe(el);
  return () => {
    sharedObserver?.unobserve(el);
    widthWatches.delete(el);
  };
}

/** Run `run` once the web fonts have loaded, if they have not already (a row fitted in the fallback font is re-fitted). */
function afterFonts(run: () => void): void {
  if (typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded') return;
  void document.fonts.ready.then(run);
}

/** The name, fitted to its own box and re-fitted whenever that box changes size
 *  (the column dragged, the pane resized, rail to drawer to full). Unmeasured
 *  (no layout, no canvas) it falls back to the static split. */
function FitName({ label }: { label: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [fit, setFit] = useState<{ head: string; tail: string } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const put = (next: { head: string; tail: string } | null) =>
      setFit((prev) => (prev === next || (prev && next && prev.head === next.head && prev.tail === next.tail) ? prev : next));
    const run = () => {
      const avail = el.clientWidth;
      const measure = measurer(el);
      if (avail <= 0 || !measure) {
        put(null);
        return;
      }
      put(elideName(label, avail, measure));
    };
    run();
    const unwatch = observeWidth(el, run);
    afterFonts(run);
    return unwatch;
  }, [label]);
  const parts = fit ?? splitName(label);
  return (
    <span className="files-name files-name-mid" ref={ref}>
      <span className="files-name-head">{parts.head}</span>
      {parts.tail === '' ? null : <span className="files-name-end">{parts.tail}</span>}
    </span>
  );
}


/**
 * A name too long for its room, for a LIST OF SIBLINGS: the first few characters (what it is) and as
 * much of the END as fits, extension included. Siblings share beginnings ("live-browser-dom.js",
 * "live-browser-session.js"), so the plain tree's "keep the start" elision reads them the same; their
 * ends are what differ. `peers` are the sibling names: while another one would read the same at this
 * head length, the head gives up characters to the ending (four, three, two, one), which is the same
 * move for both files of a pair, so they stop reading alike as soon as any split tells them apart.
 * Too narrow for even that, it is `elideName`.
 */
export function elideNameEnds(
  name: string,
  avail: number,
  measure: (s: string) => number,
  peers: readonly string[] = [],
): { head: string; tail: string } {
  if (measure(name) <= avail) return { head: name, tail: '' };
  const all = peers.includes(name) ? peers : [...peers, name];
  return elideAll(all, avail, measure).get(name) ?? elideName(name, avail, measure);
}

type Cut = { head: string; tail: string };
const elideAllCache = new WeakMap<readonly string[], Map<string, Map<string, Cut>>>();
const elideBySig = new Map<string, Map<string, Map<string, Cut>>>();
const FINGERPRINT = 'abcdefghijklmnopqrstuvwxyz0123456789-_.';

/**
 * EVERY NAME OF A LIST CUT TO ONE ROOM, so that no two read the same (the list is decided together, once per room, and
 * remembered for the rows that ask). Each long name starts as its first letters, a mark and as much of its end as fits,
 * the head giving up letters to the end while a sibling still reads the same. Names that STILL read alike
 * (ask-history-server.test.ts / ask-index-server.test.ts: same start, same end, the difference in the middle) are cut as a
 * class: the start through where they part, or just the stretch where they differ. A pair that thereby lands on another
 * name's text is a bigger class the next round.
 */
function elideAll(names: readonly string[], avail: number, measure: (s: string) => number): Map<string, Cut> {
  const room = Math.floor(avail / 2) * 2;
  const key = `${room}|${measure(FINGERPRINT)}`;
  let byRoom = elideAllCache.get(names);
  if (!byRoom) {
    /* The list is rebuilt (a new array) on every toggle, filter and refresh although its names are the same: the
       cuts are remembered by CONTENT too, so a rebuilt list costs a join, not a re-decision of every name. */
    const sig = names.join('\u0000');
    byRoom = elideBySig.get(sig);
    if (!byRoom) {
      byRoom = new Map();
      if (elideBySig.size >= 24) elideBySig.delete(elideBySig.keys().next().value as string);
      elideBySig.set(sig, byRoom);
    }
    elideAllCache.set(names, byRoom);
  }
  const have = byRoom.get(key);
  if (have) return have;

  const cuts = new Map<string, Cut>();
  const long = [...new Set(names)].filter((n) => {
    const fits = measure(n) <= room;
    if (fits) cuts.set(n, { head: n, tail: '' });
    return !fits;
  });
  const at = (of: string, headLen: number): Cut | null => {
    const head = `${of.slice(0, headLen)}…`;
    /* The longest end that fits, found by halving: this runs for every name of the list. */
    let lo = 0;
    let hi = of.length - headLen - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (measure(`${head}${of.slice(of.length - mid)}`) <= room) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? { head, tail: of.slice(of.length - lo) } : null;
  };
  const text = (c: Cut) => c.head + c.tail;
  const heads = [4, 3, 2, 1];
  const table = new Map<string, (Cut | null)[]>(long.map((n) => [n, heads.map((h) => at(n, h))]));
  const counts = heads.map((_, i) => {
    const m = new Map<string, number>();
    for (const row of table.values()) if (row[i]) m.set(text(row[i]!), (m.get(text(row[i]!)) ?? 0) + 1);
    return m;
  });
  for (const n of long) {
    const row = table.get(n)!;
    let first: Cut | null = null;
    let chosen: Cut | null = null;
    for (let i = 0; i < heads.length && chosen === null; i += 1) {
      const c = row[i];
      if (!c) continue;
      first ??= c;
      if (counts[i]!.get(text(c)) === 1) chosen = c;
    }
    cuts.set(n, chosen ?? first ?? elideName(n, room, measure));
  }

  for (let round = 0; round < 6; round += 1) {
    const buckets = new Map<string, string[]>();
    for (const n of long) {
      const x = text(cuts.get(n)!);
      buckets.set(x, [...(buckets.get(x) ?? []), n]);
    }
    let changed = false;
    for (const cls of buckets.values()) {
      if (cls.length < 2) continue;
      const strategies: ((n: string, others: readonly string[]) => Cut | null)[] = [
        (n, others) => partingWindow(n, room, measure, others),
        (n, others) => differingSpan(n, room, measure, others),
      ];
      for (const strategy of strategies) {
        const out = cls.map((n) => strategy(n, cls.filter((o) => o !== n)));
        if (out.some((c) => c === null) || new Set(out.map((c) => text(c!))).size !== cls.length) continue;
        cls.forEach((n, i) => cuts.set(n, out[i]!));
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  byRoom.set(key, cuts);
  return cuts;
}

/** The room a name needs to stay apart from the names it looks like: its start through where they part, a mark and a letter. 0 when none looks like it. */
function partingWidth(name: string, peers: readonly string[], measure: (s: string) => number): number {
  const close = peers.filter((p) => p !== name && p.length > 5 && p[0] === name[0] && p.endsWith(name.slice(-3)));
  if (close.length === 0) return 0;
  const pre = Math.max(...close.map((p) => commonPrefix(name, p)));
  const shown = Math.min(pre + 1, 5); /* more than that is the name's own business: the folders matter more here */
  return measure(shown >= name.length ? name : `${name.slice(0, shown)}…z`);
}

/** How many trailing characters `a` and `b` share. */
function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

/**
 * `name` cut to the stretch where it differs from `like` (from the first character any of them parts at to the last), with
 * a couple of letters of its start and as much of its end as the room leaves: for names that share a long start AND a long
 * end ("agent-ab-bash-granite-map-r1-2026-10-05.jsonl"), where the difference is all in the middle. Null when that
 * stretch alone does not fit.
 */
function differingSpan(
  name: string,
  avail: number,
  measure: (s: string) => number,
  like: readonly string[],
): { head: string; tail: string } | null {
  if (like.length === 0) return null;
  const lo = Math.min(...like.map((p) => commonPrefix(name, p)));
  const hi = name.length - Math.min(...like.map((p) => commonSuffix(name, p)));
  if (hi <= lo) return null;
  /* The start's first letters, the stretch, the end's last letters: as many as the room holds, marks where text is left out;
     in the tightest room the closing mark goes too. */
  for (const marks of [true, false]) {
    for (const h of [2, 1, 0]) {
      for (let t = Math.min(6, name.length - hi); t >= 0; t -= 1) {
        const from = Math.max(lo, h);
        const mid = name.slice(from, hi);
        const head = `${name.slice(0, h)}${from > h ? '…' : ''}${mid}${hi < name.length && (marks || t > 0) ? '…' : ''}`;
        const tail = t > 0 ? name.slice(name.length - t) : '';
        if (measure(head + tail) <= avail) return { head, tail };
      }
    }
  }
  return null;
}

/** How many leading characters `a` and `b` share. */
function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/**
 * `name` cut so its start runs through the first character where it differs from any of `like` (the names it would
 * otherwise read like), then `…` and the end that fits. Null when not even one character of the end fits.
 */
function partingWindow(
  name: string,
  avail: number,
  measure: (s: string) => number,
  like: readonly string[],
): { head: string; tail: string } | null {
  const set = [...new Set([name, ...like])].sort();
  let pre = 0;
  for (let i = 1; i < set.length; i += 1) pre = Math.max(pre, commonPrefix(set[i - 1]!, set[i]!));
  const keep = Math.min(pre + 1, name.length);
  const head = keep >= name.length ? name : `${name.slice(0, keep)}…`;
  if (keep >= name.length) return measure(head) <= avail ? { head, tail: '' } : null;
  let k = name.length - keep;
  while (k > 0 && measure(`${head}${name.slice(name.length - k)}`) > avail) k -= 1;
  return k > 0 ? { head, tail: name.slice(name.length - k) } : null;
}

/** `…` plus the END of `text` that fits `avail` ('' when not even the mark does): the nearest folders are what tell two files apart. */
export function elideFront(text: string, avail: number, measure: (s: string) => number): string {
  if (text === '' || measure(text) <= avail) return text;
  let k = text.length - 1;
  while (k > 0 && measure(`…${text.slice(text.length - k)}`) > avail) k -= 1;
  return k > 0 ? `…${text.slice(text.length - k)}` : '';
}

const fitNeedCache = new WeakMap<readonly string[], readonly string[]>();

/** `path/seg/` with the folder at each position cut to `ns[position]` letters and a mark; the "…/" between folders stays. */
function abbreviate(key: string, ns: readonly number[]): string {
  return key
    .split('/')
    .map((seg, j) => (seg !== '…' && seg.length > (ns[j] ?? 1) + 1 ? `${seg.slice(0, ns[j] ?? 1)}…` : seg))
    .join('/');
}

/**
 * The folders that tell one row from the others of its set (`keys`, one per row, all different), cut to fit `room`:
 * every folder starts as one letter and a mark, and where two rows would still read the same, the folders that differ
 * between them get one more letter, until they do not. A row whose cut text is still wider than the room has `need` cut
 * from its front instead.
 */
export function fitNeed(keys: readonly string[], need: string, room: number, measure: (s: string) => number): string {
  if (measure(need) <= room) return need;
  const at = keys.indexOf(need);
  if (keys.length < 2 || at < 0) return elideFront(need, room, measure);
  let cut = fitNeedCache.get(keys);
  if (!cut) {
    const segs = keys.map((k) => k.split('/'));
    const ns = segs.map((s) => s.map(() => 1));
    let texts = keys.map((k, i) => abbreviate(k, ns[i]!));
    for (let round = 0; round < 40; round += 1) {
      const seen = new Map<string, number[]>();
      texts.forEach((x, i) => seen.set(x, [...(seen.get(x) ?? []), i]));
      const clash = [...seen.values()].filter((g) => g.length > 1);
      if (clash.length === 0) break;
      for (const g of clash) {
        for (const i of g) {
          segs[i]!.forEach((seg, j) => {
            if (g.some((o) => segs[o]![j] !== seg)) ns[i]![j] = ns[i]![j]! + 1;
          });
        }
      }
      texts = keys.map((k, i) => abbreviate(k, ns[i]!));
    }
    cut = texts;
    fitNeedCache.set(keys, cut);
  }
  const mine = cut[at]!;
  return measure(mine) <= room ? mine : elideFront(need, room, measure);
}

/**
 * A GROUPED ROW'S LABEL: the directory the file sits in (dim), then the file NAME. The name is whole
 * whenever it fits the room the row leaves it; the directory takes what is left of the room and gives
 * way from its FRONT, so twelve `index.ts` read as twelve different parents and "replay/bin/mak….ts"
 * never happens. Only when the name alone cannot fit does it elide in the middle (start and extension
 * kept, see `elideNameEnds`) and the directory is dropped. Measured in the row's own font; unmeasured
 * (no layout) it falls back to the whole text with the directory clipped by CSS.
 */
function GroupedName({
  dir,
  name,
  peers,
  need = '',
  needSet = NO_PEERS,
}: {
  dir: string;
  name: string;
  peers: readonly string[];
  need?: string;
  needSet?: readonly string[];
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const prefix = dir === '' ? '' : `${dir}/`;
  const [fit, setFit] = useState<{ dir: string; head: string; tail: string } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const put = (next: { dir: string; head: string; tail: string } | null) =>
      setFit((prev) => (prev === next || (prev && next && prev.dir === next.dir && prev.head === next.head && prev.tail === next.tail) ? prev : next));
    const run = () => {
      const avail = el.clientWidth;
      const measure = measurer(el);
      if (avail <= 0 || !measure) {
        put(null);
        return;
      }
      const nameWidth = measure(name);
      /* Another row of the group has this very name: the folders in `need` are what tells them apart, so they stay
         whatever the name costs, and a name too wide for the rest gives way instead. Too narrow even for that, each
         folder in it is cut to the fewest letters that still keep the rows apart (fitNeed). */
      const suffix = !need.includes('…');
      const needW = need === '' ? 0 : measure(suffix ? `…${need}` : need);
      /* What the name may be squeezed to before the folders give way: a few letters and the mark. */
      const nameFloor = Math.max(measure('abc…z'), Math.min(partingWidth(name, peers, measure), avail * 0.6));
      const keep = need === '' ? 0 : Math.min(needW, avail - Math.min(nameWidth, nameFloor));
      const squeezed = needW > keep;
      const needShown = need === '' ? '' : squeezed ? fitNeed(needSet, need, keep, measure) : need;
      if (nameWidth <= avail - keep) {
        const room = avail - nameWidth;
        const shown = measure(prefix) <= room ? prefix : squeezed || !suffix ? needShown : elideFront(prefix, room, measure);
        put({ dir: shown, head: name, tail: '' });
      } else if (keep > 0) {
        put({ dir: squeezed || !suffix ? needShown : elideFront(prefix, keep, measure), ...elideNameEnds(name, avail - keep, measure.fast, peers) });
      } else put({ dir: '', ...elideNameEnds(name, avail, measure.fast, peers) });
    };
    run();
    const unwatch = observeWidth(el, run);
    afterFonts(run);
    return unwatch;
  }, [prefix, name, peers, need, needSet]);
  const shown = fit ?? { dir: prefix, head: name, tail: '' };
  return (
    <span className="files-name files-name-grouped" ref={ref}>
      {shown.dir === '' ? null : (
        <span className="files-name-dir">
          <bdi>{shown.dir}</bdi>
        </span>
      )}
      <span className="files-name-base" data-testid="files-row-name">
        <span className="files-name-head">{shown.head}</span>
        {shown.tail === '' ? null : <span className="files-name-end">{shown.tail}</span>}
      </span>
    </span>
  );
}


type Editing =
  | { mode: 'rename'; path: string }
  | { mode: 'file' | 'folder'; parent: string };

export function FileTree({
  nodes,
  expanded,
  selected,
  status = null,
  progress = null,
  cap = FILE_ROW_CAP,
  onSelect,
  onToggle,
  onOpen,
  emptyNote = 'No files here.',
  label = 'Files',
  ops,
  revealed = null,
}: FileTreeProps) {
  /* GROUP BY SERVICE (owner ruling 2026-10-14): when the reader asks for it, the same visible files
     (the filter still applies) are listed under the services that own them. Headers are decoration
     between rows, not rows: the keyboard walks the files and skips them. */
  const groupUi = useGroupUi();
  const groups = groupUi?.on === true ? groupUi.groups : null;
  const groupOpen = groupUi?.on === true ? groupUi.open : null;
  const groupShowAll = groupUi?.on === true ? groupUi.showAll : null;
  const { rows, omitted, items } = useMemo(() => {
    if (groups === null) return { ...flattenFileTree(nodes, { expanded, status, progress, cap }), items: null };
    return groupedRows(nodes, groups, { status, progress, cap, groupOpen, showAll: groupShowAll });
  }, [nodes, expanded, status, progress, cap, groups, groupOpen, groupShowAll]);

  /* ── functions under a file: keyboard state ────────────────────────────── */
  const symbolsUi = useSymbolsUi();
  /* The function row the keyboard is on (a function id, or `more:<file>`), or null when it is on a file row. */
  const [symSel, setSymSel] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState<ReadonlySet<string>>(() => new Set());
  const visibleSymbols = (path: string) => {
    const all = symbolsUi?.byFile.get(path) ?? [];
    return moreOpen.has(path) ? all : all.slice(0, SYMBOL_CAP);
  };
  const select = (path: RepoPath) => {
    setSymSel(null);
    onSelect(path);
  };
  /** Every keyboard stop in order: file rows, with the open files' functions between them. */
  const navItems = useMemo(() => {
    const items: { type: 'row' | 'sym' | 'more'; path: string; key: string }[] = [];
    for (const row of rows) {
      items.push({ type: 'row', path: row.path, key: row.path });
      if (row.kind === 'file' && symbolsUi?.open.has(row.path)) {
        const all = symbolsUi.byFile.get(row.path) ?? [];
        const shown = moreOpen.has(row.path) ? all : all.slice(0, SYMBOL_CAP);
        for (const s of shown) items.push({ type: 'sym', path: row.path, key: s.id });
        if (shown.length < all.length) items.push({ type: 'more', path: row.path, key: `more:${row.path}` });
      }
    }
    return items;
  }, [rows, symbolsUi, moreOpen]);

  /* ── organising: menu, inline edit, delete confirm, drag ───────────────── */
  const [menu, setMenu] = useState<FileMenuTarget | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirming, setConfirming] = useState<{ path: string; kind: 'file' | 'dir' } | null>(null);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /* '' is the project root; null is "not over a drop target". */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const kindOf = useMemo(() => {
    const map = new Map<string, 'file' | 'dir'>();
    for (const row of rows) map.set(row.path, row.kind);
    return map;
  }, [rows]);

  /* THE OPEN FILE IS ALWAYS IN VIEW (owner, 2026-10-09: the file named at the top
     "highlighted and selected on the side rail"). A selection made from outside
     the tree (the chat naming a file, a reload) can sit below the fold; bring it
     into view once it exists as a row. `nearest` leaves a visible row alone. */
  const selectedDrawn = selected !== null && kindOf.has(selected);

  /* ── the window: only the rows in (and just around) view are mounted ───────
     A repository is thousands of rows and a grouped one is a thousand at once; 14k DOM nodes made the
     open take seconds and the scroll paint at 28 fps. Every row is one rail-row high, so a row's place is
     its index and the rows outside the window are two spacers' height. Short lists, and a tree that has no
     layout (a test, a hidden pane), are drawn whole, exactly as before. */
  const treeRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<RowLayout>(EMPTY_LAYOUT);
  const [view, setView] = useState<{ top: number; h: number }>({ top: 0, h: -1 });
  const [metrics, setMetrics] = useState<RowMetrics>(DEFAULT_METRICS);
  const emptyTree = rows.length === 0 && (items === null || items.length === 0);
  useLayoutEffect(() => {
    const el = treeRef.current;
    if (!el) return undefined;
    const read = () => {
      const next = { top: el.scrollTop, h: el.clientHeight };
      setView((prev) => (prev.top === next.top && prev.h === next.h ? prev : next));
      if (next.h <= 0) return;
      const row = el.querySelector<HTMLElement>('.s2-rail-row:not(.files-group-head)');
      const head = el.querySelector<HTMLElement>('.files-group-head');
      const cs = getComputedStyle(el);
      const measured: RowMetrics = {
        row: row ? row.getBoundingClientRect().height || DEFAULT_METRICS.row : DEFAULT_METRICS.row,
        headExtra: head ? parseFloat(getComputedStyle(head).marginTop) || 0 : DEFAULT_METRICS.headExtra,
        pad: parseFloat(cs.paddingTop) || 0,
      };
      setMetrics((prev) => (prev.row === measured.row && prev.headExtra === measured.headExtra && prev.pad === measured.pad ? prev : measured));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [emptyTree]);
  const onTreeScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const next = { top: el.scrollTop, h: el.clientHeight };
    setView((prev) => {
      if (prev.h === next.h && prev.top === next.top) return prev;
      const lay = layoutRef.current;
      if (prev.h === next.h && sameWindow(lay, prev.top, next.top, next.h)) return prev;
      return next;
    });
  };
  /** Bring an entry (by its key) to the view: 'nearest' leaves a visible one alone. False when it is not an entry. */
  const scrollToEntry = (key: string, mode: 'nearest' | 'center' | 'start'): boolean => {
    const sc = treeRef.current;
    const lay = layoutRef.current;
    const i = lay.keys.get(key);
    if (!sc || i === undefined) return false;
    const y = (lay.offs[i] ?? 0) + lay.pad;
    const h = (lay.offs[i + 1] ?? y) - (lay.offs[i] ?? 0);
    const room = sc.clientHeight;
    if (mode === 'center') sc.scrollTop = Math.max(0, y - (room - h) / 2);
    else if (mode === 'start') sc.scrollTop = Math.max(0, y + (lay.heads.has(i) ? lay.headExtra : 0) - lay.pad);
    else if (y < sc.scrollTop) sc.scrollTop = Math.max(0, y - lay.pad);
    else if (y + h > sc.scrollTop + room) sc.scrollTop = y + h - room + lay.pad;
    const next = { top: sc.scrollTop, h: room };
    setView((prev) => (prev.top === next.top && prev.h === next.h ? prev : next));
    return true;
  };

  useEffect(() => {
    if (selected === null || !selectedDrawn) return;
    /* Windowed, the place of a row is arithmetic, so the scroll does not depend on the row being mounted yet. */
    if (layoutRef.current.windowed && scrollToEntry(selected, 'nearest')) return;
    const el = document.getElementById(rowId(selected));
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedDrawn]);

  /* A BOARD CARD'S REVEAL is scrolled to the MIDDLE of the tree, not to its bottom edge, where a
     "nearest" scroll leaves a row that was below the fold. Once it is drawn; in the grouped view the
     revealed thing is the service's head, which goes to the top with its files below it. */
  const revealedGroup = groupUi?.on === true ? groupUi.revealed : null;
  const revealedDrawn =
    revealedGroup !== null
      ? items?.some((i) => i.type === 'head' && i.header.id === revealedGroup) === true
      : revealed !== null && kindOf.has(revealed);
  useEffect(() => {
    if (!revealedDrawn) return;
    const go = () => {
      /* Windowed, the scroller is moved to where the entry sits (it mounts there); the reveal does not depend on the row being mounted. */
      if (layoutRef.current.windowed && scrollToEntry(revealedGroup !== null ? `group:${revealedGroup}` : (revealed as RepoPath), revealedGroup !== null ? 'start' : 'center')) return;
      const el =
        revealedGroup !== null
          ? document.querySelector<HTMLElement>(`[data-testid="files-group-head"][data-group-id="${revealedGroup}"]`)
          : document.getElementById(rowId(revealed as RepoPath));
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: revealedGroup !== null ? 'start' : 'center' });

    };
    go();
    /* Once more after the panel has settled: Files can be mounting (a tab gliding in) in the same
       breath as the reveal, and a scroll made before it has a height goes nowhere. */
    const later = window.setTimeout(go, 350);
    return () => window.clearTimeout(later);
  }, [revealed, revealedGroup, revealedDrawn]);

  const isOpen = (path: string) => expanded === 'all' || expanded.has(path);

  const startCreate = (parent: string, mode: 'file' | 'folder') => {
    if (parent !== '' && !isOpen(parent)) onToggle(parent);
    setNote(null);
    setEditing({ mode, parent });
  };

  const pick = (action: FileMenuAction, target: FileMenuTarget) => {
    setMenu(null);
    if (!ops) return;
    const here = target.path;
    const dirOfTarget = target.kind === 'dir' ? here : target.kind === 'file' ? parentDir(here) : '';
    if (action === 'new-file') startCreate(dirOfTarget, 'file');
    else if (action === 'new-folder') startCreate(dirOfTarget, 'folder');
    else if (action === 'rename') {
      setNote(null);
      setEditing({ mode: 'rename', path: here });
    } else if (action === 'duplicate') void ops.duplicate(here).then(setNote);
    else if (action === 'copy-path') ops.copyPath(here);
    else if (action === 'reveal') void ops.reveal(here).then(setNote);
    else if (action === 'delete') {
      setConfirmErr(null);
      setConfirming({ path: here, kind: target.kind === 'dir' ? 'dir' : 'file' });
    }
  };

  const commitEdit = async (value: string) => {
    if (!ops || editing === null) return;
    const name = validName(value);
    if (name === null) {
      setNote('Names cannot be empty, contain a slash, or be . or ..');
      return;
    }
    const failure =
      editing.mode === 'rename'
        ? name === baseName(editing.path)
          ? null
          : await ops.rename(editing.path, name)
        : await ops.create(editing.parent, name, editing.mode);
    if (failure !== null) {
      setNote(failure);
      return;
    }
    setNote(null);
    setEditing(null);
  };

  const doDrop = (event: DragEvent, targetDir: string) => {
    event.preventDefault();
    event.stopPropagation();
    const from = dragging ?? event.dataTransfer.getData('text/x-seq-path');
    setDropTarget(null);
    setDragging(null);
    if (!ops || !from || !canMoveInto(from, targetDir)) return;
    setNote(null);
    void ops.move(from, targetDir).then(setNote);
  };

  /** The directory a drop on this row means: the folder itself, or a file's parent. */
  const dropDirFor = (row: FileRow): string => (row.kind === 'dir' ? row.path : parentDir(row.path));

  const dragHandlers = (row: FileRow) =>
    ops
      ? {
          draggable: editing === null,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.setData('text/x-seq-path', row.path);
            event.dataTransfer.setData('text/plain', row.path);
            event.dataTransfer.effectAllowed = 'move';
            setDragging(row.path);
          },
          onDragEnd: () => {
            setDragging(null);
            setDropTarget(null);
          },
          onDragOver: (event: DragEvent) => {
            const dir = dropDirFor(row);
            if (dragging === null || !canMoveInto(dragging, dir)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            if (dropTarget !== dir) setDropTarget(dir);
          },
          onDrop: (event: DragEvent) => doDrop(event, dropDirFor(row)),
        }
      : {};

  const openMenu = (event: ReactMouseEvent, path: string, kind: FileMenuTarget['kind']) => {
    if (!ops) return;
    event.preventDefault();
    event.stopPropagation();
    if (kind !== 'root') onSelect(path);
    setMenu({ path, kind, x: event.clientX, y: event.clientY });
  };

  /*
   * FOCUS STAYS ON THE CONTAINER AND THE SELECTION MOVES, which is the
   * `aria-activedescendant` half of the ARIA tree pattern rather than the
   * roving-tabindex half. Both are valid; this one is chosen because the rows
   * are re-created on every expand and a roving tabindex has to re-assert
   * `.focus()` after each of those renders — and the moment that call is missed
   * the keyboard silently falls out of the tree onto the document, which is a
   * defect no unit test sees and every keyboard user hits immediately.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (ops && editing === null && selected !== null) {
      if (event.key === 'F2') {
        event.preventDefault();
        setNote(null);
        setEditing({ mode: 'rename', path: selected });
        return;
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        setConfirmErr(null);
        setConfirming({ path: selected, kind: kindOf.get(selected) ?? 'file' });
        return;
      }
    }
    if (symbolsUi !== null && handleSymbolKey(event)) return;
    if (!NAV_KEYS.has(event.key)) return;
    const action = treeKeyAction(rows, selected, event.key as TreeKey);
    /* Nothing happened, so nothing is swallowed. Calling preventDefault on a
       key this tree declined to use would break the browser's own behaviour
       for it — Left on the first row would stop being Left. */
    if (action === null) return;
    event.preventDefault();

    if (action.kind === 'select') select(action.path);
    else if (action.kind === 'open') onOpen(action.path);
    else onToggle(action.path);
  };

  /** Arrow, Enter and Space across files AND their functions. True when the key was used. */
  function handleSymbolKey(event: KeyboardEvent<HTMLDivElement>): boolean {
    if (!symbolsUi) return false;
    const at = navItems.findIndex((i) => (symSel === null ? i.type === 'row' && i.path === selected : i.key === symSel));
    if (at < 0) return false;
    const here = navItems[at]!;
    const go = (item: (typeof navItems)[number]) => {
      if (item.type === 'row') select(item.path);
      else setSymSel(item.key);
    };
    const used = () => event.preventDefault();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const next = navItems[at + (event.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return false;
      used();
      go(next);
      return true;
    }
    if (event.key === 'ArrowRight' && here.type === 'row' && (symbolsUi.byFile.get(here.path)?.length ?? 0) > 0) {
      used();
      if (!symbolsUi.open.has(here.path)) symbolsUi.onToggle(here.path);
      else if (navItems[at + 1]?.path === here.path) go(navItems[at + 1]!);
      return true;
    }
    if (event.key === 'ArrowLeft') {
      if (here.type !== 'row') {
        used();
        select(here.path);
        return true;
      }
      if (symbolsUi.open.has(here.path)) {
        used();
        symbolsUi.onToggle(here.path);
        return true;
      }
      return false;
    }
    if ((event.key === 'Enter' || event.key === ' ') && here.type !== 'row') {
      used();
      if (here.type === 'more') setMoreOpen((prev) => new Set(prev).add(here.path));
      else symbolsUi.onPlay(here.key);
      return true;
    }
    return false;
  }

  const overlays = (
    <>
      {menu ? (
        <FileContextMenu target={menu} onPick={(action) => pick(action, menu)} onClose={() => setMenu(null)} />
      ) : null}
      {confirming ? (
        <ConfirmDialog
          icon="trash"
          danger
          busy={busy}
          error={confirmErr}
          title={confirming.kind === 'dir' ? 'Delete this folder?' : 'Delete this file?'}
          body={
            confirming.kind === 'dir'
              ? `“${confirming.path}” and everything inside it is deleted from disk.`
              : `“${confirming.path}” is deleted from disk.`
          }
          confirmLabel="Delete"
          testId="files-confirm-delete"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (!ops) return;
            setBusy(true);
            void ops.remove(confirming.path).then((failure) => {
              setBusy(false);
              if (failure !== null) setConfirmErr(failure);
              else setConfirming(null);
            });
          }}
        />
      ) : null}
    </>
  );

  const noteEl = note ? (
    <p className="files-note files-ops-note" role="alert" data-testid="files-ops-note">
      {note}
    </p>
  ) : null;

  const newRow =
    editing !== null && editing.mode !== 'rename' ? (
      <NewEntryRow
        key="new-entry"
        depth={editing.parent === '' ? 0 : (rows.find((r) => r.path === editing.parent)?.depth ?? 0) + 1}
        kind={editing.mode}
        onCommit={commitEdit}
        onCancel={() => {
          setEditing(null);
          setNote(null);
        }}
      />
    ) : null;

  if (rows.length === 0 && (items === null || items.length === 0)) {
    return (
      <div
        className="files-tree files-tree-empty"
        data-testid={FILES.tree}
        onContextMenu={(event) => openMenu(event, '', 'root')}
      >
        <p className="files-note" data-testid={FILES.empty}>
          {emptyNote}
        </p>
        {newRow}
        {noteEl}
        {overlays}
      </div>
    );
  }

  const parentIndex =
    newRow && editing && editing.mode !== 'rename' && editing.parent !== ''
      ? rows.findIndex((r) => r.path === (editing as { parent: string }).parent)
      : -1;

  const rendered: ReactNode[] = [];
  if (newRow && (editing as { parent: string }).parent === '') rendered.push(newRow);
  const pushRow = (row: FileRow, index: number) => {
    rendered.push(
      <Row
        key={row.path}
        row={row}
        selected={row.path === selected}
        revealed={row.path === revealed}
        renaming={editing !== null && editing.mode === 'rename' && editing.path === row.path}
        dropOn={dropTarget !== null && row.kind === 'dir' && row.path === dropTarget}
        dragging={dragging === row.path}
        extra={dragHandlers(row)}
        onContextMenu={(event) => openMenu(event, row.path, row.kind)}
        onCommitRename={commitEdit}
        onCancelRename={() => {
          setEditing(null);
          setNote(null);
        }}
        onSelect={select}
        onToggle={onToggle}
        onOpen={onOpen}
      />,
    );
    if (row.kind === 'file' && symbolsUi?.open.has(row.path)) {
      const all = symbolsUi.byFile.get(row.path) ?? [];
      const shown = visibleSymbols(row.path);
      for (const sym of shown) {
        rendered.push(
          <SymbolRow
            key={`${row.path}#${sym.id}`}
            sym={sym}
            depth={row.depth + 1}
            ui={symbolsUi}
            kbd={symSel === sym.id}
            onPlay={() => {
              setSymSel(sym.id);
              symbolsUi.onPlay(sym.id);
            }}
          />,
        );
      }
      if (shown.length < all.length) {
        rendered.push(
          <RailRow
            key={`${row.path}#more`}
            id={symbolId(`more:${row.path}`)}
            depth={Math.min(row.depth + 1, MAX_INDENT)}
            selected={symSel === `more:${row.path}`}
            className="files-row files-row-symbol"
            data-testid="files-symbols-more"
            role="treeitem"
            aria-level={row.depth + 2}
            aria-selected={symSel === `more:${row.path}`}
            onClick={() => setMoreOpen((prev) => new Set(prev).add(row.path))}
          >
            <span className="files-name">{`+${all.length - shown.length} more`}</span>
          </RailRow>,
        );
      }
    }
    if (index === parentIndex && newRow) rendered.push(newRow);
  };
  if (items === null) rows.forEach(pushRow);
  else {
    for (const item of items) {
      if (item.type === 'row') pushRow(rows[item.index]!, item.index);
      else if (item.type === 'head') {
        const { header } = item;
        const on = groupUi?.revealed === header.id;
        rendered.push(
          <RailRow
            key={`group:${header.id}`}
            className={`files-group-head${on ? ' is-revealed' : ''}`}
            data-testid="files-group-head"
            data-group-id={header.id}
            data-selected={on ? 'true' : 'false'}
            selected={on}
            role="treeitem"
            aria-level={1}
            aria-expanded={header.open}
            aria-selected={on}
            twist={<FilesIcon name={header.open ? 'chevdown' : 'chevright'} size={12} />}
          >
            <button
              type="button"
              className="files-group-fold s2-rail-hit"
              data-testid="files-group-fold"
              aria-expanded={header.open}
              aria-label={`${header.label}, ${header.count} ${header.count === 1 ? 'file' : 'files'}`}
              title={header.label}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={() => groupUi?.onToggleGroup(header.id, header.open)}
            >
              <span className="files-group-name">{header.label}</span>
              <span className="files-group-count mono">{header.count}</span>
            </button>
          </RailRow>,
        );
      } else {
        rendered.push(
          <RailRow
            key={`more:${item.id}`}
            depth={1}
            className="files-row files-row-more"
            data-testid="files-group-more"
            role="treeitem"
            aria-level={2}
            aria-selected={false}
            onClick={() => groupUi?.onShowAll(item.id)}
          >
            <span className="files-name">{`+${item.omitted.toLocaleString('en-US')} more in ${item.label}`}</span>
          </RailRow>,
        );
      }
    }
  }

  /* WHERE EACH ENTRY SITS, then which of them to mount. An entry is one rail row high; a group head also carries
     its top margin. */
  const heads = new Set<number>();
  const keys = new Map<string, number>();
  const offs: number[] = new Array<number>(rendered.length + 1);
  let y = 0;
  for (let i = 0; i < rendered.length; i += 1) {
    const node = rendered[i];
    const key = isValidElement(node) && node.key !== null ? String(node.key) : null;
    if (key !== null) keys.set(key, i);
    offs[i] = y;
    y += metrics.row;
    if (key !== null && key.startsWith('group:')) {
      heads.add(i);
      y += metrics.headExtra;
    }
  }
  offs[rendered.length] = y;
  /* Before the first measure (`h` -1) a screenful is assumed, so a long list never mounts whole just to be cut down;
     measured 0 (no layout, a hidden pane) it is drawn whole, as it always was. */
  const viewH = view.h < 0 ? ASSUMED_VIEW_PX : view.h;
  const windowed = viewH > 0 && rendered.length > WINDOW_MIN;
  const layout: RowLayout = { keys, offs, heads, pad: metrics.pad, headExtra: metrics.headExtra, windowed };
  layoutRef.current = layout;
  const [first, last] = windowed ? windowOf(layout, view.top, viewH) : [0, rendered.length];

  return (
    <div
      ref={treeRef}
      onScroll={onTreeScroll}
      className={`files-tree${ops && dropTarget === '' ? ' is-drop-root' : ''}`}
      data-testid={FILES.tree}
      data-windowed={windowed ? 'true' : undefined}
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={symSel !== null ? symbolId(symSel) : selected === null ? undefined : rowId(selected)}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => openMenu(event, '', 'root')}
      onDragOver={(event) => {
        if (!ops || dragging === null || !canMoveInto(dragging, '')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dropTarget !== '') setDropTarget('');
      }}
      onDrop={(event) => doDrop(event, '')}
    >
      {windowed && first > 0 ? <div className="files-tree-pad" aria-hidden="true" data-testid="files-tree-pad-top" style={{ height: offs[first] }} /> : null}
      {windowed ? rendered.slice(first, last) : rendered}
      {windowed && last < rendered.length ? (
        <div className="files-tree-pad" aria-hidden="true" data-testid="files-tree-pad-bottom" style={{ height: y - (offs[last] ?? y) }} />
      ) : null}
      {omitted > 0 ? (
        /* SAID, NEVER SILENT. A tree that stops at the cap without saying so
           tells the reader their repository ends here, and that is the one
           number they cannot check by looking. */
        <p className="files-note" data-testid={FILES.omitted}>
          {`+${omitted.toLocaleString('en-US')} more not listed — narrow the filter`}
        </p>
      ) : null}
      {noteEl}
      {overlays}
      {symbolsUi?.footer ? <div className="rail-scope files-flowfoot">{symbolsUi.footer}</div> : null}
    </div>
  );
}

/** One function under its file: click plays its flow on the board. */
function SymbolRow({
  sym,
  depth,
  ui,
  kbd,
  onPlay,
}: {
  sym: { id: string; name: string; line: number };
  depth: number;
  ui: SymbolsUi;
  kbd: boolean;
  onPlay: () => void;
}) {
  const playing = ui.playingId === sym.id;
  const untraced = ui.untracedId === sym.id;
  return (
    <RailRow
      depth={Math.min(depth, MAX_INDENT)}
      id={symbolId(sym.id)}
      selected={playing || kbd}
      icon={<span className="files-symglyph mono">ƒ</span>}
      className="files-row files-row-symbol"
      data-testid="files-symbol"
      data-function-id={sym.id}
      data-playing={playing ? 'true' : undefined}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={playing || kbd}
      title={untraced ? `${sym.name}: not traced beyond its own file, so there is no flow to play` : `${sym.name} (line ${sym.line}): play its flow on the board`}
      onClick={onPlay}
    >
      <FitName label={sym.name} />
      {untraced ? <span className="files-mark mono" data-testid="files-symbol-untraced">Not traced</span> : <span className="files-mark mono">{sym.line}</span>}
    </RailRow>
  );
}

/** A pending file/folder, as an input row under the folder it will live in. */
function NewEntryRow({
  depth,
  kind,
  onCommit,
  onCancel,
}: {
  depth: number;
  kind: 'file' | 'folder';
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <RailRow
      depth={Math.min(depth, MAX_INDENT)}
      icon={<FilesIcon name={kind === 'folder' ? 'folder' : 'file'} size={14} />}
      className="files-row files-row-new"
      data-testid="files-new-row"
    >
      <NameInput
        initial=""
        label={kind === 'folder' ? 'New folder name' : 'New file name'}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </RailRow>
  );
}

/** Enter commits, Escape or leaving cancels. The row owns nothing else. */
function NameInput({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  /* A commit that is awaiting the server must not be cancelled by the blur the
     re-render causes. */
  const committing = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <input
      ref={ref}
      className="files-name-input"
      data-testid="files-name-input"
      aria-label={label}
      defaultValue={initial}
      spellCheck={false}
      autoComplete="off"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          committing.current = true;
          onCommit(event.currentTarget.value);
          window.setTimeout(() => {
            committing.current = false;
          }, 0);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (!committing.current) onCancel();
      }}
    />
  );
}

interface RowProps {
  row: FileRow;
  selected: boolean;
  /** Wears the selected fill without being the selection (a folder a board card revealed). */
  revealed: boolean;
  renaming: boolean;
  dropOn: boolean;
  dragging: boolean;
  extra: Record<string, unknown>;
  onContextMenu: (event: ReactMouseEvent) => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  onSelect: (path: RepoPath) => void;
  onToggle: (path: RepoPath) => void;
  onOpen: (path: RepoPath) => void;
}

function Row({
  row,
  selected,
  revealed,
  renaming,
  dropOn,
  dragging,
  extra,
  onContextMenu,
  onCommitRename,
  onCancelRename,
  onSelect,
  onToggle,
  onOpen,
}: RowProps) {
  const isDir = row.kind === 'dir';
  /* This branch's renames say where the file came from. */
  const renamedFrom = useBranchUi()?.renamedFrom?.get(row.path);
  /* A file the function index knows opens a list of its functions. */
  const symbols = useSymbolsUi();
  const fnCount = !isDir ? (symbols?.byFile.get(row.path)?.length ?? 0) : 0;
  const fnOpen = fnCount > 0 && symbols?.open.has(row.path) === true;
  /* A collapsed chain's label carries separators, and the identity of
     `packages/web2/src/files` is its TAIL — so it truncates at the FRONT. The
     recipe is rail.css's, `direction: rtl` with an inner <bdi>, and it is the
     only way CSS puts the ellipsis on the left without measuring the string in
     JavaScript. A plain name has no head to lose and stays left-to-right. */
  const chained = isDir && row.label.includes('/');

  return (
    /* Round 8: the one rail row the session sidebar draws too (shell2/RailRow). */
    <RailRow
      {...extra}
      onContextMenu={onContextMenu}
      depth={Math.min(row.depth, MAX_INDENT)}
      selected={selected || revealed}
      twist={
        isDir ? (
          <FilesIcon name={row.expanded ? 'chevdown' : 'chevright'} size={12} />
        ) : fnCount > 0 ? (
          <span
            role="button"
            className="files-symtwist"
            data-testid="files-symbols-toggle"
            aria-expanded={fnOpen}
            aria-label={`${fnOpen ? 'Hide' : 'Show'} ${fnCount} ${fnCount === 1 ? 'function' : 'functions'} in ${row.label}`}
            title={`${fnCount} ${fnCount === 1 ? 'function' : 'functions'}`}
            onClick={(event) => {
              event.stopPropagation();
              symbols?.onToggle(row.path);
            }}
          >
            <FilesIcon name={fnOpen ? 'chevdown' : 'chevright'} size={12} />
          </span>
        ) : null
      }
      icon={<FilesIcon name={isDir ? 'folder' : 'file'} size={14} />}
      id={rowId(row.path)}
      className={`files-row files-row-${row.kind}${row.tone === null ? '' : ` files-tone-${row.tone}`}${dropOn ? ' is-drop' : ''}${dragging ? ' is-dragging' : ''}`}
      data-testid={FILES.row}
      data-kind={row.kind}
      data-path={row.path}
      data-selected={selected ? 'true' : 'false'}
      data-revealed={revealed ? 'true' : undefined}
      data-dirty={row.dirty ? 'true' : 'false'}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={isDir ? row.expanded : undefined}
      data-tone={row.tone ?? undefined}
      aria-label={
        row.status === null && row.tone !== 'progress'
          ? undefined
          : /* THE WORD, NOT THE LETTER. "M" is a glyph and means nothing read
               aloud; the status word is the whole point of having one. */
            `${row.path}, ${row.status ?? 'being edited'}`
      }
      title={
        row.status === null && row.tone !== 'progress'
          ? row.path
          : `${row.path} — ${row.status ?? 'being edited'}${renamedFrom ? ` (renamed from ${renamedFrom})` : ''}`
      }
      onClick={() => {
        if (renaming) return;
        /* A FOLDER CLICK OPENS THE FOLDER, and nothing else (owner photo,
           2026-09-22: "path is a directory" under a highlighted folder). Selecting
           it made the reader load it as a file. Keyboard focus still walks
           folders — that is the `select` action above, not this click. */
        if (isDir) {
          onToggle(row.path);
          return;
        }
        onSelect(row.path);
        onOpen(row.path);
      }}
    >
      {renaming ? (
        <NameInput
          initial={baseName(row.path)}
          label={`Rename ${baseName(row.path)}`}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : chained ? (
        <span className="files-name files-name-tail">
          <bdi>{row.label}</bdi>
        </span>
      ) : row.dir !== undefined ? (
        /* GROUP BY SERVICE: the NAME is never cut. The directory it sits in is dimmed in front of it and
           is what gives way, from its FRONT (the nearest folder is what tells two files apart), so
           "components/v….mjs" twelve times over becomes twelve different names. */
        <GroupedName dir={row.dir} name={row.label} peers={row.peers ?? NO_PEERS} need={row.dirNeed ?? ''} needSet={row.dirNeedSet ?? NO_PEERS} />
      ) : (
        /* Round 7: a long name gives way IN THE MIDDLE and keeps its end, so
           "docker-compose.yml" reads "docker-co…se.yml", never "docker-comp".
           The full path is the row's title. */
        <FitName label={row.label} />
      )}
      {fnCount > 0 ? (
        /* THE FUNCTION COUNT the retired rail printed on every file row, now beside the name: the
           number the scan's function index holds for this file, and absent (never 0) when the index
           has nothing for it. */
        <span
          className="files-fncount mono"
          data-testid="files-fncount"
          title={`${fnCount} ${fnCount === 1 ? 'function' : 'functions'}`}
        >
          {fnCount}
        </span>
      ) : null}
      {row.status !== null ? (
        <span className="files-mark mono" aria-hidden="true">
          {statusLetter(row.status)}
        </span>
      ) : null}
      {row.status === null && row.dirty ? (
        /* A directory says only THAT something under it changed, never what:
           rolling seven files' statuses into one letter would have to pick a
           winner, and any pick is a claim the panel cannot support. It does
           say HOW MANY: a count is a fact, a letter would be a pick. */
        row.changedCount > 0 ? (
          <span className="files-mark files-mark-count mono" aria-hidden="true" title={`${row.changedCount} changed`}>
            {row.changedCount}
          </span>
        ) : (
          <span className="files-mark files-mark-dot" aria-hidden="true" />
        )
      ) : null}
    </RailRow>
  );
}
