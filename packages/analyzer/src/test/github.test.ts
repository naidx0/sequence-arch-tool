import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import type { GithubFetch } from '../server/github.js';

/**
 * e2e lock for the LOCAL GitHub connect (v8 Phase D) — a bring-your-own Personal
 * Access Token with the EXACT same key hygiene as the AI key: user-level store,
 * redacted on read, never returned/logged, never in an error body. The read-only
 * capability (GET /api/github/repos) is verified against a MOCK substituted over
 * the injectable fetch seam — the real github.com call is unverifiable in this
 * sandbox (the same honest boundary as the AI provider). Mirrors the redaction
 * assertion style of ai-server.test.ts / design-suggest.test.ts.
 */

const TEST_TOKEN = 'ghp_TESTSECRET_ONLY_abcdef0123456789';

/** A private temp dir standing in for `~/.sequence`, so tests never touch real home. */
function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-gh-')));
}

async function startServer(
  userConfigDir: string,
  githubFetch?: GithubFetch
): Promise<{ base: string; close: () => Promise<void> }> {
  // No repo attached — connecting GitHub is a repo-less onboarding step.
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir, githubFetch });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putToken(base: string, token = TEST_TOKEN): Promise<Response> {
  return fetch(`${base}/api/github`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

/* ============================================================ connect ======= */

test('/api/github: PUT saves the token, GET returns connected + masked; raw token NEVER in a response', async () => {
  const userDir = tempUserDir();
  const { base, close } = await startServer(userDir);
  try {
    // Not connected yet.
    const before = (await (await fetch(`${base}/api/github`)).json()) as { connected: boolean };
    assert.strictEqual(before.connected, false);

    const put = await putToken(base);
    assert.strictEqual(put.status, 200);
    const putText = await put.text();
    // The raw token must not appear ANYWHERE in the PUT response (assert on the string).
    assert.ok(!putText.includes(TEST_TOKEN), 'PUT response must not contain the raw token');
    const putBody = JSON.parse(putText) as { connected: boolean; tokenMasked: string };
    assert.strictEqual(putBody.connected, true);
    assert.ok(putBody.tokenMasked.startsWith('••••'), 'masked with ••••');
    assert.ok(putBody.tokenMasked.endsWith(TEST_TOKEN.slice(-4)), 'mask shows the last 4 only');

    // The on-disk github.json holds the FULL token, at the USER level (not a repo).
    const onDisk = fs.readFileSync(path.join(userDir, 'github.json'), 'utf8');
    assert.ok(onDisk.includes(TEST_TOKEN), 'on-disk github.json holds the full token');

    // GET redacts too — the raw token never crosses the wire back to a client.
    const get = await fetch(`${base}/api/github`);
    const getText = await get.text();
    assert.ok(!getText.includes(TEST_TOKEN), 'GET must never return the raw token');
    const getBody = JSON.parse(getText) as { connected: boolean; tokenMasked: string };
    assert.strictEqual(getBody.connected, true);
    assert.match(getBody.tokenMasked, /^••••/);
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/github: PUT rejects a malformed body (400, no token echoed) and a wrong content-type (415)', async () => {
  const userDir = tempUserDir();
  const { base, close } = await startServer(userDir);
  try {
    const badShape = await fetch(`${base}/api/github`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: '' }),
    });
    assert.strictEqual(badShape.status, 400);
    const badBody = (await badShape.json()) as { error: string };
    assert.ok(!badBody.error.includes(TEST_TOKEN));

    const badCt = await fetch(`${base}/api/github`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.strictEqual(badCt.status, 415);

    // Nothing was persisted by the rejected PUTs.
    assert.ok(!fs.existsSync(path.join(userDir, 'github.json')), 'no github.json written on rejection');
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/github: DELETE disconnects (removes github.json; GET reports not connected)', async () => {
  const userDir = tempUserDir();
  const { base, close } = await startServer(userDir);
  try {
    assert.strictEqual((await putToken(base)).status, 200);
    assert.ok(fs.existsSync(path.join(userDir, 'github.json')));

    const del = await fetch(`${base}/api/github`, { method: 'DELETE' });
    assert.strictEqual(del.status, 200);
    const delBody = (await del.json()) as { connected: boolean };
    assert.strictEqual(delBody.connected, false);

    assert.ok(!fs.existsSync(path.join(userDir, 'github.json')), 'github.json removed on disconnect');
    const after = (await (await fetch(`${base}/api/github`)).json()) as { connected: boolean };
    assert.strictEqual(after.connected, false);
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

/* ============================================================ repos ========= */

test('/api/github/repos: the mock fetch returns the repo list AND the Authorization header carried the token; no response leaked it', async () => {
  const userDir = tempUserDir();
  let sawAuth = '';
  let sawUrl = '';
  // The mock stands in for github.com. Capturing the token in the Authorization
  // header it receives is the WIRING proof; the response it returns is token-free.
  const githubFetch: GithubFetch = async (url, init) => {
    sawUrl = url;
    sawAuth = init.headers.authorization ?? '';
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          { full_name: 'octocat/hello', clone_url: 'https://github.com/octocat/hello.git', private: false },
          { full_name: 'octocat/secret', clone_url: 'https://github.com/octocat/secret.git', private: true },
          // a junk entry (missing clone_url) is dropped, never crashes
          { full_name: 'octocat/junk' },
        ]),
    };
  };
  const { base, close } = await startServer(userDir, githubFetch);
  try {
    assert.strictEqual((await putToken(base)).status, 200);

    const res = await fetch(`${base}/api/github/repos`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    // The token NEVER rides back to the client in the repos response.
    assert.ok(!text.includes(TEST_TOKEN), 'the repos response must not leak the token');
    const body = JSON.parse(text) as { repos: { fullName: string; cloneUrl: string; private: boolean }[] };
    assert.strictEqual(body.repos.length, 2, 'two well-formed repos; the junk entry dropped');
    assert.strictEqual(body.repos[0].fullName, 'octocat/hello');
    assert.strictEqual(body.repos[0].private, false);
    assert.strictEqual(body.repos[1].fullName, 'octocat/secret');
    assert.strictEqual(body.repos[1].private, true);

    // Wiring proof: the client called the GitHub REST host and carried the token
    // in the Authorization header (Bearer <token>) to the mock.
    assert.match(sawUrl, /api\.github\.com\/user\/repos/);
    assert.ok(sawAuth.includes(TEST_TOKEN), 'the token was carried to GitHub in the Authorization header');
    assert.match(sawAuth, /^Bearer /);
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/github/repos: no token connected → 400 "connect GitHub in Settings first" (fetch never called)', async () => {
  const userDir = tempUserDir();
  let called = 0;
  const githubFetch: GithubFetch = async () => {
    called++;
    throw new Error('the GitHub fetch must not run without a token');
  };
  const { base, close } = await startServer(userDir, githubFetch);
  try {
    const res = await fetch(`${base}/api/github/repos`);
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: string };
    // New contract (owner report: raw HTTP plumbing leaked into the UI) — the copy
    // points at Settings and carries NO verb + route.
    assert.match(body.error, /connect GitHub in Settings first/i);
    assert.doesNotMatch(body.error, /\/api\//, 'no raw route may reach the user');
    assert.strictEqual(called, 0, 'no upstream call is made without a connected token');
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/github/repos: an upstream GitHub error surfaces as 502 WITHOUT leaking the token', async () => {
  const userDir = tempUserDir();
  // GitHub replies 401 Bad credentials — an authored, token-free body.
  const githubFetch: GithubFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ message: 'Bad credentials' }),
  });
  const { base, close } = await startServer(userDir, githubFetch);
  try {
    assert.strictEqual((await putToken(base)).status, 200);
    const res = await fetch(`${base}/api/github/repos`);
    assert.strictEqual(res.status, 502);
    const text = await res.text();
    assert.ok(!text.includes(TEST_TOKEN), 'the 502 error body must not contain the token');
    const body = JSON.parse(text) as { error: string; githubResponse?: string };
    assert.match(body.error, /GitHub returned HTTP 401/);
    // GitHub's own (token-free) message is surfaced for debugging.
    assert.ok(body.githubResponse && body.githubResponse.includes('Bad credentials'));
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});
