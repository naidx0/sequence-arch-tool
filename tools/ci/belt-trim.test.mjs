import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

/**
 * THE BELT CONDITION'S FLAG — it removes TOOLS and nothing else.
 *
 * Registered in docs/research/belt-condition-registration.md. Measured before
 * building: on a first-tier ask with a repo attached the belt is 1,363 tokens
 * and the TOOLS section is ALL of it; on a teach turn it is 632 of 3,087. Tool
 * calls happened on 1 turn in 104.
 *
 * Source-scanned rather than executed: the belt renderer reaches deep into the
 * pipeline's module graph, and what these cases guard is WHICH SECTION the flag
 * gates — a property of the code, not of one rendering.
 */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(
  path.join(HERE, '..', '..', 'packages', 'analyzer', 'src', 'server', 'askPipeline.ts'),
  'utf8',
);

test('the flag gates the TOOLS section', () => {
  assert.match(SRC, /const trimTools = process\.env\.SEQUENCE_ASK_TRIM_TOOLS === '1';/);
  const at = SRC.indexOf('const trimTools');
  const after = SRC.slice(at, at + 500);
  assert.match(after, /if \(!trimTools\) \{/, 'the section is skipped when the flag is on');
  assert.match(after, /renderAskToolHintSection/, 'and it is the TOOLS section that is skipped');
});

test('CHARTS is NOT gated — the instruction that plainly works stays', () => {
  /*
   * CHARTS is 398 tokens against a 69% chart rate; TOOLS is 632-1,363 against 1
   * turn in 104. Removing both would confound them, and a run that lost charts
   * could not say which section did it. A fall in charts VOIDS the run rather
   * than refuting it, which only means anything if this holds.
   */
  const at = SRC.indexOf('renderChartToolHintSection()');
  assert.ok(at > 0, 'the charts section is still rendered');
  const before = SRC.slice(Math.max(0, at - 400), at);
  assert.ok(!before.includes('trimTools'), 'and the flag does not reach it');
});

test('AI CANVAS and TEACH MODE are not gated either', () => {
  for (const marker of ['renderCanvasToolHintSection()', 'TEACH MODE']) {
    const at = SRC.indexOf(marker);
    assert.ok(at > 0, `${marker} is still rendered`);
    assert.ok(!SRC.slice(Math.max(0, at - 300), at).includes('trimTools'), `${marker} is not gated`);
  }
});

test('absent or unset leaves the belt byte-identical — the arms on record stay comparable', () => {
  /*
   * The default must not change. Every figure measured before today describes a
   * belt with TOOLS in it, and a flag that defaulted on would silently redefine
   * all of them.
   */
  assert.match(SRC, /SEQUENCE_ASK_TRIM_TOOLS === '1'/, 'only the exact string "1" enables it');
  assert.ok(
    !/SEQUENCE_ASK_TRIM_TOOLS \|\|/.test(SRC) && !/SEQUENCE_ASK_TRIM_TOOLS \?\?/.test(SRC),
    'no default that could turn it on',
  );
});
