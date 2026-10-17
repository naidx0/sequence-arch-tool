import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { goalRunState } from '../server/goalRunner.js';
import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';
import { createSession, updateSession } from '../server/sessionsStore.js';

/**
 * A BUILT-IN-MODEL GOAL RUN (no coding agent) KEEPS ITS TOOLS ON THE REPO IT STARTED IN WHEN ANOTHER REPO IS ATTACHED.
 *
 * The provider is a loopback server speaking the Anthropic wire, so no real model and no network. Its first reply is held
 * until the test has attached B, then answers with a diff against a file both repos have (the pipeline writes it in Build mode).
 * Read: the file in A and in B on disk, and the checkpoint directory under each.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const F = 'backend/app/main.py';
const BEFORE = 'def list_notes():\n    return []\n';
const DIFF = ['Fix:', '```diff', `--- a/${F}`, `+++ b/${F}`, '@@ -1,2 +1,2 @@', ' def list_notes():', '-    return []', '+    return [{"id": 1}]', '```'].join('\n');

test('the built-in goal run reads and edits repo A after repo B is attached mid-run', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'goal-builtin-')));
  const A = path.join(home, 'a');
  const B = path.join(home, 'b');
  for (const r of [A, B]) {
    fs.cpSync(PLAINAPP, r, { recursive: true });
    fs.writeFileSync(path.join(r, F), BEFORE);
    setRepoTrust(userStoreDir(), r, true);
  }
  const store = path.join(home, '.sequence-user');
  fs.mkdirSync(store, { recursive: true });

  const made = createSession(A);
  updateSession(A, made.id, { goal: 'change list_notes to return one note', plan: [{ id: 's1', text: 'edit backend/app/main.py', status: 'open' }] });
  const id = made.id;

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const seen: string[] = [];
  const provider = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push(Buffer.concat(chunks).toString('utf8'));
      const n = seen.length;
      void (n === 1 ? gate : Promise.resolve()).then(() => {
        const text = DIFF;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } }));
      });
    });
  });
  await new Promise<void>((r) => provider.listen(0, '127.0.0.1', () => r()));
  const baseUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;

  const server = await createRepoServer(A, { webDist: undefined, userConfigDir: store, recentStoreDir: store, browseRoot: home });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const json = { 'content-type': 'application/json' };
  try {
    await fetch(`${base}/api/ai-config`, { method: 'PUT', headers: json, body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'claude-test', apiKey: 'sk-ant-test-SWITCH-1' }) });
    const started = await fetch(`${base}/api/sessions/${id}/goal-run`, { method: 'POST', headers: json, body: JSON.stringify({ permission: 'build' }) });
    assert.strictEqual(started.status, 200, await started.clone().text());
    for (let i = 0; i < 100 && seen.length < 1; i += 1) await sleep(100);
    assert.ok(seen.length >= 1, 'the first provider call is in flight');

    const att = await fetch(`${base}/api/attach`, { method: 'POST', headers: json, body: JSON.stringify({ path: B }) });
    assert.strictEqual(att.status, 200, await att.clone().text());
    release();

    for (let i = 0; i < 50 && fs.readFileSync(path.join(A, F), 'utf8') === BEFORE && fs.readFileSync(path.join(B, F), 'utf8') === BEFORE; i += 1) await sleep(100);
    assert.notStrictEqual(fs.readFileSync(path.join(A, F), 'utf8'), BEFORE, 'the edit landed in repo A');
    assert.strictEqual(fs.readFileSync(path.join(B, F), 'utf8'), BEFORE, 'and repo B is untouched');
    assert.ok(fs.existsSync(path.join(A, '.sequence', 'checkpoints', id)), "the turn's restore point was taken in repo A");
    assert.ok(!fs.existsSync(path.join(B, '.sequence', 'checkpoints', id)), 'and none in B');
  } finally {
    await fetch(`${base}/api/sessions/${id}/goal-run/stop?repoPath=${encodeURIComponent(A)}`, { method: 'POST' }).catch(() => {});
    for (let i = 0; i < 50 && goalRunState(A, id).running; i += 1) await sleep(100);
    release();
    await new Promise<void>((r) => provider.close(() => r()));
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
