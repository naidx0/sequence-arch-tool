#!/usr/bin/env node
/**
 * The per-repo child process.
 *
 * Spawned once per repository by `lib/runner.mjs`. It loads the engine, measures
 * exactly one repo, writes the resulting JSONL row to the file named by `--out`,
 * and exits. Then the whole process — WASM heap included — goes away.
 *
 * The row travels through a FILE rather than stdout because the engine and the
 * emscripten runtime both write to stdout/stderr, and those streams are
 * inherited so a human still sees them live. Mixing the machine-readable row
 * into that would make the harness's own evidence trail parse-dependent on
 * whatever the scanner decided to print.
 *
 * Usage: node lib/child.mjs --job <job.json> --out <row.json>
 */
import fs from 'node:fs';

import { loadEngine, measureRepo, failureRow, serializeError } from './measure.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) throw new Error(`child.mjs needs ${name} <path>`);
  return process.argv[i + 1];
}

const jobFile = arg('--job');
const outFile = arg('--out');
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));

let row;
try {
  const engine = await loadEngine();
  row = await measureRepo(engine, job.row, job.dir, job.opts);
} catch (err) {
  // A failure to even load the engine is still a row, not a silent exit — the
  // parent would otherwise only be able to say "the child died".
  row = failureRow(job.row, job.dir, 0, serializeError(err));
}
fs.writeFileSync(outFile, JSON.stringify(row));
// Do not wait for the WASM runtime to unwind: the row is on disk, and this
// process exists to be thrown away.
process.exit(0);
