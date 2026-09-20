/**
 * A RUN MUST LEAVE THE COUNT OF `sequence-*` ENTRIES IN `os.tmpdir()` UNCHANGED.
 *
 * Built from the reported shape: `%TEMP%` held 598,408 `sequence-*` directories
 * on 2026-09-10, every one of them created by a test process in this package
 * and left behind. The number is what makes this a defect; the mechanism is
 * that nothing ever removed them.
 *
 * WHY THIS SPAWNS A CHILD INSTEAD OF COUNTING THE MACHINE'S REAL `%TEMP%`.
 * Counting the real one is a full directory scan - 45 seconds on the machine
 * where this was measured, and the answer moves under you whenever any other
 * lane runs anything. So the child gets `TEMP`/`TMP` of its own. That is not a
 * proxy for `os.tmpdir()`: on Windows `os.tmpdir()` reads exactly those
 * variables, so inside the child this IS `os.tmpdir()`, with a denominator
 * small enough to count exactly and no other process writing into it.
 *
 * THE TEST HAS TO BE ABLE TO FAIL, so it does not merely assert "after is
 * zero" - a child that created nothing would pass that. It asserts the child
 * reported creating directories, that they were inside its `os.tmpdir()`, and
 * that they are gone. Delete the `process.on('exit')` hook in
 * `isolate-user-store.ts` and this goes red with after=4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(HERE, 'isolate-user-store.js');

function countSequenceEntries(dir: string): number {
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('sequence-')).length;
}

test('a test run leaves no sequence-* entries in os.tmpdir()', () => {
  assert.ok(fs.existsSync(PRELOAD), `preload not built: ${PRELOAD}`);

  /* Inside this process's own run root, so the sandbox is itself cleaned up by
     the mechanism under test - which is the point. */
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leakcheck-'));

  /* A stand-in for a test file: it does what the 271 real call sites do -
     `mkdtempSync` under `os.tmpdir()` with a `sequence-` prefix - and reports
     what it made, so this test can prove the run was not a no-op. */
  const child = path.join(sandbox, 'child.mjs');
  fs.writeFileSync(
    child,
    [
      "import fs from 'node:fs';",
      "import os from 'node:os';",
      "import path from 'node:path';",
      'const made = [];',
      'for (let i = 0; i < 3; i++) {',
      "  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-leakcheck-'));",
      "  fs.writeFileSync(path.join(d, 'f.txt'), 'x');",
      '  made.push(d);',
      '}',
      'console.log(JSON.stringify({ tmpdir: os.tmpdir(), made }));',
    ].join('\n'),
    'utf8',
  );

  const before = countSequenceEntries(sandbox);

  const stdout = execFileSync(
    process.execPath,
    ['--import', pathToFileURL(PRELOAD).href, child],
    {
      encoding: 'utf8',
      env: { ...process.env, TEMP: sandbox, TMP: sandbox, SEQUENCE_USER_DIR: '' },
    },
  );

  const report = JSON.parse(stdout.trim().split('\n').pop() as string) as {
    tmpdir: string;
    made: string[];
  };

  /* The run really happened, and really used `os.tmpdir()`. Without these two
     the assertion below is satisfied by a child that did nothing at all. */
  assert.equal(report.made.length, 3, 'child did not create its temp directories');
  for (const dir of report.made) {
    assert.ok(
      path.resolve(dir).startsWith(path.resolve(report.tmpdir)),
      `child wrote outside its own os.tmpdir(): ${dir}`,
    );
  }

  const after = countSequenceEntries(sandbox);
  assert.equal(
    after,
    before,
    `run leaked ${after - before} sequence-* entries into os.tmpdir(): ` +
      fs
        .readdirSync(sandbox)
        .filter((n) => n.startsWith('sequence-'))
        .join(', '),
  );
});

/*
 * A DEPENDENCY'S WORKER IS NOT A TEST, AND MUST NOT GET A TEMP ROOT.
 *
 * Measured: one analyzer run created 315 run roots and leaked exactly 12, all
 * of them `node_modules/node-pty/lib/worker/conoutSocketWorker.js`. node-pty
 * spawns that worker with our flags and tears it down by terminating it, so no
 * exit handler runs and its root survives.
 *
 * The shape is reproduced exactly - an entry point under `node_modules`, run
 * with the preload - rather than by asserting on the flag the fix happens to
 * use, so the test still holds if the discriminator is ever changed.
 *
 * AND THE WORKER IS KILLED, NOT EXITED, WHICH IS THE ONLY REASON THIS IS A
 * GATE. The first cut let the stand-in worker return normally - so its exit
 * handler ran, its root was cleaned, and the test passed with the fix REMOVED.
 * A check that cannot fail in the state it exists to check is not a check.
 * node-pty terminates that worker, so the test does too, and only a process
 * that was never given a root can now come through clean.
 */
test('a dependency worker that is killed leaves no run root behind', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leakcheck-worker-'));
  const workerDir = path.join(sandbox, 'node_modules', 'some-dep', 'lib', 'worker');
  fs.mkdirSync(workerDir, { recursive: true });

  /* A marker file rather than stdout: the process dies without flushing. */
  const marker = path.join(sandbox, 'ran.txt');
  const worker = path.join(workerDir, 'conoutSocketWorker.js');
  fs.writeFileSync(
    worker,
    [
      "const fs = require('node:fs');",
      "const os = require('node:os');",
      `fs.writeFileSync(${JSON.stringify(marker)}, os.tmpdir());`,
      '/* How node-pty ends it: terminated, so no exit handler ever runs. */',
      "process.kill(process.pid, 'SIGKILL');",
    ].join('\n'),
    'utf8',
  );

  try {
    execFileSync(process.execPath, ['--import', pathToFileURL(PRELOAD).href, worker], {
      encoding: 'utf8',
      stdio: 'ignore',
      env: { ...process.env, TEMP: sandbox, TMP: sandbox, SEQUENCE_USER_DIR: '' },
    });
  } catch {
    /* Being killed is the point; a non-zero exit here is expected. */
  }

  /* It really ran and really died mid-flight - otherwise "created nothing" is
     trivially true of a process that never started. */
  assert.ok(fs.existsSync(marker), 'the stand-in worker never ran');

  const leaked = fs.readdirSync(sandbox).filter((n) => n.startsWith('sequence-'));
  assert.deepEqual(
    leaked,
    [],
    `a dependency worker was given a temp root it can never clean up: ${leaked.join(', ')}`,
  );
});
