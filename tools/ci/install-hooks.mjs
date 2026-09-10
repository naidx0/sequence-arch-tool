#!/usr/bin/env node
/**
 * INSTALL THE PRE-PUSH GATE INTO THIS CHECKOUT.
 *
 *   node tools/ci/install-hooks.mjs            # install
 *   node tools/ci/install-hooks.mjs --status   # say what is installed
 *   node tools/ci/install-hooks.mjs --remove   # take it out again
 *
 * `.git/hooks/` is not version-controlled, so this is a local change to one
 * machine's checkout rather than something a clone inherits. That is stated
 * plainly because installing it changes what `git push` does for **everyone who
 * uses this working copy**, and a tool that quietly rewires somebody's git is a
 * tool that gets distrusted.
 *
 * The hook it writes is three lines. Everything that decides anything lives in
 * `tools/ci/pre-push.mjs`, in the repository, where it can be read, tested and
 * reviewed — a hook whose logic is only in `.git/` is logic nobody reviews.
 *
 * `--remove` exists and is named in the install message. Reversibility is not a
 * courtesy here: a gate that adds ~80 s to every push must be removable by the
 * person it inconveniences, or it will be bypassed instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const gitDir = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: REPO, encoding: 'utf8' })
  .stdout?.trim();
if (!gitDir) {
  console.error('install-hooks: not a git checkout');
  process.exit(2);
}
const HOOK = path.resolve(REPO, gitDir, 'hooks', 'pre-push');

/* A shim, not a program. `exec` so the hook's exit code is the script's. */
const BODY = `#!/bin/sh
# Installed by tools/ci/install-hooks.mjs. The logic is in the repository:
# tools/ci/pre-push.mjs — read it there, not here.
exec node "$(git rev-parse --show-toplevel)/tools/ci/pre-push.mjs"
`;

const mode = process.argv[2] ?? '--install';

if (mode === '--status') {
  if (!fs.existsSync(HOOK)) {
    console.log('pre-push: NOT installed — a push runs no gate on this checkout.');
    process.exit(1);
  }
  const cur = fs.readFileSync(HOOK, 'utf8');
  const ours = cur.includes('tools/ci/pre-push.mjs');
  console.log(`pre-push: installed at ${path.relative(REPO, HOOK)}${ours ? '' : ' — but it is NOT ours'}`);
  process.exit(ours ? 0 : 1);
}

if (mode === '--remove') {
  if (fs.existsSync(HOOK)) {
    fs.rmSync(HOOK);
    console.log('pre-push: removed. `git push` no longer runs the gate on this checkout.');
  } else {
    console.log('pre-push: nothing installed');
  }
  process.exit(0);
}

/*
 * A HOOK THAT IS ALREADY THERE AND IS NOT OURS IS NOT OVERWRITTEN.
 * Somebody else's hook is somebody else's decision, and clobbering it silently
 * is the kind of help nobody asked for.
 */
if (fs.existsSync(HOOK)) {
  const cur = fs.readFileSync(HOOK, 'utf8');
  if (!cur.includes('tools/ci/pre-push.mjs')) {
    console.error(`install-hooks: REFUSED — a different pre-push hook is already installed at`);
    console.error(`  ${HOOK}`);
    console.error('Move it aside yourself if you want this one.');
    process.exit(2);
  }
}

fs.mkdirSync(path.dirname(HOOK), { recursive: true });
fs.writeFileSync(HOOK, BODY);
try {
  fs.chmodSync(HOOK, 0o755);
} catch {
  /* Windows ignores the mode; git for windows runs the shim through sh anyway. */
}
console.log(`pre-push installed: ${path.relative(REPO, HOOK)}`);
console.log('  every `git push` from this checkout now runs the counting gate (~80s) first.');
console.log('  `git push --no-verify` skips it, by git\'s design, and this does not fight that.');
console.log('  remove it with: node tools/ci/install-hooks.mjs --remove');
