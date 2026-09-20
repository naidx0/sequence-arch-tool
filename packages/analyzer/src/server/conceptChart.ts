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
import type { ArchGraph } from '@sequence/schema';
import { validateChart, type SeqChart } from '@sequence/schema';

import type { Concept } from './lessonState.js';

/** How many neighbours a concept chart shows before it stops being readable. */
const MAX_NEIGHBOURS = 4;

/** How far left a label may reach for uniqueness before it stops being a name. */
const MAX_LABEL_SEGMENTS = 3;

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
  const candidates: { otherId: string; outgoing: boolean }[] = [];
  const found = new Set<string>([focus.id]);
  for (const edge of graph.edges ?? []) {
    const outgoing = edge.srcId === focus.id;
    const incoming = edge.dstId === focus.id;
    if (!outgoing && !incoming) continue;
    const otherId = outgoing ? edge.dstId : edge.srcId;
    if (found.has(otherId) || !byId.has(otherId)) continue;
    found.add(otherId);
    candidates.push({ otherId, outgoing });
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

  const links = picked.map(({ otherId, outgoing }) =>
    outgoing ? { from: focus.id, to: otherId } : { from: otherId, to: focus.id },
  );
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
    caption: `${focus.label ?? focus.id} and what it connects to, from the scanned graph.`,
    items,
    links,
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
