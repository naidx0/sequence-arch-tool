/**
 * Deterministic per-repo metrics for the multi-repo QA loop.
 *
 * Every function here is PURE — graph in, numbers out — so each one can be
 * unit-tested against a synthetic fixture graph without a scan, a clone or a
 * network. `run.mjs` does the I/O; this file does the counting.
 *
 * The strings matched below are LOAD-BEARING. They are the engine's own
 * fallback labels, and the whole point of the metric is to notice when a real
 * repo lands on them:
 *
 *   - `'Top level'`  — packages/analyzer/src/cluster/cluster.ts (structuralLabel's
 *     no-anchor fallback). It says where files sit, not what they are.
 *   - `A group of N related files.` — packages/analyzer/src/explain/explain.ts
 *     (buildFeatureNode's `grounded ?? ...` fallback). It is what a module says
 *     when file signals produced nothing.
 *
 * If either string changes in the engine, this file must change with it — and
 * `test/metrics.test.mjs` asserts the engine still emits them, so a rename
 * fails loudly instead of silently zeroing the metric.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * U30 — EVERY METRIC HERE MUST MEASURE AN OUTCOME, NOT AN ATTEMPT.
 *
 * `stemFound` was `candidates.length > 0`. It was `true` on all 26 scanning
 * repos of the corpus, INCLUDING flask, express, gin and n8n, where clicking
 * "Show main flow" dead-ended and played nothing. It measured that a stem was
 * NAMED, not that a flow PLAYS — so the loop ran the exact defect 27 times a
 * round and reported green. That is the failure mode this file is now written
 * against, and the rule it applies to every metric below:
 *
 *   Ask what the USER gets, not what the engine emitted. A label exists ≠ a
 *   label reads. Evidence exists ≠ evidence opens. A stem exists ≠ a flow plays.
 *
 * Where a metric is honest about a narrower question, it says so in its own
 * doc comment rather than being widened into something it cannot support.
 */

/** Verbatim fallback module label (cluster.ts). */
export const FALLBACK_MODULE_LABEL = 'Top level';

/** Verbatim generic module summary (explain.ts). */
export const GENERIC_GROUP_SUMMARY = /^A group of \d+ related files?\.$/;

/** The exact shape validateGraph uses for a missing-evidence violation. */
export const NO_EVIDENCE_PROBLEM = /^edge .+ has no evidence$/;

/** @param {unknown} label */
export function isFallbackModuleLabel(label) {
  return label === FALLBACK_MODULE_LABEL;
}

/**
 * U30 — THE ROW THAT READS AS NOTHING AT ALL.
 *
 * G12 shipped on the real corpus: a flask module (`p:mod:flask/5`, 35 py files)
 * came back with an EMPTY label. `fallbackTitlePct` reported flask at 0% — the
 * worst possible title was invisible to the metric that exists to count bad
 * titles, because it only ever matched the literal `'Top level'`. A blank label
 * is not a weaker fallback than "Top level"; it is a stronger one. So it counts.
 *
 * Missing (`undefined`/non-string) counts too: on a board both render the same
 * empty row.
 *
 * @param {unknown} label
 */
export function isBlankLabel(label) {
  return typeof label !== 'string' || label.trim() === '';
}

/**
 * The same question for a rendered summary: a module whose summary is present
 * but blank tells the reader nothing. An ABSENT summary is a different thing
 * (the tree simply has no row for it) and is deliberately not counted here.
 *
 * @param {unknown} summary
 */
export function isBlankSummary(summary) {
  return typeof summary === 'string' && summary.trim() === '';
}

/**
 * U30 — how a title READS, not how it is spelled.
 *
 * `dupTitleStats` used to key on the raw label, so `'Core'`, `'core'` and
 * `'Core '` were three distinct titles to the metric and one identical row to
 * the human reading the board. Settled owner canon is about what the user sees
 * ("a row that just repeats its own name", HANDOFF §6), so the comparison is
 * done on the rendered form: trimmed, inner whitespace collapsed, case-folded.
 *
 * @param {unknown} label
 */
export function normalizeTitle(label) {
  return typeof label === 'string' ? label.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

/** @param {unknown} summary */
export function isGenericGroupSummary(summary) {
  return typeof summary === 'string' && GENERIC_GROUP_SUMMARY.test(summary);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Evidence coverage, derived from `validateGraph`'s own problem list rather
 * than from a re-implementation of the rule. That keeps the metric and the
 * schema invariant impossible to drift apart.
 *
 * `evidencePct` is null (not 0, not 100) for a graph with no edges — "there was
 * nothing to measure" is a different statement from "everything failed".
 *
 * U30 VERDICT — HONEST, BUT NARROW, AND IT NOW SAYS SO. This measures the
 * SCHEMA INVARIANT: `evidence.length > 0`. That is a true statement about the
 * invariant and nothing more; an edge whose evidence names a file that is not
 * on disk, or line 0, satisfies it while the user's click dead-ends. The
 * outcome question — *does the evidence open?* — is
 * {@link evidenceResolutionStats}, which is a separate number precisely so this
 * one keeps meaning what it has always meant and the baseline stays comparable.
 *
 * @param {string[]} problems output of validateGraph(graph)
 * @param {number} edgeCount graph.edges.length
 */
export function evidenceStats(problems, edgeCount) {
  const list = Array.isArray(problems) ? problems : [];
  const edgesWithoutEvidence = list.filter((p) => NO_EVIDENCE_PROBLEM.test(p)).length;
  const otherProblems = list.length - edgesWithoutEvidence;
  return {
    edges: edgeCount,
    edgesWithoutEvidence,
    otherValidationProblems: otherProblems,
    evidencePct: edgeCount === 0 ? null : round1(((edgeCount - edgesWithoutEvidence) / edgeCount) * 100),
  };
}

/**
 * U30 — DOES THE EVIDENCE ACTUALLY OPEN?
 *
 * `evidencePct` above answers "is the array non-empty". The user's question is
 * different: they click an edge, the UI offers `file:line`, and either the
 * editor lands on a real line of a real file or the claim was decoration.
 * `Evidence` is `{file, line, snippet}` (packages/schema/src/index.ts) and
 * NOTHING in the schema checks that the file exists or that the line is inside
 * it — so an edge can be 100% "evidenced" and 0% openable.
 *
 * An edge counts as RESOLVED when at least one of its evidence entries names a
 * file the resolver can find and a line within that file (1-based, inclusive).
 * One openable citation is enough: that is what the user needs to get somewhere.
 *
 * PURE by injection — `lineCountOf(file)` is supplied by the caller
 * (`lib/measure.mjs` reads the clone from disk), so this file still needs no fs
 * and every case below is testable without a repo.
 *
 * @param {unknown[]} edges graph.edges
 * @param {(file: string) => number | null} lineCountOf lines in the file, or null if it does not exist
 */
export function evidenceResolutionStats(edges, lineCountOf) {
  const list = Array.isArray(edges) ? edges : [];
  let withEvidence = 0;
  let resolved = 0;
  let missingFile = 0;
  let lineOutOfRange = 0;
  let blankSnippet = 0;
  const examples = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const ev = Array.isArray(e.evidence) ? e.evidence : [];
    if (ev.length === 0) continue; // already counted by evidenceStats
    withEvidence += 1;
    let ok = false;
    /** @type {string|null} */
    let firstProblem = null;
    for (const item of ev) {
      const file = item && typeof item.file === 'string' ? item.file : '';
      const line = item && typeof item.line === 'number' ? item.line : NaN;
      if (typeof item?.snippet !== 'string' || item.snippet.trim() === '') blankSnippet += 1;
      if (file.trim() === '') {
        firstProblem ??= 'evidence has no file';
        continue;
      }
      const lines = lineCountOf(file);
      if (lines === null || lines === undefined) {
        firstProblem ??= `no such file: ${file}`;
        continue;
      }
      if (!Number.isFinite(line) || line < 1 || line > lines) {
        firstProblem ??= `${file}:${line} is outside the file (${lines} lines)`;
        continue;
      }
      ok = true;
      break;
    }
    if (ok) {
      resolved += 1;
      continue;
    }
    if (firstProblem && firstProblem.startsWith('no such file')) missingFile += 1;
    else lineOutOfRange += 1;
    if (examples.length < 5) examples.push({ edge: String(e.id ?? '(no id)'), problem: firstProblem });
  }
  return {
    edgesWithEvidence: withEvidence,
    edgesWithResolvableEvidence: resolved,
    unresolvedMissingFile: missingFile,
    unresolvedBadLine: lineOutOfRange,
    blankSnippets: blankSnippet,
    evidenceResolvedPct: withEvidence === 0 ? null : round1((resolved / withEvidence) * 100),
    examples,
  };
}

/**
 * Flatten a PlainTree into `id -> summary`. The structural tree gives a module
 * node the id `p:<moduleNodeId>`, which is how a module's graph label and its
 * rendered summary are joined below.
 *
 * @param {{id?: string, summary?: string, children?: unknown[]} | null | undefined} node
 * @param {Map<string,string>} [into]
 */
export function collectPlainSummaries(node, into = new Map()) {
  if (!node || typeof node !== 'object') return into;
  if (typeof node.id === 'string' && typeof node.summary === 'string') into.set(node.id, node.summary);
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const k of kids) collectPlainSummaries(k, into);
  return into;
}

/**
 * How much of the repo the labeller could not name.
 *
 * A module counts as fallback-titled when ANY of these hold:
 *   - its graph label is the mechanical `'Top level'`
 *   - its rendered summary is the generic "A group of N related files."
 *   - U30: its label is BLANK, or its rendered summary is present but blank
 *
 * All four are the engine saying "I could not tell you what this is", and all
 * four are what the owner reads on a board. The blank cases were added in U30
 * because G12 — an empty flask module label, the worst row on the board —
 * scored this metric at a clean 0%.
 *
 * @param {{nodes?: unknown[]}} graph
 * @param {object} [plainTree] optional structural PlainTree for the same graph
 */
export function fallbackTitleStats(graph, plainTree) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const modules = nodes.filter((n) => n && typeof n === 'object' && n.kind === 'module');
  const summaries = collectPlainSummaries(plainTree);
  let byLabel = 0;
  let bySummary = 0;
  let byBlankLabel = 0;
  let byBlankSummary = 0;
  let fallbackTitled = 0;
  const examples = [];
  for (const m of modules) {
    const summary = summaries.get(`p:${m.id}`);
    const labelHit = isFallbackModuleLabel(m.label);
    const summaryHit = isGenericGroupSummary(summary);
    const blankLabelHit = isBlankLabel(m.label);
    const blankSummaryHit = isBlankSummary(summary);
    if (labelHit) byLabel += 1;
    if (summaryHit) bySummary += 1;
    if (blankLabelHit) byBlankLabel += 1;
    if (blankSummaryHit) byBlankSummary += 1;
    if (!(labelHit || summaryHit || blankLabelHit || blankSummaryHit)) continue;
    fallbackTitled += 1;
    if (examples.length < 5) {
      examples.push({
        id: m.id,
        label: m.label,
        summary: summary ?? null,
        blank: blankLabelHit || blankSummaryHit,
      });
    }
  }
  return {
    modules: modules.length,
    fallbackTitled,
    byLabel,
    bySummary,
    byBlankLabel,
    byBlankSummary,
    fallbackTitlePct: modules.length === 0 ? null : round1((fallbackTitled / modules.length) * 100),
    examples,
  };
}

/**
 * Sibling modules that read the same.
 *
 * "A row that just repeats its own name" is settled owner canon (HANDOFF §6),
 * and `uniqueModuleLabels` (cluster.ts) exists to prevent it. This counts the
 * cases that got through: within one parent, N modules sharing a label
 * contribute N-1 duplicates, so a clean repo scores 0.
 *
 * U30 — `dupTitleCount` NOW COMPARES WHAT THE USER SEES. It used to key on the
 * raw label, so `'Core'` and `'core '` were two titles to the metric and one
 * indistinguishable pair of rows to the reader. The headline number is the
 * normalised one; `dupTitleCountExact` keeps the old byte-identical count
 * alongside it, so a rise caused purely by the wider rule is visible rather
 * than mysterious. Normalised >= exact, always.
 *
 * @param {{nodes?: unknown[]}} graph
 */
export function duplicateTitleStats(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const modules = nodes.filter((n) => n && typeof n === 'object' && n.kind === 'module');
  /** @type {Map<string, {parentId: string, label: string, count: number, variants: Set<string>}>} */
  const groups = new Map();
  /** @type {Map<string, number>} */
  const exactGroups = new Map();
  for (const m of modules) {
    const parentId = typeof m.parentId === 'string' ? m.parentId : '(root)';
    const label = String(m.label);
    const key = `${parentId}\u0000${normalizeTitle(m.label)}`;
    const exactKey = `${parentId}\u0000${label}`;
    const cur = groups.get(key);
    if (cur) {
      cur.count += 1;
      cur.variants.add(label);
    } else {
      groups.set(key, { parentId, label, count: 1, variants: new Set([label]) });
    }
    exactGroups.set(exactKey, (exactGroups.get(exactKey) ?? 0) + 1);
  }
  let dupTitleCount = 0;
  const worst = [];
  for (const g of groups.values()) {
    if (g.count < 2) continue;
    dupTitleCount += g.count - 1;
    worst.push({
      parentId: g.parentId,
      label: g.label,
      count: g.count,
      // Recorded only when the collision is NOT byte-identical — exactly the
      // case the old exact-key metric could not see.
      ...(g.variants.size > 1 ? { variants: [...g.variants].sort() } : {}),
    });
  }
  let dupTitleCountExact = 0;
  for (const count of exactGroups.values()) if (count > 1) dupTitleCountExact += count - 1;
  worst.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { dupTitleCount, dupTitleCountExact, worst: worst.slice(0, 5) };
}

/**
 * The marker `packages/analyzer/src/llm/tokenBudget.ts` appends whenever a
 * prompt-assembly point had to cut. Verbatim, for the same reason the fallback
 * labels above are verbatim: this metric exists to notice when a REAL repo hits
 * a budget, and a silent rename would zero it.
 */
export const BUDGET_OMISSION_MARKER = /…\d+ more [^\n]* omitted to fit the model budget/;

/**
 * Assembled-prompt size for one repo. PURE: strings in, numbers out.
 *
 * `approxPromptTokens` is the analyzer's own chars/4 approximation, restated
 * here rather than imported so this file stays dependency-free — it is an
 * APPROXIMATION, not a tokenizer count (see `llm/tokenBudget.ts`).
 *
 * `budgetCut` is the signal the loop actually wants: true when this repo was
 * large enough that a per-site budget had to drop content. Every repo we scan
 * today should be false; a true is the 1140-file case showing up.
 *
 * @param {string} digestJson `JSON.stringify(buildDigest(graph))`
 * @param {string} askPrompt `buildAskPrompt(digest, …)`
 */
export function promptSizeStats(digestJson, askPrompt) {
  const digestChars = typeof digestJson === 'string' ? digestJson.length : 0;
  const promptChars = typeof askPrompt === 'string' ? askPrompt.length : 0;
  return {
    digestChars,
    promptChars,
    approxPromptTokens: Math.ceil(promptChars / 4),
    budgetCut: typeof askPrompt === 'string' && BUDGET_OMISSION_MARKER.test(askPrompt),
  };
}

/**
 * Node counts, by the schema's own kinds. No inference — a straight tally.
 *
 * U30 VERDICT — the kind tallies are HONEST: they claim to be a count and they
 * are a count, and no reading of them ever asserted quality. But `modules: 8`
 * on its own genuinely cannot tell 8 useful modules from 8 empty ones, so the
 * two counts below answer that part directly instead of leaving it to
 * inference. A module or a service the user can open and find NOTHING inside is
 * a real defect (it renders as a card that expands into nothing) and it was
 * previously indistinguishable from a full one.
 *
 * `emptyModules` / `emptyServices`: container nodes that no other node in the
 * graph names as its parent. Containment is the schema's own `parentId`, so
 * this is a fact off the graph, not a guess.
 *
 * @param {{nodes?: unknown[], edges?: unknown[]}} graph
 */
export function countNodes(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const by = (kind) => nodes.filter((n) => n && n.kind === kind).length;
  const hasChildren = new Set();
  for (const n of nodes) {
    if (n && typeof n === 'object' && typeof n.parentId === 'string') hasChildren.add(n.parentId);
  }
  const emptyOf = (kind) =>
    nodes.filter((n) => n && n.kind === kind && !hasChildren.has(n.id)).length;
  return {
    services: by('service'),
    datastores: by('datastore'),
    topics: by('topic'),
    modules: by('module'),
    files: by('file'),
    edges: edges.length,
    emptyModules: emptyOf('module'),
    emptyServices: emptyOf('service'),
  };
}

/**
 * U30 — THE METRIC THIS ROUND EXISTS FOR: does "Show main flow" PLAY?
 *
 * `stemFound` was `candidates.length > 0`. A candidate with zero outgoing call
 * edges satisfies that perfectly, so the loop reported `stemFound: true` on
 * flask, express, gin and n8n for an unknown number of rounds while the button
 * dead-ended on all four. It measured that a stem was NAMED.
 *
 * `stemPlays` asks the user's question instead, and it does not re-derive the
 * answer: it is handed the result of `mainFlowState(graph, functionGraph)` —
 * the SAME function `canvas/GroupedCanvas.tsx` calls to decide whether the
 * control acts on a click (`packages/web/src/graph/stemFlow.ts`). If the canvas
 * would dead-end, this is false. There is no second implementation to drift.
 *
 * `stemHops` is recorded because a 1-edge flow and a 34-edge flow are both
 * "plays" and are not the same quality of answer. It is the count of DISTINCT
 * grounded function-graph edges the played path uses (`path.edgeIds`), which is
 * what the animation actually traverses.
 *
 * U34 — stem *quality*. `stemPlays` is true on flask (1 hop) and sqlfluff
 * (starts from a test file) even though neither is the flow a human would call
 * the main one. `stemQualityOk` is the narrow outcome question: does a flow
 * play, with at least {@link MIN_STEM_QUALITY_HOPS} hops, from a non-test file?
 * It is deliberately conservative — a thin or test-sourced play is recorded
 * honestly via `stemThin` / `stemFromTestFile` rather than hidden.
 *
 * `stemFound` is kept, unchanged and byte-identical in meaning, so the baseline
 * stays comparable and the two numbers can be read side by side — the gap
 * between them IS the finding.
 *
 * A false `stemPlays` is not automatically a bug: sqlfluff's calls land in
 * frameworks this scan does not read, so `false` there is the honest answer and
 * must not be papered over. It is a REGRESSION only when it was true before.
 *
 * @param {{ready?: boolean, stem?: object, path?: object, message?: string} | null} state mainFlowState(...)
 * @param {number} candidateCount detectStemCandidates(...).length — the OLD metric's input
 */

/** U34 — flows shorter than this are "thin" (flask plays 1 hop). */
export const MIN_STEM_QUALITY_HOPS = 2;

/**
 * Path-only test-file signal (U34). Catches the shapes the corpus mis-ranks:
 * `test/…`, `*_test.py`, `*Test.java`, `*.spec.*`, `*.test.*`, `*_test.go`.
 *
 * @param {unknown} file repo-relative path from `stem.file`
 */
export function isTestFilePath(file) {
  if (typeof file !== 'string' || file.trim() === '') return false;
  const norm = file.replace(/\\/g, '/');
  if (/(^|\/)(test|tests|__tests__)(\/|$)/i.test(norm)) return true;
  const base = norm.split('/').pop() ?? norm;
  return (
    /_test\.(py|go)$/.test(base) ||
    /Tests\.java$/.test(base) ||
    /\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base)
  );
}

export function stemFlowStats(state, candidateCount) {
  const s = state && typeof state === 'object' ? state : null;
  const stem = s && typeof s.stem === 'object' && s.stem !== null ? s.stem : null;
  const path = s && typeof s.path === 'object' && s.path !== null ? s.path : null;
  const edgeIds = Array.isArray(path?.edgeIds) ? path.edgeIds : [];
  const functionIds = Array.isArray(path?.functionIds) ? path.functionIds : [];
  const stemFile = typeof stem?.file === 'string' ? stem.file : null;
  const stemPlays = s?.ready === true && edgeIds.length > 0;
  const stemHops = edgeIds.length;
  const stemFromTestFile = stemFile ? isTestFilePath(stemFile) : false;
  const stemThin = stemPlays && stemHops < MIN_STEM_QUALITY_HOPS;
  return {
    candidates: Number.isFinite(candidateCount) ? candidateCount : stem ? 1 : 0,
    stemFound: Boolean(stem),
    stemPlays,
    stemFile,
    stemReason: typeof stem?.reason === 'string' ? stem.reason : null,
    stemHops,
    stemFunctions: functionIds.length,
    stemFromTestFile,
    stemThin,
    stemQualityOk: stemPlays && !stemFromTestFile && stemHops >= MIN_STEM_QUALITY_HOPS,
    /** The exact sentence the user would read, ready or not. Never invented. */
    message: typeof s?.message === 'string' ? s.message : null,
  };
}
