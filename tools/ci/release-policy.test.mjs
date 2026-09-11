import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { DOC_ALLOW, decide, stripAgentsSections } from '../release/policy.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 })
  .split('\n')
  .filter(Boolean);

/**
 * THE HIGHEST-CONSEQUENCE RULE IN THE REPOSITORY.
 *
 * `decide()` says what leaves this machine. Every other check in the release
 * path is recoverable — a missing doc, an ugly changelog — but a private note
 * published to a public mirror is permanent and looks exactly like a successful
 * release from the inside. So the rule is tested here rather than trusted to the
 * one moment somebody runs the tool.
 */
test('a doc nobody has thought about yet does NOT ship', () => {
  /*
   * The whole argument for deny-by-default, as a test. These paths do not exist;
   * that is the point. An exclusion list protects you only from the private
   * files you already thought of, and the ones that leak are by definition the
   * ones you did not.
   */
  for (const invented of [
    'docs/OWNER-PLAN-2027-01-01.md',
    'docs/HANDOFF-tomorrow.md',
    'docs/research/whatever-we-measure-next.md',
    'docs/judge_runs/run-91.json',
    'docs/secret-roadmap.md',
    'docs/notes/investors.md',
  ]) {
    assert.deepStrictEqual(decide(invented), { keep: false, why: 'docs deny-by-default' }, invented);
  }
});

test('every private tree that exists today is excluded', () => {
  const leaked = tracked.filter(
    (f) =>
      decide(f).keep &&
      (f.startsWith('docs/research/') ||
        f.startsWith('.claude/') ||
        f.startsWith('.agents/') ||
        f.startsWith('.cursor/') ||
        f.startsWith('tools/bench/out/') ||
        f.startsWith('tools/ci/out/') ||
        /^docs\/(OWNER|HANDOFF|GO_LIVE|DEPLOY|GATEWAY)/.test(f) ||
        f === 'CLAUDE.md' ||
        f === 'tools/release/identifiers.json'),
  );
  assert.deepStrictEqual(leaked, [], 'these would have been published');
});

test('the journey page, its screenshots and its recording DO ship', () => {
  /* Explicitly asked for, and the one place under docs/ where binaries ship. It
     is also the exception that proves FORCE_INCLUDE is wired: it sits under the
     deny-by-default tree and must survive it. */
  for (const f of [
    'docs/journeys/teach-mode.md',
    'docs/journeys/img/1-lesson.png',
    'docs/journeys/img/capture.json',
    'docs/journeys/teach-mode.webm',
  ]) {
    assert.strictEqual(decide(f).keep, true, f);
  }
});

test('the policy is not vacuously excluding everything', () => {
  /*
   * ANTI-VACUITY. A `decide()` that returned `keep: false` for everything would
   * pass every test above and ship an empty repository. The counts below are the
   * shape of a real release, not exact numbers, so ordinary churn does not
   * rewrite them.
   */
  const kept = tracked.filter((f) => decide(f).keep);
  assert.ok(kept.length > 1000, `only ${kept.length} files would ship`);
  assert.ok(
    kept.some((f) => f.startsWith('packages/analyzer/src/')),
    'the engine must ship',
  );
  assert.ok(
    kept.filter((f) => f.startsWith('docs/')).length >= 15,
    'the allowed docs must actually resolve to files — a typo in DOC_ALLOW is silent',
  );
});

test('every DOC_ALLOW entry matches something that exists', () => {
  /*
   * A typo in DOC_ALLOW cannot fail loudly — it just quietly ships one fewer
   * document, which is the sort of thing nobody notices for a year.
   */
  const unmatched = DOC_ALLOW.filter((a) =>
    a.endsWith('/') ? !tracked.some((f) => f.startsWith(a)) : !tracked.includes(a),
  );
  assert.deepStrictEqual(unmatched, [], 'DOC_ALLOW names files that are not in the repository');
});

test('AGENTS.md keeps its contributor guidance and loses its internal sections', () => {
  const src = [
    '# AGENTS.md',
    'intro line',
    '## What this is (30 seconds)',
    'keep me',
    '## Read first',
    'internal pointer',
    '## Repo shape',
    'keep me too',
    '## Working as an agent here',
    'internal process',
    '## Non-negotiables',
    'keep this as well',
  ].join('\n');
  const out = stripAgentsSections(src);
  for (const keep of ['intro line', 'keep me', 'keep me too', 'keep this as well', '## Repo shape']) {
    assert.ok(out.includes(keep), `dropped something it should keep: ${keep}`);
  }
  for (const gone of ['## Read first', 'internal pointer', '## Working as an agent here', 'internal process']) {
    assert.ok(!out.includes(gone), `kept something it should drop: ${gone}`);
  }
});

/*
 * ── A TEST MUST NOT SHIP WITHOUT ITS SUBJECT ──────────────────────────────
 *
 * Measured 2026-09-10: CI on the public mirror failed 20 of 270 hygiene tests
 * and 1 of 2,430 analyzer tests, every one of them ENOENT on a doc this policy
 * deletes — CLAUDE.md, docs/CANON.md, docs/brand/graphite/pages. The tests were
 * right and the docs were right; what was wrong is that maintainer doc audits
 * travelled to a tree with no docs in it, where they could never pass however
 * anyone edited the code.
 *
 * These lock the exclusion in BOTH directions, because a list that only ever
 * says "no" would pass just as well if it excluded the whole of tools/ci.
 */
test('the doc audits do not travel to a tree with no docs', () => {
  const cannotPassPublicly = [
    'tools/ci/canon-paths.test.mjs',
    'tools/ci/docs-catalog.test.mjs',
    'tools/ci/graphite-doc-consistency.test.mjs',
    'tools/ci/graphite-freeze.test.mjs',
    'tools/ci/inherited-constraints.test.mjs',
    'tools/ci/mutants.test.mjs',
    'tools/ci/table-totals.test.mjs',
    'packages/analyzer/src/test/orchestration-protocol.test.ts',
    'packages/web2/test/firewall.test.ts',
    'packages/web2/test/icon-book.test.ts',
  ];
  for (const f of cannotPassPublicly) {
    const d = decide(f);
    assert.equal(d.keep, false, `${f} would ship into a tree that has no docs for it to read`);
  }
});

test('and the rest of the suite still does — this is subject, not mention', () => {
  /*
   * The measured distinction: 20 files under tools/ci mention `docs/`
   * somewhere; only the 7 above actually READ one. Excluding on mention would
   * have dropped 13 working tests, so a few of the mentioners are named here
   * by hand to keep that mistake from being made quietly later.
   */
  for (const f of [
    'tools/ci/no-cron.test.mjs',
    'tools/ci/counting-gate.test.mjs',
    'tools/ci/reachability.test.mjs',
    'tools/ci/desktop-packaging.test.mjs',
    'tools/ci/sandbox-run.test.mjs',
    'tools/ci/start-sh.test.mjs',
    /* Mentions docs/CANON.md in a comment and reads nothing. */
    'packages/web2/test/boot.test.tsx',
  ]) {
    assert.equal(decide(f).keep, true, `${f} should still ship — it audits code, not docs`);
  }
});
