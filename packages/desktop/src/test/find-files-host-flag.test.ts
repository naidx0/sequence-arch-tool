import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * server-control.ts spares the analyzer's shared find_files host on quit by its
 * command-line flag. The desktop package cannot import the (ESM) analyzer, so
 * the literal is repeated there; this test fails if the analyzer renames it.
 * (Runs from dist/test, so the repo paths are resolved relative to that.)
 */
test("the analyzer still declares FIND_FILES_HOST_FLAG = '--find-files-host'", () => {
  const src = path.resolve(__dirname, '..', '..', '..', 'analyzer', 'src', 'explain', 'findFilesHost.ts');
  assert.match(fs.readFileSync(src, 'utf8'), /export const FIND_FILES_HOST_FLAG = '--find-files-host';/);
  const ctl = path.resolve(__dirname, '..', '..', 'src', 'server-control.ts');
  assert.match(fs.readFileSync(ctl, 'utf8'), /const SHARED_HOST_FLAG = '--find-files-host';/);
});
