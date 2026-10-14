/*
 * A four-part release (v0.1.8.1) builds with electron-builder, which refuses a non-semver
 * package.json version. The workflow keeps package.json three-part and hands the fourth part
 * to the app (app-build.json) and to electron-builder (BUILD_NUMBER -> buildVersion 0.1.8.1).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');

test('the release workflow writes the build number for the app and for electron-builder', () => {
  assert.match(wf, /echo "\{\\"build\\": \$build\}" > packages\/analyzer\/app-build\.json/);
  assert.match(wf, /if \[ "\$build" != "0" \]; then echo "BUILD_NUMBER=\$build" >> "\$GITHUB_ENV"; fi/);
});

test('package.json versions stay three-part semver (electron-builder refuses four parts)', () => {
  for (const pkg of ['package.json', 'packages/desktop/package.json', 'packages/analyzer/package.json']) {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, pkg), 'utf8')).version;
    assert.match(v, /^\d+\.\d+\.\d+$/, `${pkg} version ${v} is not three-part`);
  }
});
