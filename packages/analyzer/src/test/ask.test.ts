import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';

/**
 * e2e lock for POST /api/ask (v8 Phase B1) — the docked board chat. Reuses the
 * configured BYO-key provider over a REAL HTTP hop (the mock), sends the real
 * structure digest + the question, and returns { text }. No provider configured ⇒
 * a clear 400 the UI shows. Mirrors ai-server.test.ts / explain.test.ts style.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-ASK-SECRET-77';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

/** An isolated user-config dir, so a repo-less test never reads/writes the real HOME. */
function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-user-')));
}

async function startServer(
  repoRoot: string | null,
  userConfigDir?: string
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putAiConfig(base: string, baseUrl: string): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
  });
}

test('/api/ask: 409 with no repo attached AND no design payload', async () => {
  const userDir = tempUserDir();
  const { base, close } = await startServer(null, userDir);
  try {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'hi' }),
    });
    assert.strictEqual(res.status, 409);
    const body = (await res.json()) as { error: string };
    // Owner report: the raw "attach one via POST /api/attach" leaked into the UI.
    assert.strictEqual(body.error, 'no repo attached — open a repository from the home screen first');
    assert.doesNotMatch(body.error, /\/api\//, 'no raw route may reach the user');
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

/* ============================================ DESIGN MODE (repo-less ask) === */
/**
 * Owner report: "I just started a new file, why would I need a repo?" — the
 * from-scratch Design (new project) user asked the assistant anything and got a
 * 409, because /api/ask hard-required an attached repo. With a `design`
 * { title, outline } payload the outline IS the grounding context, exactly the
 * way /api/design-suggest already works repo-less.
 */
const DESIGN_OUTLINE = [
  'Recipe Box',
  '  Frontend',
  '    Recipe list page',
  '    Recipe editor',
  '  Backend',
  '    Recipes API',
  '  Data',
  '    Recipes database',
].join('\n');

test('/api/ask: no repo + design payload → 200, and the design outline reached the provider', async () => {
  let sawOutline = false;
  let sawDesignFraming = false;
  let sawScanDigest = false;
  const mock = await startMockProvider((reqBody) => {
    const text = JSON.stringify(reqBody);
    if (text.includes('Recipes database') && text.includes('Recipe editor')) sawOutline = true;
    if (text.includes('DESIGNING')) sawDesignFraming = true;
    if (text.includes('STRUCTURE DIGEST')) sawScanDigest = true;
    return { text: 'Your design has a frontend, a recipes API, and a recipes database.' };
  });
  // No repo attached — the from-scratch designer's real state.
  const userDir = tempUserDir();
  const { base, close } = await startServer(null, userDir);
  try {
    assert.strictEqual((await putAiConfig(base, mock.baseUrl)).status, 200);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'What is missing from this design?',
        design: { title: 'Recipe Box', outline: DESIGN_OUTLINE },
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { text: string };
    assert.strictEqual(body.text, 'Your design has a frontend, a recipes API, and a recipes database.');
    assert.ok(sawOutline, 'the design outline text reached the provider prompt');
    assert.ok(sawDesignFraming, 'the prompt frames this as a system being DESIGNED');
    assert.ok(!sawScanDigest, 'no scan digest is fabricated when there is no repo');
    assert.strictEqual(mock.requests.length, 1, 'the provider was called once over real HTTP');
    assert.ok(!JSON.stringify(body).includes(TEST_KEY));
  } finally {
    await close();
    await mock.close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/ask: no repo + design payload + no provider → the not-configured message (not a 409)', async () => {
  const userDir = tempUserDir();
  const { base, close } = await startServer(null, userDir);
  try {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'What is missing?',
        design: { title: 'Recipe Box', outline: DESIGN_OUTLINE },
      }),
    });
    assert.strictEqual(res.status, 400, 'design mode is reachable; only the key is missing');
    const body = (await res.json()) as { error: string };
    assert.strictEqual(body.error, 'AI provider not configured — connect your AI key in Settings to chat');
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/ask: no repo + an EMPTY design outline still gets the honest no-repo 409', async () => {
  const userDir = tempUserDir();
  const { base, close } = await startServer(null, userDir);
  try {
    for (const design of [{ title: 'x', outline: '   ' }, { title: 'x' }, null]) {
      const res = await fetch(`${base}/api/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'hi', design }),
      });
      assert.strictEqual(res.status, 409, `an ungrounded design payload must not unlock ask: ${JSON.stringify(design)}`);
    }
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('/api/ask: an ATTACHED repo still answers from the real scan digest, design payload or not', async () => {
  const repo = plainappRepo();
  let sawDigest = false;
  const mock = await startMockProvider((reqBody) => {
    if (JSON.stringify(reqBody).includes('STRUCTURE DIGEST')) sawDigest = true;
    return { text: 'ok' };
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'What does this app do?',
        design: { title: 'Recipe Box', outline: DESIGN_OUTLINE },
      }),
    });
    assert.strictEqual(res.status, 200);
    assert.ok(sawDigest, 'the real repo digest still wins when a repo is attached');
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: no provider configured → 400 with a connect-your-key message', async () => {
  const repo = plainappRepo();
  /*
   * AN ISOLATED USER DIR IS THE WHOLE TEST.
   *
   * "No provider configured" is a claim about the SERVER, and the server falls
   * back to the user-level `~/.sequence/ai.json`. On any machine where a human
   * has connected a key — which is every developer machine, and was this one —
   * a provider IS configured, the route answers 502 instead of 400, and the
   * failure gets filed as environmental noise. It is not noise: a test whose
   * result depends on the home directory of whoever runs it asserts nothing.
   */
  const { base, close } = await startServer(repo, tempUserDir());
  try {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /connect your AI key/i);
  } finally {
    await close();
  }
});

test('/api/ask: 400 on an empty question', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '   ' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await close();
  }
});

test('/api/ask: with the mock provider → returns the mock text; digest sent over real HTTP', async () => {
  const repo = plainappRepo();
  let sawDigest = false;
  const mock = await startMockProvider((reqBody) => {
    const text = JSON.stringify(reqBody);
    // The prompt carries the real structure digest (real ids) + the question.
    if (text.includes('STRUCTURE DIGEST') && text.includes('svc:backend') && text.includes('QUESTION')) {
      sawDigest = true;
    }
    return { text: 'Your app has a frontend and a backend that stores notes.' };
  });
  const { base, close } = await startServer(repo);
  try {
    assert.strictEqual((await putAiConfig(base, mock.baseUrl)).status, 200);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { text: string };
    assert.strictEqual(body.text, 'Your app has a frontend and a backend that stores notes.');
    assert.ok(sawDigest, 'the provider prompt included the real structure digest + the question');
    assert.strictEqual(mock.requests.length, 1, 'the provider was called once over real HTTP');
    // The key never rides back to the client.
    assert.ok(!JSON.stringify(body).includes(TEST_KEY));
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: an upstream provider error surfaces as 502 without leaking the key', async () => {
  const repo = plainappRepo();
  const mock = await startMockProvider(() => ({
    status: 500,
    rawBody: JSON.stringify({ error: { message: 'upstream boom' } }),
  }));
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'hello?' }),
    });
    assert.strictEqual(res.status, 502);
    const body = (await res.json()) as { error: string; providerResponse?: string };
    assert.ok(body.providerResponse && body.providerResponse.includes('upstream boom'));
    assert.ok(!JSON.stringify(body).includes(TEST_KEY), 'error body must not contain the key');
  } finally {
    await close();
    await mock.close();
  }
});
