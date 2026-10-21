/**
 * Opus review fixes for the Pi-style tools (2026-10): byte-exact long-line reads, line-ending notes in diffs,
 * the run_command note outside the untrusted block, numeric-string timeouts, and a run_command that does not
 * block the event loop.
 */
import { loadScale } from './load-scale.js';
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { UNTRUSTED_CLOSE } from '../llm/untrusted.js';
import { unifiedDiff } from '../server/askEditDiff.js';
import {
  ASK_TOOL_READ_CAP_BYTES,
  ASK_TOOL_READ_CAP_BYTES_FULL,
  executeAskTool,
  resolveRunCommandTimeoutSeconds,
  type AskToolContext,
} from '../server/askTools.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

/* The test runner shares one SEQUENCE_USER_DIR across files; trust is a read-modify-write file, so own a private store. */
let ownStore: string | undefined;
function repoWith(files: Record<string, string>): string {
  if (!ownStore) {
    ownStore = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-own-user-'));
    process.env.SEQUENCE_USER_DIR = ownStore;
  }
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-review-fix-')));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  setRepoTrust(userStoreDir(), dir, true);
  return dir;
}

const ctxFor = (root: string, permission = 'propose'): AskToolContext =>
  ({
    repoRoot: root,
    resolveReadable: (rel: string) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(root) ? abs : null;
    },
    designMode: false,
    permission,
  }) as AskToolContext;

/* ── 4. read_file: a long line is cut by BYTES and the rest is kept ── */

test('read_file: one multibyte line longer than the cap is cut by bytes, and the full line is saved under .sequence/tmp', async () => {
  const line = '€'.repeat(ASK_TOOL_READ_CAP_BYTES); // 3 bytes per character, about 3x the cap
  const root = repoWith({ 'wide.txt': `${line}\nsecond\n` });
  const r = await executeAskTool('read_file', { path: 'wide.txt' }, ctxFor(root, 'build'));
  assert.strictEqual(r.ok, true);
  const shown = (r.content ?? '').split('\n').find((l) => l.startsWith('    1|')) ?? '';
  assert.ok(Buffer.byteLength(shown) <= ASK_TOOL_READ_CAP_BYTES_FULL + 400, `${Buffer.byteLength(shown)} bytes shown`);
  const m = /\.sequence\/tmp\/(read-[A-Za-z0-9._-]+\.log)/.exec(r.content ?? '');
  assert.ok(m, 'the cut names the file holding the whole line');
  assert.strictEqual(fs.readFileSync(path.join(root, '.sequence', 'tmp', m![1]!), 'utf8'), line);
  assert.match(r.content ?? '', /offset=2 to continue/, 'paging moves past the long line');
});

/* ── 5. diff notes for invisible changes ── */

test('unifiedDiff: a CRLF to LF conversion is reported, not shown as an empty diff', () => {
  const d = unifiedDiff('a.ts', 'a\r\nb\r\n', 'a\nb\n');
  assert.match(d, /line endings changed: CRLF to LF/);
  assert.notStrictEqual(d, '');
  assert.match(unifiedDiff('a.ts', 'a\nb\n', 'a\r\nb\r\n'), /line endings changed: LF to CRLF/);
});

test('unifiedDiff: a final newline added or removed is reported', () => {
  assert.match(unifiedDiff('a.ts', 'a\nb', 'a\nb\n'), /final newline added/);
  assert.match(unifiedDiff('a.ts', 'a\nb\n', 'a\nb'), /final newline removed/);
});

test('unifiedDiff: a real change plus a line-ending change shows both', () => {
  const d = unifiedDiff('a.ts', 'a\r\nb\r\n', 'a\nB\n');
  assert.match(d, /-b\n\+B/);
  assert.match(d, /line endings changed: CRLF to LF/);
});

/* ── 6. run_command note outside the untrusted block; exact bytes when KB rounding collides ── */

test('run_command: the truncation note sits outside the untrusted block', async () => {
  const root = repoWith({ 'big.js': "for (let i = 1; i <= 5000; i++) console.log('L' + i);\n" });
  const r = await executeAskTool('run_command', { cmd: 'node big.js' }, ctxFor(root, 'build'));
  const c = r.content ?? '';
  const note = c.lastIndexOf('[truncated:');
  assert.ok(note > 0, c.slice(-300));
  assert.ok(note > c.lastIndexOf(UNTRUSTED_CLOSE), 'the note comes after the closing marker');
});

test('run_command: when KB figures would collide the note gives exact bytes', async () => {
  const root = repoWith({ 'near.js': "for (let i = 0; i < 2001; i++) console.log('a');\n" });
  const r = await executeAskTool('run_command', { cmd: 'node near.js' }, ctxFor(root, 'build'));
  const note = /\[truncated:[^\]]*\]/.exec(r.content ?? '')?.[0] ?? '';
  assert.ok(note, `it was cut: ${r.evidence} ${(r.content ?? '').slice(0, 300)}`);
  assert.doesNotMatch(note, /(\d+\.\d) KB of \1 KB/);
  assert.match(note, /\d+ B of \d+ B/);
});

/* ── 7. timeouts and the event loop ── */

test('timeout accepts a numeric string and nothing else odd', () => {
  assert.strictEqual(resolveRunCommandTimeoutSeconds('30'), 30);
  assert.strictEqual(resolveRunCommandTimeoutSeconds(' 45 '), 45);
  assert.strictEqual(resolveRunCommandTimeoutSeconds('soon'), 120);
  assert.strictEqual(resolveRunCommandTimeoutSeconds('9999'), 600);
  assert.strictEqual(resolveRunCommandTimeoutSeconds(''), 120);
});

test('run_command does not block the event loop while the command runs', async () => {
  const root = repoWith({ 'sleep.js': 'setTimeout(() => console.log("woke"), 1500);\n' });
  let ticks = 0;
  const timer = setInterval(() => (ticks += 1), 50);
  try {
    const r = await executeAskTool('run_command', { cmd: 'node sleep.js' }, ctxFor(root, 'build'));
    assert.strictEqual(r.ok, true, r.evidence);
    assert.match(r.content ?? '', /woke/);
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks >= 10, `the loop ticked ${ticks} times in 1.5 s; a blocked loop ticks ~0`);
});

test('async run_command still honours the timeout and returns partial output', async () => {
  /* The timeout scales with load (node's own start-up must fit inside it to print "partial" first); the script still outlives it, so this proves the timeout fires and keeps what was printed. */
  const secs = Math.max(1, Math.ceil(loadScale() * 1.5));
  const root = repoWith({ 'slow.js': "console.log('partial');\nsetTimeout(() => {}, 120000);\n" });
  const r = await executeAskTool('run_command', { cmd: 'node slow.js', timeout: String(secs) }, ctxFor(root, 'build'));
  assert.strictEqual(r.ok, false);
  assert.match(`${r.evidence}\n${r.content}`, new RegExp(`timed out after ${secs}s`));
  assert.match(r.content ?? '', /partial/);
});
