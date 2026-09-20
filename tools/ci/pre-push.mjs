#!/usr/bin/env node
/**
 * THE PRE-PUSH GATE — the logic behind `.git/hooks/pre-push`.
 *
 * Installed by `node tools/ci/install-hooks.mjs`; the hook itself is a three-line
 * shim so that everything reviewable lives in the repository and can be run and
 * tested on its own:
 *
 *   node tools/ci/pre-push.mjs          # exactly what the hook runs
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────
 *
 * `d35da058` put a scanner regression on main. The test that would have caught
 * it existed and worked; the gate simply did not run, because the push was
 * typed. `pnpm push` fixed that for anyone who remembers to type `pnpm push` —
 * which is the same class of promise that failed the first time.
 *
 * A hook is not a promise. `git push` itself now runs the gate.
 *
 * ── WHAT IT REFUSES ───────────────────────────────────────────────────────
 *
 *   1. anything but a green counting gate (exit 0), read as an exit code;
 *   2. a push carrying RUN ARTIFACTS — a file under a `out/` directory that is
 *      written by a test or a bench. `git add -A` over a working tree that a
 *      test has just rewritten is how two artifacts and one scanner regression
 *      reached commits tonight, and an artifact in a push is the visible edge of
 *      that mistake.
 *
 * ── WHAT IT IS NOT ────────────────────────────────────────────────────────
 *
 * It is NOT unbypassable, and saying otherwise would be a false claim about
 * this machine. `git push --no-verify` skips every hook by design, and that is
 * git's decision, not something to fight: a repository owner who cannot get past
 * their own tooling in an emergency will remove the tooling. The hook makes the
 * gate the DEFAULT. Bypassing it becomes a deliberate act with a name.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

import { dirtyFilesInPush } from './lib/push-scope.mjs';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const git = (args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }).stdout?.trim() ?? '';
const log = (...a) => console.error('[pre-push]', ...a);

/** Files a run writes: anything under an `out/` directory in tools/. */
const isRunArtifact = (f) => /^tools\/[^/]+\/out\//.test(f) || /^tools\/[^/]+\/[^/]+\/out\//.test(f);

const upstream = git(['rev-parse', '--abbrev-ref', '@{u}']) || 'origin/main';
const range = `${upstream}..HEAD`;
const changes = git(['diff', '--name-status', range])
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const parts = l.split('\t');
    return { status: parts[0][0], file: parts[parts.length - 1] };
  });
const files = changes.map((c) => c.file);

if (files.length === 0 && git(['log', '--oneline', range]) === '') {
  /* Nothing new; a push of an already-pushed ref should not pay for a gate. */
  process.exit(0);
}

/*
 * ADDED OR MODIFIED, NOT DELETED.
 *
 * The first version filtered every changed path and so refused the very commit
 * that UNTRACKS an artifact — the fix its own message recommends. A gate that
 * blocks its own remedy is a gate that gets bypassed, which is worse than no
 * gate. A deletion is the cure, and passes.
 */
const artifacts = changes.filter((c) => c.status !== 'D' && isRunArtifact(c.file)).map((c) => c.file);
if (artifacts.length > 0) {
  log('REFUSED — this push carries run artifacts:');
  for (const f of artifacts) log(`    ${f}`);
  log('');
  log('These are written by tests and benches. `git add -A` over a tree a test has');
  log('just rewritten is how a scanner regression reached main tonight; an artifact');
  log('in a push is the visible edge of that mistake.');
  log('Drop them from the commit, or untrack and ignore them.');
  process.exit(2);
}

/*
 * SCOPED TO THE FILES BEING PUSHED — 2026-09-09.
 *
 * The first version refused on ANY modified tracked file, which assumed one
 * lane per tree. Two lanes now share this one: a docs-only push was refused
 * because another lane had `packages/web2` canvas work in flight. The three
 * ways out were all wrong — committing another lane's files, stashing work out
 * from under a running session, or `--no-verify` past the gate that proves the
 * push is green.
 *
 * The property this guard exists for is narrower than "the tree is clean": it is
 * that **the gate's verdict transfers to the commits being pushed**. A file that
 * is not in the push cannot make the pushed commits differ from what was tested.
 * A file that IS in the push and is also dirty is exactly the 2026-09-07 failure
 * — origin went red while the fix sat uncommitted — and still refuses.
 *
 * The counting gate below still runs over the whole tree, so another lane's
 * broken work in progress still stops this push. That is deliberate: never push
 * red is about the tree, and this check is about scope.
 */
const dirtyAll = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
  cwd: REPO,
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l !== '');
const dirty = dirtyFilesInPush(dirtyAll, files);
if (dirtyAll.length > 0 && dirty.length === 0) {
  log(
    `note: ${dirtyAll.length} tracked file(s) are modified but none is in this push — not this ` +
      "push's problem, so the scope check passes. The counting gate still runs over the tree.",
  );
}
if (dirty.length > 0) {
  log('REFUSED — a file in THIS PUSH also differs from HEAD, so the gate would certify a tree that');
  log('is not what you are pushing. This is how origin went red on 2026-09-07 with a green hook.');
  log('');
  for (const d of dirty.slice(0, 20)) log(`    ${d}`);
  if (dirty.length > 20) log(`    …and ${dirty.length - 20} more`);
  log('');
  log('Commit them, or `git stash --keep-index` them, then push again.');
  process.exit(3);
}

log(`gating ${files.length} file(s) against ${upstream} — counting gate, this takes ~80s`);
const gate = spawnSync(process.execPath, [path.join(REPO, 'tools', 'ci', 'counting-gate.mjs')], {
  cwd: REPO,
  stdio: ['ignore', 'ignore', 'inherit'],
});
/*
 * THE EXIT CODE, AND ONLY THAT. A runner that prints "all passing" and returns
 * non-zero is refused. Reading a runner's text is how a red run gets pushed.
 */
if (gate.status !== 0) {
  log(`REFUSED — the counting gate exited ${gate.status ?? 'on a signal'}.`);
  log('0 is green, 1 is a failing test, 2 is a file discovered that did not run.');
  log('Nothing was pushed. `git push --no-verify` bypasses this deliberately.');
  process.exit(1);
}
log('green — pushing');
