/**
 * THE PRE-PUSH SCOPE RULE, made to fail.
 *
 * Built from the reported shape: on 2026-09-09 a docs-only push from the
 * Sequence lane was refused because CODEFORGE DESIGN had canvas files modified
 * in the same tree. The guard was right about the property it was written for
 * and wrong about its scope.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { dirtyFilesInPush, isWipOnlyPush, pathOfStatusLine } from './lib/push-scope.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const HOOK = fs.readFileSync(path.join(HERE, 'pre-push.mjs'), 'utf8');

/* The exact status lines and push contents of the refusal that prompted this. */
const OTHER_LANE = [
  ' M packages/web2/package.json',
  ' M packages/web2/src/app/AiCanvas.test.tsx',
  ' M packages/web2/src/app/AiCanvasBlockBody.tsx',
  ' M pnpm-lock.yaml',
];
const MY_PUSH = ['docs/research/teach-mode-driven-end-to-end.md'];

test('THE REPORTED SHAPE: another lane’s dirty files do not block a docs-only push', () => {
  assert.deepEqual(dirtyFilesInPush(OTHER_LANE, MY_PUSH), []);
});

test('a file that IS in the push and is dirty still refuses — the 2026-09-07 failure', () => {
  /*
   * origin went red because a committed test asserted a two-symbol import while
   * the fix sat uncommitted in the tree. That is the case this guard exists for
   * and it must survive the narrowing.
   */
  const dirty = [' M tools/ci/teach-eval-artefacts.test.mjs', ' M packages/web2/package.json'];
  const push = ['tools/ci/teach-eval-artefacts.test.mjs', 'tools/bench/teach-eval.mjs'];
  const blocked = dirtyFilesInPush(dirty, push);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], /teach-eval-artefacts\.test\.mjs/);
});

test('a rename is matched on its DESTINATION, which is what the push carries', () => {
  const line = 'R  packages/analyzer/src/old.ts -> packages/analyzer/src/new.ts';
  assert.equal(pathOfStatusLine(line), 'packages/analyzer/src/new.ts');
  assert.equal(dirtyFilesInPush([line], ['packages/analyzer/src/new.ts']).length, 1);
  assert.equal(dirtyFilesInPush([line], ['packages/analyzer/src/old.ts']).length, 0);
});

test('staged-but-modified (MM) is still caught when the file is in the push', () => {
  assert.equal(dirtyFilesInPush(['MM docs/BACKLOG.md'], ['docs/BACKLOG.md']).length, 1);
});

test('the hook CALLS the rule rather than restating it', () => {
  /* A rule in two handlers is one rule until measured. */
  assert.match(HOOK, /from '\.\/lib\/push-scope\.mjs'/);
  assert.match(HOOK, /dirtyFilesInPush\(/);
  assert.doesNotMatch(
    HOOK,
    /const dirty = dirtyAll\.filter\(\(l\) => pushed\.has\(pathOf\(l\)\)\)/,
    'the scope rule was re-inlined; the exported one is now a second copy',
  );
});

/* The lines git writes to a pre-push hook's stdin: <local ref> <local sha> <remote ref> <remote sha>. */
const SHA = 'a'.repeat(40);
const ZERO = '0'.repeat(40);
const pushLine = (remoteRef) => `refs/heads/x ${SHA} ${remoteRef} ${ZERO}`;

test('a push of only wip/* branches skips the gate (owner ruling 2026-10-08)', () => {
  assert.equal(isWipOnlyPush(pushLine('refs/heads/wip/gpt-styles') + '\n'), true);
  assert.equal(
    isWipOnlyPush([pushLine('refs/heads/wip/a'), pushLine('refs/heads/wip/b/c')].join('\r\n')),
    true,
  );
  assert.equal(isWipOnlyPush(`(delete) ${ZERO} refs/heads/wip/old ${SHA}`), true, 'deleting a wip branch');
});

test('anything that is not wip/* still runs the gate', () => {
  assert.equal(isWipOnlyPush(pushLine('refs/heads/main')), false);
  assert.equal(isWipOnlyPush([pushLine('refs/heads/wip/a'), pushLine('refs/heads/main')].join('\n')), false);
  assert.equal(isWipOnlyPush(pushLine('refs/heads/wipe')), false, 'a prefix match is not wip/');
  assert.equal(isWipOnlyPush(pushLine('refs/heads/feature/wip/x')), false);
  assert.equal(isWipOnlyPush(pushLine('refs/tags/wip/x')), false);
  assert.equal(isWipOnlyPush(''), false, 'no ref lines: gate as before');
  assert.equal(isWipOnlyPush(undefined), false);
});

test('the hook asks isWipOnlyPush before any other check', () => {
  assert.match(HOOK, /readFileSync\(0, 'utf8'\)/);
  assert.match(HOOK, /isWipOnlyPush\(refLines\)/);
  assert.ok(HOOK.indexOf('isWipOnlyPush(refLines)') < HOOK.indexOf('isRunArtifact(c.file)'));
  assert.ok(HOOK.indexOf('isWipOnlyPush(refLines)') < HOOK.indexOf("'counting-gate.mjs'"));
});
