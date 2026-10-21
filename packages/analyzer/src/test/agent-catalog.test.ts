import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { resetSignInJobs, type SignInClientFactory } from '../server/agentCatalogRoutes.js';
import { BUILTIN_CATALOG, localCandidates, parseRegistry, readCatalog, resolveCatalogLaunch, sanitizeCatalogAgent, USER_CATALOG_FILE, type CatalogAgent } from '../server/agentCatalog.js';

/**
 * Lock for the PLUG-AND-PLAY AGENT CATALOG (agentCatalog.ts): any agent in the
 * ACP registry format connects by id, with the launch line chosen by the
 * server: the person's own CLI first, then `npx` (nothing to install), else an
 * honest "install" state. Binaries here are empty files in a temp dir: nothing
 * is ever spawned, only found.
 */

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A file `resolveBinary` will find (an .exe on Windows, an executable elsewhere). It is never run. */
function bin(dir: string, name: string): string {
  const p = path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
  fs.writeFileSync(p, '');
  if (process.platform !== 'win32') fs.chmodSync(p, 0o755);
  return p;
}

const gemini = BUILTIN_CATALOG.find((a) => a.id === 'gemini')!;
const hermes = BUILTIN_CATALOG.find((a) => a.id === 'hermes')!;
const opencode = BUILTIN_CATALOG.find((a) => a.id === 'opencode')!;

test('sanitize: only usable entries survive, and nothing but strings reaches a command line', () => {
  assert.equal(sanitizeCatalogAgent({ id: 'Bad Id', name: 'x', distribution: { npx: { package: 'a' } } }), null);
  assert.equal(sanitizeCatalogAgent({ id: 'ok', name: '', distribution: { npx: { package: 'a' } } }), null);
  assert.equal(sanitizeCatalogAgent({ id: 'ok', name: 'Ok', distribution: {} }), null, 'no way to start it');
  assert.equal(sanitizeCatalogAgent({ id: 'ok', name: 'Ok', distribution: { npx: { package: 'a; rm -rf /' } } }), null, 'a package spec with shell syntax is refused');
  const a = sanitizeCatalogAgent({ id: 'ok', name: 'Ok', website: 'javascript:alert(1)', distribution: { npx: { package: '@x/y@1.0.0', args: ['--acp', 3] } } });
  assert.ok(a);
  assert.equal(a.website, undefined, 'only https links travel');
  assert.equal(a.distribution.npx?.args, undefined, 'a mixed args list is dropped, not filtered into a different command');
  assert.deepEqual(parseRegistry({ agents: [null, 4, { id: 'z', name: 'Z', distribution: { uvx: { package: 'z==1', args: ['acp'] } } }] }).map((x) => x.id), ['z']);
  assert.deepEqual(parseRegistry('nope'), []);
});

test('candidates: the CLI each distribution installs, with the args that start ACP mode', () => {
  assert.deepEqual(localCandidates(gemini), [{ name: 'gemini', args: ['--acp'] }]);
  assert.deepEqual(localCandidates(opencode, 'windows-x86_64'), [{ name: 'opencode', args: ['acp'] }]);
  assert.deepEqual(localCandidates(hermes), [{ name: 'hermes', args: ['acp'] }]);
  const cursorWin: CatalogAgent = { id: 'cursor', name: 'Cursor', distribution: { binary: { 'windows-x86_64': { cmd: './dist-package\\cursor-agent.cmd', args: ['acp'] } } } };
  assert.deepEqual(localCandidates(cursorWin, 'windows-x86_64'), [{ name: 'cursor-agent', args: ['acp'] }]);
});

test('launch: own CLI first, then npx with nothing to install, else install (each exit has its own case)', () => {
  const empty = tempDir('seq-cat-empty-');
  const none = resolveCatalogLaunch(gemini, { pathValue: empty, extraDirs: [] });
  assert.equal(none.ok, false);
  assert.match(none.ok ? '' : none.message, /npm install -g @google\/gemini-cli/);

  const withNpx = tempDir('seq-cat-npx-');
  const npxPath = bin(withNpx, 'npx');
  const viaNpx = resolveCatalogLaunch(gemini, { pathValue: withNpx, extraDirs: [] });
  assert.ok(viaNpx.ok && viaNpx.via === 'npx', JSON.stringify(viaNpx));
  assert.equal(viaNpx.command, npxPath);
  assert.deepEqual(viaNpx.args, ['-y', '@google/gemini-cli@0.64.0', '--acp']);

  const withCli = tempDir('seq-cat-cli-');
  bin(withCli, 'npx');
  const geminiPath = bin(withCli, 'gemini');
  const local = resolveCatalogLaunch(gemini, { pathValue: withCli, extraDirs: [] });
  assert.ok(local.ok && local.via === 'local', JSON.stringify(local));
  assert.equal(local.command, geminiPath);
  assert.deepEqual(local.args, ['--acp']);
  assert.equal(local.shown, 'gemini --acp');

  /* A binary-only agent has no npx route: without its CLI it is install, even with npx present. */
  assert.equal(resolveCatalogLaunch(opencode, { pathValue: withNpx, extraDirs: [] }).ok, false);
});

test('launch: Node\'s own npx.cmd under a folder with a space runs as node + npx-cli.js (the owner\'s machine)', { skip: process.platform !== 'win32' }, () => {
  const nodejs = path.join(tempDir('seq-cat-pf-'), 'Program Files', 'nodejs');
  fs.mkdirSync(path.join(nodejs, 'node_modules', 'npm', 'bin'), { recursive: true });
  /* Node's real npx.cmd is a batch script of its own, not an npm shim template. */
  fs.writeFileSync(path.join(nodejs, 'npx.cmd'), ':: Created by npm, please don\'t edit manually.\r\n@ECHO OFF\r\nSETLOCAL\r\n"%_prog%" "%NPX_CLI_JS%" %*\r\n');
  const cli = path.join(nodejs, 'node_modules', 'npm', 'bin', 'npx-cli.js');
  fs.writeFileSync(cli, '');
  const nodeExe = bin(nodejs, 'node');
  const l = resolveCatalogLaunch(gemini, { pathValue: nodejs, extraDirs: [] });
  assert.ok(l.ok && l.via === 'npx', JSON.stringify(l));
  assert.equal(l.command, nodeExe);
  assert.deepEqual(l.args, [cli, '-y', '@google/gemini-cli@0.64.0', '--acp']);
});

test('a catalog arg carrying a launch token ({cwd}, {run}) is refused, so no registry entry can fake a sandbox', () => {
  const a = sanitizeCatalogAgent({ id: 'x', name: 'X', distribution: { npx: { package: 'x@1', args: ['--acp', '{cwd}'] } } });
  assert.equal(a, null, 'refused whole (with a reason): neither emptied of --acp nor given a different command');
});

test('a fetched registry cannot name a local program: its `bins` is dropped, and no shell is ever a candidate', () => {
  const store = tempDir('seq-cat-evil-');
  fs.writeFileSync(path.join(store, 'agent-registry-cache.json'), JSON.stringify({ fetchedAt: 1, registry: { agents: [
    { id: 'evil', name: 'Evil', distribution: {}, bins: [{ name: 'powershell', args: ['-c', 'calc'] }] },
    { id: 'evil2', name: 'Evil2', distribution: { binary: { any: { cmd: './cmd', args: ['/c', 'calc'] } } } },
  ] } }));
  const { agents } = readCatalog(store);
  const evil = agents.find((a) => a.id === 'evil');
  assert.ok(evil, 'the entry itself is listed');
  assert.equal(evil.bins, undefined);
  assert.deepEqual(localCandidates(agents.find((a) => a.id === 'evil2')!), [], './cmd is not cmd.exe');
  /* The snapshot's own hint for Hermes survives a registry entry of the same id. */
  fs.writeFileSync(path.join(store, 'agent-registry-cache.json'), JSON.stringify({ fetchedAt: 1, registry: { agents: [{ id: 'hermes', name: 'Hermes', distribution: { npx: { package: 'h@1' } }, bins: [{ name: 'bash', args: [] }] }] } }));
  assert.deepEqual(readCatalog(store).agents.find((a) => a.id === 'hermes')!.bins, [{ name: 'hermes', args: ['acp'] }]);
});

test('launch: a non-npm .cmd under a folder with a space still starts (cmd /c, path quoted by node)', { skip: process.platform !== 'win32' }, () => {
  const dir = path.join(tempDir('seq-cat-sp-'), 'John Smith', 'cursor-agent');
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, 'cursor-agent.cmd');
  fs.writeFileSync(shim, ['@echo off', 'node "%~dp0index.js" %*', ''].join('\r\n'));
  const cursor = BUILTIN_CATALOG.find((a) => a.id === 'cursor')!;
  const l = resolveCatalogLaunch(cursor, { pathValue: dir, extraDirs: [] });
  assert.ok(l.ok && l.via === 'local', JSON.stringify(l));
  assert.deepEqual(l.args, ['/d', '/c', shim, 'acp']);
});

test('catalog: snapshot, then cached registry, then the person\'s own file, by id; Claude and Codex stay with their own flow', () => {
  const store = tempDir('seq-cat-store-');
  fs.writeFileSync(
    path.join(store, USER_CATALOG_FILE),
    JSON.stringify({ agents: [{ id: 'my-agent', name: 'In-house agent', distribution: {}, bins: [{ name: 'house-agent', args: ['--acp'] }] }, { id: 'claude-acp', name: 'Claude', distribution: { npx: { package: 'x' } } }] }),
  );
  const { agents } = readCatalog(store);
  const ids = agents.map((a) => a.id);
  assert.ok(ids.includes('my-agent'));
  assert.equal(agents.find((a) => a.id === 'my-agent')!.source, 'user');
  assert.ok(!ids.includes('claude-acp'), 'Claude Code is connected through its own bridge flow, not twice');
  assert.equal(agents.find((a) => a.id === 'gemini')!.source, 'builtin');
  assert.equal(new Set(ids).size, ids.length, 'one row per id');
});

/* ---------------- the routes ---------------- */

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

async function start(binDir: string, store: string, catalogFetch?: typeof fetch, extra: Record<string, unknown> = {}) {
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: tempDir('seq-cat-home-'),
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: binDir, extraDirs: [], capMs: 5_000 },
    ...(catalogFetch ? { catalogFetch } : {}),
    ...extra,
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

type Row = { id: string; state: string; source: string; shown?: string; mismatch?: string };

/** A client that answers ACP initialize at once: the agent is real. Records what Connect launched. */
function answeringFactory(launched: { command: string; args: string[] }[] = []): SignInClientFactory {
  return (l) => {
    launched.push(l);
    return { start: async () => {}, authMethods: () => [], authenticate: async () => {}, dispose: async () => {} };
  };
}

test('routes: list, connect by id (the command comes from the catalog), then it reads connected', async () => {
  const binDir = tempDir('seq-cat-rbin-');
  const store = tempDir('seq-cat-rstore-');
  const hermesPath = bin(binDir, 'hermes');
  bin(binDir, 'npx');
  const s = await start(binDir, store, undefined, { catalogClientFactory: answeringFactory() });
  try {
    const list = await call(s.port, 'GET', '/api/acp/catalog');
    assert.equal(list.status, 200);
    const rows = list.json.agents as Row[];
    assert.equal(rows.find((r) => r.id === 'hermes')?.state, 'ready');
    assert.equal(rows.find((r) => r.id === 'gemini')?.state, 'npx');
    assert.equal(rows.find((r) => r.id === 'opencode')?.state, 'install');
    assert.equal(rows[0]!.state, 'ready', 'what can start now is listed first');

    /* A command in the body is ignored: the caller names an id, never a command line. */
    const r = await call(s.port, 'POST', '/api/acp/catalog/connect', { id: 'hermes', command: 'calc.exe' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const agent = r.json.agent as { id: string; command: string; args: string[]; label: string };
    assert.deepEqual([agent.id, agent.command, agent.args, agent.label], ['hermes', hermesPath, ['acp'], 'Hermes Agent']);
    const agents = await call(s.port, 'GET', '/api/acp/agents');
    assert.deepEqual((agents.json.agents as { id: string }[]).map((a) => a.id), ['hermes']);

    const again = await call(s.port, 'GET', '/api/acp/catalog');
    assert.equal((again.json.agents as Row[]).find((x) => x.id === 'hermes')?.state, 'connected');

    const missing = await call(s.port, 'POST', '/api/acp/catalog/connect', { id: 'opencode' });
    assert.equal(missing.status, 409);
    assert.equal(missing.json.state, 'install');
    const unknown = await call(s.port, 'POST', '/api/acp/catalog/connect', { id: 'nope' });
    assert.equal(unknown.status, 404);
  } finally {
    await s.close();
  }
});

test('routes: Refresh reads the live registry; offline keeps the snapshot and says so', async () => {
  const binDir = tempDir('seq-cat-fbin-');
  const store = tempDir('seq-cat-fstore-');
  bin(binDir, 'npx');
  const registry = { version: '1.0.0', agents: [{ id: 'newcomer', name: 'Newcomer', version: '0.1.0', distribution: { npx: { package: 'newcomer@0.1.0', args: ['acp'] } } }] };
  let calls = 0;
  const ok = (async () => {
    calls++;
    return new Response(JSON.stringify(registry), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const s = await start(binDir, store, ok);
  try {
    const before = await call(s.port, 'GET', '/api/acp/catalog');
    assert.ok(!(before.json.agents as Row[]).some((x) => x.id === 'newcomer'));
    assert.equal(calls, 0, 'listing never touches the network');
    const r = await call(s.port, 'POST', '/api/acp/catalog/refresh', {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const row = (r.json.agents as Row[]).find((x) => x.id === 'newcomer');
    assert.deepEqual([row?.state, row?.source], ['npx', 'registry']);
    assert.equal(typeof r.json.registryFetchedAt, 'number');
  } finally {
    await s.close();
  }

  const failing = (async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  }) as unknown as typeof fetch;
  const store2 = tempDir('seq-cat-fstore2-');
  const s2 = await start(binDir, store2, failing);
  try {
    const r = await call(s2.port, 'POST', '/api/acp/catalog/refresh', {});
    assert.equal(r.status, 502);
    assert.match(String(r.json.error), /ENOTFOUND/);
    assert.ok((r.json.agents as Row[]).some((x) => x.id === 'gemini'), 'the snapshot still answers');
  } finally {
    await s2.close();
  }
});

test('sign-in: reads the agent\'s ACP auth methods, then runs the chosen one in the background', async () => {
  resetSignInJobs();
  const binDir = tempDir('seq-cat-sbin-');
  const store = tempDir('seq-cat-sstore-');
  bin(binDir, 'npx');
  const launches: { command: string; args: string[] }[] = [];
  const authed: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const factory: SignInClientFactory = (l) => {
    launches.push(l);
    return {
      /* Agents take seconds to start (Gemini over npx: 26 s): long enough for two clicks to overlap. */
      start: () => new Promise<void>((r) => setTimeout(r, 150)),
      authMethods: () => [
        { id: 'oauth-personal', name: 'Log in with Google', type: 'agent' },
        { id: 'setup', name: 'Run in terminal', type: 'terminal', args: ['--setup'] },
      ],
      authenticate: async (m) => {
        await gate;
        if (m !== 'oauth-personal') throw new Error('no such method');
        authed.push(m);
      },
      dispose: async () => {},
    };
  };
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: tempDir('seq-cat-shome-'),
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: binDir, extraDirs: [], capMs: 5_000 },
    catalogClientFactory: factory,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    /* A GET only reads a job: a cross-site <img> can send one, so it must never start an agent. */
    const peek = await call(port, 'GET', '/api/acp/catalog/sign-in?id=gemini');
    assert.equal(peek.status, 200);
    assert.equal(launches.length, 0, 'a GET started nothing');
    /* Two clicks at once share one agent process. */
    const [m, m2] = await Promise.all([call(port, 'POST', '/api/acp/catalog/sign-in/methods', { id: 'gemini' }), call(port, 'POST', '/api/acp/catalog/sign-in/methods', { id: 'gemini' })]);
    assert.equal(m2.status, 200);
    assert.equal(launches.length, 1, 'concurrent method reads started one agent');
    assert.equal(m.status, 200, JSON.stringify(m.json));
    assert.deepEqual((m.json.methods as { id: string }[]).map((x) => x.id), ['oauth-personal', 'setup'], 'every method is listed; the page offers only agent ones as buttons');
    assert.deepEqual(launches[0]!.args.slice(-3), ['-y', '@google/gemini-cli@0.64.0', '--acp'], 'the catalog launch, not anything the caller sent');

    const bad = await call(port, 'POST', '/api/acp/catalog/sign-in', { id: 'gemini' });
    assert.equal(bad.status, 400, 'a method must be named');

    const go = await call(port, 'POST', '/api/acp/catalog/sign-in', { id: 'gemini', methodId: 'oauth-personal' });
    assert.equal(go.status, 202);
    assert.equal((go.json.job as { state: string }).state, 'running');
    const twice = await call(port, 'POST', '/api/acp/catalog/sign-in', { id: 'gemini', methodId: 'oauth-personal' });
    assert.equal(twice.status, 409, 'one sign-in per agent at a time');

    release();
    let state = 'running';
    for (let i = 0; i < 50 && state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      state = ((await call(port, 'GET', '/api/acp/catalog/sign-in?id=gemini')).json.job as { state: string }).state;
    }
    assert.equal(state, 'done');
    assert.equal(launches.length, 2, 'polling the job never started the agent again');
    assert.deepEqual(authed, ['oauth-personal']);

    /* A terminal method cannot run through ACP authenticate: the job fails with why, and never calls it. */
    const term = await call(port, 'POST', '/api/acp/catalog/sign-in', { id: 'gemini', methodId: 'setup' });
    assert.equal(term.status, 202);
    let tj: { state: string; error?: string } = { state: 'running' };
    for (let i = 0; i < 50 && tj.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      tj = (await call(port, 'GET', '/api/acp/catalog/sign-in?id=gemini')).json.job as { state: string; error?: string };
    }
    assert.equal(tj.state, 'failed');
    assert.match(String(tj.error), /terminal sign-in/);
    assert.deepEqual(authed, ['oauth-personal']);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});

test('sandbox: an npm agent gets a Docker launch that mounts only the project, passing keys by name', async () => {
  const { sandboxLaunch } = await import('../server/agentCatalog.js');
  const dir = tempDir('seq-cat-docker-');
  const docker = bin(dir, 'docker');
  const l = sandboxLaunch(gemini, { pathValue: dir, extraDirs: [], env: { PATH: dir, GEMINI_API_KEY: 'secret-value', OPENAI_API_KEY: 'other', GH_TOKEN: 'gh', UNRELATED: 'x' } });
  assert.ok(l.ok, JSON.stringify(l));
  assert.equal(l.command, docker);
  assert.deepEqual(l.args.slice(0, 6), ['run', '-i', '--rm', '--init', '--name', 'seq-gemini-{run}']);
  for (const flag of ['no-new-privileges', 'type=bind,src={cwd},dst=/workspace']) assert.ok(l.args.includes(flag), flag);
  assert.ok(l.args.includes('GEMINI_API_KEY'), 'its own key is passed by name');
  assert.ok(!l.args.some((a) => a.includes('secret-value')), 'and its value never reaches the command line');
  for (const other of ['OPENAI_API_KEY', 'GH_TOKEN', 'UNRELATED']) assert.ok(!l.args.includes(other), `${other} is not this agent's key`);
  assert.deepEqual(l.args.slice(-4), ['npx', '-y', '@google/gemini-cli@0.64.0', '--acp']);
  assert.equal(sandboxLaunch(opencode, { pathValue: dir, extraDirs: [] }).ok, false, 'not on npm: no sandbox yet');
  const none = sandboxLaunch(gemini, { pathValue: tempDir('seq-cat-nodocker-'), extraDirs: [], dockerDirs: [], env: { PATH: '' } });
  assert.equal(none.ok ? '' : none.reason, 'no-docker');
});

test('route: connect { runtime: docker } registers <id>-sandbox, and is refused while the engine is down', async () => {
  const binDir = tempDir('seq-cat-dbin-');
  bin(binDir, 'docker');
  bin(binDir, 'npx');
  let engine: string | null = 'Docker is installed but not running. Start Docker Desktop, then try again.';
  const store = tempDir('seq-cat-dstore-');
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: tempDir('seq-cat-dhome-'),
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: binDir, extraDirs: [], capMs: 5_000 },
    catalogDockerCheck: async () => engine,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const row = ((await call(port, 'GET', '/api/acp/catalog')).json.agents as { id: string; sandbox?: boolean }[]).find((a) => a.id === 'gemini');
    assert.equal(row?.sandbox, true);
    const off = await call(port, 'POST', '/api/acp/catalog/connect', { id: 'gemini', runtime: 'docker' });
    assert.equal(off.status, 409);
    assert.equal(off.json.state, 'docker-off');
    engine = null;
    const on = await call(port, 'POST', '/api/acp/catalog/connect', { id: 'gemini', runtime: 'docker' });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    const agent = on.json.agent as { id: string; label: string; args: string[] };
    assert.deepEqual([agent.id, agent.label], ['gemini-sandbox', 'Gemini CLI (sandbox)']);
    assert.ok(agent.args.includes('type=bind,src={cwd},dst=/workspace'));
    const again = ((await call(port, 'GET', '/api/acp/catalog')).json.agents as { id: string; sandboxConnected?: boolean; state: string }[]).find((a) => a.id === 'gemini');
    assert.deepEqual([again?.sandboxConnected, again?.state], [true, 'npx'], 'the plain agent is still offered on its own');
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});

/* ---------------- a different program with the agent's name ---------------- */

test('connect: a PATH program that answers initialize is an agent; one that exits, prints junk or hangs is marked in words', async () => {
  const binDir = tempDir('seq-cat-nc-bin-');
  const store = tempDir('seq-cat-nc-store-');
  const gooseBin = bin(binDir, 'goose');
  const hermesBin = bin(binDir, 'hermes');
  bin(binDir, 'npx');
  const launched: { command: string; args: string[] }[] = [];
  /* goose (pressly) exits at once; Hermes here is the real thing. A third stands for a program that prints junk and never answers. */
  const factory: SignInClientFactory = (l) => {
    if (l.command === gooseBin) return { start: async () => { throw new Error('the process exited with code 1'); }, authMethods: () => [], authenticate: async () => {}, dispose: async () => {} };
    return answeringFactory(launched)(l);
  };
  const s = await start(binDir, store, undefined, { catalogClientFactory: factory, catalogProbeMs: 500 });
  try {
    const bad = await call(s.port, 'POST', '/api/acp/catalog/connect', { id: 'goose' });
    assert.equal(bad.status, 409, JSON.stringify(bad.json));
    assert.equal(bad.json.state, 'mismatch');
    assert.match(String(bad.json.error), /A different program named goose is on PATH; it did not answer as an agent/);
    assert.deepEqual((((await call(s.port, 'GET', '/api/acp/agents')).json.agents) as { id: string }[]).map((a) => a.id), [], 'nothing was registered');

    const good = await call(s.port, 'POST', '/api/acp/catalog/connect', { id: 'hermes' });
    assert.equal(good.status, 200, JSON.stringify(good.json));
    assert.equal(launched[0]?.command, hermesBin);

    const rows = ((await call(s.port, 'GET', '/api/acp/catalog')).json.agents) as Row[];
    const g = rows.find((r) => r.id === 'goose')!;
    assert.equal(g.state, 'mismatch', 'the row no longer reads Installed');
    assert.match(g.mismatch ?? '', /different program named goose/);
    assert.equal(rows.find((r) => r.id === 'hermes')?.state, 'connected', 'the normal state for an agent that answers');
  } finally {
    await s.close();
  }
});

test('connect: a program that is slow to answer is connected, not marked, and the answer says it was slow', async () => {
  const binDir = tempDir('seq-cat-hang-bin-');
  const store = tempDir('seq-cat-hang-store-');
  bin(binDir, 'goose');
  /* start() ignores the abort signal and stays silent (Hermes takes ~45 s): the route's own bound still ends the wait, but silence is not "not an agent". */
  const factory: SignInClientFactory = () => ({ start: () => new Promise<void>(() => {}), authMethods: () => [], authenticate: async () => {}, dispose: async () => {} });
  const s = await start(binDir, store, undefined, { catalogClientFactory: factory, catalogProbeMs: 300 });
  try {
    const t0 = Date.now();
    const r = await call(s.port, 'POST', '/api/acp/catalog/connect', { id: 'goose' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(String(r.json.note), /slow to answer/);
    assert.ok(Date.now() - t0 < 4_000, 'did not wait for the program');
    const rows = ((await call(s.port, 'GET', '/api/acp/catalog')).json.agents) as Row[];
    assert.equal(rows.find((x) => x.id === 'goose')?.state, 'connected');
    assert.deepEqual((((await call(s.port, 'GET', '/api/acp/agents')).json.agents) as { id: string }[]).map((x) => x.id), ['goose']);
  } finally {
    await s.close();
  }
});

test('connect: the real client, pointed at an empty file standing in for another program, marks it too', async () => {
  const binDir = tempDir('seq-cat-real-bin-');
  const store = tempDir('seq-cat-real-store-');
  bin(binDir, 'goose'); /* an empty file: the default client really tries to spawn it and gets no ACP answer */
  const s = await start(binDir, store, undefined, { catalogProbeMs: 3_000 });
  try {
    const r = await call(s.port, 'POST', '/api/acp/catalog/connect', { id: 'goose' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.state, 'mismatch');
  } finally {
    await s.close();
  }
});
