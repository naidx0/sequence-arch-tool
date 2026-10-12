/**
 * THE EVIDENCE A LESSON'S FIRST TURN IS HANDED (Slice 8a, 2026-09-23).
 *
 * The third measurement (`docs/teaching-flow-plan.md`, six runs at
 * `10954118`): with thinking off on lesson turns the 7B model stops digging.
 * `trace_flow` 0/6; `read_topology` with `module` 0/6; at most two files read
 * (`client.ts`, `app/main.py` lines 1-259 of 3,283); r5 answered in 3.2 s
 * with no tool call. No answer reached `app/providers/*` or the gates. A
 * small model without a reasoning pass does not plan a research path, so the
 * harness walks it instead and puts what it found in front of the model.
 *
 * GROUNDED, NOT GUESSED: every line below the header comes from a tool result
 * — the same executors the model would call (`read_topology` with
 * `services`, `trace_flow`, `read_file`), called through `executeAskTool` so
 * the permission rules and the jail apply exactly as they would to the
 * model. Nothing here re-implements a tool.
 */
import type { ArchGraph } from '@sequence/schema';

import {
  executeAskTool,
  type AskToolContext,
  type AskToolResult,
  type TraceFlowHop,
} from './askTools.js';
import { hopSays, hopTheQuestionAsked, partsNamedIn } from './conceptChart.js';
import { isTestFile } from '../testFiles.js';

/** The whole section's size when the caller names none (~1.5k tokens). */
export const TEACH_EVIDENCE_BUDGET_CHARS = 6_000;

/** How deep each harness trace walks: the model's own default is shallower. */
export const TEACH_EVIDENCE_TRACE_DEPTH = 4;

/** Lines of the deepest hop's file, so the model can cite a real line. */
export const TEACH_EVIDENCE_FILE_LINES = 40;

/** The section's title — the test and the pipeline both look for it. */
export const TEACH_EVIDENCE_TITLE = 'EVIDENCE GATHERED FOR YOU';

/** How many parts the question names get a trace of their own. */
const MAX_NAMED_TRACES = 3;

/** Lines of an aimed target file read to find what it says it is. */
export const TEACH_EVIDENCE_OWN_WORDS_READ = 30;

/** Lines quoted when the file opens on no docstring or comment block. */
export const TEACH_EVIDENCE_OWN_WORDS_LINES = 12;

/** The most characters one target's own words take in the section. */
export const TEACH_EVIDENCE_OWN_WORDS_CHARS = 700;

/** The most they take when a line ending in a colon promises a list, run to its end. */
export const TEACH_EVIDENCE_OWN_WORDS_LIST_CHARS = 1_000;

/** Edge kinds that leave a service: what makes a file its entry. */
const ENTRY_KINDS: ReadonlySet<string> = new Set(['http', 'grpc', 'queue_publish', 'queue_consume']);

/** A node read as the part it sits in: its module, else its service, datastore or topic. */
const PART_KINDS: ReadonlySet<string> = new Set(['module', 'service', 'datastore', 'topic']);

/** One tool the harness ran, for the pipeline to mark as already run this turn. */
export interface TeachEvidenceCall {
  name: string;
  args: Record<string, unknown>;
  result: AskToolResult;
}

export interface TeachEvidence {
  /** The prompt section, or '' when there is no scan to gather from. */
  text: string;
  /** Every file the kept section cites (repo-relative, forward slashes). */
  sources: string[];
  /** Every scanned edge id the kept traces ride. */
  edges: string[];
  /** The tool calls behind the kept blocks. */
  calls: TeachEvidenceCall[];
}

interface Block {
  kind: 'aimed' | 'own' | 'trace' | 'brief' | 'file';
  name: string;
  text: string;
  files: string[];
  edges: string[];
  /** The tool call behind the block; a one-line note names what a call found and has none. */
  call?: TeachEvidenceCall;
}

const EMPTY: TeachEvidence = { text: '', sources: [], edges: [], calls: [] };

/**
 * A service's ENTRY file: the one with the most outgoing http/grpc/queue edges
 * (where it hands off to another part), else the one with the most imports.
 * Ties go to the earlier path, so the pick is stable across scans.
 *
 * Tests are not entries (`isTestFile`, and edges read from a test): on the ML
 * Harness copy 1,774 of 3,486 edges are `instrument: 'test'`, and counting
 * them made `tests/test_a_thread_can_be_deleted.py` the entry of the engine
 * and `memory-pane.test.tsx` the entry of the web app.
 */
export function serviceEntryFile(graph: ArchGraph, serviceId: string): string | undefined {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const inService = (id: string): boolean => {
    const seen = new Set<string>();
    for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (cur.id === serviceId) return true;
      seen.add(cur.id);
    }
    return false;
  };
  const files = graph.nodes.filter(
    (n) => n.kind === 'file' && inService(n.id) && !isTestFile(n.path ?? n.label),
  );
  const pick = (counts: (id: string) => number): string | undefined => {
    let best: { path: string; n: number } | undefined;
    for (const f of files) {
      const n = counts(f.id);
      const p = (f.path ?? f.label).replace(/\\/g, '/');
      if (n > 0 && (!best || n > best.n || (n === best.n && p < best.path))) best = { path: p, n };
    }
    return best?.path;
  };
  const out = (id: string, kinds: (k: string) => boolean): number =>
    graph.edges.filter((e) => e.srcId === id && e.dstId !== id && e.instrument !== 'test' && kinds(e.kind))
      .length;
  return (
    pick((id) => out(id, (k) => ENTRY_KINDS.has(k))) ?? pick((id) => out(id, (k) => k === 'import'))
  );
}

/** How many landing files one module-level row names before it counts the rest. */
const PROOFS_PER_ROW = 4;

/**
 * A `trace_flow` result, read at the level of modules: each end becomes the
 * part it sits in, a move inside one part is dropped, and a pair of parts is
 * one row, in the order the trace reached it.
 *
 * THE ROW KEEPS EVERY FILE IT LANDS IN, not only the first. Measured on the
 * ML Harness copy (2026-09-23): the trace from `client.ts` does reach
 * `app/providers/__init__.py` (`app/main.py:35`) and `app/diagnosis.py`
 * (`app/main.py:27`), but the clustered module "facade" also holds
 * `app/facade/__init__.py` and "tools" holds `app/tools/__init__.py`, so a
 * row per pair that kept its first proof showed the facade and hid the model
 * hop. Each proof is the scanned edge's own file:line from the tool result.
 *
 * FILES FIRST, MODULES AS A SUFFIX (2026-09-23). The fourth measurement's row
 * `7. Db --import--> facade: app/main.py:182 → app/facade/__init__.py;
 * app/main.py:35 → app/providers/__init__.py` opened on two module labels and
 * put the model hop second, and no answer reached `app/providers`. A row now
 * leads with the file hop the trace goes furthest on from (`all`, the whole
 * trace, measures that), and names the parts after it:
 * `app/main.py:35 → app/providers/__init__.py; … (module Db → facade, import)`.
 */
function collapseTrace(
  graph: ArchGraph,
  hops: readonly TraceFlowHop[],
  all: readonly TraceFlowHop[] = hops,
  question = '',
): { rows: string[]; files: string[]; edges: string[]; kept: TraceFlowHop[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const partOf = (id: string): string => {
    const seen = new Set<string>();
    for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      if (PART_KINDS.has(cur.kind)) return cur.id;
      seen.add(cur.id);
    }
    return id;
  };
  const nameOf = (id: string): string => byId.get(id)?.label ?? id;
  const kindOf = (id: string): string => byId.get(id)?.kind ?? 'part';
  const fileOf = (id: string): string | undefined => {
    const n = byId.get(id);
    return n?.kind === 'file' && n.path ? n.path.replace(/\\/g, '/') : undefined;
  };
  /* How far the trace goes on from a node: the longest run of hops out of it. */
  const outOf = new Map<string, TraceFlowHop[]>();
  for (const h of all) outOf.set(h.from, [...(outOf.get(h.from) ?? []), h]);
  const onward = new Map<string, number>();
  const goesOn = (id: string, walking: Set<string> = new Set()): number => {
    const known = onward.get(id);
    if (known !== undefined) return known;
    if (walking.has(id)) return 0;
    walking.add(id);
    let n = 0;
    for (const h of outOf.get(id) ?? []) n = Math.max(n, 1 + goesOn(h.to, walking));
    walking.delete(id);
    onward.set(id, n);
    return n;
  };
  const groups = new Map<string, { head: string; hops: TraceFlowHop[] }>();
  for (const h of hops) {
    const a = partOf(h.from);
    const b = partOf(h.to);
    if (a === b) continue;
    const key = `${a}>${b}>${h.kind}`;
    const g = groups.get(key);
    if (g) g.hops.push(h);
    else {
      const to = kindOf(b) === kindOf(a) ? nameOf(b) : `${kindOf(b)} ${nameOf(b)}`;
      groups.set(key, { head: `${kindOf(a)} ${nameOf(a)} → ${to}, ${h.kind}`, hops: [h] });
    }
  }
  const rows: string[] = [];
  const kept: TraceFlowHop[] = [];
  const files = new Set<string>();
  const edges: string[] = [];
  for (const g of groups.values()) {
    /* Stable: hops that go equally far keep the order the trace found them. */
    const named = [...g.hops].sort((x, y) => goesOn(y.to) - goesOn(x.to)).slice(0, PROOFS_PER_ROW);
    /* The chart's labeller (`hopTheQuestionAsked`): the prose names the hop the chart draws. */
    const asked = named.map((h) => hopTheQuestionAsked(graph, h, question));
    const proofs = named.map((h, i) => {
      const to = fileOf(h.to);
      const a = asked[i]!;
      const at = `${a.evidence.file}:${a.evidence.line}`;
      if (!to) return `${at} ${a.label}`;
      return h.kind === 'import' ? `${at} → ${to}` : `${at} → ${to} (${a.label})`;
    });
    const more = g.hops.length - named.length;
    rows.push(`${rows.length + 1}. ${proofs.join('; ')}${more > 0 ? `; +${more} more` : ''} (${g.head})`);
    for (const [i, h] of named.entries()) {
      files.add(h.evidence.file);
      files.add(asked[i]!.evidence.file);
      for (const f of [fileOf(h.from), fileOf(h.to)]) if (f) files.add(f);
      edges.push(h.edge);
      kept.push(h);
    }
  }
  return { rows, files: [...files], edges, kept };
}

/**
 * THE QUESTION'S OWN WORDS AIM THE TRACE (Slice 9, 2026-09-23).
 *
 * Fourth measurement, six live runs on ML Harness: the hop to the model was in
 * the evidence — `7. Db --import--> facade: app/main.py:182 →
 * app/facade/__init__.py; app/main.py:35 → app/providers/__init__.py` — and no
 * answer or chart reached `app/providers` or `app/diagnosis.py`; all six floor
 * charts opened on the side hop `client.ts → hwdetect.py (GET /local_specs)`.
 * The question said engine, model, provider, gates and UI, and none of those
 * words aimed anything.
 *
 * So a few plain words map to PATH HINTS, never to parts: a hint finds the
 * scanned files with a directory or file stem that is the hint (or its
 * plural), and `trace_flow` with `to` proves the shortest path from the UI's
 * entry file to one of them. Of every candidate, the fewest hops wins, then the
 * earlier hint, then a package's own entry (`__init__`, `index`), then the
 * shorter path. A target with no proven path says so in one line.
 */
interface AimWords {
  words: RegExp;
  /** The block's title, in plain words. */
  title: string;
  /** What one of its files is called in a "no path" line. */
  noun: string;
  /** Path hints, the most telling first. */
  hints: readonly string[];
  /** `datastore`: the scanned datastores are its candidates. `ui`: it names where the paths start. */
  special?: 'datastore' | 'ui';
}

const UI_HINTS: readonly string[] = ['ui', 'frontend', 'web', 'pages', 'components'];

const AIM_WORDS: readonly AimWords[] = [
  {
    words: /\b(models?|providers?|tokens?|llms?)\b/i,
    title: 'The hop to the model provider',
    noun: 'model provider file',
    hints: ['provider', 'llm', 'model', 'ollama', 'openai'],
  },
  {
    words: /\b(gates?|checks?|tests?)\b/i,
    title: 'The path to the gates',
    noun: 'gate file',
    hints: ['gate', 'diagnosis', 'check', 'assert', 'ledger'],
  },
  {
    words: /\bengines?\b/i,
    title: 'The path into the engine',
    noun: 'engine file',
    hints: ['engine', 'harness', 'conductor', 'main'],
  },
  { words: /\b(ui|frontend|screens?)\b/i, title: 'The UI', noun: 'UI file', hints: UI_HINTS, special: 'ui' },
  {
    words: /\b(databases?|datastores?|db)\b/i,
    title: 'The path to the database',
    noun: 'datastore',
    hints: [],
    special: 'datastore',
  },
];

/** How many targets one question aims at, words and named parts together. */
const MAX_AIMED = 5;

/** How many files each hint tries, best-ranked first. */
const AIM_CANDIDATES_PER_HINT = 6;

const PACKAGE_ENTRY_STEMS: ReadonlySet<string> = new Set(['__init__', 'index', 'mod', 'main']);

/** A directory, or the file's name without its extension, is the hint or its plural. */
function namesHint(path: string, hint: string): boolean {
  const segs = path.toLowerCase().replace(/\\/g, '/').split('/');
  segs[segs.length - 1] = segs[segs.length - 1]!.replace(/\.[^.]+$/, '');
  return segs.some((s) => s === hint || s === `${hint}s` || s === `${hint}es`);
}

/*
 * WHAT THE TARGET FILE IS, IN ITS OWN WORDS (Slice 10, 2026-09-23).
 *
 * Fifth measurement, six live runs on ML Harness: the answers named
 * `app/diagnosis.py` 4/6 and said what it was 0/6 — "gateway logic" (r3),
 * "error gates" (r6), "run validation" (r4). Its docstring opens "the five-gate
 * honesty test, executed instead of asserted". The section handed the model
 * paths and lines, not what the file says it is. So under each aimed path the
 * file it lands in is quoted: its module docstring or leading comment block,
 * else its first lines — the file's text, verbatim, never a summary.
 */
function ownWords(content: string): { lines: { n: number; text: string }[]; cut: boolean } | undefined {
  const numbered: { n: number; text: string }[] = [];
  for (const l of content.split('\n')) {
    const m = /^\s*(\d+)\|(.*)$/.exec(l);
    if (m) numbered.push({ n: Number(m[1]), text: m[2]!.replace(/\r$/, '') });
  }
  const at = numbered.findIndex((l) => l.text.trim() !== '' && !l.text.startsWith('#!'));
  if (at < 0) return undefined;
  const head = numbered[at]!.text.trim();
  let block: { n: number; text: string }[] | undefined;
  /* The words of a line with its comment marker off, for reading a list in it. */
  let bare = (t: string): string => t;
  const quote = /^[rRuUbB]?("""|''')/.exec(head);
  if (quote) {
    /* A docstring: to its closing quotes, on its first line or a later one. */
    const q = quote[1]!;
    const closes = (s: string, from: number) => s.indexOf(q, from) >= 0;
    let end = at;
    if (!closes(head, quote[0].length)) {
      while (end + 1 < numbered.length && !closes(numbered[end + 1]!.text, 0)) end += 1;
      end = Math.min(end + 1, numbered.length - 1);
    }
    block = numbered.slice(at, end + 1);
  } else if (head.startsWith('/*')) {
    let end = at;
    while (!numbered[end]!.text.includes('*/') && end + 1 < numbered.length) end += 1;
    block = numbered.slice(at, end + 1);
    bare = (t) => t.replace(/^\s*\*(?!\/)\s?/, '');
  } else if (/^(\/\/|#|--)/.test(head)) {
    let end = at;
    while (end + 1 < numbered.length && /^\s*(\/\/|#|--)/.test(numbered[end + 1]!.text)) end += 1;
    block = numbered.slice(at, end + 1);
    bare = (t) => t.replace(/^\s*(?:\/\/|#|--)\s?/, '');
  }
  /* Code is not prose: `class Caps:` promises no list. */
  const prose = block !== undefined;
  if (block === undefined) {
    block = numbered.slice(at).filter((l) => l.text.trim() !== '').slice(0, TEACH_EVIDENCE_OWN_WORDS_LINES);
  }
  /* Whole lines up to the cap; a first line longer than the cap is cut in it. */
  const kept: { n: number; text: string }[] = [];
  let chars = 0;
  for (const l of block) {
    const size = `${l.n}| ${l.text}\n`.length;
    if (chars + size > TEACH_EVIDENCE_OWN_WORDS_CHARS) break;
    kept.push(l);
    chars += size;
  }
  if (kept.length === 0) {
    const first = block[0]!;
    return { lines: [{ n: first.n, text: `${first.text.slice(0, TEACH_EVIDENCE_OWN_WORDS_CHARS - 12)}…` }], cut: true };
  }
  let cut = kept.length < block.length;
  /* Cut at a paragraph's end when there is one, not mid-sentence. */
  if (cut) {
    const para = kept.map((l) => l.text.trim()).lastIndexOf('');
    if (para > 0) kept.length = para;
  }
  /* A blank line the cut left at the end says nothing. */
  while (kept.length > 1 && kept.at(-1)!.text.trim() === '') kept.pop();
  /*
   * A LINE THAT ENDS IN A COLON PROMISES WHAT FOLLOWS (Slice 11, 2026-09-23).
   * Sixth measurement: the providers docstring was cut at "Two adapters, and
   * this is decided (`ARCHITECTURE.md` §4.3):" before the adapters were named
   * (`ev-r1.txt`). The quote now runs to the end of the first list or paragraph
   * after a quoted line that ends in a colon, up to
   * {@link TEACH_EVIDENCE_OWN_WORDS_LIST_CHARS}; past that it is cut as before.
   */
  if (cut && prose) {
    const size = (ls: readonly { n: number; text: string }[]) => ls.reduce((s, l) => s + `${l.n}| ${l.text}\n`.length, 0);
    for (let c = 0; c < kept.length; c += 1) {
      if (!bare(kept[c]!.text).trimEnd().endsWith(':')) continue;
      const end = throughFirstList(block.map((l) => bare(l.text)), c);
      if (end === undefined || end < kept.length) continue;
      const longer = block.slice(0, end + 1);
      if (size(longer) <= TEACH_EVIDENCE_OWN_WORDS_LIST_CHARS) {
        kept.splice(0, kept.length, ...longer);
        cut = kept.length < block.length;
      }
      break;
    }
  }
  return { lines: kept, cut };
}

const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+\S/;

/**
 * The index of the last line of the list or paragraph that follows line
 * `colon`: blank lines after the colon are skipped, a paragraph ends at a blank
 * line, and a list goes on past a blank line while another item follows it.
 */
function throughFirstList(texts: readonly string[], colon: number): number | undefined {
  let i = colon + 1;
  while (i < texts.length && texts[i]!.trim() === '') i += 1;
  if (i >= texts.length) return undefined;
  const list = LIST_ITEM.test(texts[i]!);
  let end = i;
  for (let j = i + 1; j < texts.length; j += 1) {
    if (texts[j]!.trim() !== '') {
      end = j;
      continue;
    }
    let k = j + 1;
    while (k < texts.length && texts[k]!.trim() === '') k += 1;
    if (!list || k >= texts.length || !LIST_ITEM.test(texts[k]!)) break;
    j = k - 1;
  }
  return end;
}

async function ownWordsBlock(ctx: AskToolContext, rel: string): Promise<Block | undefined> {
  const args = { path: rel, limit: TEACH_EVIDENCE_OWN_WORDS_READ };
  const result = await executeAskTool('read_file', args, ctx);
  if (!result.ok || !result.content) return undefined;
  const words = ownWords(result.content);
  if (words === undefined) return undefined;
  const quoted = words.lines.map((l) => `${l.n}| ${l.text}`).join('\n');
  return {
    kind: 'own',
    name: `what ${rel} is`,
    text:
      `What \x60${rel}\x60 is, in its own words:\n${quoted}` +
      (words.cut ? `\n(it goes on; read_file ${rel} for the rest)` : ''),
    files: [rel],
    edges: [],
    call: { name: 'read_file', args, result },
  };
}

async function aimAtTargets(
  ctx: AskToolContext,
  graph: ArchGraph,
  question: string,
  from: string,
  fromSvc: string | undefined,
): Promise<Block[]> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const pathOf = (id: string): string => (byId.get(id)?.path ?? byId.get(id)?.label ?? id).replace(/\\/g, '/');
  const chainOf = (id: string): string[] => {
    const out: string[] = [];
    for (let cur = byId.get(id); cur && !out.includes(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      out.push(cur.id);
    }
    return out;
  };
  const fromId = graph.nodes.find((n) => n.kind === 'file' && pathOf(n.id) === from)?.id;
  const fromChain = fromId ? chainOf(fromId) : [];
  const svcLabel = fromSvc ? (byId.get(fromSvc)?.label ?? fromSvc) : undefined;
  const startsAt = `${from}${svcLabel ? `, the entry file of ${svcLabel}` : ''}`;
  /* Outside the UI's own service: a file inside it is not a hop out of the UI. */
  const outside = (id: string) => fromSvc === undefined || !chainOf(id).includes(fromSvc);

  interface Target {
    at: number;
    title: string;
    what: string;
    /** Candidates in rank order, one list per hint. */
    tiers: string[][];
    named?: boolean;
    ui?: boolean;
  }
  const q = question.toLowerCase();
  const targets: Target[] = [];
  for (const w of AIM_WORDS) {
    const m = w.words.exec(question);
    if (!m) continue;
    let tiers: string[][];
    if (w.special === 'datastore') {
      const dbEdges = (id: string) => graph.edges.filter((e) => e.dstId === id && e.kind.startsWith('db_')).length;
      tiers = [
        graph.nodes
          .filter((n) => n.kind === 'datastore' && outside(n.id))
          .map((n) => n.id)
          .sort((a, b) => dbEdges(b) - dbEdges(a)),
      ];
    } else {
      tiers = w.hints.map((hint) => {
        const files = graph.nodes
          .filter((n) => n.kind === 'file' && n.path && !isTestFile(n.path) && namesHint(n.path, hint) && outside(n.id))
          .map((n) => ({ id: n.id, p: pathOf(n.id) }))
          .sort((a, b) => {
            const stem = (p: string) => (PACKAGE_ENTRY_STEMS.has(p.split('/').pop()!.replace(/\.[^.]+$/, '')) ? 0 : 1);
            return stem(a.p) - stem(b.p) || a.p.length - b.p.length || a.p.localeCompare(b.p);
          })
          .map((f) => f.id);
        const modules = graph.nodes
          .filter((n) => n.kind === 'module' && namesHint(n.label, hint) && outside(n.id))
          .map((n) => n.id);
        return [...files, ...modules].slice(0, AIM_CANDIDATES_PER_HINT);
      });
    }
    targets.push({ at: m.index, title: w.title, what: `a ${w.noun}`, tiers, ...(w.special === 'ui' ? { ui: true } : {}) });
  }
  for (const part of partsNamedIn(graph, question)) {
    /* A part the entry file sits in is where the flow starts, not where it goes. */
    if (fromChain.includes(part.id)) continue;
    const at = q.indexOf(part.label.toLowerCase());
    targets.push({ at: at < 0 ? q.length : at, title: `The path to ${part.label}`, what: part.label, tiers: [[part.id]], named: true });
  }
  targets.sort((a, b) => a.at - b.at);

  const blocks: Block[] = [];
  const ends = new Set<string>();
  for (const t of targets.slice(0, MAX_AIMED)) {
    if (t.ui) {
      blocks.push({ kind: 'aimed', name: 'the UI', text: `The UI: the aimed paths in this section start at ${startsAt}.`, files: [from], edges: [] });
      continue;
    }
    let best: { args: Record<string, unknown>; result: AskToolResult; hops: readonly TraceFlowHop[] } | undefined;
    for (const tier of t.tiers) {
      for (const to of tier) {
        const args = { from, to };
        const result = await executeAskTool('trace_flow', args, ctx);
        const hops = result.ok ? result.flow?.hops : undefined;
        if (hops && hops.length > 0 && (!best || hops.length < best.hops.length)) best = { args, result, hops };
      }
    }
    if (best) {
      const end = best.hops.at(-1)!;
      if (ends.has(end.to)) continue;
      ends.add(end.to);
      const chain = [best.hops[0]!.from, ...best.hops.map((h) => h.to)].map(pathOf).join(' → ');
      /* The chart's labeller: of the scanned edges between the same two files,
         the one the question asked about (2026-09-23, `ev-r1.txt:7/24/38`). */
      const asked = best.hops.map((h) => hopTheQuestionAsked(graph, h, question));
      /* An import hop says it is one, a request hop what it calls (Slice 11,
         2026-09-23): three answers put the gates "on the token path" when the
         edge to them is `app/main.py:27`, an import. `hopSays` is the chart's. */
      const lines = best.hops.map((h, i) => {
        const a = asked[i]!;
        return `${i + 1}. ${a.evidence.file}:${a.evidence.line} → ${pathOf(h.to)} (${hopSays(graph, h, question)})`;
      });
      const endAt = `${asked.at(-1)!.evidence.file}:${asked.at(-1)!.evidence.line}`;
      const reached =
        end.kind === 'import' ? `reached by an import from ${endAt}, not by a request` : endAt;
      const files = new Set<string>();
      for (const a of asked) files.add(a.evidence.file);
      for (const h of best.hops) {
        files.add(h.evidence.file);
        for (const id of [h.from, h.to]) if (byId.get(id)?.kind === 'file') files.add(pathOf(id));
      }
      blocks.push({
        kind: 'aimed',
        name: t.title.toLowerCase(),
        text:
          `${t.title}: ${chain} (${reached}) — the shortest path the scan ` +
          `proves from ${startsAt}, one hop per line:\n${lines.join('\n')}`,
        files: [...files],
        edges: best.hops.map((h) => h.edge),
        call: { name: 'trace_flow', args: best.args, result: best.result },
      });
      /* What the file the path lands in says it is, right under the path. */
      if (byId.get(end.to)?.kind === 'file') {
        const own = await ownWordsBlock(ctx, pathOf(end.to));
        if (own) blocks.push(own);
      }
      continue;
    }
    /* No proven path: one line, and where the nearest candidate is reached from. */
    const nearest = t.tiers.find((tier) => tier.length > 0)?.[0];
    let text = `${t.title}: the scan has no ${t.what.replace(/^an? /, '')} outside ${svcLabel ?? from}.`;
    if (nearest !== undefined) {
      const inside = (id: string) => chainOf(id).includes(nearest);
      const into = graph.edges.find(
        (e) => e.instrument !== 'test' && e.evidence?.[0] && inside(e.dstId) && !inside(e.srcId),
      )?.evidence?.[0];
      const reached = into
        ? `reached from ${into.file.replace(/\\/g, '/')}:${into.line}`
        : 'reached by no scanned edge';
      text =
        `${t.title}: no scanned path from ${from} to ${t.what}; ` +
        (t.named ? `${t.what} is ${reached}.` : `the nearest is ${pathOf(nearest)}, ${reached}.`);
    }
    blocks.push({ kind: 'aimed', name: t.title.toLowerCase(), text, files: [], edges: [] });
  }
  return blocks;
}

/**
 * Of the hops the section shows, the one the trace reached furthest from
 * where it started — a move between parts, so the file it lands in is one a
 * row above names.
 */
function deepestHop(
  flow: NonNullable<AskToolResult['flow']>,
  shown: readonly TraceFlowHop[],
): { hop: TraceFlowHop; depth: number } | undefined {
  const depth = new Map<string, number>([[flow.from, 0]]);
  let best: { hop: TraceFlowHop; depth: number } | undefined;
  for (const h of flow.hops) {
    const d = (depth.get(h.from) ?? 0) + 1;
    if (!depth.has(h.to)) depth.set(h.to, d);
    if (shown.includes(h) && (!best || d > best.depth)) best = { hop: h, depth: d };
  }
  return best;
}

/**
 * Gather the evidence for a lesson's root overview, before the first call.
 *
 * Kept in this order when the budget binds — traces first (they are the
 * hops the overview is made of), the services brief second, the file lines
 * last — and the section says what it cut. With no graph it returns ''.
 */
export async function gatherTeachEvidence(
  ctx: AskToolContext,
  question: string,
  budgetChars: number = TEACH_EVIDENCE_BUDGET_CHARS,
): Promise<TeachEvidence> {
  const graph = ctx.graph;
  if (!graph) return EMPTY;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const pathOf = (id: string): string => (byId.get(id)?.path ?? byId.get(id)?.label ?? id).replace(/\\/g, '/');
  const services = graph.nodes.filter((n) => n.kind === 'service');

  interface Traced {
    from: string;
    why: string;
    named: boolean;
    /** The service whose entry file this is (entry traces only). */
    svc?: string;
    args: Record<string, unknown>;
    result: AskToolResult;
    flow: NonNullable<AskToolResult['flow']>;
  }
  const ran: Traced[] = [];
  const trace = async (from: string, why: string, named: boolean, svc?: string): Promise<void> => {
    if (ran.some((t) => t.from === from)) return;
    const args = { from, depth: TEACH_EVIDENCE_TRACE_DEPTH };
    const result = await executeAskTool('trace_flow', args, ctx);
    if (result.ok && result.flow && result.flow.hops.length > 0) {
      ran.push({ from, why, named, ...(svc !== undefined ? { svc } : {}), args, result, flow: result.flow });
    }
  };
  /* (c) the parts the question names: what the learner asked about. */
  for (const part of partsNamedIn(graph, question).slice(0, MAX_NAMED_TRACES)) {
    await trace(pathOf(part.id), `${part.label}, named in the question`, true);
  }
  /* (b) each service from the file where it hands off to the next part. */
  for (const svc of services) {
    const entry = serviceEntryFile(graph, svc.id);
    if (entry) await trace(entry, `the entry file of ${svc.label}`, false, svc.id);
  }
  /* Upstream first: an entry another trace walks into reads after the trace
     that reaches it, so the section runs in the direction the data moves
     (ML Harness: the UI's `client.ts` before the engine's `app/main.py`). */
  const reached = (t: Traced): boolean =>
    ran.some((o) => o !== t && o.flow.hops.some((h) => pathOf(h.to) === t.from));
  const inOrder = [
    ...ran.filter((t) => t.named),
    ...ran.filter((t) => !t.named && !reached(t)),
    ...ran.filter((t) => !t.named && reached(t)),
  ];

  /* (e) the paths the question's own words aim at, from the UI's entry file:
     written first, and their hops are not repeated in the traces below. */
  const edgesShown = new Set<string>();
  const upstream = ran.filter((t) => !t.named && !reached(t));
  const entries = upstream.length > 0 ? upstream : ran.filter((t) => !t.named);
  const ui =
    entries.find((t) => {
      const s = t.svc !== undefined ? byId.get(t.svc) : undefined;
      return s !== undefined && UI_HINTS.some((h) => namesHint(`${s.path ?? ''}/${s.label}`, h));
    }) ?? entries[0];
  const aimed = ui ? await aimAtTargets(ctx, graph, question, ui.from, ui.svc) : [];
  for (const b of aimed) for (const e of b.edges) edgesShown.add(e);

  /* A hop an earlier trace already shows is not repeated; a trace with
     nothing new left is not shown at all. */
  const traces: Block[] = [];
  const flows: { flow: NonNullable<AskToolResult['flow']>; shown: TraceFlowHop[] }[] = [];
  for (const t of inOrder) {
    const fresh = t.flow.hops.filter((h) => !edgesShown.has(h.edge));
    const { rows, files, edges, kept } = collapseTrace(graph, fresh, t.flow.hops, question);
    if (rows.length === 0) continue;
    for (const e of edges) edgesShown.add(e);
    flows.push({ flow: t.flow, shown: kept });
    const repeats = fresh.length < t.flow.hops.length ? ' (hops shown above are not repeated)' : '';
    traces.push({
      kind: 'trace',
      name: `trace from ${t.from}`,
      text:
        `Trace from ${t.from} — ${t.why}; ${rows.length} hop${rows.length === 1 ? '' : 's'} between ` +
        `parts, in the order the scan reaches them${repeats}:\n${rows.join('\n')}`,
      files,
      edges,
      call: { name: 'trace_flow', args: t.args, result: t.result },
    });
  }

  /* (a) the services brief, one call for all of them. */
  let brief: Block | undefined;
  const ids = ctx.digest?.services.map((s) => s.id) ?? [];
  if (ids.length > 0) {
    const args = { services: ids };
    const result = await executeAskTool('read_topology', args, ctx);
    if (result.ok && result.content) {
      brief = { kind: 'brief', name: 'the services brief', text: result.content, files: [], edges: [], call: { name: 'read_topology', args, result } };
    }
  }

  /* (d) the file the deepest hop lands in — its source line when it lands on a
     datastore or topic — so there is a real line to cite. */
  let fileBlock: Block | undefined;
  let deepest: { hop: TraceFlowHop; depth: number } | undefined;
  for (const f of flows) {
    const d = deepestHop(f.flow, f.shown);
    if (d && (!deepest || d.depth > deepest.depth)) deepest = d;
  }
  if (deepest) {
    const to = byId.get(deepest.hop.to);
    const rel = to?.kind === 'file' && to.path ? to.path.replace(/\\/g, '/') : deepest.hop.evidence.file;
    const args = { path: rel, limit: TEACH_EVIDENCE_FILE_LINES };
    const result = await executeAskTool('read_file', args, ctx);
    if (result.ok && result.content) {
      fileBlock = {
        kind: 'file',
        name: `the first ${TEACH_EVIDENCE_FILE_LINES} lines of ${rel}`,
        text:
          `The file the deepest hop lands in (${deepest.hop.evidence.file}:${deepest.hop.evidence.line} ` +
          `${deepest.hop.label}), its first ${TEACH_EVIDENCE_FILE_LINES} lines:\n${result.content}`,
        files: [rel],
        edges: [],
        call: { name: 'read_file', args, result },
      };
    }
  }

  const ordered = [...aimed, ...traces, ...(brief ? [brief] : []), ...(fileBlock ? [fileBlock] : [])];
  if (ordered.length === 0) return EMPTY;

  const header =
    `--- ${TEACH_EVIDENCE_TITLE} (the harness ran these tools on the scan before this turn; ` +
    'every line below is their result, and each file:line is a scanned edge you can cite) ---';
  const cutNote = (cut: readonly Block[]): string =>
    cut.length === 0 ? '' : `Cut to stay within ${budgetChars} characters: ${cut.map((b) => b.name).join('; ')}.`;
  const assemble = (kept: readonly Block[], cut: readonly Block[]): string =>
    [header, ...kept.map((b) => b.text), cutNote(cut)].filter((s) => s !== '').join('\n\n');

  /* Greedy in priority order: a block that does not fit is named as cut, and a
     smaller later block may still fit. The cut note is reserved for as we go. */
  const kept: Block[] = [];
  const cut: Block[] = [];
  for (const b of ordered) {
    if (assemble([...kept, b], [...cut, ...ordered.slice(ordered.indexOf(b) + 1)]).length <= budgetChars) {
      kept.push(b);
    } else {
      cut.push(b);
    }
  }
  if (kept.length === 0) return EMPTY;
  const text = assemble(kept, cut);
  return {
    text,
    sources: [...new Set(kept.flatMap((b) => b.files))],
    edges: [...new Set(kept.flatMap((b) => b.edges))],
    calls: kept.flatMap((b) => (b.call ? [b.call] : [])),
  };
}
