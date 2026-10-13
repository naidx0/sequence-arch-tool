/*
 * The sealed task set: every directory under tasks/ is one task.
 *
 *   tNN-slug/task.json   { id, prompt, test: { cmd, args }, protect: [paths restored before scoring] }
 *   tNN-slug/repo/       what the agent gets (a failing test, the buggy source)
 *   tNN-slug/solution/   reference files, never copied to the agent; used by the dry run and by the set's own test
 *
 * No network, no dependencies: the task test is `node --test`. The set is sealed by
 * sealHash(): sha256 over sorted "relpath <tab> sha256(LF-normalised bytes)" lines,
 * written to tasks/SEALED.md before any arm runs.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
export const TASKS_DIR = path.join(HERE, 'tasks');
/** Preloaded into every scored run, from here (outside the agent's copy). See guard-preload.mjs. */
export const PRELOAD = path.join(HERE, 'guard-preload.mjs');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const lf = (buf) => Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

export function listTasks(dir = TASKS_DIR) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'task.json')))
    .map((e) => ({ ...JSON.parse(fs.readFileSync(path.join(dir, e.name, 'task.json'), 'utf8')), dir: path.join(dir, e.name) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function walk(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out;
}

export function sealHash(dir = TASKS_DIR) {
  const lines = walk(dir)
    .filter((r) => r !== 'SEALED.md')
    .sort()
    .map((r) => `${r}\t${sha(lf(fs.readFileSync(path.join(dir, r))))}`);
  return sha(Buffer.from(lines.join('\n') + '\n', 'utf8'));
}

export function readSealed(dir = TASKS_DIR) {
  const m = /sha256:\s*`?([0-9a-f]{64})`?/.exec(fs.readFileSync(path.join(dir, 'SEALED.md'), 'utf8'));
  return m ? m[1] : '';
}

export function copyRepo(task, dest) {
  fs.cpSync(path.join(task.dir, 'repo'), dest, { recursive: true });
}

export function applySolution(task, dest) {
  fs.cpSync(path.join(task.dir, 'solution'), dest, { recursive: true });
}

/*
 * What a source file may not contain unless the pristine file already did. These are the ways to make a
 * test run "pass" without fixing anything: end the process early, rebind the assertion library, or reach
 * into the test runner. The count check below is the second line of defence for forms this list misses.
 */
const FORBIDDEN = [
  [/process\s*\.\s*(exit|reallyExit|abort|kill)\b/g, 'process.exit'],
  [/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:node:)?assert(?:\/strict)?['"]/g, 'node:assert'],
  [/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:node:)?test(?:\/[a-z]+)?['"]/g, 'node:test'],
  [/syncBuiltinESMExports|require\.cache|module\.constructor|process\.binding|process\.dlopen/g, 'module-system tampering'],
];
const countMatches = (text, re) => (text.match(re) ?? []).length;
const IGNORED_DIRS = ['.sequence/', 'node_modules/', '.git/'];

/** Files the agent changed or added, judged against the pristine repo: what is outside `editable`, what adds a forbidden construct. */
export function guardViolations(task, dest) {
  const pristineRoot = path.join(task.dir, 'repo');
  const editable = (task.editable ?? []).map((p) => p.replace(/\\/g, '/'));
  const out = [];
  for (const rel of walk(dest)) {
    if (IGNORED_DIRS.some((d) => rel.startsWith(d))) continue;
    const pristine = path.join(pristineRoot, rel);
    const now = fs.readFileSync(path.join(dest, rel));
    const same = fs.existsSync(pristine) && fs.readFileSync(pristine).equals(now);
    if (same) continue;
    if (!editable.some((p) => rel === p || rel.startsWith(p.endsWith('/') ? p : p + '/'))) {
      out.push(`wrote outside the editable paths: ${rel}`);
      continue;
    }
    const before = fs.existsSync(pristine) ? fs.readFileSync(pristine, 'utf8') : '';
    const after = now.toString('utf8');
    for (const [re, label] of FORBIDDEN) {
      if (countMatches(after, re) > countMatches(before, re)) out.push(`${rel} adds ${label}`);
    }
  }
  for (const rel of walk(pristineRoot)) {
    if (!fs.existsSync(path.join(dest, rel)) && !(task.protect ?? []).some((p) => rel.startsWith(p))) out.push(`deleted ${rel}`);
  }
  return out;
}

/** The node:test TAP summary: { pass, fail, cancelled, skipped, todo }. */
export function parseTapCounts(text) {
  const n = (k) => Number(new RegExp(`^# ${k} (\\d+)`, 'm').exec(text)?.[1] ?? NaN);
  return { pass: n('pass'), fail: n('fail'), cancelled: n('cancelled'), skipped: n('skipped'), todo: n('todo') };
}

/** The top-level test names a TAP run reported ok, and any that reported not ok. An early exit reports the FILE as the one test. */
export function parseTapNames(text) {
  const ok = [];
  const notOk = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(not )?ok \d+ - (.+?)(?: # (?:SKIP|TODO).*)?$/.exec(line);
    if (!m) continue;
    (m[1] ? notOk : ok).push(m[2]);
  }
  return { ok, notOk };
}

/** Run the task's test in a fresh process, from outside the agent's copy: guard-preload first, TAP reporter. */
export function runScoredTest(task, dest, timeoutMs = 60_000) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // a nested node --test must run as its own root
  const [first, ...rest] = task.test.args;
  const r = spawnSync(process.execPath, [first, '--import', url.pathToFileURL(PRELOAD).href, '--test-reporter=tap', ...rest], { cwd: dest, encoding: 'utf8', timeout: timeoutMs, env });
  return { r, counts: parseTapCounts(r.stdout ?? ''), names: parseTapNames(r.stdout ?? '') };
}

/**
 * Restore the protected paths, refuse cheats, then run the task's test in a fresh process and score from the
 * reporter's COUNTS: pass iff exit 0, no failed/cancelled/skipped/todo test, and exactly the number of passing
 * tests the reference solution produced (recorded in task.json at seal time). An exit code alone is not a score:
 * process.exit(0) in the source gives exit 0 and zero tests.
 */
export function scoreTask(task, dest, { timeoutMs = 60_000 } = {}) {
  let testsRestored = false;
  for (const p of task.protect ?? []) {
    const abs = path.join(dest, p);
    const pristine = path.join(task.dir, 'repo', p);
    const differs = (() => {
      if (!fs.existsSync(pristine)) return fs.existsSync(abs);
      if (!fs.existsSync(abs)) return true;
      const a = walk(pristine), b = walk(abs);
      return a.join('|') !== b.join('|') || a.some((r) => !fs.readFileSync(path.join(pristine, r)).equals(fs.readFileSync(path.join(abs, r))));
    })();
    if (differs) testsRestored = true;
    fs.rmSync(abs, { recursive: true, force: true });
    if (fs.existsSync(pristine)) fs.cpSync(pristine, abs, { recursive: true });
  }
  const violations = guardViolations(task, dest);
  if (violations.length) return { pass: false, exit: null, timedOut: false, testsRestored, violations, reason: `refused: ${violations.join('; ')}`, counts: null, output: '' };
  const { r, counts, names } = runScoredTest(task, dest, timeoutMs);
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const expected = task.expect?.pass;
  const wantNames = [...(task.expect?.tests ?? [])].sort();
  let reason = null;
  if (r.error?.code === 'ETIMEDOUT') reason = 'timed out';
  else if (r.status !== 0) reason = `exit ${r.status}`;
  else if (![counts.pass, counts.fail].every(Number.isFinite)) reason = 'no test summary: no tests ran';
  else if (counts.fail > 0 || counts.cancelled > 0 || counts.skipped > 0 || counts.todo > 0) reason = `failed/cancelled/skipped tests: ${JSON.stringify(counts)}`;
  else if (counts.pass !== expected) reason = `pass count ${counts.pass} != expected ${expected}`;
  else if (names.notOk.length) reason = `tests reported not ok: ${names.notOk.join(', ')}`;
  else if (JSON.stringify([...names.ok].sort()) !== JSON.stringify(wantNames)) reason = `the tests that ran (${names.ok.join(', ') || 'none'}) are not the reference tests (${wantNames.join(', ')})`;
  return { pass: reason === null, exit: r.status, timedOut: r.error?.code === 'ETIMEDOUT', testsRestored, violations: [], reason, counts, output: output.slice(-2000) };
}
