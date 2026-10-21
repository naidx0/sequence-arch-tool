/**
 * THE AUTO SEED — the harness places a grounded frame on the board before the
 * model speaks (carrying-harness plan, wave B4).
 *
 * "Auto setup" was defined in that plan for the first time: the harness seeds,
 * places and re-flows the canvas without the model inventing coordinates. This
 * is the seeding half. On a board-bound ask with a repository attached, the
 * services in the ask's scope and the edges between them — from the SCAN,
 * never from the model — are laid out by the deterministic lane layout and
 * emitted as cards and arrows before round one. The model then annotates and
 * patches BY ID instead of starting from an empty pad and guessing positions,
 * which is the failure the owner walk measured: a small model asked to "draw
 * how the gateway talks to orders" drew four boxes at the origin.
 *
 * ── WHAT IS SEEDED IS EXACTLY WHAT THE GRAPH KNOWS ──────────────────────────
 *
 * Every card carries a `nodeId` the scan produced and every arrow joins two
 * such cards. Nothing here reads the model's words; the scope comes from the
 * intent's subject node, the services the question names, or — when neither
 * names one — the most connected services. The grounding law on the pad (B5)
 * is met by construction because the harness never invents a card.
 *
 * ── IDS ARE DETERMINISTIC, SO A SECOND ASK DOES NOT DOUBLE-DRAW ─────────────
 *
 * `seed:<service id>` for a card and `seed:<from>>><to>` for an arrow. The
 * caller passes what the board already holds, and a board that already carries
 * a seed for this scope gets nothing — the reader's arrangement of the first
 * seed is theirs, and re-seeding on every follow-up would pile a second copy
 * under the first.
 *
 * Pure: takes the digest and the known items, returns items and a note. The
 * pipeline emits the items and puts the note in the evidence ledger.
 */

import type { Digest } from '../explain/explain.js';
import { layoutSystemBoard } from './diagramLayout.js';
import type { BoardItem, BoardKnownItem } from './boardTools.js';

/** Cards past this count stop being a frame the reader can take in. */
export const SEED_MAX_SERVICES = 8;

/** Every seeded id starts with this, and nothing else on the board may. */
export const SEED_ID_PREFIX = 'seed:';

export interface BoardSeedInput {
  digest: Digest;
  question: string;
  /** The intent's subject node, when a chip named one. */
  subjectNodeId?: string | undefined;
  /** What the board already holds — a seed already there means no seed now. */
  known: readonly BoardKnownItem[];
}

export interface BoardSeed {
  items: BoardItem[];
  /** One ledger paragraph naming every seeded id, so the model can patch by id. */
  note: string;
  /** The service ids that were seeded, in layout order. */
  serviceIds: string[];
}

interface ServiceEdge {
  from: string;
  to: string;
  kind: string;
  count: number;
}

/** Which service a digest endpoint belongs to: itself, or the service holding the file. */
function ownerOf(digest: Digest, endpointId: string): string | null {
  if (digest.services.some((s) => s.id === endpointId)) return endpointId;
  for (const s of digest.services) {
    if (s.files.some((f) => f.id === endpointId)) return s.id;
    if (s.modules.some((m) => m.id === endpointId || m.fileIds.includes(endpointId))) return s.id;
  }
  if (endpointId.startsWith('file:')) {
    const rel = endpointId.slice(5).replace(/\\/g, '/');
    for (const s of digest.services) {
      const dir = (s.dir ?? '').replace(/\\/g, '/');
      if (dir && (rel === dir || rel.startsWith(`${dir}/`))) return s.id;
    }
  }
  return null;
}

/**
 * Service-to-service edges. `digest.serviceEdges` when the indexer rolled them
 * up; otherwise the same roll-up over the file-level edges, here, so a digest
 * built without the indexer still seeds arrows.
 */
function serviceEdges(digest: Digest): ServiceEdge[] {
  if (digest.serviceEdges && digest.serviceEdges.length > 0) return digest.serviceEdges;
  const rollup = new Map<string, ServiceEdge>();
  for (const e of digest.edges) {
    const from = ownerOf(digest, e.from);
    const to = ownerOf(digest, e.to);
    if (!from || !to || from === to) continue;
    /* The pair as a key, the way `explain.ts` keys its own roll-up: one
       escaped string, no separator byte that could appear in an id. */
    const key = JSON.stringify([from, to]);
    const hit = rollup.get(key);
    if (hit) hit.count += 1;
    else rollup.set(key, { from, to, kind: e.kind, count: 1 });
  }
  return [...rollup.values()];
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((w) => w.replace(/^[./-]+|[./-]+$/g, ''))
    .filter((w) => w.length >= 3);
}

/** The services the question names — by name, id tail or directory, whole words only. */
function servicesNamedIn(digest: Digest, question: string): string[] {
  const asked = new Set(words(question));
  const hits: string[] = [];
  for (const s of digest.services) {
    const names = [s.name, s.id.split(/[:/]/).pop() ?? '', (s.dir ?? '').split('/').pop() ?? '']
      .map((n) => n.toLowerCase())
      .filter((n) => n.length >= 3);
    if (names.some((n) => asked.has(n))) hits.push(s.id);
  }
  return hits;
}

/**
 * THE SCOPE: the named services and their neighbours, capped; or the most
 * connected services when nothing was named. Order is deterministic (named
 * first, then by degree, then by id) so the same ask seeds the same frame.
 */
function scopeServices(digest: Digest, edges: ServiceEdge[], input: BoardSeedInput): string[] {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + e.count);
    degree.set(e.to, (degree.get(e.to) ?? 0) + e.count);
  }
  const byDegree = (a: string, b: string): number =>
    (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b);

  const named: string[] = [];
  const subject = input.subjectNodeId ? ownerOf(digest, input.subjectNodeId) : null;
  if (subject) named.push(subject);
  for (const id of servicesNamedIn(digest, input.question)) {
    if (!named.includes(id)) named.push(id);
  }

  const chosen: string[] = [...named];
  if (named.length > 0) {
    const neighbours = new Set<string>();
    for (const e of edges) {
      if (named.includes(e.from) && !named.includes(e.to)) neighbours.add(e.to);
      if (named.includes(e.to) && !named.includes(e.from)) neighbours.add(e.from);
    }
    for (const id of [...neighbours].sort(byDegree)) {
      if (chosen.length >= SEED_MAX_SERVICES) break;
      chosen.push(id);
    }
    return chosen;
  }
  return digest.services
    .map((s) => s.id)
    .sort(byDegree)
    .slice(0, SEED_MAX_SERVICES);
}

/**
 * Build the seed, or null when there is nothing honest to seed: no services,
 * or a seed already on the board.
 */
export function seedBoardFromDigest(input: BoardSeedInput): BoardSeed | null {
  if (input.known.some((k) => k.id.startsWith(SEED_ID_PREFIX))) return null;
  const edges = serviceEdges(input.digest);
  const ids = scopeServices(input.digest, edges, input);
  if (ids.length === 0) return null;
  const chosen = new Set(ids);
  const labelOf = new Map(input.digest.services.map((s) => [s.id, s.name] as const));

  /* The lane layout takes the SystemBoard IR; one untracked lane is a row of
     cards in id order, which is the deterministic geometry B3 will re-flow. */
  const layout = layoutSystemBoard({
    layoutProfile: 'lane',
    nodes: ids.map((id) => ({ id, role: 'component', label: labelOf.get(id) ?? id })),
    edges: [],
    issues: [],
  });

  /* Below whatever is already on the board, so a seed never lands on the
     reader's marks. Everything known sits at `at`; a stroke without one is
     treated as at the origin, which is where the pad starts anyway. */
  const knownBottom = input.known.reduce((m, k) => Math.max(m, k.at?.y ?? 0), 0);
  const dy = knownBottom > 0 ? knownBottom + 120 : 0;

  const items: BoardItem[] = [];
  const at = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const id of ids) {
    const n = layout.nodes[id];
    if (!n) continue;
    const pos = { x: n.at.x, y: n.at.y + dy, w: n.w, h: n.h };
    at.set(id, pos);
    items.push({
      kind: 'noderef',
      id: `${SEED_ID_PREFIX}${id}`,
      at: { x: pos.x, y: pos.y },
      nodeId: id,
      label: (labelOf.get(id) ?? id).slice(0, 80),
    });
  }
  const arrows: string[] = [];
  for (const e of [...edges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))) {
    if (!chosen.has(e.from) || !chosen.has(e.to)) continue;
    const from = at.get(e.from);
    const to = at.get(e.to);
    if (!from || !to) continue;
    const leftToRight = from.x <= to.x;
    items.push({
      kind: 'shape',
      id: `${SEED_ID_PREFIX}${e.from}>>${e.to}`,
      shape: 'arrow',
      from: { x: leftToRight ? from.x + from.w : from.x, y: from.y + Math.floor(from.h / 2) },
      to: { x: leftToRight ? to.x : to.x + to.w, y: to.y + Math.floor(to.h / 2) },
    });
    arrows.push(`${labelOf.get(e.from) ?? e.from} → ${labelOf.get(e.to) ?? e.to} (${e.kind}, ${e.count})`);
  }

  const note = [
    '### harness seed (board)',
    `Before this turn the harness placed ${ids.length} card${ids.length === 1 ? '' : 's'} from the scan ` +
      'on the board, one per service in scope, and the edges between them. They are real nodes; ' +
      'annotate or connect them BY ID rather than drawing them again:',
    ...ids.map((id) => `- ${SEED_ID_PREFIX}${id} — ${labelOf.get(id) ?? id} (nodeId ${id})`),
    ...(arrows.length > 0 ? [`Edges drawn: ${arrows.join('; ')}.`] : ['No edges between these in the scan.']),
  ].join('\n');

  return { items, note, serviceIds: ids };
}
