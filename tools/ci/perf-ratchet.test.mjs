import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { agreedBootReads, checkRaises, checkRatchet, previousRatchet, RATCHET_FILE } from './perf-ratchet.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const R = { bootJsBytes: { ceiling: 100 }, commitsPerKeystroke: { ceiling: 1 } };

test('equal to every ceiling passes', () => {
  const r = checkRatchet(R, { bootJsBytes: 100, commitsPerKeystroke: 1 });
  assert.equal(r.ok, true);
});

test('a count above its ceiling fails and says by how much', () => {
  const r = checkRatchet(R, { bootJsBytes: 130, commitsPerKeystroke: 1 });
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /FAIL  bootJsBytes: 130 is above its ceiling 100 \(\+30\)/);
});

test('a count below its ceiling, from 3 agreeing reads, fails and names the new ceiling', () => {
  const r = checkRatchet(R, { $reads: 3, bootJsBytes: 90, commitsPerKeystroke: 1 });
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /LOWER bootJsBytes: 90 is below its ceiling 100; set "ceiling": 90/);
  assert.doesNotMatch(r.lines.join('\n'), /note  \$reads/, '$reads is bookkeeping, not a count');
});

test('a low count from fewer than 3 reads never suggests a lower ceiling', () => {
  for (const measured of [{ bootJsBytes: 90, commitsPerKeystroke: 1 }, { $reads: 1, bootJsBytes: 90, commitsPerKeystroke: 1 }]) {
    const r = checkRatchet(R, measured);
    assert.equal(r.ok, false);
    const out = r.lines.join('\n');
    assert.doesNotMatch(out, /LOWER|set "ceiling"/);
    assert.match(out, /BELOW bootJsBytes: 90 is below its ceiling 100 from 1 read\(s\); do not lower on this/);
  }
});

test('boot reads must be 3 and identical before they count', () => {
  const a = { bootJsBytes: 2464265, bootModules: 4, bootRequests: 26 };
  assert.equal(agreedBootReads([a, a, a]).ok, true);
  assert.equal(agreedBootReads([a, a]).ok, false, 'two reads are not enough');
  /* The real flake: one read closed before the ELK chunk was requested. */
  assert.equal(agreedBootReads([a, { bootJsBytes: 1024540, bootModules: 1, bootRequests: 24 }, a]).ok, false);
});

test('a count nobody measured fails rather than passing silently', () => {
  const r = checkRatchet(R, { bootJsBytes: 100 });
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /commitsPerKeystroke: not measured/);
});

test('the checked-in ratchet holds the five counts, each with a numeric ceiling', () => {
  const ratchet = JSON.parse(fs.readFileSync(RATCHET_FILE, 'utf8'));
  const keys = Object.keys(ratchet).filter((k) => !k.startsWith('$')).sort();
  assert.deepEqual(keys, ['bootJsBytes', 'bootModules', 'bootRequests', 'commitsPerKeystroke', 'commitsPerStreamChunk']);
  for (const k of keys) assert.equal(typeof ratchet[k].ceiling, 'number', k);
});

test('the CLI exits by the verdict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-ratchet-'));
  try {
    const rat = path.join(dir, 'r.json');
    const up = path.join(dir, 'up.json');
    const eq = path.join(dir, 'eq.json');
    fs.writeFileSync(rat, JSON.stringify(R));
    fs.writeFileSync(up, JSON.stringify({ bootJsBytes: 101, commitsPerKeystroke: 1 }));
    fs.writeFileSync(eq, JSON.stringify({ bootJsBytes: 100, commitsPerKeystroke: 1 }));
    const cli = path.join(here, 'perf-ratchet.mjs');
    assert.equal(spawnSync(process.execPath, [cli, up, '--ratchet', rat]).status, 1);
    assert.equal(spawnSync(process.execPath, [cli, eq, '--ratchet', rat, '--previous', rat]).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ── a ceiling may go up only with a $raised note ─────────────────────── */

const PREV = { bootJsBytes: { ceiling: 100 } };
const note = (o = {}) => ({ date: '2026-10-06', from: 100, to: 120, bytes: 20, reason: 'S5 shortcuts work from the first frame', ...o });

test('a silent raise (no $raised note) fails', () => {
  const r = checkRaises({ bootJsBytes: { ceiling: 120 } }, PREV);
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /FAIL  bootJsBytes: ceiling raised 100 -> 120 with no \$raised note/);
});

test('a raise with a note naming from, to, bytes, date and reason passes, and is printed', () => {
  const r = checkRaises({ bootJsBytes: { ceiling: 120, $raised: note() } }, PREV);
  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.match(r.lines.join('\n'), /raise bootJsBytes: 100 -> 120 on 2026-10-06/);
});

test('a note that does not describe this raise fails: wrong from, wrong to, wrong bytes, no reason, no date', () => {
  for (const bad of [note({ from: 90, bytes: 30 }), note({ to: 110, bytes: 10 }), note({ bytes: 5 }), note({ reason: ' ' }), note({ date: 'today' })]) {
    const r = checkRaises({ bootJsBytes: { ceiling: 120, $raised: bad } }, PREV);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test('an old note does not cover a new raise: the date must be newer than the previous raise', () => {
  const prev = { bootJsBytes: { ceiling: 120, $raised: note() } };
  const stale = checkRaises({ bootJsBytes: { ceiling: 130, $raised: note({ from: 120, to: 130, bytes: 10 }) } }, prev);
  assert.equal(stale.ok, false);
  assert.match(stale.lines.join('\n'), /not newer than the previous raise/);
  const fresh = checkRaises({ bootJsBytes: { ceiling: 130, $raised: note({ date: '2026-10-07', from: 120, to: 130, bytes: 10 }) } }, prev);
  assert.equal(fresh.ok, true, fresh.lines.join('\n'));
  /* Raised past its note with the note left alone: still a silent raise. */
  assert.equal(checkRaises({ bootJsBytes: { ceiling: 130, $raised: note() } }, prev).ok, false);
});

test('two raises on one day are ordered by `at` (a full ISO timestamp): later passes, the same instant fails, an earlier one fails', () => {
  const prev = { bootJsBytes: { ceiling: 120, $raised: note({ at: '2026-10-06T08:10:00Z' }) } };
  const next = (at) => checkRaises({ bootJsBytes: { ceiling: 130, $raised: note({ at, from: 120, to: 130, bytes: 10 }) } }, prev);
  assert.equal(next('2026-10-06T09:00:00Z').ok, true, next('2026-10-06T09:00:00Z').lines.join('\n'));
  const same = next('2026-10-06T08:10:00Z');
  assert.equal(same.ok, false);
  assert.match(same.lines.join('\n'), /is dated 2026-10-06T08:10:00Z, not newer than the previous raise \(2026-10-06T08:10:00Z\)/);
  assert.equal(next('2026-10-06T07:59:59Z').ok, false);
  /* The same instant written in another zone is the same instant. */
  assert.equal(next('2026-10-06T10:10:00+02:00').ok, false);
});

test('a legacy note with only a date counts as that date at 00:00Z', () => {
  const legacy = { bootJsBytes: { ceiling: 120, $raised: note() } };
  const at = (a) => checkRaises({ bootJsBytes: { ceiling: 130, $raised: note({ at: a, from: 120, to: 130, bytes: 10 }) } }, legacy).ok;
  assert.equal(at('2026-10-06T00:00:01Z'), true, 'later that day');
  assert.equal(at('2026-10-06T00:00:00Z'), false, 'midnight itself is not newer');
  /* A date-only note after a timestamped one: its midnight is before 08:10. */
  const stamped = { bootJsBytes: { ceiling: 120, $raised: note({ at: '2026-10-06T08:10:00Z' }) } };
  assert.equal(checkRaises({ bootJsBytes: { ceiling: 130, $raised: note({ from: 120, to: 130, bytes: 10 }) } }, stamped).ok, false);
});

test('an `at` must be a full ISO timestamp with a zone, on the note\'s own date', () => {
  for (const at of ['2026-10-06', '2026-10-06T08:10:00', 'tomorrow', '2026-10-07T01:00:00Z']) {
    const r = checkRaises({ bootJsBytes: { ceiling: 120, $raised: note({ at }) } }, PREV);
    assert.equal(r.ok, false, at);
  }
  assert.equal(checkRaises({ bootJsBytes: { ceiling: 120, $raised: note({ at: '2026-10-06T23:30:00Z' }) } }, PREV).ok, true);
});

test('lowering a raised ceiling later keeps its note as history; an unchanged ceiling passes', () => {
  assert.equal(checkRaises({ bootJsBytes: { ceiling: 110, $raised: note() } }, { bootJsBytes: { ceiling: 120, $raised: note() } }).ok, true);
  assert.equal(checkRaises({ bootJsBytes: { ceiling: 100 } }, PREV).ok, true);
});

test('the CLI fails a silent raise against --previous, and passes the same raise with its note', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-ratchet-raise-'));
  try {
    const prev = path.join(dir, 'prev.json');
    const silent = path.join(dir, 'silent.json');
    const noted = path.join(dir, 'noted.json');
    const measured = path.join(dir, 'm.json');
    fs.writeFileSync(prev, JSON.stringify(PREV));
    fs.writeFileSync(silent, JSON.stringify({ bootJsBytes: { ceiling: 120 } }));
    fs.writeFileSync(noted, JSON.stringify({ bootJsBytes: { ceiling: 120, $raised: note() } }));
    fs.writeFileSync(measured, JSON.stringify({ bootJsBytes: 120 }));
    const cli = path.join(here, 'perf-ratchet.mjs');
    assert.equal(spawnSync(process.execPath, [cli, measured, '--ratchet', silent, '--previous', prev]).status, 1);
    assert.equal(spawnSync(process.execPath, [cli, measured, '--ratchet', noted, '--previous', prev]).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the checked-in ratchet passes its own raise rule against the previous committed version', () => {
  const ratchet = JSON.parse(fs.readFileSync(RATCHET_FILE, 'utf8'));
  const r = checkRaises(ratchet, previousRatchet());
  assert.equal(r.ok, true, r.lines.join('\n'));
});
