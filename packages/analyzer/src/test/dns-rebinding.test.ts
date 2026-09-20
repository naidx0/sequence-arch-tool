import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig } from '../server/auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer -> packages -> <repo root>
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const ORIGIN_ERROR =
  "forbidden request host or origin: use the Sequence app's own URL (local-only loopback in local mode)";

interface RunningServer {
  base: string;
  port: number;
  close: () => Promise<void>;
}

interface RawResponse {
  status: number;
  body: string;
}

function freshRepo(): { repo: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-rebinding-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  fs.appendFileSync(
    path.join(repo, 'gateway', 'index.ts'),
    "\nconst AWS_SECRET_ACCESS_KEY = 'test-only-secret';\n",
  );
  return { repo, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function startServer(
  repoRoot: string | null,
  opts: Parameters<typeof createRepoServer>[1] = {},
): Promise<RunningServer> {
  const server = await createRepoServer(repoRoot, { webDist: undefined, ...opts });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Send an exact Host/Origin pair; fetch may normalize or forbid the Host header. */
function rawRequest(
  server: RunningServer,
  requestPath: string,
  options: {
    method?: string;
    host: string;
    origin?: string;
    body?: string;
  },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: options.host };
    if (options.origin !== undefined) headers.origin = options.origin;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(options.body));
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.port,
        path: requestPath,
        method: options.method ?? 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

test('DNS rebinding cannot replace the provider or read repository search; the real app and native JSON API still work', async () => {
  const fixture = freshRepo();
  const server = await startServer(fixture.repo);
  const attackerHost = `seq.attacker.example:${server.port}`;
  const attackerOrigin = `http://${attackerHost}`;
  const localHost = `127.0.0.1:${server.port}`;
  const providerBody = JSON.stringify({
    provider: 'openai-compatible',
    baseUrl: 'https://collector.example/v1',
    model: 'x',
    apiKey: 'x',
  });

  try {
    // The browser still believes it is talking to seq.attacker.example after DNS
    // changes to 127.0.0.1, so its Origin and Host match each other. The Host must
    // nevertheless be refused because it is not a loopback name.
    const replaceProvider = await rawRequest(server, '/api/ai-config', {
      method: 'PUT',
      host: attackerHost,
      origin: attackerOrigin,
      body: providerBody,
    });
    assert.strictEqual(replaceProvider.status, 403);
    assert.deepStrictEqual(JSON.parse(replaceProvider.body), { error: ORIGIN_ERROR });
    assert.strictEqual(
      fs.existsSync(path.join(fixture.repo, '.sequence', 'ai.json')),
      false,
      'a refused rebound request must not persist the attacker provider',
    );

    const stealSearch = await rawRequest(
      server,
      '/api/search?query=AWS_SECRET_ACCESS_KEY&glob=**%2F*',
      { host: attackerHost, origin: attackerOrigin },
    );
    assert.strictEqual(stealSearch.status, 403);
    assert.deepStrictEqual(JSON.parse(stealSearch.body), { error: ORIGIN_ERROR });
    assert.ok(!stealSearch.body.includes('test-only-secret'));

    // A conventional cross-site request aimed directly at 127.0.0.1 is refused too.
    const crossOrigin = await rawRequest(server, '/api/tree', {
      host: localHost,
      origin: 'https://attacker.example',
    });
    assert.strictEqual(crossOrigin.status, 403);
    assert.deepStrictEqual(JSON.parse(crossOrigin.body), { error: ORIGIN_ERROR });

    // The production app is same-origin. Browser POSTs carry Origin; it must match Host.
    const realApp = await rawRequest(server, '/api/ai-config', {
      method: 'PUT',
      host: localHost,
      origin: `http://${localHost}`,
      body: providerBody,
    });
    assert.strictEqual(realApp.status, 200, realApp.body);

    // The advertised CLI JSON API is a native caller: loopback Host, no Origin.
    const nativeCli = await rawRequest(server, '/api/tree', { host: localHost });
    assert.strictEqual(nativeCli.status, 200, nativeCli.body);
    assert.match(nativeCli.body, /gateway/);
  } finally {
    await server.close();
    fixture.cleanup();
  }
});

test('hosted auth keeps its configured public same-origin API door', async () => {
  const authConfig = loadAuthConfig({
    GOOGLE_CLIENT_ID: 'g-id',
    GOOGLE_CLIENT_SECRET: 'g-secret',
    SESSION_SECRET: 'session-secret',
    PUBLIC_BASE_URL: 'https://app.example.com',
  } as NodeJS.ProcessEnv);
  const server = await startServer(null, { authConfig });

  try {
    const sameOrigin = await rawRequest(server, '/api/me', {
      host: 'app.example.com',
      origin: 'https://app.example.com',
    });
    assert.strictEqual(sameOrigin.status, 200, sameOrigin.body);

    const crossOrigin = await rawRequest(server, '/api/me', {
      host: 'app.example.com',
      origin: 'https://attacker.example',
    });
    assert.strictEqual(crossOrigin.status, 403);
    assert.deepStrictEqual(JSON.parse(crossOrigin.body), { error: ORIGIN_ERROR });
  } finally {
    await server.close();
  }
});

/*
 * `/archgraph.json` is the oldest door in this server and the only engine route that is not under
 * `/api`. It predates that namespace, which is exactly why it is easy to leave out of a guard
 * written in terms of it - and it serves the whole architecture graph of a private repository:
 * every file path, every service name, every edge.
 *
 * This test exists because a mutation removing `/archgraph.json` from the origin gate left every
 * other test in this file green. The gate was right; nothing proved it. Narrow the gate to `/api`
 * alone and this test fails.
 */
test('DNS rebinding cannot read the architecture graph from /archgraph.json', async () => {
  const fixture = freshRepo();
  const server = await startServer(fixture.repo);
  const attackerHost = `seq.attacker.example:${server.port}`;
  const localHost = `127.0.0.1:${server.port}`;

  try {
    const rebound = await rawRequest(server, '/archgraph.json', {
      host: attackerHost,
      origin: `http://${attackerHost}`,
    });
    assert.strictEqual(rebound.status, 403);
    assert.deepStrictEqual(JSON.parse(rebound.body), { error: ORIGIN_ERROR });
    // Assert the absence of the payload, not just the status: a 403 that still wrote the graph
    // would satisfy a status-only check while leaking everything it was meant to withhold.
    assert.ok(!rebound.body.includes('gateway'), 'a refused request must not carry the topology');

    // Cross-site directly at loopback is refused on this route too.
    const crossOrigin = await rawRequest(server, '/archgraph.json', {
      host: localHost,
      origin: 'https://attacker.example',
    });
    assert.strictEqual(crossOrigin.status, 403);

    // The real app reads it normally, and gets a real graph rather than an empty one.
    const realApp = await rawRequest(server, '/archgraph.json', {
      host: localHost,
      origin: `http://${localHost}`,
    });
    assert.strictEqual(realApp.status, 200, realApp.body);
    const graph = JSON.parse(realApp.body) as { nodes?: unknown[] };
    assert.ok(Array.isArray(graph.nodes) && graph.nodes.length > 0, 'the app must still get nodes');
  } finally {
    await server.close();
    fixture.cleanup();
  }
});
