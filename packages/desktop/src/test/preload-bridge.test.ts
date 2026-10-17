import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * r183 — the preload bridge is now a CONTRACT, not just an unused capability.
 *
 * `packages/web2/src/boot/desktopBridge.ts` feature-detects `window.sequence` and
 * requires it to expose a callable `openRepo`. Rename the global or the method
 * and the desktop build silently loses its native folder picker, falling back to
 * the jailed folder browser with no error anywhere. This test makes that rename
 * loud, from the side that does the exposing.
 *
 * The web2 module is a REBUILD, not the v1 file moved: v1's detection existed to
 * suppress a simulated macOS window that Electron then framed again (owner: "it
 * shouldn't be a box view within a box"), and web2 draws no such frame. The
 * capability is what carried over, not the chrome rule.
 *
 * Source-text assertions, because importing `preload.ts` needs the Electron
 * runtime (`contextBridge` / `ipcRenderer`), which CI cannot download — the same
 * constraint `server-control.test.ts` is written around.
 */
const PRELOAD = path.resolve(__dirname, '..', '..', 'src', 'preload.ts');
const src = fs.readFileSync(PRELOAD, 'utf8');

test('the bridge is exposed on `window.sequence` — the name the web app detects', () => {
  assert.match(src, /contextBridge\.exposeInMainWorld\('sequence', api\)/);
});

test('`openRepo` is the capability the web-side isDesktop() check keys off', () => {
  assert.match(src, /openRepo:\s*\(\):\s*Promise<string \| null>/);
});

test('the bridge stays MINIMAL — no Node/Electron internals handed to the page', () => {
  assert.ok(!/exposeInMainWorld\(\s*'(require|process|electron)'/.test(src));
  // the preload never hands the page a module loader or the raw ipc object
  assert.ok(!/\bapi\s*=\s*\{[^}]*ipcRenderer[,\s}]/.test(src));
  // exactly one thing is exposed, and it is the named `api` object
  assert.strictEqual((src.match(/exposeInMainWorld\(/g) ?? []).length, 1);
});

/*
 * THE SEAM MUST BE READ, AND THE READER MUST BE USED.
 *
 * v1 shipped a preload that exposed `window.sequence` and a web tree where
 * `grep window.sequence` returned zero hits — the bridge kept its promise for a
 * whole product and nobody ever collected. Asserting only that a reader module
 * EXISTS would repeat that mistake one level up: a module nothing imports is the
 * same dead code wearing a filename. So this checks both halves.
 */
const WEB2_SRC = path.resolve(__dirname, '..', '..', '..', 'web2', 'src');
const BRIDGE = path.join(WEB2_SRC, 'boot', 'desktopBridge.ts');

test('the web side reads the bridge by the names the preload exposes', () => {
  const web = fs.readFileSync(BRIDGE, 'utf8');
  assert.match(web, /\.sequence/);
  assert.match(web, /openRepo/);
});

test('and something in the app actually imports it (the seam is not dead code)', () => {
  const consumers: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // A test importing the module proves nothing about the shipped app.
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      if (full === BRIDGE) continue;
      if (/from '\.{1,2}[^']*desktopBridge'/.test(fs.readFileSync(full, 'utf8'))) {
        consumers.push(path.relative(WEB2_SRC, full));
      }
    }
  };
  walk(WEB2_SRC);

  assert.ok(
    consumers.length > 0,
    'no non-test file under packages/web2/src imports desktopBridge — the Electron ' +
      'seam is exposed by the preload and read by nobody, which is exactly the v1 bug',
  );
});
