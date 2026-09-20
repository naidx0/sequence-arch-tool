/**
 * The from-scratch DESIGN tree (v8 Phase B2).
 *
 * A user with no repo builds a plain-English system by DRAWING (a connector off a
 * block → a named child) or DESCRIBING (the AI proposes child blocks). The result
 * is a {@link PlainNode} tree — the SAME view-model the attached-repo board
 * renders — but it represents DESIGN INTENT, not a scan.
 *
 * HONESTY BOUNDARY (the project's core credibility rule): a from-scratch tree
 * describes things that DO NOT EXIST YET, so every designed node has:
 *   - an id in the distinct `d:` namespace (never the scan's `p:`/`svc:`/`file:`),
 *     so a designed node can never be mistaken for a detected one; and
 *   - EMPTY `sourceRefs` — there is no real repo to trace to. This is NOT a
 *     violation of "detected structure is real": a design is legitimately
 *     different from a scan, and empty (not fabricated) refs are the honest
 *     encoding of "not built yet". The UI marks the whole board "Design (new
 *     project)". Auto-sort here is DETERMINISTIC (no AI) — the AI only PROPOSES
 *     nodes (server side); the organization is pure code so it works with no key.
 *
 * Everything in this module is PURE: each mutation returns a NEW tree (structural
 * deep clone), never mutating in place — matching the store's immutability. Ids
 * are derived deterministically, so replaying the same operations yields a
 * byte-identical tree.
 */

import type { PlainKind, PlainNode } from './board.js';

/** The id namespace for every designed node — distinct from the scan's `p:`. */
export const DESIGN_ID_PREFIX = 'd:';
/** The root ("the whole app you are designing"). */
export const DESIGN_ROOT_ID = 'd:root';
/**
 * Reserved id prefix for the structural buckets/sub-buckets that
 * {@link autoSortDesign} creates (Frontend / Backend / Data / Services, and
 * sub-buckets like Storing / Matching). The trailing colon is load-bearing: a
 * user block is `d:<slug>` (slug never contains `:`), so a user block can never
 * collide with, or be mistaken for, an auto-sort bucket.
 */
export const DESIGN_BUCKET_PREFIX = 'd:bucket:';

/** Kinds a user (or an AI proposal) may pick for a designed block. `group` is root-only. */
export const DESIGN_KINDS: PlainKind[] = ['area', 'service', 'feature', 'data', 'file'];

/** True when `id` names an auto-sort bucket (not a user-authored block). */
export function isDesignBucket(id: string): boolean {
  return id.startsWith(DESIGN_BUCKET_PREFIX);
}

/** True when `id` is any designed-tree id. */
export function isDesignId(id: string): boolean {
  return id.startsWith(DESIGN_ID_PREFIX);
}

/** A URL/id-safe slug of a human title; never empty, never contains `:`. */
function slug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? 'block' : s;
}

/** Trim + bound a user/AI title; empty falls back to a readable placeholder. */
function cleanTitle(title: string): string {
  const t = (title ?? '').trim().slice(0, 80);
  return t === '' ? 'Untitled block' : t;
}

/** Coerce an arbitrary kind into a legal designed kind (default `feature`). */
function cleanKind(kind: unknown): PlainKind {
  return DESIGN_KINDS.includes(kind as PlainKind) ? (kind as PlainKind) : 'feature';
}

/** A structural deep clone — the basis of the "return a new tree" contract. */
function clone(node: PlainNode): PlainNode {
  return {
    id: node.id,
    title: node.title,
    summary: node.summary,
    kind: node.kind,
    sourceRefs: [...node.sourceRefs],
    children: node.children.map(clone),
    ...(node.edgeRefs ? { edgeRefs: [...node.edgeRefs] } : {}),
  };
}

/** Find a node by id (or undefined). */
export function findDesignNode(root: PlainNode, id: string): PlainNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findDesignNode(c, id);
    if (f) return f;
  }
  return undefined;
}

/** The parent of `id` (or undefined for the root / missing node). */
function findParent(root: PlainNode, id: string): PlainNode | undefined {
  for (const c of root.children) {
    if (c.id === id) return root;
    const f = findParent(c, id);
    if (f) return f;
  }
  return undefined;
}

/** Every id in the tree — for global-uniqueness id derivation. */
function collectIds(root: PlainNode, acc: Set<string> = new Set()): Set<string> {
  acc.add(root.id);
  for (const c of root.children) collectIds(c, acc);
  return acc;
}

/** Is `maybeDescendant` inside `node`'s subtree (inclusive)? (cycle guard for move) */
function isWithin(node: PlainNode, maybeDescendantId: string): boolean {
  return findDesignNode(node, maybeDescendantId) !== undefined;
}

/**
 * Derive a stable, tree-unique id from a title. The slug makes it deterministic
 * and readable; the `-2`/`-3` suffix (against ALL existing ids) guarantees it is
 * unique among siblings AND globally — {@link buildBoardModel} keys nodes by id,
 * so tree-wide uniqueness is required, not just per-parent.
 */
function deriveId(existing: Set<string>, title: string): string {
  const base = slug(title);
  let id = DESIGN_ID_PREFIX + base;
  if (!existing.has(id)) return id;
  let i = 2;
  while (existing.has(`${DESIGN_ID_PREFIX}${base}-${i}`)) i++;
  return `${DESIGN_ID_PREFIX}${base}-${i}`;
}

/** A brand-new design: one editable root block titled with the repo name. */
export function newDesign(repoName: string): PlainNode {
  return {
    id: DESIGN_ROOT_ID,
    title: cleanTitle(repoName || 'my-project'),
    summary: 'A new project you are designing — nothing is built yet.',
    kind: 'group',
    children: [],
    sourceRefs: [],
  };
}

/**
 * Add a child block under `parentId`. Returns a NEW tree plus the new node's id
 * (deterministically derived, unique in the tree). A missing parent is a no-op
 * that returns the (cloned) tree unchanged and an empty id.
 */
export function addDesignChild(
  root: PlainNode,
  parentId: string,
  spec: { title: string; kind: PlainKind }
): { root: PlainNode; id: string } {
  const next = clone(root);
  const parent = findDesignNode(next, parentId);
  if (!parent) return { root: next, id: '' };
  const id = deriveId(collectIds(next), spec.title);
  parent.children.push({
    id,
    title: cleanTitle(spec.title),
    kind: cleanKind(spec.kind),
    children: [],
    sourceRefs: [], // designed nodes never trace to a real repo — honest, not fabricated
  });
  return { root: next, id };
}

/** Rename a block (id stays STABLE so expansion state survives). New tree returned. */
export function renameDesignNode(root: PlainNode, id: string, title: string): PlainNode {
  const next = clone(root);
  const node = findDesignNode(next, id);
  if (node) node.title = cleanTitle(title);
  return next;
}

/** Remove a block and its whole subtree. The root is never removable. New tree returned. */
export function removeDesignNode(root: PlainNode, id: string): PlainNode {
  const next = clone(root);
  if (id === next.id) return next;
  const parent = findParent(next, id);
  if (parent) parent.children = parent.children.filter((c) => c.id !== id);
  return next;
}

/**
 * Reparent `id` under `newParentId` (the connect/reparent op). No-op (returns the
 * cloned tree unchanged) when moving the root, onto itself, onto a node that does
 * not exist, or into its OWN subtree (which would create a cycle). New tree returned.
 */
export function moveDesignNode(root: PlainNode, id: string, newParentId: string): PlainNode {
  const next = clone(root);
  if (id === next.id || id === newParentId) return next;
  const node = findDesignNode(next, id);
  const newParent = findDesignNode(next, newParentId);
  const oldParent = findParent(next, id);
  if (!node || !newParent || !oldParent) return next;
  if (isWithin(node, newParentId)) return next; // cycle guard
  oldParent.children = oldParent.children.filter((c) => c.id !== id);
  newParent.children.push(node);
  return next;
}

/* ===================================================== deterministic sort === */

type Bucket = 'frontend' | 'backend' | 'data' | 'services';

/** The fixed top-bucket order — the plain-English max-organization scheme. */
const BUCKET_ORDER: Bucket[] = ['frontend', 'backend', 'data', 'services'];

const BUCKET_TITLE: Record<Bucket, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  data: 'Data',
  services: 'Services',
};

const BUCKET_SUMMARY: Record<Bucket, string> = {
  frontend: 'The parts people see and interact with.',
  backend: 'The services that do the work behind the scenes.',
  data: 'Where information is stored and passed around.',
  services: 'Supporting services and integrations.',
};

/**
 * Classify a block into a top bucket (and an optional named sub-bucket) purely
 * from its title/kind. Sub-buckets honour the brief's "storing / matching"
 * sub-services. Because classification depends ONLY on the node itself (never its
 * current position), re-sorting an already-sorted tree yields the same result —
 * the property {@link autoSortDesign} relies on for idempotence.
 */
export function classifyDesignNode(node: PlainNode): { bucket: Bucket; sub?: string } {
  const hay = node.title.toLowerCase();

  // 1. Named sub-services first (they read as Services regardless of nouns below).
  if (/\bmatch(ing|er|es)?\b/.test(hay)) return { bucket: 'services', sub: 'Matching' };
  if (/\bstoring\b/.test(hay)) return { bucket: 'services', sub: 'Storing' };

  // 2. Data (also any node the user explicitly typed as data).
  if (node.kind === 'data') return { bucket: 'data' };
  if (
    /\b(database|db|postgres|postgresql|mysql|mariadb|sqlite|mongo|mongodb|dynamo|redis|memcached|cache|storage|store|datastore|data\s*store|queue|kafka|rabbit|topic|table|bucket|s3|warehouse|data)\b/.test(
      hay
    )
  ) {
    return { bucket: 'data' };
  }

  // 3. Frontend.
  if (
    /\b(frontend|front-end|ui|web|website|webapp|client|site|page|pages|dashboard|portal|storefront|mobile|app|ios|android|screen|view|form|button|login|signup|landing|menu)\b/.test(
      hay
    )
  ) {
    return { bucket: 'frontend' };
  }

  // 4. Backend.
  if (
    /\b(backend|back-end|api|server|endpoint|controller|route|routes|auth|authentication|authorization|gateway|middleware|worker|job|cron|scheduler|processor|pipeline|handler|logic|core|ingest)\b/.test(
      hay
    )
  ) {
    return { bucket: 'backend' };
  }

  // 5. Everything else is a supporting service.
  return { bucket: 'services' };
}

/** Stable order within a group: by title, then id — neither changes across sorts. */
function stableCmp(a: PlainNode, b: PlainNode): number {
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Deterministically reorganize the design into the plain-English
 * max-organization scheme: App → Frontend / Backend / Data / Services (with
 * Storing / Matching sub-buckets where titles indicate). User blocks keep their
 * OWN authored subtrees; only the top organization is rewritten.
 *
 * IDEMPOTENT: sorting an already-sorted tree returns a byte-identical tree. This
 * holds because (a) the set of user blocks is recovered exactly by unwrapping the
 * bucket scaffolding, (b) each block's bucket is a pure function of the block, and
 * (c) buckets/sub-buckets/items are emitted in a fixed, content-derived order. No
 * AI — it works with no key and is unit-testable.
 */
export function autoSortDesign(root: PlainNode): PlainNode {
  const next = clone(root);

  // Collect user blocks: walk down through bucket scaffolding, but treat any
  // non-bucket node as a whole ITEM (keep its subtree; do not descend further).
  const items: PlainNode[] = [];
  const collect = (n: PlainNode): void => {
    for (const c of n.children) {
      if (isDesignBucket(c.id)) collect(c);
      else items.push(c);
    }
  };
  collect(next);

  const empty = (): { direct: PlainNode[]; subs: Map<string, PlainNode[]> } => ({
    direct: [],
    subs: new Map(),
  });
  const byBucket: Record<Bucket, { direct: PlainNode[]; subs: Map<string, PlainNode[]> }> = {
    frontend: empty(),
    backend: empty(),
    data: empty(),
    services: empty(),
  };

  for (const it of items) {
    const { bucket, sub } = classifyDesignNode(it);
    const slot = byBucket[bucket];
    if (sub) {
      const arr = slot.subs.get(sub) ?? [];
      arr.push(it);
      slot.subs.set(sub, arr);
    } else {
      slot.direct.push(it);
    }
  }

  const children: PlainNode[] = [];
  for (const b of BUCKET_ORDER) {
    const slot = byBucket[b];
    const kids: PlainNode[] = [];
    // Sub-buckets first, in a fixed (title-sorted) order.
    for (const sub of [...slot.subs.keys()].sort()) {
      const subItems = slot.subs.get(sub)!.slice().sort(stableCmp);
      kids.push({
        id: `${DESIGN_BUCKET_PREFIX}${b}/${slug(sub)}`,
        title: sub,
        summary: `${sub} — grouped automatically.`,
        kind: 'area',
        children: subItems,
        sourceRefs: [],
      });
    }
    kids.push(...slot.direct.slice().sort(stableCmp));
    if (kids.length === 0) continue; // never emit an empty bucket
    children.push({
      id: `${DESIGN_BUCKET_PREFIX}${b}`,
      title: BUCKET_TITLE[b],
      summary: BUCKET_SUMMARY[b],
      kind: 'area',
      children: kids,
      sourceRefs: [],
    });
  }

  next.children = children;
  return next;
}
