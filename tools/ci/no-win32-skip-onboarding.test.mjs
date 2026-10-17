/**
 * Windows runs the onboarding tests. They once skipped on win32 because a fake `claude` could only be a .cmd, which the
 * code under test (rightly) refuses; packages/analyzer/src/test/helpers/nativeShim.ts now makes a real executable on every OS.
 * This tripwire fails if a skip comes back to the onboarding suite or to the gh/git tool-path tests, and checks the
 * Windows job exists in CI and that the helper is what the tests use.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T = path.join(ROOT, 'packages', 'analyzer', 'src', 'test');
const read = (f) => fs.readFileSync(f, 'utf8');

test('claude-bundled-bridge.test.ts has no skip: at all, and fakes are native shims', () => {
  const src = read(path.join(T, 'claude-bundled-bridge.test.ts'));
  assert.doesNotMatch(src, /skip\s*:/);
  assert.doesNotMatch(src, /NO_FAKE_CLAUDE_ON_WINDOWS/);
  assert.match(src, /makeNativeShim\(/);
});

test('the gh and git tool-path tests run on Windows too', () => {
  for (const f of ['pr-flow.test.ts', 'tool-path.test.ts']) {
    assert.doesNotMatch(read(path.join(T, f)), /skip:\s*process\.platform === 'win32'/, f);
  }
});

test('the shim helper compiles with the .NET compiler, hidden, and is cached', () => {
  const src = read(path.join(T, 'helpers', 'nativeShim.ts'));
  assert.match(src, /csc\.exe/);
  assert.match(src, /windowsHide: true/);
  assert.match(src, /createHash\('sha256'\)/);
});

test('ci.yml has a windows-latest correctness job with the desktop tests, and still no schedule', () => {
  const ci = read(path.join(ROOT, '.github', 'workflows', 'ci.yml'));
  assert.match(ci, /correctness-windows:[\s\S]*?runs-on: windows-latest/);
  assert.equal((ci.match(/pnpm --filter @sequence\/desktop test/g) ?? []).length, 2, 'Linux and Windows both run the desktop tests');
  assert.doesNotMatch(ci.replace(/#.*$/gm, ''), /schedule:|cron:/);
});
