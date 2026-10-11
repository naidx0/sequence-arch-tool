import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE LAUNCH IS MEASURED IN STAGES, AND THE SMOKE LINE PRINTS THEM.
 *
 * A launch time with no stages cannot say where a slow launch went. main.ts
 * stamps each stage on the wall clock and smoke mode hands the stamps to
 * tools/desktop-smoke.mjs, which prints them from the moment it spawned the
 * app. Source-text assertions for the reason no-menu.test.ts gives: importing
 * main.ts needs the Electron runtime. The behavioural half is the smoke run.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const main = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
const smoke = fs
  .readFileSync(path.join(ROOT, '..', '..', 'tools', 'desktop-smoke.mjs'), 'utf8')
  .replace(/\r\n/g, '\n');

const STAGES = ['mainStart', 'appReady', 'serverUp', 'windowCreated', 'readyToShow'];

test('main.ts marks every main-process stage on the wall clock', () => {
  assert.match(main, /performance\.timeOrigin \+ performance\.now\(\)/);
  for (const stage of STAGES) {
    assert.ok(main.includes(`mark('${stage}')`), `main.ts no longer marks ${stage}`);
  }
});

test('smoke mode reports first paint, composer-interactive and composer-typeable with the marks', () => {
  assert.match(main, /const firstPaint = await firstFrame;/);
  assert.match(main, /composerInteractive: seen\.settledAt/);
  /* Typeable: the static composer from the moment the window is shown, else React's. */
  assert.match(main, /Math\.max\(staticAt, shownAt\)/);
  assert.match(main, /\r?\n\s+composerTypeable,\r?\n/);
  /* first paint is a frame, because a hidden window records no paint entry */
  assert.match(main, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
});

test('the smoke runner prints every stage from its own launch time', () => {
  assert.match(smoke, /const launchedAt = Date\.now\(\);/);
  for (const stage of [...STAGES, 'firstPaint', 'composerInteractive', 'composerTypeable']) {
    assert.ok(smoke.includes(`${stage}: at('${stage}')`), `the smoke line drops ${stage}`);
  }
  assert.match(smoke, /SEQUENCE_DESKTOP_TIMING /);
});
