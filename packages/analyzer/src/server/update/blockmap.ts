/**
 * electron-builder block maps and the plan for a differential download.
 *
 * A `<file>.blockmap` is gzip-compressed JSON `{ version: "1"|"2", files: [{ name, offset, checksums[], sizes[] }] }`
 * (builder-util-runtime/blockMapApi). For a mac zip it has one file entry covering the whole zip, split into
 * content-defined chunks; `checksums[i]` is an opaque per-chunk string (compared, never recomputed here) and
 * `sizes[i]` the chunk's byte length. Two chunks with the same checksum and size hold the same bytes, so a chunk
 * of the new zip that the old zip also has can be copied from disk instead of downloaded.
 */

import zlib from 'node:zlib';

export interface BlockMapFile {
  name: string;
  offset: number;
  checksums: string[];
  sizes: number[];
}
export interface BlockMap {
  version: '1' | '2';
  files: BlockMapFile[];
}

/** The largest block map body read from the network, and the largest it may expand to. A real one for a 200 MB zip is well under 2 MiB. */
export const MAX_BLOCKMAP_BYTES = 8 * 1024 * 1024;
export const MAX_BLOCKMAP_JSON = 16 * 1024 * 1024;

/**
 * A block map from its gzip bytes (or plain JSON bytes). Throws on anything that is not a sane one: too large (before or
 * after expanding), a first file that does not start at 0, a non-integer or negative offset or size, or (with
 * `expectedSize`) chunk sizes that do not add up to exactly the file's size.
 */
export function parseBlockMap(raw: Buffer, expectedSize?: number): BlockMap {
  if (raw.length > MAX_BLOCKMAP_BYTES) throw new Error('block map is too large');
  let text: string;
  try {
    text = zlib.gunzipSync(raw, { maxOutputLength: MAX_BLOCKMAP_JSON }).toString('utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new Error('block map is too large once unpacked');
    text = raw.toString('utf8');
  }
  const j = JSON.parse(text) as unknown;
  if (typeof j !== 'object' || j === null) throw new Error('not a block map');
  const o = j as Record<string, unknown>;
  if ((o.version !== '1' && o.version !== '2') || !Array.isArray(o.files) || o.files.length === 0) throw new Error('not a block map');
  const files: BlockMapFile[] = [];
  for (const f of o.files as unknown[]) {
    const r = f as Record<string, unknown>;
    if (
      typeof r?.name !== 'string' ||
      !Number.isSafeInteger(r.offset) ||
      (r.offset as number) < 0 ||
      !Array.isArray(r.checksums) ||
      !Array.isArray(r.sizes) ||
      r.checksums.length !== r.sizes.length ||
      !r.checksums.every((c) => typeof c === 'string') ||
      !r.sizes.every((s) => Number.isSafeInteger(s) && (s as number) > 0)
    ) {
      throw new Error('malformed block map');
    }
    files.push({ name: r.name, offset: r.offset as number, checksums: r.checksums as string[], sizes: r.sizes as number[] });
  }
  if (files[0]!.offset !== 0) throw new Error('block map does not start at offset 0');
  if (expectedSize !== undefined) {
    const sum = files[0]!.sizes.reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(sum) || sum !== expectedSize) throw new Error(`block map covers ${sum} bytes, the file is ${expectedSize}`);
  }
  return { version: o.version, files };
}

/** A block map as the bytes electron-builder would write (used by tests and tools). */
export function encodeBlockMap(m: BlockMap): Buffer {
  return zlib.gzipSync(Buffer.from(JSON.stringify(m), 'utf8'));
}

export interface Chunk {
  checksum: string;
  size: number;
  /** Where the chunk starts in the file it belongs to. */
  offset: number;
}

/** The chunks of the first file entry (a zip's block map has one), in file order. */
export function chunksOf(m: BlockMap): Chunk[] {
  const f = m.files[0]!;
  const out: Chunk[] = [];
  let at = f.offset;
  for (let i = 0; i < f.sizes.length; i++) {
    out.push({ checksum: f.checksums[i]!, size: f.sizes[i]!, offset: at });
    at += f.sizes[i]!;
  }
  return out;
}

export type Op =
  /** Bytes the old file already has: copy [oldOffset, oldOffset+length) to newOffset. */
  | { kind: 'local'; newOffset: number; oldOffset: number; length: number }
  /** Bytes to fetch: HTTP range [newOffset, newOffset+length). */
  | { kind: 'remote'; newOffset: number; length: number };

export interface Plan {
  ops: Op[];
  /** Size of the new file. */
  total: number;
  /** Bytes the ops fetch (including any gap bytes merged in). */
  remoteBytes: number;
  /** Bytes copied from the old file. */
  localBytes: number;
  /** Chunks of the new file that must be fetched (before merging). */
  changedChunks: number;
}

/**
 * The plan to build the new file from the old one. A new chunk is local when the old map has a chunk with the same
 * checksum AND size. Adjacent chunks of the same kind (and, for local ones, contiguous in the old file) become one op.
 * `mergeGap`: a run of local chunks no longer than this between two remote ops is fetched too, so a few
 * neighbouring changes make one request, not several (0 merges only truly adjacent remote chunks).
 */
export function planDiff(oldMap: BlockMap, newMap: BlockMap, mergeGap = 0): Plan {
  const have = new Map<string, Chunk>();
  for (const c of chunksOf(oldMap)) {
    const k = `${c.checksum}:${c.size}`;
    if (!have.has(k)) have.set(k, c);
  }
  const ops: Op[] = [];
  let changedChunks = 0;
  let total = 0;
  for (const c of chunksOf(newMap)) {
    total += c.size;
    const hit = have.get(`${c.checksum}:${c.size}`);
    const last = ops[ops.length - 1];
    if (hit) {
      if (last?.kind === 'local' && last.oldOffset + last.length === hit.offset) last.length += c.size;
      else ops.push({ kind: 'local', newOffset: c.offset, oldOffset: hit.offset, length: c.size });
    } else {
      changedChunks++;
      if (last?.kind === 'remote') last.length += c.size;
      else ops.push({ kind: 'remote', newOffset: c.offset, length: c.size });
    }
  }
  /* Absorb short local runs sitting between two remote ops. */
  if (mergeGap > 0) {
    for (let i = 1; i + 1 < ops.length; i++) {
      const a = ops[i - 1]!;
      const g = ops[i]!;
      const b = ops[i + 1]!;
      if (a.kind === 'remote' && g.kind === 'local' && b.kind === 'remote' && g.length <= mergeGap) {
        a.length += g.length + b.length;
        ops.splice(i, 2);
        i--;
      }
    }
  }
  let remoteBytes = 0;
  let localBytes = 0;
  for (const o of ops) {
    if (o.kind === 'remote') remoteBytes += o.length;
    else localBytes += o.length;
  }
  return { ops, total, remoteBytes, localBytes, changedChunks };
}
