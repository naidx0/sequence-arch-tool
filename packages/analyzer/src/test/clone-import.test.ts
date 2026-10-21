import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { gitClone, parseGitRemoteUrl } from '../server/gitClone.js';
import type { CloneRepoFn, LsRemoteFn } from '../server/gitClone.js';
import { pathToFileURL } from 'node:url';
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
  lsRemote?: LsRemoteFn;
}): Promise<{ base: string; close: () => Promise<void> }> {
  /* C4: a clone address must pass `git ls-remote`. Where a test fakes the clone
     through the seam (a github.com address served from a local origin), it fakes
     the probe too; `lsRemote: undefined` keeps the real one. */
  const lsRemote: LsRemoteFn | undefined = 'lsRemote' in opts ? opts.lsRemote : async () => ({ ok: true });
  const server = await createRepoServer(null, { webDist: undefined, ...opts, lsRemote });
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
    fs.rmSync(originDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
    fs.rmSync(originDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(browseRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
    fs.rmSync(originDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(browseRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
    const body = (await res.json()) as { error: string; action?: string };
    /* C5: one plain sentence, no internal names. */
    assert.strictEqual(body.error, 'This folder is outside your home folder. Sequence only reads folders you allow.');
    assert.strictEqual(body.action, 'choose-folder');

    // Never attached, and the escaping symlink was removed.
    const status = (await (await fetch(`${base}/api/status`)).json()) as { attached: boolean };
    assert.strictEqual(status.attached, false);
    assert.ok(
      !fs.existsSync(path.join(browseRoot, 'sequence-workspaces', 'widget')),
      'the escaping symlink was cleaned up'
    );
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

/* ============================================ non-github SSRF refused ========= */

test('/api/github/clone: an address that is not https/ssh git is refused (400) BEFORE any probe or clone runs', async () => {
  const browseRoot = tempDir('seq-browse-');
  const userDir = tempDir('seq-home-');
  let cloneCalls = 0;
  let probeCalls = 0;
  const cloneRepo: CloneRepoFn = async () => {
    cloneCalls++;
    throw new Error('the clone must NOT run for a rejected URL');
  };
  const lsRemote: LsRemoteFn = async () => {
    probeCalls++;
    return { ok: true };
  };

  const { base, close } = await startServer({ browseRoot, userConfigDir: userDir, cloneRepo, lsRemote });
  try {
    /* C4: any https or ssh git address is now ACCEPTED (and then probed with
       `git ls-remote`). What is still refused before anything runs: */
    const rejected = [
      'http://github.com/acme/widget.git', // plain http
      'https://user:pass@github.com/acme/widget.git', // embedded credentials
      'ext::sh -c touch% /tmp/pwned', // ext transport runs a command
      '-uhoh', // read by git as an option
      'git://github.com/acme/widget.git', // unauthenticated git protocol
      'not an address',
    ];
    for (const cloneUrl of rejected) {
      const res = await postClone(base, { cloneUrl });
      assert.strictEqual(res.status, 400, `must reject ${cloneUrl}`);
      const body = (await res.json()) as { error: string; action: string };
      assert.strictEqual(body.action, 'check-url');
      assert.match(body.error, /^That isn't a git address Sequence can clone\./);
    }
    assert.strictEqual(probeCalls, 0, 'no ls-remote for a rejected address');
    assert.strictEqual(cloneCalls, 0, 'no clone subprocess is reached for a rejected URL');

    // No body at all → 400 too.
    const empty = await postClone(base, {});
    assert.strictEqual(empty.status, 400);

    const status = (await (await fetch(`${base}/api/status`)).json()) as { attached: boolean };
    assert.strictEqual(status.attached, false);
  } finally {
    await close();
    fs.rmSync(browseRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

/* ════════════════════ 0.1.8.1 C4: any git address, the chosen folder ════════ */

/** A real local BARE repository (plainapp, one commit) → its file:// URL. */
function makeBareOrigin(): { url: string; dir: string } {
  const { originUrl: _u, originDir } = makeLocalOrigin();
  const bare = path.join(originDir, 'origin.git');
  childProcess.execFileSync('git', ['clone', '-q', '--bare', path.join(originDir, 'origin'), bare], { stdio: 'ignore' });
  return { url: pathToFileURL(bare).href, dir: originDir };
}

test('C4: parseGitRemoteUrl takes any https/ssh git address; file:// only when allowed', () => {
  for (const ok of [
    'https://github.com/acme/widget.git',
    'https://gitlab.com/group/sub/widget',
    'https://bitbucket.org/acme/widget.git',
    'ssh://git@github.com/acme/widget.git',
    'git@gitlab.com:acme/widget.git',
  ]) {
    const t = parseGitRemoteUrl(ok);
    assert.ok(t, `accepts ${ok}`);
    assert.strictEqual(t.repo, 'widget');
  }
  assert.strictEqual(parseGitRemoteUrl('https://github.com/acme/widget.git')?.isGithubHttps, true);
  assert.strictEqual(parseGitRemoteUrl('https://github.com.evil.tld/acme/widget.git')?.isGithubHttps, false, 'the token never goes to a look-alike');
  assert.strictEqual(parseGitRemoteUrl('git@github.com:acme/widget.git')?.isGithubHttps, false);
  assert.strictEqual(parseGitRemoteUrl('file:///tmp/x.git'), null, 'file:// refused by default');
  assert.ok(parseGitRemoteUrl('file:///tmp/x.git', { allowFile: true }));
  for (const bad of ['http://h/x.git', 'https://u:p@h/x.git', 'ext::sh -c x', '-oProxyCommand=x', 'https://h', '']) {
    assert.strictEqual(parseGitRemoteUrl(bad), null, `refuses ${JSON.stringify(bad)}`);
  }
});

test('C4: a clone from a local bare repository lands EXACTLY in the chosen folder (real ls-remote, real git clone)', async () => {
  const origin = makeBareOrigin();
  const browseRoot = tempDir('seq-browse-');
  const userDir = tempDir('seq-home-');
  const chosen = path.join(browseRoot, 'Projects', 'my-widget');
  fs.mkdirSync(path.dirname(chosen), { recursive: true });
  const { base, close } = await startServer({ browseRoot, userConfigDir: userDir, lsRemote: undefined });
  try {
    const res = await postClone(base, { cloneUrl: origin.url, destination: chosen });
    const body = (await res.json()) as { attached?: boolean; clonedTo?: string; error?: string };
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.clonedTo, fs.realpathSync(chosen), 'the clone is the chosen folder itself');
    assert.ok(fs.existsSync(path.join(chosen, '.git')), 'a real checkout in the chosen folder');
    assert.ok(!fs.existsSync(path.join(browseRoot, 'sequence-workspaces')), 'nothing went to the default folder');
    assert.strictEqual(body.attached, true);

    /* An existing EMPTY folder is fine too, and is used as is. */
    const empty = path.join(browseRoot, 'Projects', 'empty');
    fs.mkdirSync(empty);
    const res2 = await postClone(base, { cloneUrl: origin.url, destination: empty });
    assert.strictEqual(res2.status, 200);
    assert.ok(fs.existsSync(path.join(empty, '.git')));
  } finally {
    await close();
    for (const d of [origin.dir, browseRoot, userDir]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('C4: refusals are plain sentences with an action: no repo there, not empty, outside home, private GitHub', async () => {
  const browseRoot = tempDir('seq-browse-');
  const userDir = tempDir('seq-home-');
  const outside = tempDir('seq-outside-');
  const notARepo = tempDir('seq-notrepo-');
  let cloneCalls = 0;
  const cloneRepo: CloneRepoFn = async () => {
    cloneCalls++;
    return { ok: false, error: 'must not run' };
  };
  const { base, close } = await startServer({ browseRoot, userConfigDir: userDir, cloneRepo, lsRemote: undefined });
  const INTERNAL = /jail|boundary|browse ?root|browseRoot|escapes/i;
  try {
    /* A real `git ls-remote` against a folder that is not a repository. */
    const none = await postClone(base, { cloneUrl: pathToFileURL(notARepo).href });
    assert.strictEqual(none.status, 400);
    const noneBody = (await none.json()) as { error: string; action: string };
    assert.strictEqual(noneBody.error, "Sequence couldn't find a git repository at that address. Check the address, and that you have access to it.");
    assert.strictEqual(noneBody.action, 'check-url');

    const full = path.join(browseRoot, 'full');
    fs.mkdirSync(full);
    fs.writeFileSync(path.join(full, 'keep.txt'), 'mine');
    const notEmpty = await postClone(base, { cloneUrl: 'https://github.com/acme/widget.git', destination: full });
    assert.strictEqual(notEmpty.status, 409);
    const neBody = (await notEmpty.json()) as { error: string; action: string };
    assert.strictEqual(neBody.action, 'choose-folder');
    assert.match(neBody.error, /^That folder isn't empty\./);
    assert.strictEqual(fs.readFileSync(path.join(full, 'keep.txt'), 'utf8'), 'mine', 'the folder is untouched');

    const out = await postClone(base, { cloneUrl: 'https://github.com/acme/widget.git', destination: path.join(outside, 'w') });
    assert.strictEqual(out.status, 403);
    const outBody = (await out.json()) as { error: string; action: string };
    assert.strictEqual(outBody.error, 'This folder is outside your home folder. Sequence only reads folders you allow.');
    assert.strictEqual(outBody.action, 'choose-folder');

    for (const b of [noneBody, neBody, outBody]) assert.doesNotMatch(b.error, INTERNAL);
    assert.strictEqual(cloneCalls, 0, 'nothing was cloned for a refusal');
  } finally {
    await close();
    for (const d of [browseRoot, userDir, outside, notARepo]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  /* A github.com address that does not answer, with no GitHub connected: connect is the action. */
  const b2 = tempDir('seq-browse-');
  const u2 = tempDir('seq-home-');
  const s2 = await startServer({ browseRoot: b2, userConfigDir: u2, lsRemote: async () => ({ ok: false, error: 'exit 128' }) });
  try {
    const priv = await postClone(s2.base, { cloneUrl: 'https://github.com/acme/private-thing.git' });
    assert.strictEqual(priv.status, 400);
    const pb = (await priv.json()) as { error: string; action: string };
    assert.strictEqual(pb.action, 'connect-github');
    assert.match(pb.error, /connect GitHub/);
  } finally {
    await s2.close();
    for (const d of [b2, u2]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

/* ── review B: hosted clones are GitHub-only; local ssh is honest about failures ── */

import { loadAuthConfig } from '../server/auth.js';
import { signSession, verifySession, SESSION_COOKIE } from '../server/session.js';
import { gitLsRemote, sshFailureReason, SEQUENCE_SSH_COMMAND } from '../server/gitClone.js';
import type http from 'node:http';

test('review B: a hosted (auth) server clones only from https://github.com', async () => {
  const authConfig = loadAuthConfig({
    GOOGLE_CLIENT_ID: 'g-id',
    GOOGLE_CLIENT_SECRET: 'g-secret',
    SESSION_SECRET: 'sess-secret-c4',
    PUBLIC_BASE_URL: 'https://app.example.com',
  } as NodeJS.ProcessEnv);
  const browseRoot = tempDir('seq-browse-');
  const userDir = tempDir('seq-home-');
  let probes = 0;
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot,
    userConfigDir: userDir,
    authConfig,
    resolveIdentity: (req: http.IncomingMessage) => verifySession(req.headers.cookie, authConfig.sessionSecret)?.userId,
    lsRemote: async () => {
      probes += 1;
      return { ok: true };
    },
    cloneRepo: async () => ({ ok: false, error: 'not in this test' }),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(signSession({ userId: 'google:AAA', provider: 'google' }, authConfig.sessionSecret))}`;
  try {
    for (const cloneUrl of ['https://gitlab.com/acme/widget.git', 'git@github.com:acme/widget.git', 'ssh://git@github.com/acme/widget.git', 'file:///etc']) {
      const res = await fetch(`${base}/api/github/clone`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ cloneUrl }) });
      assert.strictEqual(res.status, 400, cloneUrl);
      const body = (await res.json()) as { error: string; action: string };
      assert.strictEqual(body.action, 'check-url');
    }
    assert.strictEqual(probes, 0, 'nothing was probed from the server for a refused address');
    const gh = await fetch(`${base}/api/github/clone`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ cloneUrl: 'https://github.com/acme/widget.git' }) });
    assert.notStrictEqual(gh.status, 400, 'https://github.com is still accepted');
    assert.strictEqual(probes, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    for (const d of [browseRoot, userDir]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('review B: local ssh trusts a new host once (accept-new) and never prompts', async () => {
  let env: NodeJS.ProcessEnv = {};
  const prevCmd = process.env.GIT_SSH_COMMAND;
  const prevSsh = process.env.GIT_SSH;
  delete process.env.GIT_SSH_COMMAND;
  delete process.env.GIT_SSH;
  try {
    await gitLsRemote('ssh://git@example.invalid/x.git', undefined, {
      timeoutMs: 1000,
      spawn: ((cmd: string, args: readonly string[], o: { env: NodeJS.ProcessEnv }) => {
        env = o.env;
        return childProcess.spawn(process.execPath, ['-e', 'process.exit(2)'], { stdio: ['ignore', 'ignore', 'pipe'] });
      }) as unknown as typeof childProcess.spawn,
    });
  } finally {
    if (prevCmd !== undefined) process.env.GIT_SSH_COMMAND = prevCmd;
    if (prevSsh !== undefined) process.env.GIT_SSH = prevSsh;
  }
  assert.strictEqual(env.GIT_SSH_COMMAND, SEQUENCE_SSH_COMMAND);
  assert.match(SEQUENCE_SSH_COMMAND, /StrictHostKeyChecking=accept-new/);
  assert.match(SEQUENCE_SSH_COMMAND, /BatchMode=yes/);
});

test('review B: ssh host-key and key-refused failures get their own plain sentence', async () => {
  assert.strictEqual(sshFailureReason('@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.'), 'ssh-hostkey');
  assert.strictEqual(sshFailureReason('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'), 'ssh-auth');
  assert.strictEqual(sshFailureReason('fatal: unable to access: Could not resolve host'), undefined);

  const browseRoot = tempDir('seq-browse-');
  const userDir = tempDir('seq-home-');
  for (const [reason, pattern] of [
    ['ssh-hostkey', /SSH host key has changed/],
    ['ssh-auth', /didn't accept your SSH key/],
  ] as const) {
    const { base, close } = await startServer({ browseRoot, userConfigDir: userDir, lsRemote: async () => ({ ok: false, error: 'exit 128', reason }) });
    try {
      const res = await postClone(base, { cloneUrl: 'git@gitlab.com:acme/widget.git' });
      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as { error: string; action: string };
      assert.match(body.error, pattern);
      assert.strictEqual(body.action, 'check-url');
    } finally {
      await close();
    }
  }
  for (const d of [browseRoot, userDir]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
