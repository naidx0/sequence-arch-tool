/**
 * H5 — the launcher must notice a dependency it has not installed yet.
 *
 * Owner, twice, two different packages, same failure:
 *   session 1 — `./start.sh` died because `@fontsource-variable/inter` was declared
 *               in package.json and absent from node_modules
 *   session 2 — `pnpm --filter @sequence/web build` died in 4.5s because
 *               `@fontsource/jetbrains-mono`, added in 7605ce1a, had been pulled but
 *               never installed
 *
 * Both times `node_modules/` EXISTED, so the launcher's `[ ! -d node_modules ]` guard
 * passed and the build ran against an incomplete tree. Both times the error named
 * `tsc -p tsconfig.json --noEmit && vite build` — the one thing that was not wrong —
 * and said nothing about a missing package.
 *
 * The sharp part: `start.sh` had ALREADY learned this exact lesson for the build
 * output, and documents it in its own comments ("Missing-only was a trap: after
 * `git pull` the dist was still there, just stale"). The same reasoning was never
 * applied to node_modules, so the identical bug sat one step earlier in the same file.
 *
 * pnpm rewrites `node_modules/.modules.yaml` on every install, so a manifest newer
 * than that marker means the installed tree is behind what the repo declares. Same
 * timestamp trick the build check already uses.
 *
 * This test asserts the SHAPE of the check, not its exact text, so the script can be
 * rewritten freely as long as it still compares manifests against the install marker
 * rather than testing for a directory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const START = readFileSync(
  fileURLToPath(new URL('../../start.sh', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');
/** Comments stripped — an absence assertion must not match the prose explaining it. */
const CODE = START.split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

function manifestPattern(manifest) {
  return new RegExp(manifest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('the launcher compares manifests against the install marker', () => {
  assert.match(
    CODE,
    /node_modules\/\.modules\.yaml/,
    'start.sh must consult pnpm’s install marker; a directory existing proves nothing about ' +
      'whether the tree matches package.json',
  );
  assert.match(
    CODE,
    /-newer\s+node_modules\/\.modules\.yaml/,
    'the marker must be used as a TIMESTAMP baseline, not merely tested for existence',
  );
});

test('every manifest that can add a dependency is watched', () => {
  // A workspace repo can grow a dep in any package. Watching only the root would
  // have missed BOTH real failures, which were in packages/web/package.json.
  for (const manifest of ['package.json', 'packages/*/package.json', 'pnpm-lock.yaml']) {
    assert.match(
      CODE,
      manifestPattern(manifest),
      `${manifest} must be part of the staleness check`,
    );
  }
});

test('manifest watch patterns treat punctuation literally', () => {
  assert.doesNotMatch('pnpm-lockXyaml', manifestPattern('pnpm-lock.yaml'));
});

test('the check still installs on a genuinely fresh clone', () => {
  // The new logic must not lose the original case it did handle correctly.
  assert.match(CODE, /!\s*-d\s+node_modules/, 'first-run install path must survive');
});

test('the reason is reported, not swallowed', () => {
  // "installing dependencies (first run only)" was actively misleading on a pull:
  // it was neither the first run, nor was the reason first-run. A launcher that
  // explains itself is the difference between a 4.5s mystery and a one-line fix.
  assert.match(CODE, /install_reason/, 'the trigger must be named in the output');
  assert.ok(
    !/installing dependencies \(first run only\)/.test(CODE),
    'the old unconditional "first run only" wording lies on every non-first run',
  );
});
