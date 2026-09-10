/**
 * The explain layer: turn a deterministic {@link ArchGraph} into a plain-English
 * {@link PlainTree}.
 *
 * Two paths, one honest contract:
 *  - AI path (a provider is configured): send a COMPACT deterministic digest of
 *    the real structure to the provider, ask it to return ONLY a PlainTree that
 *    GROUPS and RELABELS the ids we gave it into plain-English areas. The model
 *    may only regroup/relabel real ids — it cannot introduce structure. We parse
 *    with the existing defensive JSON extractor, then VALIDATE every returned
 *    `sourceRef` against the real structure and STRIP anything invented. If that
 *    strips the tree down to nothing usable, we fall back to the structural tree.
 *  - Deterministic fallback (no provider, or an unusable AI response): build the
 *    PlainTree purely from the structure — readable areas, services, features,
 *    files. Zero AI, so the sandbox (and any keyless user) always sees a tree.
 *
 * Both paths are deterministic given the same inputs (stable ordering; no
 * Math.random / Date in the tree). Edges (`edgeRefs`) are always recomputed from
 * the real graph, never taken from an AI response.
 */

import type { AskCoverage } from '@sequence/api-types';
import type { ArchGraph, ArchNode, ArchEdge, SystemRisk, CyclicDependency } from '@sequence/schema';
import {
  classifyProject,
  computeRisks,
  computeCycles,
  rankableNodeCount,
  DEFAULT_TOP_N,
  SEQ_DIAGRAM_EDGE_FAMILIES,
  SEQ_DIAGRAM_NODE_KINDS,
  type ProjectType,
  scanCoverage,
} from '@sequence/schema';
import { checkQuestionPremise } from '../moat/claimCheck.js';
import { isServiceLevelEdgeKind, serviceLevelRisksInput } from './serviceGraph.js';
import { RESEARCH_MODE_DIRECTIVE } from './askIntents.js';
import { fileGroupSignal } from './fileSignals.js';
import { rationaleSentence, type RationaleNote } from '../rationale.js';
import { extractFirstJsonObject, type AiConfig, generateText } from '../server/provider.js';
import { graphLanguageMix, type LanguageShare } from '../lang/mix.js';
import { composePromptGuidance } from '../lang/packs.js';
import type { TreeNode } from '../server/tree.js';
import { budgetChars, cutTextToBudget, omissionMarker } from '../llm/tokenBudget.js';
import {
  UNTRUSTED_CONTENT_INSTRUCTION,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
  neutralizeDeep,
  wrapUntrustedLines,
} from '../llm/untrusted.js';
import {
  humanize,
  attachEdgeRefs,
  validSourceRefs,
  type PlainKind,
  type PlainNode,
  type PlainTreeResult,
} from './plaintree.js';

/**
 * Names that already say what the thing IS. Kept in step with the identical list
 * in `packages/web/src/graph/groupedArchModel.ts` — the board and the plain tree
 * must not disagree about whether a service is called "X" or "X service".
 */
const NAME_ALREADY_A_NOUN =
  /(^|\s)(service|services|api|gateway|worker|server|client|app|ui|web|website|site|portal|frontend|backend|dashboard|admin|console|cli|sdk|engine|daemon|bot|queue|store|studio|platform|program)$/i;

/**
 * How much detail the plain tree carries (v9 Phase 4). 'regular' is today's
 * split-in-half plain-English view — humanized names, friendly one-line
 * summaries — and is byte-identical to the pre-Phase-4 output (locked by a test).
 * 'advanced' is the denser, Obsidian-style view over the SAME real structure and
 * node set: it bypasses `humanize` to show raw technical labels, surfaces
 * datastore `meta.tech` verbatim, and packs framework/dir/lang detail into the
 * summaries. It never fabricates — every node still traces to a real sourceRef.
 */
export type DetailLevel = 'regular' | 'advanced';

export interface BuildPlainTreeOptions {
  /**
   * The configured AI provider. When present, the AI path is attempted (and
   * falls back to structural on any failure). When absent, the structural
   * fallback is built directly — the keyless / sandbox path.
   */
  provider?: AiConfig;
  /**
   * Optional folder walk (the /api/tree data). Used to enrich the digest with
   * top-level directory names; not required for a correct tree.
   */
  tree?: TreeNode;
  /**
   * Injection seam for the provider call (defaults to the real
   * {@link generateText} over HTTP). Tests pass a canned responder so the unit
   * layer needs no network; the server e2e uses the real HTTP mock provider.
   */
  callProvider?: (cfg: AiConfig, prompt: string) => Promise<string>;
  /**
   * The generate profile (v9 Phase 3b). 'recommended' (default) is today's
   * one-system Frontend/Backend/Data view — byte-identical to before, and the
   * ONLY profile that attempts the AI grouping path. 'bestfit' deterministically
   * classifies the product type and re-buckets the SAME real structure under
   * type-appropriate top-level areas (no AI, always structural).
   */
  profile?: 'recommended' | 'bestfit';
  /**
   * The detail level (v9 Phase 4). Defaults to 'regular' (byte-identical to the
   * pre-Phase-4 output). 'advanced' densifies the SAME real structure — see
   * {@link DetailLevel}.
   */
  detailLevel?: DetailLevel;
}

/* ======================================================= classification ==== */

const FRONTEND_RE = /(^|[-_/\s])(web|www|frontend|front-end|ui|client|site|app|dashboard|portal|storefront|webui)($|[-_/\s])/i;

/** Best-effort "is this an end-user-facing service?" from its name/dir/framework. */
function isFrontend(node: ArchNode): boolean {
  const framework = typeof node.meta?.framework === 'string' ? node.meta.framework : '';
  if (/next|react|vue|svelte|angular/i.test(framework)) return true;
  const hay = `${node.label} ${node.path ?? ''}`;
  return FRONTEND_RE.test(hay);
}

/** Map a datastore node to a plain-English title + summary from its tech/role. */
function dataStoreLabel(
  node: ArchNode,
  detailLevel: DetailLevel = 'regular'
): { title: string; summary: string } {
  if (detailLevel === 'advanced') {
    // Advanced surfaces the raw datastore label + its detected tech VERBATIM
    // (never humanized, never softened) and packs role into a denser summary.
    const rawTech = typeof node.meta?.tech === 'string' ? node.meta.tech : undefined;
    const rawRole = typeof node.meta?.role === 'string' ? node.meta.role : undefined;
    // Append the tech in parens only when it adds information (differs from the
    // raw label) — avoids a redundant "postgres (postgres)".
    const title =
      rawTech && rawTech.toLowerCase() !== node.label.toLowerCase()
        ? `${node.label} (${rawTech})`
        : node.label;
    const bits: string[] = [];
    if (rawTech) bits.push(`tech: ${rawTech}`);
    if (rawRole) bits.push(`role: ${rawRole}`);
    return { title, summary: bits.length > 0 ? bits.join(', ') : 'Data store.' };
  }
  const tech = String(node.meta?.tech ?? node.label).toLowerCase();
  const role = String(node.meta?.role ?? '').toLowerCase();
  const name = humanize(node.label);
  if (/postgres|mysql|mariadb|sqlite|mssql|oracle|cockroach/.test(tech)) {
    return { title: `${name} database`, summary: 'A database that stores information.' };
  }
  if (/mongo|dynamo|cassandra|couch/.test(tech)) {
    return { title: `${name} database`, summary: 'A database that stores documents/records.' };
  }
  if (/redis|memcached/.test(tech)) {
    return role === 'broker'
      ? { title: `${name} (cache & message queue)`, summary: 'Fast storage that also passes messages between services.' }
      : { title: `${name} cache`, summary: 'Fast temporary storage.' };
  }
  if (/rabbit|kafka|nats|sqs|pubsub|amqp/.test(tech)) {
    return { title: `${name} (message queue)`, summary: 'Passes messages between services.' };
  }
  if (role === 'broker') {
    return { title: `${name} (message queue)`, summary: 'Passes messages between services.' };
  }
  return { title: `${name} data store`, summary: 'Where information is kept.' };
}

/* ================================================== deterministic tree ===== */

/**
 * ONE pass over the graph, reused by every containment lookup in this module.
 *
 * WHY THIS EXISTS (perf, r?? — measured, not guessed). Every containment query
 * here used to be a full `graph.nodes.filter(...)` or a freshly-built
 * `new Map(graph.nodes.map(...))`, so the cost of building a tree or a digest
 * was `nodes × (services + modules + datastores)`. On the real n8n clone
 * (19 145 nodes / 18 282 files / 67 services) `buildDigest` alone rebuilt a
 * 19 145-entry Map 1 224 894 times — a measured 3.91 ms each, ≈80 minutes,
 * which is why the QA harness killed n8n at its 900 s cap.
 *
 * The index is built per top-level call and threaded down (never cached across
 * calls) so a caller that mutates its graph between calls can never read a
 * stale view. Bucket order is node order, so every consumer sees exactly the
 * array `graph.nodes.filter(...)` used to return.
 */
interface GraphIndex {
  /** id → node. */
  byId: Map<string, ArchNode>;
  /** parentId → its children, in graph node order. */
  children: Map<string, ArchNode[]>;
  /** node id → the kinds of every edge incident on it (either direction). */
  edgeKinds: Map<string, Set<string>>;
}

function buildGraphIndex(graph: ArchGraph): GraphIndex {
  const byId = new Map<string, ArchNode>();
  const children = new Map<string, ArchNode[]>();
  for (const n of graph.nodes) {
    byId.set(n.id, n);
    if (n.parentId === undefined || n.parentId === null) continue;
    const bucket = children.get(n.parentId);
    if (bucket) bucket.push(n);
    else children.set(n.parentId, [n]);
  }
  const edgeKinds = new Map<string, Set<string>>();
  const note = (id: string, kind: string): void => {
    const s = edgeKinds.get(id);
    if (s) s.add(kind);
    else edgeKinds.set(id, new Set([kind]));
  };
  for (const e of graph.edges) {
    note(e.srcId, e.kind);
    note(e.dstId, e.kind);
  }
  return { byId, children, edgeKinds };
}

/** Children of `parentId` in the graph containment tree, in stable node order. */
function childrenOf(index: GraphIndex, parentId: string): ArchNode[] {
  return index.children.get(parentId) ?? [];
}

/** Build a plain-English description for a service from its children + edges. */
function serviceDescription(
  svc: ArchNode,
  index: GraphIndex,
  frontend: boolean,
  children: PlainNode[],
): string {
  // If the service has modules (features), derive description from them.
  const features = children.filter((c) => c.kind === 'feature');
  if (features.length > 0) {
    // Take the first 3 module names as a terse description.
    const names = features.slice(0, 3).map((f) => f.title.toLowerCase());
    let desc = names.join(' · ');
    if (features.length > 3) desc += ` · ${features.length - 3} more`;
    return desc;
  }
  // If it has files, describe by file names.
  const files = children.filter((c) => c.kind === 'file');
  if (files.length > 0) {
    const names = files.slice(0, 3).map((f) => f.title.replace(/\.[^.]+$/, ''));
    let desc = names.join(' · ');
    if (files.length > 3) desc += ` · ${files.length - 3} more`;
    return desc;
  }
  // Fallback: look at what edges this service participates in.
  const kinds = index.edgeKinds.get(svc.id);
  if (kinds && kinds.size > 0) {
    const parts: string[] = [];
    if (kinds.has('http') || kinds.has('grpc')) parts.push('API');
    if (kinds.has('db_read') || kinds.has('db_write') || kinds.has('db_access')) parts.push('database');
    if (kinds.has('queue_publish') || kinds.has('queue_consume')) parts.push('messaging');
    if (parts.length > 0) return parts.join(' · ');
  }
  // Last resort — the framework-based fallback.
  const framework = typeof svc.meta?.framework === 'string' ? svc.meta.framework : undefined;
  if (frontend) return 'The part of the app that users see and click.';
  if (framework) return `A backend service (built with ${framework}).`;
  return 'A backend service that does work behind the scenes.';
}

/** Build a plain node for a service subtree (modules → features, files → leaves). */
function buildServiceSubtree(
  index: GraphIndex,
  svc: ArchNode,
  frontend: boolean,
  detailLevel: DetailLevel = 'regular'
): PlainNode {
  const kids = childrenOf(index, svc.id);
  const children: PlainNode[] = [];
  for (const child of kids) {
    if (child.kind === 'module') {
      children.push(buildFeatureNode(index, child, detailLevel));
    } else if (child.kind === 'file') {
      children.push(buildFileNode(child, detailLevel));
    }
  }
  const framework = typeof svc.meta?.framework === 'string' ? svc.meta.framework : undefined;
  if (detailLevel === 'advanced') {
    // Advanced keeps the RAW service label (technical name, no humanize) and packs
    // language/framework/dir into a denser summary — all from real meta.
    const lang = typeof svc.meta?.language === 'string' ? svc.meta.language : undefined;
    const bits: string[] = [];
    if (lang) bits.push(lang);
    if (framework) bits.push(framework);
    if (svc.path) bits.push(svc.path);
    const detail = bits.length > 0 ? ` — ${bits.join(', ')}` : '';
    return {
      id: `p:${svc.id}`,
      title: svc.label,
      summary: `${frontend ? 'Frontend' : 'Backend'} service${detail}.`,
      kind: 'service',
      children,
      sourceRefs: [svc.id],
    };
  }
  // r184 — an AI-labelled service is already a product name in English
  // (`scan.ts` + `llm/label.ts`, renames only), so it is used verbatim: the pass
  // was buying "Learning Program service" for the owner's key.
  const name = svc.meta?.llmLabeled === true ? svc.label : humanize(svc.label);
  // ...and a name that already ENDS in a shape/tier word is already a noun
  // phrase. The owner's report was cards reading "Schwai Ace Frontend service".
  // This only ever removes an addition of ours; it never renames anything.
  const title = frontend || NAME_ALREADY_A_NOUN.test(name) ? name : `${name} service`;
  // Use the richer description from children + edges.
  const summary = serviceDescription(svc, index, frontend, children);
  return { id: `p:${svc.id}`, title, summary, kind: 'service', children, sourceRefs: [svc.id] };
}

/** First letter up, everything else untouched — the phrase is already worded. */
function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Enough singularisation to tell "Tests" from "test" — nothing more. This only
 * ever decides whether a summary phrase is REPEATING the row's own title, so an
 * over-eager stem costs at worst one dropped redundant phrase, never a wrong
 * claim.
 */
function singularize(w: string): string {
  if (w.length > 3 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 2 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** A cluster/module node → a plain "feature" grouping of related files. */
function buildFeatureNode(
  index: GraphIndex,
  mod: ArchNode,
  detailLevel: DetailLevel = 'regular'
): PlainNode {
  const files = childrenOf(index, mod.id).filter((n) => n.kind === 'file');
  const nFiles = typeof mod.meta?.files === 'number' ? mod.meta.files : files.length;
  const children = files.map((f) => buildFileNode(f, detailLevel));
  if (detailLevel === 'advanced') {
    // Advanced shows the RAW module label (no humanize) and a denser count line.
    return {
      id: `p:${mod.id}`,
      title: mod.label,
      summary: `Module "${mod.label}" — ${nFiles} file${nFiles === 1 ? '' : 's'}.`,
      kind: 'feature',
      children,
      sourceRefs: [mod.id],
    };
  }
  // r183: "a group of N related files" said the same nothing about every module
  // in the repo. Describe the group from the file names we actually have; the
  // count sentence stays as the honest LAST resort when the names say nothing.
  const signal = fileGroupSignal(files.map((f) => f.path || f.label));
  // ...and when the file NAMES say nothing, the code itself still might. The
  // scan already computed `meta.description` from this module's real facts —
  // "14 go files in render, defining JSON, XML, HTML" (cluster.ts
  // `describeCluster`) — and this function threw it away, so a Go library's
  // modules all read "A group of N related files." while the symbols that
  // answer the question sat one property away.
  const fromFacts =
    typeof mod.meta?.description === 'string' && mod.meta.description.trim() !== ''
      ? mod.meta.description
      : undefined;
  // r187 (G11) — THE TWO GROUNDED FACTS NOW COMPLEMENT INSTEAD OF COMPETING.
  //
  // The domain pattern used to WIN outright (`grounded ?? fromFacts ?? count`),
  // so adding it to a module did not fill a blank — it replaced a more specific
  // sentence. Measured on the real gin clone: `render/` went from "14 go files
  // in render, defining Instance, loadTemplate, Render." to the vaguer
  // "Serialization format modules.", and only 7 of those 14 files are
  // serializers. Both facts are real and they answer different questions —
  // what kind of thing this is, and what is actually in it — so the line now
  // carries both. G14 — counted symbols LEAD so a single-line ellipsis on a
  // narrow breakout row keeps the specific detail; domain context follows.
  //
  // The domain phrase is DROPPED when the row's own title already says it: two
  // modules the earlier round measured were already titled "Plugins", so
  // "Plugin modules" only repeated the row's name (HANDOFF §6, settled dislike)
  // — and now it would do so in FRONT of the real detail.
  const title = humanize(mod.label);
  const titleWords = new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w !== '')
      .map(singularize)
  );
  const echoesTitle =
    !!signal && signal.words.length > 0 && signal.words.every((w) => titleWords.has(singularize(w)));
  const domain = signal && !echoesTitle ? `${capitalizeFirst(signal.phrase)} ${signal.head}` : undefined;
  const grounded = signal && !echoesTitle ? `${capitalizeFirst(signal.phrase)} ${signal.head}.` : undefined;
  // The team's own recorded WHY (`// WHY:` / `// HACK:` comments, ADR/RFC
  // references — `rationale.ts`). `fromFacts` already ends with this sentence,
  // because `describeCluster` composed it; the other two branches did not, so a
  // module whose filenames happened to carry a domain pattern silently LOST the
  // strongest fact on the card. One sentence, appended once, never twice.
  const notes = Array.isArray(mod.meta?.rationale) ? (mod.meta.rationale as RationaleNote[]) : [];
  const why = notes.length > 0 ? rationaleSentence(notes) : undefined;
  const base =
    domain && fromFacts
      ? `${fromFacts} — ${domain}`
      : (grounded ?? fromFacts ?? `A group of ${nFiles} related file${nFiles === 1 ? '' : 's'}.`);
  const summary = why && !base.includes(why) ? `${base} ${why}` : base;
  return {
    id: `p:${mod.id}`,
    title,
    summary,
    kind: 'feature',
    children,
    sourceRefs: [mod.id],
  };
}

/** A file node → the real filename, verbatim, with a plain summary. */
function buildFileNode(file: ArchNode, _detailLevel: DetailLevel = 'regular'): PlainNode {
  // File titles are ALREADY the raw filename and the summary already carries the
  // real path + language + loc, so both detail levels render the same honest,
  // technical leaf — no humanize to bypass.
  const lang = typeof file.meta?.language === 'string' ? file.meta.language : undefined;
  const loc = typeof file.meta?.loc === 'number' ? file.meta.loc : undefined;
  const bits: string[] = [];
  if (lang) bits.push(lang);
  if (loc) bits.push(`${loc} lines`);
  const summary = file.path
    ? bits.length > 0
      ? `${file.path} (${bits.join(', ')})`
      : file.path
    : undefined;
  return {
    id: `p:${file.id}`,
    title: file.label,
    summary,
    kind: 'file',
    children: [],
    sourceRefs: [file.id],
  };
}

/** A datastore node → a plain "data" node, nesting any topics under it. */
function buildDataNode(
  index: GraphIndex,
  ds: ArchNode,
  detailLevel: DetailLevel = 'regular'
): PlainNode {
  const { title, summary } = dataStoreLabel(ds, detailLevel);
  const topics = childrenOf(index, ds.id).filter((n) => n.kind === 'topic');
  return {
    id: `p:${ds.id}`,
    title,
    summary,
    kind: 'data',
    children: topics.map((t) => buildTopicNode(t, detailLevel)),
    sourceRefs: [ds.id],
  };
}

/** A topic node → a plain "message stream" leaf. */
function buildTopicNode(topic: ArchNode, detailLevel: DetailLevel = 'regular'): PlainNode {
  if (detailLevel === 'advanced') {
    // Advanced shows the RAW topic label (no humanize, no "messages" softening).
    return {
      id: `p:${topic.id}`,
      title: topic.label,
      summary: `Topic "${topic.label}".`,
      kind: 'data',
      children: [],
      sourceRefs: [topic.id],
    };
  }
  return {
    id: `p:${topic.id}`,
    title: `${humanize(topic.label)} messages`,
    summary: `A stream of "${topic.label}" messages.`,
    kind: 'data',
    children: [],
    sourceRefs: [topic.id],
  };
}

/**
 * Build the PlainTree PURELY from structure — the deterministic fallback. Groups
 * app services into Frontend / Backend areas (best-effort classification) and
 * datastores/topics into a Data area, with features and files beneath. Always
 * human-ish, never empty when the graph has any content.
 */
export function buildStructuralTree(
  graph: ArchGraph,
  profile: 'recommended' | 'bestfit' = 'recommended',
  detailLevel: DetailLevel = 'regular'
): PlainNode {
  // Best-fit re-buckets the SAME real structure under product-type-appropriate
  // top-level areas (deterministic classification + emphasis). Recommended is the
  // original code path below — byte-identical, locked by a test.
  if (profile === 'bestfit') return buildBestfitTree(graph, detailLevel);
  const index = buildGraphIndex(graph);
  const repo = graph.nodes.find((n) => n.kind === 'repo');
  const services = graph.nodes.filter((n) => n.kind === 'service');
  const datastores = graph.nodes.filter((n) => n.kind === 'datastore');
  // Topics whose broker/parent is NOT a datastore hang directly off the repo;
  // surface them in the Data area too so nothing real is dropped.
  const looseTopics = graph.nodes.filter(
    (n) => n.kind === 'topic' && (!n.parentId || n.parentId === 'repo')
  );

  const frontendSvcs = services.filter(isFrontend);
  const backendSvcs = services.filter((s) => !isFrontend(s));

  const areas: PlainNode[] = [];

  if (frontendSvcs.length > 0) {
    areas.push({
      id: 'p:area:frontend',
      title: 'Frontend',
      summary: 'The parts of the app people see and interact with.',
      kind: 'area',
      children: frontendSvcs.map((s) => buildServiceSubtree(index, s, true, detailLevel)),
      sourceRefs: frontendSvcs.map((s) => s.id),
    });
  }
  if (backendSvcs.length > 0) {
    areas.push({
      id: 'p:area:backend',
      title: 'Backend',
      summary: 'The services that do the work behind the scenes.',
      kind: 'area',
      children: backendSvcs.map((s) => buildServiceSubtree(index, s, false, detailLevel)),
      sourceRefs: backendSvcs.map((s) => s.id),
    });
  }
  if (datastores.length > 0 || looseTopics.length > 0) {
    const dataChildren = [
      ...datastores.map((d) => buildDataNode(index, d, detailLevel)),
      ...looseTopics.map((t) => buildTopicNode(t, detailLevel)),
    ];
    areas.push({
      id: 'p:area:data',
      title: 'Data',
      summary: 'Where information is stored and passed between services.',
      kind: 'area',
      children: dataChildren,
      sourceRefs: [...datastores.map((d) => d.id), ...looseTopics.map((t) => t.id)],
    });
  }

  const root: PlainNode = {
    id: 'p:repo',
    title: detailLevel === 'advanced' ? (repo?.label ?? graph.repoName) : humanize(repo?.label ?? graph.repoName),
    summary: 'Your whole application, grouped into plain-English areas.',
    kind: 'group',
    children: areas,
    sourceRefs: ['repo'],
  };
  return attachEdgeRefs(root, graph);
}

/* ============================================ best-fit (per-type emphasis) == */

/**
 * How each product type EMPHASIZES the top-level buckets. This never changes the
 * real leaf structure (service subtrees, features, files, data nodes are the same
 * ones the recommended view builds); it only changes the TOP-LEVEL grouping and
 * LABELS. `explodeServices` promotes each service to its own top-level area
 * (microservices); otherwise the three underlying groups — frontend-ish services,
 * backend-ish services, datastores/topics — are relabeled with type-appropriate
 * names. Where a clean re-bucket isn't obvious the names fall back to plain,
 * honest generics (noted per type) — nothing is fabricated.
 */
interface EmphasisSpec {
  /** One-line type framing, shown on the root summary. */
  framing: string;
  /** Label/summary for the area holding frontend-classified services. */
  frontend: { title: string; summary: string };
  /** Label/summary for the area holding backend-classified services. */
  backend: { title: string; summary: string };
  /** Label/summary for the Data area (datastores + loose topics). */
  data: { title: string; summary: string };
  /** microservices: promote each service to its own top-level area. */
  explodeServices?: boolean;
}

const EMPHASIS: Record<ProjectType, EmphasisSpec> = {
  mobile: {
    framing: 'A mobile app — organized by screens, the code behind them, and the data/API it talks to.',
    frontend: { title: 'Screens & components', summary: 'The screens people see and the components that build them.' },
    backend: { title: 'Services & API', summary: 'The code and services the app talks to.' },
    data: { title: 'Local data & storage', summary: 'Where the app keeps information.' },
  },
  spa: {
    framing: 'A single-page web app — organized by its routes/components, state, and the API/data behind them.',
    frontend: { title: 'Routes & components', summary: 'The pages and the components that build them.' },
    backend: { title: 'API', summary: 'The backend the app calls.' },
    data: { title: 'State & data', summary: 'Where information is stored and shared.' },
  },
  microservices: {
    framing: 'A microservice system — each service is shown as its own top-level area.',
    frontend: { title: 'Frontend', summary: 'The parts people see and interact with.' },
    backend: { title: 'Services', summary: 'The services that do the work.' },
    data: { title: 'Shared data', summary: 'Data stores and streams shared between services.' },
    explodeServices: true,
  },
  monolith: {
    framing: 'A single web application — organized by its endpoints/modules and its data.',
    frontend: { title: 'Frontend', summary: 'The parts people see and interact with.' },
    backend: { title: 'Endpoints & modules', summary: 'The request handlers and the code behind them.' },
    data: { title: 'Data', summary: 'Where information is stored.' },
  },
  'server-web': {
    framing: 'A server-rendered web app — organized around request handling, its models, and the data (ER).',
    frontend: { title: 'Frontend', summary: 'The parts people see and interact with.' },
    backend: { title: 'Request handling & models', summary: 'Controllers, views and the models behind them.' },
    data: { title: 'Data (tables & relations)', summary: 'The database tables information lives in.' },
  },
  cli: {
    framing: 'A command-line tool — organized around its commands and any data/pipeline behind them.',
    // A clean commands/flags split isn't recoverable from structure alone, so the
    // lone service's files are surfaced as "Commands" (honest generic fallback).
    frontend: { title: 'Commands', summary: 'The commands and the code that runs them.' },
    backend: { title: 'Commands', summary: 'The commands and the code that runs them.' },
    data: { title: 'Data', summary: 'Where the tool keeps or reads information.' },
  },
  library: {
    framing: 'A reusable library — organized around its public API and internal modules.',
    frontend: { title: 'Public API & modules', summary: 'The exported surface and the modules behind it.' },
    backend: { title: 'Public API & modules', summary: 'The exported surface and the modules behind it.' },
    data: { title: 'Data', summary: 'Any bundled data.' },
  },
  pipeline: {
    framing: 'A data pipeline — organized around its processing stages and its sources & sinks.',
    frontend: { title: 'Stages', summary: 'The processing steps of the pipeline.' },
    backend: { title: 'Stages', summary: 'The processing steps of the pipeline.' },
    data: { title: 'Sources & sinks', summary: 'Where data comes from and goes to.' },
  },
  ml: {
    framing: 'A machine-learning project — organized around data/features and training/serving.',
    frontend: { title: 'Serving', summary: 'The code that serves the model.' },
    backend: { title: 'Training & serving', summary: 'The code that trains and serves the model.' },
    data: { title: 'Data & features', summary: 'The datasets and features the model uses.' },
  },
  serverless: {
    framing: 'A serverless app — organized around its functions and the resources they use.',
    frontend: { title: 'Functions', summary: 'The functions triggered by events.' },
    backend: { title: 'Functions', summary: 'The functions triggered by events.' },
    data: { title: 'Resources', summary: 'The datastores and queues the functions use.' },
  },
  game: {
    framing: 'A game — organized around its scenes/entities and the systems that drive them.',
    frontend: { title: 'Scenes & entities', summary: 'What appears on screen.' },
    backend: { title: 'Systems', summary: 'The systems that drive the game.' },
    data: { title: 'Assets & data', summary: 'Game assets and saved data.' },
  },
  infra: {
    framing: 'Infrastructure — organized around its resources and networking.',
    frontend: { title: 'Resources', summary: 'The provisioned resources.' },
    backend: { title: 'Resources', summary: 'The provisioned resources.' },
    data: { title: 'Networking & data', summary: 'Networks and data stores.' },
  },
  embedded: {
    framing: 'An embedded/firmware project — organized around its layers and state.',
    frontend: { title: 'Layers', summary: 'The firmware layers.' },
    backend: { title: 'Layers', summary: 'The firmware layers.' },
    data: { title: 'State', summary: 'Persisted state.' },
  },
  generic: {
    // No decisive type — fall back to the plain Frontend/Backend/Data names.
    framing: 'Your whole application, grouped into plain-English areas.',
    frontend: { title: 'Frontend', summary: 'The parts of the app people see and interact with.' },
    backend: { title: 'Backend', summary: 'The services that do the work behind the scenes.' },
    data: { title: 'Data', summary: 'Where information is stored and passed between services.' },
  },
};

/**
 * Build the best-fit PlainTree: deterministically classify the product type, then
 * group the SAME real service/data nodes under type-appropriate top-level areas.
 * Structure stays 100% real — every plain node keeps the exact sourceRefs the
 * recommended view would give it; only the top-level grouping and labels change,
 * and the root is marked "Best-fit: <type>".
 */
export function buildBestfitTree(
  graph: ArchGraph,
  detailLevel: DetailLevel = 'regular'
): PlainNode {
  const { type } = classifyProject(graph);
  const spec = EMPHASIS[type];
  const index = buildGraphIndex(graph);
  const repo = graph.nodes.find((n) => n.kind === 'repo');

  const services = graph.nodes.filter((n) => n.kind === 'service');
  const datastores = graph.nodes.filter((n) => n.kind === 'datastore');
  const looseTopics = graph.nodes.filter(
    (n) => n.kind === 'topic' && (!n.parentId || n.parentId === 'repo')
  );

  const frontendSvcs = services.filter(isFrontend);
  const backendSvcs = services.filter((s) => !isFrontend(s));

  const areas: PlainNode[] = [];

  if (spec.explodeServices) {
    // Each service becomes its own top-level area (its features/files beneath).
    for (const s of services) {
      const subtree = buildServiceSubtree(index, s, isFrontend(s), detailLevel);
      const framework = typeof s.meta?.framework === 'string' ? s.meta.framework : undefined;
      const name = detailLevel === 'advanced' ? s.label : humanize(s.label);
      const title = detailLevel === 'advanced'
        ? s.label
        : /service$/i.test(name) ? name : `${name} service`;
      areas.push({
        id: `p:area:svc:${s.id}`,
        title,
        summary: serviceDescription(s, index, isFrontend(s), subtree.children),
        kind: 'area',
        children: subtree.children,
        sourceRefs: [s.id],
      });
    }
  } else {
    if (frontendSvcs.length > 0) {
      areas.push({
        id: 'p:area:frontend',
        title: spec.frontend.title,
        summary: spec.frontend.summary,
        kind: 'area',
        children: frontendSvcs.map((s) => buildServiceSubtree(index, s, true, detailLevel)),
        sourceRefs: frontendSvcs.map((s) => s.id),
      });
    }
    if (backendSvcs.length > 0) {
      areas.push({
        id: 'p:area:backend',
        title: spec.backend.title,
        summary: spec.backend.summary,
        kind: 'area',
        children: backendSvcs.map((s) => buildServiceSubtree(index, s, false, detailLevel)),
        sourceRefs: backendSvcs.map((s) => s.id),
      });
    }
  }

  if (datastores.length > 0 || looseTopics.length > 0) {
    const dataChildren = [
      ...datastores.map((d) => buildDataNode(index, d, detailLevel)),
      ...looseTopics.map((t) => buildTopicNode(t, detailLevel)),
    ];
    areas.push({
      id: 'p:area:data',
      title: spec.data.title,
      summary: spec.data.summary,
      kind: 'area',
      children: dataChildren,
      sourceRefs: [...datastores.map((d) => d.id), ...looseTopics.map((t) => t.id)],
    });
  }

  const root: PlainNode = {
    id: 'p:repo',
    title: detailLevel === 'advanced' ? (repo?.label ?? graph.repoName) : humanize(repo?.label ?? graph.repoName),
    summary: `Best-fit: ${type}. ${spec.framing}`,
    kind: 'group',
    children: areas,
    sourceRefs: ['repo'],
  };
  return attachEdgeRefs(root, graph);
}

/* ============================================================= digest ====== */

/** Cap the digest so a huge repo can't blow the prompt / token budget. */
const MAX_FILES_PER_SERVICE = 50;
const MAX_EDGES = 300;

/**
 * Choose WHICH edges reach the digest once the graph exceeds `MAX_EDGES`.
 *
 * This used to be `graph.edges.slice(0, MAX_EDGES)` — the first 300 edges in
 * whatever order the scanner appended them. Measured on this repository, that
 * meant the assistant saw `analyzer` 296 and `acp` 4, while `packages/web` —
 * 1545 edges, 67% of the graph and the entire product surface — contributed
 * NOTHING. The cap is necessary; taking it by array position was not.
 *
 * `pageRank` was already being computed on every scan (scan.ts) and written to
 * every file node as `meta.pageRank`, and nothing read it. An edge is weighted
 * by the sum of its endpoints' rank, so an edge between two central files
 * outranks one between two leaves.
 *
 * Two properties the callers depend on:
 *   - a graph that FITS the cap is returned untouched, in graph order, so the
 *     small-repo case (most of them) is byte-identical to before;
 *   - the selection is stable — ties break on original position, and the chosen
 *     edges are re-sorted back into graph order, so the digest still reads as a
 *     walk through the repo rather than a ranking table.
 */
function selectDigestEdges(graph: ArchGraph, cap: number): ArchEdge[] {
  if (graph.edges.length <= cap) return graph.edges;

  const rank = new Map<string, number>();
  for (const n of graph.nodes) rank.set(n.id, n.meta?.pageRank ?? 0);
  const weight = (e: ArchEdge) => (rank.get(e.srcId) ?? 0) + (rank.get(e.dstId) ?? 0);

  return graph.edges
    .map((edge, index) => ({ edge, index, w: weight(edge) }))
    .sort((a, b) => b.w - a.w || a.index - b.index)
    .slice(0, cap)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.edge);
}

export interface Digest {
  repo: { id: string; name: string };
  folders: string[];
  services: {
    id: string;
    name: string;
    dir?: string;
    framework?: string;
    modules: { id: string; label: string; fileIds: string[] }[];
    files: { id: string; path: string }[];
    truncatedFiles?: number;
    /**
     * What this service is written in, counted from its file nodes' real
     * `meta.language` / `meta.loc`. Per service, not per repo: the prompt bias
     * a 60% Python / 30% TypeScript repo needs is two sets of reading
     * instructions attached to the right services, not one repo-wide winner.
     */
    languages?: LanguageShare[];
  }[];
  datastores: { id: string; name: string; tech?: string; role?: string }[];
  topics: { id: string; name: string; parent?: string }[];
  edges: { id: string; from: string; to: string; kind: string; detail?: string }[];
  /**
   * Precomputed, GROUNDED risk facts (the MOAT feed): single points of failure
   * ranked by their REAL service-level blast radius, and circular dependencies —
   * both from the shared @sequence/schema engines over the service-level
   * projection. Compact by design (label/count only) so the JSON stays small; the
   * numbers are verbatim from computeRisks/computeCycles (no rounding/invention).
   */
  risks?: {
    /** Single points of failure: `breaks` of `of` components fail if `node` fails. */
    spofs: { node: string; kind: string; breaks: number; of: number }[];
    /** Circular dependencies: `members` mutually depend on each other. */
    cycles: { members: string[]; size: number }[];
    /** Denominator: rankable (non-repo) components in the service-level universe. */
    total: number;
  };
  /**
   * SERVICE-LEVEL EDGE ROLLUP — present only on the ORIENTATION INDEX.
   *
   * Real digest edges, grouped by the service (or datastore/topic) that owns
   * each endpoint, with the number of underlying edges each pair stands for.
   * Nothing is invented: every entry is a count of edges the scan produced, and
   * an edge whose endpoint belongs to no component is not rolled up at all — it
   * is reported as omitted instead of being guessed into a pair.
   *
   * Absent on a full digest, so a prompt built from one is byte-identical to
   * what it was before this field existed.
   */
  serviceEdges?: { from: string; to: string; kind: string; count: number }[];
}

/** Assemble the compact, bounded structure digest handed to the model. */
export function buildDigest(graph: ArchGraph, tree?: TreeNode): Digest {
  const services = graph.nodes.filter((n) => n.kind === 'service');
  const mixes = graphLanguageMix(graph);
  const index = buildGraphIndex(graph);
  const filesByService = groupFilesByService(graph, index, services);
  const digestServices: Digest['services'] = services.map((svc) => {
    const modules = childrenOf(index, svc.id).filter((n) => n.kind === 'module');
    const moduleFiles = new Set<string>();
    const digestModules = modules.map((m) => {
      const fileIds = childrenOf(index, m.id)
        .filter((n) => n.kind === 'file')
        .map((n) => n.id);
      for (const id of fileIds) moduleFiles.add(id);
      return { id: m.id, label: m.label, fileIds };
    });
    // Direct files (no module) plus module files, capped.
    const allFiles = filesByService.get(svc.id) ?? [];
    const shown = allFiles.slice(0, MAX_FILES_PER_SERVICE);
    const svcEntry: Digest['services'][number] = {
      id: svc.id,
      name: svc.label,
      dir: svc.path,
      framework: typeof svc.meta?.framework === 'string' ? svc.meta.framework : undefined,
      modules: digestModules,
      files: shown.map((f) => ({ id: f.id, path: f.path ?? f.label })),
    };
    const svcMix = mixes.byService.get(svc.id);
    if (svcMix && svcMix.shares.length > 0) svcEntry.languages = svcMix.shares;
    if (allFiles.length > shown.length) svcEntry.truncatedFiles = allFiles.length - shown.length;
    return svcEntry;
  });

  const datastores = graph.nodes
    .filter((n) => n.kind === 'datastore')
    .map((d) => ({
      id: d.id,
      name: d.label,
      tech: typeof d.meta?.tech === 'string' ? d.meta.tech : undefined,
      role: typeof d.meta?.role === 'string' ? d.meta.role : undefined,
    }));

  const topics = graph.nodes
    .filter((n) => n.kind === 'topic')
    .map((t) => ({ id: t.id, name: t.label, parent: t.parentId }));

  const edges = selectDigestEdges(graph, MAX_EDGES).map((e) => ({
    id: e.id,
    from: e.srcId,
    to: e.dstId,
    kind: e.kind,
    detail: e.detail ? summarizeDetail(e.detail) : undefined,
  }));

  const folders = tree
    ? (tree.children ?? []).filter((c) => c.type === 'dir').map((c) => c.name)
    : [];

  // Precompute GROUNDED risk facts over the SERVICE-level projection, using the
  // exact same shared engines the canvas uses — so a connected assistant answers
  // "what's fragile / what breaks if X fails / what's circular?" from precomputed
  // truth rather than deriving it. Compact-mapped to keep the JSON small; the
  // counts are verbatim (no rounding).
  const ri = serviceLevelRisksInput(graph);
  const spofs: SystemRisk[] = computeRisks(ri.edges, ri.nodes);
  const cycles: CyclicDependency[] = computeCycles(ri.edges, ri.nodes);
  const total = rankableNodeCount(ri.nodes);

  return {
    repo: { id: 'repo', name: graph.repoName },
    folders,
    services: digestServices,
    datastores,
    topics,
    edges,
    risks: {
      spofs: spofs.map((s) => ({ node: s.label, kind: s.kind, breaks: s.blastRadius, of: s.total })),
      // Cap the cycles list symmetrically with computeRisks' own DEFAULT_TOP_N
      // self-cap, so the digest JSON stays bounded on a pathological graph.
      cycles: cycles.slice(0, DEFAULT_TOP_N).map((c) => ({ members: c.labels, size: c.size })),
      total,
    },
  };
}

/**
 * Words that are common in asks but are not service/datastore names.
 * Matching these would scope every "how does this work" turn to a phantom node.
 */
const ASK_SCOPE_STOPWORDS = new Set([
  'the',
  'and',
  'how',
  'does',
  'what',
  'when',
  'where',
  'why',
  'who',
  'explain',
  'show',
  'tell',
  'about',
  'this',
  'that',
  'with',
  'from',
  'into',
  'for',
  'are',
  'was',
  'were',
  'can',
  'could',
  'would',
  'should',
  'will',
  'not',
  'any',
  'all',
  'its',
  'their',
  'our',
  'service',
  'services',
  'file',
  'files',
  'code',
  'source',
  'repo',
  'system',
  'component',
  'components',
  'node',
  'nodes',
  'graph',
  'please',
  'just',
  'like',
  'reach',
  'reaches',
  'talk',
  'talks',
  'work',
  'works',
  'fragile',
  'break',
  'breaks',
  'add',
  'remove',
  'rename',
  'using',
  'via',
  'between',
  'after',
  'before',
  'called',
  'reads',
  'write',
  'writes',
]);

function digestIdTail(id: string): string {
  const i = id.indexOf(':');
  return (i >= 0 ? id.slice(i + 1) : id).toLowerCase();
}

function digestSubjectAliases(id: string, name: string, extra?: string): string[] {
  const aliases = [id, name, digestIdTail(id)];
  if (extra) {
    aliases.push(extra);
    const seg = extra.replace(/\\/g, '/').split('/').filter(Boolean).pop();
    if (seg) aliases.push(seg);
  }
  return aliases.map((a) => a.toLowerCase());
}

function nodeIdInDigestService(svc: Digest['services'][number], nodeId: string): boolean {
  if (svc.id === nodeId) return true;
  if (svc.files.some((f) => f.id === nodeId)) return true;
  return svc.modules.some((m) => m.id === nodeId || m.fileIds.includes(nodeId));
}

/** Named services/datastores/topics in the question, plus an optional board selection. */
export function digestSubjectIds(
  digest: Digest,
  question: string,
  subjectNodeId?: string,
): Set<string> {
  const ids = new Set<string>();
  if (subjectNodeId) {
    const svc = digest.services.find((s) => nodeIdInDigestService(s, subjectNodeId));
    if (svc) ids.add(svc.id);
    if (digest.datastores.some((d) => d.id === subjectNodeId)) ids.add(subjectNodeId);
    if (digest.topics.some((t) => t.id === subjectNodeId)) ids.add(subjectNodeId);
  }

  const tokens = (question.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []).filter(
    (t) => !ASK_SCOPE_STOPWORDS.has(t),
  );
  if (tokens.length === 0) return ids;

  const candidates: { id: string; aliases: string[] }[] = [
    ...digest.services.map((s) => ({
      id: s.id,
      aliases: digestSubjectAliases(s.id, s.name, s.dir),
    })),
    ...digest.datastores.map((d) => ({
      id: d.id,
      aliases: digestSubjectAliases(d.id, d.name, d.tech),
    })),
    ...digest.topics.map((t) => ({
      id: t.id,
      aliases: digestSubjectAliases(t.id, t.name),
    })),
  ];

  for (const c of candidates) {
    for (const t of tokens) {
      if (c.aliases.some((a) => a === t || a === `svc:${t}` || a === `ds:${t}` || a === `topic:${t}`)) {
        ids.add(c.id);
        break;
      }
    }
  }
  return ids;
}

function digestEndpointOwner(digest: Digest, endpointId: string): string | null {
  if (digest.services.some((s) => s.id === endpointId)) return endpointId;
  if (digest.datastores.some((d) => d.id === endpointId)) return endpointId;
  if (digest.topics.some((t) => t.id === endpointId)) return endpointId;
  for (const s of digest.services) {
    if (s.files.some((f) => f.id === endpointId)) return s.id;
    if (s.modules.some((m) => m.id === endpointId || m.fileIds.includes(endpointId))) return s.id;
  }
  if (endpointId.startsWith('file:')) {
    const rel = endpointId.slice(5).replace(/\\/g, '/');
    for (const s of digest.services) {
      const dir = (s.dir ?? digestIdTail(s.id)).replace(/\\/g, '/');
      if (dir && (rel === dir || rel.startsWith(`${dir}/`))) return s.id;
    }
  }
  return null;
}

function expandDigestOneHop(digest: Digest, seeds: Set<string>): Set<string> {
  const kept = new Set(seeds);
  for (const e of digest.edges) {
    const fromOwner = digestEndpointOwner(digest, e.from);
    const toOwner = digestEndpointOwner(digest, e.to);
    if (fromOwner && seeds.has(fromOwner) && toOwner) kept.add(toOwner);
    if (toOwner && seeds.has(toOwner) && fromOwner) kept.add(fromOwner);
  }
  return kept;
}

export interface DigestScopeResult {
  digest: Digest;
  /** True when the ask named (or selected) subjects and the digest was cut. */
  scoped: boolean;
  omittedServices: number;
  omittedDatastores: number;
  omittedTopics: number;
  omittedEdges: number;
}

/**
 * Subject-subgraph digest for an attached ask: named/selected nodes + one hop
 * + those files/edges. Unscoped when the question names nothing in the digest
 * (fragility / whole-system asks keep the full map). Never invents edges.
 */
export function scopeDigestToAsk(
  digest: Digest,
  question: string,
  opts: { subjectNodeId?: string } = {},
): DigestScopeResult {
  const seeds = digestSubjectIds(digest, question, opts.subjectNodeId);
  if (seeds.size === 0) {
    return {
      digest,
      scoped: false,
      omittedServices: 0,
      omittedDatastores: 0,
      omittedTopics: 0,
      omittedEdges: 0,
    };
  }
  const kept = expandDigestOneHop(digest, seeds);
  const services = digest.services.filter((s) => kept.has(s.id));
  const datastores = digest.datastores.filter((d) => kept.has(d.id));
  const topics = digest.topics.filter((t) => kept.has(t.id));
  const edges = digest.edges.filter((e) => {
    const fromOwner = digestEndpointOwner(digest, e.from);
    const toOwner = digestEndpointOwner(digest, e.to);
    return Boolean(fromOwner && toOwner && kept.has(fromOwner) && kept.has(toOwner));
  });
  const omittedServices = digest.services.length - services.length;
  const omittedDatastores = digest.datastores.length - datastores.length;
  const omittedTopics = digest.topics.length - topics.length;
  const omittedEdges = digest.edges.length - edges.length;
  if (
    omittedServices === 0 &&
    omittedDatastores === 0 &&
    omittedTopics === 0 &&
    omittedEdges === 0
  ) {
    return {
      digest,
      scoped: false,
      omittedServices: 0,
      omittedDatastores: 0,
      omittedTopics: 0,
      omittedEdges: 0,
    };
  }
  return {
    digest: { ...digest, services, datastores, topics, edges },
    scoped: true,
    omittedServices,
    omittedDatastores,
    omittedTopics,
    omittedEdges,
  };
}

/** Honest marker for subject-scope drops — not a token-budget cut. */
export function askScopeOmissionLines(result: DigestScopeResult): string[] {
  if (!result.scoped) return [];
  const lines: string[] = [];
  if (result.omittedServices > 0) {
    lines.push(`…${result.omittedServices} more digest services omitted (not in the asked subgraph)`);
  }
  if (result.omittedDatastores > 0) {
    lines.push(
      `…${result.omittedDatastores} more digest datastores omitted (not in the asked subgraph)`,
    );
  }
  if (result.omittedTopics > 0) {
    lines.push(`…${result.omittedTopics} more digest topics omitted (not in the asked subgraph)`);
  }
  if (result.omittedEdges > 0) {
    lines.push(`…${result.omittedEdges} more digest edges omitted (not in the asked subgraph)`);
  }
  return lines;
}

/* ====================================================== orientation index === */

/**
 * ── THE DEFAULT USED TO FAIL OPEN, AND THAT WAS THE WHOLE BILL ─────────────
 *
 * {@link scopeDigestToAsk} cuts the digest to the subgraph a question NAMES.
 * When the question names nothing it returned the digest untouched — the FULL
 * map, every file path, every one of the 300 selected edges — and that is the
 * common case, not the rare one. MEASURED on this monorepo (956 nodes /
 * 2229 edges) by building the real prompt for eight realistic questions: six of
 * them found no seed and shipped 93,047 characters (~23,262 tokens), of which
 * the digest JSON was 87,440 (~21,860). "thanks" cost the same as "explain the
 * auth flow". Only the two questions that happened to name a package scoped at
 * all.
 *
 * A question with no named subject is not a request for everything. It is a
 * request the harness cannot scope YET, and the honest answer to that is a MAP
 * plus the tools to walk it, not the territory. This builds the map:
 *
 *   - every service, with its dir, framework, language mix and module LABELS,
 *     and an honest count of the files not listed;
 *   - every datastore and topic (they are already small);
 *   - the precomputed `risks` block (already small, and the one thing the model
 *     must never recompute by hand);
 *   - the real CROSS-COMPONENT edges, ids and endpoints intact — the wiring a
 *     reader of an architecture tool came for — plus {@link Digest.serviceEdges},
 *     a count-preserving rollup of them so the shape is legible at a glance.
 *
 * What it drops is what a tool can fetch: per-service file lists, module file
 * ids, and edges whose two endpoints live inside the SAME component. Each drop
 * is reported by {@link askIndexOmissionLines} in the model's own prompt, and
 * `read_topology` expands one named service back to full detail on request.
 *
 * COVERAGE IS UNAFFECTED AS A CONTRACT: the edges left in the index are real
 * digest edges with their real ids, so `computeAskCoverage` still measures the
 * object that was serialized and nothing is credited that the model was not
 * shown.
 */
export interface DigestIndexResult {
  digest: Digest;
  /** True when an index was built (false ⇒ `digest` is the input, untouched). */
  indexed: boolean;
  omittedFiles: number;
  omittedModuleFileIds: number;
  /** Edges dropped because both endpoints sit inside one component. */
  omittedInternalEdges: number;
  /**
   * File-level edges NOT rolled up to a service connection.
   *
   * Its own counter rather than a share of `omittedInternalEdges`, which means
   * "both endpoints inside one component". These are omitted for a different
   * reason -- an import is a claim about two FILES, and presenting it as a
   * service connection asserts at the system level something measured at the
   * file level. Two reasons behind one number would tell the model a true total
   * and a false cause.
   */
  omittedFileLevelEdges: number;
  /** Edges dropped because an endpoint belongs to no component at all. */
  omittedUnownedEdges: number;
}

/**
 * Below this the full digest IS the index — a small repo has nothing to hide,
 * and paying a round trip to expand a ten-file service would cost more than the
 * bytes it saved. Set at half {@link DIGEST_BUDGET_TOKENS}' worth of characters
 * so it sits between every fixture in this repository (all under 10,000
 * characters) and every real scan measured here (87,440).
 */
export const ASK_INDEX_MIN_DIGEST_CHARS = 24_000;

/** True when an unscoped ask should be handed the index instead of the map. */
export function shouldIndexDigestForAsk(digest: Digest, scoped: boolean): boolean {
  if (scoped) return false;
  return JSON.stringify(digest).length > ASK_INDEX_MIN_DIGEST_CHARS;
}

/**
 * Build the orientation index. Never invents a service, an edge or a count:
 * every number here is a length taken off the input digest.
 */
export function indexDigestForAsk(digest: Digest): DigestIndexResult {
  let omittedFiles = 0;
  let omittedModuleFileIds = 0;
  const services = digest.services.map((s) => {
    omittedFiles += s.files.length;
    for (const m of s.modules) omittedModuleFileIds += m.fileIds.length;
    const entry: Digest['services'][number] = {
      id: s.id,
      name: s.name,
      ...(s.dir !== undefined ? { dir: s.dir } : {}),
      ...(s.framework !== undefined ? { framework: s.framework } : {}),
      modules: s.modules.map((m) => ({ id: m.id, label: m.label, fileIds: [] })),
      files: [],
      /* `truncatedFiles` already means "files this service has that are not
         listed here", and the model already knows how to read it. Adding the
         ones this index dropped keeps one counter honest rather than inventing
         a second. */
      truncatedFiles: (s.truncatedFiles ?? 0) + s.files.length,
      ...(s.languages !== undefined ? { languages: s.languages } : {}),
    };
    return entry;
  });

  let omittedInternalEdges = 0;
  let omittedFileLevelEdges = 0;
  let omittedUnownedEdges = 0;
  const crossEdges: Digest['edges'] = [];
  const rollup = new Map<string, { from: string; to: string; kind: string; count: number }>();
  for (const e of digest.edges) {
    /*
     * AN IMPORT IS NOT A SERVICE-LEVEL CLAIM, and this was the one consumer
     * that said otherwise. It rolled imports up into 162 service-to-service
     * edges for the prompt while the board refused to draw them, impact
     * refused to use them and risks refused to count them -- so the model was
     * told, as structure, precisely what CANON's first non-negotiable forbids
     * the board from asserting.
     *
     * The file-level edges remain in the digest as file-level facts. What
     * stops is presenting them to the model as connections between services.
     */
    if (!isServiceLevelEdgeKind(e.kind)) {
      omittedFileLevelEdges += 1;
      continue;
    }
    const fromOwner = digestEndpointOwner(digest, e.from);
    const toOwner = digestEndpointOwner(digest, e.to);
    if (!fromOwner || !toOwner) {
      omittedUnownedEdges += 1;
      continue;
    }
    if (fromOwner === toOwner) {
      omittedInternalEdges += 1;
      continue;
    }
    crossEdges.push(e);
    const key = JSON.stringify([fromOwner, toOwner, e.kind]);
    const hit = rollup.get(key);
    if (hit) hit.count += 1;
    else rollup.set(key, { from: fromOwner, to: toOwner, kind: e.kind, count: 1 });
  }

  return {
    digest: { ...digest, services, edges: crossEdges, serviceEdges: [...rollup.values()] },
    indexed: true,
    omittedFiles,
    omittedModuleFileIds,
    omittedInternalEdges,
    omittedFileLevelEdges,
    omittedUnownedEdges,
  };
}

/** Honest markers for what the orientation index left out, and how to get it. */
export function askIndexOmissionLines(result: DigestIndexResult): string[] {
  if (!result.indexed) return [];
  const lines: string[] = [];
  if (result.omittedFiles > 0) {
    lines.push(
      `…${result.omittedFiles} digest file paths omitted (this is an INDEX; call read_topology with a service id for one service's real files, or search_files / read_file for the rest)`,
    );
  }
  if (result.omittedModuleFileIds > 0) {
    lines.push(`…${result.omittedModuleFileIds} module file ids omitted (same expansion)`);
  }
  if (result.omittedFileLevelEdges > 0) {
    /* NAMED AS WHAT IT IS, and pointed at the tool that returns them. The model
       is told these exist and are file-level, rather than being handed them as
       service connections it would then repeat as system structure. */
    lines.push(
      `…${result.omittedFileLevelEdges} file-level edges (imports) are NOT shown as service connections — an import relates two files, not two services; call read_topology or search_files for the file-level facts`,
    );
  }
  if (result.omittedInternalEdges > 0) {
    lines.push(
      `…${result.omittedInternalEdges} digest edges omitted (both endpoints inside one component; the cross-component edges above are complete for this digest)`,
    );
  }
  if (result.omittedUnownedEdges > 0) {
    lines.push(
      `…${result.omittedUnownedEdges} digest edges omitted (an endpoint belongs to no component, so they were NOT rolled up into serviceEdges)`,
    );
  }
  return lines;
}

/**
 * The one instruction that makes the index safe to hand a weak model.
 *
 * MEASURED, and the reason this sentence exists: asked which file implements
 * the staleness detection behind `/api/status`, a local model answered from the
 * FULL digest with `checkpointStore.ts` and a method `getCheckpointInfo` — a
 * method that exists nowhere in the repository (grep: 0 hits) — with zero tool
 * calls, and the composer put a "grounded on sequence" chip beside it. A model
 * handed a map and told it is a map has a reason to look; a model handed 87 KB
 * of JSON believes it has already looked.
 */
export const ASK_INDEX_RETRIEVAL_CLAUSE =
  'The STRUCTURE DIGEST above is an INDEX, not the full structure: it lists every service, ' +
  'datastore, topic, module and cross-component edge, but NOT the files inside each service. ' +
  'Before you name a file, a function, a symbol, or a line of code, you MUST retrieve it — ' +
  '`read_topology` expands one service to its real file list, `search_files` greps the repo, ' +
  '`read_file` reads one file. Do NOT answer a question about specific code from the index ' +
  'alone, and NEVER name a file or symbol you have not seen in a tool result or in the FILE ' +
  'RESEARCH section. If you cannot retrieve it, say what you looked for and that you did not ' +
  'find it — that is a correct answer; a plausible invented one is not.';

/* ============================================================== coverage === */

/**
 * WHAT ONE ASK ACTUALLY SAW, measured against the WHOLE GRAPH.
 *
 * This is the one thing a terminal agent structurally cannot report. Codex and
 * Claude Code read files until they stop; there is no denominator anywhere in
 * that loop, so "what did you not look at" has no answer. Sequence scans first,
 * so the denominator exists — and until item 1.1 it was thrown away.
 *
 * THE DEFECT THIS REPLACES. Every omission number in this module was computed
 * against the digest — `digest.edges.length - edges.length` in
 * {@link scopeDigestToAsk}, `d.edges.splice(...)` counts in
 * {@link fitDigestToBudget}. The digest has ALREADY had `MAX_EDGES` applied to
 * it, so the largest number any of them could ever report was the cap itself.
 *
 * MEASURED on this repository, 2026-08-20 (1425 nodes / 2847 edges): the digest
 * carries 300 of those 2847 edges, and `packages/web` puts 1567 edges into the
 * graph and 60 into the digest. Nothing anywhere reported the other 2547. Those
 * numbers move with every scanner change — which is why the locking tests pin
 * `edgesTotal === graph.edges.length` and never a count.
 *
 * Every field here is counted against `graph.edges.length`.
 */
/**
 * ONE DECLARATION, IN THE SHARED CONTRACT.
 *
 * This shape used to be declared here and nowhere else, while the server put it
 * on the `result` event that every client reads — so the field was on the wire
 * and missing from the type, and `packages/web2` could not render it without
 * asserting a field TypeScript said did not exist. Re-exported rather than
 * redeclared so the two can never drift again.
 *
 * MEASURED, and worth keeping next to the type: for a whole-system ask
 * `packagesMissed` is legitimately empty — ranked selection reaches every
 * package and the loss shows up as depth (web 1567 → 60) rather than absence. A
 * SCOPED ask is where it bites: "what does packages/web depend on" renders 60 of
 * 2847 edges and misses ten packages outright.
 */
export type { AskCoverage } from '@sequence/api-types';

/** Native separators are an artifact of the scanning machine, never of the repo. */
function normalizeComponentPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * `nodeId → the component that contains it`, memoised over the containment
 * chain. Walks `parentId` to the first `service` ancestor exactly as
 * {@link groupFilesByService} does, so coverage and the digest agree about what
 * "inside packages/web" means. Every node on a walk resolves to the same owner,
 * so the whole chain is memoised at once — O(nodes), not O(nodes × depth).
 */
function componentOwnerLookup(graph: ArchGraph): (nodeId: string) => string | null {
  const byId = new Map<string, ArchNode>(graph.nodes.map((n) => [n.id, n]));
  const componentName = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.kind === 'service') componentName.set(n.id, normalizeComponentPath(n.path ?? n.label));
  }
  const memo = new Map<string, string | null>();
  return (nodeId: string): string | null => {
    const hit = memo.get(nodeId);
    if (hit !== undefined) return hit;
    const chain: string[] = [];
    const seen = new Set<string>();
    let owner: string | null = null;
    let cur: ArchNode | undefined = byId.get(nodeId);
    while (cur) {
      if (seen.has(cur.id)) break; // malformed parent cycle — never spin
      seen.add(cur.id);
      const name = componentName.get(cur.id);
      if (name !== undefined) {
        owner = name;
        break;
      }
      chain.push(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    for (const id of chain) memo.set(id, owner);
    memo.set(nodeId, owner);
    return owner;
  };
}

/**
 * Coverage for one ask: what the model was shown, over what exists.
 *
 * `seen` is the digest AS RENDERED into the prompt — after the `MAX_EDGES` cap,
 * after ask-scoping, and after the token-budget fit. Passing the pre-cut digest
 * here would reintroduce exactly the blindness this replaces, which is why
 * {@link buildAskPromptWithCoverage} takes the digest from the render itself
 * rather than reconstructing it.
 *
 * Never invents: an edge whose endpoints belong to no service contributes to
 * `edgesTotal` and to no package, and a graph with no service nodes reports
 * empty package lists rather than a guess.
 */
export function computeAskCoverage(graph: ArchGraph, seen: Pick<Digest, 'edges'>): AskCoverage {
  const ownerOf = componentOwnerLookup(graph);
  const withEdgesInGraph = new Set<string>();
  for (const e of graph.edges) {
    const src = ownerOf(e.srcId);
    if (src) withEdgesInGraph.add(src);
    const dst = ownerOf(e.dstId);
    if (dst) withEdgesInGraph.add(dst);
  }
  const withEdgesSeen = new Set<string>();
  for (const e of seen.edges) {
    const src = ownerOf(e.from);
    if (src) withEdgesSeen.add(src);
    const dst = ownerOf(e.to);
    if (dst) withEdgesSeen.add(dst);
  }
  return {
    edgesSeen: seen.edges.length,
    edgesTotal: graph.edges.length,
    packagesSeen: [...withEdgesSeen].sort(),
    packagesMissed: [...withEdgesInGraph].filter((p) => !withEdgesSeen.has(p)).sort(),
  };
}

/**
 * Is `file` inside service `svcId` (directly or via a module)?
 *
 * THE REFERENCE ORACLE. This is the original, obviously-correct definition,
 * kept verbatim (bar the id→node map now being handed in instead of rebuilt on
 * every call) so the fast path below can be tested against it node-for-node —
 * see `explain-perf.test.ts`. Production reads {@link groupFilesByService};
 * this stays as the thing that says what "inside" means.
 */
export function ancestorIsService(
  byId: Map<string, ArchNode>,
  file: ArchNode,
  svcId: string
): boolean {
  let cur: ArchNode | undefined = file;
  const seen = new Set<string>();
  while (cur) {
    if (cur.id === svcId) return true;
    if (seen.has(cur.id)) return false; // malformed parent cycle — never spin
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

/**
 * Every file node of each service, in graph node order — the same lists
 * `graph.nodes.filter((n) => n.kind === 'file' && ancestorIsService(...))` used
 * to produce per service, computed in ONE pass instead of `services × files ×
 * nodes` (see {@link GraphIndex} for the numbers this cost on n8n).
 *
 * Each file walks UP its own containment chain once and is appended to every
 * service it finds on the way, so a service nested inside another service still
 * collects the file exactly as the per-service ancestor test did.
 */
export function groupFilesByService(
  graph: ArchGraph,
  index: GraphIndexLike,
  services: ArchNode[]
): Map<string, ArchNode[]> {
  const out = new Map<string, ArchNode[]>();
  const serviceIds = new Set<string>();
  for (const svc of services) {
    serviceIds.add(svc.id);
    out.set(svc.id, []);
  }
  for (const n of graph.nodes) {
    if (n.kind !== 'file') continue;
    let cur: ArchNode | undefined = n;
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur.id)) break; // malformed parent cycle — never spin
      seen.add(cur.id);
      if (serviceIds.has(cur.id)) out.get(cur.id)!.push(n);
      cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
    }
  }
  return out;
}

/** The only part of {@link GraphIndex} `groupFilesByService` needs. */
interface GraphIndexLike {
  byId: Map<string, ArchNode>;
}

/** One short string from an edge's detail, for the digest (keeps it compact). */
function summarizeDetail(detail: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof detail.method === 'string' && typeof detail.pathPattern === 'string') {
    parts.push(`${detail.method} ${detail.pathPattern}`);
  } else if (typeof detail.pathPattern === 'string') {
    parts.push(detail.pathPattern);
  }
  if (typeof detail.topic === 'string') parts.push(`topic ${detail.topic}`);
  if (typeof detail.table === 'string') parts.push(`table ${detail.table}`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/* ======================================================== digest budget ==== */

/**
 * TOTAL budget for the structure digest handed to a provider: 48 000 tokens
 * ≈ 192 000 characters.
 *
 * MEASURED (scan of the real Sequence monorepo, 804 nodes / 40 edges):
 * `JSON.stringify(digest)` = 69 179 characters ≈ 17 300 tokens; the assembled
 * explain prompt = 71 294 characters. Fixtures: `shopfront` 8 635, `monorepo-apps`
 * 2 899, `plainapp` 1 193 characters. The budget is ~2.8× the real Sequence repo
 * and ~22× the biggest fixture, so nothing we scan today is cut and today's
 * prompts are byte-identical apart from the untrusted wrapper.
 *
 * WHY A TOTAL BUDGET AT ALL. `buildDigest`'s own caps are PER SERVICE
 * (`MAX_FILES_PER_SERVICE`) plus a global `MAX_EDGES` — a repo with a hundred
 * services still produces a hundred × fifty-file digest. This is the guardrail
 * for that case (the 1140-file fastapi scan), not a behaviour change.
 */
const DIGEST_BUDGET_TOKENS = 48_000;

/**
 * The digest budget for AGENTIC EDIT turns (full permission + edit intent).
 *
 * Measured on SWE-bench (django, 2,621 nodes, mini-50 runs v6-v9): the full
 * index rendered at ~90k raw / 48k budgeted tokens PER ROUND, was resent
 * every round, and the answers cited ZERO digest edges — an editing turn
 * localizes from the issue's own file paths and symbols through
 * search_files/locate_symbol, not from a whole-repo map. A quarter of the
 * everyday budget keeps the top-level shape (services, key modules) while
 * accounting for path-dense JSON tokenizing at ~1.4 chars/token on real
 * providers (measured: a 28k-estimated prompt billed as 80,880 input), so
 * freeing ~36k tokens per round for evidence that is actually used. The
 * omission markers and the index-retrieval clause already tell the model,
 * honestly, that the rest is one tool call away.
 */
const AGENTIC_EDIT_DIGEST_BUDGET_TOKENS = 8_000;

/** What a budget cut removed from a digest. All zero ⇒ nothing was cut. */
interface DigestOmissions {
  edges: number;
  files: number;
  services: number;
}

/**
 * Cut a digest down to `budgetTokens`, TAIL-FIRST, in ascending order of value:
 * edges first (the digest already carries the same relationships structurally
 * through service/module/file containment), then per-service file lists from the
 * LAST service backwards (which increments the EXISTING, honest `truncatedFiles`
 * counter the model already knows how to read), then whole services.
 *
 * No relevance ranking is invented — `buildDigest`'s ordering is the ordering.
 * Returns the input digest untouched when it already fits, which is the case for
 * every repo and fixture we scan today.
 */
function fitDigestToBudget(
  digest: Digest,
  budgetTokens: number,
  reserveChars = 0,
): { digest: Digest; omitted: DigestOmissions } {
  /* THE WRAPPER IS PART OF THE PROMPT. The JSON does not reach the model bare:
     it is wrapped in the untrusted-content markers, and those bytes are paid
     for like any others. Budgeting the payload alone under-counted by the
     length of the wrapper, which only ever showed up when a cut landed close
     to the line. */
  const limit = budgetChars(budgetTokens) - reserveChars;
  const none: DigestOmissions = { edges: 0, files: 0, services: 0 };
  if (JSON.stringify(digest).length <= limit) return { digest, omitted: none };

  const d: Digest = {
    ...digest,
    edges: [...digest.edges],
    services: digest.services.map((s) => ({ ...s, files: [...s.files] })),
  };
  const omitted: DigestOmissions = { edges: 0, files: 0, services: 0 };
  const over = (): number => JSON.stringify(d).length - limit;

  // 1. Edge list, from the tail.
  while (over() > 0 && d.edges.length > 0) {
    const per = Math.max(1, JSON.stringify(d.edges).length / d.edges.length);
    const drop = Math.min(d.edges.length, Math.max(1, Math.ceil(over() / per)));
    d.edges.splice(d.edges.length - drop, drop);
    omitted.edges += drop;
  }
  // 2. Per-service file lists, last service first. `truncatedFiles` keeps the
  //    count honest inside the JSON itself, exactly as the per-service cap does.
  for (let i = d.services.length - 1; i >= 0 && over() > 0; i--) {
    const svc = d.services[i];
    if (svc.files.length === 0) continue;
    const per = Math.max(1, JSON.stringify(svc.files).length / svc.files.length);
    const drop = Math.min(svc.files.length, Math.max(1, Math.ceil(over() / per)));
    svc.files.splice(svc.files.length - drop, drop);
    svc.truncatedFiles = (svc.truncatedFiles ?? 0) + drop;
    omitted.files += drop;
  }
  // 3. Whole services, from the tail. Last resort — only a digest whose service
  //    HEADERS alone blow the budget ever reaches this.
  while (over() > 0 && d.services.length > 0) {
    d.services.pop();
    omitted.services += 1;
  }
  return { digest: d, omitted };
}

/**
 * Render the digest as prompt lines: the section heading, the (budgeted,
 * sentinel-neutralized) JSON inside one `<untrusted_repo_content>` block, and an
 * honest omission marker per category that was cut.
 *
 * WHY WRAP JSON AT ALL. JSON escaping already stops a file path from breaking
 * OUT of its string — that part was structurally safe before this change and is
 * why the individual values are not double-wrapped. What it never stopped is the
 * model READING an instruction inside a value ("ignore previous instructions" as
 * a folder name) and acting on it. The block + the one instruction line above it
 * are what make the whole payload legible to the model as data.
 *
 * `onRendered` receives the digest AS IT WENT INTO THE PROMPT — post-budget-fit,
 * so a caller measuring coverage counts what the model was actually shown rather
 * than what it was offered. It is a report, never a hook: it cannot change the
 * lines, and a caller that omits it gets a byte-identical section.
 */
function renderDigestSection(
  digest: Digest,
  onRendered?: (rendered: Digest) => void,
  budgetTokens: number = DIGEST_BUDGET_TOKENS,
): string[] {
  const fit = fitDigestToBudget(
    digest,
    budgetTokens,
    UNTRUSTED_OPEN.length + UNTRUSTED_CLOSE.length + 2,
  );
  onRendered?.(fit.digest);
  const L = [
    '--- STRUCTURE DIGEST (JSON) ---',
    ...wrapUntrustedLines([JSON.stringify(neutralizeDeep(fit.digest))]),
  ];
  if (fit.omitted.edges > 0) L.push(omissionMarker(fit.omitted.edges, 'digest edges'));
  if (fit.omitted.files > 0) L.push(omissionMarker(fit.omitted.files, 'digest files'));
  if (fit.omitted.services > 0) L.push(omissionMarker(fit.omitted.services, 'digest services'));
  return L;
}

/* =============================================================== prompt ==== */

/**
 * Attached-repo ask: additive / design-change turns emit a ghost proposal
 * (```seqd fence) — never fake scan evidence. Kept short for DeepSeek flash.
 */
const SEQD_ENUM_HINT =
  `Valid node kinds: ${SEQ_DIAGRAM_NODE_KINDS.join(', ')}. Valid edge families: ${SEQ_DIAGRAM_EDGE_FAMILIES.join(', ')}. ` +
  'Each edge: {id, from, to, family, label?}.';

/** Shared host-owned proposal gate — appended by every seqd/whiteboard directive. */
const ASK_HOST_PROPOSAL_GATE =
  'Host owns Accept/Deny UI — never write Accept/Deny instructions.';

/** Shared register-matching clause (attached + design) — one copy, both prompts. */
const ASK_REGISTER_MATCHING_CLAUSE =
  'Match the user\'s register, length, and format to how they asked: keep it simple ' +
  'if they want simple, terse and technical if they ask for that, step-by-step if they ' +
  'ask to be walked through it — mirror their level and vocabulary. When they give no ' +
  'signal, default to concise, structured notes (short lines over prose walls). Never ' +
  'pad, never restate the question, never add filler — every line earns its place.';

/*
 * WHAT THE TRANSCRIPT ACTUALLY RENDERS.
 *
 * This clause exists because the prompt and the surface contradicted each other,
 * and the reader got the wreckage. The register clause above used to say "short
 * BULLETS over prose walls", while web2/src/chat/proseBlocks.ts refuses bullets
 * - along with headings, bold, quotes and tables - for a reason that holds:
 *
 *   "`**` appears in globs, in diffs and in shell. A markdown bullet is `- ` and
 *    a diff removal line is `- ` just as often. This product's answers are full
 *    of diffs, so a list pass would turn deleted code into bullets - silently,
 *    and in the one surface whose job is fidelity."
 *
 * The renderer is right. Asking the model for markdown that will never be
 * interpreted is what produced screens of literal #### and ** in the owner's run
 * on 2026-08-24. Fenced and inline code ARE rendered, because a fence has an
 * explicit opening and closing marker and cannot be produced by accident - that
 * is the whole rule, and it is why those two are safe and the rest are not.
 *
 * Changing what the transcript renders means changing this clause in the same
 * commit. test/explain.test.ts names both sides so the pair cannot drift apart.
 */
const ASK_TRANSCRIPT_FORMAT_CLAUSE =
  'FORMAT FOR THE SURFACE YOU ARE ON. The transcript renders fenced code blocks and inline ' +
  'code spans, and NOTHING ELSE - markdown headings, bold, and bullet lists reach the reader ' +
  'as the literal characters you typed. Write plain prose in short paragraphs. Never open a ' +
  'line with a # heading marker. Never wrap text in double asterisks. Never write a bullet ' +
  'list. Put paths, identifiers, commands and snippets in backticks, and anything multi-line ' +
  'in a fence - those are the two things that will actually be formatted. Lead with the answer ' +
  'in one or two sentences, add detail only where the question asked for it, and stop when it ' +
  'is answered.';

/**
 * Weak-model prep — owner walk: chat invented "1¢/day" instead of asking tickers/sources/model.
 * UNFINISHED: Hermes MEMORY.md / FTS5 / skill distill as the default ask loop is not shipped.
 * Sessions + recent turns exist; that is not MEMORY.md — never claim it is.
 */
const ASK_PREP_AND_COST_CLAUSE =
  'PREPARE BEFORE YOU PROPOSE: If the user asks to design architecture, a daily job, a report, ' +
  'or anything that needs inputs you do not have (tickers, data sources, accuracy bar, which model, ' +
  'schedule, cost), ASK those clarifying questions FIRST in plain English. Do not emit a ```seqd ' +
  'fence until they answer. Never invent a dollar cost, a per-day price, or a "1¢" figure. ' +
  'Electricity for a local model is not a model-API bill; twice-daily multi-source reports on ' +
  'GPT-class APIs are not one cent. If cost is unknown, say unknown. Do not claim session MEMORY.md ' +
  'or Hermes long-term memory shipped — you have recent chat turns only.';

/**
 * Owner walk: "figure it out / map it out" must not start a second clarifying round.
 * Placed after PREPARE so it wins for that turn.
 */
const ASK_FIGURE_IT_OUT_CLAUSE =
  'FIGURE IT OUT: If the user says figure it out, map it out, you decide, I\'m not sure, ' +
  'just pick, or equivalent — they want a diagram now, not another clarifying round. ' +
  'Do NOT ask clarifying questions. State 3–5 numbered assumptions in plain English, then CALL ' +
  'the `propose_topology` tool (attached repo) or emit one ```seqd fence (no repository). ' +
  'Every node uses "label" (never "name") and only valid kinds from the enum. Never invent kinds. ' +
  'This overrides PREPARE BEFORE YOU PROPOSE for this turn.';

/**
 * The same instruction with its precondition ALREADY SATISFIED, for design mode.
 *
 * WHY A SECOND CONSTANT INSTEAD OF PUSHING THE FIRST ONE. On 2026-09-08 the fix
 * for "make sure it's doing system design" pushed `ASK_FIGURE_IT_OUT_CLAUSE`
 * whenever `proposeArchitecture` was set, and the model went on asking "compact
 * overview or detailed diagram?" anyway. Dumping the assembled prompt showed the
 * clause present and the model reading it correctly: it opens **"If the user
 * says figure it out, map it out, you decide … "**, the user had said none of
 * those things, so the condition was unmet and the model skipped it. It was
 * being obedient, not disobedient.
 *
 * A clause that re-tests its own trigger in prose cannot be repurposed by
 * pushing it from a new call site. The caller's decision has to be IN the text,
 * which is what this constant is: no condition, no word-matching, nothing for
 * the model to evaluate away.
 *
 * The assumptions requirement is carried over deliberately and is the honest
 * half — suppressing the question without it would just move the guessing
 * somewhere the user cannot see.
 */
const ASK_DESIGN_PROPOSE_NOW_CLAUSE =
  'PROPOSE NOW: This turn is a DESIGN request for a system that does not exist yet. ' +
  'The user has already chosen to design rather than to scope. ' +
  'Do NOT ask clarifying questions and do NOT ask whether they want a compact or detailed ' +
  'diagram — decide it yourself. State 3–5 numbered assumptions in plain English (scale, ' +
  'read/write mix, latency, anything else you had to pick), then CALL the `propose_topology` ' +
  'tool (attached repo) or emit one ```seqd fence (no repository). ' +
  'Every node uses "label" (never "name") and only valid kinds from the enum. Never invent kinds. ' +
  'This overrides PREPARE BEFORE YOU PROPOSE and any instruction to clarify first.';

export function isFigureItOutAsk(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\bfigure it out\b/.test(q) ||
    /\bmap it out\b/.test(q) ||
    /\byou decide\b/.test(q) ||
    /\bi['’]?m not sure\b/.test(q) ||
    /\bjust (pick|choose|decide|draw|show|map)\b/.test(q) ||
    /\bgo ahead and (design|map|draw)\b/.test(q) ||
    /\bno more questions\b/.test(q) ||
    /\bstop asking\b/.test(q) ||
    /\bquit asking\b/.test(q) ||
    /\bdon['’]?t (?:ask|want).{0,48}questions?\b/.test(q) ||
    /\bvisual example\b/.test(q) ||
    /\bshow me (?:how|what|the)\b/.test(q)
  );
}

/**
 * Owner seat-walk: "show me X on the board" must propose a diagram, not refuse
 * with "the outline is blank / I won't invent". Same override posture as FIGURE IT OUT.
 */
export function isShowOnBoardAsk(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\bshow(?:\s+\w+){0,6}\s+on\s+(?:the\s+)?(?:board|architecture|canvas)\b/.test(q) ||
    /\b(?:draw|map|put|place|sketch|render)\s+(?:it|this|that|them|one)?\s*on\s+(?:the\s+)?(?:board|architecture|canvas)\b/.test(
      q,
    ) ||
    /\bon\s+(?:the\s+)?board(?:\s+as\s+well)?\b/.test(q) ||
    /\bmap\s+(?:it|this|that)?\s*(?:out|onto)\b/.test(q) ||
    /\bjust show me\b/.test(q) ||
    /\bdraw (?:it|this|that|one)\b/.test(q)
  );
}

const ASK_SHOW_ON_BOARD_CLAUSE =
  'SHOW ON THE BOARD: If the user asks to show, draw, map, or put something on the board ' +
  '(or architecture / canvas) — including a named system with no outline drawn yet — they want a ' +
  'diagram now. Do NOT refuse with "the outline is blank", "nothing is defined yet", or "I will not ' +
  'invent". Frame the answer as a design proposal (state assumptions), then CALL `propose_topology` ' +
  '(or emit one ```seqd fence when no repository is attached). Write reasoning in plain English ' +
  'beside the call, never instead of it. This overrides PREPARE BEFORE YOU PROPOSE for this turn.';

/*
 * ── THE DIRECTIVE THAT ASKED FOR A FORMAT NOTHING READ ────────────────────
 *
 * This used to say: "Emit a PROPOSAL instead: (1) brief plain-English plan,
 * (2) one ```seqd fence with valid SeqDiagram v1 JSON … set grounded.origin to
 * design", with an example object and an enum hint.
 *
 * NO CODE ANYWHERE PARSED THAT FENCE. The board's whole ghost layer — Accept,
 * Deny, the dashed rendering, fourteen tests — sat behind `canvas/proposal`,
 * which was dispatched by nothing. So the product spent tokens every turn
 * asking models to produce architecture proposals in a format it could not
 * read, and then showed the reader a JSON blob in the middle of an answer.
 *
 * MEASURED, not reasoned about: `tools/bench/weak-model.mjs` ran a local 6.9B
 * model against this exact instruction and it complied perfectly — a fenced
 * SeqDiagram with `"origin":"design"`, two invented services, sitting in the
 * prose where nothing would ever pick it up. The model was not the problem.
 *
 * `propose_topology` is the channel now, and this says so. The tool refuses a
 * node carrying `evidenceRef`, so the "never present new parts as scanned"
 * rule below is no longer only an instruction — it is enforced at the door.
 */
/**
 * THE IDS THIS REPOSITORY ACTUALLY HAS, handed over BEFORE the model guesses.
 *
 * MEASURED, twice, on two different tasks. `tools/bench/weak-model.mjs`:
 *
 *     TOOLS      0 calls, 0 REFUSED
 *     TOPOLOGY   0 proposal(s) reached the board
 *
 * and in the owner's own run, asked "show me a change on the board you might
 * offer", the model wrote an essay proposing a node type and drew NOTHING.
 *
 * When it does call the tool it invents endpoints - `svc:api` on a repo that has
 * no such node - and the guard refuses them, correctly. But a refusal arrives
 * after the attempt, and a weak model cannot infer a naming scheme from prose.
 * Naming the real ids up front costs a few dozen tokens and removes the guess.
 *
 * BOUNDED. A repository with four hundred services would otherwise spend the
 * prompt on a list nobody reads; the count is stated so the sample is not
 * mistaken for the whole.
 */
function topologyVocabulary(digest: Digest): string {
  const ids = [
    ...digest.services.map((s) => s.id),
    ...digest.datastores.map((d) => d.id),
    ...digest.topics.map((t) => t.id),
  ];
  if (ids.length === 0) return '';
  const shown = ids.slice(0, 20);
  const tail = ids.length > shown.length ? ` (${ids.length} in all)` : '';
  return (
    ` The ids that exist in this repository include: ${shown.join(', ')}${tail}. ` +
    'Every edge endpoint must be one of those, or a new node you declare in the same call.'
  );
}

const ASK_ATTACHED_PROPOSAL_DIRECTIVE =
  'ADDITIONS ONLY. If the user asks you to change, add to, extend, redesign or SHOW '  +
  'anything about the architecture - including "show me on the board", "what would you '  +
  'change", "map this onto the board", or any request for a diagram - the answer is a '  +
  'CALL TO `propose_topology`. Describing the change in prose puts nothing on the board, '  +
  'and the board is what was asked for. Write the reasoning in plain English BESIDE the '  +
  'call, never instead of it. Then: do NOT ' +
  'present new parts as scanned — they are not in the digest, and a proposed node that claims ' +
  'evidence is REFUSED. Do not write the diagram into your answer as JSON or as a fence: ' +
  'CALL THE `propose_topology` TOOL with the new nodes and edges, and write your plan in plain ' +
  'English beside it. This tool cannot remove or rename nodes, and it cannot delete, replace, ' +
  'or rewire existing edges. For those requests, state that limitation plainly and do not call ' +
  'the tool as if it could apply them. New nodes use design:… or proposal:… ids with English ' +
  'labels; existing parts reuse real digest ids. Every edge endpoint must be a new node in the ' +
  'proposal or a real digest id; unknown endpoints are refused. ' +
  ASK_HOST_PROPOSAL_GATE +
  ' Never refuse with "provide the JSON". ' +
  SEQD_ENUM_HINT;

/** Design / repo-less ask: reinforce English prose + optional seqd proposal fence. */
const ASK_DESIGN_SEQD_DIRECTIVE =
  'When a diagram helps, answer in plain English and include one ```seqd fence (SeqDiagram v1). ' +
  'Use design:… or proposal:… ids, English labels, grounded.origin "design". The host applies ' +
  'instantly on an empty board, replaces the board when the user switches topics, or stages ' +
  'Accept/Deny when the ask deepens/edits the current diagram. ' +
  ASK_HOST_PROPOSAL_GATE +
  ' The seqd fence body MUST be valid JSON only (no Mermaid `participant`/`->`/`title:` lines) with `"version": 1` as a ' +
  'NUMBER, e.g. `{"version":1,"kind":"service-sequence","title":"…","grounded":{"graphId":' +
  '"chat:proposal","origin":"design"},"nodes":[…],"edges":[…]}`. Prefer a ```seqd fence; ```json is ' +
  'accepted only when the body is valid SeqDiagram v1. ' +
  SEQD_ENUM_HINT;

const ASK_DESIGN_BREAKDOWN_SEQD_DIRECTIVE =
  'If required inputs are missing (tickers, sources, accuracy bar, which model, schedule, or cost), ' +
  'ask those clarifying questions FIRST and do not emit a ```seqd fence until they answer. ' +
  'For "break down X", "explain how X works", "design a X", "I want to create X…", deepen/follow-up ' +
  'edits ("add…", "keep this board and…", "instead…"), or any multi-part plan/build ask (not a yes/no), ' +
  'structure the answer like an explanatory top-down flowchart (Cursor-plan style): ' +
  'layout.direction "TD"; stages as distinct readable nodes (prefer ≥8 for a full system — never ' +
  'collapse a rich domain into ~5 macro boxes); decision/branch points as their own nodes with ' +
  'labeled control edges on every branch (yes/no, success/fail, approve/deny) — avoid dense ' +
  'prose-only plans with no board path. Give a short structured text breakdown of the natural ' +
  'modules for THAT domain (do not force an AI-agent shape onto unrelated asks) AND one ```seqd ' +
  'fence (```json accepted only when the body is valid SeqDiagram v1) with those modules as nodes, ' +
  'English labels, and labeled edges so the how-it-works path lives on the architecture board — not ' +
  'only in prose. Every node MUST include detail.whatItDoes (one short English sentence of how that ' +
  'stage works — this becomes the card subtitle). When modules have internals, list micro stages in ' +
  'detail.parts (2–8 short labels) AND expand those parts onto the board as nested child nodes ' +
  '(linked from the parent) so workflow depth is visible — not hidden in subtitles alone. Chat prose: ' +
  'use short ## / ### section titles and bullet or ' +
  'numbered lists — NEVER markdown pipe tables (no | columns). You MAY add a brief ## Execution order ' +
  'numbered list (3–8 steps) that mirrors the top-down board path — not a table. Put the module ' +
  'catalog on the board via seqd, not as a chat table. Set meta.diagramFamily to "process" for ' +
  'workflows/manufacturing/domain processes or "software" for scanned-style service graphs so ' +
  'the board depth chips match (Overview/Detail/Connections vs Business/Systems/Contracts). ' +
  'Match modules to the domain hinted in the outline — do not force Interface/Model/Memory/Tools on non-agent asks. ' +
  'Only the kinds/families listed above — never invent kinds or edge families outside that enum. ' +
  ASK_HOST_PROPOSAL_GATE;

/** Soften the “outline has no blocks” dead-end when the user asked to invent a breakdown. */
const ASK_DESIGN_PROPOSE_ARCHITECTURE_DIRECTIVE =
  'The design outline below is mostly the user\'s question — they have not drawn blocks yet. ' +
  'Do NOT refuse with “the outline only contains the label” or claim nothing can be broken down. ' +
  'PROPOSE a typical architecture for the concept they named, clearly framed as a design proposal ' +
  '(not as scanned or verified code). Match modules to the domain (agent, commerce, data pipeline, ' +
  'workflow, manufacturing, infra, SaaS, etc.) — never default every ask to Interface/Model/Memory/Tools. ' +
  'Put the modules, detail.whatItDoes on each node, detail.parts for modules with internals, ' +
  'labeled edges, and meta.diagramFamily in the ```seqd fence so the architecture board shows ' +
  'how it works under each title. Prefer ## headings + bullets in chat — never pipe tables.';

/** Whiteboard / sticky-wall asks: informal shapes, not scan topology. */
const ASK_WHITEBOARD_DIRECTIVE =
  'For whiteboard, sticky-wall, or informal diagram-on-stickies requests, include one ```whiteboard ' +
  'fence (WhiteboardDoc JSON, version 2). New shapes use proposal:… ids — never scan service ids. ' +
  ASK_HOST_PROPOSAL_GATE;

/**
 * The language-pack instruction block for a digest: how to read the languages
 * this repo is ACTUALLY written in, composed from each service's own mix.
 *
 * A 60% Python / 30% TypeScript repo gets both sets of instructions, attached
 * because two services counted that way — never because a repo-wide winner was
 * declared. A language with no pack (nothing parses it) contributes nothing, so
 * the model is never told how to read facts we never collected.
 */
function languageGuidanceLines(digest: Digest): string[] {
  const perService = digest.services.map((s) => s.languages ?? []).filter((s) => s.length > 0);
  const lines = composePromptGuidance(perService);
  if (lines.length === 0) return [];
  return ['', 'How to read these languages (they are what this repo is written in):', ...lines.map((l) => `- ${l}`)];
}

/** Build the explain prompt: the digest plus the strict PlainTree return contract.
 *  `detailLevel` only tunes the requested DENSITY of the labels — the honesty
 *  guard (sourceRefs must be real, invented ids stripped) is unchanged either way.
 *  'regular' emits the exact pre-Phase-4 prompt (byte-identical). */
export function buildExplainPrompt(digest: Digest, detailLevel: DetailLevel = 'regular'): string {
  const L: string[] = [];
  L.push(
    'You are a translator that makes a software repository readable to a non-coder. ' +
      'You are given the REAL, deterministic structure of a repository (its services, ' +
      'datastores, message topics, folders, files, and the interactions between them). ' +
      'Your job is ONLY to GROUP and RELABEL that structure into a plain-English, ' +
      'expandable hierarchy — you must not invent any structure.'
  );
  L.push('');
  L.push('Return ONLY a single JSON object (no prose, no markdown fences) with this exact shape:');
  L.push(
    '{"tree": {"id": string, "title": string, "summary": string, "kind": ' +
      '"group"|"area"|"feature"|"file"|"service"|"data", "children": PlainNode[], ' +
      '"sourceRefs": string[]}}'
  );
  L.push('');
  L.push('Rules:');
  L.push('- The root node has kind "group"; its sourceRefs must be ["repo"].');
  L.push('- Group the services into plain-English AREAS (kind "area") such as "Frontend", "Backend", "Data". Name them in human language a non-coder understands.');
  L.push('- Under each area, put services (kind "service"), then features (kind "feature"), then files (kind "file"). Datastores/topics are kind "data".');
  L.push('- title/summary must be plain English. title is a short human name; summary is one friendly sentence.');
  L.push('- sourceRefs is the CRITICAL honesty link: every node except the root "group" must list one or more ids taken VERBATIM from the digest below (the "id" fields of repo/services/modules/files/datastores/topics, or a folder path). Do NOT invent ids. Do NOT create nodes that map to nothing real.');
  L.push('- You may regroup and rename freely, but you may only reference ids that appear in the digest.');
  L.push('- Do not include edges; the system attaches those itself.');
  if (detailLevel === 'advanced') {
    // Advanced view: ask for a DENSER, more technical labeling (Obsidian-style).
    // This never relaxes the honesty rules above — sourceRefs must still be real.
    L.push(
      '- ADVANCED MODE: prefer denser, more technical titles and summaries — keep ' +
        'the real technical names (service/module/file/tech names) rather than ' +
        'softening them, and surface more of the real detail. Still plain enough to ' +
        'read, but do NOT hide the technical names. The honesty rules above still apply.'
    );
  }
  L.push(...languageGuidanceLines(digest));
  L.push('');
  L.push(UNTRUSTED_CONTENT_INSTRUCTION);
  L.push('');
  L.push(...renderDigestSection(digest));
  return L.join('\n');
}

/**
 * Build the board-chat prompt: the deterministic structure digest plus the
 * user's question. When the ask names services (or a board selection exists),
 * the digest is the subject subgraph (named nodes + one hop) with an honest
 * omission marker — not a stripped grounding stack, and never an empty digest.
 * Whole-system asks (fragility, "what's here") still carry the full digest.
 *
 * `onRendered` reports the digest this prompt ACTUALLY carried — after scoping
 * and after the budget fit — for {@link computeAskCoverage}. The prompt text is
 * identical whether or not a caller passes it (locked by the byte-identical
 * build test in `ask-intents.test.ts`).
 */
export function buildAskPrompt(
  digest: Digest,
  question: string,
  compose?: AskComposition,
  onRendered?: (rendered: Digest) => void,
): string {
  const L: string[] = [];
  // GROUNDING/HONESTY clause — never relaxed. The chat is an assistant OVER the
  // honest digest, not a new source of structure. Under auto-write permissions
  // with an edit intent the IDENTITY changes — engineer, not answerer — while
  // every grounding rule stays word-for-word (see AskComposition.agenticEditor).
  L.push(
    compose?.agenticEditor
      ? 'You are an autonomous software engineer working INSIDE the user\'s repository, ' +
        'with write access. Your deliverable is a correct, minimal EDIT to the repository — ' +
        'a task is not complete until you have changed the files, and a diagnosis written ' +
        'in prose is not a deliverable. Investigate only as much as the edit requires, make ' +
        'the change with your editing tools, then verify it. If you write a unified diff in ' +
        'a ```diff fence instead, the harness applies it to the repository — exact context ' +
        'required, `--- /dev/null` for new files. You are given the REAL, ' +
        'deterministic structure of the repository (services, datastores, folders, files, ' +
        'and the interactions between them) as JSON. Work from ONLY that real structure and ' +
        'the files you read. Do NOT invent services, files, or connections that are not in ' +
        'the digest, and if something cannot be determined from the repository, say so plainly.'
      : 'You are a grounded assistant that answers questions about the user\'s OWN ' +
        'software system. You are given the REAL, deterministic structure of their repository ' +
        '(services, datastores, message topics, folders, files, and the interactions between ' +
        'them) as JSON. Answer the question using ONLY that real structure. Do NOT invent ' +
        'services, files, or connections that are not in the digest — never describe proposal ' +
        'or design nodes as if they were scanned. If the answer is not determinable from the ' +
        'digest alone, say so plainly.'
  );
  /* The directive, plus the ids of THIS repository so an endpoint does not have
     to be guessed and then refused. */
  L.push(ASK_ATTACHED_PROPOSAL_DIRECTIVE + topologyVocabulary(digest));
  // Whiteboard directive only when the question is whiteboard-flavored (same gate as design).
  if (isWhiteboardFlavoredAsk(question)) {
    L.push(ASK_WHITEBOARD_DIRECTIVE);
  }
  // REGISTER-MATCHING clause (U2 · adaptivity) — shared constant with design path.
  L.push(ASK_REGISTER_MATCHING_CLAUSE);
  L.push(ASK_TRANSCRIPT_FORMAT_CLAUSE);
  L.push(ASK_PREP_AND_COST_CLAUSE);
  if (isFigureItOutAsk(question)) {
    L.push(ASK_FIGURE_IT_OUT_CLAUSE);
  }
  if (isShowOnBoardAsk(question)) {
    L.push(ASK_SHOW_ON_BOARD_CLAUSE);
  }
  // RISK-GROUNDING clause (moat) — REINFORCES the grounding rule for fragility
  // questions: the digest carries a PRECOMPUTED `risks` section, so cite it rather
  // than deriving blast radius / cycles by hand.
  L.push(
    'The digest includes a precomputed `risks` section (single points of failure with their ' +
      'real blast-radius counts, and circular dependencies). For any question about fragility, ' +
      'risk, what breaks if something fails, single points of failure, or circular dependencies, ' +
      'answer ONLY from that section\'s numbers — do NOT derive, estimate, or recompute blast ' +
      'radius or cycles yourself.'
  );
  // FILE-LIST SUMMARY clause (r-E3) — owner screenshots: an answer enumerated
  // ~15 full file paths as a flat bullet list, one per line. Prose does not
  // read as a filesystem browser, and the client already renders a compact
  // disclosure for the resulting Open-file buttons (`fileActionsView`) — but
  // the WALL OF PATHS in the answer text itself is a prompting problem the
  // client cannot fix. This does not relax the grounding rule above: every
  // real path named must still be a real path from the digest, and a
  // SUMMARISED group must still name enough of its real paths (or their
  // shared real folder) that a reader can tell what is actually there —
  // never a vaguer, unverifiable rewrite ("several model files") that drops
  // the evidence.
  L.push(
    'When your answer would otherwise list more than about four files of the same kind ' +
      '(e.g. all under one real folder, or all one type — models, routes, tests), do NOT ' +
      'enumerate them as a flat bullet list of full paths. Summarise the group instead — name ' +
      'the count, the kind, and their real shared folder (e.g. "15 model files under ' +
      '`backend/app/models/`") — while still citing enough of the real paths from the digest ' +
      '(a few representative ones, or the shared folder path itself) that the claim stays ' +
      'grounded and verifiable. Never invent a folder or a count that is not actually in the ' +
      'digest. A short, heterogeneous list (up to about four files, or files that do not share ' +
      'a kind/folder) should still be named individually — summarise only when enumerating ' +
      'would just be noise.'
  );
  // ONE model-facing instruction for every untrusted block in this prompt (the
  // digest, and the compiled scope section when the turn carries one).
  L.push(UNTRUSTED_CONTENT_INSTRUCTION);
  pushComposition(L, compose);
  pushInstructions(L, compose);
  pushAttachments(L, compose);
  pushHistory(L, compose);
  pushSkillSummaries(L, compose);
  L.push('');
  const scoped = scopeDigestToAsk(digest, question, { subjectNodeId: compose?.subjectNodeId });
  /*
   * SCOPED WINS. When the question NAMED something, the subject subgraph is
   * already the right answer to "how much structure does this turn need" and
   * indexing it would hide the very files that were asked about. The index is
   * for the other case — the one that used to fail open to the whole map.
   */
  const index = shouldIndexDigestForAsk(scoped.digest, scoped.scoped)
    ? indexDigestForAsk(scoped.digest)
    : null;
  L.push(
    ...renderDigestSection(
      index ? index.digest : scoped.digest,
      onRendered,
      compose?.agenticEditor ? AGENTIC_EDIT_DIGEST_BUDGET_TOKENS : DIGEST_BUDGET_TOKENS,
    ),
  );
  L.push(...askScopeOmissionLines(scoped));
  if (index) {
    L.push(...askIndexOmissionLines(index));
    L.push(ASK_INDEX_RETRIEVAL_CLAUSE);
  }
  pushFileResearch(L, compose);
  pushScope(L, compose);
  pushSkillBody(L, compose);
  pushQuestion(L, question);
  return L.join('\n');
}

/**
 * The ask prompt, plus an honest account of what it left out.
 *
 * ONE build, TWO outputs. Coverage is taken from the render itself rather than
 * recomputed, because the digest is cut in three separate places — the
 * `MAX_EDGES` cap in {@link buildDigest}, the subject scoping in
 * {@link scopeDigestToAsk}, and the token-budget fit in `renderDigestSection` —
 * and a second reconstruction of that sequence would be free to drift from the
 * bytes the model was actually handed. This function cannot drift: it measures
 * the object that was serialized.
 *
 * `graph` is the denominator and must be the SAME graph the digest was built
 * from, or the numbers describe two different repositories.
 */
export function buildAskPromptWithCoverage(
  digest: Digest,
  question: string,
  graph: ArchGraph,
  compose?: AskComposition,
): { prompt: string; coverage: AskCoverage } {
  let rendered: Digest = digest;
  const base = buildAskPrompt(digest, question, compose, (d) => {
    rendered = d;
  });
  return {
    prompt: base + renderScanCoverageSection(graph, question),
    coverage: computeAskCoverage(graph, rendered),
  };
}

/**
 * TELL THE MODEL WHAT THE SCAN NEVER READ.
 *
 * MEASURED 2026-09-03, on this repository, against a server running current
 * main. Asked about a Django settings module, the answer got the refutation
 * right and then overclaimed: *"The repository contains only TypeScript/TSX
 * files … it is not a Django project."* The first half is true. **"Only
 * TypeScript" is false** — 45 tracked `.py` files, under `examples/` and
 * `tools/`, which the walk never enters.
 *
 * `scanCoverage` already stops OUR checks refuting from a partial graph. It
 * could not stop the MODEL asserting exhaustiveness from the same partial
 * graph, because nothing in the prompt ever said the graph was partial. That is
 * the second law in `docs/how-to-verify.md` with the subject changed: absence of
 * a signal read as evidence of absence, by the model this time rather than by
 * our code.
 *
 * And note the shape it took, because it is the dangerous one: the answer was
 * MORE confident than the evidence allowed while reaching the right conclusion.
 * Everything around the false clause was correct, which is exactly what makes a
 * reader take it as authoritative.
 *
 * EMITTED ONLY WHEN COVERAGE IS INCOMPLETE. On a fully-walked repository there
 * is nothing to warn about, and a permanent hedge would teach the model to
 * qualify claims it is entitled to make — the same defect as a warning nobody
 * reads. Absent coverage fields count as incomplete: not recorded is not
 * "nothing was missed".
 */
function renderScanCoverageSection(graph: ArchGraph, question?: string): string {
  const cov = scanCoverage(graph);
  if (cov.verdict === 'complete') return '';
  const L: string[] = ['', '--- SCAN COVERAGE ---'];
  L.push(
    'This scan did NOT read every file in the repository. Do not say the project ' +
      '"only" contains a language, or that something is absent, on the strength of what ' +
      'is missing here — say what you scanned and found. An absence in this graph is not ' +
      'an absence in the repository.',
  );
  /*
   * AND SAY SO INSTEAD OF ASKING. Measured on the turn after the warning above
   * first shipped: the overclaim went away and took the conclusion with it. The
   * old answer reasoned "contains ONLY TypeScript, therefore not Django" — the
   * refutation was CARRIED BY the false half, so removing it left nothing to
   * stand on and the model retreated to "I cannot determine … please provide
   * additional context about the Django project layout".
   *
   * That retreat is worse than neutral. It is a clarifying question, it asks the
   * user to supply what the scan simply did not read, and it treats the premise
   * as established — a reader takes it as "it just cannot find my settings
   * file". The honest move is narrow and the harness can always make it: name
   * what was checked, name the gap, and stop.
   */
  L.push(
    'When a gap stops you ruling something in or out, SAY THAT plainly and name the ' +
      'unread region. Never ask the user to supply what the scan did not read, and never ' +
      'treat a premise as established just because you could not test it.',
  );
  if (cov.verdict === 'unknown') {
    L.push('What was covered is not recorded for this graph, so treat every absence as unknown.');
  }
  for (const reason of cov.reasons.slice(0, 6)) L.push(`- ${reason}`);
  const exts = [...cov.unvisitedExtensions, ...cov.unparsedExtensions].sort();
  if (exts.length > 0) L.push(`File types the scan may have missed: ${exts.join(', ')}`);
  /*
   * THE QUESTION'S OWN PREMISE, when the gap is exactly what would settle it.
   *
   * A refutation should never need an exhaustive claim about what the repo
   * contains. "There is no Python at all, so there is no Django" is a narrow,
   * checkable sentence; "the repository contains only TypeScript" is a different
   * and much larger one. On THIS graph neither is available, because `.py` lives
   * under `tools/` and `examples/` — so the true answer is the third one, and
   * the model can only give it if the prompt hands it the fact.
   */
  if (question !== undefined && question.trim() !== '') {
    for (const u of checkQuestionPremise(question, graph).unverifiable.slice(0, 3)) {
      L.push(
        `The question assumes "${u.term}". The scan can NEITHER confirm NOR rule that out ` +
          `here: ${u.blockedBy.join(', ')} would sit in a region it never read. Say exactly ` +
          'that — not that the thing is absent, and not that you need more information.',
      );
    }
  }
  return `${L.join('\n')}\n`;
}

/**
 * What the SERVER composes around the user's question for one ask turn.
 *
 * Every field is OPTIONAL and empty-by-default, and each `push*` helper below is
 * a no-op when its field is empty — so a request that carries none of them
 * produces a byte-identical prompt to the pre-intent build. That is the
 * backwards-compatibility contract for older clients and for the design-mode
 * `design` payload path.
 *
 * The point of the shape: the user's typed words are the ONLY thing under
 * `--- QUESTION ---`. Invoked intents, the research-mode directive, and the
 * compiled grounded scope are all separate, labelled sections the server builds
 * — never prose the client glued onto the user's message.
 */
export interface AskComposition {
  /** Rendered `--- REQUESTED ACTIONS ---` lines (see `askIntents.ts`). */
  intentLines?: readonly string[];
  /** Rendered `--- GROUNDED SCOPE ---` lines (the client's compiled context). */
  scopeLines?: readonly string[];
    /** Rendered `--- PROJECT INSTRUCTIONS ---` lines, or absent. */
  instructionLines?: readonly string[];
  /**
   * ATTACHMENTS - text the user pasted or dropped in.
   *
   * A separate field from every other section here because it is a different
   * KIND of evidence: the rest of this prompt is measured out of the scan, and
   * this is what the user brought. `renderAttachmentSection` says so in the
   * header, and keeping the two apart is what lets it.
   */
  attachmentLines?: readonly string[];
  /** Rendered `--- FILE RESEARCH ---` lines (capped real file bodies). */
  fileResearchLines?: readonly string[];
  /** Prior chat turns from workspace memory (cross-session). */
  historyLines?: readonly string[];
  /**
   * Phase 3 progressive disclosure — ALWAYS-loaded skill summaries (one bullet
   * per skill under `.sequence/skills/`). Empty when no skills exist, so the
   * prompt is byte-identical to the pre-skill seam.
   */
  skillSummaryLines?: readonly string[];
  /**
   * Phase 3 progressive disclosure — the FULL body of the single skill that
   * matched the question, capped to 2k chars. Injected only on a match.
   */
  skillBodyLines?: readonly string[];
  /** True when the turn is in Research mode — the server pushes the directive. */
  researchMode?: boolean;
  /**
   * True when the turn runs under an AUTO-WRITE permission (autoEdit/full)
   * with an edit intent: the opening identity becomes an engineer whose
   * deliverable is an edited repository, not an assistant whose deliverable
   * is an answer. Measured on SWE-bench (minimax-m3, three runs): with the
   * answering identity the model produced flawless prose diagnoses and zero
   * edit attempts in any syntax — the scaffold's own first sentence told it
   * its job was to answer. Every grounding rule below is unchanged.
   */
  agenticEditor?: boolean;
  /**
   * Board selection / intent subject. When set, `scopeDigestToAsk` keeps this
   * node (and one hop) even if the typed question does not name it.
   */
  subjectNodeId?: string;
}

/** The research directive + the invoked-intent section, in that order. */
function pushComposition(L: string[], compose?: AskComposition): void {
  if (!compose) return;
  if (compose.researchMode) {
    L.push(RESEARCH_MODE_DIRECTIVE);
  }
  if (compose.intentLines && compose.intentLines.length > 0) {
    L.push('');
    L.push(...compose.intentLines);
  }
}

function pushHistory(L: string[], compose?: AskComposition): void {
  if (!compose?.historyLines || compose.historyLines.length === 0) return;
  L.push('');
  L.push(...compose.historyLines);
}

/**
 * The repository's own standing instructions.
 *
 * Pushed BEFORE history and after the grounded sections: the rules are context
 * for the whole conversation rather than part of it, and they rank below the
 * evidence because an instruction file states intent while the graph measures
 * fact.
 */
function pushInstructions(L: string[], compose?: AskComposition): void {
  if (!compose?.instructionLines || compose.instructionLines.length === 0) return;
  L.push('');
  L.push(...compose.instructionLines);
}

/**
 * What the user attached.
 *
 * AFTER the instructions and BEFORE the history, because an attachment is
 * evidence for the question being asked rather than a standing rule - and it
 * has to be in front of the model before the conversation that refers to it.
 *
 * It is UNTRUSTED CONTENT, and the section header says whose it is: the one
 * failure this must not allow is the model treating a pasted log as something
 * it read out of the repository.
 */
function pushAttachments(L: string[], compose?: AskComposition): void {
  if (!compose?.attachmentLines || compose.attachmentLines.length === 0) return;
  L.push('');
  L.push(...compose.attachmentLines);
}

/** Phase 3 — always-loaded skill summaries (progressive disclosure). */
function pushSkillSummaries(L: string[], compose?: AskComposition): void {
  if (!compose?.skillSummaryLines || compose.skillSummaryLines.length === 0) return;
  L.push('');
  L.push(...compose.skillSummaryLines);
}

/** Phase 3 — the matched skill's full body (progressive disclosure). */
function pushSkillBody(L: string[], compose?: AskComposition): void {
  if (!compose?.skillBodyLines || compose.skillBodyLines.length === 0) return;
  L.push('');
  L.push(...compose.skillBodyLines);
}

/**
 * Wire history → typed turns for {@link renderAskHistorySection}.
 *
 * Keeps only user/assistant + string text; optional work/evidence arrays are
 * narrowed to strings (B3.1). Unknown shapes are dropped, never 400'd.
 */
export function parseAskHistoryTurns(raw: unknown): {
  role: string;
  text: string;
  work?: string[];
  evidence?: {
    filesRead?: string[];
    tools?: string[];
    proposals?: string[];
  };
}[] {
  if (!Array.isArray(raw)) return [];
  const out: {
    role: string;
    text: string;
    work?: string[];
    evidence?: {
      filesRead?: string[];
      tools?: string[];
      proposals?: string[];
    };
  }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const text = (item as { text?: unknown }).text;
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') continue;
    const turn: (typeof out)[number] = { role, text };
    if (role === 'assistant') {
      const workRaw = (item as { work?: unknown }).work;
      if (Array.isArray(workRaw)) {
        const work = workRaw.filter((w): w is string => typeof w === 'string' && w.trim().length > 0);
        if (work.length > 0) turn.work = work;
      }
      const evRaw = (item as { evidence?: unknown }).evidence;
      if (evRaw && typeof evRaw === 'object') {
        const ev = evRaw as Record<string, unknown>;
        const filesRead = Array.isArray(ev.filesRead)
          ? ev.filesRead.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
          : [];
        const tools = Array.isArray(ev.tools)
          ? ev.tools.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
          : [];
        const proposals = Array.isArray(ev.proposals)
          ? ev.proposals.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
          : [];
        if (filesRead.length || tools.length || proposals.length) {
          turn.evidence = {
            ...(filesRead.length ? { filesRead } : {}),
            ...(tools.length ? { tools } : {}),
            ...(proposals.length ? { proposals } : {}),
          };
        }
      }
    }
    out.push(turn);
  }
  return out;
}

/** Bound prior turns from the client into prompt lines (cross-session memory). */
export function renderAskHistorySection(
  turns: readonly {
    role: string;
    text: string;
    work?: readonly string[];
    evidence?: {
      filesRead?: readonly string[];
      tools?: readonly string[];
      proposals?: readonly string[];
    };
  }[],
  cap = 20,
  opts?: { droppedTurns?: number },
): string[] {
  const sliced = turns.slice(-cap).filter((t) => (t.role === 'user' || t.role === 'assistant') && t.text.trim());
  if (sliced.length === 0) return [];
  const clientDropped = Math.max(0, Math.floor(opts?.droppedTurns ?? 0));
  const serverDropped = Math.max(0, turns.length - sliced.length);
  const dropped = clientDropped + serverDropped;
  const header =
    dropped > 0
      ? `--- PRIOR CHAT (same workspace; continue coherently; ${dropped} earlier turn${dropped === 1 ? '' : 's'} omitted — memory trimmed) ---`
      : '--- PRIOR CHAT (same workspace; continue coherently) ---';
  const lines = [header];
  for (const t of sliced) {
    const who = t.role === 'user' ? 'User' : 'Assistant';
    const raw = t.text.trim();
    const truncated = raw.length > 1200;
    const body = truncated ? `${raw.slice(0, 1200)}… [memory trimmed]` : raw;
    lines.push(`${who}: ${body}`);
    /* B3.1 — grounded prior work/evidence, not product chrome. Cap locally so
       a hostile client cannot dump an unbounded ledger into the prompt. */
    if (t.role === 'assistant') {
      const work = (t.work ?? []).filter((w) => typeof w === 'string' && w.trim()).slice(0, 12);
      if (work.length > 0) lines.push(`  [work] ${work.join('; ')}`);
      const files = (t.evidence?.filesRead ?? []).filter((p) => typeof p === 'string' && p.trim()).slice(0, 20);
      if (files.length > 0) lines.push(`  [files] ${files.join(', ')}`);
      const tools = (t.evidence?.tools ?? []).filter((n) => typeof n === 'string' && n.trim()).slice(0, 12);
      if (tools.length > 0) lines.push(`  [tools] ${tools.join(', ')}`);
      const proposals = (t.evidence?.proposals ?? []).filter((p) => typeof p === 'string' && p.trim()).slice(0, 8);
      if (proposals.length > 0) lines.push(`  [proposals] ${proposals.join(', ')}`);
    }
  }
  return lines;
}

/**
 * The user's own words — and ONLY the user's own words.
 *
 * Omitted entirely when they typed nothing: a chip-only send is a legal request
 * (the invoked intents are the instruction), and an empty `--- QUESTION ---`
 * heading reads to the model as a question it failed to receive. A non-empty
 * question renders exactly as it always did.
 */
function pushQuestion(L: string[], question: string): void {
  const q = question.trim();
  if (q === '') return;
  L.push('');
  L.push('--- QUESTION ---');
  L.push(q);
}

/** Capped real file bodies, additive to the digest (paths-only). */
function pushFileResearch(L: string[], compose?: AskComposition): void {
  if (!compose?.fileResearchLines || compose.fileResearchLines.length === 0) return;
  L.push('');
  L.push(...compose.fileResearchLines);
}

/** The compiled grounded scope, placed next to the digest it narrows. */
function pushScope(L: string[], compose?: AskComposition): void {
  if (!compose?.scopeLines || compose.scopeLines.length === 0) return;
  L.push('');
  L.push(...compose.scopeLines);
}

/**
 * The design context a repo-less assistant question is grounded in: the design's
 * title plus a plain-text serialization of the user's design tree (built client
 * side). This is a system the user is DESIGNING — nothing here has been scanned,
 * so the prompt must forbid file:line citations and any "detected" framing.
 */
export interface DesignAskContext {
  title: string;
  outline: string;
  /**
   * When true, the outline is question-derived (no drawn blocks yet). The model
   * may propose a typical architecture as a design proposal — never as a scan.
   */
  proposeArchitecture?: boolean;
}

/**
 * Budget on the design outline handed to the provider: 5 000 tokens ≈ 20 000
 * characters — the SAME allowance the pre-budget code applied as a silent
 * `outline.slice(0, 20_000)`. What changed is that an outline past it now
 * carries the omission marker instead of stopping mid-word with no trace.
 *
 * NOT wrapped as untrusted repo content, and deliberately so: this outline is
 * the USER'S OWN design, drawn in this app in this session. It is not read off
 * disk and it is not written by whoever wrote someone else's code, so framing it
 * to the model as untrusted third-party data would be dishonest about where it
 * came from. (If a future round ever IMPORTS a design from a file or a URL, that
 * path is the one that needs the wrapper.)
 */
const DESIGN_ASK_OUTLINE_BUDGET_TOKENS = 5_000;

function isWhiteboardFlavoredAsk(question: string): boolean {
  const q = question.toLowerCase();
  return /\bwhiteboard\b|\bsticky\b|\bstickies\b|\bsticky.?wall\b/.test(q);
}

function prefersSeqdDiagramAsk(question: string): boolean {
  const q = question.toLowerCase().trim();
  if (!q) return false;
  if (
    /\barch(?:itecture)?(?:\s+board)?\b/.test(q) ||
    /\bbreak\s*down\b/.test(q) ||
    /\bexplain how\b/.test(q) ||
    /\bhow (?:it |does |do |would |can )/.test(q) ||
    /\bdesign (?:a|an|the|me)\b/.test(q) ||
    /\bpropose (?:a|an|the)\b/.test(q) ||
    /\bshow (?:me )?(?:the )?(?:architecture|system|flow|components)\b/.test(q) ||
    /\bshow(?:\s+\w+){0,8}\s+on\s+(?:the\s+)?(?:board|architecture|canvas)\b/.test(q) ||
    /\bon\s+(?:the\s+)?board\b/.test(q) ||
    /\bwalk (?:me )?through\b/.test(q) ||
    /\bcomponents? of\b/.test(q) ||
    /\bsystem (?:for|that|to)\b/.test(q)
  ) {
    return true;
  }
  if (
    /\bi want to (?:create|build|make|design|start|launch)\b/.test(q) ||
    /\bi(?:'| a)?m (?:looking|trying|planning|hoping) to (?:create|build|make|design)\b/.test(q) ||
    /\b(?:create|build|make|launch) (?:a|an|the|my)\b/.test(q) ||
    /\bplan (?:a|an|the|for|out)\b/.test(q) ||
    /\bscaffolds?\b|\bsandbox(?:es)?\b|\benvironments?\b/.test(q)
  ) {
    return true;
  }
  if (q.length >= 80 && (q.match(/\band\b/g) ?? []).length >= 2) {
    return true;
  }
  return false;
}

/**
 * Build the board-chat prompt for DESIGN mode — the from-scratch "Design (new
 * project)" user who has no repo attached (owner report: "I just started a new
 * file, why would I need a repo?"). The grounding source is the user's own design
 * outline instead of a scan digest, and the honesty rules are the mirror image of
 * {@link buildAskPrompt}: answer only over the outline, never invent blocks, and
 * — because nothing here was scanned — never cite files or line numbers.
 */
export function buildDesignAskPrompt(
  design: DesignAskContext,
  question: string,
  compose?: AskComposition,
): string {
  const title = design.title.trim() === '' ? 'Untitled design' : design.title.trim();
  const outline = cutTextToBudget(design.outline.trim(), DESIGN_ASK_OUTLINE_BUDGET_TOKENS).text;
  /* Show-on-board / breakdown phrasing forces propose even if the client omitted the flag. */
  const propose =
    design.proposeArchitecture === true ||
    isShowOnBoardAsk(question) ||
    prefersSeqdDiagramAsk(question);
  const L: string[] = [];
  // GROUNDING/HONESTY clause — the design-mode twin of buildAskPrompt's.
  // When proposeArchitecture is set, the outline is question-derived: allow an
  // explicit design proposal instead of the “not in the outline” dead-end.
  if (propose) {
    L.push(
      'You are a grounded assistant helping the user DESIGN a software system from scratch. ' +
        'This is a DESIGN, not a scan of real code: nothing below has been built, detected, or ' +
        'read from a repository. The outline may only name the concept they want broken down — ' +
        'use ordinary software-design reasoning to propose a concrete architecture for it.'
    );
    L.push(
      'Never claim anything is implemented, detected, or verified in the user\'s repository. ' +
        'No repo is attached — do not invent file paths, line numbers, or source locations that were ' +
        'not provided in this chat. You may describe the design in plain English and name modules by ' +
        'role. Never tell the user you cannot read files. Frame new modules as a design proposal; the ' +
        'host will put them on the board (or stage Accept/Deny if the board already has content).'
    );
    L.push(ASK_DESIGN_PROPOSE_ARCHITECTURE_DIRECTIVE);
  } else {
    L.push(
      'You are a grounded assistant helping the user think about a software system they are ' +
        'DESIGNING. This is a DESIGN, not a scan of real code: nothing below has been built, ' +
        'detected, or read from a repository. You are given the design outline the user has ' +
        'drawn — its blocks and how they nest. Answer the question using ONLY that outline plus ' +
        'ordinary software-design reasoning about it.'
    );
    L.push(
      'Never claim anything is implemented, detected, or verified in the user\'s repository. ' +
        'No repo is attached — do not invent file paths, line numbers, or source locations that were ' +
        'not provided in this chat. You may describe the design in plain English and name modules by ' +
        'role. Never tell the user you cannot read files. If the question asks about something that is ' +
        'not in the outline, say plainly that it is not in the design (and, if useful, suggest adding ' +
        'it) rather than inventing it.'
    );
  }
  L.push(ASK_DESIGN_SEQD_DIRECTIVE);
  if (prefersSeqdDiagramAsk(question) || propose) {
    L.push(ASK_DESIGN_BREAKDOWN_SEQD_DIRECTIVE);
  }
  if (isWhiteboardFlavoredAsk(question)) {
    L.push(ASK_WHITEBOARD_DIRECTIVE);
  }
  L.push(ASK_REGISTER_MATCHING_CLAUSE);
  L.push(ASK_TRANSCRIPT_FORMAT_CLAUSE);
  L.push(ASK_PREP_AND_COST_CLAUSE);
  /*
   * `proposeArchitecture` IS A FIGURE-IT-OUT ASK, and saying so is the whole of
   * the 2026-09-08 owner fix.
   *
   * The report was "make sure it's doing system design". Sequence answered a
   * greenfield design request with a scoping question — "compact overview or
   * detailed diagram?" — instead of a design. That question is deliberate and
   * right for an ambiguous ask, and `ASK_FIGURE_IT_OUT_CLAUSE` already exists to
   * suppress it when the user has said "just pick" or "figure it out": state
   * 3–5 numbered assumptions in plain English, then draw.
   *
   * Someone who passed `--mode design`, or a client that set
   * `proposeArchitecture`, HAS ALREADY SAID IT. They asked for a proposal for a
   * system that does not exist. There is no scan to disambiguate against, so a
   * clarifying round buys a scope answer at the price of the thing they asked
   * for. The numbered assumptions are what keep it honest — the model says what
   * it decided instead of choosing silently.
   *
   * Deliberately an OR rather than a replacement: a design ask that ALSO says
   * "figure it out" still gets the clause exactly once, and every non-design ask
   * keeps the old behaviour untouched.
   */
  if (propose) {
    L.push(ASK_DESIGN_PROPOSE_NOW_CLAUSE);
  } else if (isFigureItOutAsk(question)) {
    L.push(ASK_FIGURE_IT_OUT_CLAUSE);
  }
  if (isShowOnBoardAsk(question)) {
    L.push(ASK_SHOW_ON_BOARD_CLAUSE);
  }
  // Design mode composes the SAME way, minus any scan-derived scope: there is no
  // graph, so `askIntents.executeAskIntents` gathers no facts and the directives
  // ride alone. A design-mode scope section would be fabricated evidence, and
  // `pushScope` is deliberately not called here — so this prompt carries NO
  // untrusted repo block, and therefore no untrusted-content instruction line
  // describing one that is not there.
  pushComposition(L, compose);
  pushInstructions(L, compose);
  pushAttachments(L, compose);
  pushHistory(L, compose);
  L.push('');
  L.push(`--- DESIGN: ${title} ---`);
  L.push(outline);
  pushQuestion(L, question);
  return L.join('\n');
}

/** Diagram metadata the board chat may attach — type + real node ids only, never mermaid text. */
export interface AskDiagramHint {
  type: 'flow' | 'sequence';
  scopeNodeIds: string[];
}

/**
 * Derive a grounded diagram scope for POST /api/ask when the question clearly
 * wants a visual. Uses real node ids from the graph; unknown digest labels are
 * skipped. Returns undefined when the question gives no diagram signal.
 */
export function deriveAskDiagram(
  graph: ArchGraph,
  question: string,
  digest: Digest,
): AskDiagramHint | undefined {
  const q = question.toLowerCase();
  const wantsSequence = /\bsequence\b|\bcall flow\b|\brequest flow\b/.test(q);
  const wantsDiagram =
    wantsSequence ||
    /\b(fragile|risk|spof|blast|cycle|architecture|flow|diagram|dependency|depend)\b/.test(q);
  if (!wantsDiagram) return undefined;

  const type = wantsSequence ? 'sequence' : 'flow';
  const top = digest.risks?.spofs?.[0];
  if (top) {
    const node = graph.nodes.find((n) => n.label === top.node && n.kind === top.kind);
    if (node) return { type, scopeNodeIds: [node.id] };
  }
  return { type, scopeNodeIds: [] };
}

const MAX_ANNOTATION_BULLET_CHARS = 120;
const MAX_ANNOTATION_BULLETS_REGULAR = 2;
const MAX_ANNOTATION_BULLETS_ADVANCED = 4;

/**
 * Build the per-node annotation prompt: the digest plus a strict JSON contract.
 * The model may only describe evidence present in the digest — never invent ids,
 * numbers, or connections.
 */
export function buildAnnotatePrompt(digest: Digest, detailLevel: DetailLevel = 'regular'): string {
  const maxBullets = detailLevel === 'advanced' ? MAX_ANNOTATION_BULLETS_ADVANCED : MAX_ANNOTATION_BULLETS_REGULAR;
  const L: string[] = [];
  L.push(
    'You are a translator that makes a software repository readable to a non-coder. ' +
      'You are given the REAL, deterministic structure of a repository (its services, ' +
      'modules, files, datastores, message topics, folders, and the interactions between them). ' +
      'Your job is ONLY to write short plain-English annotation bullets for each listed ' +
      'component id — describing what the evidence shows about its role, how it connects, ' +
      'and any notable behavior. You must not invent any structure.'
  );
  L.push('');
  L.push('Return ONLY a single JSON object (no prose, no markdown fences) with this exact shape:');
  L.push('{"annotations": {"<component-id>": ["bullet", ...], ...}}');
  L.push('');
  L.push('Rules:');
  L.push(
    '- For each listed component id in the digest below, write 2-4 SHORT plain-English bullets ' +
      'a non-coder can read, describing ONLY what the provided evidence shows (its role, how it ' +
      'connects, notable behavior).'
  );
  L.push('- Every key in "annotations" MUST be a component id taken VERBATIM from the digest (service/module/file/datastore/topic ids). Do NOT invent ids. Do NOT annotate ids that are not in the digest.');
  L.push('- Do not invent numbers, connections, or components that are not supported by the digest.');
  L.push(`- Cap at ${maxBullets} bullets per component id; each bullet must be ≤${MAX_ANNOTATION_BULLET_CHARS} characters.`);
  if (detailLevel === 'advanced') {
    L.push(
      '- ADVANCED MODE: up to 4 bullets per id; slightly more technical wording is OK, but still plain enough to read. The honesty rules above still apply.'
    );
  } else {
    L.push('- REGULAR MODE: at most 2 bullets per id; keep wording simple and non-technical.');
  }
  L.push(...languageGuidanceLines(digest));
  L.push('');
  L.push(UNTRUSTED_CONTENT_INSTRUCTION);
  L.push('');
  L.push(...renderDigestSection(digest));
  return L.join('\n');
}

export interface AnnotationsResult {
  annotations: Record<string, string[]>;
  mode: 'ai' | 'none';
  /** The provider kind, when the AI path produced annotations. */
  provider?: string;
}

/**
 * Parse + SANITIZE a raw model response into per-node annotation bullets.
 * Only ids present in `validIds` survive; bullets are capped and trimmed.
 * NEVER throws — malformed output yields an empty map.
 */
export function parseAnnotations(
  raw: string,
  validIds: Set<string>,
  detailLevel: DetailLevel = 'regular'
): Record<string, string[]> {
  const maxBullets = detailLevel === 'advanced' ? MAX_ANNOTATION_BULLETS_ADVANCED : MAX_ANNOTATION_BULLETS_REGULAR;
  const obj = extractFirstJsonObject(raw);
  if (!obj || typeof obj !== 'object') return {};
  const rawMap = (obj as { annotations?: unknown }).annotations;
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};

  const out: Record<string, string[]> = {};
  for (const [id, bullets] of Object.entries(rawMap as Record<string, unknown>)) {
    if (!validIds.has(id)) continue;
    if (!Array.isArray(bullets)) continue;
    const cleaned: string[] = [];
    for (const b of bullets) {
      if (typeof b !== 'string') continue;
      const trimmed = b.trim();
      if (trimmed === '') continue;
      cleaned.push(trimmed.length > MAX_ANNOTATION_BULLET_CHARS ? trimmed.slice(0, MAX_ANNOTATION_BULLET_CHARS) : trimmed);
      if (cleaned.length >= maxBullets) break;
    }
    if (cleaned.length > 0) out[id] = cleaned;
  }
  return out;
}

export interface BuildAnnotationsOptions {
  provider?: AiConfig;
  detailLevel?: DetailLevel;
  tree?: TreeNode;
  callProvider?: (cfg: AiConfig, prompt: string) => Promise<string>;
}

/**
 * Build per-node annotation bullets for `graph`. With a provider configured,
 * attempts the AI path and validates output; on ANY failure (no provider,
 * provider error, unusable response) returns an empty map. Never throws.
 */
export async function buildAnnotations(
  graph: ArchGraph,
  opts: BuildAnnotationsOptions = {}
): Promise<AnnotationsResult> {
  const detailLevel = opts.detailLevel ?? 'regular';
  const empty = (): AnnotationsResult => ({ annotations: {}, mode: 'none' });

  if (!opts.provider) return empty();

  const validIds = new Set(graph.nodes.map((n) => n.id));
  const call = opts.callProvider ?? generateText;

  let text: string;
  try {
    const digest = buildDigest(graph, opts.tree);
    text = await call(opts.provider, buildAnnotatePrompt(digest, detailLevel));
  } catch {
    return empty();
  }

  const annotations = parseAnnotations(text, validIds, detailLevel);
  return { annotations, mode: 'ai', provider: opts.provider.provider };
}

/* ==================================================== design-suggest ======= */

/**
 * A single PROPOSED design block (v8 Phase B2). The AI, given a plain-English
 * description of a system the user wants to BUILD, proposes child blocks in the
 * plain-English scheme. These describe things that DO NOT EXIST yet: they are
 * design intent, framed as "proposed" (the user edits/keeps them). They carry no
 * ids and no sourceRefs — the client materializes them into the `d:` designed-node
 * namespace with EMPTY sourceRefs (see @sequence/schema's addDesignChild). This is
 * NOT a detection claim.
 */
export interface DesignSuggestNode {
  title: string;
  kind: PlainKind;
  children?: DesignSuggestNode[];
}

/** Kinds a proposal may use (root-only `group` excluded); anything else → feature. */
const DESIGN_SUGGEST_KINDS: PlainKind[] = ['area', 'service', 'feature', 'data', 'file'];
/** Caps so a hostile/confused reply can never blow up the client tree. */
const DESIGN_SUGGEST_MAX_NODES = 40;
const DESIGN_SUGGEST_MAX_DEPTH = 4;
const DESIGN_SUGGEST_MAX_CHILDREN = 12;
const DESIGN_SUGGEST_MAX_TITLE = 80;

/**
 * Build the design-suggest prompt: the description (and optional parent block /
 * project name) plus the strict, plain-English return contract. The framing is
 * explicit — these are PROPOSED blocks for a system being DESIGNED, not a scan.
 */
export function buildDesignSuggestPrompt(
  description: string,
  parentTitle?: string,
  repoName?: string
): string {
  const L: string[] = [];
  L.push(
    'You help a non-coder DESIGN a brand-new software project by PROPOSING plain-English ' +
      'building blocks. These blocks DO NOT EXIST yet — this is a design, not a scan of real ' +
      'code, so never claim anything is detected or already built. Propose a small, sensible ' +
      'set of blocks a non-coder would understand.'
  );
  L.push('');
  L.push('Return ONLY a single JSON object (no prose, no markdown fences) with this exact shape:');
  L.push(
    '{"nodes": [{"title": string, "kind": "area"|"service"|"feature"|"data"|"file", ' +
      '"children"?: [ ...same node shape... ]}]}'
  );
  L.push('');
  L.push('Rules:');
  L.push('- Titles are short, plain English a non-coder understands (e.g. "Login page", "Notes database").');
  L.push('- Prefer grouping into areas like Frontend, Backend, Data, or Services when it helps.');
  L.push('- Keep it focused: a handful of top-level blocks, nested only where it clarifies.');
  L.push('- Use "data" for anything that stores information (databases, caches, queues).');
  if (repoName && repoName.trim() !== '') {
    L.push(`- The project is called "${repoName.trim()}".`);
  }
  if (parentTitle && parentTitle.trim() !== '') {
    L.push(`- These blocks will be added UNDER the existing block "${parentTitle.trim()}".`);
  }
  L.push('');
  L.push('--- WHAT THE USER WANTS TO BUILD ---');
  L.push(description.trim());
  return L.join('\n');
}

/** Recursively normalize a raw list into capped, well-formed proposals. */
function normalizeSuggestList(
  raw: unknown,
  depth: number,
  counter: { n: number }
): DesignSuggestNode[] {
  if (depth > DESIGN_SUGGEST_MAX_DEPTH || !Array.isArray(raw)) return [];
  const out: DesignSuggestNode[] = [];
  for (const item of raw) {
    if (counter.n >= DESIGN_SUGGEST_MAX_NODES || out.length >= DESIGN_SUGGEST_MAX_CHILDREN) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, DESIGN_SUGGEST_MAX_TITLE) : '';
    if (title === '') continue;
    counter.n++;
    const kind: PlainKind = DESIGN_SUGGEST_KINDS.includes(o.kind as PlainKind)
      ? (o.kind as PlainKind)
      : 'feature';
    const node: DesignSuggestNode = { title, kind };
    const kids = normalizeSuggestList(o.children, depth + 1, counter);
    if (kids.length > 0) node.children = kids;
    out.push(node);
  }
  return out;
}

/**
 * Parse + SANITIZE a raw model reply into proposed design nodes. Uses the same
 * defensive first-JSON-object extractor as the other AI paths (never eval), then
 * coerces kinds, trims/bounds titles, drops title-less nodes, and enforces
 * depth / count / per-level caps. NEVER throws — a garbage or oversized reply
 * simply yields a (possibly empty) capped list.
 */
export function normalizeDesignSuggestion(raw: string): DesignSuggestNode[] {
  const obj = extractFirstJsonObject(raw);
  if (!obj || typeof obj !== 'object') return [];
  const nodesRaw = (obj as { nodes?: unknown }).nodes;
  return normalizeSuggestList(nodesRaw, 0, { n: 0 });
}

/* ============================================================= AI parse ==== */

const MAX_TREE_NODES = 5000;
const MAX_TREE_DEPTH = 20;
const VALID_KINDS: PlainKind[] = ['group', 'area', 'feature', 'file', 'service', 'data'];

/**
 * Parse + SANITIZE a raw model tree into a PlainNode, enforcing the honesty
 * guard: every `sourceRef` must exist in `valid` (invented ids stripped), and a
 * non-`group` node with no surviving sourceRefs is DROPPED (it maps to nothing
 * real). Also bounds node count/depth and coerces kinds/titles. Returns the
 * sanitized node, or undefined when the subtree collapses to nothing usable.
 */
function sanitizeNode(
  raw: unknown,
  valid: Set<string>,
  depth: number,
  counter: { n: number }
): PlainNode | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (depth > MAX_TREE_DEPTH) return undefined;
  if (++counter.n > MAX_TREE_NODES) return undefined;
  const o = raw as Record<string, unknown>;

  const kind: PlainKind = VALID_KINDS.includes(o.kind as PlainKind) ? (o.kind as PlainKind) : 'group';
  const title = typeof o.title === 'string' && o.title.trim() !== '' ? o.title.trim() : '(untitled)';
  const summary = typeof o.summary === 'string' && o.summary.trim() !== '' ? o.summary.trim() : undefined;

  // Strip invented sourceRefs — the honesty lock.
  const rawRefs = Array.isArray(o.sourceRefs) ? o.sourceRefs : [];
  const sourceRefs = rawRefs.filter((r): r is string => typeof r === 'string' && valid.has(r));

  const rawChildren = Array.isArray(o.children) ? o.children : [];
  const children: PlainNode[] = [];
  for (const c of rawChildren) {
    const child = sanitizeNode(c, valid, depth + 1, counter);
    if (child) children.push(child);
  }

  // A non-group node must trace to a real source OR retain real descendants.
  if (kind !== 'group' && sourceRefs.length === 0 && children.length === 0) {
    return undefined;
  }

  // A node that survives ONLY via its descendants (no real sourceRef of its own)
  // is a pure AI GROUPING bucket. It must not keep a concrete DETECTED kind
  // (service / data / file), which would render a "detected"-looking marker for
  // something the scanner never found — only its grouping of real children is
  // real. Coerce it to the grouping kind `area` (honesty review F2). Nodes that
  // DO carry a real sourceRef keep their kind; pure `group` is already fine.
  const effectiveKind: PlainKind =
    kind !== 'group' && sourceRefs.length === 0 ? 'area' : kind;

  // Give the node a stable id derived from its first real ref (or a positional
  // fallback), regardless of what the model claimed — ids are ours, not the AI's.
  const id =
    sourceRefs.length > 0 ? `p:${sourceRefs[0]}` : `p:group:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return { id, title, summary, kind: effectiveKind, children, sourceRefs };
}

/**
 * How much of the real structure the AI tree actually accounts for — the count
 * of DISTINCT real source ids referenced anywhere in it. Used to decide whether
 * the AI result is usable or should fall back to structural.
 */
function coverageIds(node: PlainNode, acc: Set<string>): void {
  for (const r of node.sourceRefs) acc.add(r);
  for (const c of node.children) coverageIds(c, acc);
}

/**
 * Parse a model response into a validated PlainTree, or undefined when it is
 * unusable (no JSON, wrong shape, or the honesty guard stripped it to nothing).
 * The returned tree has real sourceRefs only and freshly-recomputed edgeRefs.
 */
export function parseAiTree(raw: string, graph: ArchGraph, valid: Set<string>): PlainNode | undefined {
  const obj = extractFirstJsonObject(raw);
  if (!obj || typeof obj !== 'object') return undefined;
  const treeRaw = (obj as { tree?: unknown }).tree ?? obj;
  const sanitized = sanitizeNode(treeRaw, valid, 0, { n: 0 });
  if (!sanitized) return undefined;

  // The root must anchor to the repo, and the tree must cover a meaningful slice
  // of the real structure — otherwise the model gave us an empty/degenerate
  // grouping and the structural fallback is the honest answer.
  const covered = new Set<string>();
  coverageIds(sanitized, covered);
  const realNodeIds = new Set(graph.nodes.map((n) => n.id));
  const coveredReal = [...covered].filter((id) => realNodeIds.has(id) && id !== 'repo').length;
  if (coveredReal === 0 || sanitized.children.length === 0) return undefined;

  // Force the root to trace to the repo (kind group), then attach real edges.
  sanitized.kind = 'group';
  if (!sanitized.sourceRefs.includes('repo')) sanitized.sourceRefs = ['repo'];
  return attachEdgeRefs(sanitized, graph);
}

/* =========================================================== entrypoint ==== */

/**
 * Build a {@link PlainTree} for `graph`. With a provider configured, attempts
 * the AI path and validates/repairs its output; on ANY failure (no provider,
 * provider error, unusable/over-stripped response) it returns the deterministic
 * structural tree. Never throws for provider reasons — the structural tree is
 * always a valid answer.
 */
export async function buildPlainTree(
  graph: ArchGraph,
  opts: BuildPlainTreeOptions = {}
): Promise<PlainTreeResult> {
  const profile = opts.profile ?? 'recommended';
  const detailLevel = opts.detailLevel ?? 'regular';

  // Best-fit is a DETERMINISTIC classify → per-type emphasis. No AI grouping: the
  // classification is deterministic and the re-bucketing is structural, so this
  // profile always returns a structural tree marked with its product type.
  if (profile === 'bestfit') {
    const { type } = classifyProject(graph);
    return {
      tree: buildStructuralTree(graph, 'bestfit', detailLevel),
      mode: 'structural',
      profile: 'bestfit',
      projectType: type,
    };
  }

  const structural = (): PlainTreeResult => ({
    tree: buildStructuralTree(graph, 'recommended', detailLevel),
    mode: 'structural',
    profile: 'recommended',
  });

  if (!opts.provider) return structural();

  const call = opts.callProvider ?? generateText;
  let text: string;
  try {
    const digest = buildDigest(graph, opts.tree);
    text = await call(opts.provider, buildExplainPrompt(digest, detailLevel));
  } catch {
    // Provider/network/parse failure → the structural tree is the honest answer.
    return structural();
  }

  const valid = validSourceRefs(graph, treePaths(opts.tree));
  const aiTree = parseAiTree(text, graph, valid);
  if (!aiTree) return structural();
  return { tree: aiTree, mode: 'ai', provider: opts.provider.provider, profile: 'recommended' };
}

/** All directory/file paths in a folder walk (extra valid sourceRefs). */
function treePaths(tree?: TreeNode): string[] {
  if (!tree) return [];
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.path) out.push(n.path);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return out;
}
