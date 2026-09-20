import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFindings,
  formatReport,
  mixLanes,
  normalizeHead,
  parseSince,
  shaStamps,
  siteLaneCollision,
  staleHeads,
} from './nightly-health.mjs';

test('staleHeads keeps main plus open PR heads and flags the rest', () => {
  const stale = staleHeads(
    ['main', 'mxcr/site-foo', 'mxcr/old-merged', 'origin/HEAD'],
    ['mxcr/site-foo'],
  );
  assert.deepEqual(stale, ['mxcr/old-merged']);
});

test('normalizeHead strips refs/heads and origin/', () => {
  assert.equal(normalizeHead('refs/heads/mxcr/ci'), 'mxcr/ci');
  assert.equal(normalizeHead('origin/main'), 'main');
});

test('mixLanes catches HANDOFF + packages in one PR', () => {
  const mix = mixLanes(['packages/web/src/a.tsx', 'docs/HANDOFF-AGENT-RESTART.md']);
  assert.ok(mix);
  assert.deepEqual(mix.program, ['docs/HANDOFF-AGENT-RESTART.md']);
});

test('mixLanes allows docs-only and product-only PRs', () => {
  assert.equal(mixLanes(['docs/nightly-ops.md', 'docs/README.md']), null);
  assert.equal(mixLanes(['packages/web/src/a.tsx', 'site/index.html']), null);
  assert.equal(mixLanes(['AGENTS.md']), null);
});

test('siteLaneCollision flags two open site PRs', () => {
  const hits = siteLaneCollision([
    { number: 1, title: 'a', head: 'a', files: ['site/index.html'] },
    { number: 2, title: 'b', head: 'b', files: ['site/styles.css'] },
    { number: 3, title: 'c', head: 'c', files: ['packages/web/x.ts'] },
  ]);
  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((h) => h.number),
    [1, 2],
  );
});

test('parseSince accepts hours and days', () => {
  const now = Date.parse('2026-08-13T05:00:00Z');
  assert.equal(parseSince('24h', now).toISOString(), '2026-08-12T05:00:00.000Z');
  assert.equal(parseSince('2d', now).toISOString(), '2026-08-11T05:00:00.000Z');
});

test('shaStamps finds full git hashes and ignores short ones', () => {
  const text = 'tip 1a818b0 is fine; 0123456789abcdef0123456789abcdef01234567 is not';
  assert.deepEqual(shaStamps(text), ['0123456789abcdef0123456789abcdef01234567']);
});

test('buildFindings fails on stale remotes and mixed lanes', () => {
  const findings = buildFindings({
    staleHeads: ['mxcr/dead'],
    catalog: [{ label: 'docs root', ok: true, missing: [], extra: [] }],
    open: [
      {
        number: 9,
        mix: { program: ['AGENTS.md'], product: ['packages/web/a.ts'] },
      },
    ],
    siteCollisions: [],
    shaStamps: [],
    gh: true,
  });
  assert.ok(findings.some((f) => f.level === 'fail' && /Stale remote/.test(f.message)));
  assert.ok(findings.some((f) => f.level === 'fail' && /#9 mixes/.test(f.message)));
});

test('buildFindings warns when gh is unavailable instead of failing remotes', () => {
  const findings = buildFindings({
    staleHeads: [],
    catalog: [{ label: 'docs root', ok: true, missing: [], extra: [] }],
    open: [],
    siteCollisions: [],
    shaStamps: [],
    gh: false,
  });
  assert.equal(
    findings.some((f) => f.level === 'fail'),
    false,
  );
  assert.ok(findings.some((f) => f.level === 'warn' && /gh CLI unavailable/.test(f.message)));
});

test('formatReport says everything okay when green', () => {
  const md = formatReport({
    ok: true,
    repo: 'naidx0/codeforge',
    generatedAt: '2026-08-13T05:00:00.000Z',
    since: '2026-08-12T05:00:00.000Z',
    merged: [{ number: 87, title: 'docs: HANDOFF tip', head: 'mxcr/handoff-tip-86' }],
    open: [],
    remoteHeads: ['main'],
    staleHeads: [],
    catalog: [{ label: 'docs root', ok: true }],
    findings: [],
  });
  assert.match(md, /Status: \*\*OK\*\*/);
  assert.match(md, /#87 docs: HANDOFF tip/);
  assert.match(md, /_Everything okay\._/);
  assert.match(md, /Do not merge/);
});
