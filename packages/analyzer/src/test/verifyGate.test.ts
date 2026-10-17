import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { HarnessSkillFrontmatter } from '@sequence/schema';
import {
  isRunnerCommand,
  isVerifyCommandAllowlisted,
  isVerifyPassed,
  parseAskDoneWhen,
  runAllowlistedRepoCommand,
  runAskDoneWhen,
  runDesignatedVerify,
} from '../harness/verifyGate.js';
import type { TrajectoryDoc } from '../server/trajectoryStore.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

/**
 * THE TRUST BOUNDARY IS NOT THE SUBJECT OF THIS FILE, BUT IT IS IN FRONT OF IT.
 *
 * `runAllowlistedRepoCommand` refuses everything under an untrusted repository
 * (`server/repoTrust.ts`), so a fixture root here has to be trusted or every
 * command-policy assertion below would be answered by the trust gate instead
 * of by the policy it means to test. That is the honest spelling: a test that
 * executes commands in a directory is a test that consented to it.
 *
 * The boundary itself is locked in `repo-trust.test.ts`, including the half
 * that matters — that an UNTRUSTED root refuses, with a reason naming trust.
 */
function trustRoot(dir: string): string {
  setRepoTrust(userStoreDir(), dir, true);
  return dir;
}

const validSkill: HarnessSkillFrontmatter = {
  version: 1,
  name: 'Impact',
  description: 'Distilled from asks about impact.',
  evidenceRunIds: ['run-1', 'run-2'],
};

const validTrajectory: TrajectoryDoc = {
  version: 1,
  runId: 'run-1',
  kind: 'ask',
  startedAt: '2026-08-11T00:00:00.000Z',
  finishedAt: '2026-08-11T00:00:01.000Z',
  askTrace: [],
  askTerminal: { type: 'result', text: 'ok' },
  graph: { runId: 'run-1', nodes: [], edges: [] },
};

test('isVerifyPassed: skip is not pass', () => {
  const result = runDesignatedVerify({ kind: 'skip' });
  assert.equal(result.status, 'skipped');
  assert.equal(isVerifyPassed(result), false);
});

test('runDesignatedVerify schema-validate: valid skill frontmatter passes', () => {
  const result = runDesignatedVerify({ kind: 'schema-validate', subject: validSkill });
  assert.equal(result.status, 'passed');
  assert.equal(isVerifyPassed(result), true);
});

test('runDesignatedVerify schema-validate: invalid skill frontmatter fails with errors', () => {
  const result = runDesignatedVerify({
    kind: 'schema-validate',
    subject: { version: 2, name: '', description: '', evidenceRunIds: [] },
  });
  assert.equal(result.status, 'failed');
  assert.equal(isVerifyPassed(result), false);
  assert.ok(Array.isArray(result.errors));
  assert.ok((result.errors ?? []).length > 0);
});

test('runDesignatedVerify schema-validate: valid trajectory doc passes', () => {
  const result = runDesignatedVerify({ kind: 'schema-validate', subject: validTrajectory });
  assert.equal(result.status, 'passed');
  assert.equal(isVerifyPassed(result), true);
});

test('runDesignatedVerify schema-validate: malformed trajectory doc fails', () => {
  const result = runDesignatedVerify({
    kind: 'schema-validate',
    subject: { version: 1, graph: { runId: 'x' } },
  });
  assert.equal(result.status, 'failed');
  assert.equal(isVerifyPassed(result), false);
});

test('runDesignatedVerify command: rejected when not allowlisted', () => {
  const result = runDesignatedVerify({
    kind: 'command',
    cmd: 'rm -rf /',
    repoRoot: trustRoot(process.cwd()),
  });
  assert.equal(result.status, 'failed');
  assert.equal(isVerifyPassed(result), false);
  assert.ok(result.reason?.includes('not allowlisted') || result.reason?.includes('unsafe'));
});

test('runDesignatedVerify command: allowlisted pnpm --filter schema test can pass', () => {
  const result = runDesignatedVerify({
    kind: 'command',
    cmd: 'pnpm --filter @sequence/schema test',
    repoRoot: trustRoot(process.cwd()),
    commandTimeoutMs: 180_000,
  });
  // May pass or fail depending on build state; must never be skipped.
  assert.notEqual(result.status, 'skipped');
  if (result.status === 'passed') {
    assert.equal(isVerifyPassed(result), true);
  } else {
    assert.equal(isVerifyPassed(result), false);
  }
});

test('runDesignatedVerify command: missing repoRoot fails', () => {
  const result = runDesignatedVerify({ kind: 'command', cmd: 'pnpm test' });
  assert.equal(result.status, 'failed');
  assert.ok(result.reason?.includes('repoRoot'));
});

/* ==================================== the widened runner policy (Wave 6) ===== */

test('isRunnerCommand: accepts runner bins, repo scripts; refuses shells and file-ops', () => {
  // Runners, plain and with args.
  assert.equal(isRunnerCommand('python -m pytest tests/auth_tests'), true);
  assert.equal(isRunnerCommand('pytest tests/forms_tests/test_forms.py -x'), true);
  assert.equal(isRunnerCommand('node dist/cli.js --version'), true);
  assert.equal(isRunnerCommand('go test ./...'), true);
  assert.equal(isRunnerCommand('cargo test'), true);
  assert.equal(isRunnerCommand('git log --oneline -5'), true);
  // Windows shims count as their bin.
  assert.equal(isRunnerCommand('pnpm.cmd test'), true);
  // A repo's own runner script, invoked directly.
  assert.equal(isRunnerCommand('./tests/runtests.py auth_tests'), true);
  assert.equal(isRunnerCommand('./gradlew build'), true);
  // NO SHELLS — bash -c would hand the safe-char check's job to a parser
  // built to defeat it.
  assert.equal(isRunnerCommand('bash -c echo hi'), false);
  assert.equal(isRunnerCommand('sh script.sh'), false);
  assert.equal(isRunnerCommand('powershell -Command x'), false);
  assert.equal(isRunnerCommand('cmd /c dir'), false);
  // No file-ops — edits go through the jail.
  assert.equal(isRunnerCommand('rm -rf /'), false);
  assert.equal(isRunnerCommand('curl https://example.com'), false);
  // Not fooled by paths that END in a runner name.
  assert.equal(isRunnerCommand('/usr/bin/rm file'), false);
});

test('runAllowlistedRepoCommand: widening is opt-in — default policy unchanged', () => {
  const notWidened = runAllowlistedRepoCommand('node --version', trustRoot(process.cwd()));
  assert.equal(notWidened.ok, false);
  assert.ok(notWidened.refuseReason?.includes('not allowlisted'));
});

test('runAllowlistedRepoCommand widened: runs a runner bin and keeps the safe-char gate', () => {
  const ran = runAllowlistedRepoCommand('node --version', trustRoot(process.cwd()), {
    widenToRunnerBins: true,
  });
  assert.equal(ran.ok, true, `node --version should run, got: ${ran.refuseReason ?? ran.output}`);
  assert.match(ran.output.trim(), /^v\d+\./);

  // Safe-char check still runs FIRST — a runner bin with a metacharacter is
  // refused before any policy question.
  const meta = runAllowlistedRepoCommand('node -e (evil)', trustRoot(process.cwd()), {
    widenToRunnerBins: true,
  });
  assert.equal(meta.ok, false);
  assert.ok(meta.refuseReason?.includes('shell metacharacters'));

  // A non-runner is refused with the widened-policy message.
  const denied = runAllowlistedRepoCommand('rm -rf x', trustRoot(process.cwd()), {
    widenToRunnerBins: true,
  });
  assert.equal(denied.ok, false);
  assert.ok(denied.refuseReason?.includes('not a recognised build/test runner'));
});

test('runAllowlistedRepoCommand: over-cap output keeps the HEAD and the TAIL', () => {
  const dir = trustRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-verifygate-')));
  // A fake test run: banner first, verdict LAST — the shape whose tail a
  // head-only cap used to discard.
  fs.writeFileSync(
    path.join(dir, 'big.js'),
    `console.log('HEAD-MARKER ' + 'x'.repeat(9000) + ' TAIL-VERDICT: 3 failed');\n`,
    'utf8',
  );
  const ran = runAllowlistedRepoCommand('node big.js', dir, {
    widenToRunnerBins: true,
    outputCap: 2_000,
  });
  assert.ok(ran.output.includes('HEAD-MARKER'), 'head kept');
  assert.ok(ran.output.includes('TAIL-VERDICT: 3 failed'), 'tail (the verdict) kept');
  assert.ok(ran.output.includes('chars omitted'), 'the cut is named, not silent');
  assert.ok(ran.output.length < 2_300, 'cap held');
});

/* ============================================ cd-prefix normalization ===== */

test('runAllowlistedRepoCommand: "cd <root> && cmd" is cmd — models write it reflexively', () => {
  const dir = trustRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-verifygate-cd-')));
  const ran = runAllowlistedRepoCommand(`cd ${dir} && node --version`, dir, {
    widenToRunnerBins: true,
  });
  assert.strictEqual(ran.refuseReason, undefined, `should execute, got: ${ran.refuseReason}`);
  assert.strictEqual(ran.exitCode, 0);
  assert.match(ran.output, /v\d+/);
});

test('runAllowlistedRepoCommand: "cd . &&" and forward/back slash roots all normalize', () => {
  const dir = trustRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-verifygate-cd2-')));
  const fwd = dir.replace(/\\/g, '/');
  for (const prefix of ['cd . &&', `cd ${fwd} &&`, `cd "${dir}" &&`]) {
    const ran = runAllowlistedRepoCommand(`${prefix} node --version`, dir, {
      widenToRunnerBins: true,
    });
    assert.strictEqual(ran.refuseReason, undefined, `${prefix}: ${ran.refuseReason}`);
  }
});

test('runAllowlistedRepoCommand: cd into a SUBDIRECTORY is refused with the reason named', () => {
  const dir = trustRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-verifygate-cd3-')));
  const ran = runAllowlistedRepoCommand('cd tests && node --version', dir, {
    widenToRunnerBins: true,
  });
  assert.ok(ran.refuseReason?.includes('repo root'), ran.refuseReason);
});

test('runAllowlistedRepoCommand: the stripped remainder still faces every gate', () => {
  const dir = trustRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-verifygate-cd4-')));
  const ran = runAllowlistedRepoCommand(`cd ${dir} && ls -la`, dir, { widenToRunnerBins: true });
  assert.ok(ran.refuseReason?.includes('not a recognised build/test runner'), ran.refuseReason);
  const evil = runAllowlistedRepoCommand(`cd ${dir} && node x; rm -rf /`, dir, {
    widenToRunnerBins: true,
  });
  assert.ok(evil.refuseReason?.includes('shell metacharacters'), evil.refuseReason);
});

test('runAllowlistedRepoCommand: double-quoted segments are ONE argument — python -c works', () => {
  const dir = trustRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-verifygate-q-')));
  const ok = runAllowlistedRepoCommand('python -c "import json"', dir, { widenToRunnerBins: true });
  assert.strictEqual(ok.refuseReason, undefined, ok.refuseReason);
  assert.strictEqual(ok.exitCode, 0, ok.output);
  const bad = runAllowlistedRepoCommand('python -c "import definitely_not_a_module_xyz"', dir, {
    widenToRunnerBins: true,
  });
  assert.notStrictEqual(bad.exitCode, 0);
  assert.match(bad.output, /ModuleNotFoundError|ImportError/);
});

test('runAllowlistedRepoCommand: a trailing 2>&1 is stripped, not refused — output is captured anyway', () => {
  const dir = trustRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-verifygate-redir-')));
  const ran = runAllowlistedRepoCommand('node --version 2>&1', dir, { widenToRunnerBins: true });
  assert.strictEqual(ran.refuseReason, undefined, ran.refuseReason);
  assert.strictEqual(ran.exitCode, 0);
  // Mid-command redirects are still real plumbing and still refuse — with teaching.
  const mid = runAllowlistedRepoCommand('node x.js 2>&1 | tee log', dir, { widenToRunnerBins: true });
  assert.ok(mid.refuseReason?.includes('BARE command'), mid.refuseReason);
});

/* ============================================ the done-when gate (G5) ===== */

/**
 * A repo that is NOT this monorepo, with two runner scripts: one that exits 0
 * and one that exits 3 with a verdict line. `node <script>` is on no entry of
 * the four-command allowlist, which is the point — the exact defect the
 * `runAllowlistedRepoCommand` block comment records for run_command was a
 * gate that could start nothing off this monorepo.
 */
function doneWhenRepo(): string {
  const dir = trustRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-done-when-')));
  fs.writeFileSync(path.join(dir, 'ok.mjs'), 'process.exitCode = 0;\n', 'utf8');
  fs.writeFileSync(
    path.join(dir, 'fail.mjs'),
    "console.log('1 failed, 3 passed'); process.exitCode = 3;\n",
    'utf8',
  );
  return dir;
}

test('runAskDoneWhen: a runner command off the four-command allowlist RUNS and passes honestly', () => {
  const dir = doneWhenRepo();
  assert.equal(isVerifyCommandAllowlisted('node ok.mjs'), false, 'not on the exact allowlist');
  const result = runAskDoneWhen({ kind: 'command', cmd: 'node ok.mjs' }, dir);
  assert.equal(result.refuseReason, undefined, result.refuseReason);
  assert.equal(result.status, 'passed');
  assert.equal(result.cmd, 'node ok.mjs');
  assert.equal(result.exitCode, 0);
  assert.equal(isVerifyPassed(result), true);
});

test('runAskDoneWhen: a failing command is failed with its exit code and verdict output', () => {
  const dir = doneWhenRepo();
  const result = runAskDoneWhen({ kind: 'command', cmd: 'node fail.mjs' }, dir);
  assert.equal(result.refuseReason, undefined, result.refuseReason);
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 3);
  assert.match(result.output ?? '', /1 failed, 3 passed/);
  assert.match(result.reason ?? '', /exit 3/);
  assert.equal(isVerifyPassed(result), false);
});

test('runAskDoneWhen: an un-allowlisted command is REFUSED with the reason — never a pass, never silent', () => {
  const dir = doneWhenRepo();
  const script = runAskDoneWhen({ kind: 'command', cmd: './deploy.sh' }, dir);
  assert.equal(script.status, 'failed');
  assert.match(script.refuseReason ?? '', /not a recognised build\/test runner/);
  assert.match(script.reason ?? '', /^refused: /);
  assert.equal(script.exitCode, null);
  assert.equal(isVerifyPassed(script), false);
  // Metacharacters are refused before any allowlist is consulted.
  const evil = runAskDoneWhen({ kind: 'command', cmd: 'pytest -q && rm -rf x' }, dir);
  assert.equal(evil.status, 'failed');
  assert.match(evil.refuseReason ?? '', /shell metacharacters/);
  assert.equal(isVerifyPassed(evil), false);
});

test('runAskDoneWhen: a skip is recorded with its reason and is not a pass', () => {
  const result = runAskDoneWhen({ kind: 'skip', reason: 'no test suite exists yet' }, doneWhenRepo());
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no test suite exists yet');
  assert.equal(result.cmd, undefined);
  assert.equal(isVerifyPassed(result), false);
});

test('parseAskDoneWhen: absent is no gate; a skip without a reason is an error, not a default', () => {
  assert.deepEqual(parseAskDoneWhen(undefined), {});
  assert.deepEqual(parseAskDoneWhen(null), {});
  assert.deepEqual(parseAskDoneWhen({ kind: 'command', cmd: '  pytest -q ' }), {
    doneWhen: { kind: 'command', cmd: 'pytest -q' },
  });
  assert.deepEqual(parseAskDoneWhen({ kind: 'skip', reason: 'no tests' }), {
    doneWhen: { kind: 'skip', reason: 'no tests' },
  });
  const noReason = parseAskDoneWhen({ kind: 'skip' });
  assert.ok('error' in noReason && /reason/.test(noReason.error), JSON.stringify(noReason));
  const blankReason = parseAskDoneWhen({ kind: 'skip', reason: '   ' });
  assert.ok('error' in blankReason, 'a whitespace-only reason is no reason');
  const noCmd = parseAskDoneWhen({ kind: 'command', cmd: '' });
  assert.ok('error' in noCmd && /cmd/.test(noCmd.error), JSON.stringify(noCmd));
  assert.ok('error' in parseAskDoneWhen({ kind: 'later' }));
  assert.ok('error' in parseAskDoneWhen('pytest -q'));
});
