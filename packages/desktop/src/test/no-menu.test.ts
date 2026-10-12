import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE MENU BAR IS GONE AND THE CHORDS ARE NOT.
 *
 * Owner, 2026-09-12, looking at the Windows build: "make sure the File / Edit /
 * View / Window / Help functions are editable via the settings page inside the
 * actual application instead of the Windows menu bar options."
 *
 * Deleting a menu is one line. The failure that comes free with it is that
 * every accelerator went with it — Ctrl+O, Ctrl+R, F12, the zoom trio, F11, F1
 * — because those existed ONLY as `accelerator:` strings on menu items, and a
 * string on an object that no longer exists binds nothing. The app would still
 * open, and nobody's keyboard would work.
 *
 * Source-text assertions, for the same reason `preload-bridge.test.ts` uses
 * them: importing `main.ts` needs the Electron runtime, which CI cannot
 * download. That constraint is real and these are what fits inside it — they
 * check that the chord is NAMED and that the handler that fires it exists, not
 * that a keystroke reaches it. The behavioural half is `tools/desktop-smoke.mjs`
 * against a real window.
 */
const MAIN = path.resolve(__dirname, '..', '..', 'src', 'main.ts');
const src = fs.readFileSync(MAIN, 'utf8').replace(/\r\n/g, '\n');

test('no application menu is built from a File/Edit/View/Window/Help template', () => {
  /* The five menus the owner named, as the template entries that drew them.
     `role: 'appMenu'` survives on macOS and is NOT one of these — see the
     block comment above `buildMenu` for why Cmd+Q needs it. */
  for (const gone of [
    "label: 'File'",
    "role: 'editMenu'",
    "label: 'View'",
    "role: 'windowMenu'",
    "role: 'help'",
    "role: 'reload'",
    "role: 'toggleDevTools'",
    "role: 'togglefullscreen'",
  ]) {
    assert.ok(
      !src.includes(gone),
      `main.ts still builds a menu entry: ${gone} — the bar the owner asked to remove is back`,
    );
  }
});

test('the menu is explicitly nulled rather than merely not built', () => {
  /* Electron installs a DEFAULT menu when an app sets none, so "we stopped
     calling buildFromTemplate" is not the same fact as "there is no menu".
     Only setApplicationMenu(null) removes it. */
  assert.match(src, /Menu\.setApplicationMenu\(null\)/);
  assert.match(src, /autoHideMenuBar:\s*true/);
});

test('EVERY ACCELERATOR THE MENU CARRIED IS STILL NAMED IN main.ts', () => {
  for (const accelerator of [
    'CmdOrCtrl+O',
    'CmdOrCtrl+R',
    'CmdOrCtrl+Shift+R',
    'F12',
    'CmdOrCtrl+Shift+I',
    'CmdOrCtrl+=',
    'CmdOrCtrl+-',
    'CmdOrCtrl+0',
    'F11',
    'F1',
    'CmdOrCtrl+Q',
  ]) {
    assert.ok(src.includes(accelerator), `the chord ${accelerator} is not named anywhere in main.ts`);
  }
});

test('and something actually listens for keystrokes', () => {
  /*
   * The half that a list of strings cannot prove on its own. A table of
   * accelerators with no handler reading it is the same dead contract as a
   * preload nobody collects — this repository's documented failure mode, and
   * the reason preload-bridge.test.ts checks both halves too.
   */
  assert.match(src, /before-input-event/);
  assert.match(src, /input\.type\s*!==\s*'keyDown'/);
  assert.match(src, /event\.preventDefault\(\)/);
});

test('the in-app pane has one channel, and it carries every action', () => {
  assert.match(src, /ipcMain\.handle\('sequence:shell'/);
  for (const action of [
    "'open-repo'",
    "'reload'",
    "'force-reload'",
    "'toggle-devtools'",
    "'zoom-in'",
    "'zoom-out'",
    "'zoom-reset'",
    "'toggle-fullscreen'",
    "'open-help'",
    "'quit'",
    "'info'",
  ]) {
    assert.ok(src.includes(`case ${action}:`), `sequence:shell does not handle ${action}`);
  }
  /* An action this build does not know must be an error, not a dead button. */
  assert.match(src, /unknown shell action/);
});

test('the native repo picker and its IPC door are untouched', () => {
  /* The two things the ask did NOT include, asserted because removing a menu
     is exactly the edit that takes a File menu's flow with it. */
  assert.match(src, /async function openRepoDialog\(\)/);
  assert.match(src, /ipcMain\.handle\('sequence:open-repo'/);
});

test('the help channel still exists — the menu went, the page did not', () => {
  assert.match(src, /sequence:open-help/);
});

/**
 * ZOOM IS A LADDER OF PRESET FACTORS (2026-09-17).
 *
 * Owner on the installed Windows app: "some icon resolution stuff, some font
 * resolution issues — typical UI elements." The zoom chords stepped Chromium's
 * zoom LEVEL by 0.5, and a level is an exponent (factor = 1.2 ** level), so
 * Ctrl+= landed the viewport on 1.0954…, 1.3145…, 1.7278… — fractional device
 * scales, which resample every raster and push text off its hinting grid.
 *
 * These are source-text assertions for the reason the header gives: main.ts
 * cannot be imported without the Electron runtime. They are still LOCKING —
 * the `setZoomLevel` / `getZoomLevel` assertions below fail against the source
 * as it stood before this fix, which is the only property that makes a
 * regression test worth having.
 */
test('the zoom chords move along a preset ladder of FACTORS', () => {
  /* Every rung, named. A ladder missing 1 has no home to reset to. */
  assert.match(src, /const ZOOM_STEPS: readonly number\[\] = \[0\.8, 0\.9, 1, 1\.1, 1\.25, 1\.5, 1\.75, 2\]/);
  assert.match(src, /const DEFAULT_ZOOM = 1;/);
  assert.match(src, /function stepZoom\(win: BrowserWindow, direction: 1 \| -1\): number/);
});

test('and NOTHING touches Chromium zoom levels any more', () => {
  /*
   * THE LOCK. `setZoomLevel(n)` is `setZoomFactor(1.2 ** n)` with the exponent
   * hidden, so a half-step is an irrational scale. Re-introducing either call
   * silently restores the blur the owner reported, and nothing else in the
   * suite would notice.
   */
  assert.ok(!src.includes('setZoomLevel'), 'main.ts is back on Chromium zoom LEVELS — a half level is a fractional device scale');
  assert.ok(!src.includes('getZoomLevel'), 'main.ts reads a zoom LEVEL — the ladder is in factors');
  assert.ok(!src.includes('function zoomBy('), 'the level-stepping helper is back');
  assert.match(src, /setZoomFactor/);
});

test('a fresh load comes back to 1 unless the user zoomed this session', () => {
  /*
   * Chromium persists zoom PER ORIGIN, and every load here is the same
   * 127.0.0.1 origin — so without this the repo-attach respawn, a reload and a
   * re-created window all silently inherit an old zoom, and the app is
   * permanently soft with nothing on screen saying why.
   */
  assert.match(src, /let userZoom: number \| null = null;/);
  assert.match(src, /function applyZoom\(wc: WebContents\): void/);
  assert.match(src, /wc\.setZoomFactor\(userZoom === null \? DEFAULT_ZOOM : userZoom\)/);
  assert.match(src, /did-finish-load/);
  /* Reset clears the flag, so Ctrl+0 means "1, and stay there". */
  assert.match(src, /userZoom = null;[\s\S]{0,120}setZoomFactor\(DEFAULT_ZOOM\)/);
});

test('every zoom action still reports the factor it left the window on', () => {
  /* The pane never assumes a press worked — it redraws from what came back. */
  assert.match(src, /case 'zoom-in':\s*\r?\n\s*return \{ zoomFactor: stepZoom\(win, 1\) \};/);
  assert.match(src, /case 'zoom-out':\s*\r?\n\s*return \{ zoomFactor: stepZoom\(win, -1\) \};/);
  assert.match(src, /case 'zoom-reset':[\s\S]{0,400}return \{ zoomFactor: wc\.getZoomFactor\(\) \};/);
});

test('the window is opaque and grounded — no transparency to composite through', () => {
  /* A `transparent: true` window makes every edge composite against whatever
     is behind it, which is the other way to get soft chrome on Windows. */
  assert.match(src, /backgroundColor: '#202025'/);
  assert.ok(!src.includes('transparent: true'), 'a transparent window composites every edge against the desktop');
  /* And nothing forces a device scale or turns off the GPU, either of which
     would resample the whole app. */
  assert.ok(!src.includes('force-device-scale-factor'), 'a forced device scale overrides the display');
  assert.ok(!src.includes('disableHardwareAcceleration'), 'software compositing changes how text is rasterised');
});
