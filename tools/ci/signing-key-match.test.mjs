import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const keyOf = (src) => /export const SIGNING_PUBLIC_KEY: string \| null = ((?:`[\s\S]*?`)|null);/.exec(src)?.[1];

test('the desktop pins the same release-signing key as the analyzer (main verifies SHASUMS256.txt with it)', () => {
  const server = keyOf(read('packages', 'analyzer', 'src', 'server', 'appUpdate.ts'));
  const desktop = keyOf(read('packages', 'desktop', 'src', 'signingKey.ts'));
  assert.ok(server !== undefined, 'the analyzer declares SIGNING_PUBLIC_KEY');
  assert.ok(desktop !== undefined, 'the desktop declares SIGNING_PUBLIC_KEY');
  assert.equal(desktop, server);
});
