/**
 * Locking tests for the manifest schema and selection.
 *
 * The manifest is the benchmark's contract with reality: a wrong SHA, a missing
 * ground-truth file or a duplicated id turns every number downstream into
 * something nobody can reproduce. It is validated here, not trusted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  MANIFEST_PATH,
  PIN_PLACEHOLDER,
  REPO_ROOT,
  SHA_RE,
  cloneUrl,
  loadManifest,
  selectRepos,
  validateManifest,
} from '../lib/manifest.mjs';

const valid = () => ({
  version: 1,
  repos: [
    {
      id: 'a-repo',
      org: 'acme',
      repo: 'thing',
      sha: 'a'.repeat(40),
      license: 'MIT',
      langs: ['go'],
      shape: 'library',
      sizeClass: 'small',
      tiers: ['smoke', 'full'],
    },
  ],
});

test('the shipped manifest validates, ground-truth files included', () => {
  const problems = validateManifest(JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')), {
    checkGroundTruthFiles: true,
  });
  assert.deepEqual(problems, []);
});

test('the shipped manifest pins every repo to a real 40-char commit', () => {
  const m = loadManifest();
  const unpinned = m.repos.filter((r) => r.sha === PIN_PLACEHOLDER);
  assert.deepEqual(
    unpinned.map((r) => r.id),
    [],
    'a "pin-me" row cannot be benchmarked — resolve it with `git ls-remote` before committing'
  );
  for (const r of m.repos) assert.match(r.sha, SHA_RE, `${r.id} has a malformed sha`);
});

test('every ground truth in docs/ground-truth is consumed by a manifest row', () => {
  const dir = path.join(REPO_ROOT, 'docs', 'ground-truth');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const wired = new Set(loadManifest().repos.map((r) => r.groundTruth).filter(Boolean));
  const orphans = files.filter((f) => !wired.has(`docs/ground-truth/${f}`));
  assert.deepEqual(
    orphans,
    [],
    'a hand-verified ground truth consumed by nothing is exactly the dead weight this harness exists to wire in'
  );
});

test('the smoke tier is ten repos and contains every ground-truthed repo', () => {
  const m = loadManifest();
  const smoke = selectRepos(m, { tier: 'smoke' });
  assert.equal(smoke.length, 10, 'smoke-10 is a named contract, not an approximation');
  const truthed = m.repos.filter((r) => r.groundTruth).map((r) => r.id);
  const smokeIds = new Set(smoke.map((r) => r.id));
  for (const id of truthed) {
    assert.ok(smokeIds.has(id), `${id} carries hand-verified edge truth and must be in the smoke tier`);
  }
});

test('the full tier is the whole manifest', () => {
  const m = loadManifest();
  assert.equal(selectRepos(m, { tier: 'full' }).length, m.repos.length);
});

test('--repos selection overrides the tier and rejects an unknown id', () => {
  const m = loadManifest();
  assert.deepEqual(
    selectRepos(m, { repos: ['express', 'rails'] }).map((r) => r.id),
    ['express', 'rails']
  );
  assert.throws(() => selectRepos(m, { repos: ['not-a-repo'] }), /unknown repo id/);
});

test('a manifest with a duplicate id is rejected', () => {
  const m = valid();
  m.repos.push({ ...m.repos[0] });
  assert.ok(validateManifest(m).some((p) => /duplicate/.test(p)));
});

test('a manifest with a short or upper-case sha is rejected', () => {
  for (const sha of ['abc123', 'A'.repeat(40), '', 42]) {
    const m = valid();
    m.repos[0].sha = sha;
    assert.ok(
      validateManifest(m).some((p) => /sha/.test(p)),
      `sha ${JSON.stringify(sha)} should have been rejected`
    );
  }
});

test('the "pin-me" placeholder validates but is documented as unrunnable', () => {
  const m = valid();
  m.repos[0].sha = PIN_PLACEHOLDER;
  assert.deepEqual(validateManifest(m), []);
});

test('a row missing "full" from its tiers is rejected', () => {
  const m = valid();
  m.repos[0].tiers = ['smoke'];
  assert.ok(validateManifest(m).some((p) => /must include "full"/.test(p)));
});

test('a negative case must say what it is a negative case for', () => {
  const m = valid();
  m.repos[0].negativeCase = true;
  assert.ok(validateManifest(m).some((p) => /\.why is required/.test(p)));
  m.repos[0].why = 'no parser for this language';
  assert.deepEqual(validateManifest(m), []);
});

test('a missing ground-truth file is caught when the check is enabled', () => {
  const m = valid();
  m.repos[0].groundTruth = 'docs/ground-truth/does-not-exist.json';
  assert.deepEqual(validateManifest(m), [], 'path shape alone is fine');
  assert.ok(validateManifest(m, { checkGroundTruthFiles: true }).some((p) => /not found/.test(p)));
});

test('validateManifest is total over garbage input', () => {
  assert.deepEqual(validateManifest(null), ['manifest is not an object']);
  assert.deepEqual(validateManifest([]), ['manifest is not an object']);
  assert.ok(validateManifest({ version: 1, repos: [null] }).some((p) => /not an object/.test(p)));
});

test('clone urls are https github, derived not stored', () => {
  assert.equal(cloneUrl({ org: 'expressjs', repo: 'express' }), 'https://github.com/expressjs/express.git');
});
