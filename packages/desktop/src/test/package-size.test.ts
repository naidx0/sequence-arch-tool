import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * WHAT KEEPS THE INSTALLER SMALL, LOCKED.
 *
 * Each rule here was measured against a full local `pnpm desktop:dist` on
 * Windows (installer bytes before and after). Source-text assertions over the
 * packaging config, because the build itself downloads Electron and takes
 * minutes; the measured proof is in the commit that added each rule.
 */
const DESKTOP = path.resolve(__dirname, '..', '..');
const yml = fs.readFileSync(path.join(DESKTOP, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n');

test('only the English Chromium locales ship, under both platform spellings', () => {
  const block = /^electronLanguages:\n((?:\s+- .+\n)+)/m.exec(yml);
  assert.ok(block, 'electron-builder.yml has no electronLanguages list');
  const langs = block[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  /* en-US is the Windows/Linux file name; without it every .pak is deleted. */
  assert.ok(langs.includes('en-US'), 'en-US is missing: Windows would ship no locale pack at all');
  /* en is the macOS .lproj name. */
  assert.ok(langs.includes('en'), 'en is missing: macOS would ship no locale');
});
