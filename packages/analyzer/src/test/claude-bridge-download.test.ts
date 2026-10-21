import assert from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { CLAUDE_BRIDGE_CLOSURE, CLAUDE_BRIDGE_ENTRY, CLAUDE_BRIDGE_PACKAGE, CLAUDE_BRIDGE_VERSION, type BridgePackage } from '../server/claudeBridgeClosure.js';
import { createBridgeProvisioner, extractTgz, megabytes, extractTgz as _x, plainReason, proxyChoice, proxyFor, retryDelayMs, verifyIntegrity } from '../server/claudeBridgeInstall.js';
import { launcherPath } from '../server/claudeCli.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER = path.resolve(HERE, '..', '..');
const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

/** A minimal ustar writer: [{name, body, mode?, type?}] -> .tgz, like `npm pack` makes (entries under package/). */
function tgz(entries: { name: string; body?: string; mode?: number; type?: string; pax?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, mode: number, type: string): Buffer => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0);
    h.write(mode.toString(8).padStart(7, '0') + '\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write(type, 156);
    h.write('ustar\0' + '00', 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const pad = (b: Buffer): Buffer => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  for (const e of entries) {
    if (e.pax) {
      const rec = ` path=${e.pax}\n`;
      let len = rec.length + 1;
      while (String(len).length + rec.length !== len) len = String(len).length + rec.length;
      const body = Buffer.from(`${len}${rec}`);
      blocks.push(header('PaxHeader', body.length, 0o644, 'x'), pad(body));
    }
    const body = Buffer.from(e.body ?? '');
    blocks.push(header(e.name, body.length, e.mode ?? 0o644, e.type ?? '0'), pad(body));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const sri = (b: Buffer): string => 'sha512-' + createHash('sha512').update(b).digest('base64');

test('extractTgz: drops package/, keeps the exec bit, reads pax long names, refuses paths that climb out, skips links', async () => {
  const dest = tmp('seq-tar-');
  const long = 'package/' + 'deep/'.repeat(30) + 'file.txt';
  const n = await extractTgz(tgz([{ name: 'package/package.json', body: '{}' }, { name: 'package/bin/run', body: '#!/bin/sh\n', mode: 0o755 }, { name: 'x', body: 'long', pax: long }, { name: 'package/link', type: '2' }]), dest);
  assert.equal(n, 3);
  assert.ok(fs.existsSync(path.join(dest, 'package.json')));
  assert.equal(fs.readFileSync(path.join(dest, ...long.split('/').slice(1)), 'utf8'), 'long');
  if (process.platform !== 'win32') assert.ok(fs.statSync(path.join(dest, 'bin', 'run')).mode & 0o100, 'exec bit kept');
  assert.ok(!fs.existsSync(path.join(dest, 'link')));
  await assert.rejects(extractTgz(tgz([{ name: 'package/../../escape.txt', body: 'x' }]), dest), /unsafe path/);
  await assert.rejects(extractTgz(tgz([{ name: '/etc/passwd', body: 'x' }]), dest), /unsafe path/);
  await assert.rejects(extractTgz(tgz([{ name: 'package/a:stream', body: 'x' }]), dest), /unsafe path/, 'a colon is an NTFS alternate data stream');
  assert.ok(!fs.existsSync(path.join(path.dirname(dest), 'escape.txt')));
});

function world(opts: { tamper?: string; status?: Record<string, number> } = {}) {
  const pkgs: { p: BridgePackage; body: Buffer }[] = ['a', 'b'].map((n) => {
    const body = tgz([{ name: 'package/package.json', body: JSON.stringify({ name: n }) }, ...(n === 'b' ? [{ name: 'package/dist/index.js', body: 'export {}' }] : [])]);
    return { p: { path: `node_modules/${n}`, name: n, version: '1.0.0', integrity: sri(body), resolved: `https://registry.npmjs.org/${n}/-/${n}-1.0.0.tgz`, license: 'MIT' }, body };
  });
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    const hit = pkgs.find((x) => String(url).endsWith(`/${x.p.name}-1.0.0.tgz`));
    const code = opts.status?.[hit?.p.name ?? ''] ?? (hit ? 200 : 404);
    if (code !== 200) return new Response('no', { status: code });
    const body = opts.tamper === hit!.p.name ? Buffer.concat([hit!.body, Buffer.from('x')]) : hit!.body;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { closure: pkgs.map((x) => x.p), fetchImpl, urls };
}

test('download: fetches the pinned closure, checks every sha512, unpacks into <dir>/<version> with a marker, reports progress, and is idempotent', async () => {
  const w = world();
  const dir = tmp('seq-dl-');
  const prov = createBridgeProvisioner({ dir, fetchImpl: w.fetchImpl, closure: w.closure, backoffMs: [0, 0], version: '9.9.9', entry: 'node_modules/b/dist/index.js' });
  assert.equal(prov.entry(), null);
  prov.start();
  assert.equal(prov.status().state, 'running');
  await prov.idle();
  const st = prov.status();
  assert.equal(st.state, 'done', st.error);
  assert.ok(st.receivedBytes > 0 && st.files === 2);
  assert.equal(prov.entry(), path.join(dir, '9.9.9', 'node_modules', 'b', 'dist', 'index.js'));
  assert.deepEqual(fs.readdirSync(dir), ['9.9.9'], 'no partial folder is left');
  const before = w.urls.length;
  prov.start();
  await prov.idle();
  assert.equal(w.urls.length, before, 'a finished tree is not fetched again');
  assert.equal(megabytes(12_400_000), '12 MB');
  assert.equal(megabytes(1_240_000), '1.2 MB');
});

test('download: a tarball that does not match its pinned checksum is refused (no retry, nothing usable is left)', async () => {
  const w = world({ tamper: 'a' });
  const dir = tmp('seq-dl-bad-');
  const prov = createBridgeProvisioner({ dir, fetchImpl: w.fetchImpl, closure: w.closure, backoffMs: [0, 0], version: '9.9.9', entry: 'node_modules/b/dist/index.js' });
  prov.start();
  await prov.idle();
  assert.equal(prov.status().state, 'failed');
  assert.match(prov.status().error ?? '', /checksum/);
  assert.equal(prov.entry(), null);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(w.urls.filter((u) => u.includes('/a-1.0.0.tgz')).length, 1, 'integrity failure is not retried');
  assert.throws(() => verifyIntegrity(Buffer.from('x'), 'sha1-abc', 'p'), /no sha512/);
});

test('download: a registry error fails with a plain reason, then waits a growing pause before trying again (the card does not flip)', async () => {
  const w = world({ status: { b: 503 } });
  let clock = 1_000;
  const prov = createBridgeProvisioner({ dir: tmp('seq-dl-503-'), fetchImpl: w.fetchImpl, closure: w.closure, backoffMs: [0, 0], version: '9.9.9', entry: 'node_modules/b/dist/index.js', now: () => clock });
  prov.start();
  await prov.idle();
  assert.equal(prov.status().state, 'failed');
  assert.equal(prov.status().error, 'the npm registry answered 503');
  const n = w.urls.length;
  clock += 60_000;
  prov.start();
  await prov.idle();
  assert.equal(w.urls.length, n, 'the old 60 s retry is gone');
  clock += retryDelayMs(1);
  prov.start();
  assert.equal(prov.status().state, 'failed', 'a try after a failure keeps the failed state and its reason until it succeeds');
  assert.ok(prov.status().error);
  await prov.idle();
  assert.ok(w.urls.length > n);
  assert.equal(prov.status().failures, 2);
  assert.ok(retryDelayMs(2) > retryDelayMs(1) && retryDelayMs(20) === 3_600_000);
});

test('download: the first failure stops every worker, removes the partial folder once they have stopped, and freezes the progress', async () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const pk = names.map((n) => {
    const body = tgz([{ name: 'package/package.json', body: JSON.stringify({ n }) }, { name: 'package/dist/index.js', body: 'x'.repeat(2000) }]);
    return { p: { path: `node_modules/${n}`, name: n, version: '1.0.0', integrity: sri(body), resolved: `https://registry.npmjs.org/${n}/-/${n}-1.0.0.tgz`, license: null } as BridgePackage, body };
  });
  let served = 0;
  const fetchImpl = (async (url: string) => {
    const hit = pk.find((x) => String(url).endsWith(`/${x.p.name}-1.0.0.tgz`))!;
    if (hit.p.name === 'a') return new Response('x', { status: 500 });
    await new Promise((r) => setTimeout(r, hit.p.name === 'b' ? 5 : 40));
    served++;
    return new Response(hit.body);
  }) as unknown as typeof fetch;
  const dir = tmp('seq-dl-abort-');
  const prov = createBridgeProvisioner({ dir, fetchImpl, closure: pk.map((x) => x.p), concurrency: 4, backoffMs: [0, 0], version: '9.9.9', entry: 'node_modules/h/dist/index.js' });
  prov.start();
  await prov.idle();
  const at = prov.status();
  assert.equal(at.state, 'failed');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(prov.status().files, at.files, 'no worker kept going after the failure');
  assert.equal(prov.status().receivedBytes, at.receivedBytes);
  assert.ok(at.files < names.length);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n !== '.lock'), [], 'no partial folder, before or after');
  assert.ok(served <= 4 + 3);
});

test('download: a stalled registry times out per tarball and the size cap stops an oversized body', async () => {
  const w = world();
  const stall = (async (_u: string, o: { signal: AbortSignal }) => new Promise<Response>((_r, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
  const p1 = createBridgeProvisioner({ dir: tmp('seq-dl-stall-'), fetchImpl: stall, closure: w.closure, backoffMs: [0, 0], tarballTimeoutMs: 30, version: '9.9.9', entry: 'node_modules/b/dist/index.js' });
  p1.start();
  await p1.idle();
  assert.equal(p1.status().state, 'failed');
  assert.match(p1.status().error ?? '', /timed out/);
  const p2 = createBridgeProvisioner({ dir: tmp('seq-dl-cap-'), fetchImpl: w.fetchImpl, closure: w.closure, backoffMs: [0, 0], maxTarballBytes: 10, version: '9.9.9', entry: 'node_modules/b/dist/index.js' });
  p2.start();
  await p2.idle();
  assert.equal(p2.status().state, 'failed');
});

test('download: two servers share one folder: a lock keeps the second from fetching, a finished tree is never replaced, and partial folders and old releases are swept', async () => {
  const w = world();
  const dir = tmp('seq-dl-lock-');
  fs.mkdirSync(path.join(dir, '9.9.9.partial-4194000', 'x'), { recursive: true });
  for (const v of ['9.9.7', '9.9.8']) fs.mkdirSync(path.join(dir, v));
  fs.mkdirSync(path.join(dir, '9.8.0'));
  fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  const mk = () => createBridgeProvisioner({ dir, fetchImpl: w.fetchImpl, closure: w.closure, backoffMs: [0, 0], version: '9.9.9', entry: 'node_modules/b/dist/index.js' });
  const second = mk();
  second.start();
  assert.equal(w.urls.length, 0, 'the lock is held by a live process');
  fs.rmSync(path.join(dir, '.lock'));
  const first = mk();
  first.start();
  await first.idle();
  assert.equal(first.status().state, 'done');
  assert.ok(!fs.existsSync(path.join(dir, '9.9.9.partial-4194000')), 'a killed download\'s leftovers are swept');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['9.9.8', '9.9.9'], 'the newest previous release stays; older ones go; the lock is released');
  const marker = fs.statSync(path.join(dir, '9.9.9', '.sequence-complete')).mtimeMs;
  const third = mk();
  third.start();
  await third.idle();
  assert.equal(fs.statSync(path.join(dir, '9.9.9', '.sequence-complete')).mtimeMs, marker);
  /* a lock left by a dead process is taken over */
  fs.rmSync(path.join(dir, '9.9.9'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }));
  const fourth = mk();
  fourth.start();
  await fourth.idle();
  assert.equal(fourth.status().state, 'done');
});

test('download: failures read in plain words, and HTTPS_PROXY / NO_PROXY are honoured', () => {
  const e = (code: string) => Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('x'), { code }) });
  assert.match(plainReason(e('ENOTFOUND')), /could not find the npm registry/);
  assert.match(plainReason(e('ECONNREFUSED')), /failed or timed out/);
  assert.match(plainReason(e('SELF_SIGNED_CERT_IN_CHAIN')), /proxy or firewall is intercepting/);
  assert.match(plainReason(new Error('the proxy answered 407')), /proxy asked for a sign-in/);
  assert.match(plainReason(new Error('the proxy answered 403')), /proxy refused the connection \(403\)/);
  assert.match(plainReason(new Error('x: the registry answered 403')), /npm registry answered 403/);
  assert.match(plainReason(Object.assign(new Error('could not reach the proxy: connect ECONNREFUSED'), { code: 'EPROXYCONN' })), /could not reach the proxy/);
  assert.match(plainReason(Object.assign(new Error('SOCKS proxy (socks5://) is set'), { code: 'ESOCKS' })), /SOCKS proxy, which Sequence can't use/);
  const raw = plainReason(Object.assign(new Error("ENOENT: no such file or directory, open '/home/u/.sequence/claude-bridge/0.88.0.partial-1/x/index.js'"), { code: 'ENOENT' }));
  assert.doesNotMatch(raw, /[\\/]|ENOENT/, 'no raw path on the card');
  assert.match(raw, /data folder/);
  assert.match(plainReason(new Error('p: the download does not match its pinned checksum')), /checksum/);
  const env = { HTTPS_PROXY: 'http://proxy.corp:3128', NO_PROXY: 'localhost,.internal' };
  assert.equal(proxyFor('https://registry.npmjs.org/x.tgz', env)?.host, 'proxy.corp:3128');
  assert.equal(proxyFor('https://registry.npmjs.org/x.tgz', {}), null);
  assert.equal(proxyFor('https://pkg.internal/x.tgz', env), null);
});

test('download: a mirror replaces the registry origin in tarball URLs', async () => {
  const w = world();
  const prov = createBridgeProvisioner({ dir: tmp('seq-dl-mirror-'), fetchImpl: w.fetchImpl, closure: w.closure, backoffMs: [0, 0], version: '9.9.9', entry: 'node_modules/b/dist/index.js', registry: 'http://127.0.0.1:9/' });
  prov.start();
  await prov.idle();
  assert.ok(w.urls.every((u) => u.startsWith('http://127.0.0.1:9/')), w.urls.join(','));
});

test('the pinned closure: exact bridge version, sha512 on every package, the SDK\'s native binaries left out', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ANALYZER, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
  assert.equal(CLAUDE_BRIDGE_VERSION, pkg.devDependencies[CLAUDE_BRIDGE_PACKAGE], 'regenerate: node scripts/gen-claude-bridge-closure.mjs');
  assert.ok(CLAUDE_BRIDGE_CLOSURE.length > 50);
  for (const p of CLAUDE_BRIDGE_CLOSURE) {
    assert.match(p.integrity, /^sha512-/, p.path);
    assert.match(p.resolved, /^https:\/\/registry\.npmjs\.org\//, p.path);
    assert.doesNotMatch(p.name, /claude-agent-sdk-(linux|darwin|win32)/, 'native binaries are never downloaded');
  }
  assert.ok(CLAUDE_BRIDGE_CLOSURE.some((p) => p.path === `node_modules/${CLAUDE_BRIDGE_PACKAGE}` && p.version === CLAUDE_BRIDGE_VERSION));
  assert.ok(CLAUDE_BRIDGE_CLOSURE.some((p) => p.name === '@anthropic-ai/claude-agent-sdk'));
  assert.equal(CLAUDE_BRIDGE_ENTRY, `node_modules/${CLAUDE_BRIDGE_PACKAGE}/dist/index.js`);
});

/* ---- what runs in the bridge process ---- */

const checkUrl = pathToFileURL(path.join(ANALYZER, 'scripts', 'check-claude-bridge.mjs')).href;
const bundleUrl = pathToFileURL(path.join(ANALYZER, 'scripts', 'bundle-claude-bridge.mjs')).href;
type Check = { ok: boolean; problems: string[]; fake: string; claudeEnv: Record<string, string> | null; stderr: string };
const runCheck = async (o: { args?: string[]; entry?: string }): Promise<Check> => ((await import(checkUrl)) as { checkClaudeBridge: (o: unknown) => Promise<Check> }).checkClaudeBridge({ ...o, env: { ELECTRON_RUN_AS_NODE: '1' } });

function assertClaudeEnv(r: Check): void {
  assert.ok(r.ok, `${r.problems.join('; ')} ${r.stderr}`);
  assert.ok(r.claudeEnv, 'the bridge spawned the (fake) claude for session/new');
  /* the bridge was started WITH ELECTRON_RUN_AS_NODE=1; the claude it runs must not see it */
  assert.equal(r.claudeEnv.ELECTRON_RUN_AS_NODE, undefined);
  assert.match(path.basename(r.claudeEnv.CLAUDE_CODE_EXECUTABLE ?? ''), /^claude(\.exe)?$/);
}

test('launcher + the bridge: finds claude by itself, sets CLAUDE_CODE_EXECUTABLE, and ELECTRON_RUN_AS_NODE does not reach claude', async () => {
  const launcher = launcherPath();
  assert.ok(launcher, 'claude-agent-acp-launch.mjs must be built');
  const bridge = createRequire(path.join(ANALYZER, 'package.json')).resolve('@agentclientprotocol/claude-agent-acp/dist/index.js');
  assertClaudeEnv(await runCheck({ args: [launcher, bridge] }));
});

test('the FULL bundle (build flag): built here, boots the same way, and its notices cover everything folded in', async () => {
  const out = path.join(tmp('seq-full-'), 'claude-agent-acp.mjs');
  const { bundleClaudeBridge } = (await import(bundleUrl)) as { bundleClaudeBridge: (f: string) => Promise<number> };
  await bundleClaudeBridge(out);
  assertClaudeEnv(await runCheck({ entry: out }));
  const notices = fs.readFileSync(out.replace(/\.mjs$/, '.LICENSE.txt'), 'utf8');
  for (const name of ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/sdk', '@anthropic-ai/claude-agent-sdk', 'zod', 'diff']) assert.match(notices, new RegExp(`==== ${name.replace(/[/@-]/g, '\\$&')}@`), `${name} has a notice`);
  assert.match(notices, /MIT License|Permission is hereby granted/, 'the MIT text travels with zod');
  assert.match(notices, /all rights reserved/i, 'the Agent SDK terms are stated');
});

test('the launcher holds only our code (nothing third-party is redistributed by default)', async () => {
  const { bundleLauncher } = (await import(bundleUrl)) as { bundleLauncher: (f: string) => Promise<number> };
  const size = await bundleLauncher(path.join(tmp('seq-launch-bundle-'), 'l.mjs'));
  assert.ok(size < 40_000, `launcher is ${size} bytes`);
});

test('NO_PROXY: *.host, .host, host:port, CIDR, and an empty NO_PROXY does not hide no_proxy; socks and https proxies are told apart', () => {
  const t = 'https://registry.npmjs.org/x.tgz';
  const env = (no: string) => ({ HTTPS_PROXY: 'http://proxy.corp:3128', NO_PROXY: no });
  for (const no of ['*', '*.npmjs.org', '.npmjs.org', 'npmjs.org', 'registry.npmjs.org:443', 'a.b,registry.npmjs.org']) assert.equal(proxyFor(t, env(no)), null, no);
  for (const no of ['registry.npmjs.org:8443', 'other.org', '*.example.com']) assert.ok(proxyFor(t, env(no)), no);
  assert.equal(proxyFor('https://10.1.2.3/x', env('10.0.0.0/8')), null);
  assert.ok(proxyFor('https://11.1.2.3/x', env('10.0.0.0/8')));
  assert.equal(proxyFor(t, { HTTPS_PROXY: 'http://p:1', NO_PROXY: '', no_proxy: 'registry.npmjs.org' }), null, 'an empty NO_PROXY does not hide no_proxy');
  assert.deepEqual(proxyChoice(t, { ALL_PROXY: 'socks5://p:1080' }), { unsupported: 'socks5' });
  assert.equal(proxyFor(t, { HTTPS_PROXY: 'https://secure-proxy.corp' })?.protocol, 'https:');
  assert.equal(proxyFor(t, { HTTPS_PROXY: 'proxy.corp:3128' })?.hostname, 'proxy.corp', 'a bare host:port means http');
});

import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { EVIL_CERT, EVIL_KEY, NPM_CERT, NPM_KEY } from './proxy-test-certs.js';
import { coreGet } from '../server/claudeBridgeInstall.js';

/** A TLS "registry" and a CONNECT proxy that tunnels every CONNECT to it. The proxy can also misbehave. */
async function tunnelWorld(o: { cert: string; key: string; status?: number }) {
  const registry = https.createServer({ cert: o.cert, key: o.key }, (_req, res) => res.end('TARBALL-BYTES'));
  await new Promise<void>((r) => registry.listen(0, '127.0.0.1', r));
  const rport = (registry.address() as net.AddressInfo).port;
  const seen: string[] = [];
  const tunnels: import("node:stream").Duplex[] = [];
  const proxy = http.createServer();
  proxy.on('connect', (req, sock, head) => {
    seen.push(`${req.url} auth=${req.headers['proxy-authorization'] ?? ''}`);
    sock.on('error', () => {});
    tunnels.push(sock);
    if (o.status) return void sock.end(`HTTP/1.1 ${o.status} Nope\r\n\r\n`);
    const up = net.connect(rport, '127.0.0.1', () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    up.on('error', () => sock.destroy());
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const pport = (proxy.address() as net.AddressInfo).port;
  /* The tunnel is torn down with destroy(), not resetAndDestroy(): on Node 20, 22 and 24 (Linux) a socket reset this way leaves a handle the
     loop can never close, and the whole test FILE then spins in Environment::CleanupHandles() after every test has passed (found with gdb:
     the file reported 'cancelled' for 120 s). The client's sockets are the ones under test and are already destroyed by then. */
  /* A reset is something the TEST does once the download has been read, not a timer from the CONNECT: 150 ms after it was a bet that the handshake and body were done, and a loaded machine lost it (the reset then cut the download itself). */
  return { seen, pport, reset: () => { for (const s of tunnels) s.destroy(); }, close: () => { proxy.close(); registry.close(); } };
}

async function withProxyEnv<T>(pport: number, ca: string, fn: () => Promise<T>, proxyUrl = `http://us%40er:p%3Ass@127.0.0.1:${pport}`): Promise<T> {
  const keys = ['HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'SEQUENCE_EXTRA_CA_CERTS'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  const caFile = path.join(tmp('seq-ca-'), 'ca.pem');
  fs.writeFileSync(caFile, ca);
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.SEQUENCE_EXTRA_CA_CERTS = caFile;
  try {
    return await fn();
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}
const get = () => coreGet('https://registry.npmjs.org/x/-/x-1.0.0.tgz', { signal: new AbortController().signal, onBytes() {}, maxBytes: 1_000_000 });

test('proxy: a real body comes THROUGH the CONNECT tunnel (TLS verified inside it), with the proxy credentials decoded', async () => {
  const w = await tunnelWorld({ cert: NPM_CERT, key: NPM_KEY });
  try {
    const r = await withProxyEnv(w.pport, NPM_CERT, get);
    assert.equal(r.body.toString(), 'TARBALL-BYTES');
    assert.equal(w.seen.length, 1);
    assert.equal(w.seen[0], 'registry.npmjs.org:443 auth=Basic ' + Buffer.from('us@er:p:ss').toString('base64'));
  } finally {
    w.close();
  }
});

test('proxy: a certificate for the wrong host, or one nobody trusts, is refused inside the tunnel', async () => {
  const w = await tunnelWorld({ cert: EVIL_CERT, key: EVIL_KEY });
  try {
    await assert.rejects(withProxyEnv(w.pport, EVIL_CERT, get), (e: NodeJS.ErrnoException) => /ALTNAME|altnames/i.test(`${e.code} ${e.message}`));
    await assert.rejects(withProxyEnv(w.pport, NPM_CERT, get), (e: NodeJS.ErrnoException) => /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|altnames/i.test(`${e.code} ${e.message}`));
  } finally {
    w.close();
  }
});

test('proxy: a reset of the tunnel after the download does not crash the process, and a refusing proxy reads as a proxy error', async () => {
  const w = await tunnelWorld({ cert: NPM_CERT, key: NPM_KEY });
  const crashed: unknown[] = [];
  const onCrash = (e: unknown): void => void crashed.push(e);
  process.on('uncaughtException', onCrash);
  try {
    const r = await withProxyEnv(w.pport, NPM_CERT, get);
    assert.equal(r.body.toString(), 'TARBALL-BYTES');
    w.reset(); // the download is in hand: now the tunnel dies under whatever still holds it
    await new Promise((res) => setTimeout(res, 500)); // a quiet window for a crash; a late one cannot fail what passed
    assert.deepEqual(crashed, [], 'no uncaught exception');
  } finally {
    process.off('uncaughtException', onCrash);
    w.close();
  }
  const refusing = await tunnelWorld({ cert: NPM_CERT, key: NPM_KEY, status: 403 });
  try {
    await assert.rejects(withProxyEnv(refusing.pport, NPM_CERT, get), (e: Error) => /the proxy answered 403/.test(e.message) && /proxy refused the connection \(403\)/.test(plainReason(e)));
  } finally {
    refusing.close();
  }
  await assert.rejects(withProxyEnv(1, NPM_CERT, get, 'http://127.0.0.1:1'), (e: Error) => /could not reach the proxy/.test(plainReason(e)));
  await assert.rejects(withProxyEnv(1, NPM_CERT, get, 'socks5://127.0.0.1:1080'), (e: Error) => /SOCKS/.test(plainReason(e)));
});

test('lock: a live owner is never robbed, a stale one is taken by exactly one process, release only removes our own lock, and a live download\'s folder is never swept', async () => {
  const w = world();
  const dir = tmp('seq-dl-lock2-');
  const mk = (now?: () => number) => createBridgeProvisioner({ dir, fetchImpl: w.fetchImpl, closure: w.closure, backoffMs: [0, 0], version: '9.9.9', entry: 'node_modules/b/dist/index.js', ...(now ? { now } : {}) });
  /* a live pid with an old timestamp: still the owner while heartbeats keep it fresh, so 4 minutes on it is NOT stolen... */
  fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: process.pid, at: 1_000, token: 'other' }));
  const p1 = mk(() => 1_000 + 4 * 60_000);
  p1.start();
  assert.equal(w.urls.length, 0, 'a fresh heartbeat (under 5 min) from a live pid holds the lock');
  /* ...but a heartbeat silent for over 5 minutes is stale even though the pid is alive (a recycled pid) */
  const p2 = mk(() => 1_000 + 6 * 60_000);
  p2.start();
  await p2.idle();
  assert.equal(p2.status().state, 'done');
  assert.ok(!fs.existsSync(path.join(dir, '.lock')), 'released');
  /* release only removes our own lock: someone else's lock written meanwhile survives */
  fs.rmSync(path.join(dir, '9.9.9'), { recursive: true });
  const slow = createBridgeProvisioner({ dir, closure: w.closure, backoffMs: [0, 0], version: '9.9.9', entry: 'node_modules/b/dist/index.js', getter: async () => { fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: process.pid, at: Date.now(), token: 'someone-else' })); return { status: 500, body: Buffer.alloc(0) }; } });
  slow.start();
  await slow.idle();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.lock'), 'utf8')).token, 'someone-else');
  fs.rmSync(path.join(dir, '.lock'));
  /* a partial folder of a LIVE other process is not swept; a dead one's is */
  const child = (await import('node:child_process')).spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)']);
  fs.mkdirSync(path.join(dir, `9.9.9.partial-${child.pid}`));
  fs.mkdirSync(path.join(dir, '9.9.9.partial-4194000'));
  const p3 = mk();
  p3.start();
  await p3.idle();
  assert.ok(fs.existsSync(path.join(dir, `9.9.9.partial-${child.pid}`)), 'a live download\'s folder is left alone');
  assert.ok(!fs.existsSync(path.join(dir, '9.9.9.partial-4194000')));
  child.kill();
});

test('the shipped closure is the tested tree: every package@version in it is in the workspace pnpm lock that drives the tests', () => {
  const lock = fs.readFileSync(path.join(ANALYZER, '..', '..', 'pnpm-lock.yaml'), 'utf8');
  const missing = CLAUDE_BRIDGE_CLOSURE.filter((p) => !new RegExp(`^  '?${p.name.replace(/[/@.]/g, '\\$&')}@${p.version.replace(/\./g, '\\.')}(\\(|'?:)`, 'm').test(lock)).map((p) => `${p.name}@${p.version}`);
  assert.deepEqual(missing, [], 'regenerate with node scripts/gen-claude-bridge-closure.mjs (it pins to the pnpm lock)');
});

test('download: checking and unpacking a large package never holds the event loop for long', async () => {
  const { randomBytes } = await import('node:crypto');
  const big = tgz([{ name: 'package/package.json', body: '{}' }, { name: 'package/dist/index.js', body: 'x' }, ...Array.from({ length: 60 }, (_, i) => ({ name: `package/data/${i}.bin`, body: randomBytes(300_000).toString('latin1') }))]);
  const p = { path: 'node_modules/big', name: 'big', version: '1.0.0', integrity: sri(big), resolved: 'https://registry.npmjs.org/big/-/big-1.0.0.tgz', license: null } as BridgePackage;
  const prov = createBridgeProvisioner({ dir: tmp('seq-dl-lag-'), fetchImpl: (async () => new Response(big)) as unknown as typeof fetch, closure: [p], backoffMs: [0, 0], version: '9.9.9', entry: 'node_modules/big/dist/index.js' });
  let worst = 0;
  let last = Date.now();
  const iv = setInterval(() => {
    const n = Date.now();
    worst = Math.max(worst, n - last - 5);
    last = n;
  }, 5);
  prov.start();
  await prov.idle();
  clearInterval(iv);
  assert.equal(prov.status().state, 'done', prov.status().error);
  assert.ok(worst < 400, `the event loop was held for ${worst} ms`);
});

/* ---- cleaning up the check's temp folder (Windows holds a folder while a process has it as cwd) ---- */

test('removeDirRetry: retries EPERM/EBUSY, gives up on other errors and after the attempts run out', async () => {
  const { removeDirRetry } = (await import(checkUrl)) as { removeDirRetry: (d: string, o: { rm: (d: string) => void; attempts?: number; delayMs?: number }) => Promise<void> };
  let calls = 0;
  const flaky = (): void => {
    if (++calls < 3) throw Object.assign(new Error('locked'), { code: calls === 1 ? 'EPERM' : 'EBUSY' });
  };
  await removeDirRetry('x', { rm: flaky, delayMs: 1 });
  assert.equal(calls, 3);
  await assert.rejects(removeDirRetry('x', { rm: () => { throw Object.assign(new Error('no'), { code: 'EACCES' }); }, delayMs: 1 }), /no/);
  let n = 0;
  await assert.rejects(removeDirRetry('x', { rm: () => { n++; throw Object.assign(new Error('stuck'), { code: 'EPERM' }); }, attempts: 4, delayMs: 1 }), /stuck/);
  assert.equal(n, 4);
});

test('checkClaudeBridge leaves no seq-bridge-check folder behind, even though its child runs with that folder as cwd', async () => {
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('seq-bridge-check-')));
  const sleeper = path.join(tmp('seq-bridge-sleeper-'), 'sleeper.mjs');
  fs.writeFileSync(sleeper, ['process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { agentInfo: { name: "x" } } }) + String.fromCharCode(10));', 'setInterval(() => {}, 1000);'].join(String.fromCharCode(10)));
  const r = await runCheck({ entry: sleeper });
  assert.ok(r.ok, r.problems.join('; '));
  const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('seq-bridge-check-') && !before.has(f));
  assert.deepEqual(after, []);
});

test('bridgeCheckProblem: Windows cannot read the fake claude env, so only a started bridge is required there; elsewhere the env is checked', async () => {
  const { bridgeCheckProblem } = (await import(checkUrl)) as { bridgeCheckProblem: (r: unknown, platform?: string) => string | null };
  const started = { ok: true, problems: [], claudeEnv: null };
  assert.equal(bridgeCheckProblem(started, 'win32'), null);
  assert.match(bridgeCheckProblem(started, 'linux') ?? '', /wrong environment/);
  assert.match(bridgeCheckProblem({ ok: true, problems: [], claudeEnv: { ELECTRON_RUN_AS_NODE: '1', CLAUDE_CODE_EXECUTABLE: '/x' } }, 'linux') ?? '', /wrong environment/);
  assert.equal(bridgeCheckProblem({ ok: true, problems: [], claudeEnv: { CLAUDE_CODE_EXECUTABLE: '/x' } }, 'linux'), null);
  assert.match(bridgeCheckProblem({ ok: false, problems: ['exited 1 before answering'] }, 'win32') ?? '', /exited 1/);
});
