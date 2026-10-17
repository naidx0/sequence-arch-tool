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

/*
 * 0.1.8.2 (item 22): electron-builder 26 carries the build number into installer file names. These expand the
 * patterns in electron-builder.yml with electron-builder's own AppInfo and macro expander, so a pattern that
 * drops ${buildVersion}, or a macro the installed builder cannot expand, fails here and not on the release runner.
 */
import { createRequire } from 'node:module';

const desktopRequire = createRequire(path.join(ROOT, 'packages', 'desktop', 'package.json'));
const builderRequire = createRequire(desktopRequire.resolve('electron-builder'));
const libDir = path.dirname(builderRequire.resolve('app-builder-lib/package.json'));
const libRequire = createRequire(path.join(libDir, 'package.json'));
const { AppInfo } = libRequire('./out/appInfo.js');
const { expandMacro } = libRequire('./out/util/macroExpander.js');
const yml = fs.readFileSync(path.join(ROOT, 'packages', 'desktop', 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n');

/** The artifactName under a top-level `key:` block. */
function artifactPattern(key) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `${key}:`);
  assert.ok(start >= 0, `no ${key}: block`);
  for (const l of lines.slice(start + 1)) {
    if (l !== '' && !/^[ \t#]/.test(l)) break;
    const m = /^\s+artifactName:\s*"?([^"\n]+?)"?\s*$/.exec(l);
    if (m) return m[1];
  }
  assert.fail(`${key} has no artifactName`);
}

function names(buildNumber) {
  const saved = process.env.BUILD_NUMBER;
  if (buildNumber == null) delete process.env.BUILD_NUMBER;
  else process.env.BUILD_NUMBER = String(buildNumber);
  try {
    const info = { metadata: { version: '0.1.8', name: 'sequence', description: 'd' }, config: { productName: 'Sequence' }, devMetadata: {} };
    const appInfo = new AppInfo(info, null);
    const x = (key, os, ext, arch) => expandMacro(artifactPattern(key), arch ?? null, appInfo, { os, ext });
    return {
      buildVersion: appInfo.buildVersion,
      nsis: x('nsis', 'win', 'exe'),
      winZip: x('win', 'win', 'zip'),
      macZip: x('mac', 'mac', 'zip', 'arm64'),
      dmg: x('dmg', 'mac', 'dmg', 'arm64'),
      appImage: x('appImage', 'linux', 'AppImage'),
      deb: x('deb', 'linux', 'deb', 'amd64'),
    };
  } finally {
    if (saved === undefined) delete process.env.BUILD_NUMBER;
    else process.env.BUILD_NUMBER = saved;
  }
}

test('with BUILD_NUMBER set, every installer file name carries the fourth part', () => {
  const n = names(2);
  assert.equal(n.buildVersion, '0.1.8.2');
  assert.deepEqual(
    [n.nsis, n.winZip, n.macZip, n.dmg, n.appImage, n.deb],
    ['Sequence Setup 0.1.8.2.exe', 'Sequence-0.1.8.2-win.zip', 'Sequence-0.1.8.2-arm64-mac.zip', 'Sequence-0.1.8.2-arm64.dmg', 'Sequence-0.1.8.2.AppImage', 'Sequence-0.1.8.2-amd64.deb'],
  );
});

test('without BUILD_NUMBER (a three-part tag) the names are the three-part ones, and keep the shapes the updater matches', () => {
  const n = names(null);
  assert.equal(n.buildVersion, '0.1.8');
  assert.equal(n.nsis, 'Sequence Setup 0.1.8.exe');
  assert.match(n.winZip, /-win\.zip$/, 'appUpdate.ts pickAsset matches the portable zip by -win.zip');
  assert.match(n.macZip, /-mac\.zip$/, 'appUpdate.ts pickMacUpdate matches the mac zip by -mac.zip');
  assert.match(n.nsis, /setup/i, 'pickAsset prefers the .exe whose name has "setup"');
  for (const v of Object.values(n)) assert.doesNotMatch(String(v), /0\.1\.8\.\d/);
});
