import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  loadPluginManifestV0,
  parsePluginManifestV0,
  PLUGIN_MANIFEST_FILE,
} from '../server/pluginManifest.js';
import { SEQUENCE_DIR } from '../server/store.js';

test('parsePluginManifestV0: empty plugins ok', () => {
  const r = parsePluginManifestV0({ version: 0, plugins: [] });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.manifest.plugins, []);
});

test('parsePluginManifestV0: accepts readonly tool entry', () => {
  const r = parsePluginManifestV0({
    version: 0,
    plugins: [
      {
        id: 'docs-search',
        title: 'Docs search',
        mode: 'readonly',
        tools: [{ name: 'search_docs', description: 'Find a page' }],
      },
    ],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.manifest.plugins[0]!.id, 'docs-search');
    assert.equal(r.manifest.plugins[0]!.tools[0]!.name, 'search_docs');
  }
});

test('parsePluginManifestV0: refuses non-readonly mode (v0)', () => {
  const r = parsePluginManifestV0({
    version: 0,
    plugins: [{ id: 'shell', mode: 'write', tools: [{ name: 'run' }] }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /readonly/);
});

test('parsePluginManifestV0: refuses duplicate ids', () => {
  const r = parsePluginManifestV0({
    version: 0,
    plugins: [
      { id: 'a', mode: 'readonly', tools: [] },
      { id: 'a', mode: 'readonly', tools: [] },
    ],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /repeats/);
});

test('loadPluginManifestV0: missing file is empty success', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-plugins-'));
  const r = loadPluginManifestV0(dir);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.path, null);
    assert.deepEqual(r.manifest.plugins, []);
  }
});

test('loadPluginManifestV0: reads valid on-disk manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-plugins-'));
  const seq = path.join(dir, SEQUENCE_DIR);
  fs.mkdirSync(seq, { recursive: true });
  fs.writeFileSync(
    path.join(seq, PLUGIN_MANIFEST_FILE),
    JSON.stringify({
      version: 0,
      plugins: [{ id: 'ro', mode: 'readonly', tools: [{ name: 'ping' }] }],
    }),
  );
  const r = loadPluginManifestV0(dir);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.path?.endsWith(PLUGIN_MANIFEST_FILE));
    assert.equal(r.manifest.plugins[0]!.tools[0]!.name, 'ping');
  }
});

test('loadPluginManifestV0: invalid JSON is honest failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-plugins-'));
  const seq = path.join(dir, SEQUENCE_DIR);
  fs.mkdirSync(seq, { recursive: true });
  fs.writeFileSync(path.join(seq, PLUGIN_MANIFEST_FILE), '{not-json');
  const r = loadPluginManifestV0(dir);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /not valid JSON/);
});
