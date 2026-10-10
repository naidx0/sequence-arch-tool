import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { claimAutoResume, declineAutoResume } from '../server/autoResume.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

/* Usage-limit auto resume: one sender per chat and limit window, and Don't sticks. */

function chat() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-auto-')));
  return { root, chatId: ensureSessionsMigrated(root).activeId };
}

test('the first asker per chat and window gets the claim, others and later windows get no', () => {
  const c = chat();
  assert.strictEqual(claimAutoResume(c.root, c.chatId, 1000), true);
  assert.strictEqual(claimAutoResume(c.root, c.chatId, 1000), false, 'a second window for the same limit');
  assert.strictEqual(claimAutoResume(c.root, c.chatId, 9000), true, 'a later limit is a new window');
  assert.strictEqual(claimAutoResume(c.root, 'not-a-chat', 1000), false);
  assert.strictEqual(claimAutoResume(c.root, c.chatId, NaN), false);
});

test('Don\'t is for that limit window only: the next limit continues again, and it survives a new server', async () => {
  const c = chat();
  assert.strictEqual(declineAutoResume(c.root, c.chatId, 5000), true);
  assert.strictEqual(claimAutoResume(c.root, c.chatId, 5000), false);
  assert.strictEqual(claimAutoResume(c.root, c.chatId, 99_000), true, 'a later limit is not declined');
  const store = path.join(c.root, '.sequence');
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const post = async (body: unknown) => (await (await fetch(`${base}/api/acp/auto-resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as Record<string, unknown>;
  try {
    assert.deepStrictEqual(await post({ chatId: c.chatId, resetsAt: 5000 }), { claimed: false });
    const d = chat();
    const store2 = path.join(d.root, '.sequence');
    const s2 = await createRepoServer(null, { webDist: undefined, userConfigDir: store2 });
    await new Promise<void>((r) => s2.listen(0, '127.0.0.1', () => r()));
    const a2 = s2.address();
    const b2 = `http://127.0.0.1:${typeof a2 === 'object' && a2 ? a2.port : 0}`;
    const p2 = async (body: unknown) => (await (await fetch(`${b2}/api/acp/auto-resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as Record<string, unknown>;
    assert.deepStrictEqual(await p2({ chatId: d.chatId, resetsAt: 7000 }), { claimed: true });
    assert.deepStrictEqual(await p2({ chatId: d.chatId, resetsAt: 7000 }), { claimed: false });
    assert.deepStrictEqual(await p2({ chatId: d.chatId, resetsAt: 8000, decline: true }), { declined: true });
    assert.deepStrictEqual(await p2({ chatId: d.chatId, resetsAt: 8000 }), { claimed: false });
    assert.deepStrictEqual(await p2({ chatId: d.chatId, resetsAt: 9000 }), { claimed: true });
    await new Promise<void>((r) => (s2.close(() => r()), (s2 as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()));
  } finally {
    await new Promise<void>((r) => (server.close(() => r()), (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()));
  }
});

test('POST /api/acp/stop answers for an unknown turn and refuses a body without one', async () => {
  const c = chat();
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: path.join(c.root, '.sequence') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const post = (body: unknown) => fetch(`${base}/api/acp/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ok = await post({ turnId: 'nope' });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(await ok.json(), { stopped: false });
    assert.strictEqual((await post({})).status, 400);
  } finally {
    await new Promise<void>((r) => (server.close(() => r()), (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()));
  }
});
