/**
 * The verify gate must be able to START its own commands on the host platform.
 *
 * `verify-gate-scope.test.ts` records that the allowlist is scoped to THIS repo —
 * a real limitation, and the one everybody noticed. Underneath it was a worse one
 * nobody had measured: on Windows the gate could not run its commands *here*
 * either.
 *
 * Both verify paths spawn with `shell: false` (`harness/verifyGate.ts` and
 * `server/askTools.ts`), which is correct — `isSafeVerifyCommand` refuses shell
 * metacharacters exactly so that no shell parses the command. But `pnpm`, `npm`,
 * `yarn` and `npx` on Windows are `.cmd` shims. MEASURED on the owner's machine,
 * Node v24, before the fix:
 *
 *     spawnSync('pnpm',     ['--version'], { shell:false })  ->  ENOENT
 *     spawnSync('pnpm.exe', ['--version'], { shell:false })  ->  ENOENT
 *     spawnSync('pnpm.cmd', ['--version'], { shell:false })  ->  EINVAL
 *     spawnSync('cmd.exe', ['/d','/s','/c','pnpm','--version'])  ->  0, "10.33.0"
 *
 * Every one of the four allowlisted commands begins with `pnpm`. So the answer to
 * "can this agent verify its own work?" on the owner's own platform was ZERO of
 * four — not because of the allowlist's scope, but because the process never
 * started.
 *
 * ONE HONEST NOTE, because it nearly shipped. The first version of this file
 * asserted `code !== 'ENOENT'`. That passed against a broken fix: appending
 * `.cmd` turns ENOENT into EINVAL — Node has REFUSED to spawn `.cmd`/`.bat`
 * without a shell since CVE-2024-27980 — and the test reported success while the
 * gate still ran nothing. The assertion below is "the process started", which is
 * the invariant. Asserting the absence of one error code was asserting the
 * expression.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERIFY_COMMAND_ALLOWLIST,
  isSpawnLookupFailure,
  spawnVerifyBin,
} from '../harness/verifyGate.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('every allowlisted verify command can START on this platform', () => {
  // The defect in the form the user meets it. `--version` rather than the real
  // subcommand: this asserts the binary RESOLVES, not that the repo's tests pass.
  const unstartable: string[] = [];

  for (const cmd of VERIFY_COMMAND_ALLOWLIST) {
    const bin = cmd.split(' ')[0]!;
    const result = spawnVerifyBin(bin, ['--version'], { cwd: REPO, timeout: 60_000 });
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code ?? 'unknown';
      unstartable.push(`${bin} (from "${cmd}") -> ${code}`);
    }
  }

  assert.deepEqual(
    unstartable,
    [],
    `these verify binaries could not be started on ${process.platform}, so the agent ` +
      `cannot verify its own work here at all:\n  ${unstartable.join('\n  ')}`,
  );
});

test('an allowlisted command actually produces output, not just a live process', () => {
  // Starting is necessary but not sufficient — a fallback that spawns the wrong
  // thing would still "start". This proves the real binary answered.
  const result = spawnVerifyBin('pnpm', ['--version'], { cwd: REPO, timeout: 60_000 });

  assert.equal(result.error, undefined, 'pnpm must start');
  assert.equal(result.status, 0, 'pnpm --version exits 0');
  assert.match(
    String(result.stdout ?? '').trim(),
    /^\d+\.\d+/,
    'stdout carries a version number, so it was pnpm that ran and not a shell echo',
  );
});

test('a command that STARTS and fails is reported, not retried into a false pass', () => {
  // The guard on the fix. Retrying only a lookup failure is what keeps a genuine
  // verify failure a failure — if the fallback swallowed non-zero exits it would
  // turn a red gate green, which is worse than the bug being fixed.
  const result = spawnVerifyBin('node', ['-e', 'process.exit(3)'], {
    cwd: REPO,
    timeout: 60_000,
  });

  assert.equal(result.error, undefined, 'node resolves directly on every supported platform');
  assert.equal(result.status, 3, 'the real exit code survives');
});

test('a lookup failure is ENOENT or EINVAL, and nothing else is mistaken for one', () => {
  // EINVAL belongs here for a non-obvious reason: it is not a missing file, it is
  // Node refusing a .cmd without a shell. Treating it as a command result rather
  // than a lookup failure is precisely what made the first fix a no-op.
  assert.equal(isSpawnLookupFailure({ code: 'ENOENT' }), true);
  assert.equal(isSpawnLookupFailure({ code: 'EINVAL' }), true);
  assert.equal(isSpawnLookupFailure({ code: 'ETIMEDOUT' }), false, 'a timeout means it ran');
  assert.equal(isSpawnLookupFailure({ code: 'EACCES' }), false, 'a permission denial is not a miss');
  assert.equal(isSpawnLookupFailure(undefined), false, 'no error means it started');
});
