/**
 * Mermaid projections: a `sequenceDiagram` of service-level interactions and a
 * C4-ish `flowchart TD` grouped by node kind. Both reuse the shared projection
 * in project.ts (never re-derive service-level edges here).
 */
import type { ArchGraph, ArchEdge } from '@sequence/schema';
import {
  projectEdges,
  participantKinds,
  orderParticipants,
  orderEdgesByFlow,
  buildLift,
  kindFamily,
  edgeLabel,
  type LiftedKind,
  type ProjectedEdge,
} from './project.js';

/**
 * A Mermaid-safe actor / node id: every char outside [A-Za-z0-9_] becomes `_`.
 * This is what makes a topic label like `topic:ticket.created` — which carries a
 * colon (the sequence message separator) and dots — safe to use as an actor in
 * an arrow. The real label is preserved as the display alias.
 */
export function actorToken(label: string): string {
  const t = label.replace(/[^A-Za-z0-9_]/g, '_');
  // an id must not start with a digit in some Mermaid parsers
  return /^[0-9]/.test(t) ? `n_${t}` : t;
}

/**
 * Strip / replace characters that would break a single-line Mermaid message or
 * `participant … as …` alias:
 *  - a raw newline would split one statement into two lines
 *  - `|` is a Mermaid delimiter (loop/alt condition text)
 *  - `;` terminates a statement exactly like a newline does, so a label
 *    carrying one (a compound value, a stray semicolon in a path) would
 *    otherwise leave a dangling second statement the parser chokes on
 */
function sanitizeInline(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '/')
    .replace(/;/g, ',')
    .trim();
}

/**
 * Flowchart node display text: first run the SAME inline sanitizer as message
 * labels (a raw newline in a scan-mode label would otherwise break the
 * single-line node declaration), then escape quotes for the quoted `"..."` form.
 */
function nodeText(label: string): string {
  return sanitizeInline(label).replace(/"/g, '&quot;');
}

/**
 * Self-referential service-level edges: both endpoints lift to the SAME
 * label (a service calling one of its own endpoints, e.g. an internal
 * webhook or health-check loop). `projectEdges` drops these — score.ts does
 * the same, and the two must never disagree (see project.ts's anti-drift
 * note) — because a self-loop is noise on a flow/matrix diagram. A sequence
 * diagram is exactly the place a self-call belongs: Mermaid renders `A->>A:`
 * as the standard self-message loop-back. Computed independently, straight
 * off the raw graph, so `projectEdges` and the flow/matrix exports it feeds
 * stay byte-for-byte unchanged.
 */
function selfEdges(graph: ArchGraph): ProjectedEdge[] {
  const lift = buildLift(graph);
  const acc = new Map<string, ProjectedEdge & { _labels: Set<string> }>();
  for (const e of graph.edges) {
    if (e.kind === 'import') continue;
    const src = lift(e.srcId);
    const dst = lift(e.dstId);
    if (!src || !dst || src.label !== dst.label) continue;
    const family = kindFamily(e.kind);
    const key = `${src.label} [self:${family}]`;
    let pe = acc.get(key);
    if (!pe) {
      pe = { src: src.label, dst: dst.label, srcKind: src.kind, dstKind: dst.kind, family, labels: [], _labels: new Set<string>() };
      acc.set(key, pe);
    }
    const lbl = edgeLabel(e);
    if (lbl) pe._labels.add(lbl);
  }
  return [...acc.values()]
    .map(({ _labels, ...pe }) => ({ ...pe, labels: [..._labels].sort() }))
    .sort((a, b) => a.src.localeCompare(b.src) || a.family.localeCompare(b.family));
}

/**
 * Cycle-guarded longest-path call depth from the real entry points (a
 * participant with no inbound edge at all): depth 0 = entry, and every edge
 * pushes its target one column deeper than its source — when two paths
 * disagree the LONGEST wins, so a participant is never placed before every
 * one of its callers has appeared. Bounded to `participants + 1` relaxation
 * passes so a genuine cycle (A calls B calls A) terminates instead of
 * looping forever — the same cycle-guard
 * `packages/web/src/graph/interiorFlow.ts` uses for the interior flow view.
 * Self-edges are excluded from relaxation: a self-call cannot push its own
 * participant deeper than it already is.
 */
function callDepth(edges: readonly ProjectedEdge[]): Map<string, number> {
  const participants = new Set<string>();
  for (const e of edges) {
    participants.add(e.src);
    participants.add(e.dst);
  }
  const depth = new Map<string, number>();
  for (const p of participants) depth.set(p, 0);
  const relevant = edges.filter((e) => e.src !== e.dst);
  const guardPasses = participants.size + 1;
  for (let i = 0; i < guardPasses; i++) {
    let changed = false;
    for (const e of relevant) {
      const next = (depth.get(e.src) ?? 0) + 1;
      if (next > (depth.get(e.dst) ?? 0)) {
        depth.set(e.dst, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

/**
 * Participant reading order for the sequence diagram STORY: shallowest call
 * depth first (the real entry points at the top), ties broken alphabetically.
 * Deliberately separate from `orderParticipants` in project.ts, which stays
 * the shared two-bucket order the flow chart and dependency matrix use — this
 * function only affects `mermaidSequence`'s own output.
 */
function orderParticipantsByDepth(edges: readonly ProjectedEdge[]): string[] {
  const depth = callDepth(edges);
  return [...depth.keys()].sort((a, b) => (depth.get(a)! - depth.get(b)!) || a.localeCompare(b));
}

/**
 * Assign every participant a UNIQUE Mermaid actor token. Two distinct labels
 * can tokenize to the same id — `order.created` and `order-created` both
 * become `order_created` under `actorToken` — and left alone that produces
 * two colliding `participant` declarations, with every arrow silently
 * pointing at whichever one Mermaid happens to keep. Collisions get a
 * deterministic numeric suffix in participant order.
 */
function assignTokens(order: readonly string[]): Map<string, string> {
  const seen = new Map<string, number>();
  const tokenOf = new Map<string, string>();
  for (const label of order) {
    const base = actorToken(label) || 'p';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    tokenOf.set(label, n === 1 ? base : `${base}_${n}`);
  }
  return tokenOf;
}

/**
 * A sequence diagram with hundreds of arrows is noise, not a story — cap the
 * message count and say so honestly in a leading Mermaid comment rather than
 * silently dropping the tail. 40 is generous enough to show a real multi-hop
 * chain end to end on a typical service map while still fitting a doc page.
 */
const MAX_MESSAGES = 40;

/** No fabricated content: state emptiness rather than emitting a bare, silent header. */
const EMPTY_COMMENT = '%% no service-level interactions found in this scan';

function capComment(shown: number, total: number, entryLabels: readonly string[]): string {
  const who = entryLabels.length > 0 ? ` — closest to entry: ${entryLabels.join(', ')}` : '';
  return `%% ${shown} of ${total} calls shown${who}`;
}

/**
 * Mermaid `sequenceDiagram`. Participants are the lifted services / datastores
 * / topics, ordered by real call depth from the entry point(s) — the actual
 * story order, not scan order or a flat alphabetical list. Self-calls (a
 * service invoking its own endpoint) render as a Mermaid self-message rather
 * than being silently dropped. Past `MAX_MESSAGES`, the diagram is capped to
 * the messages closest to the entry point and a leading `%%` comment states
 * exactly how many of how many are shown — never a silent truncation. All
 * actors are tokenized (and de-duplicated) so colons/dots/collisions in
 * labels can never break the syntax; the real label rides along as the
 * participant alias.
 */
export function mermaidSequence(graph: ArchGraph): string {
  const allEdges = [...projectEdges(graph), ...selfEdges(graph)];
  const lines: string[] = ['sequenceDiagram'];

  if (allEdges.length === 0) {
    lines.push(`    ${EMPTY_COMMENT}`);
    return lines.join('\n') + '\n';
  }

  const order = orderParticipantsByDepth(allEdges);
  const depth = callDepth(allEdges);
  const allMessages = orderEdgesByFlow(allEdges, order);

  const total = allMessages.length;
  const capped = total > MAX_MESSAGES;
  const shownMessages = capped ? allMessages.slice(0, MAX_MESSAGES) : allMessages;

  const usedLabels = new Set<string>();
  for (const m of shownMessages) {
    usedLabels.add(m.src);
    usedLabels.add(m.dst);
  }
  const shownOrder = order.filter((p) => usedLabels.has(p));

  if (capped) {
    const entryLabels = shownOrder.filter((p) => depth.get(p) === 0);
    lines.push(`    ${capComment(shownMessages.length, total, entryLabels)}`);
  }

  const tokenOf = assignTokens(shownOrder);
  for (const p of shownOrder) {
    const token = tokenOf.get(p)!;
    // The alias is free-form display text (an unconstrained scan-mode label),
    // so sanitize it the same way message labels are — a raw newline or `;`
    // would otherwise break the single-line `participant X as ...` declaration.
    lines.push(token === p ? `    participant ${token}` : `    participant ${token} as ${sanitizeInline(p)}`);
  }
  for (const e of shownMessages) {
    const label = sanitizeInline(e.labels.join(', ') || e.family);
    lines.push(`    ${tokenOf.get(e.src)}->>${tokenOf.get(e.dst)}: ${label}`);
  }
  return lines.join('\n') + '\n';
}

const GROUPS: { title: string; kind: LiftedKind }[] = [
  { title: 'Services', kind: 'service' },
  { title: 'Datastores', kind: 'datastore' },
  { title: 'Topics', kind: 'topic' },
];

/** Kind-based link colours (C4-ish typing of the arrows). */
function linkColor(family: string): string {
  switch (family) {
    case 'http':
      return '#2f6fdb';
    case 'grpc':
      return '#7b53c9';
    case 'queue_publish':
    case 'queue_consume':
      return '#d98a2b';
    case 'db_access':
      return '#2e9e5b';
    default:
      return '#888888';
  }
}

/** Shape a flowchart node by its lifted kind: rectangle / cylinder / hexagon. */
function nodeDecl(label: string, kind: LiftedKind): string {
  const id = actorToken(label);
  const t = nodeText(label);
  if (kind === 'datastore') return `${id}[("${t}")]`;
  if (kind === 'topic') return `${id}{{"${t}"}}`;
  return `${id}["${t}"]`;
}

/**
 * Mermaid `flowchart TD`, C4-ish: one subgraph per kind grouping (Services /
 * Datastores / Topics), one typed arrow per distinct service-level edge, and a
 * `linkStyle` per link coloured by kind family.
 */
export function mermaidFlow(graph: ArchGraph): string {
  const edges = projectEdges(graph);
  const order = orderParticipants(edges);
  const kinds = participantKinds(edges);
  const lines: string[] = ['flowchart TD'];
  for (const g of GROUPS) {
    const members = order.filter((p) => kinds.get(p) === g.kind);
    if (members.length === 0) continue;
    lines.push(`    subgraph ${g.title}`);
    for (const p of members) lines.push(`        ${nodeDecl(p, g.kind)}`);
    lines.push('    end');
  }
  const flowEdges = orderEdgesByFlow(edges, order);
  const styles: string[] = [];
  flowEdges.forEach((e, i) => {
    const label = sanitizeInline(e.labels.join(', ') || e.family);
    lines.push(`    ${actorToken(e.src)} -->|${label}| ${actorToken(e.dst)}`);
    styles.push(`    linkStyle ${i} stroke:${linkColor(e.family)},stroke-width:2px;`);
  });
  lines.push(...styles);
  return lines.join('\n') + '\n';
}
