#!/usr/bin/env node
/**
 * Sequence vs dump/search token bench — research harness (not wired into pnpm test).
 *
 * Measures tokens *pulled to answer* (digest / file research / grep+read), not
 * model cleverness. Uses analyzer dist + chars/4 approxTokens. No provider calls.
 *
 * Usage (from repo root, after analyzer build):
 *   node tools/bench/agent-context-bench.mjs
 *   node tools/bench/agent-context-bench.mjs --json
 *   node tools/bench/agent-context-bench.mjs --buckets
 *   node tools/bench/agent-context-bench.mjs --buckets 50000,100000,150000,200000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../../packages/analyzer/dist/scan.js';
import {
  buildDigest,
  buildAskPrompt,
  buildDesignAskPrompt,
  scopeDigestToAsk,
} from '../../packages/analyzer/dist/explain/explain.js';
import {
  wantsAskFileResearch,
  gatherAskFileResearch,
  renderAskFileResearchSection,
} from '../../packages/analyzer/dist/explain/askFileResearch.js';
import { renderAskContextSection } from '../../packages/analyzer/dist/explain/askIntents.js';
import { approxTokens } from '../../packages/analyzer/dist/llm/tokenBudget.js';
import { resolveInRepo } from '../../packages/analyzer/dist/server/jail.js';
import {
  executeAskTool,
  ASK_TOOL_READ_CAP_BYTES,
  ASK_TOOL_SEARCH_MAX_RESULTS,
  ASK_TOOL_SEARCH_TOTAL_CAP_BYTES,
} from '../../packages/analyzer/dist/server/askTools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');
const SHOPFRONT = path.join(REPO_ROOT, 'packages/analyzer/test/fixtures/shopfront');
const WINDOW_200K = 200_000;
const DIGEST_BUDGET = 48_000;

const SHOPFRONT_ASK = 'Explain how orders reaches payments and postgres.';
const HERMES_ASK = 'Break down a Hermes agent — workflow, how do I make my own?';
const FOLLOWUP_ASK = 'Rename Prompt Optimizer to Crafting Engine';
const RECS_ASK =
  'Add a recommendations service: it reads order history from postgres, is called from orders after insert_order, and gateway exposes GET /recommendations. Do not invent a redis edge from gateway.';

const DEFAULT_BUCKETS = [50_000, 100_000, 150_000, 200_000];

const NEEDLE_RELS = [
  'packages/analyzer/test/fixtures/shopfront/orders/app/routes.py',
  'packages/analyzer/test/fixtures/shopfront/orders/app/payments_client.py',
  'packages/analyzer/test/fixtures/shopfront/orders/app/db.py',
  'packages/analyzer/test/fixtures/shopfront/ground-truth.json',
];

/** Same agent scaffold the product sends on empty-board Hermes breakdown. */
const AGENT_SCAFFOLD = [
  'Proposed architecture roles for an agent / local-AI system (adapt names to the ask):',
  '- Interface (CLI/API / entry)',
  '- Model / reasoning engine',
  '- Memory / store',
  '- Tool execution / local impl',
  'Draw the operational loop as labeled control edges on the board (request → model, query memory, invoke tool, return result, answer) — not only in prose.',
].join('\n');

const HERMES_BOARD_LABELS = [
  'Interface (CLI/API)',
  'Model (Local LLM)',
  'Vector Memory Store',
  'Tool Executor (Local)',
  'Prompt Optimizer',
];

const SKIP_DIRS = new Set([
  '.git',
  '.sequence',
  'node_modules',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.gradle',
  '.idea',
  '.vscode',
  'target',
  'tmp-shots',
  'coverage',
]);

const SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.java',
  '.yml',
  '.yaml',
  '.json',
  '.md',
  '.properties',
]);

function toolCtx(repoRoot) {
  const root = fs.realpathSync(repoRoot);
  return {
    repoRoot: root,
    designMode: false,
    resolveReadable: (rel) => resolveInRepo(root, rel),
  };
}

/** Client compiler constants from packages/web/src/ai/contextCompiler.ts — copied, not imported. */
function compileAskContext(graph, selectedIds = []) {
  const DEFAULT_MAX_NODES = 24;
  const DEFAULT_MAX_CHARS = 4_000;
  const MAX_EVIDENCE_LINES = 8;
  if (!graph || graph.nodes.length === 0) {
    return { nodeIds: [], lines: [], charCount: 0 };
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seed = selectedIds.filter((id) => byId.has(id));
  const include = new Set(seed);
  if (seed.length === 0) {
    for (const n of graph.nodes) {
      if (n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic') {
        include.add(n.id);
        if (include.size >= DEFAULT_MAX_NODES) break;
      }
    }
  } else {
    for (const e of graph.edges) {
      if (seed.includes(e.srcId)) include.add(e.dstId);
      if (seed.includes(e.dstId)) include.add(e.srcId);
      if (include.size >= DEFAULT_MAX_NODES) break;
    }
  }
  const ordered = [...include]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, DEFAULT_MAX_NODES);
  const header =
    seed.length > 0
      ? `Grounded scope (${ordered.length} nodes, selection + neighbors):`
      : `Grounded scope (${ordered.length} top-level nodes):`;
  const lines = [
    header,
    ...ordered.map((n) => {
      const bits = [`${n.kind}:${n.label}`];
      if (n.path) bits.push(`@ ${n.path}`);
      return `- ${bits.join(' ')}`;
    }),
  ];
  const included = new Set(ordered.map((n) => n.id));
  let evidenceCount = 0;
  const evidenceBody = [];
  for (const e of graph.edges) {
    if (!included.has(e.srcId) && !included.has(e.dstId)) continue;
    for (const ev of e.evidence ?? []) {
      if (evidenceCount >= MAX_EVIDENCE_LINES) break;
      const snip = String(ev.snippet ?? '').trim().slice(0, 60);
      evidenceBody.push(snip ? `  · ${ev.file}:${ev.line} — ${snip}` : `  · ${ev.file}:${ev.line}`);
      evidenceCount++;
    }
    if (evidenceCount >= MAX_EVIDENCE_LINES) break;
  }
  if (evidenceBody.length) lines.push('Evidence:', ...evidenceBody);
  let charCount = lines.join('\n').length;
  while (lines.length > 1 && charCount > DEFAULT_MAX_CHARS) {
    lines.pop();
    charCount = lines.join('\n').length;
  }
  return { nodeIds: ordered.map((n) => n.id), lines, charCount };
}

function walkSourceFiles(root, { maxFiles = 10_000 } = {}) {
  const out = [];
  const walk = (dir) => {
    if (out.length >= maxFiles) return;
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (out.length >= maxFiles) return;
      if (ent.name.startsWith('.') && ent.name !== '.sequence') {
        if (SKIP_DIRS.has(ent.name)) continue;
      }
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name));
        continue;
      }
      const ext = path.extname(ent.name);
      if (!SOURCE_EXT.has(ext)) continue;
      out.push(path.join(dir, ent.name));
    }
  };
  walk(root);
  return out;
}

function dumpSearchWalk(root, queries, { maxReads = 6, readCap = ASK_TOOL_READ_CAP_BYTES } = {}) {
  const files = walkSourceFiles(root);
  const listed = files.map((abs) => path.relative(root, abs));
  const hits = [];
  const qLower = queries.map((q) => q.toLowerCase());
  for (const abs of files) {
    let raw;
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (raw.includes('\0')) continue;
    const rel = path.relative(root, abs);
    const lower = raw.toLowerCase();
    const matched = qLower.filter((q) => lower.includes(q) || rel.toLowerCase().includes(q));
    if (matched.length === 0) continue;
    hits.push({ rel, bytes: raw.length, matched });
  }
  hits.sort((a, b) => b.matched.length - a.matched.length || a.rel.localeCompare(b.rel));
  const reads = hits.slice(0, maxReads).map((h) => {
    const abs = path.join(root, h.rel);
    const raw = fs.readFileSync(abs, 'utf8');
    const truncated = raw.length > readCap;
    const body = truncated ? raw.slice(0, readCap) : raw;
    return { path: h.rel, bytes: body.length, truncated, tokens: approxTokens(body) };
  });
  const searchSnippets = hits.slice(0, ASK_TOOL_SEARCH_MAX_RESULTS).map((h) => `${h.rel}: match`);
  let searchBytes = 0;
  const cappedSnippets = [];
  for (const s of searchSnippets) {
    if (searchBytes + s.length > ASK_TOOL_SEARCH_TOTAL_CAP_BYTES) break;
    cappedSnippets.push(s);
    searchBytes += s.length;
  }
  const tokensTool = approxTokens(cappedSnippets.join('\n')) + reads.reduce((n, r) => n + r.tokens, 0);
  const uncappedBytes = hits.reduce((n, h) => n + h.bytes, 0);
  return {
    filesListed: listed.length,
    hits: hits.length,
    hitPaths: hits.map((h) => h.rel),
    reads,
    tokens_tool: tokensTool,
    tokens_search_snippets: approxTokens(cappedSnippets.join('\n')),
    tokens_reads: reads.reduce((n, r) => n + r.tokens, 0),
    uncapped_hit_bytes: uncappedBytes,
    uncapped_hit_tokens: Math.ceil(uncappedBytes / 4),
  };
}

async function sequenceAskToolsDump(root, queries) {
  const ctx = toolCtx(root);
  const searches = [];
  const readPaths = new Set();
  for (const query of queries) {
    const result = await executeAskTool('search_files', { query }, ctx);
    const content = result.content ?? '';
    searches.push({
      query,
      ok: result.ok,
      evidence: result.evidence,
      tokens: approxTokens(content),
      bytes: content.length,
    });
    for (const line of content.split('\n')) {
      const m = line.match(/^([^\s:][^:]+\.[a-zA-Z0-9]+):\d+:/);
      if (m) readPaths.add(m[1]);
    }
  }
  const reads = [];
  for (const rel of [...readPaths].slice(0, 6)) {
    const result = await executeAskTool('read_file', { path: rel }, ctx);
    const content = result.content ?? '';
    reads.push({
      path: rel,
      ok: result.ok,
      tokens: approxTokens(content),
      bytes: content.length,
    });
  }
  const tokensTool = searches.reduce((n, s) => n + s.tokens, 0) + reads.reduce((n, r) => n + r.tokens, 0);
  return { searches, reads, tokens_tool: tokensTool };
}

function boardNeedles(digest) {
  const ids = [
    ...digest.services.map((s) => s.id),
    ...digest.datastores.map((d) => d.id),
    ...digest.topics.map((t) => t.id),
  ];
  const names = [
    ...digest.services.map((s) => s.name),
    ...digest.datastores.map((d) => d.name),
  ];
  const edgeKinds = digest.edges.map((e) => `${e.from}→${e.to}:${e.kind}`);
  return { ids, names, edgeKinds };
}

async function measureShopfront() {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);
  const digestJson = JSON.stringify(digest);
  const scoped = scopeDigestToAsk(digest, SHOPFRONT_ASK);
  const scopedJson = JSON.stringify(scoped.digest);
  const wantsResearch = wantsAskFileResearch(SHOPFRONT_ASK);
  const root = fs.realpathSync(SHOPFRONT);
  const resolveReadable = (rel) => resolveInRepo(root, rel);
  const research = gatherAskFileResearch({
    graph,
    digest,
    question: SHOPFRONT_ASK,
    resolveReadable,
  });
  const fileResearchLines = renderAskFileResearchSection(research);
  const compiled = compileAskContext(graph, ['svc:orders']);
  const scopeLines = renderAskContextSection(compiled.lines);
  const promptNoResearch = buildAskPrompt(digest, SHOPFRONT_ASK);
  const promptWithResearch = buildAskPrompt(digest, SHOPFRONT_ASK, {
    fileResearchLines,
    scopeLines,
  });
  const needles = boardNeedles(digest);
  const ordersPayments = digest.edges.some(
    (e) =>
      (e.from.includes('orders') && e.to.includes('payments')) ||
      (e.from.includes('payments') && e.to.includes('orders')),
  );
  const ordersPostgres = digest.edges.some(
    (e) =>
      (e.from.includes('orders') && (e.to.includes('postgres') || e.to.includes('db'))) ||
      (e.to.includes('orders') && (e.from.includes('postgres') || e.from.includes('db'))),
  );
  const dump = dumpSearchWalk(SHOPFRONT, [
    'orders',
    'payments',
    'postgres',
    'PAYMENTS_URL',
    'DATABASE_URL',
  ]);
  const toolDump = await sequenceAskToolsDump(SHOPFRONT, [
    'orders',
    'payments',
    'postgres',
    'PAYMENTS_URL',
    'DATABASE_URL',
  ]);
  const allSource = walkSourceFiles(SHOPFRONT);
  const allSourceBytes = allSource.reduce((n, f) => n + fs.statSync(f).size, 0);
  return {
    ask: SHOPFRONT_ASK,
    graph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      services: digest.services.map((s) => s.name),
      datastores: digest.datastores.map((d) => d.name),
    },
    sequence: {
      wantsAskFileResearch: wantsResearch,
      digest_chars: digestJson.length,
      digest_tokens: approxTokens(digestJson),
      scoped_digest_chars: scopedJson.length,
      scoped_digest_tokens: approxTokens(scopedJson),
      scoped: scoped.scoped,
      omitted_services: scoped.omittedServices,
      prompt_tokens: approxTokens(promptNoResearch),
      prompt_chars: promptNoResearch.length,
      prompt_with_research_tokens: approxTokens(promptWithResearch),
      file_research_files: research.files.map((f) => f.path),
      file_research_tokens: approxTokens(fileResearchLines.join('\n')),
      scope_tokens: approxTokens(scopeLines.join('\n')),
      scope_chars: compiled.charCount,
      board_needles: needles,
      board_intact: {
        has_orders: needles.names.includes('orders') || needles.ids.some((id) => id.includes('orders')),
        has_payments: needles.names.includes('payments') || needles.ids.some((id) => id.includes('payments')),
        has_postgres:
          needles.names.some((n) => /postgres|db/i.test(n)) ||
          needles.ids.some((id) => /postgres|db/i.test(id)),
        orders_payments_edge: ordersPayments,
        orders_postgres_edge: ordersPostgres,
      },
    },
    dump_search: dump,
    dump_via_sequence_tools: toolDump,
    fixture_all_source: {
      files: allSource.length,
      bytes: allSourceBytes,
      tokens: Math.ceil(allSourceBytes / 4),
    },
  };
}

function measureHermesDesign() {
  const outline = `- ${HERMES_ASK}\n${AGENT_SCAFFOLD}`;
  const prompt = buildDesignAskPrompt(
    { title: 'Design from chat', outline, proposeArchitecture: true },
    HERMES_ASK,
  );
  const followOutline = HERMES_BOARD_LABELS.map((l) => `- ${l}`).join('\n');
  const followPrompt = buildDesignAskPrompt(
    { title: 'Proposed Hermes Agent Local Design', outline: followOutline },
    FOLLOWUP_ASK,
  );
  const dump = dumpSearchWalk(
    REPO_ROOT,
    ['Hermes agent', 'Hermes', 'break down a Hermes'],
    { maxReads: 6, readCap: ASK_TOOL_READ_CAP_BYTES },
  );
  return {
    ask: HERMES_ASK,
    sequence: {
      outline_tokens: approxTokens(outline),
      prompt_tokens: approxTokens(prompt),
      prompt_chars: prompt.length,
      proposeArchitecture: true,
      digest: false,
    },
    followup: {
      ask: FOLLOWUP_ASK,
      outline_tokens: approxTokens(followOutline),
      prompt_tokens: approxTokens(followPrompt),
      prompt_chars: followPrompt.length,
      proposeArchitecture: false,
    },
    dump_search: dump,
  };
}

async function measureMonorepo() {
  const graph = await scanRepo(REPO_ROOT, {});
  const digest = buildDigest(graph);
  const digestJson = JSON.stringify(digest);
  const prompt = buildAskPrompt(digest, 'what is fragile?');
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    digest_chars: digestJson.length,
    digest_tokens: approxTokens(digestJson),
    prompt_tokens: approxTokens(prompt),
    prompt_chars: prompt.length,
    vs_digest_budget: { budget: DIGEST_BUDGET, under: approxTokens(digestJson) < DIGEST_BUDGET },
    vs_200k: {
      window: WINDOW_200K,
      digest_pct: +(approxTokens(digestJson) / WINDOW_200K).toFixed(4),
      prompt_pct: +(approxTokens(prompt) / WINDOW_200K).toFixed(4),
      enters_last_50k: approxTokens(prompt) >= 150_000,
    },
  };
}

function row(run, pathName, model, tokensIn, tokensTool, answerOk, boardIntact, usd) {
  return { run, path: pathName, model, tokens_in: tokensIn, tokens_tool: tokensTool, answer_ok: answerOk, board_intact: boardIntact, $: usd };
}

function parseBucketsArg(argv) {
  const idx = argv.indexOf('--buckets');
  if (idx === -1) return null;
  const next = argv[idx + 1];
  if (!next || next.startsWith('--')) return [...DEFAULT_BUCKETS];
  return next
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

function needleBlock(tag) {
  const bodies = NEEDLE_RELS.map((rel) => {
    const abs = path.join(REPO_ROOT, rel);
    const raw = fs.readFileSync(abs, 'utf8');
    return `### NEEDLE ${tag} ${rel}\n${raw}`;
  });
  return `<<<NEEDLE_${tag} shopfront orders→payments→postgres>>>\n${bodies.join('\n\n')}\n<<<END_NEEDLE_${tag}>>>\n`;
}

/**
 * Fill a dump/search window from this repo's source. Shopfront needles are
 * planted at start, ~100k (middle of 200k), and ~150k (start of last 50k).
 * Returns metadata only — haystack bodies stay out of git.
 */
function fillDumpBuckets(buckets) {
  const maxTok = Math.max(...buckets);
  const needleSet = new Set(NEEDLE_RELS.map((r) => path.join(REPO_ROOT, r)));
  const hayFiles = walkSourceFiles(REPO_ROOT, { maxFiles: 20_000 })
    .filter((abs) => !needleSet.has(abs))
    .sort((a, b) => a.localeCompare(b));

  const plants = [
    { tag: 'START', atTokens: 0 },
    { tag: 'MIDDLE', atTokens: 99_000 },
    { tag: 'LAST50K', atTokens: 145_000 },
  ];
  let plantIdx = 0;
  let tokens = 0;
  const chunks = [];
  const filesUsed = [];
  const needleDepths = {};

  const pushText = (text, meta) => {
    const t = approxTokens(text);
    chunks.push({ tokens: t, ...meta });
    tokens += t;
    return t;
  };

  const maybePlant = () => {
    while (plantIdx < plants.length && tokens >= plants[plantIdx].atTokens) {
      const plant = plants[plantIdx];
      needleDepths[plant.tag] = tokens;
      pushText(needleBlock(plant.tag), { kind: 'needle', tag: plant.tag });
      plantIdx += 1;
    }
  };

  maybePlant();
  for (const abs of hayFiles) {
    if (tokens >= maxTok) break;
    maybePlant();
    let raw;
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (raw.includes('\0')) continue;
    const rel = path.relative(REPO_ROOT, abs);
    const t = approxTokens(raw);
    if (t === 0) continue;
    filesUsed.push({ path: rel, tokens: t, depth_start: tokens });
    pushText(raw, { kind: 'file', path: rel });
  }
  maybePlant();

  const snapshots = buckets.map((limit) => {
    let acc = 0;
    let files = 0;
    const needlesIn = {};
    for (const c of chunks) {
      if (acc >= limit) break;
      acc += c.tokens;
      if (c.kind === 'file') files += 1;
    }
    for (const [tag, depth] of Object.entries(needleDepths)) {
      needlesIn[tag] = depth < limit;
    }
    return {
      bucket: limit,
      dump_tokens: Math.min(tokens, limit),
      filled: tokens >= limit,
      files_in_window: files,
      needles_in_window: needlesIn,
      needle_depths: needleDepths,
      last_50k_of_200k: limit >= 150_000,
    };
  });

  return {
    total_source_files_available: hayFiles.length,
    total_tokens_accumulated: tokens,
    reached_200k: tokens >= WINDOW_200K,
    needle_depths: needleDepths,
    snapshots,
    files_used: filesUsed.length,
    first_files: filesUsed.slice(0, 8).map((f) => f.path),
    last_files: filesUsed.slice(-8).map((f) => f.path),
  };
}

async function measureRecommendations() {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);
  const wantsResearch = wantsAskFileResearch(RECS_ASK);
  const prompt = buildAskPrompt(digest, RECS_ASK);
  const digestJson = JSON.stringify(digest);
  return {
    ask: RECS_ASK,
    wantsAskFileResearch: wantsResearch,
    digest_tokens: approxTokens(digestJson),
    prompt_tokens: approxTokens(prompt),
    prompt_chars: prompt.length,
    board_has_orders: digest.services.some((s) => s.name === 'orders'),
    board_has_recommendations: digest.services.some((s) => /recommend/i.test(s.name)),
    gateway_redis_edge: digest.edges.some(
      (e) => e.from.includes('gateway') && (e.to.includes('redis') || e.to.includes('ds:redis')),
    ),
  };
}

async function runBuckets(buckets) {
  const shop = await measureShopfront();
  const recs = await measureRecommendations();
  const dump = fillDumpBuckets(buckets);
  const sequenceAtEach = buckets.map((bucket) => ({
    bucket,
    sequence_shopfront_prompt_tokens: shop.sequence.prompt_tokens,
    sequence_recs_prompt_tokens: recs.prompt_tokens,
    sequence_digest_tokens: shop.sequence.digest_tokens,
    dump_tokens: dump.snapshots.find((s) => s.bucket === bucket)?.dump_tokens ?? 0,
    dump_filled: dump.snapshots.find((s) => s.bucket === bucket)?.filled ?? false,
  }));

  const out = {
    measured_at: new Date().toISOString(),
    method:
      'static approxTokens (chars/4); dump window filled from this repo source; shopfront needles planted at start / ~100k / ~150k; Sequence prompt re-measured, not grown',
    usd_spent: 0,
    buckets,
    shopfront_sequence: {
      explain_prompt_tokens: shop.sequence.prompt_tokens,
      digest_tokens: shop.sequence.digest_tokens,
      board_intact: shop.sequence.board_intact,
    },
    recommendations: recs,
    dump_window: dump,
    sequence_vs_dump_by_bucket: sequenceAtEach,
  };

  const jsonPath = path.join(REPO_ROOT, 'docs/research/agent-context-bench-200k-raw.json');
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  const lines = [
    'Sequence vs dump/search — 200k dump buckets',
    '',
    `Sequence shopfront prompt (flat): ${shop.sequence.prompt_tokens} tok`,
    `Sequence recs ask prompt (flat): ${recs.prompt_tokens} tok; wantsFileResearch=${recs.wantsAskFileResearch}; recs already on board=${recs.board_has_recommendations}`,
    `Dump accumulated: ${dump.total_tokens_accumulated} tok from ${dump.files_used} files (available ${dump.total_source_files_available})`,
    `Reached 200k: ${dump.reached_200k}`,
    `Needle depths: ${JSON.stringify(dump.needle_depths)}`,
    '',
    ...dump.snapshots.map(
      (s) =>
        `  ${s.bucket}: dump=${s.dump_tokens} filled=${s.filled} files=${s.files_in_window} needles=${JSON.stringify(s.needles_in_window)}`,
    ),
    '',
    `Wrote ${jsonPath}`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
  return out;
}

async function main() {
  const buckets = parseBucketsArg(process.argv);
  if (buckets) {
    await runBuckets(buckets);
    return;
  }

  const shop = await measureShopfront();
  const hermes = measureHermesDesign();
  const mono = await measureMonorepo();

  const table = [
    row(
      0,
      'sequence-board',
      'static/approxTokens',
      shop.sequence.prompt_with_research_tokens,
      shop.sequence.file_research_tokens,
      'n/a-static',
      shop.sequence.board_intact.has_orders &&
        shop.sequence.board_intact.has_payments &&
        shop.sequence.board_intact.has_postgres
        ? 'y'
        : 'n',
      0,
    ),
    row(
      0,
      'dump-search',
      'static/approxTokens',
      shop.dump_search.tokens_tool,
      shop.dump_search.tokens_tool,
      'n/a-static',
      'n/a',
      0,
    ),
    row(
      0,
      'sequence-board',
      'static/approxTokens',
      hermes.sequence.prompt_tokens,
      0,
      'n/a-static',
      'y-design-outline',
      0,
    ),
    row(
      0,
      'dump-search',
      'static/approxTokens',
      hermes.dump_search.tokens_tool,
      hermes.dump_search.tokens_tool,
      'n/a-static',
      'n/a',
      0,
    ),
    row(
      0,
      'sequence-board',
      'static/approxTokens',
      hermes.followup.prompt_tokens,
      0,
      'n/a-static',
      'y-labels-only',
      0,
    ),
  ];

  const out = {
    measured_at: new Date().toISOString(),
    method: 'static approxTokens (chars/4); no provider; Sequence buildAskPrompt vs list→grep→read',
    usd_spent: 0,
    shopfront: shop,
    hermes,
    monorepo: mono,
    table,
  };

  const jsonPath = path.join(REPO_ROOT, 'docs/research/agent-context-bench-raw.json');
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  const lines = [
    'Sequence vs dump/search — static token pull',
    '',
    `Shopfront ask: ${SHOPFRONT_ASK}`,
    `  Sequence digest: ${shop.sequence.digest_tokens} tok (${shop.sequence.digest_chars} chars); scoped: ${shop.sequence.scoped_digest_tokens} tok (omitted services=${shop.sequence.omitted_services})`,
    `  Sequence prompt: ${shop.sequence.prompt_tokens} tok; with research+scope: ${shop.sequence.prompt_with_research_tokens} tok`,
    `  wantsAskFileResearch: ${shop.sequence.wantsAskFileResearch}`,
    `  file research files: ${shop.sequence.file_research_files.join(', ') || '(none)'}`,
    `  board intact: ${JSON.stringify(shop.sequence.board_intact)}`,
    `  Dump list/grep/read tokens_tool: ${shop.dump_search.tokens_tool} (hits=${shop.dump_search.hits}, reads=${shop.dump_search.reads.length})`,
    `  Dump via Sequence askTools tokens_tool: ${shop.dump_via_sequence_tools.tokens_tool}`,
    `  Whole fixture source: ${shop.fixture_all_source.files} files, ${shop.fixture_all_source.tokens} tok`,
    '',
    `Hermes ask: ${HERMES_ASK}`,
    `  Sequence design prompt: ${hermes.sequence.prompt_tokens} tok (no digest)`,
    `  Follow-up prompt: ${hermes.followup.prompt_tokens} tok`,
    `  Dump Hermes grep/read tokens_tool: ${hermes.dump_search.tokens_tool} (hits=${hermes.dump_search.hits})`,
    '',
    `Monorepo digest: ${mono.digest_tokens} tok / ${DIGEST_BUDGET} budget; prompt ${mono.prompt_tokens} tok`,
    `  vs 200k window: digest ${mono.vs_200k.digest_pct}, prompt ${mono.vs_200k.prompt_pct}; last-50k cliff: ${mono.vs_200k.enters_last_50k}`,
    '',
    `Wrote ${jsonPath}`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
