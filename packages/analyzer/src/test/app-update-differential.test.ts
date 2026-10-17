import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import YAML from 'yaml';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  UpdateService,
  compareVersions,
  pickAsset,
  pickMacUpdate,
  defaultBuildDirs,
  readBuildNumber,
  readVersionInfo,
  withBuild,
  type FetchLike,
  type ReleaseAsset,
} from '../server/appUpdate.js';
import { encodeBlockMap, parseBlockMap, planDiff, type BlockMap } from '../server/update/blockmap.js';
import { ChecksumMismatch, downloadZip, type Net } from '../server/update/differential.js';
import {
  appBundleFromExecPath,
  canSwapInPlace,
  handoffArgv,
  clearZipCache,
  promoteZipCache,
  readZipCache,
  recordHandoff,
  swapScript,
  sweepLeftovers,
  writePendingZip,
} from '../server/update/macInstall.js';

/* The mac update: block map diff, ranged reassembly, the zip cache, the in-place install and its dmg fallback, and
   four-part versions. The network is a fake that honours Range; nothing leaves the machine and no app is swapped. */

const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/* ── synthetic zips and their block maps ────────────────────────────────── */

/** Deterministic pseudo-random bytes. */
function bytes(seed: string, n: number): Buffer {
  const out: Buffer[] = [];
  let have = 0;
  for (let i = 0; have < n; i++) {
    const h = createHash('sha256').update(`${seed}:${i}`).digest();
    out.push(h);
    have += h.length;
  }
  return Buffer.concat(out).subarray(0, n);
}

interface Zip {
  data: Buffer;
  map: BlockMap;
  sizes: number[];
}

/** A "zip" of N chunks; chunk i is `chunkSeeds[i]` bytes of a size that varies by i. */
function makeZip(chunkSeeds: string[]): Zip {
  const sizes = chunkSeeds.map((_, i) => 700 + ((i * 37) % 600));
  const parts = chunkSeeds.map((s, i) => bytes(s, sizes[i]!));
  const checksums = parts.map((p) => createHash('sha256').update(p).digest('base64'));
  return { data: Buffer.concat(parts), sizes, map: { version: '2', files: [{ name: 'file', offset: 0, checksums, sizes }] } };
}

const seeds = (n: number, tag = 'a'): string[] => Array.from({ length: n }, (_, i) => `${tag}${i}`);
const OLD = makeZip(seeds(40));
/* New zip: chunks 5, 6 (adjacent), 20 and 39 (the last) changed; 12 chunks the same size is kept. */
const changed = new Set([5, 6, 20, 39]);
const NEW_SEEDS = seeds(40).map((s, i) => (changed.has(i) ? `${s}-new` : s));
const NEW = makeZip(NEW_SEEDS);

test('planDiff: exactly the changed chunks are remote, everything else comes from the old file', () => {
  const plan = planDiff(OLD.map, NEW.map, 0);
  assert.equal(plan.total, NEW.data.length);
  assert.equal(plan.changedChunks, 4);
  const remote = plan.ops.filter((o) => o.kind === 'remote');
  /* 5 and 6 are adjacent: one op; 20 and 39 are single. */
  assert.equal(remote.length, 3);
  assert.deepEqual(
    remote.map((o) => [o.newOffset, o.length]),
    [
      [NEW.sizes.slice(0, 5).reduce((a, b) => a + b, 0), NEW.sizes[5]! + NEW.sizes[6]!],
      [NEW.sizes.slice(0, 20).reduce((a, b) => a + b, 0), NEW.sizes[20]!],
      [NEW.sizes.slice(0, 39).reduce((a, b) => a + b, 0), NEW.sizes[39]!],
    ],
  );
  const want = NEW.sizes[5]! + NEW.sizes[6]! + NEW.sizes[20]! + NEW.sizes[39]!;
  assert.equal(plan.remoteBytes, want);
  assert.equal(plan.localBytes, plan.total - want);
  /* negative control: identical maps need nothing. */
  assert.equal(planDiff(OLD.map, OLD.map).remoteBytes, 0);
  /* and a chunk with the same checksum but another size is not reused. */
  const lying: BlockMap = { version: '2', files: [{ name: 'file', offset: 0, checksums: OLD.map.files[0]!.checksums, sizes: OLD.sizes.map((s) => s + 1) }] };
  assert.equal(planDiff(OLD.map, lying).localBytes, 0);
});

test('planDiff coalesces: adjacent changes are one range, and a short local run between two ranges is absorbed only up to mergeGap', () => {
  /* chunks 5,6 changed and 8 changed: chunk 7 (size sizes[7]) sits between. */
  const s = seeds(40).map((x, i) => ([5, 6, 8].includes(i) ? `${x}-n` : x));
  const next = makeZip(s);
  const gap = next.sizes[7]!;
  const tight = planDiff(OLD.map, next.map, 0);
  assert.equal(tight.ops.filter((o) => o.kind === 'remote').length, 2, 'adjacent 5+6 merge, 8 stays apart');
  const merged = planDiff(OLD.map, next.map, gap);
  assert.equal(merged.ops.filter((o) => o.kind === 'remote').length, 1, 'the gap is absorbed');
  assert.equal(merged.remoteBytes, tight.remoteBytes + gap);
  assert.equal(planDiff(OLD.map, next.map, gap - 1).ops.filter((o) => o.kind === 'remote').length, 2, 'one byte too long to absorb');
  /* contiguous local chunks are one copy */
  assert.equal(tight.ops.filter((o) => o.kind === 'local').length, 3);
});

test('parseBlockMap reads gzip JSON and refuses a malformed one', () => {
  assert.deepEqual(parseBlockMap(encodeBlockMap(OLD.map)), OLD.map);
  assert.throws(() => parseBlockMap(Buffer.from('nope')));
  assert.throws(() => parseBlockMap(encodeBlockMap({ version: '2', files: [{ name: 'f', offset: 0, checksums: ['a'], sizes: [] }] })));
  assert.throws(() => parseBlockMap(Buffer.from(JSON.stringify({ version: '9', files: [] }))));
});

/* ── a fake CDN that honours Range ──────────────────────────────────────── */

interface Fake {
  net: Net;
  requests: string[];
  ranges: Array<[number, number]>;
  bytesServed: number;
}

type Mode = 'ok' | 'corrupt-range' | 'ignore-range' | 'short-range' | 'corrupt-full';

function res(status: number, body: Buffer, headers: Record<string, string> = {}): Awaited<ReturnType<FetchLike>> {
  let at = 0;
  const h: Record<string, string> = { 'content-length': String(body.length), ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(body.toString('utf8')),
    text: async () => body.toString('utf8'),
    body: {
      getReader: () => ({
        read: async () => {
          if (at >= body.length) return { done: true };
          const piece = body.subarray(at, Math.min(at + 1500, body.length));
          at += piece.length;
          return { done: false, value: new Uint8Array(piece) };
        },
        cancel: async () => undefined,
      }),
    },
  };
}

function fakeNet(zip: Buffer, blockmap: Buffer | null, mode: Mode = 'ok'): Fake {
  const f: Fake = { net: undefined as unknown as Net, requests: [], ranges: [], bytesServed: 0 };
  f.net = {
    arm: () => undefined,
    timed: (p) => p,
    get: async (url, headers) => {
      f.requests.push(url);
      if (url.endsWith('.blockmap')) {
        if (!blockmap) return { res: res(404, Buffer.alloc(0)), finalUrl: url };
        f.bytesServed += blockmap.length;
        return { res: res(200, blockmap), finalUrl: url };
      }
      const range = /^bytes=(\d+)-(\d+)$/.exec(headers.range ?? '');
      if (!range) {
        const body = mode === 'corrupt-full' ? Buffer.concat([zip.subarray(0, zip.length - 1), Buffer.from([zip[zip.length - 1]! ^ 1])]) : zip;
        f.bytesServed += body.length;
        return { res: res(200, body), finalUrl: 'https://release-assets.githubusercontent.com/signed/zip' };
      }
      const a = Number(range[1]);
      const b = Number(range[2]);
      f.ranges.push([a, b]);
      if (mode === 'ignore-range') {
        f.bytesServed += zip.length;
        return { res: res(200, zip), finalUrl: url };
      }
      let slice = Buffer.from(zip.subarray(a, b + 1));
      if (mode === 'corrupt-range' && f.ranges.length === 2) slice = Buffer.from(slice.map((x) => x ^ 0xff));
      if (mode === 'short-range' && f.ranges.length === 1) slice = slice.subarray(0, slice.length - 5);
      f.bytesServed += slice.length;
      return { res: res(206, slice, { 'content-range': `bytes ${a}-${b}/${zip.length}` }), finalUrl: 'https://release-assets.githubusercontent.com/signed/zip' };
    },
  };
  return f;
}

const ZIP_URL = 'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.6/Sequence-0.1.6-arm64-mac.zip';
function opts(f: Fake, dir: string, cached: boolean, extra: Partial<Parameters<typeof downloadZip>[0]> = {}): Parameters<typeof downloadZip>[0] {
  let cache = null;
  if (cached) {
    const z = path.join(dir, 'old.zip');
    fs.writeFileSync(z, OLD.data);
    cache = { zip: z, blockmap: encodeBlockMap(OLD.map) };
  }
  return { net: f.net, zipUrl: ZIP_URL, blockmapUrl: `${ZIP_URL}.blockmap`, blockmapSha: sha(encodeBlockMap(NEW.map)), expectedSha: sha(NEW.data), size: NEW.data.length, part: path.join(dir, 'new.part'), cached: cache, ...extra };
}

test('differential download: only the changed ranges are fetched and the file is byte-identical and verified', async () => {
  const dir = tmp('seq-diff-');
  const f = fakeNet(NEW.data, encodeBlockMap(NEW.map));
  const r = await downloadZip(opts(f, dir, true, { mergeGap: 0 }));
  assert.equal(r.mode, 'differential');
  assert.equal(r.fallbackReason, null);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'new.part')), NEW.data);
  assert.equal(f.ranges.length, 3, 'three runs of changed chunks, three requests');
  const want = NEW.sizes[5]! + NEW.sizes[6]! + NEW.sizes[20]! + NEW.sizes[39]!;
  assert.equal(r.fullSize, NEW.data.length);
  assert.equal(r.reused, NEW.data.length - want);
  assert.equal(r.downloaded, want + encodeBlockMap(NEW.map).length, 'zip ranges plus the block map');
  assert.ok(r.downloaded < NEW.data.length / 2);
  assert.equal(f.bytesServed, r.downloaded, 'what the report says is what the server served');
  assert.ok(r.blockmap && r.blockmap.length > 0, 'the new block map is returned to cache');
  /* ranges go to the resolved CDN url after the first one, not back through github.com each time */
  assert.equal(f.requests.filter((u) => u === ZIP_URL).length, 1);
});

test('a corrupt range is caught by the release checksum and the whole file is downloaded instead', async () => {
  const dir = tmp('seq-diff-');
  const f = fakeNet(NEW.data, encodeBlockMap(NEW.map), 'corrupt-range');
  const r = await downloadZip(opts(f, dir, true, { mergeGap: 0 }));
  assert.equal(r.mode, 'full');
  assert.match(r.fallbackReason ?? '', /did not match its checksum/);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'new.part')), NEW.data, 'the fallback file is the right one');
  assert.ok(r.downloaded > NEW.data.length, 'the cost of the failed attempt is reported');
});

test('a server that ignores Range, or answers a short range, falls back to the full download', async () => {
  for (const mode of ['ignore-range', 'short-range'] as const) {
    const dir = tmp('seq-diff-');
    const f = fakeNet(NEW.data, encodeBlockMap(NEW.map), mode);
    const r = await downloadZip(opts(f, dir, true, { mergeGap: 0 }));
    assert.equal(r.mode, 'full', mode);
    assert.ok(r.fallbackReason, mode);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'new.part')), NEW.data, mode);
  }
});

test('no cached copy: the full zip is downloaded once, with no range request, and the block map comes back to be cached', async () => {
  const dir = tmp('seq-diff-');
  const f = fakeNet(NEW.data, encodeBlockMap(NEW.map));
  const r = await downloadZip(opts(f, dir, false));
  assert.equal(r.mode, 'full');
  assert.equal(r.fallbackReason, null, 'nothing went wrong, there was just nothing to diff against');
  assert.equal(f.ranges.length, 0);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'new.part')), NEW.data);
  assert.ok(r.blockmap);
});

test('a release with no block map still downloads in full, and says why when a cache existed', async () => {
  const dir = tmp('seq-diff-');
  const f = fakeNet(NEW.data, null);
  const r = await downloadZip(opts(f, dir, true));
  assert.equal(r.mode, 'full');
  assert.match(r.fallbackReason ?? '', /no usable block map/);
  assert.equal(r.blockmap, null);
});

test('a full download that does not match the release checksum is an error, never accepted', async () => {
  const dir = tmp('seq-diff-');
  const f = fakeNet(NEW.data, encodeBlockMap(NEW.map), 'corrupt-full');
  await assert.rejects(downloadZip(opts(f, dir, false)), ChecksumMismatch);
});

/* ── the zip cache ──────────────────────────────────────────────────────── */

test('the zip cache: a new zip is PENDING and the installed one is kept until the new version is seen running', () => {
  const user = tmp('seq-cache-');
  const cmp = (a: string, b: string): number | null => compareVersions(a, b);
  const put = (name: string, data: Buffer, version: string, map: BlockMap, promoteNow = false): void => {
    const z = path.join(user, name);
    fs.writeFileSync(z, data);
    writePendingZip(user, version, z, sha(data), encodeBlockMap(map));
    if (promoteNow) promoteZipCache(user, version, cmp);
  };
  put('a.zip', OLD.data, '0.1.5', OLD.map, true); /* 0.1.5 installed and running */
  const is5 = (v: string): boolean => compareVersions(v, '0.1.5') === 0;
  const is6 = (v: string): boolean => compareVersions(v, '0.1.6') === 0;
  assert.deepEqual(fs.readFileSync(readZipCache(user, is5)!.zip), OLD.data);
  put('b.zip', NEW.data, '0.1.6', NEW.map); /* 0.1.6 downloaded, swap not done yet (or the machine rebooted) */
  assert.ok(readZipCache(user, is5), 'the installed copy survives until 0.1.6 runs');
  assert.ok(readZipCache(user, is6, 'pending'));
  assert.equal(promoteZipCache(user, '0.1.5', cmp), 'none', 'still running 0.1.5: nothing changes');
  assert.ok(readZipCache(user, is5) && readZipCache(user, is6, 'pending'));
  assert.equal(promoteZipCache(user, '0.1.6', cmp), 'promoted');
  assert.equal(readZipCache(user, is5), null, 'the old copy is deleted');
  assert.deepEqual(fs.readFileSync(readZipCache(user, is6)!.zip), NEW.data);
  assert.equal(readZipCache(user, is6, 'pending'), null);
  /* a pending zip older than what runs is stale */
  put('c.zip', OLD.data, '0.1.5', OLD.map);
  assert.equal(promoteZipCache(user, '0.1.6', cmp), 'stale');
  assert.equal(readZipCache(user, () => true, 'pending'), null);
  /* a size that changed on disk is not used; no block map keeps nothing; clearZipCache empties both */
  fs.appendFileSync(readZipCache(user, is6)!.zip, 'x');
  assert.equal(readZipCache(user, is6), null);
  const z2 = path.join(user, 'z2.zip');
  fs.writeFileSync(z2, OLD.data);
  writePendingZip(user, '0.1.9', z2, sha(OLD.data), null);
  assert.equal(readZipCache(user, () => true, 'pending'), null);
  clearZipCache(user);
  assert.equal(readZipCache(user, () => true), null);
});

/* ── the swap helper, as text ───────────────────────────────────────────── */

test('swapScript waits for the pid, clears quarantine on the NEW bundle only, swaps by rename and reopens; paths are arguments, not text', () => {
  const s = swapScript();
  assert.match(s, /^#!\/bin\/sh\n/);
  assert.match(s, /kill -0 "\$PID"/, 'waits for the app to exit');
  assert.ok(!/3600|waited/.test(s), 'F1: it waits as long as the app runs, no give-up timer');
  assert.match(s, /xattr -dr com\.apple\.quarantine "\$NEW"/);
  assert.equal((s.match(/xattr/g) ?? []).length, 1, 'quarantine is cleared on one path');
  assert.ok(!/xattr[^\n]*\$APP/.test(s) && !/xattr[^\n]*\$OLD/.test(s), 'never on the old bundle or the whole app');
  assert.ok(s.indexOf('mv "$APP" "$OLD"') < s.indexOf('mv "$NEW" "$APP"'), 'old aside before new in');
  assert.match(s, /rm -rf "\$OLD"/);
  assert.match(s, /mv "\$OLD" "\$APP"/, 'rolls back when the new bundle cannot be moved in');
  assert.match(s, /open "\$APP"\n$/, 'relaunches last');
  /* a hostile path appears nowhere in the script; it only ever travels as an argument */
  const argv = handoffArgv({ script: '/u/apply.sh', pid: 4242, newBundle: "/a b/.x/$(rm -rf ~)'.app", appBundle: '/Applications/Sequence.app', tmpDir: '/a b/.x' });
  assert.deepEqual(argv, ['/u/apply.sh', '4242', "/a b/.x/$(rm -rf ~)'.app", '/Applications/Sequence.app', '/a b/.x']);
  assert.ok(!s.includes('rm -rf ~'));
});

test('swapScript is valid sh, and really swaps when run against throwaway folders with a dead pid', { skip: process.platform === 'win32' && !hasSh() }, () => {
  const root = tmp('seq-swap-');
  const script = path.join(root, 'apply.sh');
  fs.writeFileSync(script, swapScript());
  execFileSync('sh', ['-n', script]);
  /* `open` and `xattr` are shadowed by stubs so nothing real is launched or touched. */
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  for (const n of ['open', 'xattr']) fs.writeFileSync(path.join(bin, n), `#!/bin/sh\necho "${n} $*" >> "${root}/calls.log"\n`, { mode: 0o755 });
  const app = path.join(root, 'Sequence.app');
  const tmpDir = path.join(root, '.upd');
  const next = path.join(tmpDir, 'Sequence.app');
  fs.mkdirSync(app);
  fs.mkdirSync(next, { recursive: true });
  fs.writeFileSync(path.join(app, 'v'), 'old');
  fs.writeFileSync(path.join(next, 'v'), 'new');
  execFileSync('sh', [script, '999999999', next, app, tmpDir], { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
  assert.equal(fs.readFileSync(path.join(app, 'v'), 'utf8'), 'new');
  assert.equal(fs.existsSync(tmpDir), false);
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.includes('.old-')), [], 'the old bundle is gone');
  const calls = fs.readFileSync(path.join(root, 'calls.log'), 'utf8');
  assert.ok(calls.includes(`xattr -dr com.apple.quarantine ${next}`));
  assert.ok(calls.includes(`open ${app}`));
});

function hasSh(): boolean {
  try {
    execFileSync('sh', ['-c', 'true']);
    return true;
  } catch {
    return false;
  }
}

test('appBundleFromExecPath and canSwapInPlace', () => {
  assert.equal(appBundleFromExecPath('/Applications/Sequence.app/Contents/MacOS/Sequence'), '/Applications/Sequence.app');
  assert.equal(appBundleFromExecPath('/Users/a b/Apps/Sequence.app/Contents/MacOS/Sequence'), '/Users/a b/Apps/Sequence.app');
  assert.equal(appBundleFromExecPath('/usr/local/bin/node'), null);
  assert.deepEqual(canSwapInPlace('/Applications/Sequence.app', () => undefined), { ok: true, reason: null });
  const denied = canSwapInPlace('/Applications/Sequence.app', (p) => {
    if (p === '/Applications') throw new Error('EACCES');
  });
  assert.equal(denied.ok, false);
  assert.match(denied.reason ?? '', /cannot write to/);
});

/* ── assets and versions ────────────────────────────────────────────────── */

const A = (name: string, tag = 'v0.1.6', size = 1000): ReleaseAsset => ({ name, size, url: `https://github.com/naidx0/sequence-arch-tool/releases/download/${tag}/${name}` });

test('pickMacUpdate offers the zip and its block map for the CPU; Windows and the dmg fallback are unchanged', () => {
  const assets = [
    A('Sequence-0.1.6-arm64.dmg'),
    A('Sequence-0.1.6.dmg'),
    A('Sequence-0.1.6-arm64-mac.zip'),
    A('Sequence-0.1.6-arm64-mac.zip.blockmap'),
    A('Sequence-0.1.6-mac.zip'),
    A('Sequence-0.1.6-mac.zip.blockmap'),
    A('Sequence.Setup.0.1.6.exe'),
    A('Sequence.Setup.0.1.6.exe.blockmap'),
    A('Sequence-0.1.6-win.zip'),
    A('SHASUMS256.txt'),
  ];
  const arm = pickMacUpdate(assets, 'arm64');
  assert.equal(arm?.zip.name, 'Sequence-0.1.6-arm64-mac.zip');
  assert.equal(arm?.blockmap?.name, 'Sequence-0.1.6-arm64-mac.zip.blockmap');
  const intel = pickMacUpdate(assets, 'x64');
  assert.equal(intel?.zip.name, 'Sequence-0.1.6-mac.zip');
  assert.equal(intel?.blockmap?.name, 'Sequence-0.1.6-mac.zip.blockmap');
  assert.equal(pickMacUpdate(assets.filter((a) => !a.name.endsWith('.blockmap')), 'arm64')?.blockmap, null, 'a release without block maps still offers the zip');
  assert.equal(pickMacUpdate([A('Sequence-0.1.6-arm64.dmg')], 'arm64'), null);
  assert.equal(pickMacUpdate([A('Sequence-0.1.6-arm64-mac.zip')], 'x64'), null, 'an Apple-silicon zip is not offered to Intel');
  /* Windows: still the NSIS exe, never its blockmap or the portable zip. */
  assert.equal(pickAsset(assets, 'win32', 'x64')?.name, 'Sequence.Setup.0.1.6.exe');
  assert.equal(pickAsset(assets.filter((a) => a.name !== 'Sequence.Setup.0.1.6.exe'), 'win32', 'x64'), null);
  /* macOS dmg fallback is still the dmg, not a zip or a blockmap */
  assert.equal(pickAsset(assets, 'darwin', 'arm64')?.name, 'Sequence-0.1.6-arm64.dmg');
});

test('versions: four-part compare numerically, and app-build.json makes 0.1.7 + build 1 = 0.1.7.1', () => {
  assert.equal(compareVersions('0.1.7.1', '0.1.7'), 1);
  assert.equal(compareVersions('0.1.7.2', '0.1.7.10'), -1);
  assert.equal(compareVersions('0.1.7.1', '0.1.8'), -1);
  assert.equal(compareVersions('0.1.7.0', '0.1.7'), 0);
  const dir = tmp('seq-build-');
  assert.equal(readBuildNumber([dir]), 0, 'absent = 0');
  fs.writeFileSync(path.join(dir, 'app-build.json'), JSON.stringify({ build: 1 }));
  assert.equal(readBuildNumber([dir]), 1);
  fs.writeFileSync(path.join(dir, 'app-build.json'), '{"build":"x"}');
  assert.equal(readBuildNumber([dir]), 0, 'not a number = 0');
  fs.writeFileSync(path.join(dir, 'app-build.json'), JSON.stringify({ build: -3 }));
  assert.equal(readBuildNumber([dir]), 0);
  assert.equal(withBuild('0.1.7', 1), '0.1.7.1');
  assert.equal(withBuild('0.1.7', 0), '0.1.7');
  assert.equal(withBuild('0.1.7.2', 1), '0.1.7.2', 'a version that already has four parts is not extended');
  assert.equal(withBuild('0.1.7-beta.1', 1), '0.1.7-beta.1');
  fs.writeFileSync(path.join(dir, 'app-build.json'), JSON.stringify({ build: 1 }));
  const withFile = readVersionInfo({ SEQUENCE_APP_VERSION: '0.1.7' }, 'darwin', 'arm64', [dir]);
  assert.equal(withFile.version, '0.1.7.1');
  assert.equal(compareVersions(withFile.version, '0.1.7'), 1);
  fs.rmSync(path.join(dir, 'app-build.json'));
  assert.equal(readVersionInfo({ SEQUENCE_APP_VERSION: '0.1.7' }, 'darwin', 'arm64', [dir]).version, '0.1.7');
});

/* ── the service, on a fake mac release ─────────────────────────────────── */

function macRelease(tag: string, zip: Buffer, blockmap: Buffer, dmg: Buffer) {
  const version = tag.replace(/^v/, '');
  const zipName = `Sequence-${version}-arm64-mac.zip`;
  const dmgName = `Sequence-${version}-arm64.dmg`;
  const files = new Map<string, Buffer>([
    [zipName, zip],
    [`${zipName}.blockmap`, blockmap],
    [dmgName, dmg],
  ]);
  const shasums = [...files].map(([n, b]) => `${sha(b)}  ${n}`).join('\n') + '\n';
  files.set('SHASUMS256.txt', Buffer.from(shasums));
  const url = (n: string): string => `https://github.com/naidx0/sequence-arch-tool/releases/download/${tag}/${n}`;
  const json = {
    tag_name: tag,
    name: `Sequence ${version}`,
    body: '',
    assets: [...files].map(([n, b]) => ({ name: n, browser_download_url: url(n), size: b.length })),
  };
  return { json, files, zipName, dmgName, url };
}

function fakeGithub(rel: ReturnType<typeof macRelease>) {
  const log = { ranges: 0, dmg: 0, zipFull: 0, served: 0 };
  const fetchImpl: FetchLike = async (u, init) => {
    if (u.startsWith('https://api.github.com/')) return res(200, Buffer.from(JSON.stringify(rel.json)));
    const m = /\/download\/[^/]+\/([^/?]+)$/.exec(u);
    if (m && u.startsWith('https://github.com/')) {
      /* every release download redirects to the CDN, as GitHub does */
      return { ...res(302, Buffer.alloc(0)), headers: { get: (n: string) => (n.toLowerCase() === 'location' ? `https://release-assets.githubusercontent.com/s/${m[1]}?sig=1` : null) } };
    }
    const c = /release-assets\.githubusercontent\.com\/s\/([^?]+)/.exec(u);
    const body = c ? rel.files.get(decodeURIComponent(c[1]!)) : undefined;
    if (!body) return res(404, Buffer.alloc(0));
    const range = /^bytes=(\d+)-(\d+)$/.exec(init?.headers?.range ?? '');
    if (range) {
      log.ranges++;
      const slice = body.subarray(Number(range[1]), Number(range[2]) + 1);
      log.served += slice.length;
      return res(206, Buffer.from(slice), { 'content-range': `bytes ${range[1]}-${range[2]}/${body.length}` });
    }
    if (c![1]!.endsWith('.dmg')) log.dmg++;
    if (c![1]!.endsWith('-mac.zip')) log.zipFull++;
    log.served += body.length;
    return res(200, body);
  };
  return { fetchImpl, log };
}

interface MacHarness {
  svc: UpdateService;
  user: string;
  handoffs: Array<{ script: string; pid: number; newBundle: string; appBundle: string; tmpDir: string }>;
  launched: string[];
  app: string;
}

function macService(fetchImpl: FetchLike, current: string, opts: { user?: string; canSwap?: boolean; extractFails?: boolean } = {}): MacHarness {
  const user = opts.user ?? tmp('seq-user-');
  const apps = tmp('seq-apps-');
  const app = path.join(apps, 'Sequence.app');
  fs.mkdirSync(app);
  const handoffs: MacHarness['handoffs'] = [];
  const launched: string[] = [];
  const svc = new UpdateService({
    fetchImpl,
    now: () => 1,
    userDir: user,
    platform: 'darwin',
    arch: 'arm64',
    current: () => current,
    desktop: () => true,
    launch: (f) => (launched.push(f), 'The disk image is open.'),
    mac: {
      bundle: () => app,
      canSwap: () => (opts.canSwap === false ? { ok: false, reason: 'Sequence is installed in /Applications, which this user cannot write to, so it cannot replace itself there.' } : { ok: true, reason: null }),
      extract: async (_zip, dest) => {
        if (opts.extractFails) throw new Error('could not unpack the update (ditto failed)');
        const b = path.join(dest, 'Sequence.app');
        fs.mkdirSync(b);
        return b;
      },
      handoff: async (a) => void handoffs.push(a),
      pid: () => 4242,
      mergeGap: 0,
    },
  });
  return { svc, user, handoffs, launched, app };
}

const ZIP5 = makeZip(seeds(40));
const ZIP6 = makeZip(NEW_SEEDS);
const REL5 = macRelease('v0.1.5', ZIP5.data, encodeBlockMap(ZIP5.map), bytes('dmg5', 5000));
const REL6 = macRelease('v0.1.6', ZIP6.data, encodeBlockMap(ZIP6.map), bytes('dmg6', 5000));

test('install (mac): first update from a dmg install has no cache, so the whole zip comes once; it installs in place and is cached', async () => {
  const gh = fakeGithub(REL5);
  const h = macService(gh.fetchImpl, '0.1.4');
  const job = await h.svc.install('0.1.5');
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.equal(job.mode, 'full');
  assert.equal(job.installMode, 'in-place');
  assert.equal(job.fallbackReason, null);
  assert.equal(job.fullSize, ZIP5.data.length);
  assert.ok(job.downloaded >= ZIP5.data.length, 'the whole zip (plus its small block map)');
  assert.equal(gh.log.ranges, 0);
  assert.equal(gh.log.dmg, 0, 'the dmg was not fetched');
  assert.equal(h.launched.length, 0, 'no dmg opened');
  assert.equal(h.handoffs.length, 1);
  const a = h.handoffs[0]!;
  assert.equal(a.pid, 4242);
  assert.equal(a.appBundle, h.app);
  assert.equal(path.dirname(a.tmpDir), path.dirname(h.app), 'unpacked next to the app, on the same volume');
  assert.match(job.howto ?? '', /Quit Sequence/);
  const cache = readZipCache(h.user, (v) => compareVersions(v, '0.1.5') === 0, 'pending');
  assert.ok(cache, 'the zip is kept (pending) until 0.1.5 is seen running');
  assert.deepEqual(fs.readFileSync(cache.zip), ZIP5.data);
  assert.equal(fs.readdirSync(path.join(h.user, 'updates')).filter((n) => n.endsWith('.part')).length, 0);
});

test('install (mac): the next update diffs against the cached copy of the installed version and fetches only the changes', async () => {
  const user = tmp('seq-user-');
  /* first: 0.1.4 -> 0.1.5 fills the cache */
  const first = macService(fakeGithub(REL5).fetchImpl, '0.1.4', { user });
  assert.equal((await first.svc.install('0.1.5')).state, 'launched');
  /* then: the app is now 0.1.5, and 0.1.6 is out */
  const gh = fakeGithub(REL6);
  const h = macService(gh.fetchImpl, '0.1.5', { user });
  const job = await h.svc.install('0.1.6');
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.equal(job.mode, 'differential');
  assert.equal(job.installMode, 'in-place');
  assert.equal(job.fullSize, ZIP6.data.length);
  assert.ok(job.reused > 0 && job.downloaded < job.fullSize / 2, `downloaded ${job.downloaded} of ${job.fullSize}`);
  assert.equal(job.downloaded, gh.log.served - REL6.files.get('SHASUMS256.txt')!.length, 'the reported bytes are the zip ranges plus the block map the server sent (SHASUMS256.txt aside)');
  assert.equal(gh.log.zipFull, 0, 'the full zip was never fetched');
  assert.ok(gh.log.ranges >= 1);
  assert.equal(h.handoffs.length, 1);
  /* and the cache now holds 0.1.6 byte for byte */
  const cache = readZipCache(user, (v) => compareVersions(v, '0.1.6') === 0, 'pending');
  assert.deepEqual(fs.readFileSync(cache!.zip), ZIP6.data);
});

test('install (mac): a cache for a different version is not diffed against', async () => {
  const user = tmp('seq-user-');
  assert.equal((await macService(fakeGithub(REL5).fetchImpl, '0.1.4', { user }).svc.install('0.1.5')).state, 'launched');
  const gh = fakeGithub(REL6);
  const job = await macService(gh.fetchImpl, '0.1.4', { user }).svc.install('0.1.6'); /* app still reports 0.1.4 */
  assert.equal(job.mode, 'full');
  assert.equal(gh.log.ranges, 0);
});

test('install (mac): when the app cannot be replaced where it lives, the dmg flow runs and says why', async () => {
  const gh = fakeGithub(REL6);
  const h = macService(gh.fetchImpl, '0.1.5', { canSwap: false });
  const job = await h.svc.install('0.1.6');
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.equal(job.installMode, 'dmg');
  assert.match(job.fallbackReason ?? '', /cannot write to|cannot replace itself/);
  assert.equal(h.handoffs.length, 0, 'no swap helper');
  assert.equal(h.launched.length, 1, 'the disk image was opened');
  assert.match(h.launched[0]!, /arm64\.dmg$/);
  assert.equal(gh.log.zipFull, 0, 'the zip was not downloaded');
});

test('install (mac): a zip that cannot be unpacked falls back to the dmg, with the reason', async () => {
  const h = macService(fakeGithub(REL6).fetchImpl, '0.1.5', { extractFails: true });
  const job = await h.svc.install('0.1.6');
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.equal(job.installMode, 'dmg');
  assert.match(job.fallbackReason ?? '', /could not unpack/);
  assert.equal(h.handoffs.length, 0);
  assert.equal(fs.readdirSync(path.dirname(h.app)).filter((n) => n.startsWith('.')).length, 0, 'the temp folder beside the app was removed');
});

test('install (mac): a release with no zip uses the dmg as before', async () => {
  const rel = macRelease('v0.1.6', ZIP6.data, encodeBlockMap(ZIP6.map), bytes('dmg6', 5000));
  rel.json.assets = rel.json.assets.filter((a) => !a.name.endsWith('.zip') && !a.name.endsWith('.blockmap'));
  const h = macService(fakeGithub(rel).fetchImpl, '0.1.5');
  const job = await h.svc.install('0.1.6');
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.equal(job.installMode, 'dmg');
  assert.equal(h.launched.length, 1);
});

test('install (mac): a four-part release (0.1.7.1) is offered to 0.1.7 and installs once (no loop)', async () => {
  const rel = macRelease('v0.1.7.1', ZIP6.data, encodeBlockMap(ZIP6.map), bytes('dmg71', 5000));
  const gh = fakeGithub(rel);
  const h = macService(gh.fetchImpl, '0.1.7');
  assert.equal((await h.svc.check(true)).newer, true);
  assert.equal((await h.svc.install('0.1.7.1')).state, 'launched');
  /* once the app reports 0.1.7 + build 1 = 0.1.7.1, the same release is not newer */
  const after = macService(gh.fetchImpl, withBuild('0.1.7', 1));
  assert.equal((await after.svc.check(true)).newer, false);
});

test('install (mac): a zip that fails its checksum is deleted and nothing is handed to the swap helper', async () => {
  const rel = macRelease('v0.1.6', ZIP6.data, encodeBlockMap(ZIP6.map), bytes('dmg6', 5000));
  const bad = Buffer.from(ZIP6.data);
  bad[100] ^= 1;
  rel.files.set(rel.zipName, bad); /* SHASUMS still lists the good hash */
  const h = macService(fakeGithub(rel).fetchImpl, '0.1.5');
  const job = await h.svc.install('0.1.6');
  assert.equal(job.state, 'failed');
  assert.match(job.error ?? '', /did not match its published checksum/);
  assert.equal(h.handoffs.length, 0);
  assert.equal(h.launched.length, 0);
  assert.equal(fs.readdirSync(path.join(h.user, 'updates')).filter((n) => n.endsWith('.part')).length, 0);
});

/* ── review round: F1, C1-C7 ────────────────────────────────────────────── */

test('F1: a zip already downloaded for the target (swap not done yet) is verified and reused with zero download', async () => {
  const user = tmp('seq-user-');
  const first = macService(fakeGithub(REL5).fetchImpl, '0.1.4', { user });
  assert.equal((await first.svc.install('0.1.5')).state, 'launched');
  /* the person never quit the app (or rebooted): still 0.1.4, same release */
  const gh = fakeGithub(REL5);
  const h = macService(gh.fetchImpl, '0.1.4', { user });
  const job = await h.svc.install('0.1.5');
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.equal(job.mode, 'cached');
  assert.equal(job.downloaded, 0);
  assert.equal(gh.log.zipFull + gh.log.ranges, 0);
  assert.equal(h.handoffs.length, 1);
  /* a cached zip that no longer matches the release checksum is NOT trusted */
  const pend = readZipCache(user, () => true, 'pending')!;
  const bad = fs.readFileSync(pend.zip);
  bad[0] ^= 1;
  fs.writeFileSync(pend.zip, bad);
  const gh2 = fakeGithub(REL5);
  const job2 = await macService(gh2.fetchImpl, '0.1.4', { user }).svc.install('0.1.5');
  assert.equal(job2.state, 'launched');
  assert.notEqual(job2.mode, 'cached');
  assert.ok(gh2.log.zipFull >= 1);
});

test('F1: the installed cache survives an update whose swap has not happened, and is replaced only once the new version runs', async () => {
  const user = tmp('seq-user-');
  assert.equal((await macService(fakeGithub(REL5).fetchImpl, '0.1.4', { user }).svc.install('0.1.5')).state, 'launched');
  const h5 = macService(fakeGithub(REL6).fetchImpl, '0.1.5', { user }); /* 0.1.5 running: promoted at startup */
  await h5.svc.check(true);
  assert.ok(readZipCache(user, (v) => compareVersions(v, '0.1.5') === 0));
  assert.equal((await h5.svc.install('0.1.6')).state, 'launched');
  assert.ok(readZipCache(user, (v) => compareVersions(v, '0.1.5') === 0), '0.1.5 kept: 0.1.6 is not confirmed running');
  const h6 = macService(fakeGithub(REL6).fetchImpl, '0.1.6', { user });
  await h6.svc.check(true);
  assert.equal(readZipCache(user, (v) => compareVersions(v, '0.1.5') === 0), null, '0.1.5 deleted once 0.1.6 runs');
  assert.ok(readZipCache(user, (v) => compareVersions(v, '0.1.6') === 0));
});

test('C1: a block map is bounded and authenticated', async () => {
  const bomb = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20));
  assert.throws(() => parseBlockMap(bomb), /too large/);
  assert.throws(() => parseBlockMap(Buffer.alloc(9 * 1024 * 1024)), /too large/);
  const mk = (offset: number, sizes: number[]): Buffer => encodeBlockMap({ version: '2', files: [{ name: 'f', offset, checksums: sizes.map((_, i) => `c${i}`), sizes }] });
  assert.throws(() => parseBlockMap(mk(10, [5])), /offset 0/);
  assert.throws(() => parseBlockMap(mk(0.5, [5])), /malformed/);
  assert.throws(() => parseBlockMap(mk(-1, [5])), /malformed/);
  assert.throws(() => parseBlockMap(mk(0, [5, 1.5])), /malformed/);
  assert.throws(() => parseBlockMap(mk(0, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]), 10), /covers/);
  assert.throws(() => parseBlockMap(mk(0, [5, 5]), 11), /covers 10 bytes, the file is 11/);
  assert.equal(parseBlockMap(mk(0, [5, 5]), 10).files[0]!.sizes.length, 2);
  /* a block map whose sha is not the release's is not used; the download falls back to the full zip, correct bytes */
  let dir = tmp('seq-diff-');
  let f = fakeNet(NEW.data, encodeBlockMap(NEW.map));
  let r = await downloadZip(opts(f, dir, true, { blockmapSha: sha('something else') }));
  assert.equal(r.mode, 'full');
  assert.match(r.fallbackReason ?? '', /no usable block map/);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'new.part')), NEW.data);
  assert.equal(f.ranges.length, 0);
  /* no sha listed at all: not used either, and not even fetched */
  dir = tmp('seq-diff-');
  f = fakeNet(NEW.data, encodeBlockMap(NEW.map));
  r = await downloadZip(opts(f, dir, true, { blockmapSha: null }));
  assert.equal(r.mode, 'full');
  assert.equal(f.requests.some((u) => u.endsWith('.blockmap')), false);
  /* an oversized body is refused even when its sha is the listed one */
  dir = tmp('seq-diff-');
  const huge = Buffer.alloc(9 * 1024 * 1024, 1);
  f = fakeNet(NEW.data, huge);
  r = await downloadZip(opts(f, dir, true, { blockmapSha: sha(huge) }));
  assert.equal(r.mode, 'full');
  assert.match(r.fallbackReason ?? '', /no usable block map/);
  /* a block map whose chunk sizes do not add up to the zip is refused */
  dir = tmp('seq-diff-');
  const wrong = encodeBlockMap({ version: '2', files: [{ name: 'file', offset: 0, checksums: ['a'], sizes: [NEW.data.length - 1] }] });
  f = fakeNet(NEW.data, wrong);
  r = await downloadZip(opts(f, dir, true, { blockmapSha: sha(wrong) }));
  assert.equal(r.mode, 'full');
  assert.match(r.fallbackReason ?? '', /no usable block map/);
  /* the full zip is capped */
  dir = tmp('seq-diff-');
  f = fakeNet(NEW.data, null);
  await assert.rejects(downloadZip(opts(f, dir, false, { maxBytes: NEW.data.length - 1 })), /larger than any release/);
});

test('C2: a zip that cannot be downloaded (404) falls back to the dmg with the reason; nothing unverified is installed', async () => {
  const rel = macRelease('v0.1.6', ZIP6.data, encodeBlockMap(ZIP6.map), bytes('dmg6', 5000));
  rel.files.delete(rel.zipName); /* listed in the release, 404 on download */
  const h = macService(fakeGithub(rel).fetchImpl, '0.1.5');
  const job = await h.svc.install('0.1.6');
  assert.equal(job.state, 'launched', job.error ?? '');
  assert.equal(job.installMode, 'dmg');
  assert.match(job.fallbackReason ?? '', /could not be downloaded/);
  assert.equal(h.handoffs.length, 0);
  assert.equal(h.launched.length, 1);
});

test('C4: leftover unpack folders beside the app are swept at startup, the one a live helper waits on is not, and a dmg update clears the cache', async () => {
  const apps = tmp('seq-apps-');
  const app = path.join(apps, 'Sequence.app');
  fs.mkdirSync(app);
  const mk = (dir: string, n: string, ageMs: number): string => {
    const d = path.join(dir, n);
    fs.mkdirSync(d);
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(d, t, t);
    return d;
  };
  const oldA = mk(apps, '.Sequence-update-aaaa', 60_000);
  const waiting = mk(apps, '.Sequence-update-bbbb', 60_000);
  const fresh = mk(apps, '.Sequence-update-cccc', -60_000);
  const other = mk(apps, '.Other-update-dddd', 60_000);
  const user = tmp('seq-user-');
  recordHandoff(user, waiting, 4242);
  const removed = sweepLeftovers(app, Date.now(), user, (pid) => pid === 4242);
  assert.deepEqual(removed, ['.Sequence-update-aaaa']);
  assert.equal(fs.existsSync(oldA), false);
  assert.ok(fs.existsSync(waiting) && fs.existsSync(fresh) && fs.existsSync(other));
  assert.deepEqual(sweepLeftovers(app, Date.now(), user, () => false), ['.Sequence-update-bbbb'], 'the helper is gone, so its folder is leftover too');
  /* wired into the service: the startup sweep */
  const h = macService(fakeGithub(REL6).fetchImpl, '0.1.5');
  const leftover = mk(path.dirname(h.app), '.Sequence-update-eeee', 60_000);
  await h.svc.check(true);
  assert.equal(fs.existsSync(leftover), false);
  /* a dmg update clears the cache */
  const u2 = tmp('seq-user-');
  const z = path.join(u2, 'z.zip');
  fs.writeFileSync(z, OLD.data);
  writePendingZip(u2, '0.1.5', z, sha(OLD.data), encodeBlockMap(OLD.map));
  promoteZipCache(u2, '0.1.5', (a, b) => compareVersions(a, b));
  assert.ok(readZipCache(u2, () => true));
  const d = macService(fakeGithub(REL6).fetchImpl, '0.1.5', { user: u2, canSwap: false });
  assert.equal((await d.svc.install('0.1.6')).installMode, 'dmg');
  assert.equal(readZipCache(u2, () => true), null);
  assert.equal(readZipCache(u2, () => true, 'pending'), null);
});

test('C5: reassembly does not block the event loop (the local copy is async)', async () => {
  const MB = 1024 * 1024;
  const n = 24;
  const big = (changedAt: number): Zip => {
    const parts = Array.from({ length: n }, (_, i) => bytes(i === changedAt ? 'big-new' : `big${i}`, MB));
    const sizes = parts.map(() => MB);
    return { data: Buffer.concat(parts), sizes, map: { version: '2', files: [{ name: 'file', offset: 0, checksums: parts.map((p) => createHash('sha256').update(p).digest('base64')), sizes }] } };
  };
  const oldBig = big(-1);
  const newBig = big(20);
  const dir = tmp('seq-big-');
  fs.writeFileSync(path.join(dir, 'old.zip'), oldBig.data);
  const f = fakeNet(newBig.data, encodeBlockMap(newBig.map));
  let ticks = 0;
  const timer = setInterval(() => void ticks++, 0);
  const r = await downloadZip({
    net: f.net,
    zipUrl: ZIP_URL,
    blockmapUrl: `${ZIP_URL}.blockmap`,
    blockmapSha: sha(encodeBlockMap(newBig.map)),
    expectedSha: sha(newBig.data),
    size: newBig.data.length,
    part: path.join(dir, 'new.part'),
    cached: { zip: path.join(dir, 'old.zip'), blockmap: encodeBlockMap(oldBig.map) },
    mergeGap: 0,
  });
  clearInterval(timer);
  assert.equal(r.mode, 'differential', r.fallbackReason ?? '');
  assert.equal(r.reused, 23 * MB);
  assert.ok(ticks >= 10, `the event loop turned ${ticks} times during a 23 MiB local copy`);
});

test('C6: app-build.json is found from the packaged layout (dist/server -> the analyzer root)', () => {
  const root = tmp('seq-layout-');
  const here = path.join(root, 'packages', 'analyzer', 'dist', 'server');
  fs.mkdirSync(here, { recursive: true });
  assert.equal(readBuildNumber(defaultBuildDirs(here)), 0, 'absent = 0');
  fs.writeFileSync(path.join(root, 'packages', 'analyzer', 'app-build.json'), JSON.stringify({ build: 3 }));
  assert.equal(readBuildNumber(defaultBuildDirs(here)), 3, 'read where the release workflow writes it');
  const bundle = path.join(root, 'bundle', 'dist');
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(root, 'bundle', 'app-build.json'), JSON.stringify({ build: 7 }));
  assert.equal(readBuildNumber(defaultBuildDirs(bundle)), 7, 'and beside a one-file bundle');
});

test('C7: the "What was produced" step fails when a mac zip has no .blockmap, and passes when it has one or there is no mac zip', { skip: !hasSh() }, () => {
  const wf = YAML.parse(fs.readFileSync(path.resolve(process.cwd(), '..', '..', '.github', 'workflows', 'release.yml'), 'utf8')) as { jobs: { build: { steps: Array<{ name?: string; run?: string }> } } };
  const step = wf.jobs.build.steps.find((x) => x.name === 'What was produced');
  assert.ok(step?.run, 'the step exists');
  const run = (files: string[]): number => {
    const root = tmp('seq-wf-');
    const rel = path.join(root, 'packages', 'desktop', 'release');
    fs.mkdirSync(rel, { recursive: true });
    for (const n of files) fs.writeFileSync(path.join(rel, n), 'x');
    try {
      execFileSync('sh', ['-c', step.run!], { cwd: root, stdio: 'ignore' });
      return 0;
    } catch (e) {
      return (e as { status: number }).status;
    }
  };
  assert.equal(run(['Sequence-1-arm64-mac.zip']), 1, 'negative control: zip without blockmap fails');
  assert.equal(run(['Sequence-1-arm64-mac.zip', 'Sequence-1-arm64-mac.zip.blockmap', 'Sequence-1-mac.zip']), 1, 'the Intel zip is missing its blockmap');
  assert.equal(run(['Sequence-1-arm64-mac.zip', 'Sequence-1-arm64-mac.zip.blockmap', 'Sequence-1-mac.zip', 'Sequence-1-mac.zip.blockmap']), 0);
  assert.equal(run(['Sequence-1-win.zip', 'Sequence Setup 1.exe']), 0, 'no mac zip, nothing to check');
});
