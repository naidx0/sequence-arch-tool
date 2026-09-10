#!/usr/bin/env node
/**
 * THE ONLY PUSH — it runs the gate itself and reads nothing but exit codes.
 *
 *   pnpm push        # gate, then push
 *   pnpm push --dry  # gate, report, push nothing
 *
 * ── THE PUSH THIS EXISTS BECAUSE OF ───────────────────────────────────────
 *
 * `d35da058` put a scanner regression on main: `facts.ts` was reverted in the
 * working tree for a bench arm, `git add -A` swept it into the commit, and the
 * push went out. Between that commit and its revert, every scan in this
 * repository was missing one dependency edge in eleven.
 *
 * The test that would have caught it already existed and works —
 * `reexport-edges.test.js` fails 2 of 4 against the old scanner, verified by
 * putting the old scanner back and running it. **So the test was not the
 * problem. The gate did not run.** There was no build, no test and no counting
 * gate between the commit and the push; the push was typed.
 *
 * A gate that has to be remembered is a gate that will be forgotten — the same
 * sentence that produced `restart:app`, and the same failure one layer up. So
 * the gate stops being a thing you run before pushing and becomes the thing that
 * pushes.
 *
 * ── EXIT CODES, NEVER OUTPUT ──────────────────────────────────────────────
 *
 * Every step is judged by its exit status alone. A runner that prints "all
 * passing" and returns non-zero is refused; a `grep && push` has no path left,
 * because this script is the push and it runs the gate itself. Reading a
 * runner's text is how a red run gets pushed, and this repository has three of
 * those on record from one day.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[push]', ...a);

/*
 * `pnpm` HERE IS A WINDOWS SHIM AND NEEDS A SHELL. Measured on this machine:
 * `spawnSync('pnpm')` gives ENOENT, `spawnSync('pnpm.cmd')` gives EINVAL, and
 * only `shell: true` runs it. The first two runs of this script reported
 * `FAILED exit signal null (0s)` for the build because the binary never started.
 *
 * It failed CLOSED and pushed nothing, which is the right direction for a bug in
 * a gate — but a gate that cannot run its own steps always says red, and a gate
 * that always says red is a gate people route around.
 *
 * `shell: true` concatenates rather than escapes its arguments. That is a real
 * hazard when arguments come from outside; here every one is a fixed literal in
 * the `steps` table below, and nothing from a user, a file or the network
 * reaches it.
 */
function step(name, cmd, args, useShell = false) {
  const started = Date.now();
  process.stdout.write(`[push] ${name} ... `);
  const r = spawnSync(cmd, args, { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'], shell: useShell });
  const s = ((Date.now() - started) / 1000).toFixed(0);
  const ok = r.status === 0;
  console.log(ok ? `ok (${s}s)` : `FAILED exit ${r.status ?? 'signal ' + r.signal} (${s}s)`);
  return ok;
}

const git = (args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }).stdout?.trim() ?? '';

/*
 * ── WHAT IS ABOUT TO BE PUSHED, SHOWN BEFORE IT IS ────────────────────────
 *
 * The regression was invisible in the commit message, which described the
 * working tree instead of the diff. Naming the files that are actually leaving
 * makes the same mistake visible before the push rather than after.
 */
const upstream = git(['rev-parse', '--abbrev-ref', '@{u}']) || 'origin/main';
const range = `${upstream}..HEAD`;
const commits = git(['log', '--oneline', range]).split('\n').filter(Boolean);
const files = git(['diff', '--name-only', range]).split('\n').filter(Boolean);

if (commits.length === 0) {
  log('nothing to push');
  process.exit(0);
}
log(`${commits.length} commit(s), ${files.length} file(s) against ${upstream}:`);
for (const c of commits) console.log(`    ${c}`);
/* Source files under packages/ are the ones a bench arm's revert hides in. */
const src = files.filter((f) => f.startsWith('packages/') && /\.(ts|tsx|mjs|js)$/.test(f));
if (src.length > 0) {
  console.log(`  product source in this push (${src.length}):`);
  for (const f of src.slice(0, 12)) console.log(`    ${f}`);
  if (src.length > 12) console.log(`    ... and ${src.length - 12} more`);
}

/*
 * A dirty tree means what is tested is not what was written down.
 *
 * TRACKED CHANGES ONLY (`--untracked-files=no`). The hazard is a tracked file
 * modified out from under the commit — a bench arm's revert of `facts.ts` is
 * exactly that. An untracked scratch file is not that hazard, and refusing on
 * one would make the gate cry wolf on an ordinary working directory, which is
 * how a gate stops being run.
 */
const dirty = git(['status', '--porcelain', '--untracked-files=no']);
if (dirty !== '') {
  console.error(`\n[push] REFUSED — the working tree is dirty:\n${dirty}\n`);
  console.error('[push] Commit or restore it. The gate tests HEAD, and a dirty tree means the');
  console.error('[push] thing you tested is not the thing you are pushing.');
  process.exit(2);
}

console.log('');
const steps = [
  ['build            ', 'pnpm', ['-r', 'build'], true],
  ['hygiene tests    ', 'node', ['--test', 'tools/ci/*.test.mjs']],
  ['counting gate    ', 'node', ['tools/ci/counting-gate.mjs']],
];
for (const [name, cmd, args, useShell] of steps) {
  if (!step(name, cmd, args, useShell === true)) {
    console.error('\n[push] RED — nothing was pushed.');
    process.exit(1);
  }
}

console.log('');
if (DRY) {
  log('green. --dry, so nothing was pushed.');
  process.exit(0);
}
const pushed = spawnSync('git', ['push'], { cwd: REPO, stdio: 'inherit' });
process.exit(pushed.status ?? 0);
