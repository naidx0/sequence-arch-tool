/**
 * A TABLE THAT STATES A TOTAL MUST ADD UP.
 *
 * Every count that has embarrassed this repository was arithmetic no reader
 * caught: 95 that was 60, eight against a list of seven, four pages beside a
 * directory of eleven, and a result table whose six rows summed to 13 under a
 * bold total of 15. That last one survived a deliberate reconciliation pass —
 * the prose was checked against the table and the table was never added up.
 *
 * Careful reading has failed at this four times. Addition has not been tried.
 *
 * ── WHAT IT CHECKS ───────────────────────────────────────────────────────
 *
 * Any markdown table in `docs/research/` with a row whose first non-empty cell
 * is `total` (in any casing, with or without bold), where the other rows carry
 * integers in the same column. The total column's cells must sum to the stated
 * total.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * It does not guess which column is countable. A column qualifies only when the
 * total row has an integer in it AND every non-total row has an integer or a
 * dash there — so a "0" column of outcomes is checked, and a column of prose is
 * skipped rather than parsed hopefully.
 *
 * It does not check tables without a total row. A table that states no total
 * makes no arithmetic claim, and inventing one to check would fail on every
 * table that legitimately lists things.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const RESEARCH = path.resolve(HERE, '..', '..', 'docs', 'research');

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** `**15**` and `15` both read as 15; `—`, `-` and empty read as absent. */
function asInt(cell) {
  const bare = cell.replace(/\*\*/g, '').replace(/`/g, '').trim();
  if (bare === '' || bare === '—' || bare === '-') return null;
  return /^\d+$/.test(bare) ? Number(bare) : null;
}

const isTotalRow = (row) =>
  row.some((c) => /^\**\s*total\s*\**$/i.test(c.replace(/`/g, '').trim()));

/** Every markdown table in a file, as arrays of cell-arrays. */
function tables(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      (cur ??= []).push(cells(line));
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function mismatches(file, text) {
  const bad = [];
  for (const rows of tables(text)) {
    const totalRow = rows.find(isTotalRow);
    if (!totalRow) continue;
    /*
     * THE HEADER IS NOT A BODY ROW, and including it made this whole check
     * vacuous: `asInt('informative arms')` is null, so every column looked
     * "not countable" and was skipped. The first version passed on every page
     * in the repository while catching nothing — found by the can-fail case
     * below, not by reading the code.
     *
     * Body rows are the ones AFTER the `---` separator, minus the total row.
     */
    const sep = rows.findIndex((r) => r.every((c) => /^:?-{2,}:?$/.test(c)));
    if (sep < 0) continue;
    const body = rows.slice(sep + 1).filter((r) => r !== totalRow);
    for (let col = 0; col < totalRow.length; col += 1) {
      const stated = asInt(totalRow[col] ?? '');
      if (stated === null) continue;
      const values = body.map((r) => asInt(r[col] ?? ''));
      if (values.length === 0) continue;
      /*
       * A TOTAL THIS CHECK CANNOT ADD UP IS NOT A TOTAL IT HAS VERIFIED.
       *
       * This used to `continue` when any body cell failed to parse, and print a
       * green. So one stray dash in a summed column turned the check off for
       * exactly the table it was pointed at, silently — the same shape as the
       * header bug that made the whole checker vacuous, one layer in.
       *
       * The total row here HAS an integer, so the table is making an arithmetic
       * claim. If the rows under it cannot be added, that is reported, not
       * skipped. A column whose TOTAL is not a number is a different case and
       * is skipped above — that table claims nothing.
       */
      const unreadable = values.filter((v) => v === null).length;
      if (unreadable > 0) {
        bad.push(
          `${file}: column ${col} states total ${stated} but ${unreadable} of ${values.length} ` +
            'cells beneath it cannot be read as numbers — the total is unverifiable, not verified',
        );
        continue;
      }
      const sum = values.reduce((a, b) => a + b, 0);
      if (sum !== stated) {
        bad.push(`${file}: column ${col} states total ${stated}, rows sum to ${sum}`);
      }
    }
  }
  return bad;
}

test('every research table that states a total adds up to it', () => {
  const files = fs.readdirSync(RESEARCH).filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 0, 'no research pages found — the check would pass vacuously');
  const bad = [];
  for (const f of files) {
    bad.push(...mismatches(f, fs.readFileSync(path.join(RESEARCH, f), 'utf8')));
  }
  assert.deepEqual(bad, [], `table totals do not match their rows:\n  ${bad.join('\n  ')}`);
});

test('IT CAN FAIL — the exact table that got through, reconstructed', () => {
  /*
   * Six rows summing to 13 under a bold total of 15, as published. If this stops
   * failing, the checker has stopped checking.
   */
  const broken = [
    '| condition | informative arms |',
    '|---|---|',
    '| block absent | 2 |',
    '| tail | 2 |',
    '| before-question | 2 |',
    '| last | 2 |',
    '| pointed | 2 |',
    '| **instruct** | **3** |',
    '| **total** | **15** |',
  ].join('\n');
  const bad = mismatches('reconstructed.md', broken);
  assert.equal(bad.length, 1, 'the published mismatch must be caught');
  assert.match(bad[0], /states total 15, rows sum to 13/);
});

test('it does not fire on a table with no total row', () => {
  const listing = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
  assert.deepEqual(mismatches('x.md', listing), []);
});

test('it skips columns that are not countable rather than parsing them hopefully', () => {
  const prose = [
    '| what | note | n |',
    '|---|---|---|',
    '| one | a sentence | 2 |',
    '| two | another | 3 |',
    '| **total** | — | **5** |',
  ].join('\n');
  assert.deepEqual(mismatches('x.md', prose), [], 'the prose column must not be summed');
});

test('IT CAN FAIL — an unsummable column is reported, not skipped', () => {
  /*
   * The peer lane found this shape in its own checker and I had it too: one
   * unparseable cell under a numeric total turned the check off for exactly the
   * table it was aimed at, and printed a green. Both gates were written the same
   * hour and both were quietly broken; both were caught by a plant rather than
   * by review.
   */
  const dashed = [
    '| condition | arms |',
    '|---|---|',
    '| a | 2 |',
    '| b | — |',
    '| **total** | **5** |',
  ].join('\n');
  const bad = mismatches('dashed.md', dashed);
  assert.equal(bad.length, 1, 'an unsummable column must be reported');
  assert.match(bad[0], /cannot be read as numbers/);
});
