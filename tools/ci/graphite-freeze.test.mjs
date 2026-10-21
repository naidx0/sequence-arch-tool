/**
 * A sheet cannot change without a numbered decision.
 *
 * WHAT THIS REPLACED. The book used to exist twice — `docs/brand/graphite/` and
 * a byte-identical `docs/brand/graphite/` — and this file asserted the two
 * copies matched. The reason was real, and is quoted in GRAPHITE-DECISIONS.md:
 * five books in seventeen days, and work finished against a sheet must not be
 * silently retargeted by a later edit to that sheet.
 *
 * That is a guarantee about CHANGE. A second copy was one way to buy it, at the
 * price of doubling every byte of the book and making a new sheet a two-place
 * edit. Owner ruling 2026-08-21 (Decision 3): one copy.
 *
 * So the guarantee moves onto the thing it was always about. A commit that
 * edits the substrate or any sheet must also edit GRAPHITE-DECISIONS.md, which
 * is where a ruling gets an author, a date, a quote and a scope. Editing a
 * sheet quietly is what this forbids — the same failure as before, caught at
 * the same moment, without the duplicate.
 *
 * Same base-resolution shape as merge-lanes.test.mjs: compares against
 * origin/main, and skips rather than failing when there is nothing to compare
 * (a shallow clone with no origin/main and no GRAPHITE_BASE).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BOOK = path.join(ROOT, 'docs/brand/graphite');
const DECISIONS = 'docs/brand/GRAPHITE-DECISIONS.md';

const SHEET = /^docs\/brand\/graphite\/(_core\.html|pages\/.+\.html)$/;

function resolveBase() {
  if (process.env.GRAPHITE_BASE) return process.env.GRAPHITE_BASE;
  try {
    execSync('git rev-parse --verify origin/main', { stdio: 'pipe', cwd: ROOT });
    return 'origin/main';
  } catch {
    return null;
  }
}

function parseNameStatus(diff) {
  return diff
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawStatus, ...paths] = line.split('\t');
      const status = rawStatus[0];
      return { status, files: status === 'R' ? paths : [paths[paths.length - 1]] };
    });
}

function sheetsRequiringDecision(changed) {
  return changed
    .flatMap((entry) => {
      if (entry.status === 'M' || entry.status === 'D') return entry.files;
      // A rename is a deletion at the source plus an addition at the destination.
      // Additions are free under Decision 3; only the removed source can retarget
      // existing work, including when the destination is outside the book.
      if (entry.status === 'R') return entry.files.slice(0, 1);
      return [];
    })
    .filter((file) => SHEET.test(file));
}

test('the book is a single copy — the v1 duplicate is gone', () => {
  assert.ok(fs.existsSync(BOOK), 'docs/brand/graphite/ is missing');
  assert.ok(
    fs.existsSync(path.join(BOOK, '_core.html')),
    'the substrate _core.html is missing from the book',
  );
  assert.ok(
    !fs.existsSync(path.join(BOOK, 'v1')),
    'docs/brand/graphite/ is back. Decision 3 is one copy of the sheets — ' +
      'a second copy is not a freeze, it is a thing to keep in sync.',
  );
});

test('the book still carries a substrate and at least the twelve original sheets', () => {
  const pages = fs
    .readdirSync(path.join(BOOK, 'pages'))
    .filter((f) => f.endsWith('.html'))
    .sort();
  assert.ok(
    pages.length >= 12,
    `the book has ${pages.length} sheets; it shipped with 12 and sheets are not removed silently`,
  );
  // Filename order IS sheet order (tools/assemble.mjs splices in sorted order),
  // so a sheet that does not lead with its number would silently reorder the book.
  for (const f of pages) {
    assert.match(f, /^\d\d-/, `sheet "${f}" does not lead with its number — assemble.mjs sorts by filename`);
  }
});

test('renaming a sheet out of the book still requires a decision', () => {
  const source = 'docs/brand/graphite/pages/13-new-sheet.html';
  const changed = parseNameStatus(`R100\t${source}\tdocs/brand/retired/13-new-sheet.html\r\n`);

  assert.deepEqual(sheetsRequiringDecision(changed), [source]);
});

test('a sheet edit carries a decisions entry', () => {
  const base = resolveBase();
  if (!base) return; // nothing to diff against — see the header

  let changed;
  try {
    changed = parseNameStatus(execSync(`git diff --name-status ${base}...HEAD`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
    }));
  } catch (err) {
    assert.fail(`git diff ${base}...HEAD failed: ${err.message}`);
  }

  // ADDING a sheet is not the risk. The guarantee is that finished work cannot be
  // retargeted by a sheet MOVING underneath it, and a new file cannot do that —
  // nothing cites it yet. The standing scope note in GRAPHITE-DECISIONS.md
  // explicitly invites extension. So M(odified), D(eleted), and the deleted source
  // side of R(enamed) need a ruling; A(dded) and a rename destination are free.
  const sheets = sheetsRequiringDecision(changed);
  if (!sheets.length) return;

  assert.ok(
    changed.some((entry) => entry.files.includes(DECISIONS)),
    `This commit edits the book:\n  ${sheets.join('\n  ')}\n\n` +
      `but does not touch ${DECISIONS}. Editing or removing a sheet is an owner ruling —\n` +
      'record it there\n' +
      'as the next "## Decision N", with the quote and what it binds, in the SAME change.\n' +
      'That is the whole guarantee now that the book is a single copy (Decision 3).',
  );
});
