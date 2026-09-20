#!/usr/bin/env node
/**
 * THE NEXT-PICTURE BANDS, READ.
 *
 *   node tools/bench/next-picture-report.mjs [arms...]
 *
 * Two numbers, in this order, because the second is worthless without the first:
 *
 *   1. REVEALS. The kill number from the registration is five across two runs.
 *      Zero means the carrier was not the only thing missing. ONE TO FOUR IS A
 *      KILL, NOT A PASS — it would let a percentage be computed off a handful,
 *      which is what the registration's own refutation clause exists to prevent.
 *      A band scored on four answers is not a band.
 *
 *   2. THE GATE REASONS, from `stopReason` rather than by elimination. Ten of 28
 *      turns per arm were attributed to `atCap` by having nothing else left; the
 *      bench records the reason now, so this reads it. If the recorded reasons
 *      disagree with that attribution, the gate list in
 *      docs/research/next-picture-result-2026-09-06.md is wrong and the analysis
 *      is redone rather than patched.
 */
import fs from 'node:fs';
import path from 'node:path';

const QUESTION = 'Before I draw it — next is';
const REVEAL = 'Last turn you were asked';
const DEFAULT_FORM = 'Looking at the picture:';
const STUB_WORDS = 35;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: next-picture-report.mjs <arm.json>...');
  process.exit(2);
}

let totalAsked = 0;
let totalRevealed = 0;
const rows = [];

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  let asked = 0;
  let revealed = 0;
  let orphaned = 0; /* asked on the last turn, so nowhere to land */
  const gates = new Map();
  const bump = (k) => gates.set(k, (gates.get(k) ?? 0) + 1);

  for (const c of d.results ?? []) {
    const ts = c.turns ?? [];
    for (let i = 0; i < ts.length; i += 1) {
      const t = ts[i];
      const text = t.text ?? '';
      if (text.includes(QUESTION)) {
        asked += 1;
        const next = i + 1 < ts.length ? (ts[i + 1].text ?? '') : null;
        if (next === null) orphaned += 1;
        else if (next.includes(REVEAL)) revealed += 1;
      }
      /* Why this turn carried no derived question, in the order the code asks. */
      if (text.includes(QUESTION) || text.includes(DEFAULT_FORM)) {
        bump('carried a derived check-in');
        continue;
      }
      /*
       * THE RECORDED REASON WINS, AND IT IS READ FIRST.
       *
       * The first version asked it LAST, after inferring "stub", "no chart" and
       * "the model's own check-in" from other fields — so five turns carrying
       * `no-chart-derived-this-turn` were bucketed as "no chart this turn" by a
       * guess that never reached the answer sitting on the same object. The
       * reader repeated, in its own ordering, exactly the mistake the field was
       * built to end.
       */
      if (typeof t.checkInSkipped === 'string') {
        bump(`checkInSkipped: ${t.checkInSkipped}`);
        continue;
      }
      if (t.stub === true || (t.words ?? 0) <= STUB_WORDS) {
        bump('stub (<=35 words)');
        continue;
      }
      if ((t.charts ?? []).length === 0) {
        bump('no chart emitted (inferred — no recorded reason)');
        continue;
      }
      if (t.endsWithCheck === true) {
        bump('the model wrote its own check-in');
        continue;
      }
      /*
       * THE BUCKET THAT WAS ATTRIBUTED BY ELIMINATION, and then guessed at four
       * times. `checkInSkipped` is the quantity the code actually branches on, so
       * it is read FIRST and `stopReason` is only the fallback for arms recorded
       * before it existed.
       */
      const why = t.stopReason ?? null;
      bump(why === null ? 'no stopReason recorded (an arm from before the repair)' : `stopReason: ${why} (no checkInSkipped — an arm from before 85e74240)`);
    }
  }
  totalAsked += asked;
  totalRevealed += revealed;
  rows.push({ file: path.basename(f), asked, revealed, orphaned, gates });
}

for (const r of rows) {
  console.log(`\n${r.file}`);
  console.log(`  questions asked   ${r.asked}`);
  /*
   * LANDABLE QUESTIONS ARE THE CLAIM, per the ceiling registration: reveals are
   * a product of two things and only the conversation's length is under test.
   */
  console.log(`  LANDABLE (had a next turn) ${r.asked - r.orphaned}   [${r.orphaned} asked on a final turn]`);
  console.log(`  reveals           ${r.revealed}${r.asked - r.orphaned ? `  (${Math.round((100 * r.revealed) / (r.asked - r.orphaned))}% of landable)` : ''}`);
  console.log('  why each turn carried no derived question:');
  for (const [k, v] of [...r.gates].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}  ${k}`);
}

console.log('');
const totalLandable = rows.reduce((a, r) => a + (r.asked - r.orphaned), 0);
console.log(`LANDABLE ${totalLandable} of ${totalAsked} questions asked, across ${rows.length} run(s).`);
console.log(`REVEALS ${totalRevealed} of ${totalLandable} landable.`);
/*
 * The verdict is printed, not left to the reader, because a number this small is
 * exactly the kind that gets read as a trend.
 */
if (totalRevealed >= 5) {
  console.log('The kill number (>= 5) is CLEARED: the reveal path works and the band can be read.');
} else if (totalRevealed === 0) {
  console.log('ZERO reveals: the carrier was not the only thing missing. The band stays unread.');
} else {
  console.log(
    `KILL: ${totalRevealed} reveal(s) is in the dangerous middle (1-4). A band scored on a handful ` +
      'is not a band — the registration refuses this rather than reporting a percentage.',
  );
}
process.exitCode = totalRevealed >= 5 ? 0 : 1;
