/**
 * FLOW LINES — a chart written the way a model already writes a flow.
 *
 * The owner asked (2026-09-23) whether Sequence should invent a drawing
 * language. The ruling in docs/canvas-language-plan.md is no: the same
 * 6-part/7-hop flow costs ~291 tokens as chart JSON and ~60 as Mermaid/D2 edge
 * lines, DSL syntax errors do not shrink with model size, and a 7B model
 * already writes `a -> b: label` unprompted. So a flow is a few plain lines, a
 * strict subset of D2/Mermaid edge syntax, compiled into the SeqChart we
 * already validate and draw:
 *
 *   ui "Search page" = web/src/pages/search.tsx
 *   ui -> api: the query | The page sends what was typed to the server
 *   api -> engine: a prompt | The server turns it into a prompt for the engine
 *
 * - `id "Label" = path | detail` declares a part. Every piece after the id is
 *   optional. `= path` grounds the part to the scan: it becomes the item's
 *   nodeId, and the caller resolves a path to the node the graph knows.
 * - `a -> b: label | narration` is one hop. Line order IS step order; there is
 *   no second list to keep in sync. Everything after `|` is what a stepper
 *   reads out.
 * - A part named only in a hop is declared by that hop.
 *
 * Tolerated, because models write them without being asked: `-->`, D2's
 * `id: Label` declaration, Mermaid's `id[Label]` / `id("Label")` endpoints and
 * `a -->|label| b`, `%%` / `#` / `//` comments, and a ```mermaid fence or a
 * `flowchart LR` header, which are skipped.
 *
 * Every problem names its line and the shape that would have worked, because a
 * refusal that only names the offending value makes the model guess the same
 * way twice (see validateChart).
 *
 * Pure and browser-safe: the web canvas can print a chart back to lines for a
 * person to edit ({@link chartToFlowLines}), and the round trip is exact.
 */

import type { ChartItem, ChartKind, ChartLink, SeqChart } from './chart.js';

export interface FlowStep {
  from: string;
  to: string;
  /** What the stepper reads out for this hop (text after `|`). */
  say?: string;
}

export interface FlowLineProblem {
  /** 1-based line in the text the author wrote. */
  line: number;
  message: string;
}

export interface CompiledFlow {
  /** Unvalidated: run it through validateChart with the graph before trusting it. */
  chart: Omit<SeqChart, 'version'> & { version: 1 };
  /** One entry per hop, in the order written. */
  steps: FlowStep[];
  /** item id -> the line that declared it (first mention). */
  itemLine: Map<string, number>;
  /** links[i] -> its line. */
  linkLine: number[];
}

export type CompileFlowResult =
  | ({ ok: true } & CompiledFlow)
  | { ok: false; problems: FlowLineProblem[] };

const ID = String.raw`[A-Za-z_][\w.-]*`;
/** An endpoint: `id`, `id[Label]`, `id["Label"]`, `id(Label)`. */
const END = String.raw`(${ID})(?:\s*[\[(]\s*"?([^\])"]*)"?\s*[\])])?`;
const ARROW = String.raw`\s*(?:-->|->)\s*`;
const EDGE = new RegExp(
  String.raw`^${END}` +
    String.raw`(?:${ARROW}|\s*-->\s*\|([^|]*)\|\s*)` +
    String.raw`${END}\s*(?::\s*([^|]*?))?\s*(?:\|\s*(.*))?$`,
);
const CHAIN_ARROWS = /(?:-->|->)/g;
const DECL = new RegExp(
  String.raw`^(${ID})` +
    String.raw`(?:\s+"([^"]*)"|\s*:\s*(?!\s*=)([^=|]*?))?` +
    String.raw`(?:\s*=\s*(?:"([^"]+)"|(\S+)))?` +
    String.raw`\s*(?:\|\s*(.*))?$`,
);
const SKIP = /^(?:```.*|(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)\s*;?|direction\s*:\s*\w+)$/i;
const COMMENT = /^(?:%%|#|\/\/)/;

/** `search_page` -> `search page`: the label a bare id gets. */
export function labelOfId(id: string): string {
  return id.replace(/[_.-]+/g, ' ').trim() || id;
}

const SHAPES =
  '`a -> b: what moves | what happens` for a hop, or `a "Label" = path/to/file | detail` for a part';

/**
 * Compile flow lines into a chart. Structural only: grounding (does the path
 * exist, is the hop a real scanned edge) is validateChart's job, and
 * {@link flowProblemLine} maps its complaints back to these lines.
 */
export function compileFlowLines(
  text: string,
  head: { kind: ChartKind; title: string; caption?: string; focusItemId?: string },
): CompileFlowResult {
  const problems: FlowLineProblem[] = [];
  const items = new Map<string, ChartItem>();
  const itemLine = new Map<string, number>();
  const links: ChartLink[] = [];
  const linkLine: number[] = [];
  const steps: FlowStep[] = [];

  const touch = (id: string, line: number, label?: string): void => {
    const have = items.get(id);
    const clean = label?.trim();
    if (have === undefined) {
      items.set(id, { id, label: clean || labelOfId(id) });
      itemLine.set(id, line);
    } else if (clean && have.label === labelOfId(id)) {
      have.label = clean;
    }
  };

  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    const n = i + 1;
    const line = rawLine.trim().replace(/;\s*$/, '');
    if (line === '' || COMMENT.test(line) || SKIP.test(line)) return;

    const arrows = line.replace(/\|[^|]*\|/, '').split('|')[0]!.match(CHAIN_ARROWS)?.length ?? 0;
    if (arrows > 1) {
      problems.push({
        line: n,
        message:
          `line ${n}: \`${line}\` chains ${arrows} hops on one line. Write one hop per line, ` +
          'because each hop is one step and carries its own label and narration',
      });
      return;
    }
    if (arrows === 1) {
      const m = EDGE.exec(line);
      if (!m) {
        problems.push({ line: n, message: `line ${n}: cannot read \`${line}\`. Write ${SHAPES}` });
        return;
      }
      const [, a, aLabel, pipeLabel, b, bLabel, colonLabel, say] = m;
      touch(a!, n, aLabel);
      touch(b!, n, bLabel);
      const label = (colonLabel ?? pipeLabel)?.trim();
      const link: ChartLink = { from: a!, to: b! };
      if (label) link.label = label;
      links.push(link);
      linkLine.push(n);
      const step: FlowStep = { from: a!, to: b! };
      if (say?.trim()) step.say = say.trim();
      steps.push(step);
      return;
    }
    const d = DECL.exec(line);
    if (!d) {
      problems.push({ line: n, message: `line ${n}: cannot read \`${line}\`. Write ${SHAPES}` });
      return;
    }
    const [, id, quoted, colon, quotedPath, barePath, detail] = d;
    if (items.has(id!) && itemLine.get(id!) !== n) {
      const first = items.get(id!)!;
      if (first.nodeId !== undefined || first.detail !== undefined || first.label !== labelOfId(id!)) {
        problems.push({
          line: n,
          message: `line ${n}: "${id}" is already declared on line ${itemLine.get(id!)}. Declare each part once`,
        });
        return;
      }
    }
    touch(id!, n, quoted ?? colon);
    /* A problem about this part belongs on the line that grounds it. */
    itemLine.set(id!, n);
    const it = items.get(id!)!;
    const path = (quotedPath ?? barePath)?.trim();
    if (path) it.nodeId = path;
    if (detail?.trim()) it.detail = detail.trim();
  });

  if (problems.length === 0 && items.size === 0) {
    problems.push({ line: 1, message: `the flow has no parts. Write ${SHAPES}` });
  }
  if (problems.length > 0) return { ok: false, problems };

  const chart: CompiledFlow['chart'] = {
    version: 1,
    kind: head.kind,
    title: head.title,
    items: [...items.values()],
    links,
  };
  if (head.caption !== undefined) chart.caption = head.caption;
  if (head.focusItemId !== undefined) chart.focusItemId = head.focusItemId;
  return { ok: true, chart, steps, itemLine, linkLine };
}

/**
 * Put a validateChart problem back on the line the author wrote, so the retry
 * edits a line instead of re-deriving JSON paths it never saw.
 */
export function flowProblemLine(
  compiled: Pick<CompiledFlow, 'chart' | 'itemLine' | 'linkLine'>,
  problem: { path: string; message: string },
): string {
  const item = /^items\[(\d+)\]/.exec(problem.path);
  if (item) {
    const it = compiled.chart.items[Number(item[1])];
    const n = it === undefined ? undefined : compiled.itemLine.get(it.id);
    if (n !== undefined) return `line ${n} (${it!.id}): ${problem.message}`;
  }
  const link = /^links\[(\d+)\]/.exec(problem.path);
  if (link) {
    const i = Number(link[1]);
    const l = compiled.chart.links?.[i];
    const n = compiled.linkLine[i];
    if (l !== undefined && n !== undefined) return `line ${n} (${l.from} -> ${l.to}): ${problem.message}`;
  }
  return `${problem.path || '(root)'}: ${problem.message}`;
}

function quote(value: string): string {
  return /[\s"|=]/.test(value) ? `"${value.replace(/"/g, "'")}"` : value;
}

/**
 * Print a chart as flow lines: the text a person reads and edits on the
 * canvas. Parts that carry anything beyond their id are declared first, in
 * item order; then one line per hop, in link order. Compiling the result gives
 * back the same items and links (tested).
 */
export function chartToFlowLines(
  chart: Pick<SeqChart, 'items' | 'links'>,
  steps?: readonly FlowStep[],
): string {
  const out: string[] = [];
  const plain = (it: ChartItem): boolean =>
    it.label === labelOfId(it.id) && it.nodeId === undefined && it.detail === undefined;
  /* Compiling puts declared parts first, then the rest in order of first
     mention. When that would reorder the items, every part is declared. */
  const mentionOrder: string[] = [];
  for (const l of chart.links ?? []) {
    for (const id of [l.from, l.to]) if (!mentionOrder.includes(id)) mentionOrder.push(id);
  }
  const declared = chart.items.filter((it) => !plain(it) || !mentionOrder.includes(it.id));
  const declaredIds = new Set(declared.map((it) => it.id));
  const compiledOrder = [
    ...declared.map((it) => it.id),
    ...mentionOrder.filter((id) => !declaredIds.has(id)),
  ];
  const keepsOrder = compiledOrder.join('\n') === chart.items.map((it) => it.id).join('\n');
  for (const it of keepsOrder ? declared : chart.items) {
    let line = it.id;
    if (it.label !== labelOfId(it.id)) line += ` "${it.label.replace(/"/g, "'")}"`;
    if (it.nodeId !== undefined) line += ` = ${quote(it.nodeId)}`;
    if (it.detail !== undefined) line += ` | ${it.detail}`;
    out.push(line);
  }
  (chart.links ?? []).forEach((l, i) => {
    let line = `${l.from} -> ${l.to}`;
    if (l.label !== undefined) line += `: ${l.label.replace(/\|/g, '/')}`;
    const say = steps?.[i]?.say;
    if (say) line += ` | ${say}`;
    out.push(line);
  });
  return out.join('\n');
}
