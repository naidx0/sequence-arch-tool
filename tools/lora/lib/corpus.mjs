/**
 * The corpus: which repos, where they live on disk, and which side of the
 * train / held-out line each one is on.
 *
 * WHAT WE COPIED FROM qa-loop, AND WHY WE COPIED IT.
 * `tools/qa-loop/**` is owned by another workstream and was rewritten to
 * per-repo child processes mid-round. This pipeline therefore reads
 * `tools/qa-loop/manifest.json` as *data* and re-implements the two small
 * things it needs from `tools/qa-loop/lib/` rather than importing them:
 *
 *   1. `cloneUrl(row)`   — one line, `https://github.com/<org>/<repo>.git`;
 *   2. `ensureRepoAtSha` — the shallow pinned-SHA fetch from
 *      `tools/qa-loop/lib/clone.mjs`, reduced to what a dataset build needs.
 *
 * Both are deliberate duplicates of ~40 lines, taken so that a refactor next
 * door cannot silently change which commit our training data came from. The
 * cache location convention is shared on purpose (`SEQUENCE_QA_CACHE`, else
 * `<tmp>/sequence-qa-cache`) so a repo cloned by either tool serves both.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { QA_MANIFEST_PATH, SPLITS_PATH, REPO_ROOT, corpusCacheRoot } from './paths.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

/** `https://github.com/<org>/<repo>.git` — copied from qa-loop/lib/manifest.mjs. */
export function cloneUrl(row) {
  return `https://github.com/${row.org}/${row.repo}.git`;
}

/** Read the QA manifest as data. Never imports qa-loop code. */
export function loadManifest(file = QA_MANIFEST_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || !Array.isArray(raw.repos) || raw.repos.length === 0) {
    throw new Error(`${file}: expected { repos: [...] }`);
  }
  return raw;
}

export function loadSplits(file = SPLITS_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The one check that keeps the eval number meaningful.
 *
 * Fails loudly — and BEFORE anything is scanned or generated — when:
 *   - a repo appears on both sides, or on neither;
 *   - a split names a repo the manifest does not have;
 *   - a hand-ground-truthed row (`groundTruth` in the manifest) is on the
 *     training side. §5 reserves those four for the eval set specifically.
 *
 * @returns {{train: object[], heldOut: object[]}} manifest rows, not ids
 */
export function resolveSplits(manifest, splits) {
  const byId = new Map(manifest.repos.map((r) => [r.id, r]));
  const problems = [];

  const train = splits.train ?? [];
  const heldOut = splits.heldOut ?? [];
  const seen = new Map();
  for (const [side, ids] of [
    ['train', train],
    ['heldOut', heldOut],
  ]) {
    for (const id of ids) {
      if (!byId.has(id)) problems.push(`splits.${side} names "${id}", which is not in the manifest`);
      const prior = seen.get(id);
      if (prior) problems.push(`"${id}" appears in both splits.${prior} and splits.${side}`);
      else seen.set(id, side);
    }
  }
  for (const row of manifest.repos) {
    if (!seen.has(row.id)) {
      problems.push(
        `manifest row "${row.id}" is in neither split — every repo must be deliberately placed ` +
          `(add it to tools/lora/splits.json, on the side you mean)`
      );
    }
    if (row.groundTruth && seen.get(row.id) === 'train') {
      problems.push(
        `"${row.id}" carries ground truth (${row.groundTruth}) but sits in splits.train — ` +
          `the four hand-verified repos are reserved for the eval set (guide §5)`
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`tools/lora/splits.json is not a valid split:\n  - ${problems.join('\n  - ')}`);
  }
  return {
    train: train.map((id) => byId.get(id)),
    heldOut: heldOut.map((id) => byId.get(id)),
  };
}

/** Ground-truthed manifest rows, by id. Used by the leak assertion in the tests. */
export function groundTruthIds(manifest) {
  return manifest.repos.filter((r) => r.groundTruth).map((r) => r.id);
}

/** Where a corpus repo is checked out. Same cache as qa-loop, by design. */
export function repoDir(row, cacheRoot = corpusCacheRoot()) {
  return path.join(cacheRoot, row.id);
}

function git(args, cwd, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      }
    );
  });
}

/**
 * Shallow-fetch `row.sha` into the shared cache. Reduced from
 * `tools/qa-loop/lib/clone.mjs`; like that one it NEVER falls back to HEAD,
 * because a dataset built from a commit nobody pinned is a dataset nobody can
 * reproduce.
 *
 * Called only from `run.mjs`. No test touches the network.
 */
export async function ensureRepoAtSha(row, cacheRoot = corpusCacheRoot()) {
  const dir = repoDir(row, cacheRoot);
  if (!SHA_RE.test(row.sha)) {
    return { ok: false, dir, reason: `manifest row "${row.id}" has no pinned 40-char sha (${row.sha})` };
  }
  const head = fs.existsSync(path.join(dir, '.git'))
    ? (await git(['rev-parse', 'HEAD'], dir, 60_000)).stdout.trim()
    : null;
  if (head === row.sha) return { ok: true, dir, cached: true };

  fs.mkdirSync(dir, { recursive: true });
  const init = await git(['init', '-q'], dir);
  if (init.code !== 0) return { ok: false, dir, reason: `git init failed: ${init.stderr.trim()}` };
  const url = cloneUrl(row);
  const add = await git(['remote', 'add', 'origin', url], dir);
  if (add.code !== 0) {
    const setUrl = await git(['remote', 'set-url', 'origin', url], dir);
    if (setUrl.code !== 0) return { ok: false, dir, reason: `git remote setup failed: ${setUrl.stderr.trim()}` };
  }
  const fetch = await git(['fetch', '--depth', '1', 'origin', row.sha], dir);
  if (fetch.code !== 0) return { ok: false, dir, reason: `shallow fetch of ${row.sha} failed:\n${fetch.stderr.trim()}` };
  const co = await git(['checkout', '-q', '--detach', 'FETCH_HEAD'], dir);
  if (co.code !== 0) return { ok: false, dir, reason: `checkout FETCH_HEAD failed:\n${co.stderr.trim()}` };
  return { ok: true, dir, cached: false };
}

/** For error messages that should be readable from anywhere. */
export function rel(p) {
  return path.relative(REPO_ROOT, p);
}
