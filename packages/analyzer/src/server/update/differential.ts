/**
 * Fetch the new mac zip by reusing what the installed version's zip already has.
 *
 * With the old zip (cached from the previous update) and both block maps, only the chunks that differ are fetched,
 * each run of them as one HTTP Range request against the release CDN URL the first request resolved to. The result is
 * written to `part` and its SHA-256 compared with the release's own SHASUMS256.txt. ANY failure on the differential path
 * (a server that ignores Range, a short or long body, a bad block map, a final hash that does not match) falls back to
 * downloading the whole zip once; only a full download that fails the hash is an error.
 *
 * The network is injected (Net), so every branch is testable without a socket.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { FetchLike } from '../appUpdate.js';
import { MAX_BLOCKMAP_BYTES, parseBlockMap, planDiff, type Plan } from './blockmap.js';

type Res = Awaited<ReturnType<FetchLike>>;

export interface Net {
  /** GET, following only allowed redirect hops. `resolved`: the url is a CDN url an earlier call ended on. */
  get(url: string, headers: Record<string, string>, resolved?: boolean): Promise<{ res: Res; finalUrl: string }>;
  /** Re-arm the idle timer (called per chunk). */
  arm(): void;
  /** Race a network wait against the idle timer. */
  timed<T>(p: Promise<T>): Promise<T>;
}

export interface CachedZip {
  zip: string;
  /** The old zip's .blockmap bytes. */
  blockmap: Buffer;
}

export interface DiffOptions {
  net: Net;
  zipUrl: string;
  blockmapUrl: string | null;
  /** The block map's SHA-256 from SHASUMS256.txt; a block map without one (or that does not match) is not used. */
  blockmapSha: string | null;
  /** The zip's SHA-256 from the release's SHASUMS256.txt. */
  expectedSha: string;
  /** The zip's size from the release listing (used when the server sends no length). */
  size: number;
  /** Where the new zip is written (exclusive create). */
  part: string;
  cached: CachedZip | null;
  /** Refuse a download larger than this (default 1.5 GB, the dmg path's cap). */
  maxBytes?: number;
  /** Local runs up to this long between two fetched runs are fetched too (default 64 KiB). */
  mergeGap?: number;
  /** received / planned total: bytes fetched so far over bytes this download will fetch. */
  onProgress?: (received: number, total: number) => void;
}

export interface DiffResult {
  mode: 'differential' | 'full';
  /** Bytes fetched over the network for the zip and its block map. */
  downloaded: number;
  /** The full zip's size. */
  fullSize: number;
  /** Bytes reused from the old zip. */
  reused: number;
  /** Why the differential path was not used (null when it was, or when there was nothing to diff against). */
  fallbackReason: string | null;
  /** The new zip's block map bytes (to cache beside it), or null when it could not be fetched. */
  blockmap: Buffer | null;
}

export class ChecksumMismatch extends Error {}

const UA = { 'user-agent': 'sequence-app-update-check' };
const COPY = 1 << 20;
export const DEFAULT_MAX_BYTES = 1_500_000_000;

async function readBody(res: Res, net: Net, onChunk: (b: Uint8Array) => void | Promise<void>): Promise<void> {
  if (!res.body) throw new Error('empty response');
  const reader = res.body.getReader();
  try {
    for (;;) {
      net.arm();
      const { done, value } = await net.timed(reader.read());
      if (done) return;
      if (value) await onChunk(value);
    }
  } catch (e) {
    void reader.cancel?.().catch(() => undefined);
    throw e;
  }
}

async function sha256Of(file: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('error', reject);
    s.on('end', () => resolve());
  });
  return h.digest('hex');
}

export async function downloadZip(o: DiffOptions): Promise<DiffResult> {
  let downloaded = 0;
  /* The new block map: needed to diff, and kept beside the zip so the NEXT update can diff against it. */
  let newMapBytes: Buffer | null = null;
  if (o.blockmapUrl && o.blockmapSha) {
    try {
      const { res } = await o.net.get(o.blockmapUrl, UA);
      if (!res.ok) throw new Error(`block map ${res.status}`);
      const parts: Buffer[] = [];
      let n = 0;
      await readBody(res, o.net, (b) => {
        n += b.length;
        if (n > MAX_BLOCKMAP_BYTES) throw new Error('block map is too large');
        parts.push(Buffer.from(b));
      });
      const bytes = Buffer.concat(parts);
      downloaded += bytes.length;
      /* Authenticate it like the zip: it steers what is fetched, so it must be the release's own. */
      if (createHash('sha256').update(bytes).digest('hex') !== o.blockmapSha.toLowerCase()) throw new Error('block map does not match its checksum');
      parseBlockMap(bytes, o.size > 0 ? o.size : undefined);
      newMapBytes = bytes;
    } catch {
      newMapBytes = null;
    }
  }

  let fallbackReason: string | null = null;
  if (o.cached) {
    if (!newMapBytes) fallbackReason = 'the release has no usable block map, downloaded the whole file';
    else {
      try {
        const plan = planDiff(parseBlockMap(o.cached.blockmap, fs.statSync(o.cached.zip).size), parseBlockMap(newMapBytes, o.size > 0 ? o.size : undefined), o.mergeGap ?? 65536);
        if (plan.total > (o.maxBytes ?? DEFAULT_MAX_BYTES)) throw new Error('the update is larger than any release');
        if (plan.remoteBytes >= plan.total * 0.95) throw new Error('almost nothing in common with the installed version');
        downloaded += await applyPlan(o, plan);
        const actual = await sha256Of(o.part);
        if (actual !== o.expectedSha.toLowerCase()) throw new Error('the reassembled file did not match its checksum');
        return { mode: 'differential', downloaded, fullSize: plan.total, reused: plan.localBytes, fallbackReason: null, blockmap: newMapBytes };
      } catch (e) {
        fallbackReason = `differential download failed (${(e as Error).message}), downloaded the whole file`;
        fs.rmSync(o.part, { force: true });
      }
    }
  }

  const bytes = await fullDownload(o);
  downloaded += bytes;
  const actual = await sha256Of(o.part);
  if (actual !== o.expectedSha.toLowerCase()) throw new ChecksumMismatch('The download did not match its published checksum');
  return { mode: 'full', downloaded, fullSize: bytes, reused: 0, fallbackReason, blockmap: newMapBytes };
}

async function fullDownload(o: DiffOptions): Promise<number> {
  const { res } = await o.net.get(o.zipUrl, UA);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || o.size;
  const max = o.maxBytes ?? DEFAULT_MAX_BYTES;
  if (total > max) throw new Error('the update is larger than any release');
  const fh = await fsp.open(o.part, 'wx');
  let n = 0;
  try {
    await readBody(res, o.net, async (b) => {
      if (n + b.length > max) throw new Error('the download is larger than any release');
      await fh.write(b, 0, b.length, n);
      n += b.length;
      o.onProgress?.(n, total);
    });
  } finally {
    await fh.close();
  }
  return n;
}

/** Build o.part from the cached zip plus ranges. Local copies and writes are async, so the server keeps answering. Returns the bytes fetched. */
async function applyPlan(o: DiffOptions, plan: Plan): Promise<number> {
  const old = await fsp.open(o.cached!.zip, 'r');
  const out = await fsp.open(o.part, 'wx');
  const buf = Buffer.allocUnsafe(COPY);
  let fetched = 0;
  let url = o.zipUrl;
  let resolved = false;
  try {
    for (const op of plan.ops) {
      if (op.kind === 'local') {
        for (let done = 0; done < op.length; ) {
          const want = Math.min(COPY, op.length - done);
          const { bytesRead } = await old.read(buf, 0, want, op.oldOffset + done);
          if (bytesRead !== want) throw new Error('the cached copy of the installed version is shorter than its block map says');
          await out.write(buf, 0, bytesRead, op.newOffset + done);
          done += bytesRead;
        }
        continue;
      }
      const last = op.newOffset + op.length - 1;
      const { res, finalUrl } = await o.net.get(url, { ...UA, range: `bytes=${op.newOffset}-${last}` }, resolved);
      if (res.status !== 206) {
        void res.body?.getReader().cancel?.().catch(() => undefined);
        throw new Error(`the server answered ${res.status} to a range request`);
      }
      const cr = res.headers.get('content-range');
      if (cr && !cr.startsWith(`bytes ${op.newOffset}-${last}/`)) throw new Error('the server answered a different range');
      url = finalUrl;
      resolved = true;
      let got = 0;
      await readBody(res, o.net, async (b) => {
        if (got + b.length > op.length) throw new Error('a range came back longer than asked');
        await out.write(b, 0, b.length, op.newOffset + got);
        got += b.length;
        fetched += b.length;
        o.onProgress?.(fetched, plan.remoteBytes);
      });
      if (got !== op.length) throw new Error('a range came back shorter than asked');
    }
  } finally {
    await old.close();
    await out.close();
  }
  return fetched;
}
