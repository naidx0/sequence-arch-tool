/**
 * run_command, Pi-style (docs/research/pi-and-opencode-study.md, change 1).
 *
 * A test run's verdict is its LAST line. The old tool kept the first 4,000
 * characters; a normal suite's "TESTS PASSED" / "FAILED" never reached the model.
 * Now: keep the TAIL (2000 lines or 50 KB, whichever is hit first), save the full
 * output to a file under .sequence/tmp and name it, take a `timeout` argument, and
 * always report the exit code and "timed out after Ns" honestly.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { executeAskTool, type AskToolContext } from '../server/askTools.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

/* The test runner shares one SEQUENCE_USER_DIR across files; trust is a read-modify-write file, so own a private store. */
let ownStore: string | undefined;
function repoWith(files: Record<string, string>): string {
  if (!ownStore) {
    ownStore = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-own-user-'));
    process.env.SEQUENCE_USER_DIR = ownStore;
  }
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-run-tail-')));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  setRepoTrust(userStoreDir(), dir, true);
  return dir;
}

function ctxFor(root: string): AskToolContext {
  return {
    repoRoot: root,
    resolveReadable: (rel: string) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(root) ? abs : null;
    },
    designMode: false,
    permission: 'build',
  } as AskToolContext;
}

const text = (r: { content?: string; evidence: string }): string => `${r.evidence}\n${r.content ?? ''}`;

test('a command printing 10,000 lines that ends in TESTS PASSED keeps that line, and says what it cut', async () => {
  const root = repoWith({
    'big.js': "for (let i = 1; i <= 10000; i++) console.log('line ' + i);\nconsole.log('TESTS PASSED');\n",
  });
  const r = await executeAskTool('run_command', { cmd: 'node big.js' }, ctxFor(root));
  assert.strictEqual(r.ok, true);
  const out = text(r);
  assert.match(out, /TESTS PASSED/, 'the verdict at the end survives');
  assert.match(out, /line 10000/);
  assert.doesNotMatch(out, /line 1\n/, 'the head is what gets cut');
  assert.match(out, /truncated|showing last/i);
  assert.match(out, /exit 0/);
});

test('the truncated result names a file that holds the FULL output', async () => {
  const root = repoWith({
    'big.js': "for (let i = 1; i <= 10000; i++) console.log('line ' + i);\nconsole.log('TESTS PASSED');\n",
  });
  const r = await executeAskTool('run_command', { cmd: 'node big.js' }, ctxFor(root));
  const m = /(\.sequence\/tmp\/[A-Za-z0-9._-]+\.log)/.exec(text(r));
  assert.ok(m, `no .sequence/tmp path in: ${text(r).slice(-400)}`);
  const full = fs.readFileSync(path.join(root, m![1]!), 'utf8');
  assert.match(full, /^line 1\n/, 'the file starts at the head');
  assert.match(full, /TESTS PASSED\s*$/, 'and ends at the tail');
  assert.strictEqual(full.split('\n').filter((l) => l.startsWith('line ')).length, 10000);
});

test('the tail is bounded: at most 2000 lines and 50 KB', async () => {
  const root = repoWith({
    'lines.js': "for (let i = 1; i <= 5000; i++) console.log('L' + i);\n",
    'wide.js': "for (let i = 1; i <= 100; i++) console.log('W' + i + ' ' + 'x'.repeat(1000));\n",
  });
  const a = await executeAskTool('run_command', { cmd: 'node lines.js' }, ctxFor(root));
  const aLines = text(a).split('\n').filter((l) => /^L\d+$/.test(l));
  assert.strictEqual(aLines.length, 2000);
  assert.strictEqual(aLines[aLines.length - 1], 'L5000');
  assert.strictEqual(aLines[0], 'L3001');
  const b = await executeAskTool('run_command', { cmd: 'node wide.js' }, ctxFor(root));
  const bytes = Buffer.byteLength((b.content ?? '').split('\n').filter((l) => /^W\d+ /.test(l)).join('\n'));
  assert.ok(bytes <= 50 * 1024, `kept ${bytes} bytes`);
  assert.match(text(b), /W100 /);
});

test('output under the limits is returned whole, with no file and no truncation notice', async () => {
  const root = repoWith({ 'small.js': "console.log('hello');\nconsole.log('done');\n" });
  const r = await executeAskTool('run_command', { cmd: 'node small.js' }, ctxFor(root));
  assert.match(text(r), /hello\ndone/);
  assert.doesNotMatch(text(r), /truncated|\.sequence\/tmp/);
});

test('a failing command reports its real exit code and keeps the tail', async () => {
  const root = repoWith({ 'fail.js': "for (let i = 1; i <= 3000; i++) console.log('row ' + i);\nconsole.error('FAILED: 3 tests');\nprocess.exit(3);\n" });
  const r = await executeAskTool('run_command', { cmd: 'node fail.js' }, ctxFor(root));
  assert.strictEqual(r.ok, false);
  assert.match(text(r), /exit 3/);
  assert.match(text(r), /FAILED: 3 tests/);
});

test('timeout: a slow command is stopped, and the result says "timed out after Ns", never a bare failure', async () => {
  const root = repoWith({ 'slow.js': "setTimeout(() => console.log('late'), 20000);\n" });
  const started = Date.now();
  const r = await executeAskTool('run_command', { cmd: 'node slow.js', timeout: 1 }, ctxFor(root));
  assert.ok(Date.now() - started < 15000, 'it did not wait for the command');
  assert.strictEqual(r.ok, false);
  assert.match(text(r), /timed out after 1s/);
  assert.doesNotMatch(text(r), /late/);
});

test('timeout is clamped to 600 s and a junk value falls back to the default instead of failing', async () => {
  const root = repoWith({ 'one.js': "console.log('ok');\n" });
  for (const timeout of [9999, -5, 'soon', 0, null]) {
    const r = await executeAskTool('run_command', { cmd: 'node one.js', timeout }, ctxFor(root));
    assert.strictEqual(r.ok, true, `timeout=${String(timeout)}`);
  }
});

test('the tool schema advertises timeout', async () => {
  const { openaiAskToolDefinitions } = await import('../server/askTools.js');
  const def = openaiAskToolDefinitions(['run_command']).find((d) => d.function.name === 'run_command');
  assert.ok(def);
  const props = (def!.function.parameters as { properties: Record<string, unknown> }).properties;
  assert.ok('timeout' in props, 'timeout is in the schema');
});
