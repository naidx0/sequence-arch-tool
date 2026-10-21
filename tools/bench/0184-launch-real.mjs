// Launch measurement against a REAL repository, in place.
//
// The sibling bench (0184-launch.mjs) copies a source tree into a disposable
// specimen first, so it can delete scan state freely. This one does not: it
// launches the built app against the repository the caller names, exactly as
// `sequence app --repo <dir>` does, and reports the wall-clock seconds to each
// launch stage. A synthetic specimen proves the harness; only a real repository
// proves the numbers.
//
//   node tools/bench/0184-launch-real.mjs <abs-repo> <label> [--cold] [--port N]
//
// `--cold` removes ONLY the engine's own derived state under `<repo>/.sequence`
// (the graph cache and the scan index/facts caches) so a run starts from
// nothing, and prints what it removed. It never touches source files, and it
// never touches a `.sequence` file git tracks (writeUnlessTracked: a tracked
// file is the person's, and the engine will not rewrite it).
//
// Environment passed to the child: SEQUENCE_SCAN_PROFILE=1 (the scanner's own
// phase table), SEQUENCE_BOOT_PROFILE=1 (the server's boot marks) and
// SEQUENCE_SCAN_TIMING=1 (the scan worker's stage lines). All three are
// diagnostics that are off in a product run.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const args = process.argv.slice(2);
const repo = path.resolve(args[0] ?? '');
const label = args[1] ?? 'run';
const cold = args.includes('--cold');
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1]) : 4388;
if (!repo) throw new Error('usage: node tools/bench/0184-launch-real.mjs <abs-repo> <label> [--cold] [--port N]');
if (!fs.existsSync(repo)) throw new Error(`no such repository: ${repo}`);

/* Bench artifacts live in tools/bench/out/ (git-ignored: `seq-*.json` and `*.log`). */
const outDir = path.join(root, 'tools', 'bench', 'out');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `seq-0184-launch-${label}.json`);

/** The engine's own derived state, and nothing else. */
const derived = [
  path.join(repo, '.sequence', 'graph.json'),
  path.join(repo, '.sequence', 'cache'),
  path.join(repo, '.sequence', 'functions.json'),
];
const removed = [];
if (cold) {
  for (const p of derived) {
    if (!fs.existsSync(p)) continue;
    removed.push(p);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

/** The files the scanner would see, counted the way the scanner counts them. */
const countFiles = (dir) => {
  const ignore = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '__pycache__', '.venv', 'venv',
    '.next', '.turbo', 'vendor', '.pytest_cache', '.mypy_cache', 'target', '.gradle', '.claude',
    '.sequence', 'release', 'server-bundle', 'fixtures', '__fixtures__', 'testdata',
  ]);
  const src = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.go', '.java']);
  let files = 0;
  let source = 0;
  const walk = (d) => {
    let es;
    try {
      es = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es) {
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) walk(full);
      } else if (e.isFile()) {
        files += 1;
        if (src.has(path.extname(e.name))) source += 1;
      }
    }
  };
  walk(dir);
  return { files, source };
};

const result = {
  label,
  repo,
  cold,
  removed,
  count: countFiles(repo),
  node: process.version,
  startedAt: new Date().toISOString(),
  stages: [],
};
const t0 = performance.now();
const mark = (stage, extra = {}) => {
  const m = { stage, ms: Math.round(performance.now() - t0), ...extra };
  result.stages.push(m);
  process.stdout.write(`${JSON.stringify(m)}\n`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
};

const cli = path.join(root, 'packages', 'analyzer', 'dist', 'cli.js');
const child = spawn(
  process.execPath,
  ['--import', './tools/test-guard/no-real-binaries.mjs', cli, 'app', '--no-open', '--port', String(port), '--repo', repo],
  {
    cwd: root,
    env: {
      ...process.env,
      SEQUENCE_SCAN_PROFILE: '1',
      SEQUENCE_BOOT_PROFILE: '1',
      SEQUENCE_SCAN_TIMING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let log = '';
child.stdout.on('data', (b) => {
  log += b;
});
child.stderr.on('data', (b) => {
  log += b;
  fs.writeFileSync(path.join(outDir, `seq-0184-launch-${label}.log`), log);
});

const base = `http://127.0.0.1:${port}`;
const deadline = performance.now() + 60 * 60_000;
let listening = false;
try {
  while (performance.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the app exited early (code ${child.exitCode})`);
    try {
      const r = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(3000) });
      const s = await r.json();
      if (!listening) {
        listening = true;
        mark('server-ready', { scanning: s.scanning ?? null });
      }
      if (s.attached) {
        mark('scan-attached', { nodes: s.nodes ?? null });
        break;
      }
      if (s.attachFailure) throw new Error(JSON.stringify(s.attachFailure));
    } catch (e) {
      if (child.exitCode !== null) throw e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!result.stages.some((s) => s.stage === 'scan-attached')) throw new Error('the attach deadline passed');
} finally {
  child.kill();
  result.childExit = await new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, `seq-0184-launch-${label}.log`), log);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
