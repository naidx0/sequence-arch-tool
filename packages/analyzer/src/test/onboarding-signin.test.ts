import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createRepoServer } from '../server/repoServer.js';
import { signInLaunch } from '../server/providerProbe.js';

/**
 * Lock for first-run SIGN IN through the Terminal socket: `?signin=<provider>`
 * runs the vendor's own sign-in command (chosen server-side from the provider
 * id), works with no repo attached, closes when the command exits, and the
 * next probe sees the new state.
 *
 * The only `claude` this test can reach is a FAKE in its own temp dir: the
 * probe and the sign-in both search that dir alone (`providerSearch`). The fake
 * records sign-in in a marker file next to itself; no credential file exists
 * anywhere in this test.
 */

const FAKE = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [name, ...args] = process.argv.slice(2);
const a = args.join(' ');
const marker = path.join(here, name + '.signed-in');
if (a === '--version') process.stdout.write('2.1.280 (Claude Code)\\n');
else if (a === 'auth status --json') { const ok = fs.existsSync(marker); process.stdout.write(JSON.stringify({ loggedIn: ok })); process.exitCode = ok ? 0 : 1; }
else if (a === 'auth login') { process.stdout.write('FAKE-CLAUDE ran: claude auth login\\n'); fs.writeFileSync(marker, '1'); }
else { process.stderr.write('unknown ' + a); process.exitCode = 2; }
`;

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function fakeClaude(dir: string): void {
  fs.writeFileSync(path.join(dir, 'fake.mjs'), FAKE);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'claude.cmd'), `@"${process.execPath}" "%~dp0fake.mjs" claude %*\r\n`);
    /* Round 7 (A4): Claude is Ready only with its ACP bridge; this test is about sign-in, so the bridge is here. */
    fs.writeFileSync(path.join(dir, 'claude-agent-acp.cmd'), '@echo bridge\r\n');
  } else {
    fs.writeFileSync(path.join(dir, 'claude-agent-acp'), '#!/bin/sh\necho bridge\n', { mode: 0o755 });
    const p = path.join(dir, 'claude');
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.mjs')}" claude "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
}

async function start(bin: string) {
  const home = tempDir('seq-signin-home-');
  const store = tempDir('seq-signin-store-');
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: home,
    recentStoreDir: store,
    userConfigDir: store,
    // A generous cap: the fake answers in ms, but a loaded suite can take
    // seconds to spawn it, and the 3 s production cap then says 'checking'.
    providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 },
  });
  const sockets = new Set<{ destroy: () => void }>();
  server.on('upgrade', (_r, s) => sockets.add(s as unknown as { destroy: () => void }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

function getJson(port: number, p: string): Promise<{ status: number; json: { providers?: { id: string; state: string }[] } }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      })
      .on('error', reject);
  });
}

/** Open the sign-in socket and collect everything until it closes. */
function runSignIn(port: number, id: string): Promise<{ output: string; code: number } | { refused: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal?signin=${encodeURIComponent(id)}`);
    let output = '';
    ws.on('message', (data, isBinary) => {
      if (isBinary) output += Buffer.from(data as Buffer).toString('utf8');
    });
    ws.on('unexpected-response', (_req, res) => {
      resolve({ refused: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.on('close', (code) => resolve({ output, code }));
    ws.on('error', () => {
      /* reported through unexpected-response or close */
    });
  });
}

test('Sign in: signed-out fake claude -> terminal runs exactly `claude auth login`, exits, re-probe says ready', { timeout: 60_000 }, async () => {
  const bin = tempDir('seq-signin-bin-');
  fakeClaude(bin);
  const s = await start(bin);
  try {
    const before = await getJson(s.port, '/api/onboarding/providers');
    assert.strictEqual(before.status, 200);
    const claude = before.json.providers?.find((p) => p.id === 'claude');
    assert.strictEqual(claude?.state, 'signIn');

    // No repo is attached. Round 7 (B6, "the default workspace should be a
    // project"): an ordinary shell now opens in the home workspace instead of
    // being refused; the refusal with no workspace at all is locked in
    // terminal.test.ts. The sign-in socket is a different thing: it runs the
    // vendor's own command, which an ordinary shell never does.
    assert.deepStrictEqual(await runSignInPlain(s.port), { output: 'opened', code: 0 });
    // ... and the vendor's sign-in command runs.
    const ran = await runSignIn(s.port, 'claude');
    assert.ok('output' in ran, `sign-in socket was refused: ${JSON.stringify(ran)}`);
    assert.match(ran.output, /FAKE-CLAUDE ran: claude auth login/);
    assert.strictEqual(ran.code, 1000, 'the socket closes normally when the command exits');

    const after = await getJson(s.port, '/api/onboarding/providers?refresh=1');
    assert.strictEqual(after.json.providers?.find((p) => p.id === 'claude')?.state, 'ready');
  } finally {
    await s.close();
  }
});

test('Sign in: an unknown provider, or one not installed, is refused before anything spawns', { timeout: 30_000 }, async () => {
  const bin = tempDir('seq-signin-empty-');
  const s = await start(bin);
  try {
    assert.deepStrictEqual(await runSignIn(s.port, 'nope'), { refused: 400 });
    assert.deepStrictEqual(await runSignIn(s.port, 'codex'), { refused: 400 });
    assert.deepStrictEqual(await runSignIn(s.port, 'claude'), { refused: 400 });
  } finally {
    await s.close();
  }
});

test('signInLaunch takes the command from the provider spec, never from the caller', () => {
  const bin = tempDir('seq-signin-spec-');
  fakeClaude(bin);
  const l = signInLaunch('claude', { pathValue: bin, extraDirs: [] });
  assert.ok(l);
  assert.strictEqual(l.command, 'claude auth login');
  if (process.platform === 'win32') {
    /* The fake claude.cmd is no npm template, so cmd.exe runs it by absolute path, args on its one /s /c line. */
    assert.strictEqual(l.verbatim, true);
    assert.match(l.args.at(-1)!, /^""[A-Za-z]:\\.+\\claude\.cmd" auth login"$/);
  } else assert.deepStrictEqual(l.args.slice(-2), ['auth', 'login']);
  assert.strictEqual(signInLaunch('claude auth login; rm -rf /', { pathValue: bin, extraDirs: [] }), null);
});

function runSignInPlain(port: number): Promise<{ refused: number } | { output: string; code: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal`);
    ws.on('unexpected-response', (_req, res) => {
      resolve({ refused: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.on('open', () => {
      resolve({ output: 'opened', code: 0 });
      ws.terminate();
    });
    ws.on('error', () => {});
  });
}
