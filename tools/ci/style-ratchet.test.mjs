import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkRatchet } from './perf-ratchet.mjs';
import { STATIC_READS, STYLE_RATCHET_FILE, countBackdrop, countHeavyWeights, countInfinite, measureStyle } from './style-ratchet.mjs';

/* S4: infinite animations, blurring backdrop-filters and bundled font bytes
   may only go down (style-ratchet.mjs). */

test('the web2 stylesheets are at their ceilings', () => {
  const ratchet = JSON.parse(fs.readFileSync(STYLE_RATCHET_FILE, 'utf8'));
  const measured = measureStyle();
  const { ok, lines } = checkRatchet(ratchet, { ...measured, $reads: STATIC_READS });
  assert.ok(ok, lines.join('\n'));
});

test('the counters find what they count, and nothing in comments (controls)', () => {
  const css = `
    /* animation: quoted 1s linear infinite; backdrop-filter: blur(9px); */
    .a { animation: spin 1s linear infinite; }
    .b { animation: fade 240ms ease both; }
    .c { animation-iteration-count: infinite; }
    .d { -webkit-backdrop-filter: blur(12px) saturate(1.2); backdrop-filter: blur(12px) saturate(1.2); }
    .e { backdrop-filter: none; }
  `;
  assert.equal(countInfinite(css), 2);
  assert.equal(countBackdrop(css), 1);
  assert.equal(countInfinite('/* infinite */ .x{animation: a 1s 3}'), 0);
});

test('the weight counter finds 500 and up in every form, and not 450 (controls)', () => {
  const css = `
    /* font-weight: 700; */
    .a { font-weight: 600; } .b { font-weight: bold; } .c { --fw-head: 500; }
    .d { font: 700 14px/1.2 sans-serif; }
    .e { font-weight: 450; } .f { font-weight: var(--fw-head); } .g { --fw-body: 380; }
    .h { font: 14px/1.5 sans-serif; } .i { font-weight: 350 450; }
  `;
  assert.equal(countHeavyWeights(css), 4);
});

test('a planted loop, blur and font move every count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'style-ratchet-'));
  try {
    fs.mkdirSync(path.join(dir, 'fonts'));
    fs.writeFileSync(path.join(dir, 'a.css'), '.x{animation:s 1s infinite}.y{backdrop-filter:blur(2px)}.z{font-weight:600}');
    fs.writeFileSync(path.join(dir, 'fonts', 'f.woff2'), Buffer.alloc(123));
    assert.deepEqual(measureStyle(dir), { infiniteAnimations: 1, backdropFilters: 1, fontBytes: 123, heavyWeights: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
