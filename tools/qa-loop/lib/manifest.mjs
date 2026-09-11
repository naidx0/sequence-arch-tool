/**
 * The pinned-SHA repo manifest: load + validate.
 *
 * Validation is deliberately strict about the SHA. A row that cannot say
 * exactly which commit it measured is not a benchmark — it is a moving target
 * that will silently "regress" the day upstream lands a commit. `pin-me` is the
 * one accepted placeholder, and it is REJECTED at run time (run.mjs) rather
 * than quietly resolved to HEAD.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const QA_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(QA_ROOT, '..', '..');
export const MANIFEST_PATH = path.join(QA_ROOT, 'manifest.json');

export const SIZE_CLASSES = new Set(['small', 'medium', 'large']);
export const TIERS = new Set(['smoke', 'full']);
export const SHA_RE = /^[0-9a-f]{40}$/;
export const PIN_PLACEHOLDER = 'pin-me';
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * @param {unknown} raw parsed manifest JSON
 * @param {{repoRoot?: string, checkGroundTruthFiles?: boolean}} [opts]
 * @returns {string[]} problems; empty means valid
 */
export function validateManifest(raw, opts = {}) {
  const problems = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['manifest is not an object'];
  }
  if (typeof raw.version !== 'number') problems.push('manifest.version must be a number');
  if (!Array.isArray(raw.repos)) return [...problems, 'manifest.repos must be an array'];

  const seenIds = new Set();
  raw.repos.forEach((row, i) => {
    const at = `repos[${i}]`;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      problems.push(`${at} is not an object`);
      return;
    }
    const name = typeof row.id === 'string' ? row.id : at;
    if (typeof row.id !== 'string' || !ID_RE.test(row.id)) {
      problems.push(`${at}.id must match ${ID_RE} (got ${JSON.stringify(row.id)})`);
    } else if (seenIds.has(row.id)) {
      problems.push(`${at}.id duplicate: ${row.id}`);
    } else {
      seenIds.add(row.id);
    }
    for (const field of ['org', 'repo', 'license', 'shape']) {
      if (typeof row[field] !== 'string' || row[field].trim() === '') {
        problems.push(`${name}.${field} must be a non-empty string`);
      }
    }
    if (typeof row.sha !== 'string' || !(SHA_RE.test(row.sha) || row.sha === PIN_PLACEHOLDER)) {
      problems.push(`${name}.sha must be a 40-char lowercase hex commit or "${PIN_PLACEHOLDER}"`);
    }
    if (!Array.isArray(row.langs) || row.langs.length === 0 || row.langs.some((l) => typeof l !== 'string')) {
      problems.push(`${name}.langs must be a non-empty string[]`);
    }
    if (!SIZE_CLASSES.has(row.sizeClass)) {
      problems.push(`${name}.sizeClass must be one of ${[...SIZE_CLASSES].join('|')}`);
    }
    if (!Array.isArray(row.tiers) || row.tiers.length === 0 || row.tiers.some((t) => !TIERS.has(t))) {
      problems.push(`${name}.tiers must be a non-empty subset of ${[...TIERS].join('|')}`);
    } else if (!row.tiers.includes('full')) {
      problems.push(`${name}.tiers must include "full" — the full tier is the whole manifest`);
    }
    if (row.groundTruth !== undefined) {
      if (typeof row.groundTruth !== 'string' || row.groundTruth.trim() === '') {
        problems.push(`${name}.groundTruth must be a repo-relative path when present`);
      } else if (opts.checkGroundTruthFiles) {
        const abs = path.resolve(opts.repoRoot ?? REPO_ROOT, row.groundTruth);
        if (!fs.existsSync(abs)) problems.push(`${name}.groundTruth file not found: ${row.groundTruth}`);
      }
    }
    if (row.negativeCase !== undefined && typeof row.negativeCase !== 'boolean') {
      problems.push(`${name}.negativeCase must be a boolean when present`);
    }
    if (row.negativeCase === true && (typeof row.why !== 'string' || row.why.trim() === '')) {
      problems.push(`${name}.why is required when negativeCase is true — say what it is a negative case FOR`);
    }
    if (row.note !== undefined && typeof row.note !== 'string') {
      problems.push(`${name}.note must be a string when present`);
    }
  });
  return problems;
}

/**
 * Load + validate the manifest, throwing an honest error listing every problem
 * rather than a stack from the first bad field.
 * @param {string} [file]
 */
export function loadManifest(file = MANIFEST_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = validateManifest(raw, { checkGroundTruthFiles: true });
  if (problems.length > 0) {
    throw new Error(`invalid manifest ${file}:\n  - ${problems.join('\n  - ')}`);
  }
  return raw;
}

/**
 * @param {{repos: any[]}} manifest
 * @param {{tier?: string, repos?: string[]}} sel
 */
export function selectRepos(manifest, sel = {}) {
  let rows = manifest.repos;
  if (sel.tier) {
    if (!TIERS.has(sel.tier)) throw new Error(`unknown tier "${sel.tier}" — expected ${[...TIERS].join('|')}`);
    rows = rows.filter((r) => r.tiers.includes(sel.tier));
  }
  if (sel.repos && sel.repos.length > 0) {
    const want = new Set(sel.repos);
    const known = new Set(manifest.repos.map((r) => r.id));
    const missing = [...want].filter((id) => !known.has(id));
    if (missing.length > 0) throw new Error(`unknown repo id(s): ${missing.join(', ')}`);
    rows = manifest.repos.filter((r) => want.has(r.id));
  }
  return rows;
}

/** `https://github.com/<org>/<repo>.git` — the only clone URL shape we use. */
export function cloneUrl(row) {
  return `https://github.com/${row.org}/${row.repo}.git`;
}
