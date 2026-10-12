import { DEPTH_MEASURED } from '@/components/DepthCharts';

/**
 * THE ADVANTAGES, MEASURED. Every number on the five breakdown chapters comes
 * from here, and every entry names the file in the repository it was read
 * from. Nothing is rounded up, and nothing is here that was not measured or
 * shipped. tools/ci/site-advantages.test.mjs reads report/data.json and the
 * shopfront ground truth and fails if a number here drifts from its source.
 *
 * Read against what: each figure says what the other arm was (grep, an agent
 * reading files, the same agent without the map, the picker before).
 */

/* ── DEPTH: Sequence's own repository, importers of scan.ts ─────────────── */
const depth4 = DEPTH_MEASURED.rows[DEPTH_MEASURED.rows.length - 1]!;
export const DEPTH4 = {
  files: depth4.files,
  grepLookups: depth4.grep,
  sequenceCalls: depth4.sequence,
  readTokens: Math.round(depth4.bytesRead / 4),
  answerTokens: Math.round(depth4.bytesAnswer / 4),
  ratio: Math.round(depth4.bytesRead / depth4.bytesAnswer),
  source: 'tools/measure/importers-by-depth.py, site/src/components/DepthCharts.tsx',
} as const;

/* ── SYSTEM DESIGN: the map against hand-labelled truth ─────────────────── */
export const GRADE = {
  edgesFound: 15,
  edgesTruth: 15,
  precision: 100,
  recall: 100,
  fixtures: 11,
  fixtureCoverage: 100,
  source: 'report/data.json (locate), packages/analyzer/dist/eval/grade.js, 2026-09-30',
  truthSource: 'packages/analyzer/test/fixtures/shopfront/ground-truth.json',
} as const;

/** One real edge on the sample shop, opened: the lines the scanner cites, verbatim from the fixture. */
export const EDGE_EVIDENCE = {
  from: 'Gateway',
  to: 'Orders',
  label: 'GET /orders/* +1 more',
  rows: [
    {
      call: { file: 'gateway/src/routes/orders.ts', line: 9, code: 'const order = await getJson(`${ORDERS_URL}/orders/${req.params.id}`);' },
      handler: { file: 'orders/app/routes.py', line: 11, code: '@router.get("/orders/{order_id}")' },
    },
    {
      call: { file: 'gateway/src/routes/orders.ts', line: 14, code: 'const created = await postJson(`${ORDERS_URL}/orders`, req.body);' },
      handler: { file: 'orders/app/routes.py', line: 19, code: '@router.post("/orders")' },
    },
  ],
  source: 'packages/analyzer/test/fixtures/shopfront',
} as const;

/** Orders' impact on the sample shop, as the map's impact read returns it (the same set the layers chapter draws). */
export const ORDERS_IMPACT = {
  breaks: [
    { name: 'Gateway', via: 'GET /orders/*' },
    { name: 'Notifications', via: 'consume order.created' },
    { name: 'Shipping', via: 'consume order.created' },
  ],
  needs: [
    { name: 'Payments', via: 'POST /charge' },
    { name: 'Inventory', via: 'grpc' },
    { name: 'Postgres', via: 'db' },
    { name: 'Order Created', via: 'publish' },
  ],
} as const;

/* ── TOKENS ─────────────────────────────────────────────────────────────── */
/** One question over Sequence's own checkout: the walk stops at 10,000 files and 428 match the question's words. */
export const BIG_REPO = {
  filesSearched: 10000,
  matchingFiles: 428,
  rows: [
    { id: 'all', label: 'Read all 428 matching files', tokens: 4925988 },
    { id: 'grep', label: 'grep, then read 6 files', tokens: 18465 },
    { id: 'seq', label: 'Sequence, first question', tokens: 1887 },
    { id: 'follow', label: 'Sequence, follow-up', tokens: 929 },
  ],
  source: 'report/data.json (bigRepo), tools/bench/agent-context-bench.mjs, 2026-09-30',
} as const;

/** The same shopfront question at four window sizes: what a window-filling reader sends, and what Sequence sends. */
export const WINDOW = {
  buckets: [50000, 100000, 150000, 200000],
  sequenceTokens: 3535,
  source: 'report/raw/agent-context-bench-buckets-2026-09-30.json',
} as const;

/** find_files: the shipped defaults. */
export const FIND_FILES = {
  k: 5,
  budgetTokens: 800,
  source: 'packages/analyzer/src/explain/findFiles.ts (FIND_FILES_DEFAULT_K, FIND_FILES_DEFAULT_BUDGET)',
} as const;

/* ── SPEED ──────────────────────────────────────────────────────────────── */
/** The sealed release bank: 36 conversations x 2 turns, a local model on an 8 GB GPU. Mean seconds per answer after each kept change. */
export const RELEASE_BANK = {
  points: [
    { label: 'Sealing baseline', seconds: 14.0, full: 39 },
    { label: '“This” means the repository', seconds: 10.1, full: 83 },
    { label: 'A bare “it” too', seconds: 9.8, full: 86 },
    { label: 'Same code, pinned rerun', seconds: 9.2, full: 89 },
    { label: 'No resend for shape', seconds: 7.8, full: 90 },
  ],
  callsBefore: 1.72,
  callsAfter: 1.25,
  source: 'report/data.json (releaseBank), lab/log.md 2026-09-26',
} as const;

/** Building the map of Sequence's own repository (2,558 files): cold, then from the cache. */
export const SCAN = {
  files: 2558,
  coldMs: 6475,
  cachedMs: 552,
  source: 'report/data.json (scan), 2026-09-30, Windows 11',
} as const;

/* ── ACCURACY ───────────────────────────────────────────────────────────── */
/** The same bash agent on qwen3.5:4b, with and without Sequence; 36 sealed questions (sha256 cdbd6fa7), two runs each arm. */
export const AGENT_AB = {
  model: 'qwen3.5:4b',
  n: 36,
  plainF1: [0.082, 0.091],
  sequenceF1: [0.238, 0.191],
  delta: 0.128,
  se: 0.051,
  byType: [
    { label: 'Who calls it', plain: 0.08, sequence: 0.18 },
    { label: 'What breaks if it changes', plain: 0.02, sequence: 0.19 },
    { label: 'How a request gets there', plain: 0.15, sequence: 0.28 },
  ],
  tokensPlain: [1158, 2328],
  tokensSequence: [6789, 9152],
  source: 'report/data.json (agentAB), report/raw/agent-ab-*.jsonl',
} as const;

/** Replication on a second model family: the map in the prompt against the tool alone, three runs each. */
export const GRANITE = {
  model: 'granite4.2:3b',
  toolF1: 0.158,
  mapF1: 0.398,
  delta: 0.24,
  seRatio: 4.26,
  source: 'lab/log.md 2026-10-06, report/raw/agent-ab-bash-granite-*.jsonl',
} as const;

/* ── OUR MODELS ─────────────────────────────────────────────────────────── */
/** The trained file ranker behind find_files. hit@5 = a file the real fix edited is in the top five. */
export const RANKER = {
  trees: 150,
  features: 39,
  candidates: 125,
  sealedRepos: 8,
  hitAt5: [
    { label: 'grep', value: 51.0 },
    { label: 'The picker before it', value: 75.5 },
    { label: 'Trained ranker', value: 84.9 },
  ],
  arms: ['File contents and churn', 'grep over every file', 'Path words', 'Recently changed', 'Similar past commits', 'Past commit subjects'],
  source: 'packages/analyzer/src/explain/askLtr.ts, findFiles.ts',
  learnSource: 'packages/analyzer/src/explain/findFilesLearn.ts',
} as const;

/**
 * The drawing model: the whiteboard's stroke recognizer (packages/ink), boosted
 * trees trained on the DiDi diagram dataset, scored once on a fresh sealed
 * slice with the shipped model (grouped strokes).
 */
export const SHAPE = {
  accuracy: 93.9,
  wrongSnap: 1.62,
  drawings: 530,
  strokes: 13175,
  source: 'tools/bench/ink-fresh-sealed.txt, packages/ink/src/shapeModel.ts',
} as const;

export const LOCAL_MODELS = {
  families: ['qwen3.5:4b', 'granite4.2:3b'],
  gpu: '8 GB RTX 2060 Super',
  source: 'lab/log.md 2026-10-01, 2026-10-06',
} as const;

/* ── FORMAT ─────────────────────────────────────────────────────────────── */
export const fmt = (n: number) => n.toLocaleString('en-US');
export const kTok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : fmt(n));
export const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
