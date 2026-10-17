import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoteTestFiles, dropFindFiles, findFiles, questionMentionsTests, TEST_FILE_PENALTY } from '../explain/findFiles.js';

/*
 * 0.1.8.1 D5 (audit M7): find_files ranked test files in the top three for
 * questions about code. Unless the question mentions tests, a test file now
 * ranks behind the code it tests; a question about tests keeps the order.
 */

const P = (p: string) => ({ path: p });

test('D5: a test file is moved behind the code unless the question mentions tests', () => {
  const ranked = [P('src/retry.test.ts'), P('src/retry.ts'), P('src/backoff.ts'), P('src/__tests__/x.ts'), P('src/clock.ts')];
  const code = demoteTestFiles(ranked, 'where is the retry delay computed').map((x) => x.path);
  /* Rank r counts as r x 4 for a test: #1 -> 4 (behind code ranked 2 and 3, ahead of #5), #4 -> 16. */
  assert.deepEqual(code, ['src/retry.ts', 'src/backoff.ts', 'src/retry.test.ts', 'src/clock.ts', 'src/__tests__/x.ts']);
  assert.strictEqual(TEST_FILE_PENALTY, 4);

  const tests = demoteTestFiles(ranked, 'which test covers the retry delay?').map((x) => x.path);
  assert.deepEqual(tests, ranked.map((x) => x.path), 'a question about tests keeps the ranker order');
});

test('D5: what counts as mentioning tests', () => {
  for (const q of ['which tests cover retry', 'is retry tested', 'the spec for retry', 'e2e for login', 'vitest config', 'unit test for the parser', 'fixtures for shopfront']) {
    assert.ok(questionMentionsTests(q), q);
  }
  for (const q of ['where is the retry delay computed', 'latest release notes', 'protest handler', 'contest scoring']) {
    assert.ok(!questionMentionsTests(q), q);
  }
});

test('D5: find_files itself puts the code above its test, and the test first when asked about tests', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-d5-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'retry.ts'), 'export function retryDelay(n: number) { return 100 * 2 ** n; }\n');
  fs.writeFileSync(path.join(dir, 'src', 'retry.test.ts'), "import { retryDelay } from './retry';\ntest('retry delay', () => retryDelay(1));\n");
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  try {
    /* `indexless`: the path ranker, deterministic. Both paths match "retry"; by name the test sorts first. */
    const code = await findFiles(dir, 'where is the retry delay computed', { noLog: true, indexless: true });
    assert.deepEqual(code.ranking.slice(0, 2), ['src/retry.ts', 'src/retry.test.ts']);
    const about = await findFiles(dir, 'which retry test is there', { noLog: true, indexless: true });
    assert.strictEqual(about.ranking[0], 'src/retry.test.ts');
  } finally {
    dropFindFiles(dir);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
