/**
 * NO COMMAND THAT SCANS MAY FORCE THE PROCESS DOWN.
 *
 * `sequence explain` was fixed for this in a note that quotes the exact failure:
 * a full scan leaves the tree-sitter WASM parser's async handles being torn
 * down, and `process.exit()` on top of that trips libuv's own assertion on
 * Windows —
 *
 *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
 *     file src\win\async.c, line 76
 *
 * — AFTER the output has been printed in full, with exit code 127. The fix was
 * documented in `cli.ts` and applied to one command.
 *
 * `ask` still had it. Practical ML's walk of Teach mode hit it on 2026-09-05:
 * four turns, the last printing a complete refusal and then the assertion
 * underneath, exit 127, stdout cut mid-write with a trailing bare CR. Anything
 * checking the status of `sequence ask` saw a failure after a correct answer.
 *
 * A source scan rather than a spawn, because reproducing it needs a full scan on
 * Windows and the failure is in teardown, which no assertion inside the process
 * can observe. This is the same technique `settingsSurface.test.ts` uses.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliSource = (): string => {
  /* This file runs from `dist/test`, so the SOURCE is two levels up and across.
     The rule being tested is about what the source says, not what tsc emitted. */
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.resolve(here, '..', '..', 'src', 'cli.ts'), 'utf8');
};

test('RED WITHOUT THE FIX: no `process.exit(await …)` survives in the dispatcher', () => {
  /*
   * The awaited form is the dangerous one: it is a command that did real work —
   * a scan — and is now forcing the loop down on top of the teardown.
   */
  const offenders = cliSource()
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter((l) => /process\.exit\(\s*await\s/.test(l.line));
  assert.deepEqual(
    offenders,
    [],
    `these force the process down after async work:\n${offenders.map((o) => `  cli.ts:${o.n}  ${o.line}`).join('\n')}`,
  );
});

test('the ask branch sets an exit code and returns', () => {
  const src = cliSource();
  const i = src.indexOf("if (cmd === 'ask')");
  assert.ok(i > 0, 'the ask branch still exists');
  const branch = src.slice(i, i + 1400);
  assert.match(branch, /process\.exitCode = await runAskCli\(args\)/);
  assert.match(branch, /\n\s*return;/, 'and returns, so the loop drains');
});

test('the fix is explained where it is applied, not only where it was first found', () => {
  /* The `explain` note was correct and did not stop the same bug shipping on
     `ask`. A reader of the ask branch needs the reason at the ask branch. */
  const src = cliSource();
  const i = src.indexOf("if (cmd === 'ask')");
  assert.match(src.slice(i, i + 1600), /UV_HANDLE_CLOSING/);
});
