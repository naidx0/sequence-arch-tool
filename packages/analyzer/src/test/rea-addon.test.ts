/**
 * Start = the pinned source install + (Windows) the npm package's two native files. Off = nothing downloaded.
 *
 * The subject is the REAL routines (real git, real npm, real node, the system tar) against LOCAL servers only: a bare git
 * clone of a tiny fixture, and a fake npm registry (node:http) that serves package metadata and a tarball built in the
 * test. No network. The fake tarball is written byte by byte here so a hostile entry (`../`) can be put in it, which the
 * system tar would never create for us.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

import { REA_ADDON, integrityMatches, unsafeTarEntry, type AddonSpec } from '../components/reaAddon.js';
import { summariseDoctor } from '../components/reaDoctor.js';
import { installRea, isInstalled, reaInstallDir, readManifest, systemRunner, type ProgressEvent, type Runner } from '../components/reaInstall.js';
import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

const tmp = (label: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `sequence-rea-addon-${label}-`)));
const VERSION = 'fixture-1';

/* ------------------------------------------------------------------ tar writer -- */

function tarEntry(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const sum = [...header].reduce((a, b) => a + b, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, pad]);
}
const tgz = (entries: [string, Buffer][]): Buffer => zlib.gzipSync(Buffer.concat([...entries.map(([n, d]) => tarEntry(n, d)), Buffer.alloc(1024)]));

const NODE_BYTES = Buffer.from('MZ-fake-native-addon-bytes\n'.repeat(40));
const MANIFEST_BYTES = Buffer.from(JSON.stringify({ version: '6.5.0', abi: 'fake' }));
const goodTarball = (extra: [string, Buffer][] = []): Buffer =>
  tgz([
    ['package/package.json', Buffer.from('{"name":"rea-agents","version":"6.5.0"}')],
    ['package/native/windows/build/manifest.json', MANIFEST_BYTES],
    ['package/native/windows/build/rea-windows-x64.node', NODE_BYTES],
    ...extra,
  ]);
const sri = (b: Buffer): string => `sha512-${crypto.createHash('sha512').update(b).digest('base64')}`;
const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/* ---------------------------------------------------------------- fake registry -- */

interface Registry {
  spec: AddonSpec;
  hits: string[];
  close(): Promise<void>;
}

/** Serves /rea-agents/6.5.0 (metadata) and the tarball. `served` is what the tarball URL returns; `advertised` is what the metadata's integrity is for. */
async function fakeRegistry(opts: { advertised: Buffer; served?: Buffer; tarballHost?: string; integrity?: string | null }): Promise<Registry> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    if (req.url === '/rea-agents/6.5.0') {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const dist = { tarball: `${opts.tarballHost ?? origin}/rea-agents/-/rea-agents-6.5.0.tgz`, ...(opts.integrity === null ? {} : { integrity: opts.integrity ?? sri(opts.advertised) }) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ name: 'rea-agents', version: '6.5.0', dist }));
      return;
    }
    if (req.url === '/rea-agents/-/rea-agents-6.5.0.tgz') {
      res.end(opts.served ?? opts.advertised);
      return;
    }
    res.statusCode = 404;
    res.end('no');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    spec: { ...REA_ADDON, registry: `http://127.0.0.1:${port}`, platform: 'win32', downloadMb: 1 },
    hits,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/* --------------------------------------------------------------- fixture source -- */

function fakeRea(): string {
  return `import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
if (process.argv[2] === '--version') { console.log(${JSON.stringify(VERSION)}); process.exit(0); }
if (process.argv[2] === 'doctor') {
  const here = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
  const native = fs.existsSync(path.join(here, 'native', 'windows', 'build', 'manifest.json'));
  const checks = [
    { name: 'node', ok: true, classification: 'healthy' },
    /* the real doctor prints 9 KB and more (every registration it finds): longer than the runner's default tail */
    { name: 'registration:filler', ok: false, classification: 'config_drift', detail: 'x'.repeat(30000) },
    { name: 'hopper', ok: false, classification: 'missing_analysis_engine' },
    { name: 'ghidra', ok: false, classification: 'missing_analysis_engine' },
    { name: 'ida-registration', ok: false, classification: 'missing_analysis_engine' },
    { name: 'jadx', ok: false, classification: 'missing_dependency', ...(native ? {} : { detail: 'REA Windows native controls are unavailable: Missing packaged Windows native file' }) },
  ];
  console.log(JSON.stringify({ healthy: false, checks }));
  process.exit(1);
}
process.exit(2);
`;
}

function makeSource(): { url: string; commit: string } {
  const root = tmp('src');
  const work = path.join(root, 'work');
  fs.mkdirSync(path.join(work, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'rea-fixture', version: '6.5.0', private: true, type: 'module', scripts: { compile: 'node build.mjs' } }));
  fs.writeFileSync(path.join(work, 'package-lock.json'), JSON.stringify({ name: 'rea-fixture', version: '6.5.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'rea-fixture', version: '6.5.0' } } }));
  fs.writeFileSync(path.join(work, 'build.mjs'), "import fs from 'node:fs'; fs.mkdirSync('dist/mcp', { recursive: true }); fs.writeFileSync('dist/mcp/main.js', '// built\\n');\n");
  fs.writeFileSync(path.join(work, 'scripts', 'rea.mjs'), fakeRea());
  const git = (cwd: string, ...args: string[]): string => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(work, 'init', '-q');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'fixture');
  const commit = git(work, 'rev-parse', 'HEAD');
  const bare = path.join(root, 'bare.git');
  git(root, 'clone', '-q', '--bare', work, bare);
  return { url: pathToFileURL(bare).href, commit };
}

const events = (): { list: ProgressEvent[]; on: (e: ProgressEvent) => void } => {
  const list: ProgressEvent[] = [];
  return { list, on: (e) => list.push(e) };
};

const leftovers = (userDir: string): string[] => {
  const root = path.join(userDir, 'components', 'rea');
  return fs.existsSync(root) ? fs.readdirSync(root) : [];
};

/* ----------------------------------------------------------------------- tests -- */

test('start: runs both steps (the pinned source and the npm package), takes only the two named files, and records their sha256', async () => {
  const src = makeSource();
  const reg = await fakeRegistry({ advertised: goodTarball() });
  try {
    const userDir = tmp('user');
    const ev = events();
    const r = await installRea({ userDir, repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32', onProgress: ev.on });
    assert.equal(r.ok, true, r.ok ? '' : `${r.step}: ${r.error}`);
    if (!r.ok) return;
    assert.deepEqual(ev.list.filter((e) => e.state === 'done').map((e) => e.step), ['fetch', 'install', 'build', 'prune', 'addon', 'verify', 'doctor']);
    assert.deepEqual(reg.hits, ['/rea-agents/6.5.0', '/rea-agents/-/rea-agents-6.5.0.tgz'], 'one metadata read and one tarball, nothing else');

    const dir = reaInstallDir(userDir, src.commit);
    const buildDir = path.join(dir, 'native', 'windows', 'build');
    assert.deepEqual(fs.readdirSync(buildDir).sort(), ['manifest.json', 'rea-windows-x64.node'], 'exactly the two named files');
    assert.equal(fs.existsSync(path.join(dir, 'package.json')) && JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name, 'rea-fixture', "the npm package's own package.json was not copied over the source's");
    assert.deepEqual(fs.readFileSync(path.join(buildDir, 'rea-windows-x64.node')), NODE_BYTES);

    const m = readManifest(dir)!;
    assert.deepEqual(
      m.addon?.files.map((f) => [f.path, f.sha256]),
      [
        ['native/windows/build/manifest.json', sha256(MANIFEST_BYTES)],
        ['native/windows/build/rea-windows-x64.node', sha256(NODE_BYTES)],
      ],
    );
    assert.equal(m.addon?.integrity, sri(goodTarball()), "the registry's integrity value is kept in the manifest");
    assert.equal(m.addon?.package, 'rea-agents');
    assert.equal(m.addon?.version, '6.5.0');

    assert.equal(r.doctor?.ran, true, `the doctor's long JSON was read whole: ${r.doctor?.error ?? ''}`);
    assert.equal(r.doctor?.windowsNative, 'present');
    assert.equal(r.doctor?.staticAnalysis, true, 'static JavaScript and Electron analysis is available once the native files are in');
    assert.ok(r.doctor?.engines.every((e) => !e.installed && /yourself/.test(e.hint)), 'Hopper, Ghidra, IDA and JADX stay "not installed" with a hint');
    assert.deepEqual(leftovers(userDir), [src.commit], 'no .partial-* folder is left behind');
  } finally {
    await reg.close();
  }
});

test('start: the doctor before the native files says static analysis is not available; the same install with them says it is', () => {
  const missing = { checks: [{ name: 'jadx', ok: false, detail: 'REA Windows native controls are unavailable: Missing packaged Windows native file' }] };
  const before = summariseDoctor(missing, { exitCode: 1, platform: 'win32', nativeOnDisk: false });
  assert.equal(before.staticAnalysis, false);
  assert.equal(before.windowsNative, 'missing');
  assert.match(before.lines[0]!, /not available/);
  const after = summariseDoctor({ checks: [{ name: 'jadx', ok: false }] }, { exitCode: 1, platform: 'win32', nativeOnDisk: true });
  assert.equal(after.staticAnalysis, true);
  assert.match(after.lines[0]!, /: available\./);
  /* off Windows nothing native is needed */
  assert.equal(summariseDoctor({ checks: [] }, { exitCode: 1, platform: 'linux', nativeOnDisk: false }).windowsNative, 'not-needed');
  /* an unreadable answer claims nothing */
  const none = summariseDoctor(null, { exitCode: 2, platform: 'win32', nativeOnDisk: true });
  assert.equal(none.ran, false);
  assert.equal(none.staticAnalysis, false);
});

test('integrity: a corrupted tarball is refused before it is opened, and nothing is installed', async () => {
  const src = makeSource();
  const good = goodTarball();
  const bad = Buffer.from(good);
  const at = Math.floor(good.length / 2);
  bad[at] = bad[at]! ^ 0xff;
  assert.equal(integrityMatches(good, sri(good)), true, 'positive control: the intact bytes match their own integrity value');
  assert.equal(integrityMatches(bad, sri(good)), false);
  const reg = await fakeRegistry({ advertised: good, served: bad });
  try {
    const userDir = tmp('user');
    const ev = events();
    let tarCalls = 0;
    const run: Runner = (c, a, o) => (/tar(\.exe)?$/i.test(c) ? (tarCalls++, systemRunner(c, a, o)) : systemRunner(c, a, o));
    const r = await installRea({ userDir, repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32', run, onProgress: ev.on });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.step, 'addon');
    assert.match(r.error, /integrity/i);
    assert.equal(tarCalls, 0, 'tar never saw the corrupted bytes');
    assert.equal(isInstalled(userDir, src.commit), false);
    assert.deepEqual(leftovers(userDir), [], 'the .partial folder was removed');
    assert.equal(ev.list.at(-1)?.state, 'failed');
  } finally {
    await reg.close();
  }
});

test('integrity: a registry that gives no sha512, or points the tarball at another host, is refused before any download', async () => {
  const src = makeSource();
  for (const [label, o] of [
    ['no integrity', { integrity: null }],
    ['sha1 only', { integrity: 'sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA=' }],
    ['other host', { tarballHost: 'http://127.0.0.2:9' }],
  ] as const) {
    const reg = await fakeRegistry({ advertised: goodTarball(), ...o });
    try {
      const userDir = tmp('user');
      const r = await installRea({ userDir, repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32' });
      assert.equal(r.ok, false, label);
      if (r.ok) return;
      assert.equal(r.step, 'addon', label);
      assert.deepEqual(reg.hits, ['/rea-agents/6.5.0'], `${label}: only the metadata was read`);
      assert.deepEqual(leftovers(userDir), [], label);
    } finally {
      await reg.close();
    }
  }
});

test('tar: a tarball with a ../ entry is refused whole, even though its integrity is right, and nothing is extracted', async () => {
  for (const hostile of ['package/../escape.txt', '../escape.txt', '/abs-escape.txt', 'C:/drive-escape.txt', 'package/native/../../../escape.txt']) {
    assert.notEqual(unsafeTarEntry(hostile), null, `${hostile} is unsafe`);
  }
  assert.equal(unsafeTarEntry('package/native/windows/build/rea-windows-x64.node'), null, 'negative control: the real entry is plain');
  const src = makeSource();
  const evil = goodTarball([['package/../escape.txt', Buffer.from('pwned')]]);
  const reg = await fakeRegistry({ advertised: evil });
  try {
    const userDir = tmp('user');
    const r = await installRea({ userDir, repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32' });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.step, 'addon');
    assert.match(r.error, /"\.\." path|\.\./);
    assert.equal(isInstalled(userDir, src.commit), false);
    assert.deepEqual(leftovers(userDir), []);
    for (const base of [userDir, path.join(userDir, 'components'), path.join(userDir, 'components', 'rea'), os.tmpdir()]) {
      assert.equal(fs.existsSync(path.join(base, 'escape.txt')), false, `escape.txt was not written under ${base}`);
    }
  } finally {
    await reg.close();
  }
});

test('tar: a tarball missing one of the two native files is refused', async () => {
  const src = makeSource();
  const reg = await fakeRegistry({ advertised: tgz([['package/native/windows/build/manifest.json', MANIFEST_BYTES]]) });
  try {
    const userDir = tmp('user');
    const r = await installRea({ userDir, repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32' });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.step, 'addon');
    assert.match(r.error, /rea-windows-x64\.node/);
    assert.deepEqual(leftovers(userDir), []);
  } finally {
    await reg.close();
  }
});

test('upgrade: an install from before the native files were offered gets them on Start, without redoing git or npm', async () => {
  const src = makeSource();
  const userDir = tmp('user');
  const first = await installRea({ userDir, repo: src.url, commit: src.commit, version: VERSION, addon: null, platform: 'win32' });
  assert.ok(first.ok && !first.manifest.addon);
  assert.equal(first.ok && first.doctor?.staticAnalysis, false, 'before: the doctor reports the native files missing');
  const reg = await fakeRegistry({ advertised: goodTarball() });
  try {
    const seen: string[] = [];
    const run: Runner = (c, a, o) => (seen.push(path.basename(c).replace(/\.exe$/i, '')), systemRunner(c, a, o));
    const ev = events();
    const again = await installRea({ userDir, repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32', run, onProgress: ev.on });
    assert.equal(again.ok, true, again.ok ? '' : again.error);
    if (!again.ok) return;
    assert.equal(again.alreadyInstalled, false);
    assert.ok(!seen.includes('git') && !seen.includes('npm'), `only tar and the doctor ran: ${seen.join(',')}`);
    assert.deepEqual(ev.list.filter((e) => e.state === 'done').map((e) => e.step), ['addon', 'doctor']);
    assert.equal(again.manifest.addon?.files.length, 2);
    assert.equal(again.doctor?.staticAnalysis, true, 'after: static analysis is available');
    assert.deepEqual(leftovers(userDir), [src.commit]);
    /* and a third Start is a no-op */
    const calls: string[] = [];
    const third = await installRea({ userDir, repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32', run: (c, a, o) => (calls.push(c), systemRunner(c, a, o)) });
    assert.ok(third.ok && third.alreadyInstalled);
    assert.deepEqual(calls, []);
  } finally {
    await reg.close();
  }
});

/* ------------------------------------------------------------------- the routes -- */

async function withRoutes<T>(rea: Record<string, unknown>, fn: (base: string, userDir: string) => Promise<T>): Promise<T> {
  const dir = tmp('route');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  setRepoTrust(userStoreDir(), repo, true);
  const userConfigDir = tmp('cfg');
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir, rea: rea as never });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  try {
    return await fn(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, userConfigDir);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
const json = { 'content-type': 'application/json' };

test('off: looking at REA, and asking for the plan, downloads nothing and creates nothing (no git, no npm, no registry request)', async () => {
  const src = makeSource();
  const reg = await fakeRegistry({ advertised: goodTarball() });
  try {
    const calls: string[] = [];
    const run: Runner = (c, a, o) => (calls.push(`${path.basename(c)} ${a[0] ?? ''}`), systemRunner(c, a, o));
    await withRoutes({ repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32', run }, async (base, userDir) => {
      const plain = (await (await fetch(`${base}/api/rea`)).json()) as { status: { installed: boolean; addon: string | null }; job: { state: string } };
      assert.equal(plain.status.installed, false);
      assert.equal(plain.job.state, 'idle');
      const planned = (await (await fetch(`${base}/api/rea?plan=1`)).json()) as {
        plan: { addon: { package: string; version: string; source: string; files: string[] }; totalDownloadMb: number; steps: { id: string }[]; installDir: string };
      };
      assert.deepEqual(planned.plan.steps.map((s) => s.id), ['fetch', 'install', 'build', 'prune', 'addon', 'verify']);
      assert.equal(planned.plan.addon.package, 'rea-agents');
      assert.equal(planned.plan.addon.version, '6.5.0');
      assert.deepEqual(planned.plan.addon.files, [...REA_ADDON.files]);
      assert.ok(planned.plan.totalDownloadMb > 115, 'the total counts the npm package too');
      assert.deepEqual(reg.hits, [], 'the registry was not asked');
      assert.ok(calls.length > 0 && calls.every((c) => /^(git|node|npm)(.exe|.cmd)? --version$/.test(c)), `only version probes ran: ${calls.join(' | ')}`);
      assert.equal(fs.existsSync(path.join(userDir, 'components')), false, 'no folder was created');
    });
  } finally {
    await reg.close();
  }
});

test('start (routes): one POST does the source install and the native files, the job shows each step, the status line says what is available', async () => {
  const src = makeSource();
  const reg = await fakeRegistry({ advertised: goodTarball() });
  try {
    await withRoutes({ repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32' }, async (base, userDir) => {
      const post = await fetch(`${base}/api/rea/install`, { method: 'POST', headers: json, body: JSON.stringify({ confirm: true, commit: src.commit }) });
      assert.equal(post.status, 202);
      type V = { job: { state: string; error?: string; steps: Record<string, string> }; status: { installed: boolean; addon: string | null; doctor: { staticAnalysis: boolean; lines: string[]; engines: { installed: boolean }[] } | null } };
      let v: V = (await post.json()) as V;
      for (let i = 0; i < 400 && v.job.state === 'running'; i++) {
        await new Promise((r) => setTimeout(r, 100));
        v = (await (await fetch(`${base}/api/rea`)).json()) as V;
      }
      assert.equal(v.job.state, 'done', v.job.error);
      assert.deepEqual(v.job.steps, { fetch: 'done', install: 'done', build: 'done', prune: 'done', addon: 'done', verify: 'done', doctor: 'done' });
      assert.equal(v.status.installed, true);
      assert.equal(v.status.addon, 'present');
      assert.equal(v.status.doctor?.staticAnalysis, true);
      assert.match(v.status.doctor!.lines[0]!, /Static JavaScript and Electron analysis: available/);
      assert.ok(v.status.doctor!.engines.every((e) => !e.installed));
      assert.equal(reg.hits.length, 2);
      assert.ok(isInstalled(userDir, src.commit));

      /* asking again re-reads the doctor, and the registry is not touched */
      const again = await fetch(`${base}/api/rea/doctor`, { method: 'POST', headers: json, body: '{}' });
      assert.equal(again.status, 200);
      assert.equal(reg.hits.length, 2);
    });
  } finally {
    await reg.close();
  }
});

test('start (routes): a failing native step says which step, installs nothing, and a retry is allowed', async () => {
  const src = makeSource();
  const good = goodTarball();
  const reg = await fakeRegistry({ advertised: good, served: Buffer.concat([good.subarray(0, 100), Buffer.alloc(30)]) });
  try {
    await withRoutes({ repo: src.url, commit: src.commit, version: VERSION, addon: reg.spec, platform: 'win32' }, async (base, userDir) => {
      const start = (): Promise<Response> => fetch(`${base}/api/rea/install`, { method: 'POST', headers: json, body: JSON.stringify({ confirm: true, commit: src.commit }) });
      assert.equal((await start()).status, 202);
      type V = { job: { state: string; failedStep?: string; error?: string }; status: { installed: boolean } };
      let v: V = { job: { state: 'running' }, status: { installed: false } };
      for (let i = 0; i < 400 && v.job.state === 'running'; i++) {
        await new Promise((r) => setTimeout(r, 100));
        v = (await (await fetch(`${base}/api/rea`)).json()) as V;
      }
      assert.equal(v.job.state, 'failed');
      assert.equal(v.job.failedStep, 'addon');
      assert.match(v.job.error ?? '', /integrity/i);
      assert.equal(v.status.installed, false);
      assert.deepEqual(leftovers(userDir), []);
      assert.equal((await start()).status, 202, 'a retry is allowed');
      for (let i = 0; i < 400 && ((await (await fetch(`${base}/api/rea`)).json()) as V).job.state === 'running'; i++) await new Promise((r) => setTimeout(r, 100));
    });
  } finally {
    await reg.close();
  }
});
