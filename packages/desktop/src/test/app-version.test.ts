import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/*
 * Four-part releases (0.1.7.1): package.json versions must stay semver, so the release number the
 * app reports comes from build-info.json, which prepare-server writes from `sequenceVersion` when set.
 * Source-text checks: main.ts needs the Electron runtime to import (no-menu.test.ts says why).
 */
const ROOT = path.resolve(__dirname, '..', '..');
const main = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
const prep = fs.readFileSync(path.join(ROOT, 'scripts', 'prepare-server.mjs'), 'utf8').replace(/\r\n/g, '\n');

test('the server and the about panel get the build-info version, not the raw package version', () => {
  assert.match(main, /SEQUENCE_APP_VERSION: appVersion\(\)/);
  assert.match(main, /appVersion: appVersion\(\)/);
  assert.ok(!/SEQUENCE_APP_VERSION: app\.getVersion\(\)/.test(main), 'the server must not get the semver-only package version');
});

test('appVersion accepts a four-part version from build-info and falls back to the package version', () => {
  const body = main.slice(main.indexOf('function appVersion()'), main.indexOf('function buildCommit()'));
  assert.match(body, /build-info\.json/);
  assert.match(body, /\(\?:\\\.\\d\+\)\?/, 'the fourth part is optional in the accepted pattern');
  assert.match(body, /return app\.getVersion\(\)/);
});

test('prepare-server writes sequenceVersion when the package sets one', () => {
  assert.match(prep, /pkg\.sequenceVersion/);
});
