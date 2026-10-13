import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_MANIFEST, listAppFiles, writeAppManifest } from '../../packages/desktop/scripts/app-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the manifest lists every file under the app folder, relative with forward slashes, without itself', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-manifest-'));
  fs.mkdirSync(path.join(d, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(d, 'Sequence.exe'), 'x');
  fs.writeFileSync(path.join(d, 'resources', 'app.asar'), 'x');
  fs.writeFileSync(path.join(d, 'resources', 'app', 'a b.txt'), 'x');
  assert.equal(writeAppManifest(d), 3);
  const m = JSON.parse(fs.readFileSync(path.join(d, APP_MANIFEST), 'utf8'));
  assert.deepEqual(m, { v: 1, files: ['Sequence.exe', 'resources/app.asar', 'resources/app/a b.txt'] });
  assert.deepEqual(listAppFiles(d), m.files, 'a second listing does not include the manifest it wrote');
});

test('afterPack writes the manifest on win32 only, so the zip target packs it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'packages', 'desktop', 'scripts', 'adhoc-sign.mjs'), 'utf8');
  assert.match(src, /electronPlatformName === 'win32'\) console\.log\(`app-manifest: \$\{writeAppManifest\(context\.appOutDir\)\}/);
  const yml = fs.readFileSync(path.join(ROOT, 'packages', 'desktop', 'electron-builder.yml'), 'utf8');
  assert.match(yml, /afterPack: scripts\/adhoc-sign\.mjs/);
});
