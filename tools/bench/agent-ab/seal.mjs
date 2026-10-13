#!/usr/bin/env node
/*
 * node tools/bench/agent-ab/seal.mjs [--record] [--write]
 *
 *   --record  run every task's reference solution and write the number of passing tests it produces into
 *             task.json as expect.pass (and editable, default ["src/"]). The scorer requires exactly that count.
 *   --write   write the sha256 of the task set into tasks/SEALED.md.
 * With neither flag: print the hash. Run --record, then --write, before any arm runs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TASKS_DIR, listTasks, sealHash, copyRepo, applySolution, runScoredTest } from './taskset.mjs';

if (process.argv.includes('--record')) {
  for (const t of listTasks()) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-record-'));
    try {
      copyRepo(t, d);
      applySolution(t, d);
      const { r, counts: c, names } = runScoredTest(t, d);
      if (r.status !== 0 || c.fail !== 0 || !(c.pass >= 1) || names.notOk.length || names.ok.length !== c.pass) throw new Error(`${t.id}: reference solution does not pass cleanly (${JSON.stringify(c)} ${JSON.stringify(names)})`);
      const file = path.join(t.dir, 'task.json');
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      j.editable = j.editable ?? ['src/'];
      j.expect = { pass: c.pass, tests: [...names.ok].sort() };
      fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  }
}

const h = sealHash();
const n = listTasks().length;
if (process.argv.includes('--write')) {
  fs.writeFileSync(
    path.join(TASKS_DIR, 'SEALED.md'),
    [
      '# Sealed task set',
      '',
      `sha256: \`${h}\``,
      '',
      `${n} tasks. The hash covers every file under tasks/ except this one: sorted lines of`,
      '`relative path <tab> sha256 of the file with CRLF normalised to LF`, joined by LF with a final LF, hashed with sha256.',
      'task.json carries `editable` (the only paths an agent may change) and `expect.pass` (the number of passing tests the reference',
      'solution produces; the scorer requires exactly that count, so exit code 0 with no tests run does not score).',
      'Recompute with `node tools/bench/agent-ab/seal.mjs`. `taskset.test.mjs` fails if the set no longer matches this hash.',
      'Written before any agent arm ran. Changing a task means a new set, a new hash, and re-running both arms.',
      '',
    ].join('\n'),
  );
}
console.log(`${h}  ${n} tasks`);
