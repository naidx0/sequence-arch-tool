import type { ArchGraph, ArchNode, EdgeKind, NodeKind } from './index.js';
import { INTERACTION_DST_KINDS, INTERACTION_SRC_KINDS } from './index.js';

/**
 * Placement checker (v8 Phase C) — "draw = design = code" on one surface.
 *
 * When a user draws/adds a new node off a card on the plain board, this module
 * answers two deterministic questions BEFORE any file is created:
 *
 *   1. {@link inferPlacement} — "given the parent I'm drawing off, what should
 *      the new file BE?": its {@link NodeKind}, its language, and a sensible
 *      repo-relative path. The language/kind are inferred from context (the
 *      parent's `meta.language`, the parent's existing child-file extensions, an
 *      explicit extension in the label, and the parent kind), never guessed by an
 *      AI — so "the AI infers the language" is actually a DETERMINISTIC structural
 *      inference the user can inspect and edit.
 *
 *   2. {@link checkPlacement} — "does this new node belong here?": a list of
 *      {@link PlacementWarning}s ("this probably doesn't belong here — consider
 *      X"). It is ADVISORY, not a hard block: the surface warns and lets the user
 *      proceed or accept the suggestion, matching how the product treats design
 *      intent. An empty list ⇒ the placement looks fine.
 *
 * This is the SIBLING of {@link checkScaffoldability}: a pure, side-effect-free,
 * Node-free structural function (no fs, no process) that runs unchanged in the
 * browser (the board imports it) AND is covered by this package's `node:test`
 * suite. It never mutates the graph. It builds ON the schema's containment and
 * interaction rules ({@link INTERACTION_SRC_KINDS} / {@link INTERACTION_DST_KINDS})
 * rather than re-deriving them, so it can never disagree with `validateGraph`.
 *
 * The rules, each producing a distinct warning `code`:
 *
 *  (a) 'language-mismatch' — the new file's language differs from the code
 *      container it lands in (a `py` file under a `ts` service, etc). Fires only
 *      when the container is a `service`/`module` whose language is determinable
 *      AND the proposal's language is known AND they differ. Suggestion: use the
 *      container's language, or add a new sibling service for the other language.
 *
 *  (b) 'containment' — the new node's KIND cannot legally live under the chosen
 *      parent's kind (a `service` under a `datastore`/`topic`/`file`, a
 *      `datastore` under a `service`, a `file`/`module` under a `datastore` or
 *      `topic`, a `topic` outside a broker, …). Uses {@link ALLOWED_PARENT_KINDS}.
 *      Suggestion: names the legal parent kinds and points at the nearest suitable
 *      ancestor (or the repo root).
 *
 *  (c) 'illegal-connection' — when the draw ALSO implies an interaction edge
 *      (`proposal.edge = { fromId, kind }`, i.e. a connector drawn from an
 *      existing node into the new one), the (src-kind, dst-kind) pair is rejected
 *      by the schema's interaction whitelist: an edge originating from a non-code
 *      node (a `datastore`/`topic` can't call out), or targeting a kind not
 *      allowed for that edge kind (`http` → a `datastore`, `db_*` → a `service`,
 *      …). `import` edges are exempt (absent from the whitelist), exactly as in
 *      `validateGraph`. Suggestion: the legal source/target kinds for that edge.
 *
 *  (d) 'path-collision' — the inferred/target path already exists as a node in
 *      the graph (a `path` on any node, or the `file:<path>` id convention).
 *      Suggestion: pick a different name.
 *
 * Determinism: {@link inferPlacement} is a pure function of (graph, parentId,
 * label) and {@link checkPlacement} of (graph, proposal); replaying the same
 * inputs yields byte-identical output. Robust on malformed input: a missing
 * parent/endpoint simply skips the rules that need it (never throws), since
 * `validateGraph` already reports dangling ids.
 */

/** The result of inferring what a new child under a parent should be. */
export interface Placement {
  kind: NodeKind;
  /** Canonical language token ('ts' | 'js' | 'py' | 'go' | 'java' | …), when determinable. */
  language?: string;
  /** A deterministic, repo-relative suggested path for the new file. */
  suggestedPath: string;
}

/** A proposed new node the board is about to create (before it is written). */
export interface PlacementProposal {
  /** The containment parent's ArchGraph node id (a file's parent should be its service). */
  parentId: string;
  kind: NodeKind;
  /** The human label / filename the user typed. */
  label: string;
  /** Explicit language override (else inferred). */
  language?: string;
  /** Explicit path override (else the inferred suggestedPath). */
  path?: string;
  /**
   * An OPTIONAL implied interaction edge: the user drew a connector FROM an
   * existing node (`fromId`) INTO the new node. When present, the (src,dst) kind
   * legality is checked against the schema's interaction whitelist.
   */
  edge?: { fromId: string; kind: EdgeKind };
}

export interface PlacementWarning {
  code: 'language-mismatch' | 'containment' | 'illegal-connection' | 'path-collision';
  /** Plain-English "this probably doesn't belong here" message. */
  message: string;
  /** The concrete "consider X" advice. */
  suggestion: string;
}

/**
 * The code container a new file physically lands in, given a chosen parent. A
 * file cannot contain a file, so drawing off a FILE card places the sibling in
 * that file's own container (its parent service/module).
 */
const CONTAINER_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(['service', 'module']);

/**
 * The node kinds a given child kind may legally sit UNDER. Deliberately
 * permissive where real scan graphs are permissive (a `topic` may sit under its
 * broker datastore OR, in the scanner's dynamic-topic fallback, directly under
 * the repo), and strict on the nonsensical cases the checker exists to catch.
 * `repo` has no legal parent (it is always the root).
 */
export const ALLOWED_PARENT_KINDS: Record<NodeKind, readonly NodeKind[]> = {
  repo: [],
  service: ['repo', 'service'],
  datastore: ['repo'],
  topic: ['datastore', 'repo'],
  module: ['repo', 'service', 'module'],
  file: ['repo', 'service', 'module'],
};

/** Extension → canonical language token (mirrors the scanner's LANG_BY_EXT, plus extras). */
const LANG_BY_EXT: Record<string, string> = {
  ts: 'ts',
  tsx: 'ts',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  py: 'py',
  go: 'go',
  java: 'java',
  rb: 'rb',
  rs: 'rs',
  php: 'php',
  cs: 'cs',
};

/** Canonical language token → the extension a new file of that language gets. */
const EXT_BY_LANG: Record<string, string> = {
  ts: '.ts',
  js: '.js',
  py: '.py',
  go: '.go',
  java: '.java',
  rb: '.rb',
  rs: '.rs',
  php: '.php',
  cs: '.cs',
};

/** Human/alias language spellings → the canonical token used everywhere here. */
const LANG_ALIASES: Record<string, string> = {
  typescript: 'ts',
  ts: 'ts',
  tsx: 'ts',
  javascript: 'js',
  js: 'js',
  jsx: 'js',
  node: 'js',
  python: 'py',
  py: 'py',
  golang: 'go',
  go: 'go',
  java: 'java',
  ruby: 'rb',
  rb: 'rb',
  rust: 'rs',
  rs: 'rs',
  php: 'php',
  csharp: 'cs',
  cs: 'cs',
};

/** Tie-break priority when a container mixes languages (earliest wins). */
const LANG_PRIORITY = ['ts', 'js', 'py', 'go', 'java'];

/** Canonicalise a language spelling; unknown tokens pass through lower-cased. */
export function normalizeLanguage(lang: string | undefined): string | undefined {
  if (typeof lang !== 'string') return undefined;
  const key = lang.trim().toLowerCase();
  if (key === '') return undefined;
  return LANG_ALIASES[key] ?? key;
}

/** The file extension (with dot) a new file of `language` should carry. */
export function extForLanguage(language: string | undefined): string {
  const canon = normalizeLanguage(language);
  return (canon && EXT_BY_LANG[canon]) || '.ts';
}

/** Canonical language for a path, from its extension (or undefined). */
function languageFromPath(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const m = /\.([a-z0-9]+)$/i.exec(p);
  if (!m) return undefined;
  return LANG_BY_EXT[m[1].toLowerCase()];
}

/** Split a label into a (base, extension-with-dot | undefined) when it names a known code file. */
function splitKnownExt(label: string): { base: string; ext?: string } {
  const m = /^(.*)\.([a-z0-9]+)$/i.exec(label.trim());
  if (m && LANG_BY_EXT[m[2].toLowerCase()]) {
    return { base: m[1], ext: `.${m[2].toLowerCase()}` };
  }
  return { base: label };
}

/** A filesystem-safe, deterministic filename base from a human label. */
function fileSlug(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? 'file' : s;
}

/** Normalise a repo-relative path: strip `./`, collapse backslashes and dup slashes. */
function normalizePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/** children-by-parent index, built once per call. */
function childrenIndex(graph: ArchGraph): Map<string, ArchNode[]> {
  const kids = new Map<string, ArchNode[]>();
  for (const n of graph.nodes) {
    if (!n.parentId) continue;
    const arr = kids.get(n.parentId) ?? [];
    arr.push(n);
    kids.set(n.parentId, arr);
  }
  return kids;
}

/**
 * The determinable language of a code container: its own `meta.language`
 * (design-mode services carry it) else the dominant language among its
 * descendant FILE nodes (scan-mode services carry language on files, not the
 * service). Returns undefined when nothing indicates one.
 */
function containerLanguage(
  container: ArchNode | undefined,
  kids: Map<string, ArchNode[]>
): string | undefined {
  if (!container) return undefined;
  const own = normalizeLanguage(
    typeof container.meta?.language === 'string' ? (container.meta.language as string) : undefined
  );
  if (own) return own;

  // Count descendant-file languages (from meta.language, else the path extension).
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const c of kids.get(id) ?? []) {
      if (c.kind === 'file') {
        const lang =
          normalizeLanguage(typeof c.meta?.language === 'string' ? (c.meta.language as string) : undefined) ??
          languageFromPath(c.path);
        if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
      }
      walk(c.id);
    }
  };
  walk(container.id);
  if (counts.size === 0) return undefined;

  let best: string | undefined;
  let bestCount = -1;
  for (const [lang, count] of counts) {
    if (count > bestCount || (count === bestCount && lessLang(lang, best))) {
      best = lang;
      bestCount = count;
    }
  }
  return best;
}

/** Deterministic language ordering for the dominant-language tie-break. */
function lessLang(a: string, b: string | undefined): boolean {
  if (b === undefined) return true;
  const ia = LANG_PRIORITY.indexOf(a);
  const ib = LANG_PRIORITY.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
    const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
    if (ra !== rb) return ra < rb;
  }
  return a < b;
}

/** The directory a new file under `container` lands in (repo-relative, '' = root). */
function containerDir(container: ArchNode | undefined): string {
  if (!container || !container.path) return '';
  return normalizePath(container.path);
}

/**
 * Infer what a new child named `label` under `parentId` should be. Pure and
 * deterministic. See the module header for the rules.
 */
export function inferPlacement(graph: ArchGraph, parentId: string, label: string): Placement {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const kids = childrenIndex(graph);
  const parent = byId.get(parentId);

  // A file cannot contain a file; place a sibling in the file's own container.
  let container = parent;
  if (parent && parent.kind === 'file') {
    container = parent.parentId ? byId.get(parent.parentId) : undefined;
  }

  // Language precedence: an explicit extension in the label wins (so "worker.py"
  // is a py file even under a ts service — and the checker then flags it), else
  // the container's language, else 'ts' as the neutral default.
  const { base, ext } = splitKnownExt(label);
  const labelLang = languageFromPath(ext);
  const language = labelLang ?? containerLanguage(container, kids) ?? 'ts';

  const filename = ext ? `${fileSlug(base)}${ext}` : `${fileSlug(base)}${extForLanguage(language)}`;
  const dir = containerDir(container);
  const suggestedPath = dir ? `${dir}/${filename}` : filename;

  // On the attached-repo create surface a drawn node becomes a real FILE.
  return { kind: 'file', language, suggestedPath };
}

/** Nearest ancestor (or self) of `parent` whose kind is one of `allowed`, else undefined. */
function nearestAllowedAncestor(
  byId: Map<string, ArchNode>,
  parent: ArchNode,
  allowed: readonly NodeKind[]
): ArchNode | undefined {
  let cur: ArchNode | undefined = parent;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (allowed.includes(cur.kind)) return cur;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return undefined;
}

/**
 * Return the placement warnings for `proposal` against `graph` (empty ⇒ the
 * placement looks fine). Pure, deterministic, never mutates `graph`. Warnings
 * are emitted in a fixed order (language, containment, connection, collision).
 */
export function checkPlacement(graph: ArchGraph, proposal: PlacementProposal): PlacementWarning[] {
  const warnings: PlacementWarning[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const kids = childrenIndex(graph);

  const parent = byId.get(proposal.parentId);
  const inferred = inferPlacement(graph, proposal.parentId, proposal.label);

  // The container the file physically lands in (a file's parent = its service).
  let container = parent;
  if (parent && parent.kind === 'file') {
    container = parent.parentId ? byId.get(parent.parentId) : undefined;
  }

  const proposalLang = normalizeLanguage(proposal.language) ?? inferred.language;
  const effectivePath = normalizePath(proposal.path ?? inferred.suggestedPath);

  // (a) language mismatch — only meaningful for a code container.
  if (container && CONTAINER_KINDS.has(container.kind)) {
    const containerLang = containerLanguage(container, kids);
    if (containerLang && proposalLang && containerLang !== proposalLang) {
      warnings.push({
        code: 'language-mismatch',
        message: `A ${proposalLang} file under the ${containerLang} ${container.kind} "${container.label}" mixes languages — this probably doesn't belong here.`,
        suggestion: `Use ${containerLang} to match "${container.label}", or add a new ${proposalLang} service as a sibling and place it there.`,
      });
    }
  }

  // (b) kind / containment mismatch.
  if (parent) {
    const allowed = ALLOWED_PARENT_KINDS[proposal.kind] ?? [];
    if (!allowed.includes(parent.kind)) {
      const target = nearestAllowedAncestor(byId, parent, allowed);
      const where = target
        ? `"${target.label}" (a ${target.kind})`
        : allowed.includes('repo')
          ? 'the repo root'
          : `a ${allowed[0] ?? 'different'} node`;
      const legal = allowed.length > 0 ? allowed.join(' or ') : 'nothing (it is a root)';
      warnings.push({
        code: 'containment',
        message: `A ${proposal.kind} doesn't belong under the ${parent.kind} "${parent.label}" — this probably doesn't belong here.`,
        suggestion: `${proposal.kind} nodes belong under ${legal}. Add it under ${where} instead.`,
      });
    }
  }

  // (c) connection illegality — only when the draw implies an interaction edge.
  if (proposal.edge) {
    const allowedDst = INTERACTION_DST_KINDS[proposal.edge.kind];
    // `import` (and any kind absent from the whitelist) is exempt, as in validateGraph.
    if (allowedDst) {
      const from = byId.get(proposal.edge.fromId);
      if (from && !INTERACTION_SRC_KINDS.includes(from.kind)) {
        warnings.push({
          code: 'illegal-connection',
          message: `A ${from.kind} ("${from.label}") can't originate a ${proposal.edge.kind} call — this connection isn't legal.`,
          suggestion: `Only a ${INTERACTION_SRC_KINDS.join(' or ')} can call out. Draw the connector from a service instead.`,
        });
      }
      if (!allowedDst.includes(proposal.kind)) {
        warnings.push({
          code: 'illegal-connection',
          message: `A ${proposal.edge.kind} edge can't target a ${proposal.kind} — this connection isn't legal.`,
          suggestion: `A ${proposal.edge.kind} edge must target ${allowedDst.join(' or ')}. Make the new node one of those, or use a different connection.`,
        });
      }
    }
  }

  // (d) path collision.
  const collision = graph.nodes.some(
    (n) => (n.path && normalizePath(n.path) === effectivePath) || n.id === `file:${effectivePath}`
  );
  if (collision) {
    warnings.push({
      code: 'path-collision',
      message: `A file already exists at "${effectivePath}" — creating this would collide with it.`,
      suggestion: `Pick a different name so the new file gets its own path.`,
    });
  }

  return warnings;
}
