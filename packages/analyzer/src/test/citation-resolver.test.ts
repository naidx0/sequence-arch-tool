import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { auditCitations, resolveCitation } from '../moat/citationResolver.js';

/**
 * THE KILL CRITERION, AND THE TEST THAT KILLS THE LAZY VERSION.
 *
 * A resolver that cannot separate "never existed anywhere" from a rename is an
 * elaborate way of confirming that most cited paths exist, which was never in
 * doubt. Two tests decide whether this instrument measures anything:
 *
 *   1. A PLANTED FABRICATION must come back `fabricated`.
 *   2. A path that exists ONLY IN HISTORY must come back `history`, never
 *      `fabricated` — otherwise every rename reads as a lie and the accusation
 *      is noise.
 *
 * The prior audit's three runs each found a RESOLVER defect before an agent one,
 * which is why these are the first tests written.
 */

function scratchRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cite-'));
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
  run('init', '-q');
  run('config', 'user.email', 'test@example.invalid');
  run('config', 'user.name', 'test');
  fs.mkdirSync(path.join(root, 'packages', 'acp', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'acp', 'src', 'index.ts'), 'export const a = 1;\n');
  /* In a directory, deliberately: a path with no slash is a BARE NAME by the
     resolver's own rule, so a root-level fixture would test the wrong class. */
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'gone.ts'), 'export const gone = 1;\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  /* Delete it in a SECOND commit, so it exists in history and not on disk. */
  fs.rmSync(path.join(root, 'src', 'gone.ts'));
  run('add', '-A');
  run('commit', '-q', '-m', 'remove gone.ts');
  return root;
}

test('THE KILL CRITERION — a planted fabrication is called fabricated', () => {
  const root = scratchRepo();
  const r = resolveCitation(root, 'packages/acp/src/never-existed.ts');
  assert.equal(r.verdict, 'fabricated');
  assert.equal(r.counted, true);
});

test('a path that exists ONLY IN HISTORY is history, never fabricated', () => {
  /*
   * The test that kills the lazy version. Without a history check every renamed
   * or deleted file reads as a fabrication, the residual fills with noise, and
   * the one row that mattered is invisible in it.
   */
  const root = scratchRepo();
  assert.equal(fs.existsSync(path.join(root, 'src', 'gone.ts')), false, 'the fixture must be deleted');
  const r = resolveCitation(root, 'src/gone.ts');
  assert.equal(r.verdict, 'history');
});

test('the package-root form resolves, and says what it resolved to', () => {
  /* An agent working inside packages/acp writes `acp/src/index.ts`. Unambiguous
     to a reader, unresolvable to a naive test -f, and three of six apparent
     misses in the prior audit were exactly this. */
  const root = scratchRepo();
  const r = resolveCitation(root, 'acp/src/index.ts');
  assert.equal(r.verdict, 'package-root');
  assert.equal(r.resolvedAs, 'packages/acp/src/index.ts');
});

test('a BARE FILENAME is not a claim of location and is not counted', () => {
  const root = scratchRepo();
  const r = resolveCitation(root, 'index.ts');
  assert.equal(r.verdict, 'bare-name');
  assert.equal(r.counted, false, 'counting it would invent a claim the agent did not make');
});

test('the summary carries its DENOMINATOR and its commit', () => {
  /*
   * A rate without them is a claim rather than a measurement — the third law,
   * which this instrument exists to serve. The bare filename is excluded from
   * the denominator, so 4 citations yield 3.
   */
  const root = scratchRepo();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const s = auditCitations(
    root,
    ['packages/acp/src/index.ts', 'acp/src/index.ts', 'index.ts', 'packages/acp/src/nope.ts'],
    head,
  );
  assert.equal(s.commit, head);
  assert.equal(s.denominator, 3);
  assert.equal(s.fabricated, 1);
});

test('resolution happens AT THE COMMIT, not against the working tree', () => {
  /*
   * The whole reason the session record pins a SHA. A file added after the
   * pinned commit must not resolve at it — otherwise an audit of an old session
   * silently grades against today's tree and every later addition reads as
   * something the agent could have seen.
   */
  const root = scratchRepo();
  const first = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  fs.writeFileSync(path.join(root, 'src', 'added-later.ts'), 'export const later = 1;\n');
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'later'], { cwd: root, stdio: 'ignore' });

  /* On disk now, and in history — but NOT at the first commit. */
  assert.equal(resolveCitation(root, 'src/added-later.ts', first).verdict, 'history');
});
