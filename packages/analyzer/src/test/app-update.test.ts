import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  DAY_MS,
  UpdateService,
  compareVersions,
  isAllowedUrl,
  isReleaseDownloadUrl,
  launchInstaller,
  parseRelease,
  parseShasums,
  pickAsset,
  readReleaseNotes,
  shaFor,
  SIGNING_PUBLIC_KEY,
  verifyChecksum,
  verifySignature,
  type FetchLike,
  type ReleaseAsset,
} from '../server/appUpdate.js';
import { handleAppRoute } from '../server/appUpdateRoutes.js';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig } from '../server/auth.js';

/* G7: version compare, asset choice per OS, checksum verify (good and tampered), offline, the day's cache,
   the host allowlist, and "never run what did not verify". The network is a fake: nothing here leaves the machine. */

const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

test('compareVersions orders semantic versions, a v prefix, prereleases and junk', () => {
  assert.equal(compareVersions('0.1.5', '0.1.4'), 1);
  assert.equal(compareVersions('v0.1.4', '0.1.4'), 0);
  assert.equal(compareVersions('0.1.9', '0.1.10'), -1, 'numeric, not text, order');
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), -1, 'a prerelease is older than its release');
  assert.equal(compareVersions('0.2.0-beta.2', '0.2.0-beta.10'), -1);
  assert.equal(compareVersions('0.1.4+abc', '0.1.4'), 0, 'build metadata is ignored');
  assert.equal(compareVersions('latest', '0.1.4'), null);
  assert.equal(compareVersions('0.1', '0.1.4'), null);
  /* A fourth part (x.x.x.x) is a version too, so a 0.1.6.1 release reaches 0.1.6 apps. */
  assert.equal(compareVersions('0.1.6.1', '0.1.6'), 1);
  assert.equal(compareVersions('v0.1.6.1', '0.1.7'), -1);
  assert.equal(compareVersions('0.1.6.0', '0.1.6'), 0);
  assert.equal(compareVersions('0.1.6.10', '0.1.6.9'), 1, 'numeric, not text, order');
  assert.equal(compareVersions('0.1.6.1-beta.1', '0.1.6.1'), -1);
  assert.equal(compareVersions('0.1.6.1.2', '0.1.6'), null, 'five parts is not a version');
});

const A = (name: string, size = 1000): ReleaseAsset => ({ name, size, url: `https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/${name}` });
const ASSETS = [
  A('Sequence.Setup.0.1.5.exe'),
  A('Sequence.Setup.0.1.5.exe.blockmap'),
  A('Sequence-0.1.5-win.zip'),
  A('Sequence-0.1.5-arm64.dmg'),
  A('Sequence-0.1.5.dmg'),
  A('Sequence-0.1.5-arm64-mac.zip'),
  A('Sequence-0.1.5.AppImage'),
  A('Sequence-0.1.5-amd64.deb'),
  A('SHASUMS256.txt'),
];

test('pickAsset chooses the installer for each OS and CPU, and nothing else', () => {
  assert.equal(pickAsset(ASSETS, 'win32', 'x64')?.name, 'Sequence.Setup.0.1.5.exe');
  assert.equal(pickAsset(ASSETS, 'darwin', 'arm64')?.name, 'Sequence-0.1.5-arm64.dmg');
  assert.equal(pickAsset(ASSETS, 'darwin', 'x64')?.name, 'Sequence-0.1.5.dmg');
  assert.equal(pickAsset(ASSETS, 'linux', 'x64')?.name, 'Sequence-0.1.5.AppImage');
  assert.equal(pickAsset(ASSETS, 'freebsd', 'x64'), null);
  /* negative controls: a release with only zips or a blockmap offers nothing */
  assert.equal(pickAsset([A('Sequence-0.1.5-win.zip'), A('Sequence.Setup.0.1.5.exe.blockmap')], 'win32', 'x64'), null);
  assert.equal(pickAsset([A('Sequence-0.1.5.dmg')], 'darwin', 'arm64'), null, 'an Intel dmg is not offered to Apple silicon');
});

test('parseRelease reads a release and refuses drafts, prereleases and junk', () => {
  const json = {
    tag_name: 'v0.1.5',
    name: 'Sequence 0.1.5',
    body: 'notes',
    html_url: 'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.5',
    published_at: '2026-10-10T00:00:00Z',
    assets: ASSETS.map((a) => ({ name: a.name, browser_download_url: a.url, size: a.size })),
  };
  const r = parseRelease(json)!;
  assert.equal(r.version, '0.1.5');
  assert.equal(r.assets.length, ASSETS.length);
  assert.equal(parseRelease({ ...json, prerelease: true }), null);
  assert.equal(parseRelease({ ...json, draft: true }), null);
  assert.equal(parseRelease({ ...json, tag_name: 'nightly' }), null);
  assert.equal(parseRelease(null), null);
});

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

test('parseShasums and shaFor match a file by name, dots and spaces alike', () => {
  const sums = parseShasums(`${'a'.repeat(64)}  Sequence Setup 0.1.5.exe\n${'B'.repeat(64)} *Sequence-0.1.5.dmg\nnot a line\n`);
  assert.equal(sums.size, 2);
  assert.equal(shaFor(sums, 'Sequence.Setup.0.1.5.exe'), 'a'.repeat(64));
  assert.equal(shaFor(sums, 'Sequence Setup 0.1.5.exe'), 'a'.repeat(64));
  assert.equal(shaFor(sums, 'Sequence-0.1.5.dmg'), 'b'.repeat(64), 'hex is lower-cased');
  assert.equal(shaFor(sums, 'Other.exe'), null);
});

test('shaFor (L1): only a space in a SHASUMS name stands for a dot in the asset name; no other near-miss matches', () => {
  const sums = parseShasums(`${'a'.repeat(64)}  Sequence Setup 0.1.4.exe\n`);
  assert.equal(shaFor(sums, 'Sequence.Setup.0.1.4.exe'), 'a'.repeat(64), 'GitHub renamed the spaces to dots');
  assert.equal(shaFor(sums, 'Sequence Setup 0.1.4 exe'), null, 'a dot in the listed name is not a space');
  assert.equal(shaFor(sums, 'Sequence.Setup.0.1.4..exe'), null);
  assert.equal(shaFor(sums, 'sequence.setup.0.1.4.exe'), null, 'names compare by case');
});

test('verifyChecksum: the exact file passes, one changed byte fails', async () => {
  const dir = tmp('seq-sum-');
  const f = path.join(dir, 'x.bin');
  const bytes = Buffer.from('the installer bytes');
  fs.writeFileSync(f, bytes);
  assert.equal((await verifyChecksum(f, sha(bytes))).ok, true);
  assert.equal((await verifyChecksum(f, sha(bytes).toUpperCase())).ok, true);
  fs.writeFileSync(f, Buffer.from('the installer byteS'));
  assert.equal((await verifyChecksum(f, sha(bytes))).ok, false);
});

test('isAllowedUrl: GitHub hosts over https only', () => {
  assert.equal(isAllowedUrl('https://api.github.com/repos/naidx0/sequence-arch-tool/releases/latest'), true);
  assert.equal(isAllowedUrl('https://github.com/naidx0/sequence-arch-tool/releases/download/v1/x.exe'), true);
  assert.equal(isAllowedUrl('https://release-assets.githubusercontent.com/x'), true);
  assert.equal(isAllowedUrl('http://github.com/x'), false);
  assert.equal(isAllowedUrl('https://evilgithub.com/x'), false);
  assert.equal(isAllowedUrl('https://github.com.evil.test/x'), false);
  assert.equal(isAllowedUrl('https://user:pw@github.com/x'), false);
  assert.equal(isAllowedUrl('https://github.com:8443/x'), false);
  assert.equal(isAllowedUrl('not a url'), false);
});

/* ── the service against a fake GitHub ─────────────────────────────────── */

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(buf.toString('utf8')) as unknown,
    text: async () => buf.toString('utf8'),
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: new Uint8Array(buf) };
        },
      }),
    },
  };
}

interface Fake {
  fetchImpl: FetchLike;
  urls: string[];
  online: boolean;
}

function fakeGithub(installer: Buffer, opts: { tamper?: boolean; noSums?: boolean; redirectTo?: string } = {}): Fake {
  const assetUrl = ASSETS[0]!.url;
  const sums = `${sha(installer)}  Sequence Setup 0.1.5.exe\n`;
  const release = {
    tag_name: 'v0.1.5',
    name: 'Sequence 0.1.5',
    body: 'what changed',
    html_url: 'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.5',
    assets: ASSETS.filter((a) => !(opts.noSums && a.name === 'SHASUMS256.txt')).map((a) => ({ name: a.name, browser_download_url: a.url, size: a.size })),
  };
  const fake: Fake = {
    urls: [],
    online: true,
    fetchImpl: async (url) => {
      fake.urls.push(url);
      if (!fake.online) throw new TypeError('fetch failed');
      if (url === 'https://api.github.com/repos/naidx0/sequence-arch-tool/releases/latest') return res(200, release);
      if (url.endsWith('/SHASUMS256.txt')) return res(200, sums);
      if (url === assetUrl) {
        if (opts.redirectTo) return res(302, '', { location: opts.redirectTo });
        return res(200, opts.tamper ? Buffer.concat([installer.subarray(0, installer.length - 1), Buffer.from('X')]) : installer, { 'content-length': String(installer.length) });
      }
      if (url === 'https://release-assets.githubusercontent.com/cdn/installer') return res(200, installer, { 'content-length': String(installer.length) });
      return res(404, 'no');
    },
  };
  return fake;
}

const service = (fake: Fake, dir: string, now: { t: number }, launched: string[] = [], current = '0.1.4') =>
  new UpdateService({ fetchImpl: fake.fetchImpl, now: () => now.t, userDir: dir, platform: 'win32', arch: 'x64', current: () => current, desktop: () => true, launch: (f) => (launched.push(f), 'done') });

test('check: a newer release is offered, an equal or older one is not', async () => {
  const fake = fakeGithub(Buffer.from('x'));
  const dir = tmp('seq-upd-');
  const now = { t: 1_000_000 };
  const newer = await service(fake, dir, now).check();
  assert.equal(newer.newer, true);
  assert.equal(newer.latest?.version, '0.1.5');
  assert.equal(newer.installable, true);
  assert.equal(newer.asset?.name, 'Sequence.Setup.0.1.5.exe');
  const same = await service(fake, tmp('seq-upd-'), now, [], '0.1.5').check();
  assert.equal(same.newer, false);
  assert.equal(same.installable, false);
  assert.equal((await service(fake, tmp('seq-upd-'), now, [], '0.2.0').check()).newer, false);
});

test('check: the latest release carries its own notes for the Settings page (display only)', async () => {
  const fake = fakeGithub(Buffer.from('x'));
  const c = await service(fake, tmp('seq-upd-'), { t: 1_000_000 }).check();
  assert.equal(c.latest?.notes, 'what changed');
});

test('check: cached for a day (also across a restart), asked again after it, and again when forced', async () => {
  const fake = fakeGithub(Buffer.from('x'));
  const dir = tmp('seq-upd-');
  const now = { t: 5_000_000 };
  const s = service(fake, dir, now);
  await s.check();
  await s.check();
  assert.equal(fake.urls.length, 1, 'the second check read the cache');
  await service(fake, dir, now).check();
  assert.equal(fake.urls.length, 1, 'a new process reads the cache file');
  now.t += DAY_MS + 1;
  await s.check();
  assert.equal(fake.urls.length, 2);
  await s.check(true);
  assert.equal(fake.urls.length, 3);
});

test('check offline: no throw, no error field, the last known answer stays, and it does not retry at once', async () => {
  const fake = fakeGithub(Buffer.from('x'));
  const dir = tmp('seq-upd-');
  const now = { t: 9_000_000 };
  const cold = service(fake, tmp('seq-upd-'), now);
  fake.online = false;
  const none = await cold.check();
  assert.equal(none.offline, true);
  assert.equal(none.newer, false);
  assert.equal(none.latest, null);
  fake.online = true;
  const s = service(fake, dir, now);
  await s.check();
  fake.online = false;
  now.t += DAY_MS + 1;
  const after = await s.check();
  assert.equal(after.offline, true);
  assert.equal(after.latest?.version, '0.1.5', 'the cached release is still shown');
  const calls = fake.urls.length;
  await s.check();
  assert.equal(fake.urls.length, calls, 'a failed check is not retried within the retry window');
});

test('install: a good download is verified and then run, once', async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const fake = fakeGithub(bytes);
  const dir = tmp('seq-upd-');
  const launched: string[] = [];
  const s = service(fake, dir, { t: 1 }, launched);
  const job = await s.install();
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.equal(job.received, bytes.length);
  assert.equal(launched.length, 1);
  assert.deepEqual(fs.readFileSync(launched[0]!), bytes);
  assert.equal(fs.existsSync(`${launched[0]}.part`), false);
  assert.match(launched[0]!, /updates/);
});

test('install: a tampered download is deleted and never run', async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const fake = fakeGithub(bytes, { tamper: true });
  const dir = tmp('seq-upd-');
  const launched: string[] = [];
  const job = await service(fake, dir, { t: 1 }, launched).install();
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /checksum/);
  assert.equal(launched.length, 0, 'nothing was run');
  const left = fs.existsSync(path.join(dir, 'updates')) ? fs.readdirSync(path.join(dir, 'updates')) : [];
  assert.deepEqual(left, [], 'the bad file is gone');
});

test('install: a release without SHASUMS256.txt cannot be checked, so it is not run', async () => {
  const fake = fakeGithub(Buffer.from('x'), { noSums: true });
  const launched: string[] = [];
  const s = service(fake, tmp('seq-upd-'), { t: 1 }, launched);
  assert.equal((await s.check()).installable, false);
  const job = await s.install();
  assert.equal(job.state, 'failed');
  assert.equal(launched.length, 0);
});

test('install: a redirect to GitHub\'s CDN is followed, a redirect anywhere else is refused', async () => {
  const bytes = Buffer.from('cdn installer'.repeat(50));
  const ok = fakeGithub(bytes, { redirectTo: 'https://release-assets.githubusercontent.com/cdn/installer' });
  const launched: string[] = [];
  assert.equal((await service(ok, tmp('seq-upd-'), { t: 1 }, launched).install()).state, 'launched');
  assert.equal(launched.length, 1);
  const evil = fakeGithub(bytes, { redirectTo: 'https://evil.example.com/installer.exe' });
  const l2: string[] = [];
  const job = await service(evil, tmp('seq-upd-'), { t: 1 }, l2).install();
  assert.equal(job.state, 'failed');
  assert.equal(l2.length, 0);
  assert.ok(!evil.urls.some((u) => u.includes('evil.example.com')), 'the foreign host was never requested');
});

test('install with nothing newer refuses to download', async () => {
  const fake = fakeGithub(Buffer.from('x'));
  const launched: string[] = [];
  const job = await service(fake, tmp('seq-upd-'), { t: 1 }, launched, '0.1.5').install();
  assert.equal(job.state, 'failed');
  assert.ok(!fake.urls.some((u) => u.includes('/download/')));
});

test('readReleaseNotes: newest first, title from the heading', () => {
  const dir = tmp('seq-notes-');
  fs.writeFileSync(path.join(dir, 'v0.1.4.md'), '# Sequence 0.1.4\n\n- one\n');
  fs.writeFileSync(path.join(dir, 'v0.1.10.md'), '# Sequence 0.1.10\n\n- ten\n');
  fs.writeFileSync(path.join(dir, 'v0.1.5.md'), 'no heading here\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# not a release\n');
  const notes = readReleaseNotes({}, dir);
  assert.deepEqual(notes.map((n) => n.version), ['0.1.10', '0.1.5', '0.1.4']);
  assert.equal(notes[0]!.title, 'Sequence 0.1.10');
  assert.equal(notes[0]!.body, '- ten');
  assert.equal(notes[1]!.title, 'Sequence 0.1.5');
  assert.deepEqual(readReleaseNotes({}, path.join(dir, 'missing')), [], 'no folder is an empty list');
});

/* ── the routes ────────────────────────────────────────────────────────── */

function request(port: number, method: string, p: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown> }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function serve(hosted: boolean) {
  const store = tmp('seq-app-');
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: store,
    recentStoreDir: store,
    userConfigDir: store,
    ...(hosted
      ? { authConfig: loadAuthConfig({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', SESSION_SECRET: 'x-secret', PUBLIC_BASE_URL: 'https://app.example.com' } as NodeJS.ProcessEnv) }
      : {}),
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

test('/api/app/version answers locally; every /api/app route is refused when hosted and the install needs a POST', async () => {
  const local = await serve(false);
  try {
    const v = await request(local.port, 'GET', '/api/app/version');
    assert.equal(v.status, 200);
    assert.match(String(v.json.version), /^\d+\.\d+\.\d+/);
    assert.equal(v.json.platform, process.platform);
    const rel = await request(local.port, 'GET', '/api/app/releases');
    assert.equal(rel.status, 200);
    assert.ok(Array.isArray(rel.json.notes));
    assert.equal((await request(local.port, 'GET', '/api/app/update/install')).status, 404, 'install is not a GET');
  } finally {
    await local.close();
  }
  const hosted = await serve(true);
  try {
    for (const p of ['/api/app/version', '/api/app/releases', '/api/app/update']) assert.equal((await request(hosted.port, 'GET', p)).status, 403, p);
    assert.equal((await request(hosted.port, 'POST', '/api/app/update/install', { 'content-type': 'application/json' })).status, 403);
  } finally {
    await hosted.close();
  }
});

/* ── 0.1.5 review fixes ────────────────────────────────────────────────── */

/** A local server that serves only the /api/app routes, over the given service. */
async function serveRoutes(svc: UpdateService) {
  const server = http.createServer((req, r) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    void handleAppRoute({ req, res: r, url, method: req.method ?? 'GET', authOn: false, service: svc }).then((handled) => {
      if (!handled) {
        r.statusCode = 404;
        r.end('{}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  return { port: typeof addr === 'object' && addr ? addr.port : 0, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('install (H1): the job is downloading the moment install() is called, and concurrent clicks share one install and one launch', async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const fake = fakeGithub(bytes);
  const launched: string[] = [];
  const s = service(fake, tmp('seq-upd-'), { t: 1 }, launched);
  const first = s.install();
  assert.equal(s.status().state, 'downloading', 'set before the first await, so a POST answers it');
  const jobs = await Promise.all([first, s.install(), s.install()]);
  assert.deepEqual(jobs.map((j) => j.state), ['launched', 'launched', 'launched']);
  assert.equal(launched.length, 1, 'one installer run, not three');
  assert.equal(fake.urls.filter((u) => u === ASSETS[0]!.url).length, 1, 'one download');
});

test('install (H1): the temp file is unique, so a leftover .part at the old fixed path neither blocks nor crashes it', async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const dir = tmp('seq-upd-');
  fs.mkdirSync(path.join(dir, 'updates', 'Sequence.Setup.0.1.5.exe.part'), { recursive: true });
  const launched: string[] = [];
  const job = await service(fakeGithub(bytes), dir, { t: 1 }, launched).install();
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.equal(launched.length, 1);
});

test('POST /api/app/update/install (H1) answers the running job, not idle', async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const s = service(fakeGithub(bytes), tmp('seq-upd-'), { t: 1 });
  const srv = await serveRoutes(s);
  try {
    const r = await request(srv.port, 'POST', '/api/app/update/install', { 'content-type': 'application/json' }, JSON.stringify({ version: '0.1.5' }));
    assert.equal(r.status, 202);
    assert.equal((r.json.install as { state: string }).state, 'downloading');
  } finally {
    await srv.close();
  }
});

/** Swap fs.createWriteStream for the length of one test (the service writes through the shared fs module). */
async function withWriteStream<T>(swap: (orig: typeof fs.createWriteStream) => typeof fs.createWriteStream, run: () => Promise<T>): Promise<T> {
  const orig = fs.createWriteStream;
  (fs as { createWriteStream: typeof fs.createWriteStream }).createWriteStream = swap(orig);
  try {
    return await run();
  } finally {
    (fs as { createWriteStream: typeof fs.createWriteStream }).createWriteStream = orig;
  }
}

test('install (M4): a write error fails the job and never crashes the server', { timeout: 10_000 }, async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const dir = tmp('seq-upd-');
  const launched: string[] = [];
  const job = await withWriteStream(
    (orig) => ((_p: fs.PathLike, o?: unknown) => orig(path.join(dir, 'no-such-folder', 'x.part'), o as never)) as typeof fs.createWriteStream,
    () => service(fakeGithub(bytes), dir, { t: 1 }, launched).install(),
  );
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /ENOENT|no such file/i);
  assert.equal(launched.length, 0);
});

test('install (M4): the file on disk is hashed again after it is closed; bytes that changed on the way to disk are never run', { timeout: 10_000 }, async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const dir = tmp('seq-upd-');
  const launched: string[] = [];
  const job = await withWriteStream(
    (orig) =>
      ((p: fs.PathLike, o?: unknown) => {
        const s = orig(p, o as never);
        const write = s.write.bind(s) as (c: unknown, ...a: unknown[]) => boolean;
        (s as unknown as { write: (c: Uint8Array, ...a: unknown[]) => boolean }).write = (c, ...a) => write(Buffer.from(c).fill(0x41), ...a);
        return s;
      }) as typeof fs.createWriteStream,
    () => service(fakeGithub(bytes), dir, { t: 1 }, launched).install(),
  );
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /checksum/);
  assert.equal(launched.length, 0, 'nothing was run');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'updates')), [], 'the bad file is gone');
});

test('install (M4): a download that stalls times out, fails, and a new click can start again', { timeout: 10_000 }, async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const base = fakeGithub(bytes);
  let stall = true;
  const fetchImpl: FetchLike = async (url, init) => {
    const r = await base.fetchImpl(url, init);
    if (url !== ASSETS[0]!.url || !stall) return r;
    let first = true;
    return {
      ...r,
      body: {
        getReader: () => ({
          read: () => {
            if (first) {
              first = false;
              return Promise.resolve({ done: false, value: new Uint8Array(bytes.subarray(0, 10)) });
            }
            return new Promise<never>(() => {});
          },
        }),
      },
    };
  };
  const launched: string[] = [];
  const s = new UpdateService({ fetchImpl, now: () => 1, userDir: tmp('seq-upd-'), platform: 'win32', arch: 'x64', current: () => '0.1.4', desktop: () => true, launch: (f) => (launched.push(f), 'done'), idleMs: 150 });
  const job = await s.install();
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /stalled/);
  stall = false;
  assert.equal((await s.install()).state, 'launched', 'the next click starts a fresh download');
  assert.equal(launched.length, 1);
});

test('install (M4b): a release check whose body never arrives fails the job and the check, it does not hang in downloading', { timeout: 10_000 }, async () => {
  const base = fakeGithub(Buffer.from('x'));
  const fetchImpl: FetchLike = async (url, init) => {
    const r = await base.fetchImpl(url, init);
    if (!url.startsWith('https://api.github.com/')) return r;
    return { ...r, json: () => new Promise<never>(() => {}) };
  };
  const mk = () => new UpdateService({ fetchImpl, now: () => 1, userDir: tmp('seq-upd-'), platform: 'win32', arch: 'x64', current: () => '0.1.4', desktop: () => true, launch: () => 'x', idleMs: 200, checkMs: 200 });
  const s = mk();
  const job = await s.install();
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /GitHub|stalled/);
  const c = await mk().check(true);
  assert.equal(c.offline, true, 'a check with a stalled body ends offline');
});

test('isAllowedUrl (M3): of githubusercontent.com only the two release CDNs; isReleaseDownloadUrl pins the repo and tag', () => {
  assert.equal(isAllowedUrl('https://objects.githubusercontent.com/x'), true);
  assert.equal(isAllowedUrl('https://release-assets.githubusercontent.com/x'), true);
  for (const u of ['https://raw.githubusercontent.com/attacker/repo/main/x.exe', 'https://gist.githubusercontent.com/a/b/raw/x.exe', 'https://evil.githubusercontent.com/x', 'https://evil.githubusercontent.com.evil.com/x']) {
    assert.equal(isAllowedUrl(u), false, u);
  }
  const ok = 'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/Sequence.Setup.0.1.5.exe';
  assert.equal(isReleaseDownloadUrl(ok, 'v0.1.5'), true);
  for (const u of [
    'https://github.com/attacker/other/releases/download/v0.1.5/x.exe',
    'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.4/Sequence.Setup.0.1.5.exe',
    'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/../../../../attacker/x/releases/download/v0.1.5/x.exe',
    'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/sub/x.exe',
    'https://objects.githubusercontent.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/x.exe',
    'http://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/x.exe',
  ]) {
    assert.equal(isReleaseDownloadUrl(u, 'v0.1.5'), false, u);
  }
});

function fakeWith(release: Record<string, unknown>, installer: Buffer) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    if (url.startsWith('https://api.github.com/')) return res(200, release);
    if (url.endsWith('/SHASUMS256.txt')) return res(200, `${sha(installer)}  Sequence Setup 0.1.5.exe\n`);
    return res(200, installer, { 'content-length': String(installer.length) });
  };
  return { urls, fetchImpl };
}

test('install (M3): an installer or SHASUMS link outside this repo\'s release downloads is never fetched, and not offered', async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  for (const bad of ['https://github.com/attacker/other/releases/download/v0.1.5/Sequence.Setup.0.1.5.exe', 'https://raw.githubusercontent.com/attacker/r/main/Sequence.Setup.0.1.5.exe']) {
    const release = {
      tag_name: 'v0.1.5',
      assets: [
        { name: 'Sequence.Setup.0.1.5.exe', browser_download_url: bad, size: bytes.length },
        { name: 'SHASUMS256.txt', browser_download_url: 'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/SHASUMS256.txt', size: 10 },
      ],
    };
    const fake = fakeWith(release, bytes);
    const launched: string[] = [];
    const s = new UpdateService({ fetchImpl: fake.fetchImpl, now: () => 1, userDir: tmp('seq-upd-'), platform: 'win32', arch: 'x64', current: () => '0.1.4', desktop: () => true, launch: (f) => (launched.push(f), 'done') });
    assert.equal((await s.check()).installable, false, bad);
    const job = await s.install();
    assert.equal(job.state, 'failed', bad);
    assert.equal(launched.length, 0);
    assert.ok(!fake.urls.includes(bad), `${bad} was never requested`);
  }
});

test('install (M3): the release is read again at the click, so a tampered cache file is never trusted', async () => {
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const fake = fakeGithub(bytes);
  const dir = tmp('seq-upd-');
  const now = { t: 1 };
  await service(fake, dir, now).check();
  const cacheFile = path.join(dir, 'update-check.json');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as { release: { assets: { name: string; url: string }[] } };
  for (const a of cache.release.assets) a.url = `https://objects.githubusercontent.com/evil/${a.name}`;
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  const launched: string[] = [];
  const before = fake.urls.length;
  const job = await service(fake, dir, now, launched).install();
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.ok(fake.urls.slice(before).includes('https://api.github.com/repos/naidx0/sequence-arch-tool/releases/latest'), 'asked GitHub again');
  assert.ok(!fake.urls.some((u) => u.includes('/evil/')), 'the cached links were not used');
});

test('install (M3): GitHub unreachable at the click means nothing is downloaded', async () => {
  const fake = fakeGithub(Buffer.from('x'));
  const dir = tmp('seq-upd-');
  await service(fake, dir, { t: 1 }).check();
  fake.online = false;
  const launched: string[] = [];
  const job = await service(fake, dir, { t: 2 }, launched).install();
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /reach GitHub/);
  assert.equal(launched.length, 0);
});

test('parseRelease (M3): a release page link outside this repo on github.com is replaced by the canonical one', () => {
  const canonical = 'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.5';
  for (const bad of ['javascript:alert(1)', 'https://evil.example.com/naidx0/sequence-arch-tool/', 'http://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.5', 'https://github.com/attacker/x/releases']) {
    assert.equal(parseRelease({ tag_name: 'v0.1.5', html_url: bad, assets: [] })?.htmlUrl, canonical, bad);
  }
  assert.equal(parseRelease({ tag_name: 'v0.1.5', html_url: canonical, assets: [] })?.htmlUrl, canonical);
});

test('install (M4): the idle timer fires in a process that has nothing else to keep it alive', { timeout: 20_000 }, () => {
  /* A stalled download is the only thing pending: an unref'd timer would let the process exit with the job unsettled. */
  const mod = new URL('../server/appUpdate.js', import.meta.url).href;
  const script = `
    import { UpdateService } from ${JSON.stringify(mod)};
    import { createHash } from 'node:crypto'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
    const bytes = Buffer.from('x'.repeat(100));
    const base = 'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/';
    const rel = { tag_name: 'v0.1.5', assets: [{ name: 'Sequence.Setup.0.1.5.exe', browser_download_url: base + 'Sequence.Setup.0.1.5.exe', size: 100 }, { name: 'SHASUMS256.txt', browser_download_url: base + 'SHASUMS256.txt', size: 10 }] };
    const r = (body, stall) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => String(body), body: { getReader: () => ({ read: () => (stall ? new Promise(() => {}) : Promise.resolve({ done: true })) }) } });
    const fetchImpl = async (u) => u.startsWith('https://api.github.com/') ? r(rel) : u.endsWith('SHASUMS256.txt') ? r(createHash('sha256').update(bytes).digest('hex') + '  Sequence Setup 0.1.5.exe\\n') : r('', true);
    const s = new UpdateService({ fetchImpl, now: () => 1, userDir: fs.mkdtempSync(path.join(os.tmpdir(), 'seq-idle-')), platform: 'win32', arch: 'x64', current: () => '0.1.4', desktop: () => true, launch: () => 'x', idleMs: 300 });
    const job = await s.install();
    console.log('SETTLED', job.state);
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15_000 });
  assert.match(out, /SETTLED failed/);
});

test('launchInstaller (M4): an installer that cannot be started rejects instead of crashing the process', { timeout: 10_000 }, async () => {
  const missing = path.join(tmp('seq-upd-'), 'missing-installer.exe');
  await assert.rejects(Promise.resolve().then(() => launchInstaller(missing, 'win32')));
  const s = new UpdateService({
    fetchImpl: fakeGithub(Buffer.from('x'.repeat(50))).fetchImpl,
    now: () => 1,
    userDir: tmp('seq-upd-'),
    platform: 'win32',
    arch: 'x64',
    current: () => '0.1.4',
    desktop: () => true,
    launch: () => Promise.reject(new Error('spawn EACCES')),
  });
  const job = await s.install();
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /EACCES/);
});

test('L2: the click names the version it showed; another latest, or no version at all, is refused before any download', async () => {
  const fake = fakeGithub(Buffer.from('MZ'.repeat(100)));
  const launched: string[] = [];
  const s = service(fake, tmp('seq-upd-'), { t: 1 }, launched);
  const job = await s.install('0.1.6');
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /0\.1\.5.*0\.1\.6|0\.1\.6.*0\.1\.5/);
  assert.ok(!fake.urls.some((u) => u.includes('/download/')), 'nothing was downloaded');
  const srv = await serveRoutes(s);
  try {
    const none = await request(srv.port, 'POST', '/api/app/update/install', { 'content-type': 'application/json' }, '{}');
    assert.equal(none.status, 400, 'a POST without the version shown is refused');
    const junk = await request(srv.port, 'POST', '/api/app/update/install', { 'content-type': 'application/json' }, '{"version":');
    assert.equal(junk.status, 400);
    /* A four-part version (0.1.7.1) is a version the button can show, so the route takes it. */
    const four = await request(srv.port, 'POST', '/api/app/update/install', { 'content-type': 'application/json' }, JSON.stringify({ version: '0.1.7.1' }));
    assert.notEqual(four.status, 400, 'a four-part version is not refused as malformed');
    assert.equal(s.status().state, 'failed', 'neither started a job');
  } finally {
    await srv.close();
  }
  assert.equal(launched.length, 0);
  assert.equal((await s.install('v0.1.5')).state, 'launched', 'the shown version, with or without its v, installs');
});

test('M2 (ready, off by default): with a pinned key the SHASUMS file must carry a valid ed25519 signature; without one nothing changes', async () => {
  /* A throwaway key made here; no key is stored anywhere. */
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const bytes = Buffer.from('MZ-pretend-installer'.repeat(100));
  const sums = `${sha(bytes)}  Sequence Setup 0.1.5.exe\n`;
  const good = cryptoSign(null, Buffer.from(sums), privateKey).toString('base64');
  const other = generateKeyPairSync('ed25519').privateKey;
  const forged = cryptoSign(null, Buffer.from(sums), other).toString('base64');
  const base = 'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/';
  const run = async (sig: string | null, signingKey: string | null | undefined) => {
    const assets = [
      { name: 'Sequence.Setup.0.1.5.exe', browser_download_url: `${base}Sequence.Setup.0.1.5.exe`, size: bytes.length },
      { name: 'SHASUMS256.txt', browser_download_url: `${base}SHASUMS256.txt`, size: sums.length },
      ...(sig === null ? [] : [{ name: 'SHASUMS256.txt.sig', browser_download_url: `${base}SHASUMS256.txt.sig`, size: sig.length }]),
    ];
    const fetchImpl: FetchLike = async (url) => {
      if (url.startsWith('https://api.github.com/')) return res(200, { tag_name: 'v0.1.5', assets });
      if (url.endsWith('/SHASUMS256.txt')) return res(200, sums);
      if (url.endsWith('/SHASUMS256.txt.sig')) return res(200, `${sig}\n`);
      return res(200, bytes, { 'content-length': String(bytes.length) });
    };
    const launched: string[] = [];
    const s = new UpdateService({ fetchImpl, now: () => 1, userDir: tmp('seq-upd-'), platform: 'win32', arch: 'x64', current: () => '0.1.4', desktop: () => true, launch: (f) => (launched.push(f), 'done'), ...(signingKey === undefined ? {} : { signingKey }) });
    const job = await s.install();
    return { job, launched: launched.length };
  };
  assert.equal(SIGNING_PUBLIC_KEY, null, 'off until the owner pins a key');
  assert.equal((await run(null, undefined)).launched, 1, 'flag off: the checksum alone, as before');
  assert.equal((await run(good, pub)).launched, 1, 'a valid signature by the pinned key');
  const forgedRun = await run(forged, pub);
  assert.equal(forgedRun.launched, 0, 'signed by another key');
  assert.match(forgedRun.job.error ?? '', /signature/i);
  const missing = await run(null, pub);
  assert.equal(missing.launched, 0, 'a key is pinned but the release is unsigned');
  assert.match(missing.job.error ?? '', /signature/i);
  assert.equal((await run('not base64 at all!', pub)).launched, 0);
  assert.equal(verifySignature(Buffer.from(sums), good, pub), true);
  assert.equal(verifySignature(Buffer.from(`${sums} `), good, pub), false, 'one changed byte');
});

test('M5: a copy that is not the installed desktop app is never offered the installer and never downloads one', async () => {
  const fake = fakeGithub(Buffer.from('MZ'.repeat(100)));
  const launched: string[] = [];
  const s = new UpdateService({ fetchImpl: fake.fetchImpl, now: () => 1, userDir: tmp('seq-upd-'), platform: 'win32', arch: 'x64', current: () => '0.1.4', desktop: () => false, launch: (f) => (launched.push(f), 'done') });
  const view = await s.check();
  assert.equal(view.newer, true);
  assert.equal(view.installable, false, 'a source checkout updates with git, not an installer');
  assert.equal(view.desktop, false);
  const job = await s.install();
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /not the installed app/);
  assert.equal(launched.length, 0);
  assert.ok(!fake.urls.some((u) => u.includes('/download/')), 'nothing was downloaded');
});
