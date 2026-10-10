/**
 * DRAW LANGUAGES — which way of writing a chart does a small model ground best?
 *
 * The owner (2026-09-23) asked Sequence to try drawing languages it had not
 * tried, and to borrow from other kinds of programs. Their example was memory
 * carried as a picture: the model looks at one small section of a picture
 * instead of every object. This module is the pure half of the A/B kit that
 * answers the question with numbers instead of taste
 * (tools/measure/draw-lang-ab.mjs is the GPU half).
 *
 * Every language compiles into the SAME SeqChart and then through the SAME
 * validateChart, so the only thing that differs between arms is how the model
 * writes the picture:
 *
 *   json     the propose_chart items/links we ship today (identity)
 *   flow     patch 0011's flow lines: `a -> b: label | narration`
 *   mermaid  flowchart syntax: `a[web/app.ts] -->|calls| b[api/server.py]`
 *   dot      Graphviz: `"web/app.ts" -> "api/server.py" [label="calls"];`
 *   path     POINT, DON'T GENERATE. The harness shows a small NUMBERED MAP of
 *            the scan slice, one line per part (`3 app/main.py → 7, 12`), and
 *            the model answers with numbers only: `3 > 7 | narration`. Every
 *            number resolves through the map, so every part is grounded by
 *            construction and only the hops can be wrong. It is the owner's
 *            picture-memory idea done in text: the model reads one small
 *            picture of the slice and points into it.
 *   ascii    the same numbers drawn as an indented box-and-arrow tree of the
 *            same slice. Same answer (a numeric path), different picture.
 *   d2       a subset of D2 (d2lang.com): `"web/app.ts" -> "api/server.py": calls`,
 *            chains, `a <- b`, `id: label` declarations; shape and style
 *            statements are read and ignored.
 *   states   the chart as a state machine (Mermaid stateDiagram-v2 subset):
 *            each part a state, each hop a transition, `[*]` the start and
 *            end. `[*]` is a concept, not a part, so it needs no scan node;
 *            a transition between two real parts is a hop like any other.
 *
 * Compile problems name the line the author wrote, the same way
 * flowProblemLine does, because a refusal that points at a line gets a line
 * fixed, and one that points at `links[3].to` gets the whole answer rewritten.
 *
 * Pure and browser-safe. No I/O, no clocks, no randomness: the same scan and
 * focus always give the same map, byte for byte (tested).
 */

import {
  type ChartItem,
  type ChartKind,
  type ChartLink,
  type ChartProblem,
  type SeqChart,
  validateChart,
  groundingEdgeKeys,
} from './chart.js';
import {
  type FlowLineProblem,
  type FlowStep,
  chartToFlowLines,
  compileFlowLines,
  flowProblemLine,
  labelOfId,
} from './flowLines.js';

export const DRAW_LANGS = ['json', 'flow', 'mermaid', 'dot', 'path', 'ascii', 'd2', 'states'] as const;
export type DrawLang = (typeof DRAW_LANGS)[number];

export function isDrawLang(value: unknown): value is DrawLang {
  return typeof value === 'string' && (DRAW_LANGS as readonly string[]).includes(value);
}

/** The languages whose answer is a numeric path into a numbered picture. */
export function isPointingLang(lang: DrawLang): lang is 'path' | 'ascii' {
  return lang === 'path' || lang === 'ascii';
}

/* ------------------------------------------------------------ scan input -- */

/** The slice of an ArchGraph this module reads. A full scan.json fits it. */
export interface ScanNodeLike {
  id: string;
  kind?: string;
  label?: string;
  path?: string;
  parentId?: string;
}
export interface ScanEdgeLike {
  srcId: string;
  dstId: string;
  kind?: string;
}
export interface ScanLike {
  nodes: readonly ScanNodeLike[];
  edges: readonly ScanEdgeLike[];
}

/**
 * The crude token proxy the flow-line measurement used: word runs, number
 * runs, and every other non-space character counted once. Not a tokenizer; a
 * stable ruler for comparing two texts against each other.
 */
export function roughTokens(text: string): number {
  return (String(text).match(/[A-Za-z]+|\d+|\S/g) ?? []).length;
}

/** What a part is called in every view: its path for a file, else its node id. */
export function displayOf(node: ScanNodeLike): string {
  return node.path !== undefined && (node.kind === undefined || node.kind === 'file')
    ? node.path.replace(/\\/g, '/')
    : node.kind === undefined && node.label !== undefined
      ? node.label
      : node.id;
}

export type RefResolution = { id: string } | { ambiguous: string[] } | undefined;

/**
 * Resolve what an author wrote to a scan node id.
 *
 * Keys, lowercased: the node id, its display name, and for a node with a path
 * every `/`-suffix of that path (`orders/app/main.py`, `app/main.py`,
 * `main.py`) plus the basename without its extension (`main`). This is the
 * analyzer's resolveNodeIdStems rule widened by the path suffixes, because
 * the owner's own question writes `app/main.py` for a file that may sit
 * deeper. Labels are NOT keys for nodes that have a path, for the analyzer's
 * reason: two parts can share a label, and a silent pick is a fabrication. A
 * key that names two nodes resolves to neither and says so.
 */
export function scanResolver(scan: ScanLike): (ref: string) => RefResolution {
  const byKey = new Map<string, Set<string>>();
  const ids = new Set(scan.nodes.map((n) => n.id));
  const add = (key: string | undefined, id: string): void => {
    if (key === undefined || key === '') return;
    const k = key.toLowerCase();
    const set = byKey.get(k) ?? new Set<string>();
    set.add(id);
    byKey.set(k, set);
  };
  for (const n of scan.nodes) {
    add(displayOf(n), n.id);
    if (n.path === undefined) continue;
    const parts = n.path.replace(/\\/g, '/').split('/').filter((p) => p !== '');
    for (let i = 0; i < parts.length; i += 1) add(parts.slice(i).join('/'), n.id);
    const base = parts[parts.length - 1] ?? '';
    const dot = base.lastIndexOf('.');
    if (dot > 0) add(base.slice(0, dot), n.id);
  }
  return (ref: string) => {
    const raw = String(ref ?? '').trim().replace(/^["'`]|["'`]$/g, '');
    if (raw === '') return undefined;
    if (ids.has(raw)) return { id: raw };
    const hit = byKey.get(raw.toLowerCase().replace(/\\/g, '/').replace(/^\.\//, ''));
    if (hit === undefined) return undefined;
    if (hit.size === 1) return { id: [...hit][0]! };
    return { ambiguous: [...hit].sort() };
  };
}

/* ------------------------------------------------------------- the slice -- */

export interface SliceOptions {
  /** Most parts shown. Default 24: a map a 2.5B model can hold in view. */
  maxNodes?: number;
}

interface Slice {
  /** Selected node ids, numbered: ids[n - 1] is number n. */
  ids: string[];
  display: Map<string, string>;
  /** Out-neighbours inside the slice, deduplicated. */
  outs: Map<string, string[]>;
  /** Focus refs that named no node (or named several). */
  missing: string[];
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pick the focus parts and their neighbours, breadth first, up to maxNodes.
 *
 * Within one ring the candidate most connected to what is already picked goes
 * first, then the lexically smaller id, so the pick never depends on the
 * order the scan listed things. Numbering is by display name, NOT by pick
 * order: a map numbered in focus order would hand the model the answer
 * (`1 > 2 > 3`) and measure nothing.
 */
function selectSlice(scan: ScanLike, focus: readonly string[], opts: SliceOptions = {}): Slice {
  const maxNodes = Math.max(1, Math.floor(opts.maxNodes ?? 24));
  const nodeById = new Map(scan.nodes.map((n) => [n.id, n] as const));
  const resolve = scanResolver(scan);
  const missing: string[] = [];
  const picked: string[] = [];
  const has = new Set<string>();
  const pick = (id: string): void => {
    if (!has.has(id) && picked.length < maxNodes) {
      has.add(id);
      picked.push(id);
    }
  };
  for (const ref of focus) {
    const r = resolve(ref);
    if (r !== undefined && 'id' in r) pick(r.id);
    else missing.push(ref);
  }

  const pairKeys = new Set<string>();
  const adj = new Map<string, Set<string>>();
  const outAll = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    const s = adj.get(a) ?? new Set<string>();
    s.add(b);
    adj.set(a, s);
  };
  for (const e of scan.edges) {
    if (e.srcId === e.dstId || !nodeById.has(e.srcId) || !nodeById.has(e.dstId)) continue;
    const key = `${e.srcId}>${e.dstId}`;
    if (pairKeys.has(key)) continue;
    pairKeys.add(key);
    link(e.srcId, e.dstId);
    link(e.dstId, e.srcId);
    const o = outAll.get(e.srcId) ?? new Set<string>();
    o.add(e.dstId);
    outAll.set(e.srcId, o);
  }
  /* A focus with no edges is a container (a service, a module): its direct
     children are its first ring, or the map would be one lonely box. */
  const children = new Map<string, string[]>();
  for (const n of scan.nodes) {
    if (n.parentId === undefined) continue;
    const c = children.get(n.parentId) ?? [];
    c.push(n.id);
    children.set(n.parentId, c);
  }

  let ring = [...picked];
  const firstRingExtra = new Set<string>();
  for (const id of ring) {
    if ((adj.get(id)?.size ?? 0) === 0) for (const c of children.get(id) ?? []) firstRingExtra.add(c);
  }
  let first = true;
  while (ring.length > 0 && picked.length < maxNodes) {
    const cand = new Set<string>();
    for (const id of ring) for (const nb of adj.get(id) ?? []) if (!has.has(nb)) cand.add(nb);
    if (first) for (const c of firstRingExtra) if (!has.has(c)) cand.add(c);
    first = false;
    const scored = [...cand].map((id) => {
      let score = 0;
      for (const nb of adj.get(id) ?? []) if (has.has(nb)) score += 1;
      return { id, score };
    });
    scored.sort((a, b) => b.score - a.score || byString(a.id, b.id));
    const next: string[] = [];
    for (const s of scored) {
      if (picked.length >= maxNodes) break;
      pick(s.id);
      next.push(s.id);
    }
    ring = next;
  }

  const display = new Map<string, string>();
  for (const id of picked) display.set(id, displayOf(nodeById.get(id)!));
  const ids = [...picked].sort((a, b) => byString(display.get(a)!, display.get(b)!) || byString(a, b));
  const outs = new Map<string, string[]>();
  for (const id of ids) {
    outs.set(id, [...(outAll.get(id) ?? [])].filter((d) => has.has(d)));
  }
  return { ids, display, outs, missing };
}

/* ---------------------------------------------------------- the pictures -- */

export interface NumberedMap {
  /** What the model is shown. */
  text: string;
  /** The node id behind a map number, or undefined when it is not on the map. */
  idOf(n: number): string | undefined;
  /** The map number of a node id. */
  numberOf(id: string): number | undefined;
  /** What the map calls number n (a path, or a node id for a non-file part). */
  labelOf(n: number): string | undefined;
  /** How many numbers the map has (they run 1..size). */
  size: number;
  /** Focus refs that named no node, or more than one. */
  missing: string[];
}

function mapFrom(slice: Slice, text: string): NumberedMap {
  const num = new Map(slice.ids.map((id, i) => [id, i + 1] as const));
  return {
    text,
    idOf: (n) => (Number.isInteger(n) && n >= 1 ? slice.ids[n - 1] : undefined),
    numberOf: (id) => num.get(id),
    labelOf: (n) => {
      const id = Number.isInteger(n) && n >= 1 ? slice.ids[n - 1] : undefined;
      return id === undefined ? undefined : slice.display.get(id);
    },
    size: slice.ids.length,
    missing: [...slice.missing],
  };
}

/**
 * The numbered map: one line per part, `3 app/main.py → 7, 12`, where the
 * arrow lists the parts it calls on this map. This is the whole picture the
 * `path` language points into.
 */
export function numberedMap(
  scan: ScanLike,
  focusIds: readonly string[],
  opts: SliceOptions = {},
): NumberedMap {
  const slice = selectSlice(scan, focusIds, opts);
  const num = new Map(slice.ids.map((id, i) => [id, i + 1] as const));
  const lines = slice.ids.map((id, i) => {
    const outs = slice.outs.get(id)!.map((d) => num.get(d)!).sort((a, b) => a - b);
    return `${i + 1} ${slice.display.get(id)}${outs.length > 0 ? ` → ${outs.join(', ')}` : ''}`;
  });
  return mapFrom(slice, lines.join('\n'));
}

/**
 * The same slice and the same numbers, drawn as a picture: an indented tree of
 * numbered boxes, `[3 app/main.py]`, each child one `->` deeper. A part the
 * tree has already drawn is pointed at by its number alone, `-> [7]`, so every
 * edge on the map appears exactly once.
 */
export function asciiMap(
  scan: ScanLike,
  focusIds: readonly string[],
  opts: SliceOptions = {},
): NumberedMap {
  const slice = selectSlice(scan, focusIds, opts);
  const num = new Map(slice.ids.map((id, i) => [id, i + 1] as const));
  const indeg = new Map<string, number>(slice.ids.map((id) => [id, 0]));
  for (const id of slice.ids) for (const d of slice.outs.get(id)!) indeg.set(d, indeg.get(d)! + 1);
  const drawn = new Set<string>();
  const lines: string[] = [];
  const box = (id: string): string => `[${num.get(id)} ${slice.display.get(id)}]`;
  const walk = (id: string, depth: number): void => {
    const lead = depth === 0 ? '' : `${'   '.repeat(depth - 1)}-> `;
    if (drawn.has(id)) {
      lines.push(`${lead}[${num.get(id)}]`);
      return;
    }
    drawn.add(id);
    lines.push(`${lead}${box(id)}`);
    const outs = [...slice.outs.get(id)!].sort((a, b) => num.get(a)! - num.get(b)!);
    for (const d of outs) walk(d, depth + 1);
  };
  for (const id of slice.ids) if (indeg.get(id) === 0 && !drawn.has(id)) walk(id, 0);
  for (const id of slice.ids) if (!drawn.has(id)) walk(id, 0); /* cycles */
  return mapFrom(slice, lines.join('\n'));
}

/**
 * The view every NAMING language gets: the same slice as the numbered map,
 * one line per part with the parts it calls, but by name instead of number.
 * Same information, so the A/B compares the language and not the context.
 */
export function namedView(scan: ScanLike, focusIds: readonly string[], opts: SliceOptions = {}): string {
  const slice = selectSlice(scan, focusIds, opts);
  return slice.ids
    .map((id) => {
      const outs = slice.outs.get(id)!.map((d) => slice.display.get(d)!).sort(byString);
      return `${slice.display.get(id)}${outs.length > 0 ? ` -> ${outs.join(', ')}` : ''}`;
    })
    .join('\n');
}

/* ------------------------------------------------------------ compiling -- */

export interface DrawHead {
  kind: ChartKind;
  title: string;
  caption?: string;
  focusItemId?: string;
}

export interface CompiledDrawing {
  lang: DrawLang;
  /** Unvalidated: run it through groundDrawing / validateChart before trusting it. */
  chart: Omit<SeqChart, 'version'> & { version: 1 };
  /** One per link, in the order written; `say` is the narration when the language has one. */
  steps: FlowStep[];
  /** item id -> the line that declared it. */
  itemLine: Map<string, number>;
  /** links[i] -> its line. */
  linkLine: number[];
  /** How the author wrote links[i], when that reads better than item ids (`3 > 7`). */
  linkText?: string[];
  /**
   * Items the language itself makes as concepts, not parts (a state diagram's
   * `[*]` start and end). Grounding leaves them without a nodeId, so they
   * claim nothing about the scan and a link touching one is not a hop.
   */
  concepts?: ReadonlySet<string>;
}

export type CompileDrawingResult =
  | ({ ok: true } & CompiledDrawing)
  | { ok: false; problems: FlowLineProblem[] };

export interface CompileContext {
  head: DrawHead;
  /** Required for `path` and `ascii`: the map the model was shown. */
  map?: NumberedMap;
}

/** Items, lines and hops as they are read, shared by the hand-written parsers. */
class Builder {
  readonly items = new Map<string, ChartItem>();
  readonly itemLine = new Map<string, number>();
  readonly links: ChartLink[] = [];
  readonly linkLine: number[] = [];
  readonly linkText: string[] = [];
  readonly steps: FlowStep[] = [];
  readonly problems: FlowLineProblem[] = [];
  readonly concepts = new Set<string>();

  /** What a part with no label is called: Mermaid and Graphviz both show the id itself. */
  constructor(private readonly defaultLabel: (id: string) => string = (id) => id) {}

  touch(id: string, line: number, label?: string): ChartItem {
    const clean = label?.trim();
    let it = this.items.get(id);
    if (it === undefined) {
      it = { id, label: clean || this.defaultLabel(id) };
      this.items.set(id, it);
      this.itemLine.set(id, line);
    } else if (clean && it.label === this.defaultLabel(id)) {
      it.label = clean;
      /* A problem about this part belongs on the line that named it. */
      this.itemLine.set(id, line);
    }
    return it;
  }

  hop(from: string, to: string, line: number, label?: string, say?: string, text?: string): void {
    const l: ChartLink = { from, to };
    const lab = label?.trim();
    if (lab) l.label = lab;
    this.links.push(l);
    this.linkLine.push(line);
    this.linkText.push(text ?? `${from} -> ${to}`);
    const step: FlowStep = { from, to };
    if (say?.trim()) step.say = say.trim();
    this.steps.push(step);
  }

  problem(line: number, message: string): void {
    this.problems.push({ line, message: `line ${line}: ${message}` });
  }

  finish(lang: DrawLang, head: DrawHead, shapes: string, keepLinkText = false): CompileDrawingResult {
    if (this.problems.length === 0 && this.items.size === 0) {
      this.problems.push({ line: 1, message: `the drawing has no parts. Write ${shapes}` });
    }
    if (this.problems.length > 0) return { ok: false, problems: this.problems };
    const chart: CompiledDrawing['chart'] = {
      version: 1,
      kind: head.kind,
      title: head.title,
      items: [...this.items.values()],
      links: this.links,
    };
    if (head.caption !== undefined) chart.caption = head.caption;
    if (head.focusItemId !== undefined) chart.focusItemId = head.focusItemId;
    const out: { ok: true } & CompiledDrawing = {
      ok: true,
      lang,
      chart,
      steps: this.steps,
      itemLine: this.itemLine,
      linkLine: this.linkLine,
    };
    if (keepLinkText) out.linkText = this.linkText;
    if (this.concepts.size > 0) out.concepts = this.concepts;
    return out;
  }
}

const FENCE = /^```/;

/* ---- json ---- */

function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') n += 1;
  return n;
}

function compileJson(text: string, head: DrawHead): CompileDrawingResult {
  const src = String(text ?? '');
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  const shapes = '{"items":[{"id":"a","label":"A","nodeId":"path/to/file"}],"links":[{"from":"a","to":"b"}]}';
  if (start < 0 || end <= start) {
    return { ok: false, problems: [{ line: 1, message: `line 1: no JSON object found. Write ${shapes}` }] };
  }
  let value: unknown;
  try {
    value = JSON.parse(src.slice(start, end + 1));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const pos = /position (\d+)/.exec(msg);
    const lc = /line (\d+)/.exec(msg);
    const line = pos ? lineAt(src, start + Number(pos[1])) : lc ? lineAt(src, start) + Number(lc[1]) - 1 : lineAt(src, start);
    return { ok: false, problems: [{ line, message: `line ${line}: not valid JSON (${msg}). Write ${shapes}` }] };
  }
  let o = value as Record<string, unknown> | null;
  if (o && typeof o === 'object' && !Array.isArray(o.items) && o.chart && typeof o.chart === 'object') {
    o = o.chart as Record<string, unknown>;
  }
  if (!o || typeof o !== 'object' || !Array.isArray(o.items)) {
    return { ok: false, problems: [{ line: lineAt(src, start), message: `line ${lineAt(src, start)}: the JSON has no "items" list. Write ${shapes}` }] };
  }
  const items = o.items as ChartItem[];
  const links = (o.links ?? []) as ChartLink[];
  /* Where each item id and each link was written, so a validator problem can
     name a line: an item on the line that carries its "id", link i on the line
     of the i-th "from". */
  const itemLine = new Map<string, number>();
  for (const it of items) {
    if (!it || typeof it.id !== 'string' || itemLine.has(it.id)) continue;
    const esc = JSON.stringify(it.id).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`"id"\\s*:\\s*"${esc}"`).exec(src);
    if (m) itemLine.set(it.id, lineAt(src, m.index));
  }
  const linkLine: number[] = [];
  const fromRe = /"from"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src)) !== null) linkLine.push(lineAt(src, m.index));
  const chart = {
    ...(o as object),
    version: 1 as const,
    kind: (o.kind ?? head.kind) as ChartKind,
    title: (typeof o.title === 'string' && o.title !== '' ? o.title : head.title) as string,
    items,
    links,
  } as CompiledDrawing['chart'];
  const steps: FlowStep[] = Array.isArray(links)
    ? links.map((l) => ({ from: String(l?.from), to: String(l?.to) }))
    : [];
  return { ok: true, lang: 'json', chart, steps, itemLine, linkLine };
}

/* ---- mermaid ---- */

const MERMAID_SKIP =
  /^(?:(?:flowchart|graph)(?:\s+(?:TD|TB|LR|RL|BT))?|subgraph\b.*|end|direction\s+\w+|classDef\b.*|class\s.*|style\s.*|linkStyle\b.*|click\s.*|accTitle\b.*|accDescr\b.*|title\s.*|---)$/i;
const M_ID = /\s*([A-Za-z0-9_]+(?:[.\-][A-Za-z0-9_]+)*)/y;
const M_TEXT_ARROW = /\s*(?:--|==|-\.)\s+(.+?)\s+(?:-{2,}>|={2,}>|\.+->|-{3,}|={3,})/y;
const M_ARROW = /\s*(?:<?-{2,}>|<?={2,}>|<?-\.+->|-\.+-|-{3,}|={3,}|--[xo](?=\s|[A-Za-z0-9_])|->|~~~)/y;
const M_PIPE = /\s*\|([^|]*)\|/y;
const M_AMP = /\s*&/y;
const M_SHAPES = '`a[path/to/file] -->|what moves| b[other/file]`, one hop or chain per line';

function mermaidShapeLabel(line: string, at: number): { label: string; end: number } | undefined {
  const open = line[at];
  if (open === undefined || !'[({>'.includes(open)) return undefined;
  let i = at;
  while (i < line.length && '[({>/\\'.includes(line[i]!)) i += 1;
  let label: string;
  if (line[i] === '"') {
    const close = line.indexOf('"', i + 1);
    if (close < 0) return undefined;
    label = line.slice(i + 1, close);
    i = close + 1;
  } else {
    let j = i;
    while (j < line.length && !'])}'.includes(line[j]!)) j += 1;
    if (j >= line.length) return undefined;
    label = line.slice(i, j).replace(/[/\\]+$/, '');
    i = j;
  }
  while (i < line.length && '])}/\\'.includes(line[i]!)) i += 1;
  return { label: label.replace(/#quot;/g, '"').trim(), end: i };
}

function compileMermaid(text: string, head: DrawHead): CompileDrawingResult {
  const b = new Builder();
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((raw, idx) => {
      const n = idx + 1;
      const line = raw.trim().replace(/;\s*$/, '');
      if (line === '' || line.startsWith('%%') || FENCE.test(line) || MERMAID_SKIP.test(line)) return;
      let pos = 0;
      const readNode = (): { id: string; label?: string } | undefined => {
        M_ID.lastIndex = pos;
        const m = M_ID.exec(line);
        if (!m) return undefined;
        pos = M_ID.lastIndex;
        const shape = mermaidShapeLabel(line, pos);
        if (shape !== undefined) {
          pos = shape.end;
          return { id: m[1]!, label: shape.label };
        }
        return { id: m[1]! };
      };
      const readGroup = (): { id: string; label?: string }[] | undefined => {
        const first = readNode();
        if (!first) return undefined;
        const group = [first];
        for (;;) {
          M_AMP.lastIndex = pos;
          if (!M_AMP.exec(line)) break;
          pos = M_AMP.lastIndex;
          const next = readNode();
          if (!next) return undefined;
          group.push(next);
        }
        return group;
      };
      const fail = (): void => b.problem(n, `cannot read \`${line}\`. Write ${M_SHAPES}`);
      let from = readGroup();
      if (!from) return fail();
      for (const g of from) b.touch(g.id, n, g.label);
      const pending: { from: string[]; to: string[]; label?: string }[] = [];
      for (;;) {
        let label: string | undefined;
        M_TEXT_ARROW.lastIndex = pos;
        const t = M_TEXT_ARROW.exec(line);
        if (t) {
          label = t[1];
          pos = M_TEXT_ARROW.lastIndex;
        } else {
          M_ARROW.lastIndex = pos;
          if (!M_ARROW.exec(line)) break;
          pos = M_ARROW.lastIndex;
          M_PIPE.lastIndex = pos;
          const p = M_PIPE.exec(line);
          if (p) {
            label = p[1];
            pos = M_PIPE.lastIndex;
          }
        }
        const to = readGroup();
        if (!to) return fail();
        for (const g of to) b.touch(g.id, n, g.label);
        const hop: { from: string[]; to: string[]; label?: string } = {
          from: from.map((g) => g.id),
          to: to.map((g) => g.id),
        };
        if (label !== undefined) hop.label = label;
        pending.push(hop);
        from = to;
      }
      let rest = line.slice(pos).trim();
      /* flowLines' `a --> b: label` suffix, which models carry over. */
      const colon = /^:\s*(.*)$/.exec(rest);
      if (colon && pending.length > 0 && pending[pending.length - 1]!.label === undefined) {
        pending[pending.length - 1]!.label = colon[1];
        rest = '';
      }
      if (rest !== '') return fail();
      for (const h of pending) {
        for (const f of h.from) for (const t of h.to) b.hop(f, t, n, h.label);
      }
    });
  return b.finish('mermaid', head, M_SHAPES);
}

/* ---- dot ---- */

interface DotTok {
  kind: 'id' | 'str' | 'punct';
  value: string;
  line: number;
}

function dotTokens(text: string): { toks: DotTok[]; bad?: number } {
  const toks: DotTok[] = [];
  let line = 1;
  let i = 0;
  const s = text;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const atLineStart = /(^|\n)[ \t]*$/.test(s.slice(Math.max(0, i - 200), i)) || i === 0;
    if ((c === '/' && s[i + 1] === '/') || (c === '#' && atLineStart) || (c === '`' && s.startsWith('```', i) && atLineStart)) {
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      const stop = end < 0 ? s.length : end + 2;
      for (let k = i; k < stop; k += 1) if (s[k] === '\n') line += 1;
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let v = '';
      const startLine = line;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && s[j + 1] === '"') {
          v += '"';
          j += 2;
          continue;
        }
        if (s[j] === '\\' && s[j + 1] === '\n') {
          line += 1;
          j += 2;
          continue;
        }
        if (s[j] === '\n') line += 1;
        v += s[j];
        j += 1;
      }
      if (j >= s.length) return { toks, bad: startLine };
      toks.push({ kind: 'str', value: v, line: startLine });
      i = j + 1;
      continue;
    }
    if (c === '<') {
      /* An HTML label: kept as text, tags and all. */
      let depth = 0;
      let j = i;
      const startLine = line;
      for (; j < s.length; j += 1) {
        if (s[j] === '<') depth += 1;
        else if (s[j] === '>') depth -= 1;
        else if (s[j] === '\n') line += 1;
        if (depth === 0) break;
      }
      toks.push({ kind: 'str', value: s.slice(i + 1, j).replace(/<[^>]*>/g, ' ').trim(), line: startLine });
      i = j + 1;
      continue;
    }
    if (s.startsWith('->', i) || s.startsWith('--', i)) {
      toks.push({ kind: 'punct', value: '->', line });
      i += 2;
      continue;
    }
    if ('{}[];,=:'.includes(c)) {
      toks.push({ kind: 'punct', value: c, line });
      i += 1;
      continue;
    }
    const m = /^(?:-?(?:\.\d+|\d+(?:\.\d*)?)|[A-Za-z_\u0080-￿][\w\u0080-￿]*)/.exec(s.slice(i, i + 400));
    if (!m) {
      /* A character DOT has no use for (prose punctuation, mostly): kept as a
         token so the parser refuses the statement it sits in, on its line. */
      toks.push({ kind: 'punct', value: c, line });
      i += 1;
      continue;
    }
    toks.push({ kind: 'id', value: m[0], line });
    i += m[0].length;
  }
  return { toks };
}

const DOT_SHAPES = '`"path/to/a" -> "path/to/b" [label="what moves"];` or `a [label="A"];`';

function compileDot(text: string, head: DrawHead): CompileDrawingResult {
  const b = new Builder();
  const src = String(text ?? '');
  const lines = src.split(/\r?\n/);
  const { toks, bad } = dotTokens(src);
  if (bad !== undefined) b.problem(bad, `cannot read \`${(lines[bad - 1] ?? '').trim()}\` (an unclosed quote?). Write ${DOT_SHAPES}`);
  let i = 0;
  const peek = (k = 0): DotTok | undefined => toks[i + k];
  const isP = (t: DotTok | undefined, v: string): boolean => t !== undefined && t.kind === 'punct' && t.value === v;
  const kw = (t: DotTok | undefined, v: string): boolean => t !== undefined && t.kind === 'id' && t.value.toLowerCase() === v;
  const isId = (t: DotTok | undefined): boolean => t !== undefined && (t.kind === 'id' || t.kind === 'str');
  const fail = (t: DotTok | undefined): void => {
    const line = t?.line ?? lines.length;
    b.problem(line, `cannot read \`${(lines[line - 1] ?? '').trim()}\`. Write ${DOT_SHAPES}`);
    /* Recover at the next statement: a `;`, a new line, or a brace. */
    const from = t?.line;
    while (i < toks.length && !isP(peek(), ';') && !isP(peek(), '}') && peek()!.line === from) i += 1;
    if (isP(peek(), ';')) i += 1;
  };
  const attrs = (): Map<string, string> | undefined => {
    const out = new Map<string, string>();
    while (isP(peek(), '[')) {
      i += 1;
      while (!isP(peek(), ']')) {
        if (!isId(peek())) return undefined;
        const k = peek()!.value.toLowerCase();
        i += 1;
        if (!isP(peek(), '=') || !isId(peek(1))) return undefined;
        out.set(k, peek(1)!.value);
        i += 2;
        if (isP(peek(), ',') || isP(peek(), ';')) i += 1;
      }
      i += 1;
    }
    return out;
  };
  const nodeRef = (): DotTok | undefined => {
    if (!isId(peek())) return undefined;
    const t = peek()!;
    i += 1;
    /* A port (`a:n`) names a side of the box, not a different box. */
    if (isP(peek(), ':') && isId(peek(1))) i += 2;
    if (isP(peek(), ':') && isId(peek(1))) i += 2;
    return t;
  };
  /* When the answer has a graph block, anything outside it is prose, not
     structure: refused like any other unreadable line instead of being read as
     a pile of bare node names. With no block, the statements stand alone. */
  const hasBlock = toks.some(
    (t, k) => (kw(t, 'digraph') || kw(t, 'graph')) && (isP(toks[k + 1], '{') || isP(toks[k + 2], '{')),
  );
  const outside = (t: DotTok): void => {
    b.problem(t.line, `\`${(lines[t.line - 1] ?? '').trim()}\` is outside the graph block. Write only the graph: ${DOT_SHAPES}`);
    const from = t.line;
    while (i < toks.length && peek()!.line === from) i += 1;
  };
  const stmts = (depth: number): void => {
    while (i < toks.length) {
      const t = peek()!;
      const header =
        kw(t, 'strict') || ((kw(t, 'digraph') || kw(t, 'graph')) && !isP(peek(1), '['));
      if (hasBlock && depth === 0 && !header) {
        outside(t);
        continue;
      }
      if (isP(t, '}')) {
        i += 1;
        if (depth > 0) return;
        continue;
      }
      if (isP(t, ';') || isP(t, ',')) {
        i += 1;
        continue;
      }
      if (kw(t, 'strict')) {
        i += 1;
        continue;
      }
      if (kw(t, 'digraph') || kw(t, 'graph') || kw(t, 'subgraph')) {
        if (!isP(peek(1), '[')) {
          i += 1;
          if (isId(peek()) && !isP(peek(), '{')) i += 1;
          if (isP(peek(), '{')) {
            i += 1;
            stmts(depth + 1);
          }
          continue;
        }
      }
      if (isP(t, '{')) {
        i += 1;
        stmts(depth + 1);
        continue;
      }
      if ((kw(t, 'node') || kw(t, 'edge') || kw(t, 'graph')) && isP(peek(1), '[')) {
        i += 1;
        if (attrs() === undefined) fail(t);
        continue;
      }
      if (isId(t) && isP(peek(1), '=')) {
        /* A graph attribute: rankdir=LR, label="...". */
        i += 2;
        if (isId(peek())) i += 1;
        continue;
      }
      const first = nodeRef();
      if (first === undefined) {
        fail(t);
        continue;
      }
      const chain: DotTok[] = [first];
      let broken = false;
      while (isP(peek(), '->')) {
        i += 1;
        const next = nodeRef();
        if (next === undefined) {
          broken = true;
          break;
        }
        chain.push(next);
      }
      if (broken) {
        fail(peek() ?? first);
        continue;
      }
      const a = attrs();
      if (a === undefined) {
        fail(first);
        continue;
      }
      if (chain.length === 1) {
        const it = b.touch(first.value, first.line, a.get('label'));
        if (a.has('label')) b.itemLine.set(first.value, first.line);
        const path = a.get('path');
        if (path) it.nodeId = path;
        const detail = a.get('tooltip');
        if (detail) it.detail = detail;
      } else {
        for (const c of chain) b.touch(c.value, c.line);
        for (let k = 1; k < chain.length; k += 1) {
          b.hop(chain[k - 1]!.value, chain[k]!.value, chain[k]!.line, a.get('label'));
        }
      }
    }
  };
  if (bad === undefined) stmts(0);
  return b.finish('dot', head, DOT_SHAPES);
}

/* ---- d2 ---- */

const D2_SHAPES = '`"path/to/a" -> "path/to/b": what moves`, one hop or chain per line';
/** D2's reserved keywords: `x.shape: cylinder`, `style.fill: red`, `direction: right`. */
const D2_RESERVED = new Set([
  'label', 'shape', 'icon', 'width', 'height', 'constraint', 'tooltip', 'link', 'near', 'direction',
  'grid-rows', 'grid-columns', 'grid-gap', 'vertical-gap', 'horizontal-gap', 'class', 'classes', 'vars',
  'style', 'source-arrowhead', 'target-arrowhead', 'layers', 'scenarios', 'steps', 'top', 'left',
]);

type D2Seg = { t: 'stmt'; text: string } | { t: 'open' } | { t: 'close' };

/**
 * One line cut into statements at `;`, `{` and `}` outside quotes, with a
 * `#` comment dropped. A quote opens a string only where a token starts, so
 * the apostrophe in `the app's call` is text. Undefined for an unclosed quote.
 */
function d2Segments(line: string): D2Seg[] | undefined {
  const out: D2Seg[] = [];
  let cur = '';
  const flush = (): void => {
    if (cur.trim() !== '') out.push({ t: 'stmt', text: cur.trim() });
    cur = '';
  };
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    const tokenStart = i === 0 || /[\s:>\-{;]/.test(line[i - 1]!);
    if ((c === '"' || c === "'") && tokenStart) {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
      if (j >= line.length) return undefined;
      cur += line.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) break;
    if (c === ';' || c === '{' || c === '}') {
      flush();
      if (c !== ';') out.push({ t: c === '{' ? 'open' : 'close' });
      continue;
    }
    cur += c;
  }
  flush();
  return out;
}

const unquoteD2 = (v: string): string => {
  const t = v.trim();
  const q = t[0];
  if ((q === '"' || q === "'") && t.length >= 2 && t.endsWith(q)) {
    return t.slice(1, -1).replace(/\\(["'\\])/g, '$1');
  }
  return t;
};

type D2Stmt =
  | { kind: 'attr'; id?: string; attr: string[]; value?: string }
  | { kind: 'decl'; id: string; label?: string }
  | { kind: 'chain'; ids: string[]; arrows: string[]; label?: string }
  | { kind: 'undirected' | 'both' | 'bad' | 'skip' };

function parseD2Stmt(s: string): D2Stmt {
  if (s.startsWith('(') || s.startsWith('...')) return { kind: 'skip' }; /* edge refs, imports */
  let pos = 0;
  const ws = (): void => {
    while (pos < s.length && /\s/.test(s[pos]!)) pos += 1;
  };
  const readKey = (): { raw: string; quoted: boolean; suffix: string[] } | undefined => {
    ws();
    const q = s[pos];
    if (q === '"' || q === "'") {
      let j = pos + 1;
      while (j < s.length && s[j] !== q) j += s[j] === '\\' ? 2 : 1;
      const raw = unquoteD2(s.slice(pos, j + 1));
      pos = j + 1;
      const suffix: string[] = [];
      let m: RegExpExecArray | null;
      const seg = /\.([\w-]+)/y;
      while ((seg.lastIndex = pos), (m = seg.exec(s)) !== null) {
        suffix.push(m[1]!);
        pos = seg.lastIndex;
      }
      return raw === '' ? undefined : { raw, quoted: true, suffix };
    }
    const start = pos;
    while (pos < s.length && !':{};'.includes(s[pos]!) && !/^(?:<-|-+>|--)/.test(s.slice(pos, pos + 3))) pos += 1;
    const raw = s.slice(start, pos).trim();
    return raw === '' ? undefined : { raw, quoted: false, suffix: [] };
  };
  const readArrow = (): string | undefined => {
    ws();
    const m = /^(?:<-+>|<-+|-+>|-{2,})/.exec(s.slice(pos));
    if (!m) return undefined;
    pos += m[0].length;
    return m[0].startsWith('<') ? (m[0].endsWith('>') ? '<->' : '<-') : m[0].endsWith('>') ? '->' : '--';
  };
  const first = readKey();
  if (first === undefined) return { kind: 'bad' };
  const keys = [first];
  const arrows: string[] = [];
  for (let a = readArrow(); a !== undefined; a = readArrow()) {
    const k = readKey();
    if (k === undefined) return { kind: 'bad' };
    arrows.push(a);
    keys.push(k);
  }
  ws();
  const rest = s.slice(pos);
  if (rest !== '' && !rest.startsWith(':')) return { kind: 'bad' };
  const value = rest.startsWith(':') ? unquoteD2(rest.slice(1)) : undefined;
  if (arrows.length > 0) {
    if (keys.some((k) => k.suffix.length > 0)) return { kind: 'bad' };
    if (arrows.includes('--')) return { kind: 'undirected' };
    if (arrows.includes('<->')) return { kind: 'both' };
    const chain: D2Stmt = { kind: 'chain', ids: keys.map((k) => k.raw), arrows };
    if (value) chain.label = value;
    return chain;
  }
  /* A declaration or an attribute: the key's first reserved segment starts
     the attribute (`x.py.shape` is part `x.py`, attribute `shape`). */
  let id: string | undefined;
  let attr: string[];
  if (first.quoted) {
    id = first.raw;
    attr = first.suffix;
    if (attr.length > 0 && !D2_RESERVED.has(attr[0]!.toLowerCase())) return { kind: 'bad' };
  } else {
    const segs = first.raw.split('.');
    const k = segs.findIndex((x) => D2_RESERVED.has(x.toLowerCase()));
    id = k < 0 ? first.raw : k === 0 ? undefined : segs.slice(0, k).join('.');
    attr = k < 0 ? [] : segs.slice(k).map((x) => x.toLowerCase());
  }
  if (attr.length > 0) {
    const out: D2Stmt = { kind: 'attr', attr };
    if (id !== undefined) out.id = id;
    if (value !== undefined) out.value = value;
    return out;
  }
  const decl: D2Stmt = { kind: 'decl', id: id! };
  if (value) decl.label = value;
  return decl;
}

/** Only the lines inside a ```d2 fence, when there is one; line numbers kept. */
function d2Lines(text: string): string[] {
  const lines = String(text ?? '').split(/\r?\n/);
  const open = lines.findIndex((l) => /^\s*```\s*d2\b/i.test(l));
  if (open < 0) return lines.map((l) => (FENCE.test(l.trim()) ? '' : l));
  let inside = false;
  let done = false;
  return lines.map((l, k) => {
    if (k === open) {
      inside = true;
      return '';
    }
    if (inside && FENCE.test(l.trim())) {
      inside = false;
      done = true;
      return '';
    }
    return inside && !done ? l : '';
  });
}

function compileD2(text: string, head: DrawHead): CompileDrawingResult {
  const b = new Builder();
  /* A block's owner: `skip` swallows style, vars and edge blocks; `node` is
     `a: label {` and becomes a part unless it turns out to hold other parts,
     in which case it is a container (a grouping box, like a Mermaid subgraph). */
  type Frame = { kind: 'skip' } | { kind: 'node'; id: string; line: number; label?: string; container: boolean };
  const stack: Frame[] = [];
  const closeNode = (f: Frame): void => {
    if (f.kind === 'node' && !f.container) b.touch(f.id, f.line, f.label);
  };
  d2Lines(text).forEach((raw, idx) => {
    const n = idx + 1;
    const line = raw.trim();
    if (line === '') return;
    const segs = d2Segments(line);
    if (segs === undefined) return b.problem(n, `cannot read \`${line}\` (an unclosed quote?). Write ${D2_SHAPES}`);
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i]!;
      if (seg.t === 'close') {
        const f = stack.pop();
        if (f === undefined) b.problem(n, `this \`}\` closes nothing. Write ${D2_SHAPES}`);
        else closeNode(f);
        continue;
      }
      if (seg.t === 'open') {
        stack.push({ kind: 'skip' });
        continue;
      }
      const opens = segs[i + 1]?.t === 'open';
      if (opens) i += 1;
      const top = stack[stack.length - 1];
      if (top?.kind === 'skip') {
        if (opens) stack.push({ kind: 'skip' });
        continue;
      }
      const st = parseD2Stmt(seg.text);
      if (st.kind === 'attr') {
        if (st.attr.length === 1 && st.attr[0] === 'label' && st.value) {
          if (st.id !== undefined) b.touch(st.id, n, st.value);
          else if (top?.kind === 'node') top.label = st.value;
        }
        if (opens) stack.push({ kind: 'skip' });
        continue;
      }
      if (st.kind === 'decl' || st.kind === 'chain') {
        if (top?.kind === 'node') top.container = true;
      }
      if (st.kind === 'decl') {
        if (opens) {
          const f: Frame = { kind: 'node', id: st.id, line: n, container: false };
          if (st.label !== undefined) f.label = st.label;
          stack.push(f);
        } else {
          b.touch(st.id, n, st.label);
        }
        continue;
      }
      if (opens) stack.push({ kind: 'skip' });
      if (st.kind === 'skip') continue;
      if (st.kind === 'undirected') {
        b.problem(n, `\`${seg.text}\` has no direction: \`--\` is a plain line, and a data-flow chart needs arrows. Write \`a -> b\` (or \`b <- a\`)`);
        continue;
      }
      if (st.kind === 'both') {
        b.problem(n, `\`${seg.text}\` claims both directions. Draw each one as its own \`a -> b\` line`);
        continue;
      }
      if (st.kind === 'bad') {
        b.problem(n, `cannot read \`${seg.text}\`. Write ${D2_SHAPES}`);
        continue;
      }
      if (st.kind !== 'chain') continue;
      const { ids, label } = st;
      for (const id of ids) b.touch(id, n);
      st.arrows.forEach((a, k) => {
        const [from, to] = a === '<-' ? [ids[k + 1]!, ids[k]!] : [ids[k]!, ids[k + 1]!];
        b.hop(from, to, n, label);
      });
    }
  });
  for (const f of stack.reverse()) {
    if (f.kind === 'node') b.problem(f.line, `the \`{\` opened after \`${f.id}\` is never closed. Write ${D2_SHAPES}`);
  }
  return b.finish('d2', head, D2_SHAPES);
}

/* ---- states ---- */

const STATE_START = '(start)';
const STATE_END = '(end)';
const STATES_SHAPES = '`a --> b : what moves`, with `state "path/to/file" as a` naming each part';
const STATES_SKIP =
  /^(?:stateDiagram(?:-v2)?|direction\s+\w+|classDef\b.*|class\s.*|style\s.*|accTitle\b.*|accDescr\b.*|title\s.*|hide\s.*|scale\s.*|---|--|\})$/i;
/** A state name: `[*]`, a quoted name, or a run with no spaces (a colon only inside, as in `ds:postgres`). */
const S_REF = /\s*(\[\*\]|"[^"]*"|(?:(?!-+>)[^\s:"])+(?::(?:(?!-+>)[^\s:"])+)*)/y;
const S_ARROW = /\s*-+>/y;

function compileStates(text: string, head: DrawHead): CompileDrawingResult {
  const b = new Builder();
  const concept = (id: string, n: number, label: string): string => {
    b.touch(id, n, label);
    b.concepts.add(id);
    return id;
  };
  let inNote = false;
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((raw, idx) => {
      const n = idx + 1;
      const line = raw.trim().replace(/;\s*$/, '');
      if (inNote) {
        if (/^end\s+note$/i.test(line)) inNote = false;
        return;
      }
      if (line === '' || line.startsWith('%%') || FENCE.test(line) || STATES_SKIP.test(line)) return;
      if (/^note\s/i.test(line)) {
        if (!line.includes(':')) inNote = true;
        return;
      }
      const fail = (): void => b.problem(n, `cannot read \`${line}\`. Write ${STATES_SHAPES}`);
      const decl = /^state\s+"([^"]*)"\s+as\s+(\S+?)\s*(\{)?$/i.exec(line);
      if (decl) {
        if (!decl[3]) b.touch(decl[2]!, n, decl[1]!.replace(/#quot;/g, '"'));
        return;
      }
      const pseudo = /^state\s+(\S+)\s+<<(?:choice|fork|join)>>$/i.exec(line);
      if (pseudo) {
        concept(pseudo[1]!, n, pseudo[1]!);
        return;
      }
      const bare = /^state\s+([^\s"{]+)\s*(\{)?$/i.exec(line);
      if (bare) {
        if (!bare[2]) b.touch(bare[1]!, n);
        return;
      }
      let pos = 0;
      const readRef = (): string | undefined => {
        S_REF.lastIndex = pos;
        const m = S_REF.exec(line);
        if (!m) return undefined;
        pos = S_REF.lastIndex;
        return m[1]!.startsWith('"') ? m[1]!.slice(1, -1) : m[1]!;
      };
      const refs: string[] = [];
      const first = readRef();
      if (first === undefined) return fail();
      refs.push(first);
      for (;;) {
        S_ARROW.lastIndex = pos;
        if (!S_ARROW.exec(line)) break;
        pos = S_ARROW.lastIndex;
        const next = readRef();
        if (next === undefined) return fail();
        refs.push(next);
      }
      const rest = line.slice(pos).trim();
      if (rest !== '' && !rest.startsWith(':')) return fail();
      const label = rest.startsWith(':') ? rest.slice(1).trim() : undefined;
      if (refs.length === 1) {
        /* `a : description` names the state, the way Mermaid shows it. */
        if (first === '[*]') return fail();
        b.touch(first, n, label);
        return;
      }
      const ids: string[] = [];
      for (const [k, r] of refs.entries()) {
        if (r !== '[*]') {
          b.touch(r, n);
          ids.push(r);
        } else if (k === 0) ids.push(concept(STATE_START, n, 'start'));
        else if (k === refs.length - 1) ids.push(concept(STATE_END, n, 'end'));
        else {
          b.problem(n, `\`[*]\` in the middle of \`${line}\` is neither the start nor the end. Write ${STATES_SHAPES}`);
          return;
        }
      }
      for (let k = 1; k < ids.length; k += 1) b.hop(ids[k - 1]!, ids[k]!, n, label || undefined);
    });
  return b.finish('states', head, STATES_SHAPES);
}

/* ---- path / ascii ---- */

const PATH_SEP = /\s*(?:-+>|→|⟶|=>|>)\s*/;
const PATH_SHAPES = '`3 > 7 | what happens`, numbers from the map, one hop per line';

function compilePath(lang: 'path' | 'ascii', text: string, head: DrawHead, map: NumberedMap): CompileDrawingResult {
  const b = new Builder();
  let last: string | undefined;
  const nameIndex = new Map<string, number[]>();
  for (let k = 1; k <= map.size; k += 1) {
    const label = map.labelOf(k)!.toLowerCase();
    const base = label.slice(label.lastIndexOf('/') + 1);
    for (const key of new Set([label, base])) nameIndex.set(key, [...(nameIndex.get(key) ?? []), k]);
  }
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((raw, idx) => {
      const n = idx + 1;
      let line = raw.trim();
      if (line === '' || FENCE.test(line) || /^(?:%%|#|\/\/)/.test(line)) return;
      line = line
        .replace(/^(?:answer|path)\s*:\s*/i, '')
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+(?=\[?#?\d+\]?\s*(?:-+>|→|>))/, '')
        .replace(/[.;]\s*$/, '');
      const bar = line.indexOf('|');
      let body = bar >= 0 ? line.slice(0, bar).trim() : line;
      const say = bar >= 0 ? line.slice(bar + 1).trim() : undefined;
      let label: string | undefined;
      const lab = /^(.*?\d\]?)\s*:\s*(.+)$/.exec(body);
      if (lab) {
        body = lab[1]!;
        label = lab[2]!;
      }
      const continues = /^(?:-+>|→|⟶|=>|>)/.test(body);
      const parts = body.split(PATH_SEP).map((p) => p.trim());
      if (continues) parts.shift();
      const nums: number[] = [];
      for (const p of parts) {
        const m = /^\[?#?(\d+)\]?(?:\s.*)?$/.exec(p);
        if (!m) {
          const hit = nameIndex.get(p.toLowerCase().replace(/^\[|\]$/g, ''));
          const hint = hit?.length === 1 ? ` "${p}" is ${hit[0]} on the map.` : '';
          b.problem(n, `\`${p || line}\` is not a number from the map.${hint} Write ${PATH_SHAPES}`);
          return;
        }
        const num = Number(m[1]);
        if (map.idOf(num) === undefined) {
          b.problem(n, `${num} is not on the map; its numbers run 1-${map.size}. Write ${PATH_SHAPES}`);
          return;
        }
        nums.push(num);
      }
      if (nums.length === 0) {
        b.problem(n, `cannot read \`${line}\`. Write ${PATH_SHAPES}`);
        return;
      }
      const ids = nums.map((k) => map.idOf(k)!);
      if (continues) {
        if (last === undefined) {
          b.problem(n, `\`${line}\` continues a path that has not started. Write ${PATH_SHAPES}`);
          return;
        }
        ids.unshift(last);
        nums.unshift(map.numberOf(last)!);
      }
      ids.forEach((id, k) => {
        const it = b.touch(id, n, map.labelOf(nums[k]!));
        it.nodeId = id;
      });
      for (let k = 1; k < ids.length; k += 1) {
        const lastHop = k === ids.length - 1;
        b.hop(ids[k - 1]!, ids[k]!, n, lastHop ? label : undefined, lastHop ? say : undefined, `${nums[k - 1]} > ${nums[k]}`);
      }
      last = ids[ids.length - 1];
    });
  return b.finish(lang, head, PATH_SHAPES, true);
}

/**
 * Compile what the author wrote in `lang` into a chart. Structural only: the
 * chart is unvalidated. Use {@link groundDrawing} to check it against a scan.
 */
export function compileDrawing(lang: DrawLang, text: string, ctx: CompileContext): CompileDrawingResult {
  switch (lang) {
    case 'json':
      return compileJson(text, ctx.head);
    case 'flow': {
      const r = compileFlowLines(text, ctx.head);
      return r.ok ? { ...r, lang: 'flow' } : r;
    }
    case 'mermaid':
      return compileMermaid(text, ctx.head);
    case 'dot':
      return compileDot(text, ctx.head);
    case 'd2':
      return compileD2(text, ctx.head);
    case 'states':
      return compileStates(text, ctx.head);
    case 'path':
    case 'ascii':
      if (ctx.map === undefined) throw new TypeError(`compileDrawing: ${lang} needs the map the model was shown`);
      return compilePath(lang, text, ctx.head, ctx.map);
    default:
      throw new TypeError(`compileDrawing: unknown language ${String(lang)}`);
  }
}

/**
 * Put a validator problem back on the line the author wrote. Same contract as
 * flowProblemLine; a pointing language names the hop by its numbers.
 */
export function drawingProblemLine(
  compiled: Pick<CompiledDrawing, 'chart' | 'itemLine' | 'linkLine' | 'linkText'>,
  problem: ChartProblem,
): string {
  const link = /^links\[(\d+)\]/.exec(problem.path);
  if (link && compiled.linkText !== undefined) {
    const i = Number(link[1]);
    const n = compiled.linkLine[i];
    const t = compiled.linkText[i];
    if (n !== undefined && t !== undefined) return `line ${n} (${t}): ${problem.message}`;
  }
  return flowProblemLine(compiled, problem);
}

/* ------------------------------------------------------------ grounding -- */

export interface GroundResult {
  /** The text compiled into a chart. */
  parsed: boolean;
  /** Every part is a scan node and every hop a scan edge (validateChart passed). */
  grounded: boolean;
  /** Line-named problems: compile problems, or validator problems mapped to lines. */
  problems: string[];
  /** The chart with every part's nodeId resolved, when it parsed. */
  chart?: CompiledDrawing['chart'];
  steps?: FlowStep[];
  /** Parts that claim a scan node: every item but the language's own concepts (`[*]`). */
  nodes: number;
  nodesGrounded: number;
  /** Hops between parts: every link but those touching a concept. */
  edges: number;
  edgesGrounded: number;
  /** Each link as a scan-node pair, when both ends resolved. */
  nodePairs: [string, string][];
}

/**
 * Compile, resolve every part to a scan node, and validate against the scan.
 *
 * ONE RULE FOR EVERY LANGUAGE: each part must stand for a real node. A part's
 * explicit nodeId is resolved first, then its label, then its id; whatever it
 * finally names is handed to validateChart with the scan's node and edge sets,
 * so an invented part and an invented arrow are refused by exactly the check
 * propose_chart already uses. A pointing language gets this for free: its
 * parts come from the map. The one exception is a concept the language itself
 * makes (a state diagram's `[*]`): it is left without a nodeId, so it claims
 * nothing about the scan, exactly like a concept box in propose_chart.
 */
export function groundDrawing(
  lang: DrawLang,
  text: string,
  scan: ScanLike,
  ctx: CompileContext,
): GroundResult {
  const empty = { nodes: 0, nodesGrounded: 0, edges: 0, edgesGrounded: 0, nodePairs: [] as [string, string][] };
  let compiled: CompileDrawingResult;
  try {
    compiled = compileDrawing(lang, text, ctx);
  } catch (e) {
    if (e instanceof TypeError && /needs the map|unknown language/.test(e.message)) throw e;
    return { parsed: false, grounded: false, problems: [String(e)], ...empty };
  }
  if (!compiled.ok) {
    return { parsed: false, grounded: false, problems: compiled.problems.map((p) => p.message), ...empty };
  }
  const resolve = scanResolver(scan);
  const known = new Set(scan.nodes.map((n) => n.id));
  const knownEdges = groundingEdgeKeys(scan.edges);
  const problems: string[] = [];
  const rawItems = Array.isArray(compiled.chart.items) ? compiled.chart.items : [];
  const ambiguousAt = new Set<number>();
  const concepts = compiled.concepts ?? new Set<string>();
  const items = rawItems.map((it, i) => {
    if (!it || typeof it !== 'object') return it;
    if (concepts.has(it.id)) return it;
    /* An explicit nodeId is the author's claim and is the only ref tried, as
       in the analyzer: a wrong path is not rescued by a lucky label. */
    const refs = (typeof it.nodeId === 'string' && it.nodeId !== '' ? [it.nodeId] : [it.label, it.id]).filter(
      (r): r is string => typeof r === 'string' && r !== '',
    );
    for (const ref of refs) {
      const r = resolve(ref);
      if (r === undefined) continue;
      if ('ambiguous' in r) {
        const n = compiled.itemLine.get(it.id);
        problems.push(
          `${n === undefined ? `item ${it.id}` : `line ${n} (${it.id})`}: "${ref}" matches ${r.ambiguous.length} ` +
            `parts (${r.ambiguous.join(', ')}). Name the one you mean`,
        );
        ambiguousAt.add(i);
        return { ...it, nodeId: ref };
      }
      return { ...it, nodeId: r.id };
    }
    return { ...it, nodeId: refs[0] ?? it.id };
  });
  const chart = { ...compiled.chart, items } as CompiledDrawing['chart'];
  const nodeOf = new Map<string, string>();
  for (const it of items) if (it && typeof it.nodeId === 'string') nodeOf.set(it.id, it.nodeId);
  const links = Array.isArray(chart.links) ? chart.links : [];
  const hops = links.filter((l) => !(l && (concepts.has(l.from) || concepts.has(l.to))));
  const parts = items.filter((it) => !(it && concepts.has(it.id)));
  const nodePairs: [string, string][] = [];
  let edgesGrounded = 0;
  for (const l of links) {
    const a = l ? nodeOf.get(l.from) : undefined;
    const z = l ? nodeOf.get(l.to) : undefined;
    if (a !== undefined && z !== undefined && known.has(a) && known.has(z)) {
      nodePairs.push([a, z]);
      if (knownEdges.has(`${a}>${z}`)) edgesGrounded += 1;
    }
  }
  const v = validateChart(chart, known, knownEdges);
  if (!v.ok) {
    const withLines = { ...compiled, chart };
    for (const p of v.problems) {
      /* Already named above, with the candidates; the validator would only
         repeat it as "not a node". */
      const at = /^items\[(\d+)\]\.nodeId$/.exec(p.path);
      if (at && ambiguousAt.has(Number(at[1]))) continue;
      problems.push(drawingProblemLine(withLines, p));
    }
  }
  return {
    parsed: true,
    grounded: problems.length === 0,
    problems,
    chart,
    steps: compiled.steps,
    nodes: parts.length,
    nodesGrounded: parts.filter((it) => it && typeof it.nodeId === 'string' && known.has(it.nodeId)).length,
    edges: hops.length,
    edgesGrounded,
    nodePairs,
  };
}

/**
 * The share of the expected route the answer drew: consecutive pairs of
 * `expect` (scan refs, resolved like everything else) that appear as a link in
 * the same direction. Undefined when there is no hop to expect.
 */
export function hopCoverage(
  scan: ScanLike,
  nodePairs: readonly (readonly [string, string])[],
  expect: readonly string[],
): number | undefined {
  const resolve = scanResolver(scan);
  const ids = expect.map((r) => {
    const x = resolve(r);
    return x !== undefined && 'id' in x ? x.id : `?${r}`;
  });
  if (ids.length < 2) return undefined;
  const have = new Set(nodePairs.map(([a, z]) => `${a}>${z}`));
  let hit = 0;
  for (let k = 1; k < ids.length; k += 1) if (have.has(`${ids[k - 1]}>${ids[k]}`)) hit += 1;
  return hit / (ids.length - 1);
}

/* ------------------------------------------------------------- printing -- */

/**
 * Compiling a printed chart puts declared parts first, then the rest in order
 * of first mention. When that would reorder the items, every part is declared.
 */
function declaredFirst(chart: Pick<SeqChart, 'items' | 'links'>, plain: (it: ChartItem) => boolean): ChartItem[] {
  const mention: string[] = [];
  for (const l of chart.links ?? []) for (const id of [l.from, l.to]) if (!mention.includes(id)) mention.push(id);
  const declared = chart.items.filter((it) => !plain(it) || !mention.includes(it.id));
  const ids = new Set(declared.map((it) => it.id));
  const order = [...declared.map((it) => it.id), ...mention.filter((id) => !ids.has(id))];
  return order.join('\n') === chart.items.map((it) => it.id).join('\n') ? declared : chart.items;
}

const MERMAID_ID = /^[A-Za-z0-9_]+(?:[.\-][A-Za-z0-9_]+)*$/;

function mermaidLabel(label: string): string {
  return /^[\w ./:-]*$/.test(label) ? label : `"${label.replace(/"/g, '#quot;')}"`;
}

function chartToMermaid(chart: Pick<SeqChart, 'items' | 'links'>): string {
  const bad = chart.items.find((it) => !MERMAID_ID.test(it.id));
  if (bad) throw new TypeError(`chartToMermaid: "${bad.id}" is not a Mermaid node id`);
  const out = ['flowchart LR'];
  for (const it of declaredFirst(chart, (it) => it.label === it.id)) {
    out.push(`  ${it.id}[${mermaidLabel(it.label)}]`);
  }
  for (const l of chart.links ?? []) {
    const lab = l.label !== undefined ? `|${l.label.replace(/\|/g, '/')}|` : '';
    out.push(`  ${l.from} -->${lab} ${l.to}`);
  }
  return out.join('\n');
}

const DOT_KEYWORDS = new Set(['node', 'edge', 'graph', 'digraph', 'subgraph', 'strict']);
function dotId(id: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) && !DOT_KEYWORDS.has(id.toLowerCase())
    ? id
    : `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
const dotStr = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function chartToDot(chart: Pick<SeqChart, 'items' | 'links'>): string {
  const out = ['digraph G {'];
  for (const it of declaredFirst(chart, (it) => it.label === it.id && it.nodeId === undefined && it.detail === undefined)) {
    const a: string[] = [];
    if (it.label !== it.id) a.push(`label=${dotStr(it.label)}`);
    if (it.nodeId !== undefined) a.push(`path=${dotStr(it.nodeId)}`);
    if (it.detail !== undefined) a.push(`tooltip=${dotStr(it.detail)}`);
    out.push(`  ${dotId(it.id)}${a.length > 0 ? ` [${a.join(', ')}]` : ''};`);
  }
  for (const l of chart.links ?? []) {
    out.push(`  ${dotId(l.from)} -> ${dotId(l.to)}${l.label !== undefined ? ` [label=${dotStr(l.label)}]` : ''};`);
  }
  out.push('}');
  return out.join('\n');
}

const d2Key = (id: string): string =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) && !D2_RESERVED.has(id.toLowerCase())
    ? id
    : `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const d2Value = (v: string): string =>
  /^[\w./-][\w ./-]*$/.test(v) && v.trim() === v && v !== 'null'
    ? v
    : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function chartToD2(chart: Pick<SeqChart, 'items' | 'links'>): string {
  const out: string[] = [];
  for (const it of declaredFirst(chart, (it) => it.label === it.id)) {
    out.push(it.label === it.id ? d2Key(it.id) : `${d2Key(it.id)}: ${d2Value(it.label)}`);
  }
  for (const l of chart.links ?? []) {
    out.push(`${d2Key(l.from)} -> ${d2Key(l.to)}${l.label !== undefined ? `: ${d2Value(l.label)}` : ''}`);
  }
  return out.join('\n');
}

const STATE_ID = /^(?:(?!-+>)[^\s:"])+(?::(?:(?!-+>)[^\s:"])+)*$/;
const isStateConcept = (it: ChartItem): boolean =>
  (it.id === STATE_START || it.id === STATE_END) && it.nodeId === undefined;

function chartToStates(chart: Pick<SeqChart, 'items' | 'links'>): string {
  const bad = chart.items.find((it) => !isStateConcept(it) && (!STATE_ID.test(it.id) || it.id === '[*]'));
  if (bad) throw new TypeError(`chartToStates: "${bad.id}" is not a state id`);
  const concept = new Set(chart.items.filter(isStateConcept).map((it) => it.id));
  const out = ['stateDiagram-v2'];
  for (const it of declaredFirst(chart, (it) => concept.has(it.id) || it.label === it.id)) {
    if (concept.has(it.id)) continue;
    out.push(it.label === it.id ? `  state ${it.id}` : `  state "${it.label.replace(/"/g, '#quot;')}" as ${it.id}`);
  }
  for (const l of chart.links ?? []) {
    if (l.to === STATE_START || l.from === STATE_END) {
      throw new TypeError(`chartToStates: [*] cannot be drawn from the end or into the start`);
    }
    const ref = (id: string): string => (concept.has(id) ? '[*]' : id);
    out.push(`  ${ref(l.from)} --> ${ref(l.to)}${l.label !== undefined ? ` : ${l.label}` : ''}`);
  }
  return out.join('\n');
}

function chartToJson(chart: Pick<SeqChart, 'items' | 'links'>): string {
  const items = chart.items.map((it) => JSON.stringify(it));
  const links = (chart.links ?? []).map((l) => JSON.stringify(l));
  return `{"items":[\n${items.join(',\n')}\n],"links":[\n${links.join(',\n')}\n]}`;
}

function chartToPath(
  chart: Pick<SeqChart, 'items' | 'links'>,
  map: NumberedMap,
  steps?: readonly FlowStep[],
): string {
  const itemNode = new Map(chart.items.map((it) => [it.id, it.nodeId ?? it.id] as const));
  const num = (itemId: string): number => {
    const k = map.numberOf(itemNode.get(itemId) ?? itemId);
    if (k === undefined) throw new TypeError(`chartToPath: "${itemId}" is not on the map`);
    return k;
  };
  const out: string[] = [];
  for (const it of declaredFirst(chart, () => true)) out.push(String(num(it.id)));
  (chart.links ?? []).forEach((l, i) => {
    let line = `${num(l.from)} > ${num(l.to)}`;
    if (l.label !== undefined) line += `: ${l.label.replace(/\|/g, '/')}`;
    const say = steps?.[i]?.say;
    if (say) line += ` | ${say}`;
    out.push(line);
  });
  return out.join('\n');
}

/**
 * Print a chart in `lang`: what a model would have written to draw it.
 * Compiling the result gives back the same parts and hops (tested on the
 * model's real propose_chart calls). What each language carries: json all of
 * it; flow and dot id, label, nodeId, detail, link labels; mermaid, d2 and
 * states id, label, link labels (states also its `[*]` start and end);
 * path/ascii the map's parts and link labels plus narration.
 */
export function printDrawing(
  lang: DrawLang,
  chart: Pick<SeqChart, 'items' | 'links'>,
  opts: { map?: NumberedMap; steps?: readonly FlowStep[] } = {},
): string {
  switch (lang) {
    case 'json':
      return chartToJson(chart);
    case 'flow':
      return chartToFlowLines(chart, opts.steps);
    case 'mermaid':
      return chartToMermaid(chart);
    case 'dot':
      return chartToDot(chart);
    case 'd2':
      return chartToD2(chart);
    case 'states':
      return chartToStates(chart);
    case 'path':
    case 'ascii':
      if (opts.map === undefined) throw new TypeError(`printDrawing: ${lang} needs a map`);
      return chartToPath(chart, opts.map, opts.steps);
    default:
      throw new TypeError(`printDrawing: unknown language ${String(lang)}`);
  }
}

/* --------------------------------------------------------- instructions -- */

/*
 * Written for a 2.5B model: one rule per sentence, the answer shape stated
 * first, and one worked example on a made-up three-file app so the example
 * never leaks the answer to a real question. Every example obeys its own
 * rules and compiles (tested).
 */
const EXAMPLE_VIEW = 'api/db.py\napi/server.py -> api/db.py\nweb/app.ts -> api/server.py';
const EXAMPLE_MAP = '1 api/db.py\n2 api/server.py → 1\n3 web/app.ts → 2';

const INSTRUCTIONS: Record<DrawLang, string> = {
  json: [
    'Draw the answer as JSON only: {"items":[...],"links":[...]}.',
    'Each item is {"id","label","nodeId"}; nodeId is a file copied from the code list.',
    'Each link is {"from","to","label"} joining item ids, only where the list has an arrow.',
    'Example code list:',
    EXAMPLE_VIEW,
    'Example answer:',
    '{"items":[{"id":"app","label":"App","nodeId":"web/app.ts"},{"id":"srv","label":"Server","nodeId":"api/server.py"}],' +
      '"links":[{"from":"app","to":"srv","label":"sends the request"}]}',
  ].join('\n'),
  flow: [
    'Draw the answer as flow lines only.',
    'Declare a part as: id "Label" = file (the file copied from the code list).',
    'Write each hop on its own line as: a -> b: what moves | what happens.',
    'Only draw a hop where the code list has an arrow.',
    'Example code list:',
    EXAMPLE_VIEW,
    'Example answer:',
    'app "App" = web/app.ts',
    'srv "Server" = api/server.py',
    'app -> srv: the request | The app sends the request to the server',
  ].join('\n'),
  mermaid: [
    'Draw the answer as a Mermaid flowchart only.',
    'Write each hop as: a[file] -->|what moves| b[file], with files copied from the code list.',
    'Only draw a hop where the code list has an arrow.',
    'Example code list:',
    EXAMPLE_VIEW,
    'Example answer:',
    'flowchart LR',
    '  app[web/app.ts] -->|request| srv[api/server.py]',
  ].join('\n'),
  dot: [
    'Draw the answer as a Graphviz digraph only.',
    'Name each node by its file in quotes, copied from the code list.',
    'Write each hop as: "a" -> "b" [label="what moves"]; only where the code list has an arrow.',
    'Example code list:',
    EXAMPLE_VIEW,
    'Example answer:',
    'digraph G {',
    '  "web/app.ts" -> "api/server.py" [label="request"];',
    '}',
  ].join('\n'),
  path: [
    'You are shown a numbered map. Each line is: number, file, → the numbers it calls.',
    'Answer ONLY with numbers from the map. Follow the arrows.',
    'Write one hop per line as: 3 > 7 | what happens.',
    'Example map:',
    EXAMPLE_MAP,
    'Example answer:',
    '3 > 2 | the app sends the request to the server',
    '2 > 1 | the server reads the database',
  ].join('\n'),
  ascii: [
    'You are shown a numbered picture. Each box is [number file]; -> points at what it calls.',
    'Answer ONLY with numbers from the picture. Follow the arrows.',
    'Write one hop per line as: 3 > 7 | what happens.',
    'Example picture:',
    '[3 web/app.ts]\n-> [2 api/server.py]\n   -> [1 api/db.py]',
    'Example answer:',
    '3 > 2 | the app sends the request to the server',
    '2 > 1 | the server reads the database',
  ].join('\n'),
  d2: [
    'Draw the answer as a D2 diagram only.',
    'Name each shape by its file in quotes, copied from the code list.',
    'Write each hop as: "a" -> "b": what moves; only where the code list has an arrow.',
    'Example code list:',
    EXAMPLE_VIEW,
    'Example answer:',
    '"web/app.ts" -> "api/server.py": request',
  ].join('\n'),
  states: [
    'Draw the answer as a Mermaid state diagram only: each file is a state, each hop a transition.',
    'Declare each state as: state "file" as id, with the file copied from the code list.',
    'Write each hop as: a --> b : what moves; only where the code list has an arrow.',
    'Begin with [*] --> the first state and end with the last state --> [*].',
    'Example code list:',
    EXAMPLE_VIEW,
    'Example answer:',
    'stateDiagram-v2',
    '  state "web/app.ts" as app',
    '  state "api/server.py" as srv',
    '  [*] --> app',
    '  app --> srv : request',
    '  srv --> [*]',
  ].join('\n'),
};

/** The system prompt for `lang`: a short rule set plus one worked example. */
export function instructionFor(lang: DrawLang): string {
  const s = INSTRUCTIONS[lang];
  if (s === undefined) throw new TypeError(`instructionFor: unknown language ${String(lang)}`);
  return s;
}

export interface DrawPrompt {
  system: string;
  user: string;
  /** The view of the scan slice the model sees (map, picture, or named list). */
  view: string;
  /** For pointing languages: the map the answer's numbers resolve through. */
  map?: NumberedMap;
  /** Focus refs that named no node. */
  missing: string[];
}

/**
 * The whole call for one question in one language. The slice is the same for
 * every language; only its view differs.
 */
export function drawPrompt(
  lang: DrawLang,
  question: string,
  scan: ScanLike,
  focus: readonly string[],
  opts: SliceOptions = {},
): DrawPrompt {
  const system = instructionFor(lang);
  if (isPointingLang(lang)) {
    const map = lang === 'path' ? numberedMap(scan, focus, opts) : asciiMap(scan, focus, opts);
    const head = lang === 'path' ? 'Map (number, file → numbers it calls):' : 'Picture (numbered boxes, -> what each calls):';
    return { system, user: `${question}\n\n${head}\n${map.text}`, view: map.text, map, missing: map.missing };
  }
  const view = namedView(scan, focus, opts);
  const missing = numberedMap(scan, focus, opts).missing;
  return { system, user: `${question}\n\nCode list (file -> files it calls):\n${view}`, view, missing };
}
