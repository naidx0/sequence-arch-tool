/**
 * THE DESKTOP SMOKE DOES NOT TOUCH THE PERSON'S STORE.
 *
 * It used to run the app against the real ~/.sequence: the shell's own
 * last-place.json write (the remembered port) landed there on every gate run,
 * which is how a measurement once overwrote the owner's remembered repo.
 *
 * Now the smoke gives the app a temp SEQUENCE_USER_DIR (removed on exit)
 * unless `--real-store` is passed, the server child inherits it through
 * ServerController, and the shell resolves last-place.json by the engine's
 * own rule. Measured on 2026-10-06: a smoke run before the change moved
 * ~/.sequence/last-place.json's mtime; after it, the mtime did not move.
 * These are the source facts that keep that true (Electron is not available
 * to CI, so the run itself is not repeated here).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const smoke = fs.readFileSync(path.join(ROOT, 'tools', 'desktop-smoke.mjs'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'packages', 'desktop', 'src', 'main.ts'), 'utf8');
const control = fs.readFileSync(path.join(ROOT, 'packages', 'desktop', 'src', 'server-control.ts'), 'utf8');

test('the smoke runs on a temp store unless --real-store, and removes it', () => {
  assert.match(smoke, /const REAL_STORE = process\.argv\.includes\('--real-store'\);/);
  assert.match(smoke, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'seq-desktop-smoke-'\)\)/);
  assert.match(smoke, /env: \{ \.\.\.process\.env, \.\.\.storeEnv, SEQUENCE_DESKTOP_SMOKE: '1' \}/);
  assert.match(smoke, /process\.on\('exit', cleanStore\)/);
});

test('the server child inherits the store, and the shell reads last-place.json from it', () => {
  assert.match(control, /env: \{ \.\.\.process\.env, \.\.\.this\.env \}/);
  assert.match(main, /process\.env\.SEQUENCE_USER_DIR/);
  /* No direct ~/.sequence path left in the shell. */
  assert.doesNotMatch(main, /path\.join\(os\.homedir\(\), '\.sequence', 'last-place\.json'\)/);
});
