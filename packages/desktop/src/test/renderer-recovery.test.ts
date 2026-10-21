import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  COALESCE_MS,
  decideRendererRecovery,
  rendererDialogChoice,
  RENDERER_DIALOG_BUTTONS,
} from '../rendererRecovery.js';

/* APP-01. main.log 2026-10-17 16:58:54: two `crashed exitCode=7` lines 35 ms apart.
   The second was counted as a second death and the app went to the dead-end dialog. */
test('two deaths 35 ms apart are ONE death: one reload, never the dialog', () => {
  const first = decideRendererRecovery([], 1_000_000);
  assert.equal(first.action, 'reload');
  assert.equal(first.coalesced, false);
  const second = decideRendererRecovery(first.recent, 1_000_035);
  assert.equal(second.action, 'reload');
  assert.equal(second.coalesced, true, 'the caller must not reload a second time');
  assert.deepEqual(second.recent, first.recent, 'a coalesced death is not recorded again');
});

test('a death just inside the coalesce window is the same death; just outside is a second one', () => {
  const first = decideRendererRecovery([], 5_000);
  assert.equal(decideRendererRecovery(first.recent, 5_000 + COALESCE_MS - 1).coalesced, true);
  assert.equal(decideRendererRecovery(first.recent, 5_000 + COALESCE_MS).action, 'dialog');
});

test('a coalesced pair does not poison the next real death: dialog only for a genuine second death', () => {
  let r = decideRendererRecovery([], 0);
  r = decideRendererRecovery(r.recent, 35);
  assert.equal(r.action, 'reload');
  const later = decideRendererRecovery(r.recent, 20_000);
  assert.equal(later.action, 'dialog');
  assert.equal(decideRendererRecovery(later.recent, 200_000).action, 'reload', 'old deaths age out');
});

test('the dialog has exactly Reload and Quit, and the choice is decided purely', () => {
  assert.deepEqual([...RENDERER_DIALOG_BUTTONS], ['Reload', 'Quit']);
  assert.equal(rendererDialogChoice(0), 'reload');
  assert.equal(rendererDialogChoice(1), 'quit');
  /* closing the box any other way must not leave a dead window: reload */
  assert.equal(rendererDialogChoice(-1), 'reload');
  assert.equal(rendererDialogChoice(undefined), 'reload');
});

/* Source-text lock (importing main.ts needs the Electron runtime; see main-log-wiring.test.ts). */
test('main.ts starts a local-only crash reporter before the log, and the renderer path has no dead-end box', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const start = main.indexOf('crashReporter.start({ uploadToServer: false })');
  assert.ok(start > 0, 'crashReporter.start({ uploadToServer: false }) is missing');
  assert.ok(start < main.indexOf('new MainLog('), 'the crash reporter must start before anything else runs');
  assert.ok(main.includes("'crash-dumps'"), 'the crash-dumps path is not logged');
  const handler = main.slice(main.indexOf("webContents.on('render-process-gone'"), main.indexOf("mainWindow.on('focus'"));
  assert.ok(handler.includes('.showMessageBox('), 'the renderer-death dialog must offer Reload / Quit');
  assert.ok(!handler.includes('showErrorBox'), 'showErrorBox is a dead end: one OK button');
});

/* Review APP-01: coalescing must not swallow a genuine death of the RELOADED renderer. */
test('reload, then the reloaded renderer crashes 1.5 s later: the dialog, not silence', () => {
  const first = decideRendererRecovery([], 1_000_000);
  assert.equal(first.action, 'reload');
  /* the reloaded page finished loading (settled), so this is a new death */
  const second = decideRendererRecovery(first.recent, 1_001_500, undefined, undefined, true);
  assert.equal(second.coalesced, false, 'a death after the reload settled must act');
  assert.equal(second.action, 'dialog');
  assert.equal(second.recent.length, 2, 'the new death is recorded');
});

test('the 35 ms duplicate before the reload settled is still one death', () => {
  const first = decideRendererRecovery([], 1_000_000);
  const dup = decideRendererRecovery(first.recent, 1_000_035, undefined, undefined, false);
  assert.equal(dup.coalesced, true);
  assert.equal(dup.action, 'reload');
  assert.deepEqual(dup.recent, first.recent);
});

test('main.ts tells the policy whether the reload settled, and re-checks a swallowed duplicate', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const handler = main.slice(main.indexOf("webContents.on('render-process-gone'"), main.indexOf("mainWindow.on('focus'"));
  assert.match(handler, /decideRendererRecovery\(recentRendererDeaths, Date\.now\(\), undefined, undefined, reloadSettled\)/);
  assert.ok(handler.includes('isCrashed()'), 'a coalesced duplicate must be re-checked: if the window is still dead, recover');
  assert.match(main, /on\('did-finish-load', \(\) => \{\s*reloadSettled = true;/);
});
