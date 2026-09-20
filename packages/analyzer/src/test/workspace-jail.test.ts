import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig, type AuthConfig } from '../server/auth.js';
import { signSession, verifySession, SESSION_COOKIE } from '../server/session.js';
import { userBrowseSubdir } from '../server/store.js';
import { gitClone, type CloneRepoFn } from '../server/gitClone.js';

/**
 * v13 Finding A (blocker) — PER-USER browse/attach/clone JAIL, plus the status
 * (Finding B) and terminal (Finding C) owner gates. This is the last multi-tenant
 * confidentiality blocker: two mutually-untrusted signed-in users must be
 * PHYSICALLY unable to browse, attach, or read each other's workspaces.
 *
 * Locks:
 *   - browse isolation: B GET /api/browse cannot see A's workspace (only B's own).
 *   - attach isolation: B POST /api/attach of A's path → 403 (jail escape).
 *   - self access: A can browse + attach A's OWN workspace → 200.
 *   - clone dest: a clone by B lands under B's OWN per-user root.
 *   - status (Finding B): anon under auth → 401; authenticated non-owner → no
 *     root/repoName; owner → full body.
 *   - terminal (Finding C): non-owner authenticated upgrade → rejected; the owner
 *     passes the ownership guard.
 *   - env-absent regression: auth OFF ⇒ browse/attach/status all behave as today
 *     (single shared os.homedir()-style root, no 401/403).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

const AUTH_ENV = {
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  SESSION_SECRET: 'sess-secret-jail',
  PUBLIC_BASE_URL: 'https://app.example.com',
} as NodeJS.ProcessEnv;

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function startServer(opts: {
  authConfig?: AuthConfig;
  browseRoot: string;
  recentStoreDir?: string;
  userConfigDir?: string;
  cloneRepo?: CloneRepoFn;
  terminalEnabled?: boolean;
}): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: opts.browseRoot,
    recentStoreDir: opts.recentStoreDir,
    userConfigDir: opts.userConfigDir,
    authConfig: opts.authConfig,
    cloneRepo: opts.cloneRepo,
    terminalEnabled: opts.terminalEnabled,
    resolveIdentity: opts.authConfig
      ? (req: http.IncomingMessage) => verifySession(req.headers.cookie, opts.authConfig!.sessionSecret)?.userId
      : undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function cookieFor(userId: string, secret: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(signSession({ userId, provider: 'google' }, secret))}`;
}

/** Build a real local git origin (plainapp content) → its file:// URL. */
function makeLocalOrigin(): { originUrl: string; originDir: string } {
  const dir = tempDir('seq-jail-origin-');
  const repo = path.join(dir, 'origin');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const git = (args: string[]): void => {
    childProcess.execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  };
  git(['init', '-q']);
  git(['add', '-A']);
  git(['-c', 'user.email=t@t.test', '-c', 'user.name=tester', 'commit', '-q', '-m', 'init']);
  return { originUrl: `file://${repo}`, originDir: dir };
}

/* ============================================ browse + attach isolation ====== */

test('per-user jail: B cannot browse or attach A\'s workspace; A can browse + attach its own', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const secret = authConfig.sessionSecret;
  const browseRoot = tempDir('seq-jail-browse-');
  const recentStoreDir = tempDir('seq-jail-recent-');
  const A = cookieFor('google:AAA', secret);
  const B = cookieFor('google:BBB', secret);

  // Seed A's jail with a real project; B's jail stays empty.
  const aJail = userBrowseSubdir(browseRoot, 'google:AAA');
  fs.mkdirSync(aJail, { recursive: true });
  fs.cpSync(TICKETING, path.join(aJail, 'projectA'), { recursive: true });
  const aProject = path.join(aJail, 'projectA');

  const { base, close } = await startServer({ authConfig, browseRoot, recentStoreDir });
  try {
    // A browses its OWN root (path='' ⇒ the caller's jail) → sees projectA.
    const aBrowse = await fetch(`${base}/api/browse`, { headers: { cookie: A } });
    assert.strictEqual(aBrowse.status, 200, 'A can browse its own root');
    const aBody = (await aBrowse.json()) as { root: string; entries: Array<{ name: string }> };
    assert.strictEqual(aBody.root, aJail, "A's browse root IS A's jail");
    assert.ok(aBody.entries.some((e) => e.name === 'projectA'), 'A sees its own projectA');

    // B browses its OWN root → empty, and crucially does NOT see A's projectA.
    const bBrowse = await fetch(`${base}/api/browse`, { headers: { cookie: B } });
    assert.strictEqual(bBrowse.status, 200, 'B can browse its own (empty) root');
    const bBody = (await bBrowse.json()) as { root: string; entries: Array<{ name: string }> };
    assert.notStrictEqual(bBody.root, aJail, "B's browse root is NOT A's jail");
    assert.strictEqual(bBody.entries.length, 0, 'B sees nothing (its jail is empty)');

    // B tries to browse INTO A's path via an absolute ?path → jail escape (403).
    const bPeek = await fetch(`${base}/api/browse?path=${encodeURIComponent(aProject)}`, { headers: { cookie: B } });
    assert.strictEqual(bPeek.status, 403, "B cannot browse A's absolute path");

    // A attaches its own project → 200.
    const aAttach = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { cookie: A, 'content-type': 'application/json' },
      body: JSON.stringify({ path: aProject }),
    });
    assert.strictEqual(aAttach.status, 200, 'A can attach its own project');

    // B attaches A's path → 403 (never resolves into A's tree). No takeover.
    const bAttach = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { cookie: B, 'content-type': 'application/json' },
      body: JSON.stringify({ path: aProject }),
    });
    assert.strictEqual(bAttach.status, 403, "B cannot attach A's path");
    assert.match(((await bAttach.json()) as { error: string }).error, /escapes the browse root/);

    // A still owns it (B's failed attach did not re-set ownership): A reads 200.
    assert.strictEqual((await fetch(`${base}/api/tree`, { headers: { cookie: A } })).status, 200, 'A still owns');
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(recentStoreDir, { recursive: true, force: true });
  }
});

/* ============================================ recents are per-user =========== */

test('per-user recents: B GET /api/recent never shows A\'s repo; A sees its own; anon → 401', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const secret = authConfig.sessionSecret;
  const browseRoot = tempDir('seq-jail-browse-');
  const recentStoreDir = tempDir('seq-jail-recent-');
  const A = cookieFor('google:AAA', secret);
  const B = cookieFor('google:BBB', secret);

  // Seed each user's jail with its own project.
  const aJail = userBrowseSubdir(browseRoot, 'google:AAA');
  const bJail = userBrowseSubdir(browseRoot, 'google:BBB');
  fs.mkdirSync(aJail, { recursive: true });
  fs.mkdirSync(bJail, { recursive: true });
  fs.cpSync(TICKETING, path.join(aJail, 'projectA'), { recursive: true });
  fs.cpSync(TICKETING, path.join(bJail, 'projectB'), { recursive: true });

  const { base, close } = await startServer({ authConfig, browseRoot, recentStoreDir });
  try {
    // A attaches its own project → recorded in A's recents.
    const aAttach = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { cookie: A, 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(aJail, 'projectA') }),
    });
    assert.strictEqual(aAttach.status, 200);

    // A sees its OWN repo in recents.
    const aRecent = (await (await fetch(`${base}/api/recent`, { headers: { cookie: A } })).json()) as {
      recent: Array<{ path: string; name: string }>;
    };
    assert.ok(aRecent.recent.some((r) => r.path === path.join(aJail, 'projectA')), 'A sees its own repo');

    // B (a different tenant) sees NOTHING of A's — no path, no name leaked.
    const bRecent = (await (await fetch(`${base}/api/recent`, { headers: { cookie: B } })).json()) as {
      recent: Array<{ path: string; name: string }>;
    };
    assert.ok(
      !bRecent.recent.some((r) => r.path.startsWith(aJail)),
      "B's recents must not contain any path under A's jail"
    );
    assert.strictEqual(bRecent.recent.length, 0, 'B has attached nothing → empty recents');

    // B attaches ITS OWN project; A's recents are still only A's.
    await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { cookie: B, 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(bJail, 'projectB') }),
    });
    const bRecent2 = (await (await fetch(`${base}/api/recent`, { headers: { cookie: B } })).json()) as {
      recent: Array<{ path: string; name: string }>;
    };
    assert.deepStrictEqual(
      bRecent2.recent.map((r) => r.path),
      [path.join(bJail, 'projectB')],
      'B sees only its own repo'
    );
    const aRecent2 = (await (await fetch(`${base}/api/recent`, { headers: { cookie: A } })).json()) as {
      recent: Array<{ path: string; name: string }>;
    };
    assert.deepStrictEqual(
      aRecent2.recent.map((r) => r.path),
      [path.join(aJail, 'projectA')],
      "A still sees only its own repo (B's attach never leaked in)"
    );

    // Anonymous under auth → 401 (SENSITIVE).
    assert.strictEqual((await fetch(`${base}/api/recent`)).status, 401, 'anon /api/recent is 401 under auth');
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(recentStoreDir, { recursive: true, force: true });
  }
});

test('per-user recents: auth OFF ⇒ shared recents byte-identical (a local attach is listed)', async () => {
  const browseRoot = tempDir('seq-jail-browse-');
  const recentStoreDir = tempDir('seq-jail-recent-');
  const userConfigDir = tempDir('seq-jail-home-');
  fs.cpSync(TICKETING, path.join(browseRoot, 'projectLocal'), { recursive: true });

  // No authConfig ⇒ auth OFF ⇒ shared recentStoreDir + shared browseRoot.
  const { base, close } = await startServer({ browseRoot, recentStoreDir, userConfigDir });
  try {
    await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(browseRoot, 'projectLocal') }),
    });
    // /api/recent is reachable anonymously (no auth) and lists the local attach.
    const recent = (await (await fetch(`${base}/api/recent`)).json()) as {
      recent: Array<{ path: string; name: string }>;
    };
    assert.ok(
      recent.recent.some((r) => r.path === path.join(browseRoot, 'projectLocal')),
      'local recents list the shared attach'
    );
    // The shared recent.json lives DIRECTLY under the store dir (no per-user subdir).
    assert.ok(fs.existsSync(path.join(recentStoreDir, 'recent.json')), 'shared recent.json at the store root');
    assert.ok(!fs.existsSync(path.join(recentStoreDir, 'sequence-users')), 'no per-user recents dir in local mode');
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(recentStoreDir, { recursive: true, force: true });
    fs.rmSync(userConfigDir, { recursive: true, force: true });
  }
});

/* ============================================ clone lands in caller's jail === */

test('per-user jail: a clone by B lands under B\'s OWN per-user root', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const secret = authConfig.sessionSecret;
  const browseRoot = tempDir('seq-jail-browse-');
  const userConfigDir = tempDir('seq-jail-home-');
  const { originUrl, originDir } = makeLocalOrigin();
  const B = cookieFor('google:BBB', secret);
  const cloneRepo: CloneRepoFn = (_u, dest, token) => gitClone(originUrl, dest, token);

  const { base, close } = await startServer({ authConfig, browseRoot, userConfigDir, cloneRepo });
  try {
    const res = await fetch(`${base}/api/github/clone`, {
      method: 'POST',
      headers: { cookie: B, 'content-type': 'application/json' },
      body: JSON.stringify({ cloneUrl: 'https://github.com/acme/widget.git' }),
    });
    assert.strictEqual(res.status, 200, 'B can clone into its own jail');
    const body = (await res.json()) as { attached: boolean; clonedTo: string };
    assert.strictEqual(body.attached, true);

    // The clone MUST be under B's own per-user workspaces dir — not the shared root.
    const bJail = userBrowseSubdir(browseRoot, 'google:BBB');
    const bWorkspaces = path.join(bJail, 'sequence-workspaces');
    assert.ok(
      body.clonedTo.startsWith(bWorkspaces + path.sep),
      `clone must land under B's jail (${bWorkspaces}), got ${body.clonedTo}`
    );
    assert.ok(fs.existsSync(path.join(body.clonedTo, '.git')), 'a real clone is on disk');
    // It is NOT under the shared browse root's own sequence-workspaces dir.
    assert.ok(
      !body.clonedTo.startsWith(path.join(browseRoot, 'sequence-workspaces') + path.sep),
      'clone must NOT land in the shared workspaces dir'
    );
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(userConfigDir, { recursive: true, force: true });
    fs.rmSync(originDir, { recursive: true, force: true });
  }
});

/* ============================================ status owner-gating (Finding B) = */

test('Finding B — /api/status: anon under auth → 401; non-owner → minimal; owner → full', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const secret = authConfig.sessionSecret;
  const browseRoot = tempDir('seq-jail-browse-');
  const recentStoreDir = tempDir('seq-jail-recent-');
  const A = cookieFor('google:AAA', secret);
  const B = cookieFor('google:BBB', secret);

  const aJail = userBrowseSubdir(browseRoot, 'google:AAA');
  fs.mkdirSync(aJail, { recursive: true });
  fs.cpSync(TICKETING, path.join(aJail, 'projectA'), { recursive: true });

  const { base, close } = await startServer({ authConfig, browseRoot, recentStoreDir });
  try {
    // Anonymous under auth → 401 (SENSITIVE now).
    const anon = await fetch(`${base}/api/status`);
    assert.strictEqual(anon.status, 401, 'anon /api/status is 401 under auth');

    // A attaches → becomes owner.
    await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { cookie: A, 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(aJail, 'projectA') }),
    });

    // Owner A → full body (repoName + absolute root).
    const ownerStatus = (await (await fetch(`${base}/api/status`, { headers: { cookie: A } })).json()) as {
      attached: boolean;
      repoName?: string;
      root?: string;
    };
    assert.strictEqual(ownerStatus.attached, true);
    assert.ok(typeof ownerStatus.repoName === 'string' && ownerStatus.repoName.length > 0, 'owner sees repoName');
    assert.ok(typeof ownerStatus.root === 'string' && ownerStatus.root.length > 0, 'owner sees root path');

    // Non-owner B (authenticated) → minimal body, NO name/path leak.
    const nonOwnerStatus = (await (await fetch(`${base}/api/status`, { headers: { cookie: B } })).json()) as {
      attached: boolean;
      repoName?: string;
      root?: string;
    };
    assert.strictEqual(nonOwnerStatus.attached, true, 'non-owner still learns a repo is attached');
    assert.strictEqual(nonOwnerStatus.repoName, undefined, 'non-owner does NOT get repoName');
    assert.strictEqual(nonOwnerStatus.root, undefined, 'non-owner does NOT get the server path');
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(recentStoreDir, { recursive: true, force: true });
  }
});

/* ============================================ terminal owner gate (Finding C) = */

/** Attempt a WS upgrade to /api/terminal; resolve the outcome status code. */
function tryTerminalUpgrade(base: string, cookie?: string): Promise<{ upgraded: boolean; status: number }> {
  const u = new URL(base);
  return new Promise((resolve) => {
    const req = http.request({
      host: u.hostname,
      port: Number(u.port),
      path: '/api/terminal',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...(cookie ? { cookie } : {}),
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ upgraded: true, status: res.statusCode ?? 101 });
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ upgraded: false, status: res.statusCode ?? 0 });
    });
    req.on('error', () => resolve({ upgraded: false, status: 0 }));
    req.end();
  });
}

test('Finding C — terminal upgrade: non-owner authenticated → rejected; owner passes the ownership guard', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const secret = authConfig.sessionSecret;
  const browseRoot = tempDir('seq-jail-browse-');
  const recentStoreDir = tempDir('seq-jail-recent-');
  const A = cookieFor('google:AAA', secret);
  const B = cookieFor('google:BBB', secret);

  const aJail = userBrowseSubdir(browseRoot, 'google:AAA');
  fs.mkdirSync(aJail, { recursive: true });
  fs.cpSync(TICKETING, path.join(aJail, 'projectA'), { recursive: true });

  // terminalEnabled: false ⇒ the DISABLE switch (in attachTerminal) rejects with
  // 403. So a caller that PASSES the ownership guard hits 403 ("terminal disabled"),
  // while a caller REJECTED by the ownership guard gets 401 ("auth required"). The
  // 401-vs-403 split cleanly proves the guard without spawning any shell.
  const { base, close } = await startServer({ authConfig, browseRoot, recentStoreDir, terminalEnabled: false });
  try {
    // A attaches → owner recorded = google:AAA.
    await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { cookie: A, 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(aJail, 'projectA') }),
    });

    // Anonymous → rejected by the ownership/auth guard (401), never upgraded.
    const anon = await tryTerminalUpgrade(base);
    assert.strictEqual(anon.upgraded, false, 'anonymous upgrade is refused');
    assert.strictEqual(anon.status, 401, 'anonymous → 401 (ownership guard)');

    // Non-owner B (authenticated) → rejected by the ownership guard (401).
    const nonOwner = await tryTerminalUpgrade(base, B);
    assert.strictEqual(nonOwner.upgraded, false, 'non-owner upgrade is refused');
    assert.strictEqual(nonOwner.status, 401, 'non-owner → 401 (ownership guard)');

    // Owner A → PASSES the ownership guard; only the disable switch stops it (403).
    const owner = await tryTerminalUpgrade(base, A);
    assert.strictEqual(owner.upgraded, false, 'terminal is disabled in this test');
    assert.strictEqual(owner.status, 403, 'owner → 403 (passed ownership guard, hit disable switch)');
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(recentStoreDir, { recursive: true, force: true });
  }
});

/* ============================================ env-absent regression ========== */

test('env-absent regression: auth OFF ⇒ browse/attach/status behave as today (shared root, no 401/403)', async () => {
  const browseRoot = tempDir('seq-jail-browse-');
  const recentStoreDir = tempDir('seq-jail-recent-');
  const userConfigDir = tempDir('seq-jail-home-');
  // A project directly under the shared browse root (the single-user local layout).
  fs.cpSync(TICKETING, path.join(browseRoot, 'projectLocal'), { recursive: true });

  // No authConfig ⇒ auth OFF ⇒ the whole jail is a no-op (byte-identical local path).
  const { base, close } = await startServer({ browseRoot, recentStoreDir, userConfigDir });
  try {
    // Browse the shared root with NO cookie → lists projectLocal (root === browseRoot).
    const browse = await fetch(`${base}/api/browse`);
    assert.strictEqual(browse.status, 200);
    const bBody = (await browse.json()) as { root: string; entries: Array<{ name: string }> };
    assert.strictEqual(bBody.root, browseRoot, 'local browse root is the shared browse root');
    assert.ok(bBody.entries.some((e) => e.name === 'projectLocal'), 'local sees the shared project');

    // Attach with no session works (single-user local), repo is unowned/shared.
    const attach = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(browseRoot, 'projectLocal') }),
    });
    assert.strictEqual(attach.status, 200, 'local attach works with no session');

    // /api/status is PUBLIC + FULL in local mode (no 401, full body with root).
    const status = (await (await fetch(`${base}/api/status`)).json()) as {
      attached: boolean;
      repoName?: string;
      root?: string;
    };
    assert.strictEqual(status.attached, true);
    assert.ok(typeof status.repoName === 'string' && status.repoName.length > 0, 'local status has repoName');
    assert.ok(typeof status.root === 'string' && status.root.length > 0, 'local status has root path');
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(recentStoreDir, { recursive: true, force: true });
    fs.rmSync(userConfigDir, { recursive: true, force: true });
  }
});
