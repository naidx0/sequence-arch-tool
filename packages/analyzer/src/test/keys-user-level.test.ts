import assert from 'node:assert';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir, writeJson, writeUserJson } from '../server/store.js';
import { NEGATIVE_TTL_MS, ensureSequenceIgnored, resetSequenceIgnoredCheck, sequenceIgnoreStats } from '../server/sequenceIgnore.js';
import {
  HELD_KEYS_ENV,
  extractKeys,
  fillHeldKeys,
  fillRepoKeys,
  migrateRepoAiConfig,
  readRepoKeys,
  stripHeldKeys,
} from '../server/aiKeyStore.js';
import { loadAuthConfig } from '../server/auth.js';
import { signSession, verifySession, SESSION_COOKIE } from '../server/session.js';
import { userBrowseSubdir } from '../server/store.js';

/*
 * 0.1.8.1 B3 (audit H4): API keys live at user level only, never in
 * <repo>/.sequence. Locks: save goes user-level, an existing repo key is
 * migrated out on load, nothing `sk-`-shaped is left under <repo>/.sequence,
 * the user store is 0o600 in a 0o700 dir, git ignores .sequence/ before the
 * first write, and the desktop vault's keys are filled in / stripped by slot.
 * Every key here is a fake (`sk-test-…`).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const FAKE_KEY = 'sk-test-000-fake-key-for-b3';

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function repoCopy(): string {
  const dir = path.join(tmp('seq-b3-'), 'repo');
  fs.cpSync(TICKETING, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.sequence`) });
  return dir;
}

/** Every file under <repo>/.sequence that contains `sk-` (the acceptance grep). */
function skFilesUnder(dir: string): string[] {
  const hits: string[] = [];
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (fs.readFileSync(p, 'utf8').includes('sk-')) hits.push(p);
    }
  };
  walk(dir);
  return hits;
}

async function start(repo: string, userConfigDir: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => (server as http.Server).close(() => r())),
  };
}

test('B3: a key saved with a TRUSTED repo attached is stored user-level; <repo>/.sequence holds no sk- secret', async () => {
  const repo = repoCopy();
  const userDir = tmp('seq-b3-user-');
  setRepoTrust(userStoreDir(), repo, true);
  const { base, close } = await start(repo, userDir);
  try {
    const put = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: 'http://127.0.0.1:9', model: 'claude-test', apiKey: FAKE_KEY }),
    });
    assert.strictEqual(put.status, 200);
    assert.ok(fs.readFileSync(path.join(userDir, 'ai.json'), 'utf8').includes(FAKE_KEY), 'the key is in the user store');
    assert.deepStrictEqual(skFilesUnder(path.join(repo, '.sequence')), [], 'grep -r sk- <repo>/.sequence is empty');
    const get = (await (await fetch(`${base}/api/ai-config`)).json()) as { configured: boolean; apiKey: string };
    assert.strictEqual(get.configured, true, 'the saved config applies with the repo attached');
    assert.ok(!get.apiKey.includes(FAKE_KEY));
  } finally {
    await close();
  }
});

test('B3: on load, a key an older build wrote into a trusted repo moves to user-level repo-keys.json and is stripped from the repo; the repo config still answers', async () => {
  const repo = repoCopy();
  const userDir = tmp('seq-b3-user-');
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', baseUrl: 'http://127.0.0.1:9', model: 'claude-old', apiKey: FAKE_KEY }, null, 2),
  );
  setRepoTrust(userStoreDir(), repo, true);
  const { base, close } = await start(repo, userDir);
  try {
    assert.deepStrictEqual(skFilesUnder(path.join(repo, '.sequence')), [], 'no sk- left under <repo>/.sequence after migrate');
    assert.ok(fs.readFileSync(path.join(userDir, 'repo-keys.json'), 'utf8').includes(FAKE_KEY), 'the key moved to the user store');
    assert.ok(!fs.existsSync(path.join(userDir, 'ai.json')), 'the repo config is NOT adopted as the user\'s own');
    const get = (await (await fetch(`${base}/api/ai-config`)).json()) as { configured: boolean; model: string };
    assert.strictEqual(get.configured, true, 'the repo config still applies on this repo, key filled back');
    assert.strictEqual(get.model, 'claude-old');
  } finally {
    await close();
  }
});

/* ── review B, blocker 1: no key is ever lost, nothing of the user's changes ── */

function repoWith(cfg: unknown): { repo: string; file: string } {
  const repo = repoCopy();
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  const file = path.join(repo, '.sequence', 'ai.json');
  fs.writeFileSync(file, JSON.stringify(cfg));
  return { repo, file };
}

const BASE = { provider: 'anthropic', baseUrl: 'http://127.0.0.1:9', model: 'claude-test' };

test('review B: a user config in default mode keeps the repo key (it moves, the user config is untouched)', () => {
  const userDir = tmp('seq-rb-user-');
  const userCfg = JSON.stringify({ mode: 'default', provider: 'openrouter', model: 'x' });
  fs.writeFileSync(path.join(userDir, 'ai.json'), userCfg);
  const { repo, file } = repoWith({ ...BASE, apiKey: 'sk-test-REPO1' });
  assert.strictEqual(migrateRepoAiConfig(repo, userDir, true), 'moved');
  assert.deepStrictEqual(Object.values(readRepoKeys(userDir, repo)), ['sk-test-REPO1'], 'the key is kept');
  assert.strictEqual(fs.readFileSync(path.join(userDir, 'ai.json'), 'utf8'), userCfg, 'the user config is byte-for-byte unchanged');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-'));
  assert.strictEqual((fillRepoKeys(JSON.parse(fs.readFileSync(file, 'utf8')), userDir, repo) as { apiKey?: string }).apiKey, 'sk-test-REPO1');
});

test('review B: a repo roles key survives when the user already has a config', () => {
  const userDir = tmp('seq-rb-user-');
  fs.writeFileSync(path.join(userDir, 'ai.json'), JSON.stringify({ ...BASE, apiKey: 'sk-test-USER' }));
  const repoCfg = { ...BASE, apiKey: 'sk-test-MAIN', roles: { advisor: { provider: 'anthropic', baseUrl: 'http://127.0.0.1:8', model: 'm2', apiKey: 'sk-test-ROLE' } } };
  const { repo, file } = repoWith(repoCfg);
  assert.strictEqual(migrateRepoAiConfig(repo, userDir, true), 'moved');
  assert.deepStrictEqual(Object.values(readRepoKeys(userDir, repo)).sort(), ['sk-test-MAIN', 'sk-test-ROLE']);
  assert.deepStrictEqual(Object.values(extractKeys(JSON.parse(fs.readFileSync(path.join(userDir, 'ai.json'), 'utf8')))), ['sk-test-USER'], 'the user key is untouched');
  const back = fillRepoKeys(JSON.parse(fs.readFileSync(file, 'utf8')), userDir, repo);
  assert.deepStrictEqual(extractKeys(back), extractKeys(repoCfg), 'every key, roles included, comes back for this repo');
});

test('review B: three repos each keep their key (no id can collide, nothing fails forever)', () => {
  const userDir = tmp('seq-rb-user-');
  const repos = ['A', 'B', 'C'].map((k) => ({ k, ...repoWith({ ...BASE, apiKey: `sk-test-${k}` }) }));
  for (const r of repos) assert.strictEqual(migrateRepoAiConfig(r.repo, userDir, true), 'moved', r.k);
  for (const r of repos) {
    assert.deepStrictEqual(Object.values(readRepoKeys(userDir, r.repo)), [`sk-test-${r.k}`]);
    assert.ok(!fs.readFileSync(r.file, 'utf8').includes('sk-'));
  }
  assert.ok(!fs.existsSync(path.join(userDir, 'ai.json')), 'no user config was invented');
});

test('review B: when the key store cannot be written the repo file is left untouched ("failed")', () => {
  const top = tmp('seq-rb-');
  const notADir = path.join(top, 'user-store');
  fs.writeFileSync(notADir, 'a file where the store directory should be');
  const original = JSON.stringify({ ...BASE, apiKey: 'sk-test-KEEP' });
  const { repo, file } = repoWith(JSON.parse(original));
  assert.strictEqual(migrateRepoAiConfig(repo, notADir, true), 'failed');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), original, 'the only copy of the key stays where it was');
});

test('review B: an untrusted repo is never touched', () => {
  const userDir = tmp('seq-rb-user-');
  const original = JSON.stringify({ ...BASE, apiKey: 'sk-test-THEIRS' });
  const { repo, file } = repoWith(JSON.parse(original));
  assert.strictEqual(migrateRepoAiConfig(repo, userDir, false), 'none');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
  assert.deepStrictEqual(readRepoKeys(userDir, repo), {});
});

test('review B: a trusted repo config never becomes the user default; the user config wins where it exists', async () => {
  const userDir = tmp('seq-rb-user-');
  fs.writeFileSync(path.join(userDir, 'ai.json'), JSON.stringify({ provider: 'anthropic', baseUrl: 'http://127.0.0.1:7', model: 'users-own', apiKey: 'sk-test-USER' }));
  const { repo } = repoWith({ provider: 'anthropic', baseUrl: 'http://127.0.0.1:9', model: 'repos-model', apiKey: 'sk-test-REPO' });
  setRepoTrust(userStoreDir(), repo, true);
  const { base, close } = await start(repo, userDir);
  try {
    const get = (await (await fetch(`${base}/api/ai-config`)).json()) as { model: string; baseUrl: string };
    assert.strictEqual(get.model, 'users-own', 'the user\'s active provider is not switched');
    assert.strictEqual(get.baseUrl, 'http://127.0.0.1:7');
    assert.ok(!fs.readFileSync(path.join(userDir, 'ai.json'), 'utf8').includes('repos-model'));
  } finally {
    await close();
  }
});

test('review B (hosted): one tenant\'s saved key is never another tenant\'s config', async () => {
  const authConfig = loadAuthConfig({
    GOOGLE_CLIENT_ID: 'g-id',
    GOOGLE_CLIENT_SECRET: 'g-secret',
    SESSION_SECRET: 'sess-secret-b3',
    PUBLIC_BASE_URL: 'https://app.example.com',
  } as NodeJS.ProcessEnv);
  const browseRoot = tmp('seq-rb-browse-');
  const userDir = tmp('seq-rb-user-');
  const cookie = (id: string) => `${SESSION_COOKIE}=${encodeURIComponent(signSession({ userId: id, provider: 'google' }, authConfig.sessionSecret))}`;
  const A = cookie('google:AAA');
  const B = cookie('google:BBB');
  for (const [id, name] of [['google:AAA', 'pa'], ['google:BBB', 'pb']] as const) {
    const jail = userBrowseSubdir(browseRoot, id);
    fs.mkdirSync(jail, { recursive: true });
    fs.cpSync(TICKETING, path.join(jail, name), { recursive: true });
  }
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot,
    userConfigDir: userDir,
    recentStoreDir: userDir,
    authConfig,
    resolveIdentity: (req: http.IncomingMessage) => verifySession(req.headers.cookie, authConfig.sessionSecret)?.userId,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const call = (c: string, route: string, method = 'GET', body?: unknown) =>
    fetch(`${base}${route}`, { method, headers: { cookie: c, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.strictEqual((await call(A, '/api/attach', 'POST', { path: path.join(userBrowseSubdir(browseRoot, 'google:AAA'), 'pa') })).status, 200);
    assert.strictEqual((await call(A, '/api/ai-config', 'PUT', { ...BASE, apiKey: 'sk-test-TENANT-A' })).status, 200);
    assert.strictEqual((await call(B, '/api/attach', 'POST', { path: path.join(userBrowseSubdir(browseRoot, 'google:BBB'), 'pb') })).status, 200);
    const bView = (await (await call(B, '/api/ai-config')).json()) as { configured: boolean };
    assert.strictEqual(bView.configured, false, "B does not get A's config or key");
    assert.ok(!fs.existsSync(path.join(userDir, 'ai.json')), 'nothing written to the shared user dir');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('B3: the user store is 0o600 files in a 0o700 dir', (t) => {
  const userDir = path.join(tmp('seq-b3-mode-'), 'store');
  fs.mkdirSync(userDir, { mode: 0o755 });
  fs.writeFileSync(path.join(userDir, 'ai.json'), '{}', { mode: 0o644 });
  writeUserJson(userDir, 'ai.json', { apiKey: FAKE_KEY });
  assert.ok(fs.readFileSync(path.join(userDir, 'ai.json'), 'utf8').includes(FAKE_KEY), 'the write itself ran');
  if (process.platform === 'win32') {
    /* Windows has no POSIX mode bits: Node maps chmod to the read-only flag and
       stat reports 0o666/0o777 whatever was asked. The profile folder's ACL is
       the protection there. The write path above ran the same code. */
    t.diagnostic('mode bits not asserted on win32 (no POSIX permissions); logic exercised above');
    return;
  }
  assert.strictEqual(fs.statSync(path.join(userDir, 'ai.json')).mode & 0o777, 0o600, 'file 0o600 (an old 0644 file is tightened)');
  assert.strictEqual(fs.statSync(userDir).mode & 0o777, 0o700, 'dir 0o700 (an old 0755 dir is tightened)');
});

test('B3: git is told to ignore .sequence/ by the first .sequence write (in the background, never on the event loop)', async () => {
  const repo = path.join(tmp('seq-b3-git-'), 'repo');
  fs.mkdirSync(repo);
  const git = childProcess.spawnSync('git', ['init', '-q', repo], { encoding: 'utf8', windowsHide: true });
  if (git.status !== 0) return; // no git on this machine: nothing to ignore
  resetSequenceIgnoredCheck();
  const exclude = path.join(repo, '.git', 'info', 'exclude');
  const before = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  assert.ok(!before.split(/\r?\n/).includes('.sequence/'), 'precondition: not ignored yet');
  writeJson(repo, 'anything.json', { a: 1 });
  /* The check runs off the event loop (a write to a new root used to spawn git synchronously): wait for it to land. */
  for (let i = 0; i < 250 && !(fs.existsSync(exclude) && fs.readFileSync(exclude, 'utf8').split(/\r?\n/).includes('.sequence/')); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(fs.readFileSync(exclude, 'utf8').split(/\r?\n/).includes('.sequence/'), '.sequence/ is in .git/info/exclude');
  const check = childProcess.spawnSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true });
  assert.ok(!check.stdout.includes('.sequence'), `git status does not list .sequence: ${check.stdout}`);
});

test('B3: the desktop vault\'s keys are filled in by slot on read and left out on write', () => {
  const cfg = {
    profiles: [
      { id: 'claude', name: 'C', provider: 'anthropic', model: 'x', apiKey: FAKE_KEY },
      { id: 'local', name: 'L', provider: 'openai-compatible', model: 'm', baseUrl: 'http://127.0.0.1:11434/v1/' },
    ],
    defaultProfileId: 'claude',
  };
  const held = extractKeys(cfg);
  assert.deepStrictEqual(held, { 'profile:claude|anthropic|': FAKE_KEY });
  const stripped = stripHeldKeys(cfg, held) as typeof cfg;
  assert.ok(!JSON.stringify(stripped).includes(FAKE_KEY), 'a vault-held key is not written');
  const filled = fillHeldKeys(stripped, held) as typeof cfg;
  assert.strictEqual(filled.profiles[0]!.apiKey, FAKE_KEY, 'and is filled back on read');
  /* A profile re-pointed at another address does not get the old key. */
  const moved = { ...stripped, profiles: [{ ...stripped.profiles[0]!, baseUrl: 'https://elsewhere.example' }] };
  assert.strictEqual((fillHeldKeys(moved, held) as typeof cfg).profiles[0]!.apiKey, undefined);
  /* A key the vault does not hold yet stays in the file (the 0o600 fallback). */
  const other = { ...cfg, profiles: [{ ...cfg.profiles[0]!, apiKey: 'sk-test-new' }] };
  assert.ok(JSON.stringify(stripHeldKeys(other, held)).includes('sk-test-new'));
  assert.strictEqual(HELD_KEYS_ENV, 'SEQUENCE_AI_KEYS');
});

test('B3: with SEQUENCE_AI_KEYS set, the server answers from a keyless user file', async () => {
  const userDir = tmp('seq-b3-user-');
  writeUserJson(userDir, 'ai.json', { provider: 'anthropic', baseUrl: 'http://127.0.0.1:9', model: 'claude-test' });
  const prev = process.env[HELD_KEYS_ENV];
  process.env[HELD_KEYS_ENV] = JSON.stringify({ '$|anthropic|http://127.0.0.1:9': FAKE_KEY });
  const { base, close } = await start(null as unknown as string, userDir);
  try {
    assert.strictEqual(process.env[HELD_KEYS_ENV], undefined, 'taken out of the env: no child the server starts inherits the keys');
    const get = (await (await fetch(`${base}/api/ai-config`)).json()) as { configured: boolean; apiKey?: string };
    assert.strictEqual(get.configured, true, 'the vault key completes the config');
    assert.ok(get.apiKey && get.apiKey.endsWith(FAKE_KEY.slice(-4)) && !get.apiKey.includes(FAKE_KEY));
  } finally {
    if (prev === undefined) delete process.env[HELD_KEYS_ENV];
    else process.env[HELD_KEYS_ENV] = prev;
    await close();
  }
});

test('review B: a root git cannot answer for is not asked again on every .sequence write (for a minute)', () => {
  const root = tmp('seq-rb-nogit-');
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: ./no-such-git-dir\n');
  resetSequenceIgnoredCheck();
  const t0 = Date.now();
  ensureSequenceIgnored(root, t0);
  ensureSequenceIgnored(root, t0 + 1000);
  writeJson(root, 'x.json', { a: 1 });
  assert.strictEqual(sequenceIgnoreStats.gitCalls, 1, 'git was spawned once, not once per write');
  ensureSequenceIgnored(root, t0 + NEGATIVE_TTL_MS + 1);
  assert.strictEqual(sequenceIgnoreStats.gitCalls, 2, 'and asked again after the negative TTL');
});
