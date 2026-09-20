/**
 * SEQ-CHART — the one visual contract.
 *
 * THE DECISION (owner question, 2026-09-01): "would it be better to use React
 * to take over all of our graphing … or would that take up too many tokens?"
 *
 * JSON is the source of truth; React owns the pixels; THE MODEL NEVER WRITES
 * RENDER CODE. Three reasons, in the order they bind:
 *
 *   1. GROUNDING. A spec can be validated against the real ArchGraph — every
 *      node id either exists or the chart is refused. Model-authored React is
 *      arbitrary code that can draw a beautiful lie, and "grounded, not
 *      guessed" is the product. A picture that fabricates is worse than prose
 *      that fabricates, because a picture is believed faster.
 *   2. TOKENS. A spec is ~20 lines; the equivalent component is ~150. At one
 *      visual per teach turn that is 5-8x the cost, every turn, forever.
 *   3. DETERMINISM. Same spec renders the same pixels: diffable, cacheable,
 *      replayable inside a lesson, screenshot-testable in the legibility gate.
 *
 * THE COMPRESSION THAT MAKES IT PRACTICAL. The public list of chart types an
 * agent is asked for runs to 45 names (before/after, cause-effect, ecosystem
 * map, sankey, quadrant, maturity model, …). They are not 45 renderers: they
 * are ~8 FAMILIES with presets. A "dependency map", a "concept map" and a
 * "stakeholder map" are one node-link renderer with different labels and
 * accents. So the model chooses a NAME it already knows, and the harness maps
 * that name to the family that draws it.
 */

/** The 45 names an agent may ask for. One vocabulary, model-facing. */
export const CHART_KINDS = [
  // node-link family
  'system-architecture', 'network-map', 'ecosystem-map', 'concept-map', 'mind-map',
  'relationship-map', 'dependency-map', 'stakeholder-map', 'cause-and-effect',
  // flow family
  'data-flow', 'information-flow', 'user-flow', 'code-to-outcome', 'how-it-works',
  'incident-reconstruction', 'swimlane', 'sankey',
  // hierarchy family
  'hierarchy', 'organization', 'pyramid', 'layer', 'maturity-model', 'progression',
  // timeline family
  'roadmap', 'milestone', 'gantt', 'journey-map',
  // quantitative family
  'bar', 'line', 'donut', 'scatter', 'heat-map',
  // comparison family
  'comparison-table', 'comparison-matrix', 'quadrant', 'venn', 'pros-and-cons',
  'spectrum', 'before-and-after',
  // cards family
  'statistic-cards', 'scorecard',
  // loop family
  'flywheel', 'feedback-loop',
  // annotated family
  'annotated-interface', 'exploded-interface',
] as const;

export type ChartKind = (typeof CHART_KINDS)[number];

/** The eight things we actually draw. */
export type ChartFamily =
  | 'node-link'
  | 'flow'
  | 'hierarchy'
  | 'timeline'
  | 'quantitative'
  | 'comparison'
  | 'cards'
  | 'loop'
  | 'annotated';

const FAMILY_OF: Record<ChartKind, ChartFamily> = {
  'system-architecture': 'node-link', 'network-map': 'node-link', 'ecosystem-map': 'node-link',
  'concept-map': 'node-link', 'mind-map': 'node-link', 'relationship-map': 'node-link',
  'dependency-map': 'node-link', 'stakeholder-map': 'node-link', 'cause-and-effect': 'node-link',
  'data-flow': 'flow', 'information-flow': 'flow', 'user-flow': 'flow',
  'code-to-outcome': 'flow', 'how-it-works': 'flow', 'incident-reconstruction': 'flow',
  swimlane: 'flow', sankey: 'flow',
  hierarchy: 'hierarchy', organization: 'hierarchy', pyramid: 'hierarchy',
  layer: 'hierarchy', 'maturity-model': 'hierarchy', progression: 'hierarchy',
  roadmap: 'timeline', milestone: 'timeline', gantt: 'timeline', 'journey-map': 'timeline',
  bar: 'quantitative', line: 'quantitative', donut: 'quantitative',
  scatter: 'quantitative', 'heat-map': 'quantitative',
  'comparison-table': 'comparison', 'comparison-matrix': 'comparison', quadrant: 'comparison',
  venn: 'comparison', 'pros-and-cons': 'comparison', spectrum: 'comparison',
  'before-and-after': 'comparison',
  'statistic-cards': 'cards', scorecard: 'cards',
  flywheel: 'loop', 'feedback-loop': 'loop',
  'annotated-interface': 'annotated', 'exploded-interface': 'annotated',
};

export function chartFamily(kind: ChartKind): ChartFamily {
  return FAMILY_OF[kind];
}

export function isChartKind(value: unknown): value is ChartKind {
  return typeof value === 'string' && (CHART_KINDS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------- the spec -- */

/**
 * One drawable item. `nodeId` is the grounding hook: when present it MUST name
 * a real node in the scanned graph, and the validator refuses the chart when it
 * does not. A chart with no nodeIds is legal (a lesson about softmax has no
 * services) — but a chart that CLAIMS repo structure must be checkable.
 */
export interface ChartItem {
  id: string;
  label: string;
  /** Real ArchGraph node id, when this item stands for part of the system. */
  nodeId?: string;
  /** Secondary line: a count, a file path, a metric. */
  detail?: string;
  /** Numeric payload for quantitative/cards families. */
  value?: number;
  /** Grouping key: lane (swimlane), column (comparison), series (bar/line). */
  group?: string;
  /** Semantic accent — never decoration. */
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}

export interface ChartLink {
  from: string;
  to: string;
  label?: string;
  /** Sankey/flow weight. */
  value?: number;
  tone?: ChartItem['tone'];
}

export interface SeqChart {
  version: 1;
  kind: ChartKind;
  title: string;
  /** One sentence: what this picture is claiming. */
  caption?: string;
  items: ChartItem[];
  links?: ChartLink[];
  /** Axis/lane/column labels, family-dependent. */
  axes?: { x?: string; y?: string; columns?: string[]; lanes?: string[] };
  /** The step to highlight — teach mode advances this one concept at a time. */
  focusItemId?: string;
}

/* ---------------------------------------------------------- the validator -- */

export interface ChartProblem {
  path: string;
  message: string;
}

/**
 * Validate a chart spec, and — when a node-id set is supplied — REFUSE any
 * `nodeId` that is not in the scanned graph. This is the whole reason the
 * model emits data instead of code: a picture can be checked against reality
 * before anyone believes it.
 */
/**
 * A REFUSAL THAT NAMES THE OFFENDING VALUE AND NOT THE ADMISSIBLE SET MAKES THE
 * MODEL GUESS, AND IT GUESSES THE SAME WAY TWICE.
 *
 * Measured across two 20-conversation teach runs: every propose_chart call that
 * was made -- all four, both runs -- was refused here, and reading each pair in
 * order shows the model correcting exactly what it was told about and
 * re-offending on what it was not. Told its `nodeId`s were invented, it dropped
 * them on the retry; never told which item ids existed, it kept writing link
 * endpoints that did not exist and gave up after two tries. It did everything
 * the contract asks and drew nothing.
 *
 * Every invented endpoint in that run was a FILE NAME -- `bigram_counts.py`,
 * `nn_bigram.py`, `sampling.py` -- which is what an item's LABEL looks like in
 * a chart about code. So the commonest miss is not invention at all: it is
 * joining items by the name a human reads instead of the id, and that case is
 * named explicitly below rather than left to a generic distance match.
 *
 * This is the same shape as the propose_topology refusal before it was fixed by
 * naming propose_chart as the alternative -- which worked on the real screen.
 */

/** Lowercase, no directory, no extension, no separators: `src/A_b.py` -> `ab`. */
function normaliseRef(value: string): string {
  return value
    .toLowerCase()
    .replace(/^.*[\/]/, '')
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Levenshtein, abandoned as soon as every path exceeds `max`.
 *
 * Bounded on purpose: this runs against `knownNodeIds`, which on a real
 * repository is thousands of entries, and a validator is not a place to spend
 * unbounded time on a message nobody may read.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    let best = cur[0]!;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (cur[j]! < best) best = cur[j]!;
    }
    if (best > max) return max + 1;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[b.length]!;
}

/**
 * The nearest real id, or nothing.
 *
 * NOTHING is a real answer here and the caller must handle it: a wrong
 * suggestion is worse than none, because the model will take it. Hence a
 * threshold that scales with the length of what was written -- one edit on a
 * three-character id is a different thing from one edit on a twenty-character
 * one -- and an exact normalised match short-circuits everything else.
 */
function nearestKnown(
  offending: string,
  candidates: Iterable<string>,
  scanCap = 2_000,
): string | undefined {
  const want = normaliseRef(offending);
  if (want === '') return undefined;
  let best: { id: string; d: number } | undefined;
  const threshold = Math.max(1, Math.floor(want.length / 3));
  let scanned = 0;
  for (const candidate of candidates) {
    if (scanned >= scanCap) break;
    scanned += 1;
    const norm = normaliseRef(candidate);
    if (norm === want) return candidate;
    const d = editDistance(want, norm, threshold);
    if (d <= threshold && (best === undefined || d < best.d)) best = { id: candidate, d };
  }
  return best?.id;
}

/** How many ids a refusal lists before it stops being help and becomes a wall. */
const MAX_LISTED_ITEM_IDS = 20;

/**
 * AN INVENTED EDGE IS AS FALSE AS AN INVENTED NODE, and until this existed only
 * one of them was refused.
 *
 * `knownNodeIds` stops a chart naming a part of the repository that does not
 * exist. Nothing stopped it drawing an arrow between two parts that DO exist
 * and are not connected -- which is a claim about the architecture that the
 * scan does not support, made in a picture, where a reader has no way to check
 * it. The derived chart path (server/conceptChart.ts) only ever draws real
 * edges; the model path could draw anything between real boxes.
 *
 * THE RULE IS NARROW ON PURPOSE. Only a link whose BOTH endpoints carry a
 * `nodeId` is checked, because only then is the link an architectural claim:
 * "these two real parts of this repository are connected". A chart about an
 * IDEA -- items with no nodeId -- is the model's own conceptual picture and is
 * none of the graph's business. That distinction is what keeps a teaching chart
 * legal while keeping a false architecture claim out.
 *
 * Direction is part of the claim, so `a -> b` does not satisfy `b -> a`; the
 * refusal names the direction that does exist, and names the escape hatch,
 * because a real runtime flow the static scan cannot see is a legitimate thing
 * to draw -- just not as a claim about scanned structure.
 *
 * Callers with no graph (the web client renders charts it did not author) pass
 * nothing and get exactly the old behaviour.
 */
export function validateChart(
  value: unknown,
  knownNodeIds?: ReadonlySet<string>,
  knownEdges?: ReadonlySet<string>,
): { ok: true; chart: SeqChart } | { ok: false; problems: ChartProblem[] } {
  const problems: ChartProblem[] = [];
  const o = value as Partial<SeqChart> | null;
  if (!o || typeof o !== 'object') {
    return { ok: false, problems: [{ path: '', message: 'chart must be an object' }] };
  }
  /*
   * AN ABSENT `version` IS STAMPED, NOT REFUSED.
   *
   * `version` is this schema's own stamp, and NOTHING asks the model for it:
   * the `propose_chart` tool schema publishes `{kind, title, items, links?,
   * focusItemId?}` and the teach contract says "EVERY concept ships ONE visual,
   * drawn with propose_chart" without naming it. So a call that matched the
   * published contract exactly was refused with "version: version must be 1",
   * the teach grader then bounced the turn for having NO VISUAL, and after two
   * bounces the lesson landed with no picture — the owner's "we need to SEE the
   * breakdown on our app", failing inside the fix for it. A version the caller
   * never claimed is version 1; a version it DOES claim must still be one this
   * code understands.
   */
  if (o.version !== undefined && o.version !== 1) {
    problems.push({ path: 'version', message: 'version must be 1' });
  }
  if (!isChartKind(o.kind)) {
    problems.push({
      path: 'kind',
      message: `kind must be one of the ${CHART_KINDS.length} known chart kinds`,
    });
  }
  if (typeof o.title !== 'string' || o.title.trim() === '') {
    problems.push({ path: 'title', message: 'title is required' });
  }
  const items = Array.isArray(o.items) ? o.items : [];
  if (items.length === 0) problems.push({ path: 'items', message: 'items must be non-empty' });
  if (items.length > 40) problems.push({ path: 'items', message: 'at most 40 items' });
  const ids = new Set<string>();
  /* Normalised label -> id, so the commonest miss (joining items by the name a
     human reads) can be named as itself rather than as a distance match. */
  const idByLabel = new Map<string, string>();
  /* item id -> the repository node it stands for, for the edge check below. */
  const nodeIdOfItem = new Map<string, string>();
  items.forEach((it, i) => {
    if (!it || typeof it.id !== 'string' || it.id === '') {
      problems.push({ path: `items[${i}].id`, message: 'id is required' });
      return;
    }
    if (ids.has(it.id)) problems.push({ path: `items[${i}].id`, message: `duplicate id ${it.id}` });
    ids.add(it.id);
    if (typeof it.label !== 'string' || it.label === '') {
      problems.push({ path: `items[${i}].label`, message: 'label is required' });
    } else {
      const key = normaliseRef(it.label);
      /* First writer wins: with two items sharing a label the suggestion would
         be a coin flip, and a confident wrong id is worse than no id. */
      if (key !== '' && !idByLabel.has(key)) idByLabel.set(key, it.id);
    }
    if (typeof it.nodeId === 'string' && it.nodeId !== '') nodeIdOfItem.set(it.id, it.nodeId);
    if (it.nodeId !== undefined && knownNodeIds && !knownNodeIds.has(it.nodeId)) {
      const near = nearestKnown(it.nodeId, knownNodeIds);
      problems.push({
        path: `items[${i}].nodeId`,
        /* The node set is the whole repository, so this hints and never lists:
           a refusal carrying four thousand ids is not help. */
        message:
          `"${it.nodeId}" is not a node in this repository — a chart may not invent structure` +
          (near === undefined ? '' : `. Did you mean "${near}"?`),
      });
    }
  });
  /*
   * `links` is model-authored and typed `unknown`, so it must be GUARDED, not
   * coalesced: `?? []` only catches null/undefined, and a shape-slip like
   * `links: {}` / `"none"` / `0` is truthy, so `(o.links ?? []).entries()`
   * threw a TypeError — breaking validateChart's ok/problems contract and, on
   * the server, killing the whole turn (no tool result ever fed back). A
   * non-array links is itself a validation problem, reported, never thrown.
   */
  if (o.links !== undefined && !Array.isArray(o.links)) {
    problems.push({ path: 'links', message: 'links must be an array when present' });
  }
  /*
   * The admissible set, listed. `items` is capped at 40 above, so this is
   * bounded by construction -- which is why item ids can be listed outright
   * while node ids can only be hinted at.
   */
  const knownItemList = (): string => {
    if (ids.size === 0) return '';
    const all = [...ids];
    const shown = all.slice(0, MAX_LISTED_ITEM_IDS).map((id) => `"${id}"`).join(', ');
    const rest = all.length - MAX_LISTED_ITEM_IDS;
    return ` known items: ${shown}${rest > 0 ? `, +${rest} more` : ''}`;
  };
  const unknownItem = (ref: unknown): string => {
    const raw = typeof ref === 'string' ? ref : String(ref);
    const byLabel = idByLabel.get(normaliseRef(raw));
    if (byLabel !== undefined && byLabel !== raw) {
      return (
        `unknown item "${raw}" — did you mean "${byLabel}"? "${raw}" is that item's LABEL, ` +
        `and links join item ids, not labels.${knownItemList()}`
      );
    }
    const near = nearestKnown(raw, ids);
    return near === undefined
      ? `unknown item "${raw}".${knownItemList()}`
      : `unknown item "${raw}" — did you mean "${near}"?${knownItemList()}`;
  };
  const links = Array.isArray(o.links) ? o.links : [];
  for (const [i, l] of links.entries()) {
    if (!l || typeof l !== 'object') {
      problems.push({ path: `links[${i}]`, message: 'link must be an object' });
      continue;
    }
    if (!ids.has(l.from)) problems.push({ path: `links[${i}].from`, message: unknownItem(l.from) });
    if (!ids.has(l.to)) problems.push({ path: `links[${i}].to`, message: unknownItem(l.to) });
    /* Both endpoints stand for real repository parts: the arrow is then a claim
       about this repository's structure and has to be one the scan supports. */
    const fromNode = nodeIdOfItem.get(l.from);
    const toNode = nodeIdOfItem.get(l.to);
    if (
      knownEdges !== undefined &&
      fromNode !== undefined &&
      toNode !== undefined &&
      !knownEdges.has(`${fromNode}>${toNode}`)
    ) {
      const reversed = knownEdges.has(`${toNode}>${fromNode}`);
      problems.push({
        path: `links[${i}]`,
        message:
          `no edge ${fromNode} -> ${toNode} in this repository — a chart may not invent a ` +
          `connection between real parts` +
          (reversed ? `. The scan has ${toNode} -> ${fromNode}` : '') +
          '. If you mean a flow the static scan cannot see, drop the nodeId from these items ' +
          'and draw it as a concept instead',
      });
    }
  }
  if (o.focusItemId !== undefined && !ids.has(o.focusItemId)) {
    problems.push({ path: 'focusItemId', message: unknownItem(o.focusItemId) });
  }
  if (problems.length > 0) return { ok: false, problems };
  /* The stamp is added here, so every accepted chart on the wire carries the
     version its own type declares — the caller may omit it, the payload never
     does. */
  return { ok: true, chart: (o.version === 1 ? o : { ...o, version: 1 }) as SeqChart };
}
