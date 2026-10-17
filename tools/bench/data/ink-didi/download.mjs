#!/usr/bin/env node
/* Fetch and verify the DiDi fresh-sealed slice for bench:ink.
 *   node tools/bench/data/ink-didi/download.mjs [--cache DIR] [--check] [--strict]
 * Pins and hashes are in manifest.json. Cache: --cache, else $SEQUENCE_BENCH_CACHE/ink-didi,
 * else <tmpdir>/sequence-bench-heldout/ink-didi. Idempotent; a hash mismatch throws.
 * --check verifies the manifest (prompts.json and the labeller against their pins) and any cached
 * files, downloads nothing; --strict also fails if the cache is empty. Download size: ~222 MB
 * (one Range request) plus 501 xdot files of under 2 KB each. Network is needed only to download. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../../..');
export const loadManifest = () => JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
export const loadPrompts = () => JSON.parse(fs.readFileSync(path.join(HERE, 'prompts.json'), 'utf8'));
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const inkCache = (argv = process.argv) => {
  const i = argv.indexOf('--cache');
  return path.resolve(i >= 0 ? argv[i + 1] : path.join(process.env.SEQUENCE_BENCH_CACHE || path.join(os.tmpdir(), 'sequence-bench-heldout'), 'ink-didi'));
};
const must = (got, want, what) => { if (got !== want) throw new Error(`HASH MISMATCH ${what}: got ${got}, pinned ${want}`); };
const lfHash = (file) => sha256(Buffer.from(fs.readFileSync(file).filter((c) => c !== 13)));

/** Complete test-split lines of the raw slice (the partial first line is dropped), as bench:ink labels them. */
export function testDrawings(raw, m = loadManifest()) {
  const rest = raw.subarray(raw.indexOf(10) + 1).toString('utf8').split('\n').filter(Boolean);
  const lines = rest.filter((l) => JSON.parse(l).split === m.testDrawings.split);
  return { lines, text: lines.join('\n') + '\n' };
}

export function verifyStatic(m = loadManifest()) {
  must(lfHash(path.join(HERE, 'prompts.json')), m.prompts.sha256, 'prompts.json'); // CR-insensitive: a CRLF checkout hashes the same
  must(lfHash(path.join(ROOT, m.labeller.file)), m.labeller.sha256LF, m.labeller.file);
  const n = Object.keys(loadPrompts()).length;
  if (n !== m.prompts.count) throw new Error(`prompts.json has ${n} entries, expected ${m.prompts.count}`);
}

const range = async (url, a, b) => {
  const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } });
  if (r.status !== 206) throw new Error(`GET ${url} bytes ${a}-${b}: HTTP ${r.status} (expected 206)`);
  return Buffer.from(await r.arrayBuffer());
};

export async function ensureInk(cache, { log = console.log } = {}) {
  const m = loadManifest();
  verifyStatic(m);
  const prompts = loadPrompts();
  const xdotDir = path.join(cache, 'xdot');
  const drawings = path.join(cache, 'test-drawings.ndjson');
  const slice = path.join(cache, 'slice.bin');
  fs.mkdirSync(xdotDir, { recursive: true });
  if (!fs.existsSync(drawings) || sha256(fs.readFileSync(drawings)) !== m.testDrawings.sha256) {
    let raw = fs.existsSync(slice) ? fs.readFileSync(slice) : null;
    if (!raw || sha256(raw) !== m.source.rawSliceSha256) {
      log(`downloading ${m.source.ndjson} bytes ${m.source.rangeStart}-${m.source.rangeEnd} (~222 MB)`);
      raw = await range(`${m.source.base}/${m.source.ndjson}`, m.source.rangeStart, m.source.rangeEnd);
      must(sha256(raw), m.source.rawSliceSha256, 'raw slice');
      fs.writeFileSync(slice, raw);
    }
    const t = testDrawings(raw, m);
    if (t.lines.length !== m.testDrawings.count) throw new Error(`test drawings ${t.lines.length}, pinned ${m.testDrawings.count}`);
    must(sha256(Buffer.from(t.text)), m.testDrawings.sha256, 'test drawings');
    fs.writeFileSync(drawings, t.text);
  }
  const ids = Object.keys(prompts);
  const need = ids.filter((id) => { const f = path.join(xdotDir, `${id}.xdot`); return !fs.existsSync(f) || sha256(fs.readFileSync(f)) !== prompts[id].xdotSha256; });
  if (need.length) log(`downloading ${need.length} prompt xdot files`);
  for (let i = 0; i < need.length; i += 8) {
    await Promise.all(need.slice(i, i + 8).map(async (id) => {
      const url = `${m.source.base}/xdot/${id}.xdot`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`GET ${url}: HTTP ${r.status}`);
      const b = Buffer.from(await r.arrayBuffer());
      must(sha256(b), prompts[id].xdotSha256, `xdot/${id}.xdot`);
      fs.writeFileSync(path.join(xdotDir, `${id}.xdot`), b);
    }));
  }
  const pngSize = path.join(cache, 'pngsize.json');
  fs.writeFileSync(pngSize, JSON.stringify(Object.fromEntries(ids.map((id) => [id, prompts[id].png]))));
  return { drawings, xdotDir, pngSize, cache };
}

/** Verify whatever is cached without downloading. ok: true pass, false mismatch, null nothing cached. */
export function checkCache(cache, m = loadManifest()) {
  const out = [];
  const drawings = path.join(cache, 'test-drawings.ndjson');
  if (!fs.existsSync(drawings)) { out.push({ ok: null, what: `cache empty at ${cache}` }); return out; }
  out.push(sha256(fs.readFileSync(drawings)) === m.testDrawings.sha256 ? { ok: true, what: 'test-drawings.ndjson' } : { ok: false, what: 'test-drawings.ndjson hash differs from pin' });
  const prompts = loadPrompts();
  let bad = 0; let have = 0;
  for (const [id, p] of Object.entries(prompts)) {
    const f = path.join(cache, 'xdot', `${id}.xdot`);
    if (!fs.existsSync(f)) continue;
    have++;
    if (sha256(fs.readFileSync(f)) !== p.xdotSha256) bad++;
  }
  out.push({ ok: bad === 0, what: `xdot ${have}/${Object.keys(prompts).length} cached, ${bad} mismatched` });
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cache = inkCache();
  if (process.argv.includes('--check')) {
    const m = loadManifest();
    verifyStatic(m);
    console.log(`manifest ok: prompts.json (${m.prompts.count} entries) and labeller match their pins`);
    const res = checkCache(cache, m);
    for (const r of res) console.log(`${r.ok === true ? 'ok  ' : r.ok === null ? 'note' : 'FAIL'} ${r.what}`);
    if (res.some((r) => r.ok === false)) process.exit(1);
    if (process.argv.includes('--strict') && res.some((r) => r.ok === null)) process.exit(1);
  } else {
    const r = await ensureInk(cache);
    console.log(`ok ${r.drawings}`);
  }
}
