import assert from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { platformKey, readInstalled, resolveCatalogLaunch, type CatalogAgent } from '../server/agentCatalog.js';
import { cmdInside, defaultTar, installAgentBinary } from '../server/agentBinaryInstall.js';
import { resetSignInJobs } from '../server/agentCatalogRoutes.js';

/**
 * Lock for ONE-CLICK AGENT INSTALL (agentBinaryInstall.ts): the registry's archive for this
 * machine is downloaded, refused unless its sha256 matches, unpacked with the system tar into
 * <store>/agents-bin/<id>/<version>, and then the catalog starts the agent from there. The
 * archive is built here with the same tar; the "network" is a fetch stub. Nothing is run.
 */

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

const EXE = process.platform === 'win32' ? 'fakeagent.exe' : 'fakeagent';

/** A tar.gz holding `pkg/<EXE>`, made with the tar the installer will unpack it with. */
function archive(): { bytes: Buffer; sha256: string } {
  const src = tempDir('seq-bin-src-');
  fs.mkdirSync(path.join(src, 'pkg'));
  fs.writeFileSync(path.join(src, 'pkg', EXE), 'not really an agent');
  const out = path.join(tempDir('seq-bin-out-'), 'fakeagent.tar.gz');
  execFileSync(defaultTar(), ['-czf', out, '-C', src, 'pkg']);
  const bytes = fs.readFileSync(out);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function agent(sha256: string, cmd = `./pkg/${EXE}`): CatalogAgent {
  return {
    id: 'fakeagent',
    name: 'Fake Agent',
    version: '1.2.3',
    distribution: { binary: { [platformKey()]: { archive: 'https://example.invalid/fakeagent.tar.gz', cmd, args: ['acp'], sha256 } } },
  };
}

function serve(bytes: Buffer): typeof fetch & { calls: number } {
  const f = (async () => {
    f.calls++;
    return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes.length) } });
  }) as unknown as typeof fetch & { calls: number };
  f.calls = 0;
  return f;
}

test('cmdInside: an archive path cannot climb out of its install folder', () => {
  const dir = path.join(os.tmpdir(), 'x');
  assert.equal(cmdInside(dir, './goose-package\\goose.exe'), path.join(dir, 'goose-package', 'goose.exe'));
  assert.equal(cmdInside(dir, '../evil'), null);
  assert.equal(cmdInside(dir, './a/../../evil'), null);
  assert.equal(cmdInside(dir, './'), null);
});

test('install: a matching archive is unpacked, recorded, and the catalog starts it from there', async () => {
  const { bytes, sha256 } = archive();
  const root = path.join(tempDir('seq-bin-store-'), 'agents-bin');
  const steps: string[] = [];
  const job = await installAgentBinary(agent(sha256), { installRoot: root, fetchImpl: serve(bytes), onProgress: (j) => steps.push(j.state) });
  assert.equal(job.state, 'done');
  assert.equal(job.receivedBytes, bytes.length);
  assert.ok(steps.includes('downloading') && steps.includes('unpacking'));
  const rec = readInstalled(root, 'fakeagent');
  assert.ok(rec);
  assert.equal(rec.command, path.join(root, 'fakeagent', '1.2.3', 'pkg', EXE));
  assert.equal(rec.sha256, sha256);
  const l = resolveCatalogLaunch(agent(sha256), { pathValue: tempDir('seq-bin-empty-'), extraDirs: [], installRoot: root });
  assert.ok(l.ok && l.via === 'installed', JSON.stringify(l));
  assert.equal(l.command, rec.command);
  assert.deepEqual(l.args, ['acp']);
});

test('install: a checksum mismatch installs nothing (each refusal has its own case)', async () => {
  const { bytes, sha256 } = archive();
  const root = path.join(tempDir('seq-bin-bad-'), 'agents-bin');
  const wrong = sha256.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
  await assert.rejects(installAgentBinary(agent(wrong), { installRoot: root, fetchImpl: serve(bytes) }), /does not match the registry's checksum/);
  assert.equal(readInstalled(root, 'fakeagent'), null);
  assert.equal(fs.existsSync(path.join(root, 'fakeagent', '1.2.3')), false, 'nothing unpacked');

  /* No checksum at all: refused before any download. */
  const noSha: CatalogAgent = { ...agent(sha256), distribution: { binary: { [platformKey()]: { archive: 'https://example.invalid/a.zip', cmd: './a' } } } };
  const f = serve(bytes);
  await assert.rejects(installAgentBinary(noSha, { installRoot: root, fetchImpl: f }), /no checksum/);
  assert.equal(f.calls, 0);

  /* A version of '..' would make the version folder agents-bin itself: refused before any download. */
  fs.mkdirSync(path.join(root, 'other-agent'), { recursive: true });
  const dots = serve(bytes);
  await assert.rejects(installAgentBinary({ ...agent(sha256), version: '..' }, { installRoot: root, fetchImpl: dots }), /unusable version/);
  assert.equal(dots.calls, 0);
  assert.ok(fs.existsSync(path.join(root, 'other-agent')), 'nothing else in agents-bin was touched');

  /* A cmd the archive does not contain. */
  await assert.rejects(installAgentBinary(agent(sha256, './pkg/other'), { installRoot: root, fetchImpl: serve(bytes) }), /did not contain/);
  assert.equal(readInstalled(root, 'fakeagent'), null);
});

test('route: Install runs in the background; the row then reads ready, installed by Sequence', async () => {
  resetSignInJobs();
  const { bytes, sha256 } = archive();
  const store = tempDir('seq-bin-rstore-');
  fs.writeFileSync(path.join(store, 'agent-catalog.json'), JSON.stringify({ agents: [agent(sha256)] }));
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: tempDir('seq-bin-home-'),
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: tempDir('seq-bin-rpath-'), extraDirs: [], capMs: 5_000 },
    catalogFetch: serve(bytes),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const call = (method: string, p: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  try {
    const before = ((await call('GET', '/api/acp/catalog')).json.agents as { id: string; state: string; installable?: boolean }[]).find((a) => a.id === 'fakeagent');
    assert.deepEqual([before?.state, before?.installable], ['install', true]);
    const go = await call('POST', '/api/acp/catalog/install', { id: 'fakeagent' });
    assert.equal(go.status, 202);
    let state = 'downloading';
    for (let i = 0; i < 100 && (state === 'downloading' || state === 'unpacking'); i++) {
      await new Promise((r) => setTimeout(r, 30));
      state = ((await call('GET', '/api/acp/catalog/install?id=fakeagent')).json.job as { state: string }).state;
    }
    assert.equal(state, 'done');
    const after = ((await call('GET', '/api/acp/catalog')).json.agents as { id: string; state: string; installedBySequence?: boolean }[]).find((a) => a.id === 'fakeagent');
    assert.deepEqual([after?.state, after?.installedBySequence], ['ready', true]);
    const connect = await call('POST', '/api/acp/catalog/connect', { id: 'fakeagent' });
    assert.equal(connect.status, 200);
    assert.equal((connect.json.agent as { command: string }).command, path.join(store, 'agents-bin', 'fakeagent', '1.2.3', 'pkg', EXE));
    /* A GET never installs anything. */
    const peek = await call('GET', '/api/acp/catalog/install?id=nope');
    assert.deepEqual(peek.json, {});
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});

test('install: an archive URL ending in a slash installs under the name "archive" instead of crashing the process', async () => {
  const { bytes, sha256 } = archive();
  const root = path.join(tempDir('seq-bin-slash-'), 'agents-bin');
  const a = agent(sha256);
  a.distribution.binary![platformKey()]!.archive = 'https://example.invalid/releases/';
  const job = await installAgentBinary(a, { installRoot: root, fetchImpl: serve(bytes) });
  assert.equal(job.state, 'done');
});

test('install: a download that breaks part-way is a rejection, not an uncaught error', async () => {
  const { bytes, sha256 } = archive();
  const root = path.join(tempDir('seq-bin-broken-'), 'agents-bin');
  const broken = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(bytes.subarray(0, 10)));
        c.error(new Error('connection reset'));
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  await assert.rejects(installAgentBinary(agent(sha256), { installRoot: root, fetchImpl: broken }), /connection reset/);
  assert.equal(readInstalled(root, 'fakeagent'), null);
});

test('reinstall: a failed unpack leaves the installed version in place and recorded', async () => {
  const { bytes, sha256 } = archive();
  const root = path.join(tempDir('seq-bin-re-'), 'agents-bin');
  await installAgentBinary(agent(sha256), { installRoot: root, fetchImpl: serve(bytes) });
  const before = readInstalled(root, 'fakeagent');
  assert.ok(before && fs.existsSync(before.command));
  /* node as the "tar": it exits non-zero on -xf, so the unpack fails. */
  await assert.rejects(installAgentBinary(agent(sha256), { installRoot: root, fetchImpl: serve(bytes), tarCommand: process.execPath }), /exited/);
  assert.ok(fs.existsSync(before.command), 'the live version is still there');
  assert.deepEqual(readInstalled(root, 'fakeagent'), before, 'and still recorded');
  assert.deepEqual(fs.readdirSync(path.join(root, 'fakeagent')).sort(), ['1.2.3', 'installed.json'], 'no staging folder left behind');
  /* Control: a good reinstall of the same version replaces it. */
  const job = await installAgentBinary(agent(sha256), { installRoot: root, fetchImpl: serve(bytes) });
  assert.equal(job.state, 'done');
  assert.ok(fs.existsSync(before.command));
});
