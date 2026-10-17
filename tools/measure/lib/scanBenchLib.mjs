/* Shared plumbing for the scan benches (scan-bench.mjs, status-bench.mjs): the pure helpers (percentile,
   spread, settle detection) that tools/measure/test/scanBenchLib.test.mjs locks, and the impure parts
   (pinned export, generated big repo, engine spawn, RSS sampling). No model is called; every spawn of the
   CLI goes through isolatedEnv, with HOME pointed at the work dir so the attach jail (home) contains the
   repo copy and nothing touches the real ~/.sequence. */
import { spawn, spawnSync, execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from './isolatedEnv.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const CLI = path.join(ROOT, 'packages/analyzer/dist/cli.js');
export const OUT_DIR = path.join(ROOT, 'tools/measure/out');

export const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
export const flag = (k) => process.argv.includes(k);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Temp dirs the bench made, removed on exit AND on SIGINT / SIGTERM (a Ctrl-C mid-run must not leave a
   20k-file repo or a bin dir behind). */
const cleanups = new Set();
/* Child processes (the status sampler) whose whole tree dies on every exit path, including the bench's own. */
const trees = new Set();

/** Kill `pid` and every process under it. win32: taskkill /T /F; POSIX: the process group, when it leads one
    (`detached`), else the process alone. Never throws; an already-dead pid is fine. */
export function killTree(pid, { detached = false, platform = process.platform } = {}) {
  if (!pid) return;
  try {
    if (platform === 'win32') {
      execFileSync(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else if (detached) process.kill(-pid, 'SIGKILL');
    else process.kill(pid, 'SIGKILL');
  } catch { /* already gone */ }
}

/** Register a child so cleanupNow (process exit, SIGINT, SIGTERM) kills its tree. Returns an untrack function. */
export function trackTree(pid, { detached = false } = {}) {
  const t = { pid, detached };
  trees.add(t);
  registerCleanup(null);
  return () => trees.delete(t);
}
let handlersInstalled = false;
export function cleanupNow() {
  for (const t of [...trees]) killTree(t.pid, t);
  trees.clear();
  for (const d of cleanups) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  cleanups.clear();
}
export function registerCleanup(dir) {
  if (dir != null) cleanups.add(dir);
  if (handlersInstalled) return dir;
  handlersInstalled = true;
  process.on('exit', cleanupNow);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.on(sig, () => { cleanupNow(); process.exit(code); });
  }
  return dir;
}

/* ── pure helpers ───────────────────────────────────────────────────────── */

/** Nearest-rank percentile (p in 0..1) of xs; null when empty. p95 of 20 samples is the 19th smallest. */
export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * s.length));
  return s[Math.min(s.length, rank) - 1];
}

/** Median (mean of the middle two for an even count); null when empty. */
export function medianOf(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median plus spread of repeated runs. */
export function summarize(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { n: 0, median: null, min: null, max: null };
  return { n: v.length, median: medianOf(v), min: Math.min(...v), max: Math.max(...v) };
}

/** CPU % of one core between two cumulative-tick readings ({ticks, t}), ticks per second `hz` (Linux: 100). */
export function cpuPercent(prev, next, hz = 100) {
  const dt = next.t - prev.t;
  if (dt <= 0) return 0;
  return (((next.ticks - prev.ticks) / hz) * 1000 * 100) / dt;
}

/**
 * Settle detection over samples [{t (ms), cpu (%), rss (KB)}], in time order. The process is settled at the
 * first sample from which CPU stays below `cpuBelow` for `holdMs` of consecutive samples (the window's
 * span, last.t - first.t, must reach holdMs). Returns { settled, settledAt (t of the window end), rssKb
 * (RSS at the window end), peakKb (max over every sample), windowStart }. Unsettled: settled=false and
 * rssKb = the last sample's RSS.
 */
export function detectSettle(samples, { cpuBelow = 2, holdMs = 5000 } = {}) {
  const peakKb = samples.reduce((m, s) => Math.max(m, s.rss), 0);
  let start = -1;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].cpu < cpuBelow) {
      if (start < 0) start = i;
      if (samples[i].t - samples[start].t >= holdMs) {
        return { settled: true, settledAt: samples[i].t, windowStart: samples[start].t, rssKb: samples[i].rss, peakKb };
      }
    } else start = -1;
  }
  const last = samples[samples.length - 1];
  return { settled: false, settledAt: null, windowStart: null, rssKb: last ? last.rss : null, peakKb };
}

export const mb = (kb) => (kb == null ? null : Math.round((kb / 1024) * 10) / 10);
export const sec = (ms) => (ms == null ? null : Math.round(ms / 10) / 100);

/* ── impure plumbing ────────────────────────────────────────────────────── */

export function freePort() {
  return new Promise((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
}

/* The bench's own VCS calls: no hooks, no signing, and an isolated HOME so no user config applies. */
let benchHome = null;
export function gitOut(cwd, ...a) {
  benchHome ??= registerCleanup(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-benchhome-')));
  const env = cleanEnv(process.env, benchHome);
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', '-c', 'core.autocrlf=false', '-c', 'safe.directory=*', ...a], {
    cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], env,
  }).trim();
}

/** Resolve the pin: --sha, else the tip of `main` (falling back to HEAD), as a full sha. */
export function pinnedSha() {
  const want = arg('--sha', null);
  for (const ref of want ? [want] : ['main', 'HEAD']) {
    try { return gitOut(ROOT, 'rev-parse', '--verify', `${ref}^{commit}`); } catch { /* try next */ }
  }
  throw new Error('cannot resolve a commit to pin');
}

/** The archive of `sha` exported into a fresh temp dir (no .git, no working-tree drift). Returns the dir. */
export function exportPinned(sha, into) {
  const dir = into ?? registerCleanup(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-pinned-')));
  fs.mkdirSync(dir, { recursive: true });
  const a = spawnSync('git', ['archive', sha], { cwd: ROOT, maxBuffer: 1 << 30, env: cleanEnv(process.env, benchHome ?? os.tmpdir()) });
  if (a.status !== 0) throw new Error(`archive export failed: ${a.stderr}`);
  const t = spawnSync('tar', ['-x', '-C', dir], { input: a.stdout });
  if (t.status !== 0) throw new Error(`tar failed: ${t.stderr}`);
  return dir;
}

/** Make `dir` a repo with one commit on `main` (an archive has no .git; a HEAD change needs one). */
export function gitInitCommit(dir) {
  gitOut(dir, 'init', '-q', '-b', 'main');
  gitOut(dir, 'add', '-A');
  gitOut(dir, 'commit', '-q', '-m', 'bench base');
}

/* Port of packages/analyzer/src/test/findFilesBigRepo.ts makeBigRepo: same generator and seed, so the 20k
   files are identical. Two deliberate differences: a root package.json (the scanner needs a manifest to see a
   project; the TS helper only feeds find_files, which does not), and `init -b main` via gitInitCommit (the
   HEAD-change bench needs the branch name known, not whatever init.defaultBranch the machine has). */
export function makeBigRepo(parent, files = 20_000) {
  const dir = path.join(parent, 'bigrepo');
  fs.mkdirSync(dir, { recursive: true });
  let seed = 12345;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  const syl = ['ka', 'lo', 'mi', 'ten', 'ra', 'sul', 'vor', 'pe', 'qua', 'dex', 'ni', 'bra', 'zo', 'tul', 'fen', 'gor', 'ha', 'jin', 'wex', 'yu'];
  const vocab = [];
  for (let i = 0; i < 6000; i++) vocab.push(syl[i % 20] + syl[Math.floor(i / 20) % 20] + syl[Math.floor(i / 400) % 20] + (i >= 8000 ? String(i) : ''));
  const w = () => vocab[rnd(vocab.length)];
  const names = [];
  for (let i = 0; i < files; i++) names.push(`packages/p${i % 40}/src/m${i % 500}/${w()}${i}.ts`);
  for (let i = 0; i < files; i++) {
    const lines = [];
    for (let k = 0; k < 3; k++) {
      const j = rnd(files);
      lines.push(`import { ${w()}${j} } from '${path.posix.relative(path.posix.dirname(names[i]), names[j]).replace(/\.ts$/, '')}';`);
    }
    for (let f = 0; f < 4; f++) {
      const fn = `${w()}${w().replace(/^./, (c) => c.toUpperCase())}${i}_${f}`;
      lines.push(`/** ${w()} ${w()} ${w()} ${w()} ${w()} ${w()} ${w()} */`);
      lines.push(`export function ${fn}(${w()}: number, ${w()}: string): number {`);
      lines.push(`  const ${w()} = ${w()}${rnd(100)} + ${rnd(1000)}; // ${w()} ${w()} ${w()}`);
      lines.push(`  if (${w()} > ${rnd(50)}) return ${w()}(${w()}, '${w()} ${w()}');`);
      lines.push(`  return ${w()}.${w()}(${w()}) * ${rnd(9)};`);
      lines.push('}');
    }
    const p = path.join(dir, names[i]);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${lines.join('\n')}\n`);
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bigrepo', private: true, version: '0.0.0' }));
  gitInitCommit(dir);
  return dir;
}

/** A work dir that is also HOME for the engine, so the attach jail contains `work/<name>`. */
export function makeWork(prefix = 'seq-scanbench-') {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  if (!flag('--keep')) registerCleanup(work);
  const userDir = path.join(work, 'user');
  fs.mkdirSync(userDir, { recursive: true });
  return { work, userDir };
}

export function rmQuiet(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
}

/** Spawn `cli.js app --no-open` (optionally with --repo). Returns { child, base, spawnedAt }. */
export async function spawnEngine({ repo = null, work, userDir }) {
  const port = await freePort();
  const args = [CLI, 'app', '--no-open', '--port', String(port), ...(repo ? ['--repo', repo] : [])];
  const spawnedAt = Date.now();
  const child = spawn(process.execPath, args, {
    env: cleanEnv(isolatedEnv(process.env, { userDir }), work), stdio: 'ignore',
  });
  return { child, base: `http://127.0.0.1:${port}`, port, spawnedAt };
}

/** Poll /api/status until `pred(body)`; returns Date.now() at success, or throws at the deadline. */
export async function waitStatus(base, pred, { everyMs = 100, timeoutMs = 600_000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${base}/api/status`);
      if (r.ok && pred(await r.json())) return Date.now();
    } catch { /* not listening yet */ }
    await sleep(everyMs);
  }
  throw new Error(`status never satisfied within ${timeoutMs} ms`);
}

/* Per-platform process readers. Each parser turns one platform's raw text into { rssKb, ticks } with ticks in
   100 Hz units, so cpuPercent's default hz holds everywhere. `ps -o` is NOT used on win32: Git Bash's ps does
   not support it. */

/** Linux: /proc/<pid>/stat (utime + stime are fields 14, 15, in clock ticks of 100 Hz). */
export function parseProcStat(text) {
  const rest = text.slice(text.lastIndexOf(')') + 2).split(' ');
  const ticks = Number(rest[11]) + Number(rest[12]);
  return Number.isFinite(ticks) ? ticks : null;
}
/** Linux: VmRSS from /proc/<pid>/status, in KB. */
export function parseVmRss(text) {
  const m = /^VmRSS:\s+(\d+)\s*kB/m.exec(text);
  return m ? Number(m[1]) : null;
}
/** macOS / BSD: `ps -o rss=,time= -p pid` -> "  12345   0:03.45" (cputime [[dd-]hh:]mm:ss[.ff]). */
export function parsePsLine(text) {
  const m = /^\s*(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(text.trim());
  if (!m) return null;
  const sec = Number(m[2] ?? 0) * 86400 + Number(m[3] ?? 0) * 3600 + Number(m[4]) * 60 + Number(m[5]);
  return { rssKb: Number(m[1]), ticks: sec * 100 };
}
/** win32: PowerShell prints "<WorkingSet64 bytes> <TotalProcessorTime ms>". */
export function parseWinProc(text) {
  const m = /^\s*(\d+)\s+(\d+(?:\.\d+)?)\s*$/.exec(text.trim());
  return m ? { rssKb: Math.round(Number(m[1]) / 1024), ticks: Number(m[2]) / 10 } : null;
}

/** One reading of `pid`: { t, rss (KB), ticks } or null when the process is gone / unreadable. */
export function readProc(pid, platform = process.platform) {
  const t = Date.now();
  try {
    if (platform === 'linux') {
      const rss = parseVmRss(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
      const ticks = parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
      return rss ? { t, rss, ticks } : null;
    }
    if (platform === 'win32') {
      const ps = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const out = execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-Process -Id ${Number(pid)} -ErrorAction Stop; '{0} {1}' -f $p.WorkingSet64, [math]::Round($p.TotalProcessorTime.TotalMilliseconds)`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const r = parseWinProc(out);
      return r ? { t, rss: r.rssKb, ticks: r.ticks } : null;
    }
    const r = parsePsLine(execFileSync('ps', ['-o', 'rss=,time=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    return r ? { t, rss: r.rssKb, ticks: r.ticks } : null;
  } catch { return null; }
}

/** `readProc`, without blocking the caller's event loop on win32 (where a reading is a PowerShell spawn of a few
    hundred ms). The sampler runs INSIDE the bench process, whose own timers and fetches it would otherwise stall:
    a rescan timed across a sync reading was read late by up to the length of the reading. */
export function readProcAsync(pid, platform = process.platform) {
  if (platform !== 'win32') return Promise.resolve(readProc(pid, platform));
  const t = Date.now();
  const ps = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    execFile(ps, ['-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-Process -Id ${Number(pid)} -ErrorAction Stop; '{0} {1}' -f $p.WorkingSet64, [math]::Round($p.TotalProcessorTime.TotalMilliseconds)`],
    { encoding: 'utf8', windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const r = parseWinProc(String(out));
      resolve(r ? { t, rss: r.rssKb, ticks: r.ticks } : null);
    });
  });
}

/** Samples a pid every `everyMs`; `stop()` returns the samples [{t, cpu, rss}] (t = ms since start). */
export function startRssSampler(pid, everyMs = 250) {
  const samples = [];
  const t0 = Date.now();
  let prev = null;
  let live = true;
  let reading = false;
  const iv = setInterval(() => {
    if (!live || reading) return;
    reading = true;
    readProcAsync(pid).then((s) => {
      reading = false;
      if (!live || !s || !s.rss) return;
      const cpu = prev && s.ticks != null && prev.ticks != null ? cpuPercent({ ticks: prev.ticks, t: prev.t }, { ticks: s.ticks, t: s.t }) : 100;
      samples.push({ t: s.t - t0, cpu, rss: s.rss });
      prev = s;
    });
  }, everyMs);
  return { samples, stop: () => { live = false; clearInterval(iv); return samples; } };
}

export function machineNotes() {
  return {
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? null,
    loadavgStart: os.loadavg().map((x) => Math.round(x * 100) / 100),
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
  };
}

/* ── hermetic env, fresh homes, run files ───────────────────────────────── */

/* Derived by pattern, not listed: any credential-shaped suffix (_KEY, _TOKEN, _SECRET, _PASSWORD), the provider
   and launcher prefixes, every GIT_* (GIT_DIR / GIT_WORK_TREE / GIT_CONFIG_* would redirect the bench's git and the
   engine's) and npm_config_ entries that carry a token, auth or password. Case-insensitive: win32 env names are. */
export const SECRET_ENV = /(_API_KEY$|_KEY$|_TOKEN$|_SECRET$|_PASSWORD$|_PASSWD$|^OPENROUTER_|^ANTHROPIC_|^OPENAI_|^SEQUENCE_AI_|^CLAUDE_CODE_|^SEQUENCE_CLAUDE_BRIDGE$|^AWS_|^GH_|^GITHUB_|^CLOUDSDK_|^GIT_|^npm_config_.*(token|auth|password|_key|secret))/i;

/** First executable named `names[i]` on `pathVar` (the CALLER's PATH), or null. */
export function findOnPath(names, pathVar, platform = process.platform) {
  const sep = platform === 'win32' ? ';' : ':';
  for (const dir of (pathVar ?? '').split(sep).filter(Boolean)) {
    for (const n of names) {
      const p = path.join(dir, n);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

/**
 * The PATH value for a spawned child: ONLY directories that hold no `claude` / `codex`. Node's own folder is
 * never used, because it can hold either (or an npm-global shim). Git is resolved once from `callerPath`;
 * missing git throws.
 * POSIX: one private dir of symlinks to node, git and `sh` (git and the engine shell out to it).
 * win32: shell-less spawn only finds .exe/.com, so no .cmd shims. PATH is `<git's own dir>;<private dir>`,
 * where the private dir holds a COPY of node.exe alone, and git's own dir (normally Git\cmd, which holds only
 * git.exe) is refused if it lists anything named claude* or codex*.
 * Returns the PATH string.
 */
export function makeBinDir(parent, { platform = process.platform, execPath = process.execPath, callerPath = process.env.PATH ?? process.env.Path } = {}) {
  const win = platform === 'win32';
  const gitPath = findOnPath(win ? ['git.exe'] : ['git'], callerPath, platform);
  if (!gitPath) throw new Error('bench: git not found on PATH; the bench needs git and will not guess one');
  const dir = fs.mkdtempSync(path.join(parent, 'seq-benchbin-'));
  if (win) {
    const gitDir = path.dirname(gitPath);
    const bad = fs.readdirSync(gitDir).filter((n) => /^(claude|codex)/i.test(n));
    if (bad.length) throw new Error(`bench: git's directory ${gitDir} also holds ${bad.join(', ')}; refusing to put it on PATH`);
    const dest = path.join(dir, 'node.exe');
    try { fs.linkSync(execPath, dest); } catch { fs.copyFileSync(execPath, dest); }
    return [gitDir, dir].join(';');
  }
  const tools = [['node', execPath], ['git', gitPath]];
  const sh = findOnPath(['sh'], `${callerPath}:/bin:/usr/bin`, platform);
  if (sh) tools.push(['sh', sh]);
  for (const [name, target] of tools) fs.symlinkSync(target, path.join(dir, name));
  return dir;
}

let defaultBin = null;
function defaultBinDir() {
  if (defaultBin === null) {
    defaultBin = makeBinDir(os.tmpdir());
    registerCleanup(process.platform === 'win32' ? defaultBin.split(';')[1] : defaultBin);
  }
  return defaultBin;
}

/**
 * `env` for a spawned engine or child process:
 * - PATH (win32: Path) is exactly `binDir` (default: one made per process by makeBinDir) and nothing else, so
 *   no `claude`, `codex` or installer is reachable even if it sits next to node;
 * - HOME (win32: also USERPROFILE) is `home`;
 * - dropped: every key ending _API_KEY, and OPENROUTER_*, ANTHROPIC_*, OPENAI_*, SEQUENCE_AI_*,
 *   CLAUDE_CODE_EXECUTABLE, CLAUDE_CODE_OAUTH_TOKEN, SEQUENCE_CLAUDE_BRIDGE, AWS_*, GH_TOKEN, GITHUB_TOKEN,
 *   CLOUDSDK_*, GIT_CONFIG_*;
 * - set afterwards: GIT_CONFIG_NOSYSTEM=1 and GIT_CONFIG_GLOBAL=/dev/null (NUL on win32), so no user or system
 *   git config reaches the engine or the bench's own git.
 */
export function cleanEnv(env, home, platform = process.platform, binDir = defaultBinDir()) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!SECRET_ENV.test(k)) out[k] = v;
  const win = platform === 'win32';
  if (win) delete out.PATH;
  out[win ? 'Path' : 'PATH'] = binDir;
  out.HOME = home;
  if (win) out.USERPROFILE = home;
  out.GIT_CONFIG_NOSYSTEM = '1';
  out.GIT_CONFIG_GLOBAL = win ? 'NUL' : '/dev/null';
  return out;
}

/** Move `repo` into a brand-new HOME with a brand-new user dir (nothing carries over between reps). */
export function freshHome(work, repo, tag) {
  const home = fs.mkdtempSync(path.join(work, `home-${tag}-`));
  const userDir = path.join(home, '.seq-user');
  fs.mkdirSync(userDir, { recursive: true });
  const moved = path.join(home, path.basename(repo));
  fs.renameSync(repo, moved);
  rmQuiet(path.join(moved, '.sequence'));
  return { home, userDir, repo: moved };
}

/** Unique raw-output path: <prefix>-<sha12>-<ISO time, : and . replaced>[-tag].<ext> under tools/measure/out. */
export function runFile(prefix, sha, date = new Date(), tag = '', ext = 'json') {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return path.join(OUT_DIR, `${prefix}-${sha.slice(0, 12)}-${stamp}${tag ? `-${tag}` : ''}.${ext}`);
}

/**
 * The verdict for one scan window. `samples` are the sampler's [sentEpoch, latencyMs, status]; `skippedAt`
 * its dropped-tick times. Only requests SENT inside [start, end] count. Latency percentiles use 'ok' samples
 * alone: an error or an unanswered request is not a service time, so it can never pull p95 down.
 * FAIL when anything in the window failed (bad/unanswered), any tick was skipped (the in-flight cap was hit,
 * i.e. a stall of cap x interval or more), or p95 >= p95Max. Otherwise INCONCLUSIVE when `scanProblem` (a
 * string) says the scan was not a real one, or fewer than minSamples ok samples; else PASS.
 */
export const STALL_WARN_MS = 500;
export function judgeWindow({ samples, skippedAt = [], start, end, p95Max = 50, minSamples = 10, scanProblem = null }) {
  const inWin = samples.filter(([sent]) => sent >= start && sent <= end);
  const ok = inWin.filter((x) => x[2] === 'ok').map((x) => x[1]);
  const failed = inWin.filter((x) => x[2] !== 'ok').length;
  const skipped = skippedAt.filter((t) => t >= start && t <= end).length;
  const p95 = percentile(ok, 0.95);
  const longestStallMs = inWin.length ? Math.max(...inWin.map((x) => x[1])) : null;
  const stats = { n: ok.length, p50: percentile(ok, 0.5), p95, max: ok.length ? Math.max(...ok) : null, longestStallMs, failed, skipped };
  const reasons = [];
  if (failed > 0) reasons.push(`${failed} request(s) failed or went unanswered`);
  if (skipped > 0) reasons.push(`${skipped} tick(s) skipped (server stalled past the in-flight cap)`);
  if (p95 != null && p95 >= p95Max) reasons.push(`p95 ${Math.round(p95)} ms >= ${p95Max} ms`);
  let verdict = 'PASS';
  if (reasons.length) {
    verdict = 'FAIL';
    if (scanProblem) reasons.push(`also: ${scanProblem}`);
  } else if (scanProblem) {
    verdict = 'INCONCLUSIVE';
    reasons.push(scanProblem);
  } else if (ok.length < minSamples) {
    verdict = 'INCONCLUSIVE';
    reasons.push(`only ${ok.length} samples`);
  }
  const warnings = longestStallMs != null && longestStallMs > STALL_WARN_MS ? [`longest stall ${Math.round(longestStallMs)} ms (> ${STALL_WARN_MS} ms)`] : [];
  return { ...stats, verdict, reasons, warnings };
}

/** Median over only the runs that settled: runs [{settled, value}] -> { nSettled, nTotal, median|null, min, max }. */
export function settledSummary(runs) {
  const good = runs.filter((r) => r.settled && typeof r.value === 'number');
  return { nSettled: good.length, nTotal: runs.length, ...summarize(good.map((r) => r.value)) };
}

/**
 * Why a finished scan window cannot count as a real scan (null when it can). The graph must have nodes, its
 * scannedAt must differ from the one captured BEFORE the trigger (which must exist when `requireBefore`: paths
 * ii-iv rescan an attached graph) and be no earlier than the trigger (`startedAtMs`), and the window must last
 * at least minScanMs.
 */
export function scanProblemOf({ scanMs, nodes, scannedAtBefore, scannedAtAfter, minScanMs = 2000, startedAtMs = null, requireBefore = false }) {
  if (requireBefore && scannedAtBefore == null) return 'no graph was captured before the trigger, so a changed scannedAt proves nothing';
  if (!(nodes > 0)) return 'graph has no nodes after the scan';
  if (scannedAtAfter == null || scannedAtAfter === scannedAtBefore) return 'graph scannedAt did not change: no new scan was observed';
  if (startedAtMs != null) {
    const t = Date.parse(scannedAtAfter);
    if (!Number.isFinite(t)) return `graph scannedAt "${scannedAtAfter}" is not a date`;
    if (t < startedAtMs) return 'graph scannedAt is older than the trigger: that graph was not produced by this scan';
  }
  if (scanMs < minScanMs) return `scan lasted ${scanMs} ms (< ${minScanMs} ms): too short to prove anything`;
  return null;
}

/** Wait for the engine to go quiet. A timeout is RECORDED (pushed to `timeouts`) and logged, never silent. */
export async function waitQuiet(name, settleFn, timeouts, log = () => {}) {
  if (await settleFn()) return true;
  timeouts.push(name);
  log(`  WARNING: engine did not go quiet (CPU < 2 % for 4 s) before ${name}; that window may include leftover work`);
  return false;
}

/**
 * One measured scan window, with its dependencies injected (so the control flow is unit-tested):
 *   startSampler() -> { stop(): {samples, skippedAt}, kill() }     getMeta(etag) -> null (no graph) |
 *   { unchanged: true } (304) | { scannedAt, nodes, etag }         trigger() resolves when the trigger says done.
 * The graph identity is captured BEFORE the sampler starts and the trigger runs. After the trigger the window
 * stays open (polling the cheap conditional getMeta) until the graph's scannedAt differs, up to giveUpMs.
 * The sampler is stopped or killed on every exit path, including a throwing trigger.
 */
export async function runWindow({
  label, startSampler, getMeta, trigger, requireBefore = false, minScanMs = 2000, p95Max = 50,
  pollMs = 250, giveUpMs = 120_000, now = Date.now, wait = sleep, repeatUntilMinScan = false,
}) {
  const before = await getMeta(null);
  const sampler = await startSampler();
  let stopped = false;
  try {
    await wait(1000); // a second of baseline requests first, so the sampler is demonstrably alive
    const start = now();
    await trigger();
    /* A scan that is fast enough to pass has a window shorter than minScanMs, which would read as INCONCLUSIVE and
       so could never pass. `repeatUntilMinScan` keeps triggering back-to-back (each trigger a real rescan) until the
       window is long enough to prove something; every failure rule still applies over the whole window. */
    if (repeatUntilMinScan) while (now() - start < minScanMs) await trigger();
    let end = now();
    let meta = await getMeta(before?.etag ?? null);
    let latest = meta && !meta.unchanged ? meta : null;
    const giveUp = now() + giveUpMs;
    while (!(latest && latest.nodes > 0 && latest.scannedAt !== (before?.scannedAt ?? undefined)) && now() < giveUp) {
      await wait(pollMs);
      meta = await getMeta(before?.etag ?? null);
      if (meta && !meta.unchanged) latest = meta;
      end = now();
    }
    await wait(500);
    const res = await sampler.stop();
    stopped = true;
    const scanMs = end - start;
    const scanProblem = scanProblemOf({
      scanMs, nodes: latest?.nodes ?? 0, scannedAtBefore: before?.scannedAt ?? null, scannedAtAfter: latest?.scannedAt ?? null,
      minScanMs, startedAtMs: start, requireBefore,
    });
    const j = judgeWindow({ samples: res.samples, skippedAt: res.skippedAt, start, end, p95Max, scanProblem });
    const idle = res.samples.filter(([sent, , st]) => sent < start - 100 && st === 'ok').map((x) => x[1]);
    return { path: label, scanMs, nodes: latest?.nodes ?? 0, ...j, idleP95: percentile(idle, 0.95) };
  } finally {
    if (!stopped) await sampler.kill();
  }
}

/* ── the status bench's window plumbing, here so the tests can reach it ──── */

/**
 * The attached graph's identity, cheaply: a conditional GET of /archgraph.json with the ETag from before the
 * trigger. 304 while the graph is unchanged (no body); the full graph once it differs. null: nothing attached.
 * (/api/status carries no scannedAt, so the engine's own ETag/304 on the graph is the cheapest signal.)
 */
export async function graphMeta(base, etag) {
  try {
    const r = await fetch(`${base}/archgraph.json`, etag ? { headers: { 'if-none-match': etag } } : undefined);
    if (r.status === 304) return { unchanged: true };
    if (!r.ok) { await r.arrayBuffer(); return null; }
    const g = await r.json();
    return { scannedAt: g.scannedAt ?? null, nodes: Array.isArray(g.nodes) ? g.nodes.length : 0, etag: r.headers.get('etag') };
  } catch { return null; }
}

/** One measured window against `base`: runWindow wired to graphMeta. `startSampler` is injected. */
export const measureWindow = ({ label, base, requireBefore, trigger, startSampler, minScanMs, p95Max, ...rest }) => runWindow({
  label, startSampler, getMeta: (etag) => graphMeta(base, etag), trigger, requireBefore, minScanMs, p95Max, ...rest,
});

/** Wait up to `ms` for CPU < 2 % for 4 s over the live samples. Returns whether it settled; false on timeout. */
export async function settleWithin(sampler, ms = 90_000, { now = Date.now, wait = sleep, pollMs = 500 } = {}) {
  const t = now();
  while (now() - t < ms) {
    if (detectSettle(sampler.samples.slice(-24), { holdMs: 4000 }).settled) return true;
    await wait(pollMs);
  }
  return false;
}
