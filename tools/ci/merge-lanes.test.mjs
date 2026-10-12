/**
 * Feature PRs must not rewrite program-state docs.
 *
 * Every product PR that also bumped HANDOFF-AGENT-RESTART.md caused the next
 * PR to conflict, agents to re-derive the queue, and tip hashes to go stale
 * mid-dev. Product code lands first. Tip-bump is a separate PR.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const PROGRAM_STATE = new Set([
  'docs/HANDOFF-AGENT-RESTART.md',
  'AGENTS.md',
  'CLAUDE.md',
]);

function isProduct(file) {
  return file.startsWith('packages/') || file.startsWith('site/');
}

function resolveBase() {
  if (process.env.MERGE_LANE_BASE) return process.env.MERGE_LANE_BASE;
  try {
    execSync('git rev-parse --verify origin/main', { stdio: 'pipe' });
    return 'origin/main';
  } catch {
    return null;
  }
}

function changedFiles(base) {
  const out = execSync(`git diff --name-only ${base}...HEAD`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

test('feature code and program-state docs are not mixed in one PR', () => {
  const base = resolveBase();
  if (!base) {
    // Shallow clone without origin/main and without MERGE_LANE_BASE — nothing to compare.
    return;
  }
  let files;
  try {
    files = changedFiles(base);
  } catch (err) {
    assert.fail(`git diff ${base}...HEAD failed: ${err.message}`);
  }
  const program = files.filter((f) => PROGRAM_STATE.has(f));
  const product = files.filter(isProduct);
  assert.ok(
    program.length === 0 || product.length === 0,
    `Mixes program-state (${program.join(', ')}) with product code (${product.slice(0, 8).join(', ')}${product.length > 8 ? ', …' : ''}). ` +
      'Land the packages/site PR first with no HANDOFF/AGENTS/CLAUDE edit; tip-bump those files in a follow-up.',
  );
});
