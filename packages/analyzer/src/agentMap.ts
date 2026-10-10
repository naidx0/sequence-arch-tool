/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT MAP — `.sequence/map.md`, a repository an agent reads in one go
   packages/analyzer/src/agentMap.ts

   Spec: docs/research/overhaul-formats-v2.md §3.3 (overhaul ba996a28).
   Aider's repo map, built from Sequence's graph: one line per item, ranked by
   the PageRank the cluster step computes, cut to a token budget, and
   PARSEABLE BACK (`parseAgentMap(renderAgentMapModel(m))` deep-equals `m`).

     # map <repoName> · scanned <ISO time> · budget <n> · <S> services <E> edges
     <svcLabel> (<language>, <framework>) [<tag>, ...]
       -> <dst>  <http|grpc> <detail>  <file>:<line>
       => <topic>  publish  <file>:<line>
       <= <topic>  consume  <file>:<line>
       ~> <datastore>  <read|write> <table>  <file>:<line>
       apis: GET /orders/*, POST /orders
       modules: <label> (<n> files), ...
     omitted: <k> services, <m> edges. Ask with neighbors(<id>) or path(<a>,<b>).

   Two additions to the grammar, both still one line per edge: an import
   between services is `-> <dst>  import  <file>:<line>`, and a datastore edge
   whose direction the scan could not tell is `~> <ds>  access <table>`.

   BUDGET (tokens = chars / 4; no tokenizer is a dependency here):
     1. services ranked by the summed PageRank of their files (a focus, when
        given, goes first, then its neighbours);
     2. each service adds its line, its cross-service edges (non-import kinds
        first, then by confidence, then kind), its apis, then its modules —
        line by line while the total stays under budget;
     3. the `omitted:` line always ends the map.

   PURE apart from `writeAgentMaps`, the one function that touches disk.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import type { ArchEdge, ArchGraph, ArchNode } from '@sequence/schema';
import { liftToTopLevel } from './explain/serviceGraph.js';

/** The three budgets the map is written at, in tokens. */
export const MAP_BUDGETS = [1000, 4000, 16000] as const;
/** `map.md` is the 4k map; the others carry their budget in the name. */
export const MAP_FILES: Record<number, string> = { 1000: 'map-1k.md', 4000: 'map.md', 16000: 'map-16k.md' };
export const DEFAULT_MAP_BUDGET = 4000;

export const tokensOf = (text: string): number => Math.ceil(text.length / 4);

export type MapArrow = '->' | '=>' | '<=' | '~>';
export interface MapEdgeLine {
  arrow: MapArrow;
  dst: string;
  /** `http GET /orders/*`, `publish`, `read orders`, `import` … */
  what: string;
  at: string;
}
export interface MapService {
  label: string;
  language: string;
  framework: string;
  tags: string[];
  edges: MapEdgeLine[];
  apis: string[];
  modules: { label: string; files: number }[];
}
export interface MapModel {
  repoName: string;
  scannedAt: string;
  budget: number;
  services: number;
  edges: number;
  entries: MapService[];
  omitted: { services: number; edges: number };
}

/* ───────────────────────────── index ───────────────────────────── */

interface Index {
  byId: Map<string, ArchNode>;
  top: (id: string) => ArchNode | undefined;
  rank: (id: string) => number;
}
const indexCache = new WeakMap<ArchGraph, Index>();

/** Lookups every renderer here needs, built once per graph object. */
export function mapIndex(graph: ArchGraph): Index {
  const hit = indexCache.get(graph);
  if (hit) return hit;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const lift = liftToTopLevel(graph);
  const memo = new Map<string, ArchNode | undefined>();
  const top = (id: string): ArchNode | undefined => {
    if (!memo.has(id)) memo.set(id, lift(id));
    return memo.get(id);
  };
  const own = (n: ArchNode | undefined): number => {
    const r = n?.meta?.pageRank;
    return typeof r === 'number' && Number.isFinite(r) ? r : 0;
  };
  const sum = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.kind !== 'file') continue;
    const t = top(n.id);
    if (t) sum.set(t.id, (sum.get(t.id) ?? 0) + own(n));
  }
  const rank = (id: string): number => {
    const n = byId.get(id);
    if (!n) return 0;
    return n.kind === 'file' ? own(n) : (sum.get(n.id) ?? own(n));
  };
  const idx = { byId, top, rank };
  indexCache.set(graph, idx);
  return idx;
}

/** The first evidence line of an edge as `file:line`, or null when it has none. */
export function evidenceAt(e: ArchEdge): string | null {
  const ev = e.evidence.find((x) => x.file && Number.isFinite(x.line) && x.line > 0);
  return ev ? `${ev.file}:${ev.line}` : null;
}

/** The two top-level components an edge joins, or null when it stays inside one. */
export function crossPair(graph: ArchGraph, e: ArchEdge): { src: ArchNode; dst: ArchNode } | null {
  const idx = mapIndex(graph);
  const src = idx.top(e.srcId);
  const dst = idx.top(e.dstId);
  if (!src || !dst || src.id === dst.id) return null;
  return { src, dst };
}

/* ───────────────────────────── model ───────────────────────────── */

const isService = (n: ArchNode | undefined): n is ArchNode => n?.kind === 'service';

/** Which service a cross edge is listed under, and the line it gets there. */
function lineFor(graph: ArchGraph, e: ArchEdge): { owner: ArchNode; line: MapEdgeLine } | null {
  const pair = crossPair(graph, e);
  const at = evidenceAt(e);
  if (!pair || !at) return null;
  const { src, dst } = pair;
  const d = e.detail ?? {};
  const table = typeof d.table === 'string' ? d.table : '';
  const svcEnd = isService(src) ? src : isService(dst) ? dst : null;
  if (!svcEnd) return null;
  const other = svcEnd === src ? dst : src;
  switch (e.kind) {
    case 'http':
    case 'grpc': {
      const detail = [d.method, d.pathPattern].filter((x) => typeof x === 'string' && x).join(' ');
      return { owner: svcEnd, line: { arrow: '->', dst: other.label, what: detail ? `${e.kind} ${detail}` : e.kind, at } };
    }
    case 'queue_publish':
      return { owner: svcEnd, line: { arrow: '=>', dst: other.label, what: 'publish', at } };
    case 'queue_consume':
      return { owner: svcEnd, line: { arrow: '<=', dst: other.label, what: 'consume', at } };
    case 'db_read':
    case 'db_write':
    case 'db_access': {
      const verb = e.kind === 'db_read' ? 'read' : e.kind === 'db_write' ? 'write' : 'access';
      return { owner: svcEnd, line: { arrow: '~>', dst: other.label, what: table ? `${verb} ${table}` : verb, at } };
    }
    case 'import':
      return { owner: svcEnd, line: { arrow: '->', dst: other.label, what: 'import', at } };
    default:
      return null;
  }
}

function languageOf(n: ArchNode): string {
  const m = n.meta ?? {};
  if (typeof m.language === 'string' && m.language) return m.language;
  const langs = m.languages as { language?: string }[] | undefined;
  return Array.isArray(langs) && langs[0]?.language ? String(langs[0].language) : '-';
}

function modulesOf(graph: ArchGraph, svc: ArchNode): { label: string; files: number }[] {
  const idx = mapIndex(graph);
  const counts = new Map<string, number>();
  const declared = graph.nodes.filter((n) => n.kind === 'module' && n.parentId === svc.id);
  if (declared.length) {
    for (const m of declared) counts.set(m.label, graph.nodes.filter((f) => f.kind === 'file' && f.parentId === m.id).length);
  } else {
    /* No module nodes: the first directory under the service path is the module. */
    const base = svc.path ? `${svc.path.replace(/\/+$/, '')}/` : '';
    for (const f of graph.nodes) {
      if (f.kind !== 'file' || !f.path || idx.top(f.id)?.id !== svc.id) continue;
      const rest = base && f.path.startsWith(base) ? f.path.slice(base.length) : f.path;
      const dir = rest.includes('/') ? rest.split('/')[0] : '.';
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([label, files]) => ({ label, files }))
    .sort((a, b) => b.files - a.files || (a.label < b.label ? -1 : 1))
    .slice(0, 8);
}

const kindOrder = (w: string): number => (w === 'import' ? 1 : 0);

export interface MapOptions {
  budget?: number;
  /** A node id; its service goes first, then the services it touches. */
  focus?: string;
}

/** Build the budgeted map model (render it with {@link renderAgentMapModel}). */
export function buildAgentMap(graph: ArchGraph, opts: MapOptions = {}): MapModel {
  const budget = opts.budget ?? DEFAULT_MAP_BUDGET;
  const idx = mapIndex(graph);
  const services = graph.nodes.filter((n) => n.kind === 'service');
  const byOwner = new Map<string, { line: MapEdgeLine; conf: number; kind: string }[]>();
  let crossTotal = 0;
  for (const e of graph.edges) {
    const r = lineFor(graph, e);
    if (!r) continue;
    crossTotal++;
    const list = byOwner.get(r.owner.id) ?? [];
    list.push({ line: r.line, conf: e.confidence, kind: e.kind });
    byOwner.set(r.owner.id, list);
  }
  let order = [...services].sort((a, b) => idx.rank(b.id) - idx.rank(a.id) || (a.id < b.id ? -1 : 1));
  const focus = opts.focus ? idx.top(opts.focus) ?? idx.byId.get(opts.focus) : undefined;
  if (focus) {
    const near = new Set<string>();
    for (const e of graph.edges) {
      const p = crossPair(graph, e);
      if (!p) continue;
      if (p.src.id === focus.id) near.add(p.dst.id);
      if (p.dst.id === focus.id) near.add(p.src.id);
    }
    const tier = (n: ArchNode): number => (n.id === focus.id ? 0 : near.has(n.id) ? 1 : 2);
    order = order.map((n, i) => ({ n, i })).sort((a, b) => tier(a.n) - tier(b.n) || a.i - b.i).map((x) => x.n);
  }

  const model: MapModel = {
    repoName: graph.repoName,
    scannedAt: graph.scannedAt || '-',
    budget,
    services: services.length,
    edges: crossTotal,
    entries: [],
    omitted: { services: 0, edges: 0 },
  };
  /* Reserve the header and a worst-case omitted line, then add line by line. */
  const reserve = renderHeader(model).length + 1 + omittedLine(services.length, crossTotal).length + 1;
  let used = reserve;
  const fits = (line: string): boolean => {
    if (Math.ceil((used + line.length + 1) / 4) > budget) return false;
    used += line.length + 1;
    return true;
  };
  let shownEdges = 0;
  let full = false;
  for (const svc of order) {
    if (full) break;
    const entry: MapService = {
      label: svc.label,
      language: languageOf(svc),
      framework: typeof svc.meta?.framework === 'string' && svc.meta.framework ? svc.meta.framework : '-',
      tags: Array.isArray((svc as { tags?: unknown }).tags) ? ((svc as { tags?: string[] }).tags ?? []) : [],
      edges: [],
      apis: [],
      modules: [],
    };
    if (!fits(serviceLine(entry))) break;
    model.entries.push(entry);
    const edges = (byOwner.get(svc.id) ?? []).sort(
      (a, b) => kindOrder(a.line.what) - kindOrder(b.line.what) || b.conf - a.conf || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.line.at < b.line.at ? -1 : 1),
    );
    for (const x of edges) {
      if (!fits(edgeText(x.line))) {
        full = true;
        break;
      }
      entry.edges.push(x.line);
      shownEdges++;
    }
    if (full) break;
    const apis = (graph.routes ?? [])
      .filter((r) => r.service === svc.id || r.service === svc.label)
      .map((r) => `${r.method} ${r.path}`);
    const uniqueApis = [...new Set(apis)].slice(0, 12);
    if (uniqueApis.length) {
      if (!fits(apisLine(uniqueApis))) {
        full = true;
        break;
      }
      entry.apis = uniqueApis;
    }
    const mods = modulesOf(graph, svc);
    if (mods.length) {
      if (!fits(modulesLine(mods))) {
        full = true;
        break;
      }
      entry.modules = mods;
    }
  }
  model.omitted = { services: services.length - model.entries.length, edges: crossTotal - shownEdges };
  return model;
}

/* ───────────────────────────── text ───────────────────────────── */

function renderHeader(m: MapModel): string {
  return `# map ${m.repoName} · scanned ${m.scannedAt} · budget ${m.budget} · ${m.services} services ${m.edges} edges`;
}
function serviceLine(s: MapService): string {
  return `${s.label} (${s.language}, ${s.framework})${s.tags.length ? ` [${s.tags.join(', ')}]` : ''}`;
}
function edgeText(e: MapEdgeLine): string {
  return `  ${e.arrow} ${e.dst}  ${e.what}  ${e.at}`;
}
function apisLine(apis: string[]): string {
  return `  apis: ${apis.join(', ')}`;
}
function modulesLine(mods: { label: string; files: number }[]): string {
  return `  modules: ${mods.map((m) => `${m.label} (${m.files} files)`).join(', ')}`;
}
function omittedLine(services: number, edges: number): string {
  return `omitted: ${services} services, ${edges} edges. Ask with neighbors(<id>) or path(<a>,<b>).`;
}

export function renderAgentMapModel(m: MapModel): string {
  const out = [renderHeader(m)];
  for (const s of m.entries) {
    out.push(serviceLine(s));
    for (const e of s.edges) out.push(edgeText(e));
    if (s.apis.length) out.push(apisLine(s.apis));
    if (s.modules.length) out.push(modulesLine(s.modules));
  }
  out.push(omittedLine(m.omitted.services, m.omitted.edges));
  return out.join('\n') + '\n';
}

/** The budgeted map as text. */
export function renderAgentMap(graph: ArchGraph, opts: MapOptions = {}): string {
  return renderAgentMapModel(buildAgentMap(graph, opts));
}

/** Parse a map back into its model. Throws on a line the grammar does not allow. */
export function parseAgentMap(text: string): MapModel {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const head = /^# map (.+) · scanned (.+) · budget (\d+) · (\d+) services (\d+) edges$/.exec(lines[0] ?? '');
  if (!head) throw new Error(`map.md: bad header: ${lines[0]}`);
  const m: MapModel = {
    repoName: head[1],
    scannedAt: head[2],
    budget: Number(head[3]),
    services: Number(head[4]),
    edges: Number(head[5]),
    entries: [],
    omitted: { services: 0, edges: 0 },
  };
  let cur: MapService | null = null;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    const om = /^omitted: (\d+) services, (\d+) edges\. /.exec(l);
    if (om) {
      m.omitted = { services: Number(om[1]), edges: Number(om[2]) };
      continue;
    }
    if (!l.startsWith('  ')) {
      const s = /^(.+) \(([^,()]+), ([^()]+)\)(?: \[(.*)\])?$/.exec(l);
      if (!s) throw new Error(`map.md:${i + 1}: bad service line: ${l}`);
      cur = { label: s[1], language: s[2], framework: s[3], tags: s[4] ? s[4].split(', ') : [], edges: [], apis: [], modules: [] };
      m.entries.push(cur);
      continue;
    }
    if (!cur) throw new Error(`map.md:${i + 1}: item before any service`);
    const body = l.slice(2);
    if (body.startsWith('apis: ')) {
      cur.apis = body.slice(6).split(', ');
      continue;
    }
    if (body.startsWith('modules: ')) {
      cur.modules = body
        .slice(9)
        .split(/, (?=[^,]+ \(\d+ files\))/)
        .map((x) => {
          const mm = /^(.+) \((\d+) files\)$/.exec(x);
          if (!mm) throw new Error(`map.md:${i + 1}: bad module: ${x}`);
          return { label: mm[1], files: Number(mm[2]) };
        });
      continue;
    }
    const e = /^(->|=>|<=|~>) (.+?)  (.+)  (\S+:\d+)$/.exec(body);
    if (!e) throw new Error(`map.md:${i + 1}: bad edge line: ${l}`);
    cur.edges.push({ arrow: e[1] as MapArrow, dst: e[2], what: e[3], at: e[4] });
  }
  return m;
}

/** The first `tokens` tokens of a map, cut at a line boundary. */
export function mapHead(text: string, tokens: number): string {
  const max = tokens * 4;
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n', max);
  return text.slice(0, cut > 0 ? cut + 1 : max);
}

/** Budget of the slice a board node hands an agent ("Ask an agent about this"). */
export const NODE_SLICE_BUDGET = 1000;

/**
 * The prompt for an agent asked about ONE board node: what the node is, its
 * slice of the map (the map focused on it, at {@link NODE_SLICE_BUDGET}), then
 * the question.
 */
export function nodeContextPrompt(graph: ArchGraph, nodeId: string, question: string): string {
  const node = mapIndex(graph).byId.get(nodeId);
  if (!node) return question;
  const what = `${node.kind} ${node.label} (${node.id}${node.path ? `, ${node.path}` : ''})`;
  return [
    `You are asked about the ${what} in this repository.`,
    `Its slice of the architecture map (the .sequence/map.md grammar, focused on it):`,
    '',
    renderAgentMap(graph, { budget: NODE_SLICE_BUDGET, focus: nodeId }).trimEnd(),
    '',
    `Question: ${question}`,
  ].join('\n');
}

/** The six lines for a repo's AGENTS.md / CLAUDE.md. */
export function agentsMdBlock(): string {
  return [
    '## Architecture map (Sequence)',
    'Read `.sequence/map.md` first: services, their cross-service edges (file:line), apis and modules, ranked and cut to 4k tokens.',
    'Smaller or larger cuts: `.sequence/map-1k.md`, `.sequence/map-16k.md`; regenerate with `sequence map --budget <n> [--focus <id>]`.',
    'MCP (sequence-mcp): resource `sequence://map?budget=4000`, tool `map(budget, focus?)`.',
    'Ask the graph instead of grepping: `who_calls`, `impact`, `path_between`, `find_negatives`.',
    'Every line in the map is grounded in scan evidence; a missing edge means the scan did not find one.',
  ].join('\n') + '\n';
}

/**
 * Write `.sequence/map.md` (4k) and its 1k / 16k siblings, plus the AGENTS.md
 * block. Best-effort: a read-only repo still gets its graph.
 */
export function writeAgentMaps(repoRoot: string, graph: ArchGraph, focus?: string): string[] {
  const written: string[] = [];
  try {
    const dir = path.join(repoRoot, '.sequence');
    fs.mkdirSync(dir, { recursive: true });
    for (const budget of MAP_BUDGETS) {
      const file = path.join(dir, MAP_FILES[budget]);
      fs.writeFileSync(file, renderAgentMap(graph, { budget, focus }));
      written.push(file);
    }
    const block = path.join(dir, 'agents-block.md');
    fs.writeFileSync(block, agentsMdBlock());
    written.push(block);
  } catch {
    /* read-only / permissions — the map is a convenience, never a dependency */
  }
  return written;
}
