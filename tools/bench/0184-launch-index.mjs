// Replay only the measured file-partition hotspot over an immutable real walk.
// Input JSON: { files: absoluteNativePaths[], dirs: absoluteServiceRoots[] }.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { groupFilesUnder } from '../../packages/analyzer/dist/scan/fileGroups.js';

const bytes = fs.readFileSync(process.argv[2]);
const { files, dirs } = JSON.parse(bytes);
const hash = (groups) => {
  const h = createHash('sha256');
  for (const [dir, entries] of groups) {
    h.update(`${dir}\0`);
    for (const entry of entries) h.update(`${entry}\0`);
  }
  return h.digest('hex');
};
let start = performance.now();
const before = new Map(dirs.map((dir) => [dir, files.filter((file) => file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep))]));
const beforeMs = performance.now() - start;
const beforeHash = hash(before);
start = performance.now();
const after = groupFilesUnder(files, dirs);
const afterMs = performance.now() - start;
const afterHash = hash(after);
assert.equal(afterHash, beforeHash, 'membership AND order of every service must be identical');
console.log(JSON.stringify({ input: process.argv[2], inputSha256: createHash('sha256').update(bytes).digest('hex'),
  files: files.length, services: dirs.length, beforeMs, afterMs, beforeHash, afterHash }, null, 2));
