import assert from 'node:assert/strict';
import test from 'node:test';

import { argvAfterCli, isScanning, rootOfStatus, sameDir, waitForScan } from './restart-if-stale.mjs';

/**
 * THE RESTART MUST BRING BACK THE SAME SERVER.
 *
 * A restart that changes the port, or the repository served, is worse than the
 * stale server it replaced: the reader still gets a wrong answer, and now also
 * has no reason to suspect one. Both halves of "the same server" are checked
 * here — the arguments it is relaunched with, and the identity test that decides
 * whether it may be killed at all.
 */
test('the arguments survive an interpreter path with spaces — and without', () => {
  /*
   * THE BUG THIS TEST EXISTS FOR.
   *
   * The first version read the argv as `cmd.split(' ').slice(2)`, which is right
   * only when the interpreter path is exactly two space-separated tokens. It was,
   * on the one machine it ran on: `"C:\Program Files\nodejs\node.exe"`. On a node
   * without a space in its path the same line drops the `app` subcommand, and the
   * "restart" relaunches the server into a usage error and exits — leaving no
   * server at all where a stale one used to be.
   *
   * Both rows below are the SAME server. Anything that returns different
   * arguments for them is the bug coming back.
   */
  const want = ['app', '--repo', '.', '--port', '4173'];
  const withSpaces = '"C:\\Program Files\\nodejs\\node.exe" packages/analyzer/dist/cli.js app --repo . --port 4173';
  const withoutSpaces = 'C:\\nodejs\\node.exe packages/analyzer/dist/cli.js app --repo . --port 4173';
  assert.deepStrictEqual(argvAfterCli(withSpaces), want);
  assert.deepStrictEqual(argvAfterCli(withoutSpaces), want);
  /* And on a POSIX box, where the interpreter is one token with no drive. */
  assert.deepStrictEqual(
    argvAfterCli('/usr/bin/node /srv/sequence/packages/analyzer/dist/cli.js app --repo . --port 4173'),
    want,
  );
});

test('an unreadable command line yields null, not a guess', () => {
  /* The caller declines to touch a process it cannot read. Returning `[]` here
     would have relaunched the CLI with no subcommand at all, which is the same
     failure wearing a nicer type. */
  assert.strictEqual(argvAfterCli('some-other-server --port 4173'), null);
  assert.strictEqual(argvAfterCli('node cli.js'), null);
  assert.strictEqual(argvAfterCli(''), null);
});

test('the identity test ignores separators and drive-letter case', () => {
  /*
   * `/api/status` reports a Windows path with backslashes; `path.resolve` in the
   * script produces whatever this process was started with, and the drive letter
   * comes back either case depending on who asked. A literal string compare
   * would have declared this repo a stranger and quietly skipped every restart —
   * a check that never fires, which is the failure mode the three laws name.
   */
  const a = 'C:\\Users\\dev\\OneDrive\\Documents\\Code\\Projects\\sequence';
  assert.strictEqual(sameDir(a, a.toLowerCase()), true);
  assert.strictEqual(sameDir(a, a.split('\\').join('/')), true);
});

test('a different checkout is NOT the same server', () => {
  /* The half that keeps the ownership test from being decorative. If this ever
     returns true, the script is willing to kill somebody else's process. */
  assert.strictEqual(
    sameDir('C:\\Users\\dev\\Projects\\sequence', 'C:\\Users\\dev\\Projects\\sequence-fork'),
    false,
  );
  assert.strictEqual(sameDir('C:\\a\\sequence', 'C:\\b\\sequence'), false);
});

/*
 * 0.1.8.1 B1: the server listens before it reads its startup --repo, and says so on /api/status as
 * `{ attached: false, scanning: { done, total, path } }`. A restart (or a replay) that asks too early must still know
 * whose server it is, and must wait for the read to finish before handing it on.
 */
test('a server still reading its repository names it, and is reported as scanning', () => {
  const reading = { attached: false, scanning: { done: 0, total: 0, path: 'C:\repo' } };
  assert.equal(rootOfStatus(reading), 'C:\repo');
  assert.equal(isScanning(reading), true);
  assert.equal(rootOfStatus({ attached: true, repoName: 'repo', root: 'C:\repo' }), 'C:\repo');
  assert.equal(isScanning({ attached: true, root: 'C:\repo' }), false);
  assert.equal(isScanning({ attached: false, attachFailure: { path: 'x', reason: 'y' } }), false);
  assert.equal(rootOfStatus({ attached: false }), null);
});

test('waitForScan polls until scanning clears, and gives up at its bound', async () => {
  const bodies = [
    { attached: false, scanning: { done: 0, total: 0, path: '/r' } },
    { attached: false, scanning: { done: 40, total: 120, path: '/r' } },
    { attached: true, root: '/r', repoName: 'r' },
  ];
  let calls = 0;
  const fetchImpl = async () => ({ ok: true, json: async () => bodies[Math.min(calls++, bodies.length - 1)] });
  const done = await waitForScan('http://x', { everyMs: 1, fetchImpl });
  assert.deepEqual(done, bodies[2]);
  assert.equal(calls, 3);

  const never = async () => ({ ok: true, json: async () => bodies[0] });
  const last = await waitForScan('http://x', { everyMs: 1, timeoutMs: 20, fetchImpl: never });
  assert.equal(isScanning(last), true);
});
