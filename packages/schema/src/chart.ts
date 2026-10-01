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

/** The kinds a flow's `steps` can play on — named in the refusal, never guessed. */
export const FLOW_KINDS: readonly ChartKind[] = CHART_KINDS.filter((k) => FAMILY_OF[k] === 'flow');

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

/**
 * One hop of a flow, in the order the data moves.
 *
 * Owner, 2026-09-22: "a detailed maybe even animated diagram on the AI canvas
 * which shows the flows coming from engine sending all of the AI token requests
 * into the harness". The boxes and arrows were already drawable; what was not
 * was the ORDER, so nothing could play the flow hop by hop. A step is a hop
 * along an arrow of this chart, and is checked on exactly an arrow's terms.
 */
export interface ChartStep {
  /** Item id the hop leaves. */
  from: string;
  /** Item id the hop arrives at. */
  to: string;
  /** What travels on this hop, in a few words: "the request", "tokens". */
  says: string;
  /** One or two sentences more, shown under the step list. */
  detail?: string;
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
  /** Flow family only: the hops in order, so the canvas can step and play them. */
  steps?: ChartStep[];
}

/** How many hops one flow may play. Past this it is a second chart. */
export const MAX_CHART_STEPS = 24;
/** A step's `says` is a caption on a hop, not a paragraph. */
export const MAX_STEP_SAYS = 80;
/** A step's `detail` is the sentence or two under the list. */
export const MAX_STEP_DETAIL = 240;

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
 *
 * `knownEdges` holds `src>dst` keys. The analyzer passes the scanned edges AND
 * their roll-up to the modules and services around each end (2026-09-22), so a
 * link between two modules is held to the imports between their files.
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
    /* A NODE ID IS TEXT (2026-09-22). Live, teach battery r3: "tool:start
       propose_chart at 410 s, then nothing". Told to "drop the nodeId", a
       small model wrote `nodeId: null`; the hint below lower-cased it, threw,
       and the throw killed the answer stream. Anything but a non-empty string
       is a problem at its own path, and never reaches the hint. */
    if (it.nodeId !== undefined && (typeof it.nodeId !== 'string' || it.nodeId === '')) {
      problems.push({ path: `items[${i}].nodeId`, message: 'nodeId is text — leave it out for a concept' });
      return;
    }
    if (typeof it.nodeId === 'string') nodeIdOfItem.set(it.id, it.nodeId);
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
  /*
   * STEPS ARE HOPS ALONG ARROWS, SO AN ARROW THEY NEED IS DERIVED, NOT DEMANDED
   * (2026-09-22). A small local model writing "engine -> provider: the request"
   * as a step has said the arrow already; refusing the chart because it did not
   * also write the same pair under `links` would be the "version must be 1"
   * refusal again -- a field the model meant, refused for a form it skipped.
   * So a step with no arrow gets one, and that arrow then goes through the
   * scanned-edge check below like any other: a step between two real nodes
   * still has to be an edge the repository has.
   */
  const derived: ChartLink[] = [];
  const derivedAt: string[] = [];
  if (o.steps !== undefined) {
    if (!Array.isArray(o.steps)) {
      problems.push({ path: 'steps', message: 'steps must be an array when present' });
    } else {
      if (isChartKind(o.kind) && chartFamily(o.kind) !== 'flow') {
        problems.push({
          path: 'steps',
          message: `steps play only on a flow chart (${FLOW_KINDS.join(', ')}); use one of those kinds to step through it`,
        });
      }
      if (o.steps.length > MAX_CHART_STEPS) {
        problems.push({ path: 'steps', message: `at most ${MAX_CHART_STEPS} steps` });
      }
      const arrows = new Set(
        links.filter((l) => l && typeof l === 'object').map((l) => `${l.from}>${l.to}`),
      );
      for (const [i, s] of (o.steps as unknown[]).entries()) {
        const step = s as Partial<ChartStep> | null;
        if (!step || typeof step !== 'object') {
          problems.push({ path: `steps[${i}]`, message: 'step must be an object' });
          continue;
        }
        const fromOk = typeof step.from === 'string' && ids.has(step.from);
        const toOk = typeof step.to === 'string' && ids.has(step.to);
        if (!fromOk) problems.push({ path: `steps[${i}].from`, message: unknownItem(step.from) });
        if (!toOk) problems.push({ path: `steps[${i}].to`, message: unknownItem(step.to) });
        if (typeof step.says !== 'string' || step.says.trim() === '') {
          problems.push({ path: `steps[${i}].says`, message: 'says is required: what travels on this hop' });
        } else if (step.says.length > MAX_STEP_SAYS) {
          problems.push({ path: `steps[${i}].says`, message: `says is at most ${MAX_STEP_SAYS} characters` });
        }
        if (step.detail !== undefined && typeof step.detail !== 'string') {
          problems.push({ path: `steps[${i}].detail`, message: 'detail must be text' });
        } else if (typeof step.detail === 'string' && step.detail.length > MAX_STEP_DETAIL) {
          problems.push({ path: `steps[${i}].detail`, message: `detail is at most ${MAX_STEP_DETAIL} characters` });
        }
        const key = `${step.from}>${step.to}`;
        if (fromOk && toOk && !arrows.has(key)) {
          arrows.add(key);
          derived.push({ from: step.from as string, to: step.to as string });
          derivedAt.push(`steps[${i}]`);
        }
      }
    }
  }
  const drawn = derived.length > 0 ? [...links, ...derived] : links;
  for (const [i, l] of drawn.entries()) {
    /* A derived arrow is reported at the step that asked for it: that is the
       line the model wrote, and the one it can fix. */
    const at = i < links.length ? `links[${i}]` : derivedAt[i - links.length]!;
    if (!l || typeof l !== 'object') {
      problems.push({ path: at, message: 'link must be an object' });
      continue;
    }
    if (!ids.has(l.from)) problems.push({ path: `${at}.from`, message: unknownItem(l.from) });
    if (!ids.has(l.to)) problems.push({ path: `${at}.to`, message: unknownItem(l.to) });
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
      /* WHAT THE START IS CONNECTED TO (2026-09-22). Live on ML Harness,
         `no edge mod:ml-harness-app/0 -> mod:ml-harness-app/3` six times in
         six runs, and each retry was blind. Naming up to three pairs the scan
         does have from the same start gives a small model a real one to pick.
         Sorted, so the same refusal names the same three every time. */
      const out = [...knownEdges].filter((k) => k.startsWith(`${fromNode}>`)).sort();
      const connects =
        out.length === 0
          ? ''
          : `. From ${fromNode} the scan connects: ` +
            out.slice(0, 3).map((k) => `${fromNode} -> ${k.slice(fromNode.length + 1)}`).join(', ') +
            (out.length > 3 ? ` (+${out.length - 3} more)` : '');
      problems.push({
        path: at,
        message:
          `no edge ${fromNode} -> ${toNode} in this repository — a chart may not invent a ` +
          `connection between real parts` +
          (reversed ? `. The scan has ${toNode} -> ${fromNode}` : '') +
          connects +
          '. If you mean a flow the static scan cannot see, drop the nodeId from these items ' +
          'and draw it as a concept instead',
      });
    }
  }
  if (o.focusItemId !== undefined && !ids.has(o.focusItemId)) {
    problems.push({ path: 'focusItemId', message: unknownItem(o.focusItemId) });
  }
  if (problems.length > 0) return { ok: false, problems };
  /* Derived arrows ride on the accepted chart, so the renderer draws the hop
     each step plays. */
  const out = derived.length > 0 ? { ...o, links: drawn } : o;
  /* The stamp is added here, so every accepted chart on the wire carries the
     version its own type declares — the caller may omit it, the payload never
     does. */
  return { ok: true, chart: (out.version === 1 ? out : { ...out, version: 1 }) as SeqChart };
}

/**
 * THE EDGE SET A CHART IS GROUNDED AGAINST, in the direction a reader draws.
 *
 * A scan stores a queue consumer's edge as `consumer -> topic`: the subscribe
 * call is in the consumer's code. Data moves the other way, and that is how a
 * person and a model both draw it: `topic -> worker`. validateChart treats
 * direction as part of the claim, so the reader's drawing of a real
 * subscription was refused as an invented connection. On the hard A/B set,
 * that was 12 of the 44 refusals, in every language.
 *
 * So a `queue_consume` edge is accepted either way round, and no other kind
 * is: `a -> b` still does not stand for `b -> a` on an http, grpc, import or
 * publish edge.
 */
export function groundingEdgeKeys(
  edges: readonly { srcId: string; dstId: string; kind?: string }[],
): Set<string> {
  const keys = new Set<string>();
  for (const e of edges) {
    keys.add(`${e.srcId}>${e.dstId}`);
    if (e.kind === 'queue_consume') keys.add(`${e.dstId}>${e.srcId}`);
  }
  return keys;
}
