import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCatalog, resolveCatalogLaunch, USER_CATALOG_FILE } from '../server/agentCatalog.js';

/** Review round fixes for the agent catalog (finding numbers match the review). Nothing here spawns a program. */

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function bin(dir: string, name: string): string {
  const p = path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
  fs.writeFileSync(p, '');
  if (process.platform !== 'win32') fs.chmodSync(p, 0o755);
  return p;
}
function cacheOf(store: string, agents: unknown[]): void {
  fs.writeFileSync(path.join(store, 'agent-registry-cache.json'), JSON.stringify({ fetchedAt: 1, registry: { agents } }));
}

test('1: a fetched registry entry cannot launch an arbitrary program on PATH through its cmd or package name', () => {
  const store = tempDir('seq-rb1-store-');
  const dir = tempDir('seq-rb1-bin-');
  bin(dir, 'perl');
  bin(dir, 'rg-tool');
  bin(dir, 'opencode');
  cacheOf(store, [
    { id: 'evil', name: 'Evil', distribution: { binary: { any: { cmd: './perl', args: ['-e', 'system("calc")'] } } } },
    { id: 'evil-npx', name: 'EvilNpx', distribution: { npx: { package: 'rg-tool@1.0.0', args: ['--acp'] } } },
    { id: 'opencode', name: 'OpenCode', distribution: { binary: { any: { cmd: './opencode', args: ['acp'] } } } },
  ]);
  const { agents } = readCatalog(store);
  const opts = { pathValue: dir, extraDirs: [] as string[] };
  for (const id of ['evil', 'evil-npx']) {
    const l = resolveCatalogLaunch(agents.find((a) => a.id === id)!, opts);
    assert.equal(l.ok && l.via === 'local', false, `${id}: ${JSON.stringify(l)}`);
  }
  /* Positive control: the vetted name for the same id (the snapshot's opencode) still launches. */
  const oc = resolveCatalogLaunch(agents.find((a) => a.id === 'opencode')!, opts);
  assert.ok(oc.ok && oc.via === 'local', JSON.stringify(oc));
  /* Positive control: the person's own catalog file stays trusted for any name. */
  fs.writeFileSync(path.join(store, USER_CATALOG_FILE), JSON.stringify({ agents: [{ id: 'evil', name: 'Mine', distribution: { binary: { any: { cmd: './perl', args: ['-v'] } } } }] }));
  const mine = resolveCatalogLaunch(readCatalog(store).agents.find((a) => a.id === 'evil')!, opts);
  assert.ok(mine.ok && mine.via === 'local', JSON.stringify(mine));
});

/* ---------------- route helpers ---------------- */

import http from 'node:http';
import { createRepoServer } from '../server/repoServer.js';
import { resetSignInJobs, type SignInClientFactory } from '../server/agentCatalogRoutes.js';

type Json = Record<string, unknown>;

function call(port: number, method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const h: Record<string, string> = { ...(data ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)) } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Json }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function start(binDir: string, store: string, extra: Record<string, unknown> = {}) {
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: tempDir('seq-rb-home-'),
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: binDir, extraDirs: [], capMs: 5_000 },
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

const okClient = (over: Partial<ReturnType<SignInClientFactory>> = {}): ReturnType<SignInClientFactory> => ({
  start: async () => {},
  authMethods: () => [{ id: 'oauth', name: 'Log in', type: 'agent' }],
  authenticate: async () => {},
  dispose: async () => {},
  ...over,
});

async function pollJob(port: number, id: string): Promise<{ state: string; error?: string }> {
  let j: { state: string; error?: string } = { state: 'running' };
  for (let i = 0; i < 100 && j.state === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 20));
    j = ((await call(port, 'GET', `/api/acp/catalog/sign-in?id=${id}`)).json.job ?? j) as typeof j;
  }
  return j;
}

test('2: a client factory that throws makes a failed job, not a sign-in stuck at running', async () => {
  resetSignInJobs();
  const binDir = tempDir('seq-rb2-bin-');
  bin(binDir, 'npx');
  let broken = true;
  const factory: SignInClientFactory = () => {
    if (broken) throw new Error('this agent is not driven over ACP');
    return okClient();
  };
  const s = await start(binDir, tempDir('seq-rb2-store-'), { catalogClientFactory: factory });
  try {
    const first = await call(s.port, 'POST', '/api/acp/catalog/sign-in', { id: 'gemini', methodId: 'oauth' });
    assert.equal(first.status, 202, JSON.stringify(first.json));
    const j = first.json.job as { state: string; error?: string };
    assert.equal(j.state, 'failed');
    assert.match(String(j.error), /not driven over ACP/);
    /* Later calls are not locked out by a 409 until restart. */
    broken = false;
    const retry = await call(s.port, 'POST', '/api/acp/catalog/sign-in', { id: 'gemini', methodId: 'oauth' });
    assert.equal(retry.status, 202, JSON.stringify(retry.json));
    assert.equal((await pollJob(s.port, 'gemini')).state, 'done');
    const methods = await call(s.port, 'POST', '/api/acp/catalog/sign-in/methods', { id: 'gemini' });
    assert.equal(methods.status, 200, JSON.stringify(methods.json));
  } finally {
    await s.close();
  }
});

test('3: a sign-in does not start a second agent process while a methods read is in flight', async () => {
  resetSignInJobs();
  const binDir = tempDir('seq-rb3-bin-');
  bin(binDir, 'npx');
  let launches = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const factory: SignInClientFactory = () => {
    launches++;
    return okClient({ start: () => gate });
  };
  const s = await start(binDir, tempDir('seq-rb3-store-'), { catalogClientFactory: factory });
  try {
    const read = call(s.port, 'POST', '/api/acp/catalog/sign-in/methods', { id: 'gemini' });
    for (let i = 0; i < 100 && launches === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(launches, 1);
    const go = await call(s.port, 'POST', '/api/acp/catalog/sign-in', { id: 'gemini', methodId: 'oauth' });
    assert.equal(go.status, 409, JSON.stringify(go.json));
    assert.equal(launches, 1, 'still one process for the agent');
    release();
    assert.equal((await read).status, 200);
    /* Negative control: once the read has ended, a sign-in starts normally. */
    const after = await call(s.port, 'POST', '/api/acp/catalog/sign-in', { id: 'gemini', methodId: 'oauth' });
    assert.equal(after.status, 202, JSON.stringify(after.json));
    assert.equal(launches, 2);
  } finally {
    await s.close();
  }
});

/* ---------------- 4: the capabilities probe ---------------- */

import { addAgent } from '../server/agentsStore.js';

function sandboxSpec(store: string): { spawned: { command: string; args: string[] }[]; spawn: (c: string, a: string[]) => never } {
  addAgent(store, { id: 'gemini-sandbox', command: 'docker', args: ['run', '-i', '--rm', '--mount', 'type=bind,src={cwd},dst=/workspace', '-w', '/workspace', 'img', 'npx', '-y', 'x'], label: 'Gemini CLI (sandbox)' });
  const spawned: { command: string; args: string[] }[] = [];
  return {
    spawned,
    spawn: (command: string, args: string[]) => {
      spawned.push({ command, args: [...args] });
      throw new Error('fake spawn: nothing runs');
    },
  };
}

test('4: the capabilities probe mounts the project root, not the server cwd, and a cross-site GET cannot start a sandboxed agent', async () => {
  const store = tempDir('seq-rb4-store-');
  const sp = sandboxSpec(store);
  const s = await start(tempDir('seq-rb4-bin-'), store, { acpTurn: { spawn: sp.spawn } });
  try {
    const q = '/api/acp/capabilities?agentRef=gemini-sandbox';
    const cross = await call(s.port, 'GET', q, undefined, { 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.status, 403, JSON.stringify(cross.json));
    const bare = await call(s.port, 'GET', q);
    assert.equal(bare.status, 403, 'no Origin and no same-origin marker: refused');
    assert.equal(sp.spawned.length, 0, 'nothing was started');
    /* Positive control: the page itself (same-origin fetch) starts it, with the project root mounted. */
    await call(s.port, 'GET', q, undefined, { 'sec-fetch-site': 'same-origin' });
    assert.equal(sp.spawned.length, 1);
    const mount = sp.spawned[0]!.args.find((a) => a.startsWith('type=bind,src='))!;
    assert.ok(mount, JSON.stringify(sp.spawned[0]));
    assert.notEqual(mount, `type=bind,src=${process.cwd()},dst=/workspace`, 'not the server working directory');
  } finally {
    await s.close();
  }
});

/* ---------------- 5 and 6: the docker argv ---------------- */

import { BUILTIN_CATALOG, sandboxLaunch } from '../server/agentCatalog.js';

function dockerArgv(over: { platform?: NodeJS.Platform; uid?: number; gid?: number } = {}): string[] {
  const dir = tempDir('seq-rb5-docker-');
  bin(dir, 'docker');
  const l = sandboxLaunch(BUILTIN_CATALOG.find((a) => a.id === 'gemini')!, { pathValue: dir, extraDirs: [], dockerDirs: [], env: { PATH: dir }, ...over } as never);
  assert.ok(l.ok, JSON.stringify(l));
  return l.args;
}
const valueOf = (args: string[], flag: string): string[] => args.flatMap((a, i) => (a === flag ? [args[i + 1]!] : []));

test('5: on Linux the npm cache lives where the uid we run as can write, not on a root-owned new volume', () => {
  const args = dockerArgv({ platform: 'linux', uid: 1000, gid: 1000 });
  assert.deepEqual(valueOf(args, '--user'), ['1000:1000']);
  const envs = valueOf(args, '-e');
  const home = envs.find((e) => e.startsWith('HOME='))!.slice(5);
  const cache = envs.find((e) => e.startsWith('npm_config_cache='))!.slice('npm_config_cache='.length);
  assert.ok(home.startsWith('/tmp/'), home);
  assert.ok(cache.startsWith(`${home}/`) || cache.startsWith('/tmp/'), cache);
  /* A new named volume is root:root 0755 unless the image has the mount point: only /tmp (1777 in the image) is writable to any uid. */
  const vol = valueOf(args, '-v').find((v) => /^sequence-npm-cache[\w-]*:/.test(v))!;
  assert.ok(vol, JSON.stringify(args));
  const target = vol.split(':')[1]!;
  assert.equal(target, '/tmp', 'the volume is mounted over the image\'s world-writable /tmp');
  assert.ok(cache === target || cache.startsWith(`${target}/`), 'the cache sits inside the volume');
  assert.ok(!envs.some((e) => e.includes('/npm-cache')), 'not the old root-owned path');
  assert.ok(!vol.startsWith('sequence-npm-cache:'), 'a fresh volume name, so an old root-owned volume is not reused');
  /* Negative control: elsewhere the container runs as root with the default cache. */
  const other = dockerArgv({ platform: 'win32' });
  assert.deepEqual(valueOf(other, '--user'), []);
  assert.ok(valueOf(other, '-v').includes('sequence-npm-cache:/root/.npm'));
});

test('6: the project is mounted with --mount (a colon in the path is not a separator), and the token stays for the spawn', () => {
  for (const platform of ['linux', 'win32'] as const) {
    const args = dockerArgv({ platform, uid: 1000, gid: 1000 });
    assert.deepEqual(valueOf(args, '--mount'), ['type=bind,src={cwd},dst=/workspace'], platform);
    assert.ok(!args.some((a) => a === '{cwd}:/workspace'), 'the colon form is gone');
    assert.ok(!valueOf(args, '-v').some((v) => v.includes('{cwd}')));
  }
});

/* ---------------- 9: Refresh ---------------- */

test('9: Refresh needs a JSON request and caps the registry response before parsing it', async () => {
  const binDir = tempDir('seq-rb9-bin-');
  const store = tempDir('seq-rb9-store-');
  const small = { agents: [{ id: 'newcomer', name: 'Newcomer', distribution: { npx: { package: 'newcomer@0.1.0' } } }] };
  let body = JSON.stringify(small);
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const s = await start(binDir, store, { catalogFetch: fetchImpl });
  try {
    const nonJson = await call(s.port, 'POST', '/api/acp/catalog/refresh');
    assert.equal(nonJson.status, 415, JSON.stringify(nonJson.json));
    assert.equal(calls, 0, 'no network call for a request that is not JSON');
    /* A response over the cap is refused, whatever it holds, and nothing is stored. */
    body = JSON.stringify({ agents: small.agents, pad: 'x'.repeat(3 * 1024 * 1024) });
    const big = await call(s.port, 'POST', '/api/acp/catalog/refresh', {});
    assert.equal(big.status, 502, JSON.stringify(big.json).slice(0, 200));
    assert.match(String(big.json.error), /too large|2 MB/i);
    assert.equal(fs.existsSync(path.join(store, 'agent-registry-cache.json')), false);
    /* Positive control: a normal registry is stored. */
    body = JSON.stringify(small);
    const ok = await call(s.port, 'POST', '/api/acp/catalog/refresh', {});
    assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 200));
    assert.ok(fs.existsSync(path.join(store, 'agent-registry-cache.json')));
  } finally {
    await s.close();
  }
});

/* ---------------- 10: small edges ---------------- */

import { sanitizeCatalogAgent } from '../server/agentCatalog.js';

test('10a: a catalog id ending -sandbox is refused, so it cannot collide with another id\'s Docker copy', () => {
  const mk = (id: string) => sanitizeCatalogAgent({ id, name: 'X', distribution: { npx: { package: 'x@1', args: ['--acp'] } } });
  assert.equal(mk('gemini-sandbox'), null);
  assert.ok(mk('gemini'), 'negative control: an ordinary id is fine');
  assert.ok(mk('sandbox-tool'), 'only the suffix collides');
  const store = tempDir('seq-rb10a-store-');
  cacheOf(store, [{ id: 'gemini-sandbox', name: 'Fake', distribution: { npx: { package: 'x@1' } } }]);
  assert.ok(!readCatalog(store).agents.some((a) => a.id === 'gemini-sandbox'));
});

test('10b: a runtime other than docker is a 400, not a silent fallback to the host', async () => {
  const binDir = tempDir('seq-rb10b-bin-');
  bin(binDir, 'npx');
  const s = await start(binDir, tempDir('seq-rb10b-store-'));
  try {
    const bad = await call(s.port, 'POST', '/api/acp/catalog/connect', { id: 'gemini', runtime: 'podman' });
    assert.equal(bad.status, 400, JSON.stringify(bad.json));
    assert.match(String(bad.json.error), /runtime/);
    const agents = await call(s.port, 'GET', '/api/acp/agents');
    assert.deepEqual((agents.json.agents as unknown[]).length, 0, 'nothing was registered');
    const host = await call(s.port, 'POST', '/api/acp/catalog/connect', { id: 'gemini' });
    assert.equal(host.status, 200, 'negative control: no runtime is the host launch');
  } finally {
    await s.close();
  }
});

test('10c: an args list with a { or } token is not silently emptied: the entry is refused with a message, and a clean list is kept whole', () => {
  const mk = (args: string[]) => sanitizeCatalogAgent({ id: 'x', name: 'X', distribution: { npx: { package: 'x@1', args } } });
  assert.equal(mk(['--acp', '{cwd}']), null);
  assert.deepEqual(mk(['--acp', '--flag'])?.distribution.npx?.args, ['--acp', '--flag']);
  const store = tempDir('seq-rb10c-store-');
  cacheOf(store, [{ id: 'bad', name: 'Bad', distribution: { npx: { package: 'bad@1', args: ['--acp', '{run}'] } } }]);
  const c = readCatalog(store);
  assert.ok(!c.agents.some((a) => a.id === 'bad'));
  const why = c.refused.find((r) => r.id === 'bad')?.reason ?? '';
  assert.match(why, /\{run\}/);
  assert.match(why, /not allowed|reserved|refused/i);
});
