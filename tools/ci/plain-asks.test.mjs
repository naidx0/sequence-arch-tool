import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { ASKS, failedGuards, summarizePlainAsks } from '../bench/plainAsks.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const MAKEMORE = path.join(ROOT, 'examples', 'makemore');

const ctx = {
  files: Object.fromEntries(
    fs
      .readdirSync(MAKEMORE)
      .filter((f) => fs.statSync(path.join(MAKEMORE, f)).isFile())
      .map((f) => [f, fs.readFileSync(path.join(MAKEMORE, f), 'utf8')]),
  ),
};

/**
 * THE ANTI-ROT GATE.
 *
 * The twenty references are hand-written facts about `examples/makemore`. A
 * hand-written fact about a repository is the thing that goes quietly wrong: the
 * file gains a parameter, the reference still reads plausibly, and the bench
 * grades twenty answers against something that stopped being true while still
 * printing a percentage.
 *
 * So the guards run here, on CPU, on every `pnpm test:ci` — not only inside a
 * run that needs the card. If makemore moves, this goes red on the next commit
 * and names the ask, rather than at the end of a queued GPU run.
 */
test('every reference is still true of examples/makemore', () => {
  assert.deepStrictEqual(failedGuards(ctx), []);
});

test('the bank is twenty asks, split fourteen and six as registered', () => {
  /* The split is pre-declared in `docs/research/reasoning-on-plain-asks.md` and
     the two halves are reported separately. Moving an ask between them after a
     run is how a null result becomes a positive one. */
  assert.strictEqual(ASKS.length, 20);
  assert.strictEqual(ASKS.filter((a) => a.kind === 'retrieval').length, 14);
  assert.strictEqual(ASKS.filter((a) => a.kind === 'reasoned').length, 6);
  assert.strictEqual(new Set(ASKS.map((a) => a.id)).size, 20, 'ids must be unique');
  for (const a of ASKS) assert.ok(a.reference.trim().length > 0, `${a.id} needs a reference`);
});

test('an empty repository fails every guard, including the absence ones', () => {
  /*
   * A deleted file reads as a TypeError inside a guard, and swallowing that as
   * "true" is how a stale bank survives a rename. The ABSENCE guards are the
   * subtle half: "no filename matches /test/" is also true of an empty
   * directory, so pa-16 passed here vacuously until it was made to establish
   * that the three modules exist first. Written as an all-twenty assertion
   * precisely because it caught that.
   */
  assert.deepStrictEqual(failedGuards({ files: {} }).sort(), ASKS.map((a) => a.id).sort());
});

/* ── the decision rule ────────────────────────────────────────────────────── */

const rows = (onIds, offIds) =>
  ASKS.map((a) => ({
    id: a.id,
    kind: a.kind,
    onCorrect: onIds.includes(a.id),
    offCorrect: offIds.includes(a.id),
    onCoverage: { full: true },
    offCoverage: { full: true },
  }));
const ids = (n, kind) => ASKS.filter((a) => (kind ? a.kind === kind : true)).slice(0, n).map((a) => a.id);

test('losing more than a quarter of the correct answers is "real work"', () => {
  const on = ids(20);
  const off = ids(14); // 14/20 — a 30% relative loss
  assert.strictEqual(summarizePlainAsks(rows(on, off)).verdict, 'real-work');
});

test('holding 90% of them, with the six intact, is "not earning it"', () => {
  /* Built explicitly rather than by `slice(18)`, which quietly dropped two of
     the SIX and so was not the case this test claims to cover. */
  const on = ASKS.map((a) => a.id);
  const off = ASKS.filter((a) => a.kind === 'reasoned' || a.id > 'pa-02').map((a) => a.id);
  const s = summarizePlainAsks(rows(on, off));
  assert.strictEqual(s.reasoned.off, 6, 'all six kept');
  assert.strictEqual(s.off, 18, 'two retrieval asks lost');
  assert.strictEqual(s.verdict, 'not-earning-it');
});

test('a collapse on the six is caught even when the aggregate holds', () => {
  /*
   * THE FAILURE THE PREVIOUS RULE COULD NOT SEE.
   *
   * `thinking-on-vs-off.md` used a flat twenty-point band and scored a metric
   * going 2/14 -> 0/14 — every instance in the sample, gone — as "holding",
   * because 14 < 20. Here reasoning-off keeps all fourteen retrieval asks and
   * loses ALL SIX of the reasoned ones: 20 -> 14 overall. The second clause
   * exists so that reads as real work rather than as an acceptable aggregate.
   */
  const on = ids(20);
  const off = ASKS.filter((a) => a.kind === 'retrieval').map((a) => a.id);
  const s = summarizePlainAsks(rows(on, off));
  assert.strictEqual(s.reasoned.off, 0);
  assert.strictEqual(s.verdict, 'real-work');
});

test('a run where reasoning-on got nothing right reports no baseline, not a verdict', () => {
  /* 0/0 is NaN, and every comparison against NaN is false — which would have
     fallen through to "inconclusive" and read as a mild finding rather than as a
     broken run. */
  const s = summarizePlainAsks(rows([], []));
  assert.strictEqual(s.verdict, 'no-baseline');
});

test('the middle is reported as inconclusive, not rounded to a side', () => {
  const on = ids(20);
  const off = ids(17); // 85% retained: below 0.90, above the 0.75 floor
  assert.strictEqual(summarizePlainAsks(rows(on, off)).verdict, 'inconclusive');
});
