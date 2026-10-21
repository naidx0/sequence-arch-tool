/**
 * THE STATIC SHELL SITS WHERE REACT'S SHELL WILL, AND HANDS OVER EVERY KEY.
 *
 * packages/web2's build prerenders the real V3App into dist/index.html
 * (scripts/prerender-shell.mjs) so a person can type before React and the
 * server have booted. Two things make that worth having, and both are checked
 * in a real Chromium against the built app served by the analyzer (no repo,
 * a temp user store):
 *
 *   ALIGNMENT  at 1440x900, 1280x800 and 1024x700 the static composer field,
 *              rail and chat column are within 1 px of React's (static: the
 *              page with its JavaScript bundle blocked; React: the page as it
 *              boots, measured after the static shell is gone).
 *   HANDOFF    keys typed into the static field while the bundle is held back
 *              arrive in React's field whole and in order, with the caret,
 *              and keys typed after the handoff follow them.
 *
 * Skips (loudly) without a Chromium or without a built web2/analyzer.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { guardedEnv } from '../test-guard/no-real-binaries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const HTML = path.join(ROOT, 'packages', 'web2', 'dist', 'index.html');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

const exe = findChromium();
const built = fs.existsSync(CLI) && fs.existsSync(HTML);
const skip = !exe ? 'no Chromium on this machine' : !built ? 'web2 or the analyzer is not built' : false;

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/**
 * The engine's provider probe runs `claude --version`, `claude auth status`,
 * `codex --version` and `codex login status` at boot. This test is about the page, not
 * the providers, so the engine gets fake CLIs (in the OS temp dir, which the test guard
 * allows) that say "not installed" and exit 1, ahead of the guard's tripwire on PATH.
 */
function fakeProviderEnv(home) {
  const bin = path.join(home, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ['claude', 'codex']) {
    if (process.platform === 'win32') fs.writeFileSync(path.join(bin, `${name}.cmd`), '@echo off\r\n' + 'exit /b 1\r\n');
    else fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + 'exit 1\n', { mode: 0o755 });
  }
  const env = guardedEnv({ ...process.env, SEQUENCE_USER_DIR: home });
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  env[key] = `${bin}${path.delimiter}${env[key] ?? ''}`;
  return env;
}

async function withApp(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-static-shell-'));
  const port = await freePort();
  const child = spawn(process.execPath, [CLI, 'app', '--no-open', '--port', String(port)], {
    env: fakeProviderEnv(home),
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 300; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) break;
      } catch {
        /* binding */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const require = createRequire(path.join(ROOT, 'packages', 'web2', 'package.json'));
    const { chromium } = require('playwright-core');
    const browser = await chromium.launch({ executablePath: exe, headless: true });
    try {
      return await fn(browser, `http://127.0.0.1:${port}/`);
    } finally {
      await browser.close();
    }
  } finally {
    child.kill();
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const PARTS = {
  field: '[data-testid="composer-field"]',
  rail: '.v3-rail-slot',
  chat: '.v3-chat-col',
};

/** Rects of the parts inside `scope` (a CSS selector prefix, '' for the whole page). */
async function rects(page, scope) {
  return page.evaluate(
    ({ parts, scope }) =>
      Object.fromEntries(
        Object.entries(parts).map(([k, sel]) => {
          const el = document.querySelector(`${scope}${sel}`);
          if (!el) return [k, null];
          const r = el.getBoundingClientRect();
          return [k, { x: r.x, y: r.y, w: r.width, h: r.height }];
        }),
      ),
    { parts: PARTS, scope },
  );
}

const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 700],
];

test('the static shell is within 1 px of React\'s at three viewports', { skip }, async () => {
  await withApp(async (browser, url) => {
    for (const [width, height] of VIEWPORTS) {
      /* Static: the bundle never loads. */
      const ctxA = await browser.newContext({ viewport: { width, height } });
      const a = await ctxA.newPage();
      await a.route(/\/assets\/.*\.js$/, (r) => r.abort());
      await a.goto(url, { waitUntil: 'load' });
      await a.evaluate(() => document.fonts.ready);
      const staticRects = await rects(a, '#static-shell ');
      await ctxA.close();
      /* React: the page as it boots, once the static shell has handed over. */
      const ctxB = await browser.newContext({ viewport: { width, height } });
      const b = await ctxB.newPage();
      await b.goto(url, { waitUntil: 'load' });
      await b.waitForFunction(() => !document.getElementById('static-shell') && document.querySelector('#root [data-testid="composer-field"]'));
      await b.evaluate(() => document.fonts.ready);
      const reactRects = await rects(b, '#root ');
      await ctxB.close();
      for (const part of Object.keys(PARTS)) {
        const s = staticRects[part];
        const r = reactRects[part];
        assert.ok(s, `${width}x${height}: the static shell has no ${part}`);
        assert.ok(r, `${width}x${height}: React drew no ${part}`);
        for (const k of ['x', 'y', 'w', 'h']) {
          assert.ok(Math.abs(s[k] - r[k]) <= 1, `${width}x${height} ${part}.${k}: static ${s[k]} vs React ${r[k]}`);
        }
      }
    }
  });
});

test('keys typed before React arrive whole and in order, with the caret; later keys follow', { skip }, async () => {
  await withApp(async (browser, url) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    /* A returning person: the welcome was skipped on this machine (FirstRunGate's SKIP_KEY). The scratch engine
       has no agent, so without this the welcome opens as a modal, makes the composer inert and takes focus, as it
       should for a first launch; whether that landed before or after this test read the focus was a race. */
    await page.addInitScript(() => {
      try { window.localStorage.setItem('sequence.onboarding.skip', '1'); } catch { /* storage off: the welcome then opens */ }
    });
    /* Hold the bundle back until the static field has taken typing. */
    let release;
    const held = new Promise((r) => (release = r));
    await page.route(/\/assets\/index-.*\.js$/, async (route) => {
      await held;
      await route.continue();
    });
    /* 'commit', not 'domcontentloaded': a module script defers that event until it runs. */
    await page.goto(url, { waitUntil: 'commit' });
    const field = page.locator('#static-shell [data-testid="composer-field"]');
    await field.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'composer-field', 'the static field has focus');
    await page.keyboard.type('what calls orders', { delay: 5 });
    /* Put the caret inside the text: React must keep it there. */
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
    release();
    await page.waitForFunction(() => !document.getElementById('static-shell') && document.querySelector('#root [data-testid="composer-field"]'));
    const after = await page.evaluate(() => {
      const el = document.querySelector('#root [data-testid="composer-field"]');
      return { value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el };
    });
    assert.deepEqual(after, { value: 'what calls orders', start: 10, end: 10, focused: true });
    await page.keyboard.type('X');
    assert.equal(await page.locator('#root [data-testid="composer-field"]').inputValue(), 'what callsX orders');
    await ctx.close();
  });
});

test('a stored layout the frame does not match drops it, and the splash stays', { skip }, async () => {
  await withApp(async (browser, url) => {
    for (const [key, value] of [
      ['v3.agentsOpen', '1'],
      ['v3.railCollapsed', '1'],
      ['v3.chromeTabs', '{"tabs":[{"id":"chat","minimized":false}],"active":"chat"}'],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, value]);
      const page = await ctx.newPage();
      await page.route(/\/assets\/.*\.js$/, (r) => r.abort());
      await page.goto(url, { waitUntil: 'load' });
      const seen = await page.evaluate(() => ({ shell: !!document.getElementById('static-shell'), splash: !!document.getElementById('boot-splash') }));
      assert.deepEqual(seen, { shell: false, splash: true }, `${key}=${value}`);
      await ctx.close();
    }
  });
});

/* Decision 49: the panel's width is fixed (B's 232), so a stored rail width
   from the old shell is ignored by both. 0.1.8.4 chat-only: a stored chat
   width is not a docked column — React ignores v3.chatW while centred. */
test('a stored rail width is ignored; a stored chat width is ignored while chat-only, and still within 1 px of React', { skip }, async () => {
  await withApp(async (browser, url) => {
    const seed = () => {
      localStorage.setItem('v3.railW', '300');
      localStorage.setItem('v3.chatW', '500');
    };
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxA.addInitScript(seed);
    const a = await ctxA.newPage();
    await a.route(/\/assets\/.*\.js$/, (r) => r.abort());
    await a.goto(url, { waitUntil: 'load' });
    const s = await rects(a, '#static-shell ');
    await ctxA.close();
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxB.addInitScript(seed);
    const b = await ctxB.newPage();
    await b.goto(url, { waitUntil: 'load' });
    await b.waitForFunction(() => !document.getElementById('static-shell') && document.querySelector('#root [data-testid="composer-field"]'));
    const r = await rects(b, '#root ');
    await ctxB.close();
    assert.equal(s.rail.w, 232);
    assert.notEqual(s.chat.w, 500);
    for (const part of Object.keys(PARTS)) {
      for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(s[part][k] - r[part][k]) <= 1, `${part}.${k}: static ${s[part][k]} vs React ${r[part][k]}`);
    }
  });
});
