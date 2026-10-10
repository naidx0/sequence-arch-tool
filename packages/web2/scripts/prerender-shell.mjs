#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   PRERENDER THE SHELL INTO dist/index.html
   packages/web2/scripts/prerender-shell.mjs   (runs after `vite build`)

   So a person can type before React and the server have booted: the real
   V3App, rendered once at build time with a fresh store, is put in the page
   as #static-shell, styled by the same CSS the build already links in <head>.
   A pre-paint script (static-shell.js, inlined) decides whether this visit's
   stored layout is one the frame matches; if not, the frame is removed and
   the splash stays, as before. On mount, V3Chat takes the typed text, the
   caret and a pending Send from it (chat/staticHandoff.ts) and removes it.

   DETERMINISTIC: jsdom with empty storage, a fixed 1440 x 900 window, no
   network, no clock in the output (checked: two renders must be identical).
   A failure here fails the build.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, '..');
const DIST_HTML = path.join(PKG, 'dist', 'index.html');
const WIDTH = 1440;
const HEIGHT = 900;

function fail(msg) {
  console.error(`prerender-shell: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(DIST_HTML)) fail(`${DIST_HTML} is missing; run vite build first`);

/* ── a browser-shaped global scope ─────────────────────────────────────── */
const dom = new JSDOM('<!doctype html><html lang="en" data-theme="dark" data-accent="blue"><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1/',
  pretendToBeVisual: true,
});
const win = dom.window;
Object.defineProperty(win, 'innerWidth', { value: WIDTH, configurable: true });
Object.defineProperty(win, 'innerHeight', { value: HEIGHT, configurable: true });
win.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
/* No network at build time: anything that fetches during render gets nothing. */
win.fetch = () => new Promise(() => {});
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
for (const key of Object.getOwnPropertyNames(win)) {
  if (key in globalThis) continue;
  try {
    define(key, win[key]);
  } catch {
    /* a few are read-only in Node; the ones React needs are below */
  }
}
define('window', win);
define('document', win.document);
define('navigator', win.navigator);
define('localStorage', win.localStorage);
define('sessionStorage', win.sessionStorage);
define('location', win.location);
define('fetch', win.fetch);
define('matchMedia', win.matchMedia);
define('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0));
define('cancelAnimationFrame', (id) => clearTimeout(id));

/* ── render twice through Vite's SSR loader ─────────────────────────────── */
const vite = await createServer({
  root: PKG,
  configFile: path.join(PKG, 'vite.config.ts'),
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
let html;
let layout;
/* React says once per component that a layout effect does not run on the
   server. That is the point here (the frame is the first paint, effects come
   with React), so only that one message is dropped. */
const consoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('Warning: useLayoutEffect does nothing on the server')) return;
  consoleError(...args);
};
try {
  const mod = await vite.ssrLoadModule('/src/prerender/shellFrame.tsx');
  html = mod.renderShellFrame();
  const again = mod.renderShellFrame();
  if (html !== again) fail('two renders of the shell differ, so the frame is not deterministic');
  layout = mod.SHELL_LAYOUT;
} catch (e) {
  fail(`rendering the shell failed: ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  console.error = consoleError;
  await vite.close();
}

/* ── what must be in it ─────────────────────────────────────────────────── */
for (const [what, re] of [
  ['the composer field', /data-testid="composer-field"/],
  ['the session panel', /class="v3-rail-slot/],
  ['the chat column', /class="s2-chat v3-chat-col"/],
]) {
  if (!re.test(html)) fail(`the prerendered shell has no ${what}`);
}

/* Decision 49: the frame is drawn at the default chat width (420px); a
   dragged width is applied before paint by static-shell.js, clamped as React
   clamps it. The panel's width is fixed (232, 208 at 1180 and below). */

/* ── into the page ──────────────────────────────────────────────────────── */
const script = fs
  .readFileSync(path.join(here, 'static-shell.js'), 'utf8')
  .replace('__LAYOUT__', JSON.stringify(layout));
let page = fs.readFileSync(DIST_HTML, 'utf8');
if (page.includes('id="static-shell"')) fail('dist/index.html already has a static shell (prerender ran twice on one build)');
const anchor = '<div id="root"></div>';
if (!page.includes(anchor)) fail(`dist/index.html has no ${anchor}`);
page = page.replace(
  anchor,
  `<div id="static-shell" data-static-shell="1">${html}</div>\n    <script>${script}</script>\n    ${anchor}`,
);
fs.writeFileSync(DIST_HTML, page);
console.log(`prerender-shell: ${Math.round(html.length / 1024)} KB of shell into dist/index.html`);
