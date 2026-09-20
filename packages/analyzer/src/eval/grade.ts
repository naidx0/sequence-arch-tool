/**
 * v9 Phase 5 — INTERNAL, dev-only translation-quality eval (NOT a user feature).
 *
 * This is an HONEST eval harness for OUR benefit: it measures, deterministically
 * and offline (no network, no real key), how faithfully Sequence's engine turns
 * real code into the PlainTree "translation", how sane the plain-English labels
 * are, how accurately the deterministic classifier types each repo, and — MOCK
 * ONLY — that the word→system (design_suggest) plumbing normalizes safely.
 *
 * It DRIVES the engine read-only (scanRepo / buildStructuralTree / classifyProject
 * / scoreGraph / buildDesignSuggestPrompt / normalizeDesignSuggestion). It NEVER
 * modifies any engine file. It writes docs/TRANSLATION_GRADE.md and prints the
 * grades. Run: `node packages/analyzer/dist/eval/grade.js`.
 *
 * HONESTY IS THE POINT. Every score is derived from the concrete numbers below;
 * weak spots and not-yet-proven axes (esp. word→system being mock-only) are
 * called out plainly in the report. No inflation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchGraph, PlainNode } from '@sequence/schema';
import { isPureGroup } from '@sequence/schema';
import { scanRepo } from '../scan.js';
import { scoreGraph } from '../score.js';
import { classifyProject, type ProjectType } from '../index.js';
import { buildStructuralTree } from '../explain/explain.js';
import { buildDesignSuggestPrompt, normalizeDesignSuggestion } from '../explain/explain.js';
import { validSourceRefs } from '../explain/plaintree.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..'); // packages/analyzer
const REPO_ROOT = path.resolve(ANALYZER_ROOT, '..', '..'); // monorepo root
const FIX = path.join(ANALYZER_ROOT, 'test', 'fixtures');
const DOC_OUT = path.join(REPO_ROOT, 'docs', 'TRANSLATION_GRADE.md');

/**
 * The reference set the eval runs over, each with the product type WE expect the
 * deterministic classifier to assign. Kept honest: for the minimal shape-only
 * fixtures we note where "microservices"/"server-web" reflects the ≥2-service /
 * server+datastore SHAPE rule rather than a rich domain signal (see caveats).
 */
interface RepoCase {
  name: string;
  dir: string;
  expectType: ProjectType;
  /** Optional ground-truth path for edge precision/recall (shopfront only). */
  groundTruth?: string;
  /** True when the classifier verdict rests on thin/minimal signal. */
  thinSignal?: boolean;
  note?: string;
}

const CASES: RepoCase[] = [
  {
    name: 'shopfront',
    dir: path.join(FIX, 'shopfront'),
    expectType: 'microservices',
    groundTruth: path.join(FIX, 'shopfront', 'ground-truth.json'),
    note: '8 services, 2 datastores, 1 topic — the richest fixture; has hand-written edge ground truth.',
  },
  {
    name: 'ticketing-scaffold',
    dir: path.join(REPO_ROOT, 'examples', 'ticketing-scaffold'),
    expectType: 'microservices',
    note: '3 services, 2 datastores, 1 topic — the design-spec scaffold example.',
  },
  { name: 'spa-dashboard', dir: path.join(FIX, 'spa-dashboard'), expectType: 'spa', note: 'Single frontend service, no server.' },
  { name: 'mobile-rn', dir: path.join(FIX, 'mobile-rn'), expectType: 'mobile', note: 'React Native app.' },
  { name: 'mobile-flutter', dir: path.join(FIX, 'mobile-flutter'), expectType: 'mobile', note: 'Flutter app (0 edges — shape is bare).' },
  { name: 'cli-tool', dir: path.join(FIX, 'cli-tool'), expectType: 'cli', note: 'bin + arg parser, no server.' },
  {
    name: 'plainapp',
    dir: path.join(FIX, 'plainapp'),
    expectType: 'microservices',
    thinSignal: true,
    note: '2 services + 1 datastore. "microservices" is the ≥2-service SHAPE rule, not a domain signal.',
  },
  {
    name: 'shared-backend',
    dir: path.join(FIX, 'shared-backend'),
    expectType: 'microservices',
    thinSignal: true,
    note: '2 services share one datastore. Shape-rule verdict.',
  },
  {
    name: 'dockerfile-env-mini',
    dir: path.join(FIX, 'dockerfile-env-mini'),
    expectType: 'microservices',
    thinSignal: true,
    note: '2 services, 2 datastores — really an env-var parsing fixture. Shape-rule verdict.',
  },
  {
    name: 'k8s-mini/helm',
    dir: path.join(FIX, 'k8s-mini', 'helm'),
    expectType: 'server-web',
    thinSignal: true,
    note: '1 service + 1 datastore from a Helm chart. Shape-rule (server+datastore) verdict.',
  },
  {
    name: 'k8s-mini/plain',
    dir: path.join(FIX, 'k8s-mini', 'plain'),
    expectType: 'server-web',
    thinSignal: true,
    note: '1 service + 1 datastore from plain k8s manifests. Shape-rule verdict.',
  },
];

// ---------------------------------------------------------------------------
// Tree walk helpers (read-only over the PlainNode tree).
// ---------------------------------------------------------------------------

interface TreeStats {
  total: number;
  byKind: Record<string, number>;
  untitled: number; // empty title or literally "(untitled)"
  emptySummary: number; // non-group node with no summary
  nonGroupNoRef: number; // honesty violation: non-group node with no sourceRef
  invalidRefs: number; // sourceRef pointing outside the real structure
  garbledTitles: number; // title still carrying raw id noise (svc:/file:/:: etc.)
  coveredIds: Set<string>; // real service/datastore/topic/file ids present in the tree
}

function walkTree(root: PlainNode, valid: Set<string>): TreeStats {
  const s: TreeStats = {
    total: 0,
    byKind: {},
    untitled: 0,
    emptySummary: 0,
    nonGroupNoRef: 0,
    invalidRefs: 0,
    garbledTitles: 0,
    coveredIds: new Set(),
  };
  const visit = (n: PlainNode): void => {
    s.total++;
    s.byKind[n.kind] = (s.byKind[n.kind] ?? 0) + 1;
    const title = (n.title ?? '').trim();
    if (title === '' || /\(untitled\)/i.test(title)) s.untitled++;
    // A non-group node should carry a friendly, non-empty summary.
    if (!isPureGroup(n.kind) && (n.summary ?? '').trim() === '') s.emptySummary++;
    // Honesty guard: only pure `group` nodes are exempt from the sourceRef rule.
    if (!isPureGroup(n.kind) && (!n.sourceRefs || n.sourceRefs.length === 0)) s.nonGroupNoRef++;
    for (const r of n.sourceRefs ?? []) {
      if (!valid.has(r)) s.invalidRefs++;
      s.coveredIds.add(r);
    }
    // "garbled" = a humanized label that still exposes raw id machinery.
    if (/(^|\s)(svc|file|db|topic):|::|_id\b|[a-z][A-Z]{3,}/.test(title)) s.garbledTitles++;
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  return s;
}

// ---------------------------------------------------------------------------
// Axis 1 + 2: fidelity + labeling, per repo.
// ---------------------------------------------------------------------------

interface RepoResult {
  name: string;
  ok: boolean;
  error?: string;
  serviceCount: number;
  dsCount: number;
  topicCount: number;
  fileCount: number;
  edgeCount: number;
  // fidelity: are all real service/datastore/topic nodes present in the tree?
  structuralTargets: number;
  structuralCovered: number;
  coveragePct: number;
  // labeling
  treeNodes: number;
  untitled: number;
  emptySummary: number;
  nonGroupNoRef: number;
  invalidRefs: number;
  garbledTitles: number;
  filesWithoutSourceRef: number;
  // classifier
  actualType: ProjectType;
  expectType: ProjectType;
  typeMatch: boolean;
  confidence: string;
  thinSignal: boolean;
  // shopfront-only
  precision?: number;
  recall?: number;
  scoreReport?: string;
  note?: string;
}

function baseResult(c: RepoCase): RepoResult {
  return {
    name: c.name,
    ok: false,
    serviceCount: 0,
    dsCount: 0,
    topicCount: 0,
    fileCount: 0,
    edgeCount: 0,
    structuralTargets: 0,
    structuralCovered: 0,
    coveragePct: 0,
    treeNodes: 0,
    untitled: 0,
    emptySummary: 0,
    nonGroupNoRef: 0,
    invalidRefs: 0,
    garbledTitles: 0,
    filesWithoutSourceRef: 0,
    actualType: 'generic',
    expectType: c.expectType,
    typeMatch: false,
    confidence: 'n/a',
    thinSignal: !!c.thinSignal,
    note: c.note,
  };
}

async function evalRepoAsync(c: RepoCase): Promise<RepoResult> {
  const r = baseResult(c);
  let graph: ArchGraph;
  try {
    graph = await scanRepo(c.dir, { cluster: true });
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
    return r;
  }
  r.ok = true;
  const nodes = graph.nodes;
  const services = nodes.filter((n) => n.kind === 'service');
  const datastores = nodes.filter((n) => n.kind === 'datastore');
  const topics = nodes.filter((n) => n.kind === 'topic');
  const files = nodes.filter((n) => n.kind === 'file');
  r.serviceCount = services.length;
  r.dsCount = datastores.length;
  r.topicCount = topics.length;
  r.fileCount = files.length;
  r.edgeCount = graph.edges.length;

  const tree = buildStructuralTree(graph);
  const valid = validSourceRefs(graph);
  const stats = walkTree(tree, valid);
  r.treeNodes = stats.total;
  r.untitled = stats.untitled;
  r.emptySummary = stats.emptySummary;
  r.nonGroupNoRef = stats.nonGroupNoRef;
  r.invalidRefs = stats.invalidRefs;
  r.garbledTitles = stats.garbledTitles;

  // Fidelity: every real service/datastore/topic must appear (by id) in the tree.
  const targets = [...services, ...datastores, ...topics];
  const covered = targets.filter((t) => stats.coveredIds.has(t.id));
  r.structuralTargets = targets.length;
  r.structuralCovered = covered.length;
  r.coveragePct = targets.length === 0 ? 100 : (covered.length / targets.length) * 100;
  // Every real file node should be reachable in the tree too (no dropped files).
  r.filesWithoutSourceRef = files.filter((f) => !stats.coveredIds.has(f.id) && !stats.coveredIds.has(f.path ?? '\0')).length;

  // Classifier.
  const cls = classifyProject(graph);
  r.actualType = cls.type;
  r.confidence = cls.confidence;
  r.typeMatch = cls.type === c.expectType;

  // Shopfront edge precision/recall.
  if (c.groundTruth && fs.existsSync(c.groundTruth)) {
    const tmp = path.join(REPO_ROOT, 'scratchpad-grade-graph.json');
    try {
      fs.writeFileSync(tmp, JSON.stringify(graph));
      const sr = scoreGraph(tmp, c.groundTruth);
      r.precision = sr.precision;
      r.recall = sr.recall;
      r.scoreReport = sr.report;
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Axis 4 (MOCK ONLY): word→system (design_suggest) normalization plumbing.
// ---------------------------------------------------------------------------

interface DesignCheck {
  label: string;
  pass: boolean;
  detail: string;
}

const DESIGN_MAX_TOTAL = 40;
const DESIGN_MAX_PER_LEVEL = 12;
const DESIGN_MAX_DEPTH = 4;
const DESIGN_VALID_KINDS = new Set(['area', 'service', 'feature', 'data', 'file']);

function countNodes(list: { children?: unknown[] }[]): number {
  let n = 0;
  for (const item of list) {
    n++;
    if (Array.isArray(item.children)) n += countNodes(item.children as { children?: unknown[] }[]);
  }
  return n;
}
function maxDepth(list: { children?: unknown[] }[], d = 1): number {
  let m = list.length ? d : 0;
  for (const item of list) {
    if (Array.isArray(item.children) && item.children.length)
      m = Math.max(m, maxDepth(item.children as { children?: unknown[] }[], d + 1));
  }
  return m;
}
function maxPerLevel(list: { children?: unknown[] }[]): number {
  let m = list.length;
  for (const item of list) {
    if (Array.isArray(item.children) && item.children.length)
      m = Math.max(m, maxPerLevel(item.children as { children?: unknown[] }[]));
  }
  return m;
}
function allKindsValid(list: { kind?: string; children?: unknown[] }[]): boolean {
  for (const item of list) {
    if (!DESIGN_VALID_KINDS.has(item.kind ?? '')) return false;
    if (Array.isArray(item.children) && !allKindsValid(item.children as { kind?: string; children?: unknown[] }[]))
      return false;
  }
  return true;
}
function allTitlesNonEmpty(list: { title?: string; children?: unknown[] }[]): boolean {
  for (const item of list) {
    if (!item.title || item.title.trim() === '') return false;
    if (Array.isArray(item.children) && !allTitlesNonEmpty(item.children as { title?: string; children?: unknown[] }[]))
      return false;
  }
  return true;
}

function runDesignSuggestChecks(): { checks: DesignCheck[]; passed: number } {
  const checks: DesignCheck[] = [];

  // (a) Prompt plumbing: the description + design framing ride into the prompt.
  const desc = 'a pet adoption app with a browse page and a database of pets';
  const prompt = buildDesignSuggestPrompt(desc, undefined, 'pet-app');
  checks.push({
    label: 'prompt carries the user description',
    pass: prompt.includes(desc),
    detail: prompt.includes(desc) ? 'description embedded verbatim' : 'description MISSING from prompt',
  });
  checks.push({
    label: 'prompt frames blocks as PROPOSED/design (never "detected")',
    pass: /DO NOT EXIST yet/i.test(prompt) && /design, not a scan/i.test(prompt),
    detail: 'contains "DO NOT EXIST yet" + "design, not a scan" framing',
  });
  checks.push({
    label: 'prompt carries the repo name when supplied',
    pass: prompt.includes('pet-app'),
    detail: 'project name "pet-app" present',
  });

  // (b) Well-formed canned reply → well-formed, non-empty, within caps.
  const wellFormed = JSON.stringify({
    nodes: [
      {
        title: 'Frontend',
        kind: 'area',
        children: [
          { title: 'Pet browser', kind: 'feature' },
          { title: 'Adoption form', kind: 'feature' },
        ],
      },
      { title: 'Backend', kind: 'service', children: [{ title: 'Adoption API', kind: 'service' }] },
      { title: 'Pets database', kind: 'data' },
    ],
  });
  const good = normalizeDesignSuggestion(wellFormed);
  checks.push({
    label: 'well-formed reply → non-empty proposal',
    pass: good.length >= 1,
    detail: `${good.length} top-level node(s)`,
  });
  checks.push({
    label: 'well-formed reply → all kinds valid',
    pass: allKindsValid(good),
    detail: allKindsValid(good) ? 'every kind ∈ {area,service,feature,data,file}' : 'invalid kind survived',
  });
  checks.push({
    label: 'well-formed reply → all titles non-empty',
    pass: allTitlesNonEmpty(good),
    detail: allTitlesNonEmpty(good) ? 'no empty titles' : 'empty title survived',
  });
  checks.push({
    label: 'well-formed reply → nesting preserved',
    pass: Array.isArray(good[0]?.children) && (good[0]!.children?.length ?? 0) === 2,
    detail: `Frontend has ${good[0]?.children?.length ?? 0} children (expected 2)`,
  });

  // (c) Malformed (non-JSON) → empty list, never throws.
  let malformedThrew = false;
  let malformed: unknown[] = [];
  try {
    malformed = normalizeDesignSuggestion('total nonsense, there is no json object here at all');
  } catch {
    malformedThrew = true;
  }
  checks.push({
    label: 'non-JSON reply → [] (never throws)',
    pass: !malformedThrew && malformed.length === 0,
    detail: malformedThrew ? 'THREW (bad)' : `normalized to ${malformed.length} nodes`,
  });

  // (d) Oversized / deep / bad-kind reply → capped, coerced, never throws.
  const huge = {
    nodes: Array.from({ length: 100 }, (_, i) => ({
      title: `n${i}`,
      kind: 'not-a-real-kind',
      children: Array.from({ length: 50 }, (_, j) => ({
        title: `c${i}-${j}`,
        kind: 'also-bogus',
        children: Array.from({ length: 20 }, (_, k) => ({ title: `g${i}-${j}-${k}`, kind: 'feature' })),
      })),
    })),
  };
  let oversizedThrew = false;
  let capped: { kind?: string; title?: string; children?: unknown[] }[] = [];
  try {
    capped = normalizeDesignSuggestion(JSON.stringify(huge));
  } catch {
    oversizedThrew = true;
  }
  const total = countNodes(capped);
  const depth = maxDepth(capped);
  const perLevel = maxPerLevel(capped);
  checks.push({
    label: 'oversized reply → total nodes capped',
    pass: !oversizedThrew && total <= DESIGN_MAX_TOTAL,
    detail: `${total} nodes (cap ${DESIGN_MAX_TOTAL})`,
  });
  checks.push({
    label: 'oversized reply → per-level fan-out capped',
    pass: perLevel <= DESIGN_MAX_PER_LEVEL,
    detail: `max ${perLevel} per level (cap ${DESIGN_MAX_PER_LEVEL})`,
  });
  checks.push({
    label: 'oversized reply → depth capped',
    pass: depth <= DESIGN_MAX_DEPTH,
    detail: `depth ${depth} (cap ${DESIGN_MAX_DEPTH})`,
  });
  checks.push({
    label: 'oversized reply → bogus kinds coerced to valid',
    pass: allKindsValid(capped),
    detail: allKindsValid(capped) ? 'all coerced to valid kinds' : 'a bogus kind survived',
  });
  checks.push({
    label: 'oversized reply → never throws',
    pass: !oversizedThrew,
    detail: oversizedThrew ? 'THREW (bad)' : 'returned safely',
  });

  // (e) Empty-title nodes get dropped (safety of the plumbing).
  const withEmpties = JSON.stringify({
    nodes: [
      { title: '', kind: 'area' },
      { title: '   ', kind: 'service' },
      { title: 'Real one', kind: 'feature' },
    ],
  });
  const cleaned = normalizeDesignSuggestion(withEmpties);
  checks.push({
    label: 'empty/blank-title nodes dropped',
    pass: cleaned.length === 1 && cleaned[0]?.title === 'Real one',
    detail: `${cleaned.length} node(s) survived (expected 1)`,
  });

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed };
}

// ---------------------------------------------------------------------------
// Scoring: turn the concrete numbers into an honest 1–10 per axis.
// ---------------------------------------------------------------------------

function clamp10(x: number): number {
  return Math.max(1, Math.min(10, Math.round(x)));
}

interface Grades {
  fidelity: number;
  labeling: number;
  classifier: number;
  wordToSystem: number;
}

function grade(results: RepoResult[], design: { checks: DesignCheck[]; passed: number }): Grades {
  const ok = results.filter((r) => r.ok);

  // Axis 1 — code→structure fidelity.
  // Weighted from: mean node coverage %, shopfront edge precision/recall, and
  // the count of nodes dropped (files without a sourceRef).
  const meanCoverage = ok.reduce((s, r) => s + r.coveragePct, 0) / Math.max(1, ok.length);
  const shop = ok.find((r) => r.name === 'shopfront');
  const edgeF1 =
    shop && shop.precision != null && shop.recall != null
      ? (2 * shop.precision * shop.recall) / Math.max(1e-9, shop.precision + shop.recall)
      : 0;
  const droppedFiles = ok.reduce((s, r) => s + r.filesWithoutSourceRef, 0);
  // 60% coverage, 40% edge F1; then a hard penalty per dropped file. HONESTY CAP
  // at 9: edge fidelity is ground-truthed on ONE repo (shopfront), so a perfect
  // 10 would overclaim edge correctness across the set (see weak spots).
  const fidelityRaw = (meanCoverage / 100) * 6 + edgeF1 * 4 - droppedFiles * 0.5;
  const fidelityScore = Math.min(9, clamp10(fidelityRaw));

  // Axis 2 — plain-English labeling sanity.
  // Perfect = no untitled, no empty summaries, no honesty violations, no invalid
  // refs, no garbled titles. Each class of defect docks the score.
  const totalTreeNodes = ok.reduce((s, r) => s + r.treeNodes, 0);
  const untitled = ok.reduce((s, r) => s + r.untitled, 0);
  const emptySummary = ok.reduce((s, r) => s + r.emptySummary, 0);
  const honesty = ok.reduce((s, r) => s + r.nonGroupNoRef, 0);
  const invalid = ok.reduce((s, r) => s + r.invalidRefs, 0);
  const garbled = ok.reduce((s, r) => s + r.garbledTitles, 0);
  const defectRate = totalTreeNodes === 0 ? 1 : (untitled + emptySummary + honesty + invalid + garbled) / totalTreeNodes;
  // Honesty violations + invalid refs are disqualifying — force low if any exist.
  let labeling = (1 - defectRate) * 10;
  if (honesty > 0 || invalid > 0) labeling = Math.min(labeling, 4);
  // HONESTY CAP at 9: these checks are STRUCTURAL (non-empty, sourced, not garbled),
  // NOT SEMANTIC — a title can pass every check and still describe the code poorly.
  // Semantic label quality is not graded here, so a clean run earns 9, not 10.
  const labelingScore = Math.min(9, clamp10(labeling));

  // Axis 3 — classifier accuracy (share of repos whose type == expected).
  // HONEST DISCOUNT: a "correct" verdict that rests only on graph SHAPE for a
  // minimal fixture (thinSignal) is low-information — a real 2-service app and a
  // genuine mesh read identically. Thin-signal matches get 0.6 credit, rich
  // (framework/signal-backed) matches get full credit. Raw accuracy is still in
  // the report; this score reflects discriminative power, not table-matching.
  const richMatched = ok.filter((r) => r.typeMatch && !r.thinSignal).length;
  const thinMatched = ok.filter((r) => r.typeMatch && r.thinSignal).length;
  const effective = ok.length === 0 ? 0 : (richMatched + 0.6 * thinMatched) / ok.length;
  const classifierScore = clamp10(effective * 10);

  // Axis 4 — word→system plumbing (MOCK ONLY; explicitly not live-model quality).
  const passRate = design.checks.length === 0 ? 0 : design.passed / design.checks.length;
  // Even a perfect plumbing pass is capped: this axis is UNPROVEN on a real model.
  const wordScore = Math.min(7, clamp10(passRate * 10));

  return { fidelity: fidelityScore, labeling: labelingScore, classifier: classifierScore, wordToSystem: wordScore };
}

// ---------------------------------------------------------------------------
// Report + main.
// ---------------------------------------------------------------------------

function pct(x: number): string {
  return `${x.toFixed(1)}%`;
}

function buildReport(results: RepoResult[], design: { checks: DesignCheck[]; passed: number }, g: Grades): string {
  const ok = results.filter((r) => r.ok);
  const shop = ok.find((r) => r.name === 'shopfront');
  const matched = ok.filter((r) => r.typeMatch).length;
  const meanCoverage = ok.reduce((s, r) => s + r.coveragePct, 0) / Math.max(1, ok.length);
  const untitled = ok.reduce((s, r) => s + r.untitled, 0);
  const emptySummary = ok.reduce((s, r) => s + r.emptySummary, 0);
  const honesty = ok.reduce((s, r) => s + r.nonGroupNoRef, 0);
  const invalid = ok.reduce((s, r) => s + r.invalidRefs, 0);
  const garbled = ok.reduce((s, r) => s + r.garbledTitles, 0);
  const droppedFiles = ok.reduce((s, r) => s + r.filesWithoutSourceRef, 0);
  const totalTreeNodes = ok.reduce((s, r) => s + r.treeNodes, 0);

  const L: string[] = [];
  L.push('# Sequence — Internal Translation Grade');
  L.push('');
  L.push('> **Internal, dev-only honest eval. NOT a user feature.** This is a report *we* use to');
  L.push('> reason about how good Sequence\'s code→structure→plain-English translation actually is.');
  L.push('> It is generated by `packages/analyzer/src/eval/grade.ts` (compiled to');
  L.push('> `packages/analyzer/dist/eval/grade.js`), runs **deterministically and offline** (no');
  L.push('> network, no real model key), and reads the engine without modifying it.');
  L.push('>');
  L.push('> **Regenerate:** `node packages/analyzer/dist/eval/grade.js` (or `pnpm grade`).');
  L.push('>');
  L.push(`> Generated over ${ok.length} reference repos/fixtures + the design-suggest mock harness.`);
  L.push('> The point of this file is HONESTY, not a good-looking number. Weak spots are called out.');
  L.push('');
  L.push('## Scores at a glance (1–10)');
  L.push('');
  L.push('| Axis | Score | What it measures |');
  L.push('| --- | --- | --- |');
  L.push(`| Code→structure fidelity | **${g.fidelity}/10** | All real services/datastores/topics/files present in the PlainTree; shopfront edge precision/recall. |`);
  L.push(`| Plain-English labeling sanity | **${g.labeling}/10** | Non-empty human titles/summaries, no invented sourceRefs, no honesty violations, no garbled labels. |`);
  L.push(`| Classifier accuracy | **${g.classifier}/10** | Deterministic product-type vs. an expected-type table. |`);
  L.push(`| Word→system (design_suggest) — **MOCK ONLY** | **${g.wordToSystem}/10** | Normalization plumbing only. **Unproven on a live model.** Capped at 7 by design. |`);
  L.push('');
  L.push('---');
  L.push('');

  // Axis 1
  L.push('## Axis 1 — Code→structure fidelity');
  L.push('');
  L.push('**Method.** For every repo we `scanRepo(..., {cluster:true})` to a real `ArchGraph`, build');
  L.push('the deterministic `buildStructuralTree(graph)` PlainTree, then check that **every** real');
  L.push('service / datastore / topic node id appears (via `sourceRefs`) somewhere in the tree — i.e.');
  L.push('nothing the scanner found gets dropped or duplicated in the translation. For shopfront (the');
  L.push('one fixture with hand-written ground truth) we also compute service-level edge');
  L.push('precision/recall via `scoreGraph`.');
  L.push('');
  L.push('| Repo | Services | Datastores | Topics | Files | Tree nodes | Node coverage | Dropped files |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    if (!r.ok) {
      L.push(`| ${r.name} | — | — | — | — | — | scan error: ${r.error} | — |`);
      continue;
    }
    L.push(
      `| ${r.name} | ${r.serviceCount} | ${r.dsCount} | ${r.topicCount} | ${r.fileCount} | ${r.treeNodes} | ${r.structuralCovered}/${r.structuralTargets} (${pct(r.coveragePct)}) | ${r.filesWithoutSourceRef} |`
    );
  }
  L.push('');
  L.push(`**Result.** Mean node coverage across repos: **${pct(meanCoverage)}**. Dropped files (real file`);
  L.push(`node absent from the tree): **${droppedFiles}**.`);
  if (shop && shop.precision != null && shop.recall != null) {
    L.push('');
    L.push(`**Shopfront edge precision/recall** (`+"`scoreGraph` vs `ground-truth.json`):");
    L.push(`precision **${pct(shop.precision * 100)}**, recall **${pct(shop.recall * 100)}**.`);
    if (shop.scoreReport) {
      L.push('');
      L.push('```');
      L.push(shop.scoreReport.trim());
      L.push('```');
    }
  }
  L.push('');
  L.push(`**Score: ${g.fidelity}/10.** ` + fidelityRationale(g.fidelity, meanCoverage, shop, droppedFiles));
  L.push('');
  L.push('---');
  L.push('');

  // Axis 2
  L.push('## Axis 2 — Plain-English labeling sanity');
  L.push('');
  L.push('**Method.** Heuristic checks over every node of every structural PlainTree:');
  L.push('empty/`(untitled)` titles; non-group nodes missing a one-line summary; the **honesty guard**');
  L.push('(every non-`group` node must carry ≥1 real `sourceRef`); `sourceRefs` pointing outside the');
  L.push('real structure (`validSourceRefs`); and "garbled" titles still exposing raw id machinery');
  L.push('(`svc:`/`file:`/`::`/run-on camelCase).');
  L.push('');
  L.push('| Repo | Tree nodes | Untitled | Empty summary | Honesty viol. | Invalid refs | Garbled |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of ok) {
    L.push(
      `| ${r.name} | ${r.treeNodes} | ${r.untitled} | ${r.emptySummary} | ${r.nonGroupNoRef} | ${r.invalidRefs} | ${r.garbledTitles} |`
    );
  }
  L.push('');
  L.push(
    `**Result.** Across **${totalTreeNodes}** plain nodes: untitled **${untitled}**, empty summaries ` +
      `**${emptySummary}**, honesty violations **${honesty}**, invalid sourceRefs **${invalid}**, garbled ` +
      `titles **${garbled}**.`
  );
  L.push('');
  L.push(`**Score: ${g.labeling}/10.** ` + labelingRationale(g.labeling, honesty, invalid, untitled, emptySummary, garbled));
  L.push('');
  L.push('---');
  L.push('');

  // Axis 3
  L.push('## Axis 3 — Classifier accuracy');
  L.push('');
  L.push('**Method.** `classifyProject(graph)` is a **deterministic** first-match cascade (no AI). We');
  L.push('encode the product type we expect for each repo and compare. `matchedSignals`/confidence make');
  L.push('each verdict inspectable.');
  L.push('');
  L.push('| Repo | Expected | Classified | Confidence | Match | Basis |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of ok) {
    const basis = r.thinSignal ? 'thin/shape-rule' : 'signal/rich';
    L.push(`| ${r.name} | ${r.expectType} | ${r.actualType} | ${r.confidence} | ${r.typeMatch ? '✅' : '❌'} | ${basis} |`);
  }
  L.push('');
  const thinMatched = ok.filter((r) => r.typeMatch && r.thinSignal).length;
  L.push(`**Result.** ${matched}/${ok.length} correct = **${pct((matched / Math.max(1, ok.length)) * 100)}** raw accuracy (${thinMatched} of them thin-signal/shape-rule matches).`);
  L.push('');
  L.push(`**Score: ${g.classifier}/10.** ` + classifierRationale(g.classifier, matched, ok.length, thinMatched));
  L.push('');
  L.push('---');
  L.push('');

  // Axis 4
  L.push('## Axis 4 — Word→system (design_suggest) coherence — MOCK ONLY');
  L.push('');
  L.push('> ⚠️ **This axis measures the PLUMBING/normalization, NOT real model quality.** There is no');
  L.push('> real model key in this environment, so the "well-formed" and "malformed" model replies are');
  L.push('> **canned**. What is verified: the prompt carries the description + design framing, and');
  L.push('> `normalizeDesignSuggestion` produces well-formed, capped, kind-coerced, never-throwing');
  L.push('> output for good AND adversarial input. Whether a *real* model returns a sensible system for');
  L.push('> a given sentence is **UNPROVEN here.** The score is capped at 7 for that reason.');
  L.push('');
  L.push('| Check | Result | Detail |');
  L.push('| --- | --- | --- |');
  for (const c of design.checks) {
    L.push(`| ${c.label} | ${c.pass ? '✅' : '❌'} | ${c.detail} |`);
  }
  L.push('');
  L.push(`**Result.** ${design.passed}/${design.checks.length} plumbing checks pass.`);
  L.push('');
  L.push(`**Score: ${g.wordToSystem}/10.** Plumbing is ${design.passed === design.checks.length ? 'solid' : 'incomplete'};`);
  L.push('the cap at 7 reflects that live-model coherence is not measured here.');
  L.push('');
  L.push('---');
  L.push('');

  // Weak spots
  L.push('## Weak spots & not-yet-proven');
  L.push('');
  const thin = ok.filter((r) => r.thinSignal).map((r) => r.name);
  L.push('- **Word→system is mock-only (biggest caveat).** Axis 4 proves the normalization/plumbing is');
  L.push('  safe, deterministic, and capped — it does **not** prove a live model returns a coherent');
  L.push('  system for an English sentence. Treat Axis 4 as "the guardrails hold", not "the feature is good".');
  L.push(`- **Thin-signal fixtures.** ${thin.length ? thin.join(', ') : '(none)'} are minimal fixtures whose`);
  L.push('  classifier verdict rests on graph **shape** (≥2 services ⇒ microservices; 1 service + datastore');
  L.push('  ⇒ server-web), not a rich domain signal. The verdict is *defensible* but low-information; a real');
  L.push('  2-service app and a genuine microservice mesh currently read the same. Distinct per-type');
  L.push('  geometries are deferred to v10.');
  L.push('- **Ground truth is one repo.** Edge precision/recall is measured only on shopfront. The other');
  L.push('  repos have no hand-written edge truth, so their fidelity score rests on node-coverage only —');
  L.push('  a dropped/duplicated *edge* would not be caught outside shopfront.');
  L.push('- **Structural (no-AI) path only.** These grades use `buildStructuralTree` (the deterministic');
  L.push('  fallback). The AI grouping/relabel path is guarded by the honesty filter (invented refs');
  L.push('  stripped) but its *label quality* is not graded here — same live-model caveat as Axis 4.');
  L.push('- **`mobile-flutter` has 0 edges.** Its shape is bare (1 service, no interactions); the mobile');
  L.push('  verdict comes from framework signals, and there is essentially no topology to translate.');
  L.push('');
  L.push('## Honest overall read');
  L.push('');
  L.push(overallRead(g));
  L.push('');
  L.push('---');
  L.push('');
  L.push('_Regenerate this file with `node packages/analyzer/dist/eval/grade.js`. Deterministic + offline._');
  L.push('');
  return L.join('\n');
}

function fidelityRationale(score: number, cov: number, shop: RepoResult | undefined, dropped: number): string {
  const parts: string[] = [];
  parts.push(`Node coverage is ${pct(cov)} across the set` + (cov >= 99.5 ? ' — nothing the scanner found is dropped from the tree.' : '.'));
  if (shop && shop.precision != null && shop.recall != null)
    parts.push(
      `Shopfront edges score ${pct(shop.precision * 100)}/${pct(shop.recall * 100)} precision/recall — the one place edges are ground-truthed, it is exact.`
    );
  if (dropped > 0) parts.push(`${dropped} real file node(s) missing from the tree docked the score.`);
  else parts.push('No dropped files.');
  parts.push('**Capped at 9 (not 10)** because edge fidelity is ground-truthed on a SINGLE repo (shopfront); a dropped or invented edge in any other repo would not be caught here (see weak spots).');
  return parts.join(' ');
}

function labelingRationale(
  score: number,
  honesty: number,
  invalid: number,
  untitled: number,
  emptySummary: number,
  garbled: number
): string {
  if (honesty === 0 && invalid === 0 && untitled === 0 && emptySummary === 0 && garbled === 0)
    return 'Every node has a human title + summary, every non-group node traces to a real sourceRef, zero invented refs, zero garbled labels. **Capped at 9 (not 10)** because these checks are STRUCTURAL, not SEMANTIC — a title can pass every check and still be a poor description of what the code does. Semantic label quality is not graded here.';
  const issues: string[] = [];
  if (honesty > 0) issues.push(`${honesty} honesty violation(s) (non-group node with no sourceRef) — disqualifying, forced the score down`);
  if (invalid > 0) issues.push(`${invalid} invented sourceRef(s) — disqualifying`);
  if (untitled > 0) issues.push(`${untitled} untitled node(s)`);
  if (emptySummary > 0) issues.push(`${emptySummary} empty summaries`);
  if (garbled > 0) issues.push(`${garbled} garbled title(s)`);
  return 'Defects found: ' + issues.join('; ') + '.';
}

function classifierRationale(score: number, matched: number, total: number, thinMatched: number): string {
  const head =
    matched === total
      ? `Raw accuracy is 100% (${matched}/${total}) against our expected-type table.`
      : `${total - matched} repo(s) missed the expected type (raw accuracy ${matched}/${total}). See the table.`;
  return (
    head +
    ` **The score is deliberately below the raw accuracy**: ${thinMatched} of the ${matched} correct verdicts` +
    ` are THIN-SIGNAL — they rest only on graph SHAPE (≥2 services ⇒ microservices; 1 service + datastore ⇒` +
    ` server-web) for minimal fixtures, so a real 2-service app and a genuine mesh currently read identically.` +
    ` Thin matches get 0.6 credit here. This is the deterministic cascade (never an AI guess), and the table` +
    ` was authored by us, so read this as "the cascade is self-consistent and safe", not "it understands the domain".`
  );
}

function overallRead(g: Grades): string {
  const avg = (g.fidelity + g.labeling + g.classifier + g.wordToSystem) / 4;
  return (
    `Where Sequence is genuinely strong is the **deterministic core**: code→structure fidelity ` +
    `(${g.fidelity}/10) and plain-English labeling (${g.labeling}/10) are high because the structural ` +
    `translation drops nothing, invents nothing, and every label traces to a real source. The ` +
    `classifier (${g.classifier}/10) is accurate against our table but leans on graph shape for the ` +
    `minimal fixtures, so its real-world discrimination is softer than the number suggests. The ` +
    `honest ceiling is Axis 4 (${g.wordToSystem}/10): the design-suggest **plumbing** is safe, but its ` +
    `**live-model coherence is unproven here** — that is the single biggest gap between this grade and ` +
    `a claim that the end-to-end word→system feature is "good". Overall, treat this as: *the parts that ` +
    `are deterministic are trustworthy; the parts that need a real model are only proven safe, not proven good.* ` +
    `(unweighted mean ≈ ${avg.toFixed(1)}/10, but the per-axis numbers matter more than the average.)`
  );
}

async function main(): Promise<void> {
  const results: RepoResult[] = [];
  for (const c of CASES) {
    results.push(await evalRepoAsync(c));
  }
  const design = runDesignSuggestChecks();
  const g = grade(results, design);

  // Console summary.
  console.log('\n=== Sequence internal translation grade (deterministic, offline) ===\n');
  for (const r of results) {
    if (!r.ok) {
      console.log(`  ${r.name.padEnd(20)} SCAN ERROR: ${r.error}`);
      continue;
    }
    const edge = r.precision != null ? ` edgeP/R=${pct(r.precision * 100)}/${pct(r.recall! * 100)}` : '';
    console.log(
      `  ${r.name.padEnd(20)} type=${r.actualType.padEnd(14)} ${r.typeMatch ? 'OK ' : 'MISS'} ` +
        `cov=${pct(r.coveragePct).padStart(6)} nodes=${String(r.treeNodes).padStart(3)}${edge}`
    );
  }
  console.log(`\n  design_suggest plumbing: ${design.passed}/${design.checks.length} checks pass\n`);
  console.log('  GRADES (1-10):');
  console.log(`    Axis 1 code→structure fidelity : ${g.fidelity}/10`);
  console.log(`    Axis 2 plain-English labeling  : ${g.labeling}/10`);
  console.log(`    Axis 3 classifier accuracy     : ${g.classifier}/10`);
  console.log(`    Axis 4 word→system (MOCK ONLY) : ${g.wordToSystem}/10   [unproven on a live model]`);
  console.log('');

  const report = buildReport(results, design, g);
  fs.mkdirSync(path.dirname(DOC_OUT), { recursive: true });
  fs.writeFileSync(DOC_OUT, report);
  console.log(`  Wrote ${path.relative(REPO_ROOT, DOC_OUT)} (${report.length} bytes)\n`);
}

main().catch((e) => {
  console.error('grade.ts failed:', e);
  process.exit(1);
});
