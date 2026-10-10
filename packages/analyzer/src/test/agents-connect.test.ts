import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { agentLaunch } from '../server/providerProbe.js';

/**
 * Lock for CONNECT AGENT (UX audit: a first-time user could not attach an
 * agent from the UI). POST /api/acp/agents/connect { provider } registers a
 * provider the first-run probe found ready, as `sequence agent add` would,
 * with the launch chosen server-side. A signed-out provider is refused with
 * its sign-in command; an unknown one is a 404.
 *
 * The only `codex` and `claude` this test reaches are FAKES in its own temp
 * dir (`providerSearch` searches that dir alone): codex answers "Logged in
 * using ChatGPT", claude reports signed out. No credential exists anywhere.
 */

const FAKE = `const [name, ...args] = process.argv.slice(2);
const a = args.join(' ');
if (a === '--version') process.stdout.write(name === 'codex' ? 'codex-cli 0.153.4\\n' : '2.1.280 (Claude Code)\\n');
else if (name === 'codex' && a === 'login status') process.stderr.write('Logged in using ChatGPT\\n');
else if (name === 'claude' && a === 'auth status --json') { process.stdout.write(JSON.stringify({ loggedIn: false })); process.exitCode = 1; }
else { process.stderr.write('unknown ' + a); process.exitCode = 2; }
`;

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A fake CLI the way npm installs one: a shim, and on Windows the package's own bin next to it. */
function fake(dir: string, name: string): void {
  fs.writeFileSync(path.join(dir, 'fake.cjs'), FAKE);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${process.execPath}" "%~dp0fake.cjs" ${name} %*\r\n`);
    if (name === 'codex') {
      const bin = path.join(dir, 'node_modules', '@openai', 'codex', 'bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'codex.js'), '/* the package entry the shim starts */\n');
    }
  } else {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.cjs')}" ${name} "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
}

async function start(bin: string, store: string) {
  const home = tempDir('seq-connect-home-');
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: home,
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

type Json = Record<string, unknown>;

function call(port: number, method: string, p: string, body?: unknown): Promise<{ status: number; json: Json }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Json }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('connect: a ready provider is registered as an agent, from the provider id alone', async () => {
  const bin = tempDir('seq-connect-bin-');
  const store = tempDir('seq-connect-store-');
  fake(bin, 'codex');
  fake(bin, 'claude');
  const s = await start(bin, store);
  try {
    /* Nothing registered before (the negative control). */
    const before = await call(s.port, 'GET', '/api/acp/agents');
    assert.equal(before.status, 200);
    assert.deepEqual(before.json.agents, []);

    const r = await call(s.port, 'POST', '/api/acp/agents/connect', { provider: 'codex' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const agent = r.json.agent as { id: string; command: string; args?: string[]; label: string };
    assert.equal(agent.id, 'codex');
    assert.equal(agent.label, 'Codex');
    if (process.platform === 'win32') {
      /* A .cmd shim cannot be spawned: node and the package's own entry. */
      assert.equal(agent.command, process.execPath);
      assert.deepEqual(agent.args, [path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')]);
    } else {
      assert.equal(agent.command, path.join(bin, 'codex'));
    }

    const after = await call(s.port, 'GET', '/api/acp/agents');
    assert.deepEqual((after.json.agents as { id: string }[]).map((a) => a.id), ['codex']);
    /* Written where `sequence agent add` writes. */
    assert.match(fs.readFileSync(path.join(store, 'agents.json'), 'utf8'), /"id": "codex"/);
  } finally {
    await s.close();
  }
});

test('connect: a signed-out provider is refused with its sign-in command; an unknown one is a 404', async () => {
  const bin = tempDir('seq-connect-bin-');
  const store = tempDir('seq-connect-store-');
  fake(bin, 'codex');
  fake(bin, 'claude');
  const s = await start(bin, store);
  try {
    const out = await call(s.port, 'POST', '/api/acp/agents/connect', { provider: 'claude' });
    assert.equal(out.status, 409);
    assert.equal(out.json.state, 'signIn');
    assert.equal(out.json.signInCommand, 'claude auth login');

    const unknown = await call(s.port, 'POST', '/api/acp/agents/connect', { provider: 'rm -rf /' });
    assert.equal(unknown.status, 404);

    const list = await call(s.port, 'GET', '/api/acp/agents');
    assert.deepEqual(list.json.agents, []);
  } finally {
    await s.close();
  }
});

test('disconnect: DELETE /api/acp/agents/:id removes a connected agent; an unknown id is a 404', async () => {
  const bin = tempDir('seq-connect-bin-');
  const store = tempDir('seq-connect-store-');
  fake(bin, 'codex');
  fake(bin, 'claude');
  const s = await start(bin, store);
  try {
    assert.equal((await call(s.port, 'POST', '/api/acp/agents/connect', { provider: 'codex' })).status, 200);
    const gone = await call(s.port, 'DELETE', '/api/acp/agents/codex');
    assert.equal(gone.status, 200, JSON.stringify(gone.json));
    assert.deepEqual(gone.json.agents, []);
    assert.deepEqual((await call(s.port, 'GET', '/api/acp/agents')).json.agents, []);
    const again = await call(s.port, 'DELETE', '/api/acp/agents/codex');
    assert.equal(again.status, 404);
  } finally {
    await s.close();
  }
});

test('agentLaunch: Claude without its ACP adapter has nothing to register, and says what is missing', () => {
  const bin = tempDir('seq-connect-bin-');
  fake(bin, 'claude');
  const l = agentLaunch('claude', { pathValue: bin, extraDirs: [] });
  assert.equal(l.ok, false);
  assert.equal(l.ok ? '' : l.reason, 'adapter');
  assert.match(l.ok ? '' : l.message, /claude-agent-acp/);
});
