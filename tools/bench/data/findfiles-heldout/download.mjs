#!/usr/bin/env node
/* Re-clone the pinned held-out repos for bench:findfiles / bench:closure.
 *   node tools/bench/data/findfiles-heldout/download.mjs [--cache DIR] [--only id,id]
 * Full history (no --depth, no blob filter): the bench replays the tree at each sampled commit's parent and
 * the ranker reads up to 3,000 commits of history, so a shallow or blobless clone would change the answer.
 * Cache: --cache, else $SEQUENCE_BENCH_CACHE, else <tmpdir>/sequence-bench-heldout. Idempotent. Needs only
 * git over https; the github.com web UI and API are not used. */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const heldoutCache = (argv = process.argv) => {
  const i = argv.indexOf('--cache');
  return path.resolve(i >= 0 ? argv[i + 1] : process.env.SEQUENCE_BENCH_CACHE || path.join(os.tmpdir(), 'sequence-bench-heldout'));
};
/** sha256 of bytes with CR removed: the sealed sets are LF in git, and a Windows autocrlf checkout turns them into CRLF. */
export const lfSha256 = (buf) => crypto.createHash('sha256').update(Buffer.from(buf).filter((c) => c !== 13)).digest('hex');
/** The sealed question sets against their committed sha256 files (v2 is current, v1 is kept for history). */
export function verifySealed() {
  return [['questions.json', 'questions.sha256'], ['questions.v1.json', 'questions.v1.sha256']].map(([f, s]) => {
    const got = lfSha256(fs.readFileSync(path.join(HERE, f)));
    const want = fs.readFileSync(path.join(HERE, s), 'utf8').split(/\s+/)[0];
    return { file: f, got, want, ok: got === want };
  });
}
export const loadRepos = () => JSON.parse(fs.readFileSync(path.join(HERE, 'repos.json'), 'utf8')).repos;

export function ensureClone(repo, cache) {
  const dir = path.join(cache, repo.id);
  const run = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(cache, { recursive: true });
    execFileSync('git', ['clone', '--quiet', '--no-tags', repo.url, dir], { stdio: 'inherit' });
  }
  try { run('cat-file', '-e', `${repo.sha}^{commit}`); } catch {
    run('fetch', '--quiet', '--no-tags', 'origin', repo.sha);
  }
  run('cat-file', '-e', `${repo.sha}^{commit}`);
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    /* Verify without cloning or fetching: sealed sets against their hashes, repos.json pins well-formed, and any
     * clone already in the cache holds its pinned commit. A missing clone is a note (--strict makes it a failure). */
    const strict = process.argv.includes('--strict');
    let bad = 0;
    for (const v of verifySealed()) { console.log(`${v.ok ? 'ok  ' : 'FAIL'} ${v.file} sha256 ${v.got}${v.ok ? '' : ` != pinned ${v.want}`}`); if (!v.ok) bad++; }
    const cache = heldoutCache();
    for (const r of loadRepos()) {
      if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(r.url) || !/^[0-9a-f]{40}$/.test(r.sha)) { console.log(`FAIL ${r.id}: url or sha pin malformed`); bad++; continue; }
      const dir = path.join(cache, r.id);
      if (!fs.existsSync(path.join(dir, '.git'))) { console.log(`${strict ? 'FAIL' : 'note'} ${r.id} ${r.sha.slice(0, 10)} not cloned in ${cache}`); if (strict) bad++; continue; }
      try { execFileSync('git', ['-C', dir, 'cat-file', '-e', `${r.sha}^{commit}`], { stdio: 'ignore' }); console.log(`ok   ${r.id} ${r.sha.slice(0, 10)} present`); } catch { console.log(`FAIL ${r.id} ${r.sha.slice(0, 10)} missing from clone`); bad++; }
    }
    process.exit(bad ? 1 : 0);
  }
  const cache = heldoutCache();
  const oi = process.argv.indexOf('--only');
  const only = oi >= 0 ? new Set(process.argv[oi + 1].split(',')) : null;
  for (const r of loadRepos()) {
    if (only && !only.has(r.id)) continue;
    const dir = ensureClone(r, cache);
    const n = execFileSync('git', ['-C', dir, 'rev-list', '--count', '--first-parent', r.sha], { encoding: 'utf8' }).trim();
    console.log(`${r.id} ${r.sha.slice(0, 10)} first-parent commits=${n} -> ${dir}`);
  }
}
