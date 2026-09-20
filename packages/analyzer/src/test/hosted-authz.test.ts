import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig, type AuthConfig } from '../server/auth.js';
import { signSession, verifySession, SESSION_COOKIE } from '../server/session.js';
import { userBrowseSubdir } from '../server/store.js';

/**
 * v13 request-level authorization at the HTTP boundary (the security crux the
 * review flagged). Locks:
 *   - AUTH ON  + anonymous → SENSITIVE endpoints return 401 (nothing accepted as 'local').
 *   - AUTH ON  + cross-tenant: user A attaches, user B GET /api/file → 403; A → 200.
 *   - AUTH OFF (env-absent regression) → sensitive endpoints reachable as 'local',
 *     no 401/403, usage keyed to the frozen 'local' identity.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');

const AUTH_ENV = {
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  SESSION_SECRET: 'sess-secret-abc',
  PUBLIC_BASE_URL: 'https://app.example.com',
} as NodeJS.ProcessEnv;

interface Tree {
  browseRoot: string;
  recentStoreDir: string;
  cleanup: () => void;
}

function makeTree(): Tree {
  const browseRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-authz-')));
  const recentStoreDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-authz-recent-')));
  fs.cpSync(TICKETING, path.join(browseRoot, 'projectA'), { recursive: true });
  return {
    browseRoot,
    recentStoreDir,
    cleanup: () => {
      for (const d of [browseRoot, recentStoreDir]) fs.rmSync(d, { recursive: true, force: true });
    },
  };
}

async function startServer(opts: {
  authConfig?: AuthConfig;
  browseRoot?: string;
  recentStoreDir?: string;
  userConfigDir?: string;
  detectLocal?: () => Promise<{ name: string; baseUrl: string; models: string[] }[]>;
}): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: opts.browseRoot,
    recentStoreDir: opts.recentStoreDir,
    userConfigDir: opts.userConfigDir,
    detectLocal: opts.detectLocal,
    authConfig: opts.authConfig,
    // Production wiring: metering identity comes from the same signed session.
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

test('AUTH ON without an attached owner: a signed-in user cannot read machine AI inventory', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-authz-ai-')));
  let probeCalls = 0;
  const { base, close } = await startServer({
    authConfig,
    userConfigDir,
    detectLocal: async () => {
      probeCalls++;
      return [{ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['private-model'] }];
    },
  });
  try {
    const cookie = cookieFor('google:SIGNED-IN', authConfig.sessionSecret);
    const response = await fetch(`${base}/api/ai-config`, { headers: { cookie } });
    assert.deepStrictEqual(
      { status: response.status, probeCalls },
      { status: 403, probeCalls: 0 },
      'authentication alone does not entitle a caller to machine-wide AI details',
    );
  } finally {
    await close();
    fs.rmSync(userConfigDir, { recursive: true, force: true });
  }
});

test('ENV-ABSENT repo-less regression: local-first callers still receive local providers', async () => {
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-authz-local-ai-')));
  let probeCalls = 0;
  const { base, close } = await startServer({
    userConfigDir,
    detectLocal: async () => {
      probeCalls++;
      return [{ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['local-model'] }];
    },
  });
  try {
    const response = await fetch(`${base}/api/ai-config`);
    const body = (await response.json()) as { configured: boolean; localProviders?: Array<{ models: string[] }> };
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.configured, false);
    assert.deepStrictEqual(body.localProviders?.[0]?.models, ['local-model']);
    assert.strictEqual(probeCalls, 1);
  } finally {
    await close();
    fs.rmSync(userConfigDir, { recursive: true, force: true });
  }
});

async function attachAs(base: string, cookie: string | undefined, absDir: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return fetch(`${base}/api/attach`, { method: 'POST', headers, body: JSON.stringify({ path: absDir }) });
}

test('AUTH ON: anonymous requests to SENSITIVE endpoints → 401 (never accepted as local)', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const t = makeTree();
  const { base, close } = await startServer({ authConfig, browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    const sensitive: Array<[string, string]> = [
      ['/api/tree', 'GET'],
      ['/api/file?path=README.md', 'GET'],
      ['/api/browse', 'GET'],
      ['/api/usage', 'GET'],
      ['/api/scan', 'POST'],
      ['/archgraph.json', 'GET'],
      ['/api/recent', 'GET'],
      ['/api/ddl', 'POST'],
      // v13 Finding B: /api/status is SENSITIVE now (leaks repoName + server path).
      ['/api/status', 'GET'],
    ];
    for (const [p, method] of sensitive) {
      const r = await fetch(`${base}${p}`, { method });
      assert.strictEqual(r.status, 401, `${p} must be 401 for an anonymous caller`);
      assert.strictEqual(((await r.json()) as { error: string }).error, 'authentication required');
    }
    // GET /api/me stays PUBLIC (it deliberately advertises available providers).
    assert.strictEqual((await fetch(`${base}/api/me`)).status, 200);
  } finally {
    await close();
    t.cleanup();
  }
});

test('AUTH ON cross-tenant: A attaches, B is 403 on repo-scoped reads, A is 200', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const secret = authConfig.sessionSecret;
  const t = makeTree();
  const { base, close } = await startServer({ authConfig, browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir });
  try {
    const A = cookieFor('google:AAA', secret);
    const B = cookieFor('google:BBB', secret);

    // v13 Finding A: each user is jailed to their OWN subtree, so A's repo must
    // live inside A's jail (and B's inside B's). Seed a project in each jail.
    const aJail = userBrowseSubdir(t.browseRoot, 'google:AAA');
    const bJail = userBrowseSubdir(t.browseRoot, 'google:BBB');
    fs.mkdirSync(aJail, { recursive: true });
    fs.mkdirSync(bJail, { recursive: true });
    fs.cpSync(path.join(t.browseRoot, 'projectA'), path.join(aJail, 'projectA'), { recursive: true });
    fs.cpSync(path.join(t.browseRoot, 'projectA'), path.join(bJail, 'projectB'), { recursive: true });
    const aProject = path.join(aJail, 'projectA');

    // A attaches its own project → becomes the repo owner.
    const attach = await attachAs(base, A, aProject);
    assert.strictEqual(attach.status, 200, 'A can attach its own project');

    // v13 Finding A: B CANNOT attach A's path — it escapes B's own jail (403),
    // never resolving into A's tree. This is the physical per-user isolation.
    const bAttackAttach = await attachAs(base, B, aProject);
    assert.strictEqual(bAttackAttach.status, 403, "B cannot attach A's path (jail escape)");

    // A (the owner) reads freely — including the repo-derived graph.
    for (const p of ['/api/tree', '/api/file?path=README.md', '/archgraph.json']) {
      const r = await fetch(`${base}${p}`, { headers: { cookie: A } });
      assert.strictEqual(r.status, 200, `owner A should read ${p}`);
    }
    // A (the owner) can write the repo-scoped ai-config.
    const aPut = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { cookie: A, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'default' }),
    });
    assert.strictEqual(aPut.status, 200, 'owner A can write ai-config');

    // B is a DIFFERENT authenticated user → 403 on every repo-scoped endpoint.
    for (const p of ['/api/tree', '/api/file?path=README.md', '/archgraph.json']) {
      const r = await fetch(`${base}${p}`, { headers: { cookie: B } });
      assert.strictEqual(r.status, 403, `non-owner B must be 403 on ${p}`);
      assert.match(((await r.json()) as { error: string }).error, /another user/);
    }
    // POST repo-scoped too: scan, ddl.
    const bScan = await fetch(`${base}/api/scan`, { method: 'POST', headers: { cookie: B } });
    assert.strictEqual(bScan.status, 403, 'non-owner B must be 403 on POST /api/scan');
    const bDdl = await fetch(`${base}/api/ddl`, {
      method: 'POST',
      headers: { cookie: B, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(bDdl.status, 403, 'non-owner B must be 403 on POST /api/ddl');
    // B must NOT write into A's repo ai-config.
    const bPut = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { cookie: B, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'default' }),
    });
    assert.strictEqual(bPut.status, 403, 'non-owner B must be 403 on PUT /api/ai-config (repo attached)');

    // A new attach by B of ITS OWN project RE-SETS ownership (single-active-repo):
    // now B reads, A is 403.
    const reAttach = await attachAs(base, B, path.join(bJail, 'projectB'));
    assert.strictEqual(reAttach.status, 200, 'B can take over via a new attach of its own project');
    assert.strictEqual((await fetch(`${base}/api/tree`, { headers: { cookie: B } })).status, 200, 'B now owns it');
    assert.strictEqual((await fetch(`${base}/api/tree`, { headers: { cookie: A } })).status, 403, 'A lost ownership');
  } finally {
    await close();
    t.cleanup();
  }
});

test('ENV-ABSENT regression: no auth ⇒ sensitive endpoints reachable as local, no 401/403', async () => {
  const t = makeTree();
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-authz-user-')));
  // No authConfig ⇒ auth OFF ⇒ the whole gate is a no-op (byte-identical local path).
  const { base, close } = await startServer({ browseRoot: t.browseRoot, recentStoreDir: t.recentStoreDir, userConfigDir });
  try {
    // Attach with NO cookie works (local single-user), repo is unowned/shared.
    const attach = await attachAs(base, undefined, path.join(t.browseRoot, 'projectA'));
    assert.strictEqual(attach.status, 200, 'local attach works with no session');

    // Sensitive endpoints reachable anonymously — no 401, no 403 (byte-identical local).
    assert.strictEqual((await fetch(`${base}/api/tree`)).status, 200);
    assert.strictEqual((await fetch(`${base}/api/file?path=README.md`)).status, 200);
    assert.strictEqual((await fetch(`${base}/api/usage`)).status, 200);
    assert.strictEqual((await fetch(`${base}/archgraph.json`)).status, 200);
    assert.strictEqual((await fetch(`${base}/api/recent`)).status, 200);

    // The 'local' identity's usage file is the frozen usage.json (no session hashing).
    const { usageFileForIdentity } = await import('../server/store.js');
    assert.strictEqual(usageFileForIdentity('local'), 'usage.json', 'local usage path is frozen');
  } finally {
    await close();
    t.cleanup();
    fs.rmSync(userConfigDir, { recursive: true, force: true });
  }
});

test('AUTH ON: a tenant cannot delete sessions in a repo from the MACHINE-WIDE recents', async () => {
  // The reported shape: a host that once ran Sequence locally keeps the shared
  // `~/.sequence/recent.json`, so the operator's repos are still in the
  // process-wide list. Tenant B signs in with NO repo attached, so `repoOwner`
  // is null and `requireOwner()` is a no-op for every /api/sessions request.
  // The session catalog is the write fence for PUT/DELETE `repoPath`; built
  // from the process-wide store it handed B a delete primitive against a repo
  // `browseRootFor` would never let B browse, attach or clone.
  const authConfig = loadAuthConfig(AUTH_ENV);
  const t = makeTree();
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-authz-cat-')));
  const { addRecent, SESSIONS_INDEX_FILE } = await import('../server/store.js');
  const { ensureSessionsMigrated } = await import('../server/sessionsStore.js');

  const operatorRepo = path.join(t.browseRoot, 'projectA');
  const operatorIndex = ensureSessionsMigrated(operatorRepo);
  addRecent(t.recentStoreDir, operatorRepo); // the SHARED list, as a local run left it

  // No repo attached ⇒ workspace scope ⇒ the catalog is served and is the fence.
  const { base, close } = await startServer({
    authConfig,
    browseRoot: t.browseRoot,
    recentStoreDir: t.recentStoreDir,
    userConfigDir,
  });
  try {
    const cookie = cookieFor('google:TENANT-B', authConfig.sessionSecret);
    const listed = (await (await fetch(`${base}/api/sessions`, { headers: { cookie } })).json()) as {
      scope: string;
      repos?: Array<{ path: string; index: { sessions: Array<{ id: string }> } }>;
    };
    assert.strictEqual(listed.scope, 'workspace');
    assert.deepStrictEqual(
      (listed.repos ?? []).map((r) => r.path),
      [],
      "another user's repo paths, names and session ids are not B's catalog",
    );

    const del = await fetch(
      `${base}/api/sessions/${operatorIndex.activeId}?repoPath=${encodeURIComponent(operatorRepo)}`,
      { method: 'DELETE', headers: { cookie } },
    );
    assert.strictEqual(del.status, 400, 'a repo outside the caller root is not writable');

    const put = await fetch(`${base}/api/sessions/${operatorIndex.activeId}`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'TENANT B WAS HERE', repoPath: operatorRepo }),
    });
    assert.strictEqual(put.status, 400);

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(operatorRepo, '.sequence', SESSIONS_INDEX_FILE), 'utf8'),
    ) as { sessions: Array<{ id: string; title: string }> };
    assert.deepStrictEqual(
      onDisk.sessions.map((s) => s.id),
      operatorIndex.sessions.map((s) => s.id),
      "the operator's transcripts are still there",
    );
    assert.ok(
      !onDisk.sessions.some((s) => s.title === 'TENANT B WAS HERE'),
      'and nothing was renamed in them',
    );
  } finally {
    await close();
    t.cleanup();
    fs.rmSync(userConfigDir, { recursive: true, force: true });
  }
});
