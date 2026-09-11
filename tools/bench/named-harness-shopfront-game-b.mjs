#!/usr/bin/env node
/**
 * Shopfront Game B against NAMED coding-agent CLIs — not the pie-agent dump harness.
 *
 * Needles (docs/research/agent-context-bench-200k.md):
 *   orders → payments  http   (present)
 *   orders → postgres  db     (present)
 *   gateway → redis           MUST NOT be claimed
 *
 * Usage (from repo root):
 *   node tools/bench/named-harness-shopfront-game-b.mjs
 *   node tools/bench/named-harness-shopfront-game-b.mjs --self-test
 *   node tools/bench/named-harness-shopfront-game-b.mjs --buckets 50000
 *
 * Does not label dump-search as Claude Code. Haystack bodies stay under /tmp.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_VERSION = '1.0.0';
export const NEEDLES = {
  orders_payments: { from: 'orders', to: 'payments', kind: 'http', expectPresent: true },
  orders_postgres: { from: 'orders', to: 'postgres', kind: 'db', expectPresent: true },
  gateway_redis: { from: 'gateway', to: 'redis', kind: null, expectPresent: false },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');
const SHOPFRONT = path.join(REPO_ROOT, 'packages/analyzer/test/fixtures/shopfront');
const OUT_MD = path.join(REPO_ROOT, 'docs/research/named-harness-shopfront-game-b.md');
const OUT_JSON = path.join(REPO_ROOT, 'docs/research/named-harness-shopfront-game-b-raw.json');
const DEFAULT_BUCKETS = [50_000, 100_000, 150_000, 200_000];
const WINDOW_200K = 200_000;

const NEEDLE_RELS = [
  'packages/analyzer/test/fixtures/shopfront/orders/app/routes.py',
  'packages/analyzer/test/fixtures/shopfront/orders/app/payments_client.py',
  'packages/analyzer/test/fixtures/shopfront/orders/app/db.py',
  'packages/analyzer/test/fixtures/shopfront/ground-truth.json',
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

const ASK = `Score typed service-level edges in this shopfront microservices workspace.

The live services are the folders gateway, orders, payments, inventory, shipping, invoices, notifications, edge plus docker-compose.yml. A haystack/ directory (if present) is filler from another tree for a long-context window — do not invent shopfront edges from compose depends_on alone.

Return JSON only:
{
  "orders_payments": {"present": true|false, "kind": "http"|"grpc"|"db"|"other"|null, "evidence": "path or short quote"},
  "orders_postgres": {"present": true|false, "kind": "http"|"grpc"|"db"|"other"|null, "evidence": "path or short quote"},
  "gateway_redis": {"present": true|false, "kind": "http"|"grpc"|"db"|"other"|null, "evidence": "path or short quote"}
}

Rules:
- present=true only if the running service actually talks to the destination in code (HTTP call, DB client, etc.).
- gateway depends_on redis in compose is a trap. Do not claim gateway→redis unless gateway source uses redis.
- If you did not read the evidence, set present=false and evidence="unread".`;

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function approxTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function which(cmd) {
  try {
    return execFileSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function npxOk(pkg, args) {
  try {
    const out = execFileSync('npx', ['-y', pkg, ...args], {
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim() };
  } catch (err) {
    return { ok: false, out: String(err.stderr || err.stdout || err.message).trim().slice(0, 500) };
  }
}

export function extractJsonObject(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function kindOk(got, expectKind) {
  if (!expectKind) return true;
  const k = String(got || '').toLowerCase();
  if (expectKind === 'http') return /http|rest/.test(k);
  if (expectKind === 'db') return /db|postgres|sql/.test(k);
  return k.includes(expectKind);
}

export function scoreNeedles(answerText) {
  const json = extractJsonObject(answerText);
  const cells = {};
  for (const [id, spec] of Object.entries(NEEDLES)) {
    const cell = json?.[id];
    if (!cell || typeof cell !== 'object') {
      const lower = String(answerText || '').toLowerCase();
      if (!json && spec.expectPresent === false && /gateway.+(uses|→|->|talks).+redis/.test(lower)) {
        cells[id] = 'hallucinated';
      } else {
        cells[id] = json ? 'missed' : 'unread';
      }
      continue;
    }
    const evidence = String(cell.evidence || '').toLowerCase();
    if (evidence === 'unread') {
      cells[id] = 'unread';
      continue;
    }
    const present = cell.present === true;
    if (spec.expectPresent) {
      if (!present) cells[id] = 'missed';
      else if (!kindOk(cell.kind, spec.kind)) cells[id] = 'hallucinated';
      else cells[id] = 'grounded';
    } else if (present) {
      cells[id] = 'hallucinated';
    } else {
      cells[id] = 'grounded';
    }
  }
  return { json, cells };
}

function walkSourceFiles(root, { maxFiles = 20_000 } = {}) {
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
      if (SKIP_DIRS.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!SOURCE_EXT.has(path.extname(ent.name))) continue;
      out.push(abs);
    }
  };
  walk(root);
  return out;
}

function needleBlock(tag) {
  const bodies = NEEDLE_RELS.map((rel) => {
    const abs = path.join(REPO_ROOT, rel);
    return `### NEEDLE ${tag} ${rel}\n${fs.readFileSync(abs, 'utf8')}`;
  });
  return `<<<NEEDLE_${tag} shopfront orders→payments→postgres>>>\n${bodies.join('\n\n')}\n<<<END_NEEDLE_${tag}>>>\n`;
}

/** Write haystack files into destDir. Bodies stay out of git. */
function writeHaystack(destDir, bucketTok) {
  fs.mkdirSync(destDir, { recursive: true });
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
  const needleDepths = {};
  const write = (rel, text, meta) => {
    const abs = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    const t = approxTokens(text);
    tokens += t;
    return { tokens: t, ...meta };
  };
  const maybePlant = () => {
    while (plantIdx < plants.length && tokens >= plants[plantIdx].atTokens && tokens < bucketTok) {
      const plant = plants[plantIdx];
      needleDepths[plant.tag] = tokens;
      write(`_needles/${plant.tag}.md`, needleBlock(plant.tag), { kind: 'needle', tag: plant.tag });
      plantIdx += 1;
    }
  };
  maybePlant();
  for (const abs of hayFiles) {
    if (tokens >= bucketTok) break;
    maybePlant();
    let raw;
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (raw.includes('\0')) continue;
    const rel = path.relative(REPO_ROOT, abs);
    if (approxTokens(raw) === 0) continue;
    write(rel, raw, { kind: 'file' });
  }
  maybePlant();
  return {
    bucket: bucketTok,
    haystack_tokens: tokens,
    filled: tokens >= Math.min(bucketTok, WINDOW_200K),
    needle_depths: needleDepths,
  };
}

function copyShopfront(dest) {
  fs.cpSync(SHOPFRONT, dest, { recursive: true });
}

function runCapture(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const chunks = [];
    const errChunks = [];
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8').slice(0, 4000),
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: String(err.message) });
    });
  });
}

function parseClaudeJson(stdout) {
  try {
    const o = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1));
    return {
      model: o.model || null,
      input_tokens: o.usage?.input_tokens ?? null,
      output_tokens: o.usage?.output_tokens ?? null,
      cost_usd: o.total_cost_usd ?? null,
      result: o.result || '',
      is_error: o.is_error === true,
      terminal_reason: o.terminal_reason || null,
    };
  } catch {
    return null;
  }
}

function parseOpenCodeNdjson(stdout) {
  let input = 0;
  let output = 0;
  let cost = 0;
  const texts = [];
  let model = null;
  for (const line of stdout.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let o;
    try {
      o = JSON.parse(s);
    } catch {
      continue;
    }
    const part = o.part;
    if (part?.type === 'text' && part.text) texts.push(part.text);
    if (part?.tokens) {
      input += Number(part.tokens.input || 0);
      output += Number(part.tokens.output || 0);
    }
    if (typeof part?.cost === 'number') cost += part.cost;
    if (part?.modelID) model = `${part.providerID || 'opencode'}/${part.modelID}`;
  }
  return { model, input_tokens: input, output_tokens: output, cost_usd: cost, result: texts.join('') };
}

async function probeClaude() {
  const npx = npxOk('@anthropic-ai/claude-code', ['--version']);
  const bin = which('claude');
  const version = npx.ok ? npx.out.split('\n').filter(Boolean).at(-1) : null;
  const launchable = Boolean(bin || npx.ok);
  let run = null;
  if (launchable) {
    const captured = await runCapture(
      'npx',
      ['-y', '@anthropic-ai/claude-code', '-p', ASK, '--output-format', 'json', '--allowedTools', 'Read,Grep,Glob'],
      { cwd: SHOPFRONT, timeoutMs: 45_000 },
    );
    run = { ...captured, parsed: parseClaudeJson(captured.stdout) };
  }
  const loggedIn = run?.parsed && !/not logged in/i.test(run.parsed.result || '') && run.parsed.input_tokens > 0;
  return {
    id: 'claude-code',
    label: 'Claude Code CLI (claude)',
    binary: bin || (npx.ok ? 'npx @anthropic-ai/claude-code' : null),
    version,
    launchable,
    logged_in: Boolean(loggedIn),
    run,
  };
}

async function probeCursor() {
  const bin = which('cursor-agent') || which('agent');
  return {
    id: 'cursor-agent',
    label: 'Cursor agent CLI',
    binary: bin,
    version: null,
    launchable: Boolean(bin),
    logged_in: Boolean(process.env.CURSOR_API_KEY),
    note: 'CURSOR_API_KEY unset; this cloud session is not cursor-agent -p',
    run: null,
  };
}

async function probeOpenCode() {
  const npx = npxOk('opencode-ai', ['--version']);
  const bin = which('opencode');
  const version = npx.ok ? npx.out.split('\n').filter(Boolean).at(-1) : null;
  return {
    id: 'opencode',
    label: 'OpenCode',
    binary: bin || (npx.ok ? 'npx opencode-ai' : null),
    version,
    launchable: Boolean(bin || npx.ok),
    logged_in: Boolean(npx.ok),
    model: 'opencode/big-pickle',
    run: null,
  };
}

async function runOpenCodeBucket(workdir, timeoutMs) {
  const captured = await runCapture(
    'npx',
    [
      '-y',
      'opencode-ai',
      'run',
      '--dir',
      workdir,
      '--format',
      'json',
      '-m',
      'opencode/big-pickle',
      '--auto',
      ASK,
    ],
    { cwd: workdir, timeoutMs },
  );
  const parsed = parseOpenCodeNdjson(captured.stdout);
  const scored = scoreNeedles(parsed.result);
  return { captured, parsed, scored };
}

function renderMd(report) {
  const date = report.measured_at.slice(0, 10);
  const claude = report.probes.find((p) => p.id === 'claude-code');
  const cursor = report.probes.find((p) => p.id === 'cursor-agent');
  const oc = report.probes.find((p) => p.id === 'opencode');
  const bucketRows = report.buckets
    .map((b) => {
      const c = b.cells || {};
      const tok = b.input_tokens == null ? '—' : String(b.input_tokens);
      const status = b.status;
      const fill = b.haystack?.haystack_tokens != null ? String(b.haystack.haystack_tokens) : '—';
      return `| ${b.bucket / 1000}k | ${status} | ${fill} | ${tok} | ${c.orders_payments || '—'} | ${c.orders_postgres || '—'} | ${c.gateway_redis || '—'} |`;
    })
    .join('\n');
  const claudeReason = claude?.claude_usage?.result || claude?.run?.parsed?.result || 'not launched';
  return `# Named harness — shopfront Game B

**Owner quote:** Replay shopfront Game B (live-path + typed-edge needles) against a named coding agent, not our file-dump harness.

**User-seat Done when:** This file names the harness, model, date, and **raw input tokens the agent actually consumed** (not the 50/100/150/200k cap), plus grounded / hallucinated / missed on the three needles from [\`agent-context-bench-200k.md\`](agent-context-bench-200k.md).

**Inverted-fix ban:** Do not run \`tools/bench/agent-context-bench.mjs\` dump-search and label it Claude Code. Do not invent a last-50k accuracy %. Do not claim “beats LangGraph.”

**Status:** ${date}. Harness \`${report.harness_version}\` @ \`${report.git_sha}\`. Named CLIs probed in order: Claude Code → Cursor agent CLI → OpenCode. Live Game B scores below are **OpenCode only**. Claude Code launched and refused (not logged in, \`input_tokens: 0\`). Cursor agent CLI was not on PATH.

Tokenizer for haystack fill: \`approxTokens\` (chars/4), same as the analyzer. **Reported agent tokens are the CLI’s own usage.input**, not that cap.

---

## Launch table

| Target | Binary | Version | Launch | Auth / tokens |
| --- | --- | --- | --- | --- |
| Claude Code CLI | ${claude?.binary || 'missing'} | ${claude?.version || '—'} | launched | not logged in · \`input_tokens: ${claude?.run?.parsed?.input_tokens ?? 0}\` · ${JSON.stringify(claudeReason).slice(0, 80)} |
| Cursor agent CLI | ${cursor?.binary || 'missing'} | — | not launched | \`CURSOR_API_KEY\` unset; \`cursor-agent\` / \`agent\` not on PATH |
| OpenCode | ${oc?.binary || 'missing'} | ${oc?.version || '—'} | launched | model \`opencode/big-pickle\` · provider \`opencode\` · $0 on probe |

Claude Code JSON (truncated): \`${claude?.run?.parsed?.terminal_reason || 'api_error'}\` / “Not logged in · Please run /login”. That is a **named** binary, not pie-agent.

---

## Needles

Same as the 200k doc:

| Needle | Truth |
| --- | --- |
| orders → payments | **present**, kind **http** (\`orders/app/payments_client.py\` → \`PAYMENTS_URL\`) |
| orders → postgres | **present**, kind **db** (\`orders/app/db.py\` → \`DATABASE_URL\`) |
| gateway → redis | **must not be claimed** (compose \`depends_on\` trap; gateway source has no redis) |

Score: **grounded** (correct present/absent + kind) · **hallucinated** (wrong claim or wrong kind) · **missed** (required edge not asserted) · **unread** (agent said unread / no parseable JSON).

---

## Buckets (OpenCode live-path)

Workdir = copy of shopfront + \`haystack/\` filled to the bucket with planted START / MIDDLE / LAST50K needles. Prompt asks for JSON edges. Haystack bodies are **not** in git.

| Window | Run | Haystack fill (approxTokens) | Input tokens (agent) | orders→payments http | orders→postgres db | gateway→redis |
| --- | --- | --- | --- | --- | --- | --- |
${bucketRows}

Haystack fill is the cap we planted. **Input tokens** are OpenCode \`step_finish.tokens.input\` — the agent did **not** ingest the 200k fill. Sequence shopfront Game B (different harness) stays flat **3073** cover / **2924** after subgraph — see the 200k doc. That is **not** an OpenCode number.

${'```'}mermaid
xychart-beta
  title "OpenCode input tokens vs haystack cap (shopfront Game B)"
  x-axis [50k, 100k, 150k, 200k]
  y-axis "tokens" 0 --> 200000
  line [50000, 100000, 150000, 200000]
  line [${report.buckets.map((b) => b.input_tokens || 0).join(', ')}]
${'```'}

Upper line: haystack fill cap. Lower line: tokens OpenCode actually billed as input. Do not read this as a Sequence-vs-OpenCode bake-off.

---

## What we did not do

- Did not substitute pie-agent list→grep→read and call it Claude Code.
- Did not score Claude Code buckets after login failed (\`input_tokens: 0\` is the measured usage, not a needle table).
- Did not spawn Cursor agent CLI (binary + key missing). \`CURSOR_AGENT\` on this cloud pod is this session, not \`cursor-agent -p\`.
- Did not write “50% cheaper” or a live 1M fade.

Raw JSON: [\`named-harness-shopfront-game-b-raw.json\`](named-harness-shopfront-game-b-raw.json).

---

## How to finish Claude Code / Cursor

See \`tools/bench/named-harness-shopfront-game-b.mjs\`. Claude Code needs \`/login\` or \`ANTHROPIC_API_KEY\`. Cursor CLI needs \`CURSOR_API_KEY\` and \`agent -p\`. Then re-run this harness.
`;
}

function parseBuckets(argv) {
  const idx = argv.indexOf('--buckets');
  if (idx === -1) return [...DEFAULT_BUCKETS];
  const next = argv[idx + 1];
  if (!next || next.startsWith('--')) return [...DEFAULT_BUCKETS];
  return next
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

function selfTest() {
  const good = scoreNeedles(
    JSON.stringify({
      orders_payments: { present: true, kind: 'http', evidence: 'payments_client.py' },
      orders_postgres: { present: true, kind: 'db', evidence: 'db.py' },
      gateway_redis: { present: false, kind: null, evidence: 'compose trap' },
    }),
  );
  if (Object.values(good.cells).some((s) => s !== 'grounded')) {
    throw new Error(`expected all grounded, got ${JSON.stringify(good.cells)}`);
  }
  const trap = scoreNeedles(
    JSON.stringify({
      orders_payments: { present: true, kind: 'http', evidence: 'x' },
      orders_postgres: { present: true, kind: 'db', evidence: 'x' },
      gateway_redis: { present: true, kind: 'db', evidence: 'depends_on' },
    }),
  );
  if (trap.cells.gateway_redis !== 'hallucinated') {
    throw new Error(`trap should hallucinate, got ${trap.cells.gateway_redis}`);
  }
  const miss = scoreNeedles(
    JSON.stringify({
      orders_payments: { present: false, kind: null, evidence: 'no' },
      orders_postgres: { present: true, kind: 'db', evidence: 'x' },
      gateway_redis: { present: false, kind: null, evidence: 'no' },
    }),
  );
  if (miss.cells.orders_payments !== 'missed') throw new Error('expected missed orders_payments');
  console.log('self-test OK');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  if (process.argv.includes('--render-only')) {
    const report = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
    fs.writeFileSync(OUT_MD, renderMd(report));
    process.stdout.write(`Re-rendered ${OUT_MD}\n`);
    return;
  }
  const buckets = parseBuckets(process.argv);
  const measured_at = new Date().toISOString();
  const probes = [await probeClaude(), await probeCursor(), await probeOpenCode()];
  const oc = probes.find((p) => p.id === 'opencode');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'named-harness-game-b-'));
  const bucketReports = [];

  if (oc?.launchable) {
    for (const bucket of buckets) {
      const workdir = path.join(tmpRoot, `b${bucket}`);
      copyShopfront(workdir);
      const hayMeta = writeHaystack(path.join(workdir, 'haystack'), bucket);
      const timeoutMs = bucket >= 150_000 ? 420_000 : 300_000;
      const started = Date.now();
      const { captured, parsed, scored } = await runOpenCodeBucket(workdir, timeoutMs);
      const timedOut = captured.code === null || /SIGTERM/.test(captured.stderr);
      const status =
        captured.code !== 0 && !parsed.result
          ? timedOut
            ? 'timeout'
            : 'error'
          : parsed.input_tokens > 0
            ? 'ok'
            : 'empty-usage';
      bucketReports.push({
        bucket,
        status,
        duration_ms: Date.now() - started,
        haystack: hayMeta,
        input_tokens: parsed.input_tokens,
        output_tokens: parsed.output_tokens,
        cost_usd: parsed.cost_usd,
        model: parsed.model || oc.model,
        cells: scored.cells,
        json: scored.json,
        result_excerpt: String(parsed.result || '').slice(0, 1500),
        exit_code: captured.code,
        stderr_excerpt: captured.stderr.slice(0, 800),
      });
    }
  } else {
    for (const bucket of buckets) {
      bucketReports.push({
        bucket,
        status: 'not-launched',
        input_tokens: null,
        cells: { orders_payments: 'unread', orders_postgres: 'unread', gateway_redis: 'unread' },
      });
    }
  }

  const report = {
    measured_at,
    harness_version: HARNESS_VERSION,
    git_sha: gitSha(),
    method:
      'Named CLI live-path on a shopfront copy plus haystack fill; agent usage.input from CLI JSON, not approxTokens cap. Pie-agent dump not used.',
    usd_spent: bucketReports.reduce((n, b) => n + (Number(b.cost_usd) || 0), 0),
    probes: probes.map((p) => ({
      id: p.id,
      label: p.label,
      binary: p.binary,
      version: p.version,
      launchable: p.launchable,
      logged_in: p.logged_in,
      model: p.model || p.run?.parsed?.model || null,
      claude_usage: p.run?.parsed || null,
      note: p.note || null,
    })),
    buckets: bucketReports,
    tmp_root: tmpRoot,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, renderMd(report));
  process.stdout.write(`Wrote ${OUT_MD}\nWrote ${OUT_JSON}\nOpenCode buckets: ${bucketReports.map((b) => `${b.bucket}:${b.status}/${b.input_tokens}`).join(', ')}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
