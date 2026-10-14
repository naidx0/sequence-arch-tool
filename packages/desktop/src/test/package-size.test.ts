import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

/* ── 0.1.8.1 D2 (audit M1/L9): the server the installer carries is < 60 MB ──
   Measured on the assembled bundle (`server-bundle/`, which electron-builder
   copies to resources/server). Building it is `prepare-server` (pnpm deploy,
   minutes), which `pnpm dist` runs and this unit suite does not; so the budget
   is checked whenever the bundle exists and the test says so when it does not. */

const BUDGET_BYTES = 60 * 1000 * 1000;
const BUNDLE = path.join(DESKTOP, 'server-bundle');

function sizeOf(p: string): number {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of fs.readdirSync(p)) n += sizeOf(path.join(p, e));
  return n;
}

test('D2: resources/server (the prepared server-bundle) is under 60 MB, with only the grammars the scanner loads', async (t) => {
  if (!fs.existsSync(path.join(BUNDLE, 'packages', 'analyzer', 'dist', 'sequence-server-entry.cjs'))) {
    t.skip('server-bundle/ is not built here; run `pnpm --filter @sequence/desktop prepare-server` to measure it');
    return;
  }
  const bytes = sizeOf(BUNDLE);
  t.diagnostic(`server-bundle: ${(bytes / 1e6).toFixed(1)} MB`);
  assert.ok(bytes < BUDGET_BYTES, `resources/server is ${(bytes / 1e6).toFixed(1)} MB; the budget is 60 MB`);
  const wasm = path.join(BUNDLE, 'packages', 'analyzer', 'node_modules', '@vscode', 'tree-sitter-wasm', 'wasm');
  const grammars = fs.readdirSync(wasm).filter((f) => /^tree-sitter-.+\.wasm$/.test(f)).sort();
  const dynImport = new Function('u', 'return import(u)') as (u: string) => Promise<{ LOADED_GRAMMARS: readonly string[] }>;
  const m = await dynImport(pathToFileURL(path.resolve(DESKTOP, '..', 'analyzer', 'dist', 'parse', 'treesitter.js')).href);
  assert.deepStrictEqual(grammars, [...m.LOADED_GRAMMARS].sort());
});
