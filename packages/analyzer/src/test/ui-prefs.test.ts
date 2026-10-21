import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadAuthConfig } from '../server/auth.js';
import { signSession, verifySession, SESSION_COOKIE } from '../server/session.js';
import { createRepoServer } from '../server/repoServer.js';
import { isUiPrefKey, patchUiPrefs, readUiPrefs, UI_PREFS_FILE } from '../server/uiPrefs.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ui-prefs-'));

test('uiPrefs: sets, reads back, removes with null, and writes ui-prefs.json', () => {
  const dir = tmp();
  assert.deepStrictEqual(readUiPrefs(dir), {});
  const r = patchUiPrefs(dir, { prefs: { 'seq.theme': 'light', 'sequence:pq:v2:home::c1': '{"items":[]}' } });
  assert.ok(r.ok);
  assert.deepStrictEqual(readUiPrefs(dir), { 'seq.theme': 'light', 'sequence:pq:v2:home::c1': '{"items":[]}' });
  assert.ok(fs.existsSync(path.join(dir, UI_PREFS_FILE)));
  patchUiPrefs(dir, { prefs: { 'seq.theme': null } });
  assert.deepStrictEqual(Object.keys(readUiPrefs(dir)), ['sequence:pq:v2:home::c1']);
});

test('uiPrefs: refuses a key outside the allowlist and writes nothing (negative control for the allowlist)', () => {
  const dir = tmp();
  const r = patchUiPrefs(dir, { prefs: { 'seq.theme': 'dark', 'github.token': 'x' } });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(readUiPrefs(dir), {});
  assert.strictEqual(isUiPrefKey('s2.panes.3'), true);
  assert.strictEqual(isUiPrefKey('s2.panes.'), false);
  assert.strictEqual(patchUiPrefs(dir, { prefs: { 'seq.theme': 5 } }).ok, false);
  assert.strictEqual(patchUiPrefs(dir, 'nope').ok, false);
});

test('GET and PUT /api/ui-prefs round-trip through the user store', async () => {
  const userConfigDir = tmp();
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    assert.deepStrictEqual(await (await fetch(`${base}/api/ui-prefs`)).json(), { prefs: {} });
    const put = await fetch(`${base}/api/ui-prefs`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefs: { 'seq.theme': 'light' } }) });
    assert.strictEqual(put.status, 200);
    assert.deepStrictEqual(await (await fetch(`${base}/api/ui-prefs`)).json(), { prefs: { 'seq.theme': 'light' } });
    const bad = await fetch(`${base}/api/ui-prefs`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefs: { evil: 'x' } }) });
    assert.strictEqual(bad.status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('under auth each user has their own ui-prefs: B does not read what A saved, and anonymous is refused', async () => {
  const authConfig = loadAuthConfig({ GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret', SESSION_SECRET: 'sess-secret-abc', PUBLIC_BASE_URL: 'https://app.example.com' });
  assert.ok(authConfig);
  const real = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
  const server = await createRepoServer(null, {
    webDist: undefined,
    userConfigDir: real('sequence-ui-prefs-auth-'),
    browseRoot: real('sequence-ui-prefs-br-'),
    recentStoreDir: real('sequence-ui-prefs-rs-'),
    authConfig,
    resolveIdentity: (req) => verifySession(req.headers.cookie, authConfig.sessionSecret)?.userId,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const cookie = (id: string): string => `${SESSION_COOKIE}=${encodeURIComponent(signSession({ userId: id, provider: 'google' }, authConfig.sessionSecret))}`;
  try {
    assert.strictEqual((await fetch(`${base}/api/ui-prefs`)).status, 401);
    const put = await fetch(`${base}/api/ui-prefs`, { method: 'PUT', headers: { cookie: cookie('google:A'), 'content-type': 'application/json' }, body: JSON.stringify({ prefs: { 'sequence:pq:v2:home::c1': '{"items":[{"text":"A SECRET"}]}' } }) });
    assert.strictEqual(put.status, 200);
    const asA = (await (await fetch(`${base}/api/ui-prefs`, { headers: { cookie: cookie('google:A') } })).json()) as { prefs: Record<string, string> };
    const asB = (await (await fetch(`${base}/api/ui-prefs`, { headers: { cookie: cookie('google:B') } })).json()) as { prefs: Record<string, string> };
    assert.deepStrictEqual(Object.keys(asA.prefs), ['sequence:pq:v2:home::c1'], 'control: A reads its own');
    assert.deepStrictEqual(asB.prefs, {}, 'B must not read A');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
