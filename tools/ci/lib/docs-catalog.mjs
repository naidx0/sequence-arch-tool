/**
 * Living-docs catalog helpers shared by docs-catalog.test.mjs and nightly-health.mjs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Same-directory markdown links, first-seen order. */
export function catalogLinks(readmePath) {
  const text = fs.readFileSync(readmePath, 'utf8');
  const linked = [];
  const seen = new Set();
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let href = m[1].split('#')[0].split('?')[0].trim();
    if (href.startsWith('<')) href = href.slice(1, -1);
    href = href.replace(/^\.\//, '');
    if (!href.endsWith('.md')) continue;
    if (href.includes('/')) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    linked.push(href);
  }
  return linked;
}

/**
 * The docs the REPOSITORY has, not the files that happen to be on this disk.
 *
 * This read `readdirSync` and so counted untracked files. A scratch file in
 * `docs/` therefore turned the gate red for whoever wrote it, with only two ways
 * out: commit the scratch file, or add a README row pointing at something no
 * clone contains. Both are worse than the problem.
 *
 * It bit on `docs/lora-phase0-phase1-plan.md` — an untracked file belonging to
 * the owner, which CANON explicitly forbids agents to touch. The gate was
 * pushing every agent that ran it toward doing exactly that, while CI on a clean
 * checkout stayed green, so the failure only ever appeared on the machine of the
 * person who must not act on it.
 *
 * `git ls-files` is the right question: a doc becomes part of the repository
 * when it is added, and THAT is when it must appear in the index. Falls back to
 * the directory listing outside a checkout (a tarball install, a CI archive),
 * where every file present is by definition shipped.
 */
export function mdFiles(dir) {
  const onDisk = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort();

  let tracked;
  try {
    tracked = new Set(
      execFileSync('git', ['ls-files', '--', '*.md'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .map((f) => f.trim())
        // `git ls-files` from inside `dir` still reports paths relative to it,
        // so anything with a slash belongs to a subdirectory, not to this one.
        .filter((f) => f && !f.includes('/')),
    );
  } catch {
    return onDisk; // not a git checkout — everything present is shipped
  }

  // An empty answer means git ran but knows nothing here; trust the disk rather
  // than silently asserting that a docs directory contains no docs.
  if (tracked.size === 0) return onDisk;
  return onDisk.filter((f) => tracked.has(f));
}

/**
 * @returns {{ ok: boolean, missing: string[], extra: string[] }}
 */
export function catalogDiff(readmePath, dir) {
  const linked = catalogLinks(readmePath);
  const files = mdFiles(dir);
  const linkedSet = new Set(linked);
  const missing = files.filter((f) => !linkedSet.has(f));
  const extra = linked.filter((f) => f !== 'README.md' && !files.includes(f));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}
