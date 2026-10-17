/**
 * Round-2 review fixes: read_file's NORMAL path counts bytes, propose mode never writes .sequence/tmp, and
 * run_command can be aborted (the request closing kills the whole process tree).
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ASK_TOOL_READ_CAP_BYTES, ASK_TOOL_READ_CAP_BYTES_FULL, executeAskTool, type AskToolContext } from '../server/askTools.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

let ownStore: string | undefined;
function repoWith(files: Record<string, string>): string {
  if (!ownStore) {
    ownStore = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-own-user-'));
    process.env.SEQUENCE_USER_DIR = ownStore;
  }
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-review-fix2-')));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  setRepoTrust(userStoreDir(), dir, true);
  return dir;
}

const ctxFor = (root: string, permission: string, signal?: AbortSignal): AskToolContext =>
  ({
    repoRoot: root,
    resolveReadable: (rel: string) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(root) ? abs : null;
    },
    designMode: false,
    permission,
    ...(signal ? { signal } : {}),
  }) as AskToolContext;

const rowsOf = (content: string): string[] => content.split('\n').filter((l) => /^\s*\d+\|/.test(l));

test('read_file: many multibyte lines stay under the byte cap (it counted characters)', async () => {
  const root = repoWith({ 'many.txt': Array.from({ length: 200 }, () => '€'.repeat(100)).join('\n') + '\n' });
  for (const [perm, cap] of [['propose', ASK_TOOL_READ_CAP_BYTES], ['build', ASK_TOOL_READ_CAP_BYTES_FULL]] as const) {
    const r = await executeAskTool('read_file', { path: 'many.txt' }, ctxFor(root, perm));
    const rows = rowsOf(r.content ?? '');
    assert.ok(rows.length > 0 && rows.length < 200, `${perm}: ${rows.length} rows`);
    assert.ok(Buffer.byteLength(rows.join('\n')) <= cap, `${perm}: ${Buffer.byteLength(rows.join('\n'))} bytes of rows against a ${cap} cap`);
  }
});

test('read_file: a 15 KB single line under a 12 KB cap is cut, not passed whole', async () => {
  const root = repoWith({ 'one.txt': '€'.repeat(5000) + '\nsecond\n' });
  const r = await executeAskTool('read_file', { path: 'one.txt' }, ctxFor(root, 'propose'));
  const first = rowsOf(r.content ?? '')[0] ?? '';
  assert.ok(Buffer.byteLength(first) <= ASK_TOOL_READ_CAP_BYTES + 200, `${Buffer.byteLength(first)} bytes shown`);
  assert.match(r.content ?? '', /offset=2 to continue/);
});

test('read_file: propose mode writes nothing, and says the line is too long with the byte offset instead', async () => {
  const root = repoWith({ 'one.txt': '€'.repeat(5000) + '\nsecond\n' });
  const r = await executeAskTool('read_file', { path: 'one.txt' }, ctxFor(root, 'propose'));
  assert.ok(!fs.existsSync(path.join(root, '.sequence')), 'no .sequence folder was created by a read');
  assert.match(r.content ?? '', /line 1 is 15000 bytes/);
  assert.match(r.content ?? '', /byte offset \d+/);
  assert.doesNotMatch(r.content ?? '', /\.sequence\/tmp/);
});

test('run_command: aborting the request kills the command and its whole process tree', async () => {
  const root = repoWith({
    'child.js': "require('fs').writeFileSync('child.pid', String(process.pid));\nsetTimeout(() => {}, 60000);\n",
    'parent.js': "const { spawn } = require('child_process');\nrequire('fs').writeFileSync('parent.pid', String(process.pid));\nspawn(process.execPath, ['child.js'], { stdio: 'ignore' });\nsetTimeout(() => {}, 60000);\n",
  });
  const ac = new AbortController();
  const started = Date.now();
  const pending = executeAskTool('run_command', { cmd: 'node parent.js' }, ctxFor(root, 'build', ac.signal));
  for (let i = 0; i < 100 && !fs.existsSync(path.join(root, 'child.pid')); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(fs.existsSync(path.join(root, 'child.pid')), 'the grandchild started');
  ac.abort();
  const r = await pending;
  assert.ok(Date.now() - started < 30_000);
  assert.strictEqual(r.ok, false);
  assert.match(`${r.evidence}\n${r.content}`, /aborted/i);
  await new Promise((r2) => setTimeout(r2, 500));
  for (const f of ['parent.pid', 'child.pid']) {
    const pid = Number(fs.readFileSync(path.join(root, f), 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.strictEqual(alive, false, `${f} (${pid}) is still running after the abort`);
  }
});

test('run_command: an already-aborted request never starts the command', async () => {
  const root = repoWith({ 'touch.js': "require('fs').writeFileSync('ran.txt', 'x');\n" });
  const ac = new AbortController();
  ac.abort();
  const r = await executeAskTool('run_command', { cmd: 'node touch.js' }, ctxFor(root, 'build', ac.signal));
  assert.strictEqual(r.ok, false);
  assert.match(`${r.evidence}\n${r.content}`, /aborted/i);
  assert.ok(!fs.existsSync(path.join(root, 'ran.txt')));
});
