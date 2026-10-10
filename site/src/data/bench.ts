/**
 * THE BENCHMARKS PAGE, MEASURED. Every number the page shows is in `N` below,
 * and every key in `N` is checked against the file it was read from by
 * tools/ci/site-bench.test.mjs (report/data.json, lab/log.md, the depth
 * measurement, the ranker's source, the release bank). Multiples and
 * percentages on the page are computed from these at render, never typed.
 *
 * Keys starting `rr` are the re-check of 2026-10-10: cheap, local, model-free
 * scripts re-run on a clean checkout. Their verbatim output is in RECHECK
 * below, and the gate reads the numbers back out of those lines.
 *
 * Format rule (the gate parses this block as text): one `key: value,` per
 * line, value a number or a flat array of numbers.
 */
export const N = {
  /* ── CONTEXT AND TOKENS ─────────────────────────────────────────────── */
  readAllTokens: 4925988,
  grepSixTokens: 18465,
  firstTokens: 1887,
  followTokens: 929,
  filesSearched: 10000,
  matchingFiles: 428,
  windowBuckets: [50000, 100000, 150000, 200000],
  windowSeqTokens: 3535,
  mapNodes: 1329,
  mapEdges: 3499,
  wholeMapTokens: 23442,
  scopedPromptTokens: 2818,
  mapWindow: 200000,
  depthFiles: 224,
  depthLookups: 195,
  depthReadBytes: 3657040,
  depthAnswerBytes: 11186,

  /* ── FINDING FILES ──────────────────────────────────────────────────── */
  hitGrep: 51.0,
  hitBefore: 75.5,
  hitRanker: 84.9,
  sealedRepos: 8,
  rankerCandidates: 125,
  findK: 5,
  findBudget: 800,
  fixCommits: [194, 150],
  fixGrep: [64, 22],
  fixFirstPicker: [3, 9],

  /* ── ACCURACY OF ANSWERS ────────────────────────────────────────────── */
  abN: 36,
  abPlainF1: [0.082, 0.091],
  abSeqF1: [0.238, 0.191],
  abDelta: 0.128,
  abSE: 0.051,
  typeWhoCalls: [0.08, 0.18],
  typeBreaks: [0.02, 0.19],
  typePath: [0.15, 0.28],
  abPlainTokens: [1158, 2328],
  abSeqTokens: [6789, 9152],
  abShopF1: [0.09, 0.07],
  abMlF1: [0.08, 0.37],
  abSiteF1: [0.1, 0.2],
  qwenToolRuns: [0.276, 0.295, 0.29],
  qwenMapRuns: [0.367, 0.466, 0.471],
  qwenMapDelta: 0.148,
  qwenMapSeRatio: 2.58,
  graniteToolRuns: [0.197, 0.107, 0.17],
  graniteMapRuns: [0.364, 0.457, 0.374],
  graniteToolF1: 0.158,
  graniteMapF1: 0.398,
  graniteDelta: 0.24,
  graniteSeRatio: 4.26,
  bankFull: [39, 83, 86, 89, 90],

  /* ── SPEED ──────────────────────────────────────────────────────────── */
  bankSeconds: [14, 10.1, 9.8, 9.2, 7.8],
  bankTurns: 72,
  callsBefore: 1.72,
  callsAfter: 1.25,
  scanFiles: [42, 183, 2558, 3890],
  scanColdMs: [561, 875, 6475, 7672],
  ownCachedMs: 552,
  mlCacheHits: [1, 5],
  firstBoardMs: [269, 393],
  firstBoardLo: [260, 371],
  firstBoardHi: [285, 407],

  /* ── MAPPING ────────────────────────────────────────────────────────── */
  edgesFound: 15,
  edgesTruth: 15,
  edgePrecision: 100,
  edgeRecall: 100,
  fixtures: 11,
  fixtureCoverage: 100,
  gridQuestions: [130, 215, 70],
  gridMapCorrect: [81, 131, 33],
  gridCorrect: [100, 145, 51],
  hotQuestions: [34, 34, 22],
  hotCorrect: [34, 34, 22],
  hotMapCorrect: [15, 20, 16],
  chartWins: 40,
  chartLosses: 0,
  chartTies: 15,

  /* ── RE-CHECKED 2026-10-10 (verbatim output in RECHECK) ─────────────── */
  rrReadAllTokens: 2111750,
  rrGrepSixTokens: 14979,
  rrFirstTokens: 1925,
  rrFollowTokens: 967,
  rrFilesListed: 3175,
  rrMatchingFiles: 160,
  rrWindowSeqTokens: 3573,
  rrDepthFiles: 333,
  rrDepthLookups: 295,
  rrDepthReadBytes: 5310896,
  rrDepthAnswerBytes: 16541,
  rrShopColdMs: 564,
  rrShopCachedMs: 447,
  rrOwnPlainMs: [16868, 19339, 20868],
  rrGradeOk: 11,
} as const;

/**
 * THE RE-CHECK. Commands run on 2026-10-10 in a clean checkout of a8569e0c
 * (Windows 11, Node 24.13, analyzer built with `pnpm --filter
 * "@sequence/analyzer..." build`), no model calls, $0. Lines are the scripts'
 * output, copied verbatim; the gate reads the `rr` numbers out of them.
 */
export const RECHECK = {
  date: '2026-10-10',
  runs: [
    {
      cmd: 'node tools/bench/agent-context-bench.mjs --json (fields printed flat)',
      lines: [
        'hermes.sequence.prompt_tokens 1925',
        'hermes.followup.prompt_tokens 967',
        'hermes.dump_search.filesListed 3175',
        'hermes.dump_search.hits 160',
        'hermes.dump_search.tokens_tool 14979',
        'hermes.dump_search.uncapped_hit_tokens 2111750',
      ],
    },
    {
      cmd: 'node tools/bench/agent-context-bench.mjs --buckets',
      lines: [
        'Sequence shopfront prompt (flat): 3573 tok',
      ],
    },
    {
      cmd: 'python tools/measure/importers-by-depth.py packages/analyzer/src/scan.ts',
      lines: [
        '    4   39         333                    295             5310896                16541',
      ],
    },
    {
      cmd: 'node scan-times.mjs packages/analyzer/dist/cli.js <shopfront> . (cold = median of 3 --no-cache, cached = third plain run)',
      lines: [
        '{"repo":"packages/analyzer/test/fixtures/shopfront","coldRuns":[564,563,574],"coldMedian":564,"plainRuns":[626,549,447],"cached":447}',
        '{"repo":".","coldRuns":[15587,17015,17293],"coldMedian":17015,"plainRuns":[16868,19339,20868],"cached":20868}',
      ],
    },
    {
      cmd: 'node packages/analyzer/dist/eval/grade.js',
      lines: [
        '  shopfront            type=microservices  OK  cov=100.0% nodes= 38 edgeP/R=100.0%/100.0%',
        '  ticketing-scaffold   type=microservices  OK  cov=100.0% nodes= 12',
        '  spa-dashboard        type=spa            OK  cov=100.0% nodes=  7',
        '  mobile-rn            type=mobile         OK  cov=100.0% nodes=  6',
        '  mobile-flutter       type=mobile         OK  cov=100.0% nodes=  3',
        '  cli-tool             type=cli            OK  cov=100.0% nodes=  5',
        '  plainapp             type=microservices  OK  cov=100.0% nodes=  9',
        '  shared-backend       type=microservices  OK  cov=100.0% nodes= 11',
        '  dockerfile-env-mini  type=microservices  OK  cov=100.0% nodes=  7',
        '  k8s-mini/helm        type=server-web     OK  cov=100.0% nodes=  5',
        '  k8s-mini/plain       type=server-web     OK  cov=100.0% nodes=  5',
      ],
    },
  ],
} as const;

/** Where each group's numbers come from. Shown only inside the Method details. */
export const SOURCES = {
  context: [
    'report/data.json: bigRepo, window (tools/bench/agent-context-bench.mjs, 2026-09-30)',
    'report/raw/agent-context-bench-2026-09-30.json, report/raw/agent-context-bench-buckets-2026-09-30.json',
    'site/src/components/DepthCharts.tsx: DEPTH_MEASURED (tools/measure/importers-by-depth.py, 2026-09-18)',
  ],
  files: [
    'packages/analyzer/src/explain/askLtr.ts and findFiles.ts (the frozen ranker study: hit@5 on 8 sealed repos)',
    'packages/analyzer/src/explain/findFiles.ts: FIND_FILES_DEFAULT_K, FIND_FILES_DEFAULT_BUDGET',
    'report/data.json: findTheFix (tools/bench/find-the-fix.mjs, 2026-10-01), lab/log.md 2026-10-01',
  ],
  accuracy: [
    'report/data.json: agentAB, report/raw/agent-ab-full-bash-*-2026-10-01.jsonl',
    'lab/log.md 2026-10-05 (map in the prompt, 4B model) and 2026-10-06 (3B model, registered 5914eb37)',
    'report/raw/agent-ab-bash-*-2026-10-05.jsonl',
    'report/data.json: releaseBank (lab/log.md, release bank v1)',
  ],
  speed: [
    'report/data.json: releaseBank, scan; report/raw/scan-times-2026-09-30.txt',
    'lab/log.md 2026-09-26 (model calls per turn), 2026-10-05 Phase 0 (page to first board node)',
    'site/src/components/DepthCharts.tsx: DEPTH_MEASURED depth 4',
  ],
  mapping: [
    'report/data.json: locate; report/raw/grade-2026-09-30.txt (packages/analyzer/dist/eval/grade.js)',
    'packages/analyzer/test/fixtures/shopfront/ground-truth.json',
    'lab/log.md 2026-10-05: board views A/B (tools/measure/board-views-ab.mjs), Diff and Hotspots A/B',
    'report/data.json: charts (lab/log.md 2026-09-26)',
  ],
} as const;

/** The exact models and sets, named only inside the Method details. */
export const MODELS = {
  small: 'qwen3.5:4b on Ollama, local, $0',
  other: 'granite4.2:3b on Ollama (another model family), local, $0',
  gpu: 'one 8 GB RTX 2060 Super, Windows 11',
  set: 'arch-questions-v1, sha256 cdbd6fa7, labelled from source by a separate worker before either arm ran',
  projects: 'shopfront (sample shop), codeforge (our own codebase), ml-harness (ML research project), premai (marketing site)',
} as const;

/* ── PLAIN NAMES FOR THE PROJECTS WE MEASURED ON (by size, never by repo name) ── */
export const PROJECTS = {
  shop: 'Sample shop',
  site: 'Marketing site',
  own: 'Our own codebase',
  ml: 'ML research project',
} as const;

/** The five changes the release bank kept, in order, in plain words. */
export const BANK_STEPS = [
  'Starting point',
  'Read “this” as the repository',
  'Read a bare “it” the same way',
  'Same code, pinned re-run',
  'Stop resending finished answers',
] as const;

/* ── FORMAT AND ARITHMETIC (everything on the page goes through these) ── */
export const fmt = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** A multiple: one decimal under 10, whole above. */
export const times = (a: number, b: number) => {
  const r = a / b;
  return `${r < 10 ? fmt(r, 1) : fmt(Math.round(r))}×`;
};
export const pct = (x: number, digits = 1) => `${fmt(x * 100, digits)}%`;
export const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
export const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
/** Compact token counts: 4.9M, 18k, 1,887. */
export const tok = (n: number) =>
  n >= 1_000_000 ? `${fmt(n / 1_000_000, 1)}M` : n >= 10_000 ? `${fmt(Math.round(n / 1000))}k` : fmt(n);
export const secs = (ms: number) => `${fmt(ms / 1000, ms < 1000 ? 2 : 1)} s`;
export const bytesToTokens = (b: number) => Math.round(b / 4);
