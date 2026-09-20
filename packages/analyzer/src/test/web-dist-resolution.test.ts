/**
 * The launcher lane's lock: findWebDist must resolve the v2 bundle.
 *
 * v1 (`packages/web`) was deleted on 2026-08-20 and replaced by
 * `packages/web2`. The source cutover happened; this resolver's did not, so
 * `pnpm app` / `createRepoServer` kept pointing at `../web/dist`. On a machine
 * that had ever run v1 the gitignored `packages/web/dist` was still on disk, so
 * the analyzer happily served the OLD UI and it read as "the redesign did not
 * ship". On a clean machine it resolved nothing and served an empty page.
 *
 * Both failure modes are one string. This test is that string, in both copies
 * of the resolver — `serve.ts` (legacy serveGraph) and `server/static.ts` (the
 * repo server) — plus the launcher that stamps freshness against the same dist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { findWebDist } from '../server/static.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('both findWebDist copies resolve web2, never the deleted web', () => {
  for (const rel of ['packages/analyzer/src/serve.ts', 'packages/analyzer/src/server/static.ts']) {
    const src = read(rel);
    assert.match(src, /'\.\.', 'web2', 'dist'/, `${rel}: package-relative guess must be web2`);
    assert.match(src, /'packages', 'web2', 'dist'/, `${rel}: cwd fallback must be web2`);
    assert.doesNotMatch(src, /'\.\.', 'web', 'dist'/, `${rel}: still resolves the deleted v1 dist`);
    assert.doesNotMatch(src, /'packages', 'web', 'dist'/, `${rel}: still resolves the deleted v1 dist`);
  }
});

test('findWebDist returns the web2 dist when one is built, and never a v1 dist', () => {
  const resolved = findWebDist();
  if (resolved === undefined) return; // nothing built on this machine — nothing to assert
  const norm = resolved.split(path.sep).join('/');
  assert.ok(norm.endsWith('/web2/dist'), `resolved ${norm}, want a .../web2/dist path`);
  assert.ok(!/\/web\/dist$/.test(norm), `resolved the deleted v1 dist: ${norm}`);
});

test('start.sh installs, stamps and builds against web2', () => {
  const sh = read('start.sh');
  assert.match(sh, /packages\/web2\/node_modules/, 'dependency check must look at web2');
  assert.match(sh, /packages\/web2\/dist\/index\.html/, 'freshness stamp must be the web2 bundle');
  assert.doesNotMatch(
    sh,
    /!\s*-f packages\/web\/dist\/index\.html/,
    'start.sh still stamps freshness against the deleted v1 dist',
  );
  assert.doesNotMatch(
    sh,
    /-newer packages\/web\/dist\/index\.html/,
    'start.sh still compares source against the deleted v1 dist',
  );
  assert.doesNotMatch(
    sh,
    /-d packages\/web\/node_modules/,
    'start.sh still requires the deleted v1 node_modules',
  );
});

/*
 * THE RESOLVER MUST WORK FROM SOMEBODY ELSE'S DIRECTORY.
 *
 * `sequence` is a CLI. Its documented use is `cd ~/my-project && sequence --repo .`, so the working
 * directory at run time belongs to the USER, not to this monorepo. Both tests above missed that:
 * one greps the source for a string, and the other returns early when the resolver finds nothing -
 * passing silently in exactly the case where the resolver is broken.
 *
 * Resolution must therefore be anchored to where this MODULE lives, never to `process.cwd()`.
 * cwd is set by the caller and is the one thing a CLI cannot assume.
 *
 * Run in a child process with a foreign cwd, because `process.chdir()` would leak into every other
 * test in this file.
 */
test('findWebDist resolves the viewer from a working directory that is not this repo', () => {
  // NOT `if (findWebDist() === undefined) return`. That guard is what makes the test above
  // unable to fail: it returns early in precisely the case the resolver is broken. An absent
  // build is a reason this test cannot run, so say that out loud rather than reporting a pass.
  const index = path.join(REPO, 'packages', 'web2', 'dist', 'index.html');
  assert.ok(fs.existsSync(index), 'web2 is not built - run `pnpm -r build` before this suite');

  const staticJs = pathToFileURL(path.join(REPO, 'packages/analyzer/dist/server/static.js')).href;
  const probe = `import { findWebDist } from ${JSON.stringify(staticJs)};
    process.stdout.write(String(findWebDist()));`;

  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-cwd-'));
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: elsewhere,
      encoding: 'utf8',
    });
    assert.notEqual(
      out,
      'undefined',
      'the CLI serves {"error":"web viewer not built"} when run from a user\'s own project',
    );
    assert.ok(
      out.split(path.sep).join('/').endsWith('/web2/dist'),
      `resolved ${out} from a foreign cwd, want a .../web2/dist path`,
    );
  } finally {
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
