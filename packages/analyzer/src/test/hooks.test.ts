import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  BLOCKING_EVENTS,
  HOOK_EVENTS,
  isTrusted,
  parseHookFile,
  runHooks,
  type HookFile,
} from '../server/hooks.js';

/**
 * LIFECYCLE HOOKS — the mechanism, deliberately not the breadth.
 *
 * CANON names this as the last gap holding the agent-workflow claim at ◐ and in
 * the same sentence rules the obvious version out: "29 events with exit-code-2
 * blocking on 15 of them — which is BREADTH, and breadth is deliberately out of
 * scope." What it actually reports as broken is one line up: this repository's
 * own three gates are "enforced by prose".
 *
 * THE FIRST FOUR TESTS ARE THE SECURITY POSTURE, and they come first because a
 * hook file is COMMITTED TO THE REPOSITORY. Running one on attach would mean
 * that opening someone's project executes their code — cloning a repo to look
 * at its architecture would be enough to be compromised. A repo can propose;
 * only the person can consent.
 */

function repoWith(file: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-hooks-'));
  fs.mkdirSync(path.join(root, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(root, '.sequence', 'hooks.json'), JSON.stringify(file, null, 2));
  return root;
}

/** A hook that exits with the code we ask for, printing to stderr. */
function exiting(code: number, message = ''): string[] {
  return [
    process.execPath,
    '-e',
    `process.stderr.write(${JSON.stringify(message)}); process.exit(${code});`,
  ];
}

/* ═══ consent, first ══════════════════════════════════════════════════════ */

test('an untrusted repo runs NOTHING, however much it declares', async () => {
  const root = repoWith({ version: 1, hooks: { 'pre-write': [{ command: exiting(2, 'nope') }] } });
  try {
    const { file } = parseHookFile(
      JSON.parse(fs.readFileSync(path.join(root, '.sequence', 'hooks.json'), 'utf8')),
    );
    const r = await runHooks('pre-write', { repoRoot: root, file, trusted: false });
    /*
     * The whole posture. A repo that could block a write on attach could also
     * run a miner on attach; there is no version of executing a stranger's
     * committed code that is acceptable, and "we only do it when you ask a
     * question" is not a mitigation.
     */
    assert.deepStrictEqual(r.outcomes, []);
    assert.strictEqual(r.allowed, true);
    /* Reported, not silent — a user who wrote a hook and sees nothing happen
       has to be able to find out why. */
    assert.strictEqual(r.skipped, 'not-trusted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('trust is per repo path, normalised, and a trailing slash is not a new repo', () => {
  const trust = { version: 1 as const, trusted: [path.resolve('/repos/mine')] };
  assert.strictEqual(isTrusted(path.resolve('/repos/mine'), trust), true);
  assert.strictEqual(isTrusted(`${path.resolve('/repos/mine')}${path.sep}`, trust), true);
  assert.strictEqual(isTrusted(path.resolve('/repos/other'), trust), false);
});

test('no trust file at all means nothing is trusted', () => {
  assert.strictEqual(isTrusted('/anywhere', undefined), false);
  assert.strictEqual(isTrusted('/anywhere', { version: 1, trusted: [] }), false);
});

test('a command must be an ARGV array — a shell string is refused', () => {
  const { file, warnings } = parseHookFile({
    version: 1,
    hooks: { 'pre-write': [{ command: 'echo hi; rm -rf ~' }] },
  });
  /*
   * A string would have to be split by something, and every splitter is a place
   * where a repo-committed `; rm -rf ~` becomes a second command. Dropped, with
   * a reason — a hook we half understand is one we must not run.
   */
  assert.deepStrictEqual(file.hooks['pre-write'], undefined);
  assert.match(warnings.join(' '), /argv array/);
});

/* ═══ the file ════════════════════════════════════════════════════════════ */

test('an unknown event is dropped and named, not guessed at', () => {
  const { file, warnings } = parseHookFile({
    version: 1,
    hooks: { 'pre-deploy': [{ command: ['true'] }] },
  });
  assert.deepStrictEqual(Object.keys(file.hooks), []);
  assert.match(warnings.join(' '), /unknown hook event/);
});

test('a timeout is bounded — a hook cannot ask to run forever', () => {
  const { file } = parseHookFile({
    version: 1,
    hooks: { 'pre-write': [{ command: ['true'], timeoutMs: 999_999_999 }] },
  });
  assert.strictEqual(file.hooks['pre-write']![0]!.timeoutMs, 120_000);
});

test('the event list is small on purpose, and blocking is a subset of it', () => {
  /*
   * Six, not twenty-nine. Every event is a promise to keep firing it, and CANON
   * rules breadth out of scope in the same sentence that names this gap.
   */
  assert.strictEqual(HOOK_EVENTS.length, 6);
  for (const e of BLOCKING_EVENTS) {
    assert.ok((HOOK_EVENTS as readonly string[]).includes(e), `${e} is not an event`);
  }
  /* `post-tool` and `run-finished` happen AFTER the thing they observe, so
     there is nothing left for them to stop. */
  assert.strictEqual(BLOCKING_EVENTS.has('post-tool' as never), false);
  assert.strictEqual(BLOCKING_EVENTS.has('run-finished' as never), false);
});

/* ═══ running ═════════════════════════════════════════════════════════════ */

async function fire(hooks: HookFile['hooks'], event: Parameters<typeof runHooks>[0]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-hookrun-'));
  try {
    return await runHooks(event, {
      repoRoot: root,
      file: { version: 1, hooks },
      trusted: true,
    });
  } finally {
    /*
     * TEARDOWN, NOT SUBJECT. A hook runs with this directory as its `cwd`, and
     * on Windows a process SIGKILLed a moment ago still holds that handle — so
     * `rmSync` raced the kernel and threw EPERM on the timeout test, failing an
     * assertion that had already passed.
     *
     * The retry is bounded and the last attempt is swallowed: a temp directory
     * that outlives one test run is the OS's to clean, and failing a test about
     * hook timeouts because of a filesystem handle would be the test measuring
     * the machine again.
     */
    for (let i = 0; i < 5; i += 1) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
}

test('exit 0 allows', async () => {
  const r = await fire({ 'pre-write': [{ command: exiting(0) }] }, 'pre-write');
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.outcomes[0]!.kind, 'ok');
});

test('exit 2 BLOCKS, and the hook’s own message is the reason', async () => {
  const r = await fire(
    { 'pre-write': [{ command: exiting(2, 'protected file') }] },
    'pre-write',
  );
  assert.strictEqual(r.allowed, false);
  const o = r.outcomes[0]!;
  assert.strictEqual(o.kind, 'blocked');
  /* Verbatim. A blocked action the user cannot get an explanation for is a
     wall, and they will disable the hook rather than read the code. */
  assert.match((o as { reason: string }).reason, /protected file/);
});

test('any OTHER non-zero code does not block — a broken hook is not a "no"', async () => {
  const r = await fire(
    { 'pre-write': [{ command: exiting(127, 'jq: command not found') }] },
    'pre-write',
  );
  /*
   * The distinction the whole exit-code contract turns on. A hook that fails
   * because a tool is missing must not silently prevent a write; a hook that
   * means "no" has to be unmistakable, and 2 is the only way to say it.
   */
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.outcomes[0]!.kind, 'broke');
});

test('exit 2 at a NON-blocking event does not block either', async () => {
  const r = await fire({ 'post-tool': [{ command: exiting(2, 'too late') }] }, 'post-tool');
  /* The tool already ran. A hook cannot un-run it, and reporting a block for
     something that already happened would be a lie about the past. */
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.outcomes[0]!.kind, 'broke');
});

test('a command that does not exist is reported, not thrown', async () => {
  const r = await fire(
    { 'pre-write': [{ command: ['definitely-not-a-real-binary-xyz'] }] },
    'pre-write',
  );
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.outcomes[0]!.kind, 'broke');
});

test('a hanging hook is killed at its timeout and does not block', async () => {
  const started = Date.now();
  const r = await fire(
    {
      'pre-write': [
        { command: [process.execPath, '-e', 'setTimeout(() => {}, 60000)'], timeoutMs: 300 },
      ],
    },
    'pre-write',
  );
  assert.ok(Date.now() - started < 5_000, 'the timeout actually fired');
  assert.strictEqual(r.allowed, true);
  assert.match((r.outcomes[0] as { reason: string }).reason, /timed out/);
});

test('hooks run in order and STOP at the first block', async () => {
  const r = await fire(
    {
      'pre-commit': [
        { command: exiting(0) },
        { command: exiting(2, 'gate says no') },
        { command: exiting(0) },
      ],
    },
    'pre-commit',
  );
  assert.strictEqual(r.allowed, false);
  /*
   * Two outcomes, not three. Running the rest would spend the user's time on
   * hooks whose answer cannot change the result — and a hook that assumed the
   * action happened would run for an action that did not.
   */
  assert.strictEqual(r.outcomes.length, 2);
});

test('no hooks for an event is allowed, and says which kind of nothing it was', async () => {
  const r = await fire({}, 'pre-write');
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.skipped, 'no-hooks');
});
