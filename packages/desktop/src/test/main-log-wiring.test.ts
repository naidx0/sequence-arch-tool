import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/*
 * Source-text assertions (importing main.ts needs the Electron runtime; the
 * reason no-menu.test.ts gives). They lock that main.ts keeps writing the
 * evidence a "the window closed on its own" report needs.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const main = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');

test('main.ts logs the lifecycle events that explain a vanished window', () => {
  for (const ev of [
    'app-start',
    'window-close',
    'window-closed',
    'render-process-gone',
    'child-process-gone',
    'window-all-closed',
    'before-quit',
    'uncaught-exception',
    'unhandled-rejection',
    'server-unexpected-exit',
    'server-respawned',
  ]) {
    assert.ok(main.includes(`'${ev}'`), `main.ts no longer logs ${ev}`);
  }
});

test('the window-close IPC marks itself as the initiator', () => {
  assert.match(main, /case 'window-close':\n\s+closeInitiator = 'renderer-ipc';/);
});

test('a dead renderer is reloaded once through the policy, never in smoke mode', () => {
  assert.match(main, /decideRendererRecovery\(recentRendererDeaths, Date\.now\(\), undefined, undefined, reloadSettled\)/);
  assert.match(main, /if \(SMOKE \|\| isQuitting \|\| details\.reason === 'clean-exit'\) return;/);
});

test('every unexpected server exit flushes the stderr tail, and respawn clears it', () => {
  assert.match(main, /startsWith\('\[server\] exited on its own'\)[\s\S]{0,200}flushServerTail\(\)/);
  assert.match(main, /onRespawned: \(\) => \{\n\s+serverStderrTail\.length = 0;/);
  assert.match(main, /pushTail\(serverStderrTail,/);
});

test('Restart to update is its own shell action: it logs, then quits so the waiting update helper can swap', () => {
  assert.match(main, /case 'restart-for-update':\n\s+mainLog\.write\('restart-for-update'\);\n\s+app\.quit\(\);/);
  assert.match(main, /\| 'restart-for-update'/);
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload.ts'), 'utf8');
  assert.match(preload, /\| 'restart-for-update'/, 'the preload mirror lists it, or the page cannot name it');
});
