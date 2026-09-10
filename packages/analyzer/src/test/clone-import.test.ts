import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { gitClone } from '../server/gitClone.js';
import type { CloneRepoFn } from '../server/gitClone.js';
import type { GithubFetch } from '../server/github.js';

/**
 * REAL clone-import gate (v10 Phase 4). Unlike the connect/list layer (mock-only),
 * a `git clone` IS verifiable here (git is present + a local git origin is fully
 * deterministic), so this exercises the genuine subprocess. The clone SOURCE is a
 * LOCAL bare-ish git repo built in a tempdir (network-independent, headless), pulled
 * in through the same clone seam a deployed build points at github.com — the
 * endpoint's github.com host validation + dest jail-vetting still run on the real
 * code path. Locks:
 *   - clone-attach: a cloned repo attaches (status attached + a real graph);
 *   - token-not-leaked: the token is NEVER in argv nor in <dest>/.git/config (it
 *     rides GIT_ASKPASS via the env), and the askpass temp file is cleaned up;
 *   - dest-refused: a clone whose realpath escapes the browse root is refused;
 *   - non-github-refused: any non-github.com scheme/host is refused before spawning.
 */

const TEST_TOKEN = 'ghp_CLONESECRET_ONLY_abcdef0123456789';
const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

/** Build a real local git origin repo (plainapp content, one commit) → its file:// URL. */
function makeLocalOrigin(): { originUrl: string; originDir: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-origin-')));
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

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function startServer(opts: {
  browseRoot: string;
  userConfigDir: string;
  cloneRepo?: CloneRepoFn;
  githubFetch?: GithubFetch;
}): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, { webDist: undefined, ...opts });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putToken(base: string): Promise<Response> {
  return fetch(`${base}/api/github`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: TEST_TOKEN }),
  });
}

async function postClone(base: string, body: object): Promise<Response> {
  return fetch(`${base}/api/github/clone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/* ============================================ low-level token hygiene ======== */

test('gitClone: real clone of a local origin — token via GIT_ASKPASS, NEVER in argv or .git/config; askpass cleaned up', async () => {
  const { originUrl, originDir } = makeLocalOrigin();
  const parent = tempDir('seq-lowclone-');
  const dest = path.join(parent, 'clone');

  // Wrap the real spawn to prove the token is never an argv entry (env is fine).
  let capturedArgs: readonly string[] = [];
  let capturedEnv: NodeJS.ProcessEnv = {};
  const spawnCap = ((cmd: string, args: readonly string[], o: { env: NodeJS.ProcessEnv }) => {
    capturedArgs = args;
    capturedEnv = o.env;
    return childProcess.spawn(cmd, args as string[], o);
  }) as unknown as typeof childProcess.spawn;

  try {
    const result = await gitClone(originUrl, dest, TEST_TOKEN, { spawn: spawnCap });
    assert.strictEqual(result.ok, true, 'the real clone succeeded');
    assert.ok(fs.existsSync(path.join(dest, '.git')), 'a .git dir was produced');
    // The plainapp content came across.
    assert.ok(fs.existsSync(path.join(dest, 'docker-compose.yml')), 'the repo content was cloned');

    // TOKEN HYGIENE — never in argv.
    assert.ok(
      !capturedArgs.some((a) => a.includes(TEST_TOKEN)),
      'the token must NEVER appear in the git argv'
    );
    // Shallow (disk guard) + the URL carries no credentials.
    assert.ok(capturedArgs.includes('--depth'), 'the clone is shallow (--depth)');
    assert.ok(!capturedArgs.join(' ').includes('@'), 'the clone URL embeds no credentials');

    // TOKEN HYGIENE — never in .git/config; the remote is the clean origin URL.
    const cfg = fs.readFileSync(path.join(dest, '.git', 'config'), 'utf8');
    assert.ok(!cfg.includes(TEST_TOKEN), 'the token must NEVER land in <dest>/.git/config');

    // POSITIVE proof the token rode askpass (env), not argv.
    assert.strictEqual(
      capturedEnv.SEQUENCE_GIT_ASKPASS_TOKEN,
      TEST_TOKEN,
      'the token is supplied to git via the askpass env var'
    );
    assert.ok(typeof capturedEnv.GIT_ASKPASS === 'string', 'GIT_ASKPASS is wired');
    // The askpass temp SCRIPT is removed after the clone (no secret-adjacent file left).
    assert.ok(
      !fs.existsSync(capturedEnv.GIT_ASKPASS as string),
      'the askpass temp script is cleaned up'
    );
  } finally {
    fs.rmSync(originDir, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

/* ============================================ endpoint clone → attach ======== */

test('/api/github/clone: clones a github.com repo (local origin via the seam) INTO the browse root and ATTACHES it', async () => {
  const { originUrl, originDir } = makeLocalOrigin();
  const browseRoot = tempDir('seq-browse-');
  const userDir = tempDir('seq-home-');

  // Capture the argv the endpoint's clone actually spawned, to lock token hygiene
  // on the ENDPOINT path too (the token comes from the connected github.json).
  let capturedArgs: readonly string[] = [];
  let capturedEnv: NodeJS.ProcessEnv = {};
  const cloneRepo: CloneRepoFn = (_cloneUrl, dest, token) =>
    gitClone(originUrl, dest, token, {
      spawn: ((cmd: string, args: readonly string[], o: { env: NodeJS.ProcessEnv }) => {
        capturedArgs = args;
        capturedEnv = o.env;
        return childProcess.spawn(cmd, args as string[], o);
      }) as unknown as typeof childProcess.spawn,
    });

  const { base, close } = await startServer({ browseRoot, userConfigDir: userDir, cloneRepo });
  try {
    // Connect a token so the endpoint threads it into the clone (private-repo path).
    assert.strictEqual((await putToken(base)).status, 200);

    const res = await postClone(base, { cloneUrl: 'https://github.com/acme/widget.git' });
    assert.strictEqual(res.status, 200);
    const bodyText = await res.text();
    assert.ok(!bodyText.includes(TEST_TOKEN), 'the clone response must not leak the token');
    const body = JSON.parse(bodyText) as {
      attached: boolean;
      repoName: string;
      root: string;
      graphSummary: Record<string, number>;
      clonedTo: string;
    };
    // Attached, with a REAL scanned graph.
    assert.strictEqual(body.attached, true);
    assert.ok(body.graphSummary.nodes > 0, 'the attached repo produced a graph');

    // The clone landed inside <browseRoot>/sequence-workspaces/ (the jail).
    assert.ok(
      body.clonedTo.startsWith(path.join(browseRoot, 'sequence-workspaces') + path.sep),
      'the repo was cloned into the browse-root workspaces dir'
    );
    assert.ok(fs.existsSync(path.join(body.clonedTo, '.git')), 'a real clone is on disk');

    // The server is now attached (GET /api/status).
    const status = (await (await fetch(`${base}/api/status`)).json()) as { attached: boolean };
    assert.strictEqual(status.attached, true);

    // ENDPOINT token hygiene: token via env, never in argv nor .git/config.
    assert.ok(!capturedArgs.some((a) => a.includes(TEST_TOKEN)), 'endpoint clone kept the token out of argv');
    assert.strictEqual(capturedEnv.SEQUENCE_GIT_ASKPASS_TOKEN, TEST_TOKEN, 'endpoint threaded the token via askpass');
    const gitCfg = fs.readFileSync(path.join(body.clonedTo, '.git', 'config'), 'utf8');
    assert.ok(!gitCfg.includes(TEST_TOKEN), 'endpoint clone kept the token out of .git/config');
  } finally {
    await close();
    fs.rmSync(originDir, { recursive: true, force: true });
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/github/clone: fullName resolves against the token owner allow-list (own repo clones; a foreign repo → 404)', async () => {
  const { originUrl, originDir } = makeLocalOrigin();
  const browseRoot = tempDir('seq-browse-');
  const userDir = tempDir('seq-home-');
  const githubFetch: GithubFetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify([
        { full_name: 'acme/widget', clone_url: 'https://github.com/acme/widget.git', private: false },
      ]),
  });
  const cloneRepo: CloneRepoFn = (_u, dest, token) => gitClone(originUrl, dest, token);

  const { base, close } = await startServer({ browseRoot, userConfigDir: userDir, cloneRepo, githubFetch });
  try {
    assert.strictEqual((await putToken(base)).status, 200);

    // A repo the owner CAN see → cloned + attached.
    const ok = await postClone(base, { fullName: 'acme/widget' });
    assert.strictEqual(ok.status, 200);
    const okBody = (await ok.json()) as { attached: boolean };
    assert.strictEqual(okBody.attached, true);

    // A repo NOT in the owner's list → 404 (allow-list enforced, nothing cloned).
    const nope = await postClone(base, { fullName: 'someoneelse/private' });
    assert.strictEqual(nope.status, 404);
  } finally {
    await close();
    fs.rmSync(originDir, { recursive: true, force: true });
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

/* ============================================ dest jail-escape refused ======= */

test('/api/github/clone: a clone whose realpath ESCAPES the browse root is refused (403) and NOT attached', async () => {
  const browseRoot = tempDir('seq-browse-');
  const userDir = tempDir('seq-home-');
  const outside = tempDir('seq-outside-'); // a sibling temp dir, NOT under browseRoot

  // A hostile/broken clone that makes `dest` a symlink escaping the jail.
  const cloneRepo: CloneRepoFn = async (_url, dest) => {
    fs.symlinkSync(outside, dest);
    return { ok: true };
  };

  const { base, close } = await startServer({ browseRoot, userConfigDir: userDir, cloneRepo });
  try {
    const res = await postClone(base, { cloneUrl: 'https://github.com/acme/widget.git' });
    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /escapes the browse root/i);

    // Never attached, and the escaping symlink was removed.
    const status = (await (await fetch(`${base}/api/status`)).json()) as { attached: boolean };
    assert.strictEqual(status.attached, false);
    assert.ok(
      !fs.existsSync(path.join(browseRoot, 'sequence-workspaces', 'widget')),
      'the escaping symlink was cleaned up'
    );
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

/* ============================================ non-github SSRF refused ========= */

test('/api/github/clone: a non-github.com host / scheme is refused (400) BEFORE any clone runs (SSRF guard)', async () => {
  const browseRoot = tempDir('seq-browse-');
  const userDir = tempDir('seq-home-');
  let cloneCalls = 0;
  const cloneRepo: CloneRepoFn = async () => {
    cloneCalls++;
    throw new Error('the clone must NOT run for a rejected URL');
  };

  const { base, close } = await startServer({ browseRoot, userConfigDir: userDir, cloneRepo });
  try {
    const rejected = [
      'https://gitlab.com/acme/widget.git', // wrong host
      'https://github.com.evil.tld/acme/widget.git', // look-alike host (exact-match guard)
      'http://github.com/acme/widget.git', // wrong scheme (http)
      'ssh://git@github.com/acme/widget.git', // wrong scheme (ssh)
      'file:///etc/passwd', // file scheme (local exfil)
      'https://user:pass@github.com/acme/widget.git', // embedded credentials
    ];
    for (const cloneUrl of rejected) {
      const res = await postClone(base, { cloneUrl });
      assert.strictEqual(res.status, 400, `must reject ${cloneUrl}`);
    }
    assert.strictEqual(cloneCalls, 0, 'no clone subprocess is reached for a rejected URL');

    // No body at all → 400 too.
    const empty = await postClone(base, {});
    assert.strictEqual(empty.status, 400);

    const status = (await (await fetch(`${base}/api/status`)).json()) as { attached: boolean };
    assert.strictEqual(status.attached, false);
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});
