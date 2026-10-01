import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';
import { startMockProvider } from './mock-provider.js';

/**
 * e2e lock for POST /api/design-suggest (v8 Phase B2) — the from-scratch
 * "describe → propose blocks" path. It works WITH NO REPO attached, using the
 * user-level AI config; the reply is normalized/capped into safe proposed design
 * nodes over a REAL HTTP hop (the mock). Also guards the config precedence:
 * per-repo wins when a repo is attached. Mirrors ask.test.ts / explain.test.ts.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-DESIGN-SECRET-42';
const USER_KEY = 'sk-ant-test-USER-LEVEL-13';
const REPO_KEY = 'sk-ant-test-PER-REPO-99';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-dsg-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-user-')));
}

async function startServer(
  repoRoot: string | null,
  userConfigDir: string
): Promise<{ base: string; close: () => Promise<void> }> {
  /* PER-REPO AI CONFIG IS A TRUSTED-REPO FEATURE, so this fixture consents.
     A repo's own `.sequence/ai.json` is ignored while untrusted — it can point
     `baseUrl` at an attacker's host and take every question and file excerpt
     with it — and the user's settings go to the user store instead. The
     assertions below are about key masking, redaction and per-repo precedence,
     not about trust, so the fixture says yes the way a reader would.
     `isRepoTrusted`'s OWN default store, never `userConfigDir`: the boundary has
     one store and `isolate-user-store.js` has already isolated it. */
  if (repoRoot !== null) setRepoTrust(userStoreDir(), repoRoot, true);
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putAiConfig(base: string, baseUrl: string, apiKey = TEST_KEY): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'claude-test', apiKey }),
  });
}

async function suggest(base: string, description: string): Promise<Response> {
  return fetch(`${base}/api/design-suggest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description, repoName: 'pet-app' }),
  });
}

test('/api/design-suggest: no provider configured → 400 with a connect-your-key message', async () => {
  const userDir = tempUserDir();
  const { base, close } = await startServer(null, userDir); // NO repo attached
  try {
    const res = await suggest(base, 'a pet adoption app');
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /connect your AI key/i);
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/design-suggest: 400 on an empty description', async () => {
  const userDir = tempUserDir();
  const { base, close } = await startServer(null, userDir);
  try {
    const res = await fetch(`${base}/api/design-suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: '   ' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/design-suggest: no repo + user-level key → proposes nodes over real HTTP; user config round-trips', async () => {
  const userDir = tempUserDir();
  let sawScheme = false;
  const mock = await startMockProvider((reqBody) => {
    const text = JSON.stringify(reqBody);
    if (text.includes('DESIGN') && text.includes('pet adoption')) sawScheme = true;
    return {
      text: JSON.stringify({
        nodes: [
          { title: 'Frontend', kind: 'area', children: [{ title: 'Pet browser', kind: 'feature' }] },
          { title: 'Pets database', kind: 'data' },
        ],
      }),
    };
  });
  const { base, close } = await startServer(null, userDir); // NO repo attached
  try {
    // Connect a key with no repo attached → it writes to the USER-LEVEL file.
    assert.strictEqual((await putAiConfig(base, mock.baseUrl)).status, 200);
    assert.ok(fs.existsSync(path.join(userDir, 'ai.json')), 'user-level ai.json written under the user dir');
    const onDisk = fs.readFileSync(path.join(userDir, 'ai.json'), 'utf8');
    assert.ok(onDisk.includes(TEST_KEY), 'on-disk user config holds the full key');

    // GET redacts (round-trip).
    const get = (await (await fetch(`${base}/api/ai-config`)).json()) as { configured: boolean; apiKey: string };
    assert.strictEqual(get.configured, true);
    assert.ok(!get.apiKey.includes(TEST_KEY), 'GET must never return the raw key');

    const res = await suggest(base, 'a pet adoption app');
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { nodes: { title: string; kind: string; children?: unknown[] }[]; proposed: boolean };
    assert.strictEqual(body.proposed, true, 'framed as proposed, not detected');
    assert.ok(body.nodes.length >= 1);
    assert.strictEqual(body.nodes[0].title, 'Frontend');
    assert.ok(Array.isArray(body.nodes[0].children) && body.nodes[0].children.length === 1);
    assert.ok(sawScheme, 'the provider prompt carried the description + design framing');
    assert.strictEqual(mock.requests.length, 1, 'the provider was called once over real HTTP');
    assert.ok(!JSON.stringify(body).includes(TEST_KEY), 'the key never rides back to the client');
  } finally {
    await close();
    await mock.close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/design-suggest: a malformed / oversized reply is safely normalized/capped (never throws)', async () => {
  const userDir = tempUserDir();
  // Garbage (not JSON) for the first call, a huge/deep object for the second.
  let call = 0;
  const huge = {
    nodes: Array.from({ length: 100 }, (_, i) => ({
      title: `n${i}`,
      kind: 'not-a-kind',
      children: Array.from({ length: 50 }, (_, j) => ({ title: `c${i}-${j}`, kind: 'feature' })),
    })),
  };
  const mock = await startMockProvider(() => {
    call++;
    return { text: call === 1 ? 'total nonsense, no json here' : JSON.stringify(huge) };
  });
  const { base, close } = await startServer(null, userDir);
  try {
    await putAiConfig(base, mock.baseUrl);

    // Garbage → 200 with an empty list, no crash.
    const r1 = await suggest(base, 'anything');
    assert.strictEqual(r1.status, 200);
    const b1 = (await r1.json()) as { nodes: unknown[] };
    assert.deepStrictEqual(b1.nodes, [], 'a non-JSON reply normalizes to no nodes');

    // Oversized/malformed kinds → capped, kinds coerced, never throws.
    const r2 = await suggest(base, 'anything');
    assert.strictEqual(r2.status, 200);
    const b2 = (await r2.json()) as { nodes: { kind: string; children?: unknown[] }[] };
    assert.ok(b2.nodes.length <= 12, 'top-level children capped');
    let total = 0;
    const validKinds = new Set(['area', 'service', 'feature', 'data', 'file']);
    const walk = (list: { kind: string; children?: unknown[] }[]) => {
      for (const n of list) {
        total++;
        assert.ok(validKinds.has(n.kind), `kind ${n.kind} coerced to a valid kind`);
        if (Array.isArray(n.children)) walk(n.children as { kind: string; children?: unknown[] }[]);
      }
    };
    walk(b2.nodes);
    assert.ok(total <= 40, `total nodes capped (got ${total})`);
  } finally {
    await close();
    await mock.close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/design-suggest: per-repo config still WINS when a repo is attached', async () => {
  const userDir = tempUserDir();
  const repo = plainappRepo();
  const userMock = await startMockProvider(() => ({ text: JSON.stringify({ nodes: [{ title: 'from-user', kind: 'feature' }] }) }));
  const repoMock = await startMockProvider(() => ({ text: JSON.stringify({ nodes: [{ title: 'from-repo', kind: 'feature' }] }) }));
  const { base, close } = await startServer(repo, userDir); // repo ATTACHED
  try {
    // Seed a USER-LEVEL config pointing at userMock (written directly — a PUT with
    // a repo attached would target the per-repo file).
    fs.writeFileSync(
      path.join(userDir, 'ai.json'),
      JSON.stringify({ provider: 'anthropic', baseUrl: userMock.baseUrl, model: 'claude-test', apiKey: USER_KEY })
    );
    // Connect the PER-REPO config (repo attached) pointing at repoMock.
    assert.strictEqual((await putAiConfig(base, repoMock.baseUrl, REPO_KEY)).status, 200);
    assert.ok(
      fs.readFileSync(path.join(repo, '.sequence', 'ai.json'), 'utf8').includes(REPO_KEY),
      'per-repo ai.json written (attached path unchanged)'
    );

    const res = await suggest(base, 'a system');
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { nodes: { title: string }[] };
    assert.strictEqual(body.nodes[0].title, 'from-repo', 'per-repo provider answered');
    assert.strictEqual(repoMock.requests.length, 1, 'per-repo provider was called');
    assert.strictEqual(userMock.requests.length, 0, 'user-level provider was NOT called when a repo is attached');
  } finally {
    await close();
    await userMock.close();
    await repoMock.close();
    fs.rmSync(userDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('/api/design-suggest: attached repo with no per-repo ai.json falls through to user-level config', async () => {
  const userDir = tempUserDir();
  const repo = plainappRepo();
  const userMock = await startMockProvider(() => ({
    text: JSON.stringify({ nodes: [{ title: 'from-user-fallback', kind: 'feature' }] }),
  }));
  const { base, close } = await startServer(repo, userDir);
  try {
    fs.writeFileSync(
      path.join(userDir, 'ai.json'),
      JSON.stringify({
        provider: 'anthropic',
        baseUrl: userMock.baseUrl,
        model: 'claude-test',
        apiKey: USER_KEY,
      }),
    );
    assert.ok(
      !fs.existsSync(path.join(repo, '.sequence', 'ai.json')),
      'fixture has no per-repo ai.json',
    );

    const res = await suggest(base, 'a system');
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { nodes: { title: string }[] };
    assert.strictEqual(body.nodes[0].title, 'from-user-fallback', 'user-level provider answered');
    assert.strictEqual(userMock.requests.length, 1, 'user-level provider was called');
  } finally {
    await close();
    await userMock.close();
    fs.rmSync(userDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});
