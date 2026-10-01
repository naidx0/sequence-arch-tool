/**
 * THE VISUAL, DECIDED IN CODE.
 *
 * Fourteen bench runs say the model does not draw. 182 of 188 turns attempt no
 * visual in any form — not a refusal, not the wrong tool, not the wrong format,
 * no attempt (`docs/research/re-baseline-2026-09-05.md`). Three belts were
 * tried, long, short and mid, and a length control on top: none moved the
 * visual on a teaching turn off zero, and the mid belt carries both chart
 * bullets byte-identical to the full one and still produced zero chart calls.
 *
 * The two changes that DID move a metric all night — the propose_topology
 * redirect and the validator naming the admissible set — are both things the
 * model reads AFTER it acts. Nothing it reads before has worked. So the
 * decision to draw comes out of the prompt and into the product: when the
 * turn's concept names a real node, the chart is built here and the model's
 * job is the sentence beside it.
 *
 * ── WHAT THIS MAY NOT DO, STATED BEFORE IT IS BUILT ON ────────────────────
 *
 * It may not INVENT. Every item is a node from the scanned graph and every link
 * is an edge that exists in it, so the picture claims exactly what the graph
 * claims and no more. That is not a style preference: `docs/CANON.md` makes
 * grounded-not-guessed a product law, and a chart the product drew is MORE
 * dangerous than one the model drew, because a reader has no reason to doubt
 * it.
 *
 * It also may not draw where there is nothing to say. A concept with no node,
 * a node that is not in the graph, or a node with no neighbours returns
 * `undefined` — a one-box diagram is not a picture of a relationship, and
 * shipping one to satisfy a metric is exactly the fabrication this file is
 * supposed to prevent.
 */
import type { ArchEdge, ArchGraph } from '@sequence/schema';
import { validateChart, type SeqChart } from '@sequence/schema';

import type { Concept } from './lessonState.js';
import { flowHopsForEdges, liftedEdgeKeys, type TraceFlowHop } from './askTools.js';

/** How many neighbours a concept chart shows before it stops being readable. */
const MAX_NEIGHBOURS = 4;

/** How far left a label may reach for uniqueness before it stops being a name. */
const MAX_LABEL_SEGMENTS = 3;

/**
 * THE CONCEPT CHART NAMES ITS HOPS (SEQUENCE_TEACH_CONCEPT_STEPS=1, under A/B).
 * Off, the concept chart is a star of unlabelled arrows with no steps: a reader
 * sees that things connect, not how. On, each link carries its scanned edge kind
 * and the chart gets steps, inbound hops first, each saying what the scan says
 * travels on it (the route, the topic, the table), so the canvas can number and
 * play them like a traced flow.
 */
export function conceptStepsOn(): boolean {
  return process.env.SEQUENCE_TEACH_CONCEPT_STEPS === '1';
}

/**
 * V2 (the default; SEQUENCE_TEACH_CONCEPT_STEPS=0 turns it off, =1 is v1). The render check of v1 found link labels clipped
 * under the boxes of a three-layer star at the canvas's 440 px, and steps that number parallel
 * edges as one sequence. So v2 draws the chart as before and writes the hops that say more than
 * "import" (a route, a topic, a table) into the caption, which wraps instead of colliding.
 */
export function conceptCaptionHopsOn(): boolean {
  /* Kept on screenshots (7 of 7 changed charts, 21 of 21 blind judgments); on by default, =0 turns it off. */
  const v = process.env.SEQUENCE_TEACH_CONCEPT_STEPS;
  return v === undefined || v === '' || v === 'caption';
}

/** How many hops a caption names before it stops being a caption. */
const MAX_CAPTION_HOPS = 3;

const HOP_VERB: Record<string, string> = {
  http: 'calls',
  grpc: 'calls',
  queue_publish: 'publishes to',
  queue_consume: 'consumes from',
  db_read: 'reads',
  db_write: 'writes',
  db_access: 'uses',
};

/** One caption sentence for a non-import hop, or nothing for an import. */
export function conceptHopSentence(src: string, dst: string, edge: Pick<ArchEdge, 'kind' | 'detail'>): string | undefined {
  const verb = HOP_VERB[edge.kind];
  if (verb === undefined) return undefined;
  const says = conceptHopSays(edge);
  const what = says === edge.kind ? '' : ` (${says.slice(edge.kind.length + 2)})`;
  return `${src} ${verb} ${dst}${what}.`;
}

/** What one scanned edge carries, in the scan's own words. */
export function conceptHopSays(edge: Pick<ArchEdge, 'kind' | 'detail'>): string {
  const meta: Record<string, unknown> = edge.detail ?? {};
  const text = (k: string): string | undefined => (typeof meta[k] === 'string' && meta[k] !== '' ? (meta[k] as string) : undefined);
  const route = [text('method'), text('pathPattern')].filter(Boolean).join(' ');
  if (route !== '') return `${edge.kind}: ${route}`;
  const what = text('topic') ?? text('table') ?? text('url') ?? text('envVar');
  return what !== undefined ? `${edge.kind}: ${what}` : edge.kind;
}

/**
 * Build the chart for a concept, or nothing.
 *
 * Returns the chart already through `validateChart`, so a bug here is caught by
 * the same gate that catches the model's charts rather than shipping because
 * the product happened to be the author.
 */
export function buildConceptChart(
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  concept: Concept | undefined,
): SeqChart | undefined {
  if (graph === undefined || concept?.nodeId === undefined) return undefined;
  const byId = new Map((graph.nodes ?? []).map((n) => [n.id, n]));
  const focus = byId.get(concept.nodeId);
  if (focus === undefined) return undefined;

  /* One hop, direction preserved: an edge drawn the wrong way round is a false
     claim about the architecture, not a cosmetic slip. */
  const candidates: { otherId: string; outgoing: boolean; edge: ArchEdge }[] = [];
  const found = new Set<string>([focus.id]);
  for (const edge of graph.edges ?? []) {
    const outgoing = edge.srcId === focus.id;
    const incoming = edge.dstId === focus.id;
    if (!outgoing && !incoming) continue;
    const otherId = outgoing ? edge.dstId : edge.srcId;
    if (found.has(otherId) || !byId.has(otherId)) continue;
    found.add(otherId);
    candidates.push({ otherId, outgoing, edge });
  }

  /*
   * A SLOT FOR EACH DIRECTION, BECAUSE FIRST-COME LIED BY OMISSION.
   *
   * This filled the four slots in graph edge order and stopped. Measured on the
   * real product: `brief.ts` has four files importing it and one it imports,
   * the four inbound edges filled the budget first, and the chart showed no
   * outbound arrow at all. Every arrow drawn was true, and a reader would still
   * have concluded the file depends on nothing when it depends on one thing —
   * which is a false claim assembled entirely out of true ones.
   *
   * So each direction that EXISTS is guaranteed one slot before either side
   * fills the rest. The remainder still goes in graph edge order, so the
   * commonest shape — a file with dependents and no dependencies — is drawn
   * exactly as it was.
   */
  const picked: typeof candidates = [];
  for (const wantOutgoing of [false, true]) {
    const first = candidates.find((c) => c.outgoing === wantOutgoing);
    if (first !== undefined && picked.length < MAX_NEIGHBOURS) picked.push(first);
  }
  for (const candidate of candidates) {
    if (picked.length >= MAX_NEIGHBOURS) break;
    if (!picked.includes(candidate)) picked.push(candidate);
  }
  /* Back into graph edge order, so the picture still reads the way the system
     runs rather than in the order the slots happened to be reserved. */
  picked.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));

  const hopped = conceptStepsOn();
  const captionHops = conceptCaptionHopsOn()
    ? picked
        .map(({ otherId, outgoing, edge }) => {
          const src = byId.get(outgoing ? focus.id : otherId)!;
          const dst = byId.get(outgoing ? otherId : focus.id)!;
          return conceptHopSentence(src.label ?? src.id, dst.label ?? dst.id, edge);
        })
        .filter((x): x is string => x !== undefined)
        .slice(0, MAX_CAPTION_HOPS)
        .map((x) => ` ${x}`)
        .join('')
    : '';
  const links = picked.map(({ otherId, outgoing, edge }) => ({
    ...(outgoing ? { from: focus.id, to: otherId } : { from: otherId, to: focus.id }),
    ...(hopped ? { label: edge.kind } : {}),
  }));
  /* In, then out: what reaches the concept is read before what it reaches. */
  const steps = hopped
    ? [...picked.filter((p) => !p.outgoing), ...picked.filter((p) => p.outgoing)].map(({ otherId, outgoing, edge }) => ({
        from: outgoing ? focus.id : otherId,
        to: outgoing ? otherId : focus.id,
        says: shortSays(conceptHopSays(edge)),
      }))
    : undefined;
  const seen = new Set<string>([focus.id, ...picked.map((p) => p.otherId)]);
  /* Nothing touches it: there is no relationship to draw, and a single box is
     not a diagram. */
  if (links.length === 0) return undefined;

  /*
   * A LABEL THAT NAMES TWENTY FILES NAMES NONE OF THEM.
   *
   * The first chart to draw an outbound edge read `brief.ts -> index.ts`. The
   * edge is real -- it is the `@sequence/schema` import, resolving to
   * `packages/schema/src/index.ts` -- and TWENTY nodes in this repository are
   * labelled `index.ts`. A reader is told a true thing and cannot tell which
   * true thing it is, which is the settled owner dislike about generic
   * one-word rows arriving inside a picture instead of a list.
   *
   * So a label that is not unique in the graph carries its parent directory.
   * Only when it collides: `bigram_counts.py` stays `bigram_counts.py`, and the
   * chart does not start printing paths at readers who did not need them.
   */
  const segmentsOf = (node: { id: string; path?: string }): string[] =>
    (node.path ?? node.id).replace(/^file:/, '').split(/[\/]/).filter(Boolean);
  /* How many nodes share each suffix of each length, so a label can be extended
     until it actually distinguishes. `src/index.ts` was the first attempt and
     is no better than `index.ts` — every package has one. */
  const suffixCount = new Map<string, number>();
  for (const node of graph.nodes ?? []) {
    const parts = segmentsOf(node);
    for (let take = 1; take <= Math.min(MAX_LABEL_SEGMENTS, parts.length); take += 1) {
      const suffix = parts.slice(-take).join('/');
      suffixCount.set(suffix, (suffixCount.get(suffix) ?? 0) + 1);
    }
  }
  const labelFor = (node: { label?: string; id: string; path?: string }): string => {
    const parts = segmentsOf(node);
    for (let take = 1; take <= Math.min(MAX_LABEL_SEGMENTS, parts.length); take += 1) {
      const suffix = parts.slice(-take).join('/');
      if ((suffixCount.get(suffix) ?? 0) <= 1) return suffix;
    }
    /* Still ambiguous at the cap: the longest form is more honest than the
       shortest, and a reader can at least see where it sits. */
    return parts.slice(-MAX_LABEL_SEGMENTS).join('/');
  };

  const items = [...seen].map((id) => {
    const node = byId.get(id)!;
    return { id, label: labelFor(node), nodeId: id };
  });

  const candidate: SeqChart = {
    version: 1,
    kind: 'data-flow',
    title: concept.title,
    /*
     * The caption says where the picture came from, not what it means. Meaning
     * is the model's sentence; provenance is this file's, and a reader who
     * knows a diagram was derived can weigh it accordingly.
     */
    /* A caption that opens with the title is hidden as an echo (ChartFrame captionEchoesTitle),
       which is why no concept caption has ever been shown. The hops open with other words. */
    caption:
      captionHops !== ''
        ? `What travels here:${captionHops} From the scanned graph.`
        : `${focus.label ?? focus.id} and what it connects to, from the scanned graph.`,
    items,
    links,
    ...(steps !== undefined ? { steps } : {}),
    focusItemId: focus.id,
  };

  /* Held to the SAME edge rule as the model's charts, though by construction it
     can only draw edges it read out of this graph. If that construction is ever
     broken, this is where it is caught rather than at a reader's eye. */
  const checked = validateChart(
    candidate,
    new Set(byId.keys()),
    new Set((graph.edges ?? []).map((e) => `${e.srcId}>${e.dstId}`)),
  );
  return checked.ok ? checked.chart : undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE FLOW THE ANSWER WALKED THROUGH (2026-09-22)
   ═══════════════════════════════════════════════════════════════════════════

   `buildConceptChart` draws nothing without a concept node, and the first turn
   of a lesson asked broadly — "teach me how this works" — has none. Owner,
   2026-09-22: that turn is the root overview, and it should end with the flow
   drawn on the canvas. The overview names the parts in the order the data
   moves, so the picture is built from what it named.

   STILL MAY NOT INVENT. An item is a part of this repository the answer named
   by its real label or path — an ambiguous label (twenty `index.ts`) resolves to
   nothing — so no box on the picture is made up. The arrows are the scan's:
   a `trace_flow` this turn, or else the edges among the named parts (see
   `buildAnswerFlowChart`). Only when the scan joins none of them do the arrows
   follow the order the answer named them; then the items carry no nodeIds, and
   the caption says the arrows follow the answer rather than the scan — the
   validator's own advice for a flow the static scan cannot see. */

/** How many named parts the answer's flow shows before it stops being readable. */
const MAX_FLOW_ITEMS = 8;

/** The node kinds an answer can name as a component of the flow. */
const FLOW_KINDS = new Set(['service', 'datastore', 'topic', 'file', 'module']);

const isNameChar = (c: string | undefined): boolean => c !== undefined && /[a-z0-9_-]/.test(c);

/**
 * The real parts an answer names, in the order it first names them.
 * Exported for the floor's tests; the rule is the one described above.
 */
export function partsNamedIn(
  graph: Pick<ArchGraph, 'nodes'>,
  answer: string,
): { id: string; label: string }[] {
  const text = answer.toLowerCase();
  const eligible = (graph.nodes ?? []).filter((n) => FLOW_KINDS.has(n.kind));
  const labelUses = new Map<string, number>();
  for (const n of eligible) {
    const l = (n.label ?? '').toLowerCase();
    if (l !== '') labelUses.set(l, (labelUses.get(l) ?? 0) + 1);
  }
  const hits: { start: number; end: number; id: string; label: string }[] = [];
  for (const n of eligible) {
    const forms: string[] = [];
    const p = (n.path ?? '').toLowerCase();
    if (p.includes('/')) forms.push(p);
    const l = (n.label ?? '').toLowerCase();
    if (l.length >= 3 && labelUses.get(l) === 1) forms.push(l);
    for (const form of forms) {
      for (let at = text.indexOf(form); at !== -1; at = text.indexOf(form, at + 1)) {
        const before = text[at - 1];
        const after = text[at + form.length];
        /* A whole name, not a piece of a longer one: "orders" is not named by
           "orders.ts" or by "gateway/src/routes/orders.ts". */
        const glued =
          isNameChar(before) ||
          before === '/' ||
          before === '.' ||
          isNameChar(after) ||
          after === '/' ||
          (after === '.' && isNameChar(text[at + form.length + 1]));
        if (glued) continue;
        hits.push({ start: at, end: at + form.length, id: n.id, label: n.label ?? n.id });
        break;
      }
    }
  }
  /* Earliest first; at one place the longer name wins, so a path beats the
     label inside it. */
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: { id: string; label: string }[] = [];
  let reach = -1;
  for (const h of hits) {
    if (h.start < reach || out.some((o) => o.id === h.id)) continue;
    out.push({ id: h.id, label: h.label });
    reach = h.end;
    if (out.length >= MAX_FLOW_ITEMS) break;
  }
  return out;
}

/** A `trace_flow` result carried to the floor: its hops, in the order the tool proved them. */
export interface AnswerFlowTrace {
  from: string;
  to?: string;
  hops: readonly TraceFlowHop[];
  /** The harness gathered it before the first call; with a `to`, it is a path the question aimed at. */
  gathered?: boolean;
}

/** How many parts a traced flow keeps on the floor's picture. */
const MAX_TRACE_ITEMS = 12;
/** The chart's own step cap (`MAX_CHART_STEPS` in the schema). */
const MAX_FLOW_STEPS = 24;

const shortSays = (s: string): string => (s.length > 80 ? `${s.slice(0, 79)}…` : s);

/**
 * The flow of the parts an answer named, or nothing when it named fewer than
 * two. Returned through `validateChart`, like every chart this file builds.
 *
 * THE ORDER IS THE FLOW'S, NOT THE ANSWER'S (2026-09-22). Owner's re-measure,
 * six runs on ML Harness: the floor drew 3 of the 5 charts and its arrows
 * followed the order of mention — r4 `main.py → frontend → Database → facade
 * → tools → ml-harness-app → ml-harness`, r6 starting `ds:ml-harness-db →
 * svc:frontend` — under its own caption "the arrows follow the order the answer
 * gave, not edges the scan found". In the same runs `trace_flow` returned a
 * proven, ordered path three times (`app/main.py — 24 hops` in r1) that nobody
 * drew. So a trace this turn is drawn first; without one the named parts are
 * ordered by the edges the scan has between them; the order of mention is left
 * only for parts the scan joins nowhere, and the caption still says so.
 */
export function buildAnswerFlowChart(
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  answer: string,
  traces: readonly AnswerFlowTrace[] = [],
  question = '',
): SeqChart | undefined {
  if (graph === undefined) return undefined;
  const nodeIds = new Set((graph.nodes ?? []).map((n) => n.id));
  const keys = liftedEdgeKeys(graph as ArchGraph);
  const named = partsNamedIn(graph, answer);
  const traced = buildTracedFlowChart(graph, named, traces, question);
  if (traced !== undefined) {
    const checked = validateChart(traced, nodeIds, keys);
    if (checked.ok) return checked.chart;
  }
  const scanned = named.length < 2 ? undefined : buildScannedOrderChart(graph, named, keys);
  if (scanned !== undefined) {
    const checked = validateChart(scanned, nodeIds, keys);
    if (checked.ok) return checked.chart;
  }
  /*
   * THE PATHS THE QUESTION AIMED AT, WHEN THE ANSWER NAMED NOTHING ON THEM
   * (Slice 10, 2026-09-23). The harness proved a path to each target the
   * question named before the first call; a draft that names none of its parts
   * still teaches the question those paths answer. Drawn here, before the
   * grader reads, a draft is not sent back for "NO VISUAL" while the picture
   * the question asked for was on hand.
   */
  const aimed = buildTracedFlowChart(graph, named, traces, question, true);
  if (aimed !== undefined) {
    const checked = validateChart(aimed, nodeIds, keys);
    if (checked.ok) return checked.chart;
  }
  if (named.length < 2) return undefined;
  /* NO EDGE AMONG ANY OF THEM: the answer's order is all there is, and the
     items drop their nodeIds so the picture claims no connection. */
  const candidate: SeqChart = {
    version: 1,
    kind: 'data-flow',
    title: 'The flow, part by part',
    caption:
      'The parts this answer named, each a real part of this repository; the arrows follow ' +
      'the order the answer gave, not edges the scan found.',
    items: named.map((n) => ({ id: n.id, label: n.label })),
    links: named.slice(1).map((b, i) => ({ from: named[i]!.id, to: b.id })),
  };
  const checked = validateChart(candidate, nodeIds, keys);
  return checked.ok ? checked.chart : undefined;
}

/**
 * THE TRACE THIS TURN, TRIMMED TO WHAT THE ANSWER TAUGHT.
 *
 * Each named part is found in the trace (itself, or the traced module or service
 * it sits in), and the hops that reach it from the start are kept with it, so
 * every box has the path that proves how the flow got there. At most
 * {@link MAX_TRACE_ITEMS} parts. Of several traces, the one that covers the
 * most named parts wins, the later on a tie.
 *
 * ONLY WHAT THE ANSWER NAMED, AND THE HOPS BETWEEN (2026-09-23). The harness
 * now gathers a trace from every service's entry file before a lesson's first
 * turn, so a trace is on hand whether or not the lesson used it. Drawing the
 * head of one for an answer that named nothing on it put a chart on the canvas
 * for "it starts at the front and ends at the back", and drew
 * `default.conf → invoices.ts → …` for an answer about gateway and orders,
 * because a service never matched the files of a trace. So: a named part
 * is also found as the first traced file inside it (a gathered trace runs
 * file to file, and a lesson names services), the start of the trace is cut
 * back to where the named parts meet, and fewer than two named parts on the
 * trace draws nothing here — the named parts are then ordered by the scan.
 *
 * THE AIMED PATH FIRST, WHOLE (2026-09-23). Fourth measurement: all six floor
 * charts opened on the side hop `client.ts → hwdetect.py (GET /local_specs)`,
 * cut from an entry trace, while the question asked how the engine reaches
 * the model. The harness now gathers a path to each target the question
 * names (`gathered` with a `to`). So the traces are taken in this order: an
 * aimed path whose target the answer names, then an aimed path the answer
 * names a part of, then the model's own traces, then the gathered entry
 * traces. An aimed path is drawn whole from its first hop — it is already the
 * shortest proven path, so the flow needs every hop on it — and one named
 * part on it is enough to draw it.
 *
 * EVERY PATH THE QUESTION AIMED AT, AS ONE FLOW (Slice 10, 2026-09-23). Fifth
 * measurement: Teach-on runs drew the path to diagnosis, Teach-off runs the
 * path to providers, and no chart drew both, though the question asked for
 * the model and the gates. When the drawn path is an aimed one, every other
 * aimed path from the same entry joins it: the shared start once, each branch
 * after it in its own path order, while the picture stays within
 * {@link MAX_TRACE_ITEMS} parts.
 *
 * THE HOP THE QUESTION ASKED ABOUT NAMES THE STEP. The same measurement's
 * first step read "calls main.py over HTTP (GET /health)": the shortest proof
 * of that hop, not the request the question asked about. Where the scan has
 * several edges between the same two files and the question speaks of a
 * request (request, token, ask, prompt, run, plan), a step says what the
 * edge whose label carries one of those words says. The arrows are unchanged.
 */
function buildTracedFlowChart(
  graph: Pick<ArchGraph, 'nodes' | 'edges'>,
  named: readonly { id: string; label: string }[],
  traces: readonly AnswerFlowTrace[],
  question = '',
  /** Draw an aimed path the answer names nothing on: it is the question's. */
  aimedAlone = false,
): SeqChart | undefined {
  const byId = new Map((graph.nodes ?? []).map((n) => [n.id, n]));
  const chainOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      seen.add(cur.id);
      out.push(cur.id);
    }
    return out;
  };
  if (aimedAlone) traces = traces.filter((t) => t.gathered === true && t.to !== undefined);
  let best: { trace: AnswerFlowTrace; order: string[]; matched: string[]; tier: number } | undefined;
  for (const trace of traces) {
    if (trace.hops.length === 0) continue;
    const order: string[] = [];
    for (const h of trace.hops) {
      if (!order.includes(h.from)) order.push(h.from);
      if (!order.includes(h.to)) order.push(h.to);
    }
    const matched: string[] = [];
    for (const n of named) {
      const hit =
        chainOf(n.id).find((c) => order.includes(c)) ?? order.find((c) => chainOf(c).includes(n.id));
      if (hit !== undefined && !matched.includes(hit)) matched.push(hit);
    }
    const aimed = trace.gathered === true && trace.to !== undefined;
    if (matched.length < (aimed ? (aimedAlone ? 0 : 1) : 2)) continue;
    const target = trace.to;
    const targetNamed =
      target !== undefined && named.some((n) => chainOf(n.id).includes(target) || chainOf(target).includes(n.id));
    const tier = aimed ? (targetNamed ? 0 : 1) : trace.gathered === true ? 3 : 2;
    /* Within a tier the most named parts win; an aimed path keeps the
       question's order on a tie, any other trace the later one. */
    if (
      best === undefined ||
      tier < best.tier ||
      (tier === best.tier &&
        (matched.length > best.matched.length || (!aimed && matched.length === best.matched.length)))
    ) {
      best = { trace, order, matched, tier };
    }
  }
  if (best === undefined) return undefined;
  const { trace, matched } = best;
  let { order } = best;
  let shown: TraceFlowHop[] = [...trace.hops];
  /* The ends of the paths drawn, for the title. */
  let ends: string[] = trace.to !== undefined ? [trace.to] : [];
  if (best.tier <= 1) {
    ends = [];
    const union: TraceFlowHop[] = [];
    const parts: string[] = [];
    for (const t of traces) {
      if (t !== trace && !(t.gathered === true && t.to !== undefined && t.from === trace.from)) continue;
      const fresh = t.hops.filter((h) => !union.some((u) => u.from === h.from && u.to === h.to));
      const grown = [...parts];
      for (const h of fresh) for (const id of [h.from, h.to]) if (!grown.includes(id)) grown.push(id);
      if (t !== trace && grown.length > MAX_TRACE_ITEMS) continue;
      union.push(...fresh);
      parts.splice(0, parts.length, ...grown);
      if (t.to !== undefined && !ends.includes(t.to)) ends.push(t.to);
    }
    shown = union;
    order = parts;
  }
  if (best.tier > 1) {
    /* The hop each part was first reached by: a path back to the start. */
    const reachedBy = new Map<string, TraceFlowHop>();
    for (const h of trace.hops) if (h.to !== order[0] && !reachedBy.has(h.to)) reachedBy.set(h.to, h);
    const kept = new Set<string>();
    for (const id of matched) {
      const path: string[] = [];
      const seen = new Set<string>();
      for (let cur: string | undefined = id; cur !== undefined && !seen.has(cur); cur = reachedBy.get(cur)?.from) {
        seen.add(cur);
        path.push(cur);
      }
      const grown = new Set([...kept, ...path]);
      if (grown.size <= MAX_TRACE_ITEMS) for (const p of path) kept.add(p);
    }
    shown = trace.hops.filter((h) => kept.has(h.from) && kept.has(h.to));
    /* Cut the start back to where the named parts meet: an unnamed part with a
       single kept hop out of it and none in connects nothing the answer named. */
    for (;;) {
      const root = [...kept].find((id) => !matched.includes(id) && !shown.some((h) => h.to === id));
      if (root === undefined || shown.filter((h) => h.from === root).length !== 1) break;
      kept.delete(root);
      shown = shown.filter((h) => h.from !== root);
    }
  }
  shown = shown.slice(0, MAX_FLOW_STEPS);
  const parts = order.filter((id) => shown.some((h) => h.from === id || h.to === id));
  if (parts.length < 2) return undefined;
  const labels = parts.map((id) => byId.get(id)?.label ?? id);
  const nameOf = (id: string): string => (byId.get(id)?.path ?? byId.get(id)?.label ?? id).replace(/\\/g, '/');
  const short = (s: string) => (s.length > 60 ? `…${s.slice(-59)}` : s);
  /* A start cut back above is not in the picture, so the title names the first part that is. */
  const start = parts.includes(trace.from) ? trace.from : parts[0]!;
  /* What each step says: the scan's own label, or the label of another scanned
     edge between the same two files that speaks of what the question asked. */
  const says = (h: TraceFlowHop): string => hopSays(graph, h, question);
  /* An end another path goes on from (the engine, on the way to the model) is not where the flow ends. */
  const drawnEnds = ends.filter((e) => parts.includes(e) && !shown.some((h) => h.from === e));
  return {
    version: 1,
    kind: 'data-flow',
    title: drawnEnds.length > 0
      ? `${short(nameOf(start))} to ${drawnEnds.map((e) => short(nameOf(e))).join(' and ')}`
      : `How ${short(nameOf(start))} flows`,
    caption:
      best.tier <= 1
        ? drawnEnds.length > 1
          ? 'The paths the question asked about, traced this turn from their shared first hop; each arrow is a scanned edge, in the order the flow moves.'
          : 'The path the question asked about, traced this turn from its first hop; each arrow is a scanned edge, in the order the flow moves.'
        : 'The flow traced this turn, cut to the parts this answer named; each arrow is a scanned edge, in the order the flow moves.',
    items: parts.map((id, i) => ({
      id,
      /* Two parts with one name (two index.ts) read by their path instead. */
      label: labels.indexOf(labels[i]!) !== labels.lastIndexOf(labels[i]!) ? nameOf(id) : labels[i]!,
      nodeId: id,
    })),
    links: shown.map((h) => ({ from: h.from, to: h.to, label: h.kind })),
    steps: shown.map((h) => ({ from: h.from, to: h.to, says: shortSays(says(h)) })),
  };
}

/** The words a question and a step label share when both speak of a request. */
const QUESTION_REQUEST_NOUNS = /\b(?:requests?|tokens?|ask(?:s|ed|ing)?|prompts?|runs?|plans?)\b/i;

/**
 * THE HOP THE QUESTION ASKED ABOUT, ONE LABELLER FOR THE CHART AND THE PROSE
 * (Slice 11, 2026-09-23). Slice 10 taught the chart's step to prefer, of the
 * scanned edges between the same two files, the one whose label carries a word
 * of the question (the run route over `GET /health`); the evidence
 * prose kept the shortest proof, and the sixth measurement's section still read
 * "calls main.py over HTTP (GET /health)" three times (`ev-r1.txt:7/24/38`)
 * under a chart whose first step said the run route. Both now ask this.
 *
 * The hop keeps its ends; the label, the file:line and the edge are the chosen
 * twin's, so a line cited beside the label is the line that label comes from.
 */
export function hopTheQuestionAsked(
  graph: Pick<ArchGraph, 'nodes' | 'edges'>,
  hop: TraceFlowHop,
  question: string,
): TraceFlowHop {
  if (!QUESTION_REQUEST_NOUNS.test(question) || QUESTION_REQUEST_NOUNS.test(hop.label)) return hop;
  const twins = (graph.edges ?? []).filter(
    (e) => e.srcId === hop.from && e.dstId === hop.to && e.id !== hop.edge && e.instrument !== 'test',
  );
  /* One edge at a time: given together, one pair is one hop and the rest are dropped. */
  for (const e of twins) {
    const twin = flowHopsForEdges(graph as ArchGraph, [e], 'file')[0];
    if (twin !== undefined && QUESTION_REQUEST_NOUNS.test(twin.label)) return { ...twin, from: hop.from, to: hop.to };
  }
  return hop;
}

/**
 * AN IMPORT HOP SAYS IT IS ONE (Slice 11, 2026-09-23). Sixth measurement: the
 * aimed paths end on import edges (`app/main.py:27 → app/diagnosis.py`,
 * `app/main.py:35 → app/providers/__init__.py`), the chart drew them as steps
 * after the HTTP hop, and three answers put the honesty test "on the token path"
 * ("runs a five-gate diagnosis check before any model answer is returned"). The
 * edge is a module `main.py` loads, and nothing said so.
 *
 * So a hop over a scanned `import` edge reads "imports diagnosis.py — a module
 * main.py loads, not a request hop"; a request hop (http, grpc, a queue) reads
 * as {@link hopTheQuestionAsked} names it. The wording follows the edge kind the
 * scan recorded, never the answer's words. Kept within a step's 80 characters:
 * past that the loader's name goes and "not a request hop" stays.
 */
export function hopSays(graph: Pick<ArchGraph, 'nodes' | 'edges'>, hop: TraceFlowHop, question: string): string {
  if (hop.kind !== 'import') return hopTheQuestionAsked(graph, hop, question).label;
  const from = (graph.nodes ?? []).find((n) => n.id === hop.from);
  const loader = from?.label ?? hop.from;
  const full = `${hop.label} — a module ${loader} loads, not a request hop`;
  return full.length <= 80 ? full : `${hop.label} — not a request hop`;
}

/**
 * NO TRACE: THE NAMED PARTS, ORDERED BY THE EDGES THE SCAN HAS AMONG THEM.
 *
 * An arrow only where the scan (lifted to modules and services, the rule every
 * chart is held to) joins two named parts, in the scan's direction; the parts
 * then run sources first, the answer's order breaking ties and cycles. A part
 * the scan joins to none of the others stays on the picture with no arrow.
 * Nothing when no two named parts are joined at all.
 */
function buildScannedOrderChart(
  graph: Pick<ArchGraph, 'nodes' | 'edges'>,
  named: readonly { id: string; label: string }[],
  keys: ReadonlySet<string>,
): SeqChart | undefined {
  const ids = named.map((n) => n.id);
  const pairs: { from: string; to: string }[] = [];
  for (const a of ids) for (const b of ids) if (a !== b && keys.has(`${a}>${b}`)) pairs.push({ from: a, to: b });
  if (pairs.length === 0) return undefined;
  const joined = ids.filter((id) => pairs.some((p) => p.from === id || p.to === id));
  /* Kahn's order, sources first; ties and cycles go to the part named first. */
  const indegree = new Map(joined.map((id) => [id, pairs.filter((p) => p.to === id).length]));
  const order: string[] = [];
  while (order.length < joined.length) {
    const left = joined.filter((id) => !order.includes(id));
    const next = left.find((id) => indegree.get(id) === 0) ?? left[0]!;
    order.push(next);
    for (const p of pairs) if (p.from === next) indegree.set(p.to, (indegree.get(p.to) ?? 1) - 1);
  }
  const rank = (id: string) => order.indexOf(id);
  pairs.sort((x, y) => rank(x.from) - rank(y.from) || rank(x.to) - rank(y.to));
  /* What travels on each hop, in the trace's words where a hop has one. */
  const said = new Map<string, string>();
  for (const level of ['file', 'part'] as const) {
    for (const h of flowHopsForEdges(graph as ArchGraph, graph.edges ?? [], level)) {
      const key = `${h.from}>${h.to}`;
      if (!said.has(key)) said.set(key, h.label);
    }
  }
  const labelOf = new Map(named.map((n) => [n.id, n.label]));
  const shown = pairs.slice(0, MAX_FLOW_STEPS);
  const alone = ids.filter((id) => !joined.includes(id));
  return {
    version: 1,
    kind: 'data-flow',
    title: 'The flow, part by part',
    caption:
      'The parts this answer named, in the order the scanned edges run; every arrow is an edge in the scanned graph' +
      (alone.length > 0 ? ', and a part with no arrow has no scanned edge to the others.' : '.'),
    items: [...order, ...alone].map((id) => ({ id, label: labelOf.get(id) ?? id, nodeId: id })),
    links: shown.map((p) => ({ from: p.from, to: p.to })),
    steps: shown.map((p) => ({
      from: p.from,
      to: p.to,
      says: shortSays(said.get(`${p.from}>${p.to}`) ?? `${labelOf.get(p.from)} to ${labelOf.get(p.to)}`),
    })),
  };
}

/**
 * THE CHECK-IN, DERIVED FROM THE PICTURE THE PRODUCT JUST DREW.
 *
 * Same principle as the chart and for the same measured reason: the model does
 * not reliably produce the closing beat, and no wording has made it. Across the
 * re-baseline the honest check-in was 3 and 4 of 47, and 24 of 94 turns closed
 * on a clarifying OFFER, the one shape the contract bans. The queue only
 * advances on a turn that taught — a visual AND an accepted check — so a
 * missing check means "continue" re-teaches the same concept forever, which is
 * exactly what the seat read found.
 *
 * So when the model closes without a check the grader accepts, the product
 * appends one built from the chart's own links.
 *
 * ── WHY THIS IS NOT FABRICATION, WHICH IS THE OBVIOUS OBJECTION ───────────
 *
 * The question asserts nothing. It names two files and a dependency direction
 * that `buildConceptChart` took out of the scanned graph, and asks the learner
 * to predict a consequence. Every noun in it is on the screen in front of them.
 * A derived chart claims something about the repository and therefore had to be
 * refusable; a derived question claims nothing and cannot be wrong about the
 * code — it can only be a bad question, which is a different risk and is judged
 * by reading it.
 *
 * It is a PREDICTION rather than "does that make sense?" on purpose:
 * `docs/teach-mode.md` names grading a learner's prediction as the surviving
 * differentiator, and a comprehension check is answerable "yes" by someone who
 * followed nothing.
 */
export function deriveCheckIn(chart: SeqChart | undefined): string | undefined {
  if (chart?.focusItemId === undefined) return undefined;
  const focus = chart.items.find((i) => i.id === chart.focusItemId);
  if (focus === undefined) return undefined;
  const labelOf = (id: string): string | undefined =>
    chart.items.find((i) => i.id === id)?.label;

  const links = chart.links ?? [];
  /* Who would feel a change to the focus: the items pointing AT it. */
  const dependents = links
    .filter((l) => l.to === focus.id)
    .map((l) => labelOf(l.from))
    .filter((x): x is string => x !== undefined);
  /* What the focus itself leans on: the items it points at. */
  const dependencies = links
    .filter((l) => l.from === focus.id)
    .map((l) => labelOf(l.to))
    .filter((x): x is string => x !== undefined);

  const list = (names: string[]): string =>
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]!}`;

  if (dependents.length > 0) {
    const few = dependents.slice(0, 3);
    return few.length === 1
      ? `Looking at the picture: if ${focus.label} changed what it returns, what do you think would break in ${few[0]!}?`
      : `Looking at the picture: if ${focus.label} changed what it returns, which of ${list(few)} do you think would break first?`;
  }
  if (dependencies.length > 0) {
    const few = dependencies.slice(0, 3);
    return `Looking at the picture: ${focus.label} reads from ${list(few)} — what do you think would break in ${focus.label} if that changed?`;
  }
  /* A focus with no links is not a relationship, and buildConceptChart does not
     draw one — so there is nothing to ask about and nothing is invented. */
  return undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE NEXT-PICTURE CHECK-IN — ask the prediction BEFORE the picture answers it
   ═══════════════════════════════════════════════════════════════════════════

   `deriveCheckIn` above asks the learner to READ the picture that is already on
   screen. That is a comprehension question, and a comprehension question about a
   diagram in front of you is close to free: the answer is visible.

   This asks about the picture the product holds and has NOT shown — the chart
   for the next concept in the queue. The learner has to predict from what they
   were just taught, and the next turn's picture settles it.

   WHY, AND WHAT IT DOES NOT ASSUME. The evidence is the pretesting effect —
   attempting an answer before the material improves retention of that material,
   including when the attempt is wrong — and Brod's surprise condition, where a
   violated prediction is remembered better than a confirmed one. What neither
   supports, and what this product should stop assuming, is that *a picture
   teaches by being shown*. A diagram nobody predicted against is a diagram
   nobody engaged with.

   ONE VISUAL PER TURN IS PRESERVED. The next concept's chart is built here to
   source a truthful question and is then DISCARDED. Nothing about it is emitted,
   so the turn still ships exactly one picture — the one for the concept it
   actually taught.

   REGISTERED, NOT SHIPPED: `docs/research/next-picture-checkin.md` fixes the
   bands before the run, and this form is behind a flag until they are read. */

/**
 * A prediction about the NEXT concept's picture, using only real names.
 *
 * The distractors are other files from the same repository — never invented — so
 * every name in the question is one the learner could go and look at. The claim
 * under test is only "which of these depends on X", which the scanned graph
 * answers, so a wrong guess is corrected by the picture rather than by an
 * assertion.
 */
export interface NextPicturePrediction {
  /** The question put to the learner, before the picture that answers it. */
  question: string;
  /** The true answer, so a reveal does not have to re-derive it. */
  expect: string;
  /**
   * THE ARROW THAT DECIDES IT, in the graph's own terms.
   *
   * Ruled 2026-09-06: the reveal must carry the REASON and not only the verdict
   * (the evidence page's implication 1 — feedback with the why is the largest
   * lever measured). A verdict without its reason is the judge's failure turned
   * on the learner.
   */
  arrow: string;
}

/**
 * WHY NO QUESTION WAS ASKED, in the derivation's own words.
 *
 * Nine turns across two card runs completed normally, drew a chart, wrote
 * substantive prose, closed without their own check-in — and carried no derived
 * question. Nothing recorded why, so the bucket could only be guessed at, and
 * both guesses were wrong. The first (the lesson had reached its last queue
 * entry) was refuted: all nine had a full queue. The second (the chart's links
 * pointed in mixed directions) was measured against THE WRONG CHART — this
 * function builds its own, for the NEXT concept, and never looks at the one the
 * turn drew.
 *
 * That is the lesson twice over: a decision nobody records is a decision nobody
 * can check. `atCap` was invisible until `stopReason` was recorded; this is the
 * same fix one layer down.
 */
export type NextPictureSkip =
  | 'no-next-concept'
  | 'next-concept-draws-nothing'
  | 'focus-missing-from-its-own-chart'
  | 'nothing-depends-on-the-next-concept'
  | 'too-few-distractors';

export interface NextPictureAttempt {
  /** Present when a question was produced. */
  prediction?: NextPicturePrediction;
  /** Present when it was not, naming which gate closed. */
  skipped?: NextPictureSkip;
}

/**
 * The derivation and its reason, from ONE body — so the reason can never
 * disagree with the outcome it explains.
 */
export function attemptNextPictureCheckIn(
  graph: Parameters<typeof buildConceptChart>[0],
  next: { title: string; nodeId?: string } | undefined,
): NextPictureAttempt {
  if (next === undefined) return { skipped: 'no-next-concept' };
  const chart = buildConceptChart(graph, next);
  if (chart?.focusItemId === undefined) return { skipped: 'next-concept-draws-nothing' };
  const focus = chart.items.find((i) => i.id === chart.focusItemId);
  if (focus === undefined) return { skipped: 'focus-missing-from-its-own-chart' };

  const links = chart.links ?? [];
  const labelOf = (id: string): string | undefined => chart.items.find((i) => i.id === id)?.label;
  const dependents = links
    .filter((l) => l.to === focus.id)
    .map((l) => labelOf(l.from))
    .filter((x): x is string => x !== undefined);
  /* Without at least one true answer there is nothing to predict, and a question
     whose answer is "none of them" teaches the wrong lesson about the graph. */
  if (dependents.length === 0) return { skipped: 'nothing-depends-on-the-next-concept' };

  /*
   * DISTRACTORS MUST BE THE SAME KIND AS THE ANSWER.
   *
   * The first version took any node, and produced "which of acp, cli.ts or repo
   * depends on it?" — one file among two service names. The odd one out is
   * visible without knowing anything about the repository, so the question
   * measured shape-spotting rather than prediction. Same kind, and the same file
   * extension, so the only way to answer is to have followed the lesson.
   */
  const inChart = new Set(chart.items.map((i) => i.label));
  const ext = (b: string): string => (b.includes('.') ? b.slice(b.lastIndexOf('.')) : '');
  const answerExt = ext(dependents[0]!);
  const pool = (graph?.nodes ?? [])
    .filter((n) => n.kind === 'file')
    .map((n) => String(n.path ?? n.id).split('/').pop() ?? '')
    .filter((b) => b !== '' && !inChart.has(b) && ext(b) === answerExt)
    .sort();
  if (pool.length < 2) return { skipped: 'too-few-distractors' };
  /*
   * DETERMINISTIC, BUT NOT CONSTANT.
   *
   * Taking the first two gave every concept the same pair — `client.ts` and
   * `executor.ts` on all three concepts tried — and a learner who sees the same
   * two wrong answers twice learns "pick the unfamiliar one", which is a rule
   * about the question rather than about the repository. The offset is a hash of
   * the focus label, so the same lesson always asks the same question (a bench
   * can compare two runs) while different concepts get different distractors.
   */
  let h = 0;
  for (const c of focus.label) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const at = h % pool.length;
  const distractors = [pool[at]!, pool[(at + 1 + (h % 7)) % pool.length]!].filter(
    (b, i, a) => b !== undefined && a.indexOf(b) === i,
  );
  if (distractors.length < 2) return { skipped: 'too-few-distractors' };

  /* Deterministic order, so two runs of the same lesson ask the same question
     and a bench can compare them. */
  const options = [dependents[0]!, ...distractors].sort();
  const list = `${options.slice(0, -1).join(', ')} or ${options[options.length - 1]!}`;
  /*
   * "WOULD BREAK", NOT "BREAKS FIRST", AND NOT "DEPENDS ON".
   *
   * Ruled 2026-09-06 against my own first wording. `depends on it` is answerable
   * from recall, so it is a lookup rather than a prediction and cannot be
   * violated — which is the property Brod's surprise condition needs.
   * `breaks FIRST` would be a prediction, but the scanned graph has no ordering,
   * so a reveal claiming order would assert what the scan cannot support and
   * break the first law of this product. `would break` is the form that is both
   * falsifiable — naming a non-dependent is wrong — and answerable from the
   * graph.
   */
  return {
    prediction: {
      question:
        `Before I draw it — next is ${focus.label}. Which of ${list} do you think would break if ` +
        `${focus.label} changed what it returns? I will show you the picture next turn.`,
      expect: dependents[0]!,
      arrow: `${dependents[0]!} → ${focus.label}`,
    },
  };
}

/** The prediction alone, for callers that do not need the reason. */
export function deriveNextPictureCheckIn(
  graph: Parameters<typeof buildConceptChart>[0],
  next: { title: string; nodeId?: string } | undefined,
): NextPicturePrediction | undefined {
  return attemptNextPictureCheckIn(graph, next).prediction;
}

/**
 * THE LESSON NAMES ITS OWN PICTURE, OR THE PICTURE IS WALLPAPER.
 *
 * Scored across the 11 minicpm5 answers quoted in the owner's chat (09-22/23):
 * both answers that taught AND had a chart on the canvas never once said
 * "canvas", "picture" or "arrow". The learner gets a paragraph on the left and
 * a diagram on the right, and nothing tells them the two are the same story.
 * The derived check-in ("Looking at the picture: …") does this when it fires,
 * but it only fires when the model wrote no check-in of its own — and the best
 * answer on record wrote its own.
 *
 * So, like the visual and the check-in before it, this is done in code: one
 * line, built only from the chart that is on screen, never from the prose.
 */
export function pointsAtPicture(text: string): boolean {
  return /\b(?:canvas|chart|diagram|picture|drawing|the board|arrows?|highlighted|lit up)\b/i.test(text);
}

export function derivePicturePointer(chart: SeqChart | undefined): string | undefined {
  if (chart === undefined || chart.items.length === 0) return undefined;
  const labelOf = (id: string): string | undefined => chart.items.find((i) => i.id === id)?.label;
  const links = (chart.links ?? []).filter((l) => labelOf(l.from) !== undefined && labelOf(l.to) !== undefined);
  const focus = chart.focusItemId !== undefined ? labelOf(chart.focusItemId) : undefined;
  if (focus !== undefined) {
    return `On the canvas, **${focus}** is the highlighted box: arrows coming into it are what uses it, and arrows going out are what it relies on.`;
  }
  if (links.length === 0) return undefined;
  /* Start where nothing points in, so the walk has a beginning; follow the first
     arrow out of each box, never revisiting one, so a loop cannot run forever. */
  const hasIncoming = new Set(links.map((l) => l.to));
  const start = chart.items.find((i) => !hasIncoming.has(i.id) && links.some((l) => l.from === i.id))?.id ?? links[0]!.from;
  const walk = [start];
  while (walk.length < 4) {
    const next = links.find((l) => l.from === walk[walk.length - 1] && !walk.includes(l.to));
    if (next === undefined) break;
    walk.push(next.to);
  }
  const names = walk.map((id) => `**${labelOf(id)!}**`);
  if (names.length === 1) return undefined;
  if (names.length === 2) return `On the canvas, start at ${names[0]} and follow the arrow to ${names[1]}.`;
  return `On the canvas, start at ${names[0]} and follow the arrows through ${names.slice(1, -1).join(' and ')} to ${names[names.length - 1]}.`;
}

/**
 * Put the pointer where it reads: before a closing question, so the check-in
 * stays the last thing the learner sees, otherwise at the end.
 */
export function withPicturePointer(text: string, chart: SeqChart | undefined): string {
  if (pointsAtPicture(text)) return text;
  const line = derivePicturePointer(chart);
  if (line === undefined) return text;
  return insertBeforeClosingQuestion(text, line);
}

function insertBeforeClosingQuestion(text: string, line: string): string {
  const body = text.trim();
  const paras = body.split(/\n{2,}/);
  const last = paras[paras.length - 1] ?? '';
  if (!/\?\**\s*$/.test(last)) return `${body}\n\n${line}`;
  /* A lesson written as one paragraph closes on its question too: split the
     closing question off the sentences before it, so the question stays last. */
  const split = /^([\s\S]*[.!][)`*]*)\s+([^.!?\n]*\?\**)\s*$/.exec(last);
  if (split !== null) return [...paras.slice(0, -1), split[1]!, line, split[2]!].join('\n\n');
  if (paras.length > 1) return [...paras.slice(0, -1), line, last].join('\n\n');
  return `${line}\n\n${body}`;
}

/**
 * ONE REAL EXAMPLE, READ OFF THE SCAN — NOT AN ANALOGY THE MODEL INVENTS.
 *
 * None of the 11 minicpm5 answers in the owner's chat carried an example or an
 * analogy, and asking a 2B model for one in the belt is more belt. But every
 * scanned edge already carries the concrete case: the file, the line, the
 * route or table. So when the lesson names no example, the harness adds the
 * one the picture's own arrows stand on: "`gateway/src/routes/orders.ts:9`
 * sends `GET /orders/*` over HTTP, and it lands in `orders/app/routes.py`."
 *
 * Only a scanned edge between two boxes on the chart counts (a box that is a
 * service matches the edges of the files inside it), a call beats a data
 * access beats an import, and nothing is said when no such edge exists.
 */
const EXAMPLE_ALREADY = /\b(?:a real example from this code|for example|for instance|e\.g\.|imagine|think of|say you|suppose|picture this|like a|like an)\b/i;
const KIND_RANK: Record<string, number> = { http: 0, grpc: 0, queue_publish: 1, queue_consume: 1, db_read: 2, db_write: 2, db_access: 2, import: 3 };

export function deriveWorkedExample(
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  chart: SeqChart | undefined,
): string | undefined {
  if (graph === undefined || chart === undefined) return undefined;
  const byId = new Map((graph.nodes ?? []).map((n) => [n.id, n]));
  /* Every id a node counts as: itself and each ancestor, so a file inside a
     service matches a chart box that stands for the service. */
  const within = (id: string, target: string): boolean => {
    for (let cur: string | undefined = id, hops = 0; cur !== undefined && hops < 8; hops += 1) {
      if (cur === target) return true;
      cur = byId.get(cur)?.parentId;
    }
    return false;
  };
  const nodeIdOf = new Map(chart.items.filter((i) => i.nodeId).map((i) => [i.id, i.nodeId!]));
  let best: { edge: ArchEdge; rank: number; order: number } | undefined;
  (chart.links ?? []).forEach((link, order) => {
    const from = nodeIdOf.get(link.from);
    const to = nodeIdOf.get(link.to);
    if (from === undefined || to === undefined) return;
    for (const edge of graph.edges ?? []) {
      if (edge.evidence.length === 0 || !within(edge.srcId, from) || !within(edge.dstId, to)) continue;
      const rank = KIND_RANK[edge.kind] ?? 9;
      if (best === undefined || rank < best.rank || (rank === best.rank && order < best.order)) best = { edge, rank, order };
    }
  });
  if (best === undefined) return undefined;
  const { edge } = best;
  const ev = edge.evidence[0]!;
  const at = `\x60${ev.file}:${ev.line}\x60`;
  const dst = byId.get(edge.dstId);
  const dstName = `\x60${(dst?.path ?? dst?.label ?? edge.dstId).replace(/^(?:file|svc|ds|mod):/, '')}\x60`;
  const d = edge.detail ?? {};
  const route = d.method && d.pathPattern ? `\x60${d.method} ${d.pathPattern}\x60 ` : '';
  switch (edge.kind) {
    case 'http':
    case 'grpc':
      return `A real example from this code: ${at} sends ${route}over ${edge.kind === 'http' ? 'HTTP' : 'gRPC'}, and it lands in ${dstName}.`;
    case 'db_read':
    case 'db_write':
    case 'db_access': {
      const verb = edge.kind === 'db_read' ? 'reads' : edge.kind === 'db_write' ? 'writes to' : 'uses';
      const table = d.table ? `the \x60${String(d.table)}\x60 table in ` : '';
      return `A real example from this code: ${at} ${verb} ${table}${dstName}.`;
    }
    case 'queue_publish':
    case 'queue_consume': {
      const topic = d.topic ? ` \x60${String(d.topic)}\x60` : '';
      return `A real example from this code: ${at} ${edge.kind === 'queue_publish' ? 'publishes to' : 'reads from'} the queue${topic}.`;
    }
    default:
      return `A real example from this code: ${at} imports ${dstName}.`;
  }
}

export function withWorkedExample(
  text: string,
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  chart: SeqChart | undefined,
): string {
  if (EXAMPLE_ALREADY.test(text)) return text;
  const line = deriveWorkedExample(graph, chart);
  if (line === undefined) return text;
  return insertBeforeClosingQuestion(text, line);
}

/**
 * A PLAN'S BEFORE AND AFTER, READ OFF THE PLAN'S OWN FILE LIST.
 *
 * The /plan battery drew a before/after diagram in 0 of 9 turns. Plan mode
 * refuses propose_topology (a pending service on the board is not a plan), and
 * PLAN_MODE_INSTRUCTIONS rule 2 already makes the model name the files that
 * change. So the picture is already in the answer: every named path the scan
 * knows is a box that exists today (Before) and the same box with the plan's
 * own line about it (After). A path the scan does not know goes in After only,
 * and only when its line says it is new ("create", "add", "new"); an unknown
 * path with no such word is a guess, and a guess is not drawn.
 *
 * Nothing is drawn unless at least one named file is really in the scan.
 */
const PLAN_PATH = /(?:^|[\s`'"(*[])((?:[\w@.-]+\/)*[\w@-][\w@.-]*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rb|rs|cs|php|swift|sql|ya?ml|json|toml|proto|css|scss|html|vue|svelte|md))(?::\d+)?(?=$|[\s`'"),.:;*\]])/gm;
const NEW_FILE_WORD = /\b(?:new|create|creates|created|add|adds|added|introduce)\b/i;
const PLAN_ROWS_PER_COLUMN = 8;

function planLineNote(line: string, path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const base = path.split('/').pop() ?? path;
  /* A line that opens with the path ("`routes.py` — add a route") drops it: the
     box already carries the name. Mid-sentence ("Update routes.py to …") it
     becomes the file's short name, so the sentence still reads. */
  const note = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\*\*|[`*]/g, '')
    .replace(new RegExp(`^\\s*${escaped}(?::\\d+)?[\\s:—–-]*`), '')
    .replace(new RegExp(`${escaped}(?::\\d+)?`, 'g'), base)
    .replace(/^[\s:—–-]+|[\s:—–-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return note.length > 72 ? `${note.slice(0, 71).trimEnd()}…` : note;
}

export function deriveBeforeAfterChart(
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  planText: string,
): SeqChart | undefined {
  if (graph === undefined || planText.trim() === '') return undefined;
  const nodes = graph.nodes ?? [];
  const byPath = new Map<string, (typeof nodes)[number]>();
  for (const n of nodes) if (n.path && !byPath.has(n.path)) byPath.set(n.path, n);
  const resolve = (p: string) => {
    const exact = byPath.get(p.replace(/^\.\//, ''));
    if (exact) return exact;
    /* A plan often writes `routes.py` or `app/routes.py`; take it only when one file ends that way. */
    const hits = nodes.filter((n) => n.path && (n.path === p || n.path.endsWith(`/${p}`)));
    return hits.length === 1 ? hits[0] : undefined;
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nameOf = (id: string) => byId.get(id)?.label ?? id;

  const seen = new Set<string>();
  const existing: { node: (typeof nodes)[number]; note: string }[] = [];
  const added: { path: string; note: string }[] = [];
  for (const line of planText.split('\n')) {
    for (const m of line.matchAll(PLAN_PATH)) {
      const p = m[1]!;
      const node = resolve(p);
      const key = node?.id ?? p;
      if (seen.has(key)) continue;
      seen.add(key);
      const note = planLineNote(line, p);
      if (node) existing.push({ node, note });
      else if (NEW_FILE_WORD.test(line)) added.push({ path: p, note });
    }
  }
  if (existing.length === 0) return undefined;
  const kept = existing.slice(0, PLAN_ROWS_PER_COLUMN);
  const keptNew = added.slice(0, Math.max(0, PLAN_ROWS_PER_COLUMN - kept.length));

  /* Today, in the scan's words: who this file uses and who uses it. */
  const today = (id: string): string => {
    const uses = new Set<string>();
    const usedBy = new Set<string>();
    for (const e of graph.edges ?? []) {
      if (e.srcId === id && e.dstId !== id) uses.add(nameOf(e.dstId));
      if (e.dstId === id && e.srcId !== id) usedBy.add(nameOf(e.srcId));
    }
    const list = (s: Set<string>) => [...s].slice(0, 2).join(', ') + (s.size > 2 ? ` +${s.size - 2}` : '');
    const parts = [uses.size ? `uses ${list(uses)}` : '', usedBy.size ? `used by ${list(usedBy)}` : ''].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'no scanned connections';
  };
  const base = (p: string) => p.split('/').pop() ?? p;

  const items: SeqChart['items'] = [];
  kept.forEach(({ node }, i) => {
    items.push({ id: `before-${i}`, label: base(node.path ?? node.label), nodeId: node.id, group: 'Before', detail: today(node.id) });
  });
  kept.forEach(({ node, note }, i) => {
    items.push({ id: `after-${i}`, label: base(node.path ?? node.label), nodeId: node.id, group: 'After', detail: note || 'changed by this plan', tone: 'accent' });
  });
  keptNew.forEach(({ path, note }, i) => {
    items.push({ id: `new-${i}`, label: base(path), group: 'After', detail: `new file${note ? `: ${note}` : ''}`, tone: 'good' });
  });
  const newCount = keptNew.length;
  const chart = {
    version: 1 as const,
    kind: 'before-and-after' as const,
    title: 'Before and after this plan',
    caption:
      `Left: the ${kept.length === 1 ? 'file' : `${kept.length} files`} the plan changes, as the scan sees them today. ` +
      `Right: what the plan does to each` + (newCount > 0 ? `, and the ${newCount === 1 ? 'new file' : `${newCount} new files`} it adds.` : '.'),
    items,
    axes: { columns: ['Before', 'After'] },
  };
  const checked = validateChart(chart, new Set(nodes.map((n) => n.id)));
  return checked.ok ? checked.chart : undefined;
}

/**
 * IS THIS CHART A REDRAW OF ONE ALREADY DRAWN THIS TURN?
 *
 * The owner's run 3 put three frames on the canvas for one request. A small
 * model that is bounced, or that simply calls propose_chart again, redraws the
 * same picture with a box renamed or a link added. Same title (ignoring case
 * and punctuation), or at least 60% of the box labels shared, counts as the
 * same picture. Returns the index of the latest such chart, or undefined for a
 * genuinely new one.
 */
const REDRAW_OVERLAP = 0.6;

export function redrawOf(drawn: readonly SeqChart[], next: SeqChart): number | undefined {
  const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const labels = (c: SeqChart) => new Set(c.items.map((i) => norm(i.label)).filter(Boolean));
  const title = norm(next.title);
  const mine = labels(next);
  for (let i = drawn.length - 1; i >= 0; i -= 1) {
    const prev = drawn[i]!;
    if (title !== '' && norm(prev.title) === title) return i;
    const theirs = labels(prev);
    if (mine.size === 0 || theirs.size === 0) continue;
    let shared = 0;
    for (const l of mine) if (theirs.has(l)) shared += 1;
    if (shared / (mine.size + theirs.size - shared) >= REDRAW_OVERLAP) return i;
  }
  return undefined;
}

/**
 * A TEACH TURN THAT STILL HANDS THE WORK BACK GETS A SMALL LESSON FIRST.
 *
 * Of the 11 minicpm5 answers quoted in the owner's chat, 7 taught nothing:
 * a greeting asking what to work on, two stop notes ("I have not written an
 * answer rather than guess at one"), "can you confirm which files", "isn't a
 * valid surface", a leaked `</think>` narration, and "There is no README
 * file". Every one of those turns had read the scan, and most had a chart on
 * screen. The grader bounces the worst of them twice; after that the turn
 * lands as it is, and the learner who asked to be taught is asked a question.
 *
 * So, like the visual, the check-in and the reveal before it, a floor in
 * code: when the turn is a stub or hands the work back, and a chart is on
 * screen, the harness leads with three sentences read off that chart and the
 * scan. The model's own words stay, after it.
 */
const HANDS_BACK = new RegExp(
  [
    String.raw`\bwhat are you working on\b`,
    String.raw`\bonce i know what you (?:need|want)\b`,
    String.raw`\b(?:i )?have not written an answer\b`,
    String.raw`\brather than guess at one\b`,
    String.raw`\bcan you confirm which\b`,
    String.raw`\b(?:isn['’]t|is not) a valid (?:surface|question|request)\b`,
    String.raw`^\s*there is no [\w.-]+(?: file)?\.?\s*$`,
    String.raw`\bwhat would you like (?:me )?to (?:learn|cover|explain|look at|focus on)\b`,
    String.raw`\b(?:tell|let) me (?:know )?(?:what|which) (?:you|part|file|topic)\b`,
  ].join('|'),
  'im',
);

export function handsTheWorkBack(text: string): boolean {
  return HANDS_BACK.test(text.replace(/<\/?think>/g, ' '));
}

export function deriveGroundedLesson(
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  chart: SeqChart | undefined,
): string | undefined {
  if (chart === undefined || chart.items.length < 2) return undefined;
  const item = (id: string) => chart.items.find((i) => i.id === id);
  const links = (chart.links ?? []).filter((l) => item(l.from) !== undefined && item(l.to) !== undefined);
  if (links.length === 0) return undefined;
  /* The same walk the picture pointer takes: from where nothing points in,
     first arrow out of each box, never revisiting one. */
  const hasIncoming = new Set(links.map((l) => l.to));
  const start = chart.items.find((i) => !hasIncoming.has(i.id) && links.some((l) => l.from === i.id))?.id ?? links[0]!.from;
  const walk = [start];
  while (walk.length < 4) {
    const next = links.find((l) => l.from === walk[walk.length - 1] && !walk.includes(l.to));
    if (next === undefined) break;
    walk.push(next.to);
  }
  if (walk.length < 2) return undefined;
  const names = walk.map((id) => `**${item(id)!.label}**`);
  const path =
    names.length === 2
      ? `it starts at ${names[0]} and leads to ${names[1]}`
      : `it starts at ${names[0]}, goes through ${names.slice(1, -1).join(' and ')}, and ends at ${names[names.length - 1]}`;
  /* The arrows are the scan's own only when every hop joins two real nodes and
     the scan has an edge between them, or between files inside them (a service
     box stands for the files it holds, as in deriveWorkedExample). */
  const byId = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const within = (id: string, target: string): boolean => {
    for (let cur: string | undefined = id, hops = 0; cur !== undefined && hops < 8; hops += 1) {
      if (cur === target) return true;
      cur = byId.get(cur)?.parentId;
    }
    return false;
  };
  const grounded =
    graph !== undefined &&
    walk.slice(1).every((id, i) => {
      const from = item(walk[i]!)!.nodeId;
      const to = item(id)!.nodeId;
      return (
        from !== undefined &&
        to !== undefined &&
        (graph.edges ?? []).some((e) => within(e.srcId, from) && within(e.dstId, to))
      );
    });
  const lines = [
    `Here is what the code itself shows, read from the scan. Follow the picture on the canvas: ${path}.` +
      (grounded ? ' Each arrow on that path is a connection the scan found in the code, not a guess.' : ''),
  ];
  const example = deriveWorkedExample(graph, chart);
  if (example !== undefined) lines.push(example);
  return lines.join(' ');
}

/**
 * `keep` leaves every word the model wrote, after the lesson — this file's
 * rule for the check-in and the reveal. `drop` also removes the sentences that
 * hand the work back, and only those: on the 7 hand-backs from the owner's
 * chat, scored with the r5 chart, `keep` moved the mean from 37 to 44 (the
 * scorer still caps a turn that ends by handing back) and `drop` to 62. Which
 * one a learner is better served by is an arm to measure, not a call to make
 * here.
 */
export function withGroundedLesson(
  text: string,
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  chart: SeqChart | undefined,
  stubWords: number,
  mode: 'keep' | 'drop' = 'keep',
): string {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words > stubWords && !handsTheWorkBack(text)) return text;
  const lesson = deriveGroundedLesson(graph, chart);
  if (lesson === undefined) return text;
  const own =
    mode === 'drop'
      ? text
          .split(/\n{2,}/)
          .map((para) =>
            para
              .split(/(?<=[.!?])\s+/)
              .filter((sentence) => !handsTheWorkBack(sentence))
              .join(' ')
              .trim(),
          )
          .filter(Boolean)
          .join('\n\n')
      : text.trim();
  return own === '' ? lesson : `${lesson}\n\n${own}`;
}
