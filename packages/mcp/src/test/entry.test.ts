import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { isEntry } from '../server.js';

/* The 0.1.4 macOS release build: the board server was started through a linked folder (/var -> /private/var),
   its own path read as the real one, the plain comparison said "not the entry", and it exited 0 without serving. */
test('the server knows it is the entry when started through a linked folder', () => {
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-entry-real-')));
  const link = path.join(os.tmpdir(), `seq-entry-link-${process.pid}-${Date.now()}`);
  try {
    const file = path.join(real, 'sequence-mcp.cjs');
    fs.writeFileSync(file, '// bundle\n');
    fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    const viaLink = path.join(link, 'sequence-mcp.cjs');
    assert.notEqual(pathToFileURL(viaLink).href, pathToFileURL(file).href, 'the two spellings differ, as on macOS');
    assert.equal(isEntry(pathToFileURL(file).href, viaLink), true);
    assert.equal(isEntry(pathToFileURL(file).href, file), true);
    assert.equal(isEntry(pathToFileURL(file).href, path.join(real, 'other.cjs')), false);
    assert.equal(isEntry(pathToFileURL(file).href, undefined), false);
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(real, { recursive: true, force: true });
  }
});
