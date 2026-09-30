/**
 * P6 Claims A/B harness — structural lock.
 *
 * The harness must exist, expose ten §5.5-shaped questions, and label every
 * report UNVERIFIED until the owner fills Lane A. Running Lane B against the
 * shopfront fixture proves the MCP path works without inventing competitor bars.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS = path.join(ROOT, 'tools/p6-claims-ab.mjs');
const SHOPFRONT = path.join(ROOT, 'packages/analyzer/test/fixtures/shopfront');

test('p6-claims-ab.mjs exists and exports ten monorepo + shopfront questions', async () => {
  assert.ok(fs.existsSync(HARNESS), 'tools/p6-claims-ab.mjs missing');
  const mod = await import(pathToFileURL(HARNESS).href);
  assert.equal(mod.MONOREPO_QUESTIONS.length, 10);
  assert.equal(mod.SHOPFRONT_QUESTIONS.length, 10);
  for (const q of [...mod.MONOREPO_QUESTIONS, ...mod.SHOPFRONT_QUESTIONS]) {
    assert.ok(q.id && q.prompt && q.tool, `question incomplete: ${JSON.stringify(q)}`);
  }
});

test('Lane B against shopfront exits 0 and reports UNVERIFIED (no fake bars)', () => {
  const mcpDist = path.join(ROOT, 'packages/mcp/dist/index.js');
  const analyzerDist = path.join(ROOT, 'packages/analyzer/dist/scan.js');
  if (!fs.existsSync(mcpDist) || !fs.existsSync(analyzerDist)) {
    console.log('SKIP: analyzer/mcp dist missing — build packages first');
    return;
  }
  const r = spawnSync(
    process.execPath,
    [HARNESS, '--repo', SHOPFRONT, '--json'],
    { encoding: 'utf8', cwd: ROOT, timeout: 120_000 },
  );
  assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout?.slice(0, 500)}`);
  const report = JSON.parse(r.stdout);
  assert.equal(report.status, 'UNVERIFIED');
  assert.equal(report.questions.length, 10);
  assert.match(report.note ?? '', /UNVERIFIED/i);
  for (const q of report.questions) {
    assert.equal(q.laneA.status, 'PENDING_OWNER');
    assert.equal(typeof q.laneB.approxTokens, 'number');
  }
  /* Ban published win claims — the note may say "competitor bars" as a refusal. */
  assert.doesNotMatch(r.stdout, /\bscoreboard\b|\bwe win\b|\bbeats Claude\b/i);
});
