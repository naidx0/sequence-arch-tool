import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * D5: the owner keeps the ML pack in the build. The installer stages packages/analyzer/components
 * whole (prepare-server.mjs), so this pins the two things a later filter would have to change:
 * the ml group in groups.json and the ml components next to it, plus that the staging script and
 * electron-builder do not name the pack.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS = path.join(ROOT, 'packages', 'analyzer', 'components');

test('the ml group is in the shipped groups.json and has components', () => {
  const groups = JSON.parse(fs.readFileSync(path.join(COMPONENTS, 'groups.json'), 'utf8')).groups.map((g) => g.id);
  assert.ok(groups.includes('ml'), `groups: ${groups.join(', ')}`);
  const comps = fs.readdirSync(path.join(COMPONENTS, 'ml'), { withFileTypes: true }).filter((e) => e.isDirectory());
  assert.ok(comps.length > 0);
  for (const c of comps) assert.ok(fs.existsSync(path.join(COMPONENTS, 'ml', c.name, 'component.json')), c.name);
});

test('neither the staging script nor electron-builder filters the ml pack out', () => {
  for (const rel of ['packages/desktop/scripts/prepare-server.mjs', 'packages/desktop/scripts/prune-bundle.cjs', 'packages/desktop/electron-builder.yml']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/components[\/]ml|stripUnshippedComponents/.test(text), `${rel} names the ml pack`);
  }
});
