/**
 * The verify gate's command allowlist is scoped to THIS repo — recorded, not fixed.
 *
 * P6 asked whether Sequence can replace a main coding agent, and answered "no, and the
 * gap is agency over time". Testing that claim against the code makes it much sharper,
 * and materially different.
 *
 * Sequence's ask loop has SEVEN tools (`ASK_TOOL_ALLOWLIST`): read_file, search_files,
 * propose_files, run_command, git_status, git_diff, call_mcp. Two facts bound what an
 * agent can actually accomplish with them:
 *
 * 1. **`propose_files` never writes.** Its own doc says so: "accept a multi-file edit
 *    proposal WITHOUT writing it… Nothing is written to disk." A human accepts it in
 *    the FileEditProposalBar. That is a deliberate, defensible product stance, and it
 *    caps autonomous iteration at exactly one proposal per turn.
 *
 * 2. **`run_command` can run four commands, and all four are Sequence's own.** The
 *    allowlist below is a hardcoded module constant with no per-repo override — three
 *    references repo-wide, all inside verifyGate.ts. One entry,
 *    `pnpm --filter @sequence/schema test`, names a package that exists only in this
 *    repository.
 *
 * So on an attached customer repo — a Python service, a Go module, a Rails app — the
 * verify gate can run NOTHING. The agency the product does have is scoped to the repo
 * that wrote it.
 *
 * That reframes P6's answer. The gap is not "agency over time" in the abstract; it is
 * (a) a deliberate write boundary that always terminates at a human, and (b) a verify
 * step that only works on Sequence itself. The first is a product stance worth
 * keeping. The second is a bug-shaped gap with a small fix.
 *
 * NOT FIXED HERE, deliberately. Widening what commands may execute is a security
 * boundary, and widening one unattended at 4am is exactly the kind of change that
 * should not arrive as a surprise. The proposed design is in
 * `docs/research/v32-scale-and-gaps.md`: derive candidates from the ATTACHED repo's
 * own `package.json` scripts, keep `isSafeVerifyCommand` and the no-shell spawn
 * unchanged.
 *
 * This test exists so the limitation is VISIBLE and tracked rather than folklore. It
 * asserts the current shape honestly; when the allowlist becomes repo-derived it will
 * fail, and that failure is the signal to rewrite it as real coverage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFY_COMMAND_ALLOWLIST,
  isSafeVerifyCommand,
  isVerifyCommandAllowlisted,
} from '../harness/verifyGate.js';

test('the allowlist is small, fixed, and names this repo', () => {
  assert.equal(
    VERIFY_COMMAND_ALLOWLIST.length,
    4,
    'four commands. If this grew, the P6 analysis needs revisiting',
  );
  assert.ok(
    VERIFY_COMMAND_ALLOWLIST.some((c) => c.includes('@sequence/')),
    'at least one entry names a Sequence-internal package — the tell that this list ' +
      'was written for this repo rather than for whatever repo is attached',
  );
});

test('a customer repo cannot verify — every common gate is refused', () => {
  // The concrete cost of the finding, in the form a user meets it. None of these are
  // exotic; they are the ordinary verify command for most projects.
  for (const cmd of [
    'npm test',
    'yarn test',
    'pytest',
    'go test ./...',
    'cargo test',
    'bundle exec rspec',
    'make test',
    'dotnet test',
  ]) {
    assert.equal(
      isVerifyCommandAllowlisted(cmd),
      false,
      `${cmd} is refused — on a repo that uses it, run_command can verify nothing`,
    );
  }
});

test('the safety checks are independent of the allowlist, and must stay that way', () => {
  // Whatever replaces the allowlist, THIS is the part that must not move: no shell
  // metacharacters, no traversal. A repo-derived allowlist is only safe while this
  // holds, so it is asserted separately from the list itself.
  assert.equal(isSafeVerifyCommand('pnpm test && rm -rf /'), false, 'no shell chaining');
  assert.equal(isSafeVerifyCommand('pnpm test; whoami'), false, 'no command separators');
  assert.equal(isSafeVerifyCommand('../../bin/evil'), false, 'no path traversal');
  assert.equal(isSafeVerifyCommand('pnpm test `id`'), false, 'no backtick substitution');
  assert.equal(isSafeVerifyCommand('pnpm test $(id)'), false, 'no dollar substitution');
  assert.equal(isSafeVerifyCommand('pnpm test'), true, 'a plain command is fine');
});

test('safety and allowlisting are separate gates, both required', () => {
  // A command can be safe and not allowlisted (npm test), which is the whole finding.
  assert.equal(isSafeVerifyCommand('npm test'), true);
  assert.equal(isVerifyCommandAllowlisted('npm test'), false);
});
