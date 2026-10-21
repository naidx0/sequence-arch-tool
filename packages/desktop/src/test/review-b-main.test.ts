import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/*
 * Source-text assertions (importing main.ts needs the Electron runtime; the
 * reason no-menu.test.ts gives). They lock the three main.ts halves of the
 * 0.1.8.1 wave B review fixes; server-control and proxyEnv carry the logic tests.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const main = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');

function bodyAfter(marker: string, len = 600): string {
  const at = main.indexOf(marker);
  assert.ok(at >= 0, `main.ts has no ${marker}`);
  return main.slice(at, at + len);
}

test('a respawned engine reloads through the boot screen, never straight onto the app', () => {
  const respawned = bodyAfter('onRespawned:');
  assert.match(respawned, /loadAppWhenAttached\(\)/);
  assert.doesNotMatch(respawned.split('onUnexpectedExit')[0] ?? '', /webContents\.reload\(\)/);
});

test('a stalled startup read is said in a dialog, not spun on', () => {
  const load = bodyAfter('async function loadAppWhenAttached', 1400);
  assert.match(load, /e instanceof AttachStalledError/);
  assert.match(load, /showMessageBox/);
  assert.match(load, /Sequence stopped reading this project/);
});

test('the first spawn waits for the live proxy probe when nothing is cached', () => {
  /* contract change (0.1.8.4): the wait moved into boot.ts startEngine; a cached answer is applied without waiting. */
  const boot = fs.readFileSync(path.join(ROOT, 'src', 'boot.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(main, /proxyForFirstSpawn,/);
  assert.match(boot, /return d\.proxyForFirstSpawn\(d\.proxy\)\.then\(/);
  assert.match(boot, /if \(d\.proxy\.hadCache\) \{\n\s+d\.applyProxy\(d\.proxy\.cached\)/);
});
