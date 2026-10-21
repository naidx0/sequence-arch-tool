import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fnName, isCorrect, makeRepo, runArm, sealedQuestions, summarize } from '../bench/lib/agent-arm-tokens.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every size gets 10 distinct sealed questions, each answer is a file that really defines the function asked about', () => {
  const repo = makeRepo(120);
  try {
    const qs = sealedQuestions(120);
    assert.equal(qs.length, 10);
    assert.equal(new Set(qs.map((q) => q.text)).size, 10);
    for (const q of qs) {
      const fn = /`([^`]+)`/.exec(q.text)[1];
      const src = fs.readFileSync(path.join(repo, q.answer), 'utf8');
      assert.ok(src.includes(`function ${fn}(`), `${q.answer} defines ${fn}`);
      /* Sealed: the question never names the file or the folder. */
      assert.ok(!q.text.includes('mod_') && !q.text.includes('area_'));
    }
    assert.equal(new Set(Array.from({ length: 120 }, (_, i) => fnName(i))).size, 120, 'function names are unique');
  } finally {
    /* Windows holds a handle on a git repo's cwd briefly after the last git call; retry the teardown. */
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('scoring: positive and negative controls, and a missing usage is null, never a guess', () => {
  const q = sealedQuestions(50)[0];
  assert.equal(isCorrect(`It is ${q.answer}`, q), true);
  assert.equal(isCorrect('src/area_000/mod_9999.js', q), false);
  const rows = [
    { files: 25, usage: { input: 1000, cacheRead: 500, cacheWrite: 0 }, correct: true, error: null },
    { files: 25, usage: { input: 2000, cacheRead: 0, cacheWrite: 100 }, correct: false, error: null },
    { files: 25, usage: null, correct: false, error: 'agent exited' },
    { files: 250, usage: { input: 3000, cacheRead: 0, cacheWrite: 0 }, correct: true, error: null },
  ];
  const [a, b] = summarize(rows);
  assert.deepEqual([a.files, a.questions, a.reported, a.meanInput, a.minInput, a.maxInput, a.correct, a.errors], [25, 3, 2, 1500, 1000, 2000, 1, 1]);
  assert.equal(a.meanInputIncludingCache, 1800);
  assert.deepEqual([b.files, b.meanInput], [250, 3000]);
  assert.equal(summarize([{ files: 5, usage: null, correct: false, error: 'x' }])[0].meanInput, null);
});

test('dry plumbing through the real AcpClient: 2 sizes x 3 questions, every turn reports usage, the mock agent finds the file', async () => {
  const acp = await import(pathToFileURL(path.join(root, 'packages/acp/dist/index.js')).href);
  const rows = await runArm({
    launch: { command: process.execPath, args: [path.join(root, 'packages/acp/src/test/fixtures/bench-dry-agent.mjs')] },
    sizes: [25, 250],
    perSize: 3,
    acp,
  });
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.error === null && r.usage && r.usage.input > 1000 && r.correct), JSON.stringify(rows.filter((r) => r.error || !r.usage || !r.correct)));
  const s = summarize(rows);
  assert.deepEqual(s.map((x) => [x.files, x.reported, x.correct]), [[25, 3, 3], [250, 3, 3]]);
  /* A broken agent is recorded as an error row, not a crash and not a number. */
  const bad = await runArm({ launch: { command: process.execPath, args: ['-e', 'process.exit(3)'] }, sizes: [25], perSize: 1, acp, timeoutMs: 20_000 });
  assert.equal(bad.length, 1);
  assert.ok(bad[0].error && bad[0].usage === null);
});
