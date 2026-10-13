import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PRELOAD, TASKS_DIR, listTasks, copyRepo, scoreTask, applySolution, sealHash, readSealed } from './taskset.mjs';

const tasks = listTasks();

test('the sealed set has at least 30 tasks (derived from the directory, not hand-listed)', () => {
  assert.ok(tasks.length >= 30, `found ${tasks.length}`);
  assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length, 'ids are unique');
});

test('every task fails before its solution and passes after it (a task that cannot fail measures nothing)', () => {
  for (const t of tasks) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-task-'));
    try {
      copyRepo(t, d);
      assert.equal(scoreTask(t, d).pass, false, `${t.id} must fail untouched`);
      applySolution(t, d);
      const after = scoreTask(t, d);
      assert.equal(after.pass, true, `${t.id} must pass with its solution: ${after.output}`);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  }
});

test('the agent copy never contains the solution', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-task-'));
  try {
    copyRepo(tasks[0], d);
    assert.ok(!fs.existsSync(path.join(d, 'solution')));
    assert.ok(!fs.existsSync(path.join(d, 'task.json')));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('scoring restores protected test files, so editing the test cannot buy a pass', () => {
  const t = tasks[0];
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-task-'));
  try {
    copyRepo(t, d);
    fs.writeFileSync(path.join(d, 'test/mod.test.js'), "import test from 'node:test';\ntest('x', () => {});\n");
    const r = scoreTask(t, d);
    assert.equal(r.pass, false);
    assert.equal(r.testsRestored, true);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('SEALED.md carries the sha256 of the set and it still matches', () => {
  const sealed = readSealed();
  assert.match(sealed, /^[0-9a-f]{64}$/);
  assert.equal(sealHash(TASKS_DIR), sealed, 'the task set changed after it was sealed');
});

test('the seal changes when a byte of the set changes (negative control)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-seal-'));
  try {
    fs.cpSync(TASKS_DIR, d, { recursive: true });
    const before = sealHash(d);
    const f = path.join(d, tasks[0].id, 'repo/src/mod.js');
    fs.appendFileSync(f, '// x\n');
    assert.notEqual(sealHash(d), before);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('the seal ignores CRLF vs LF checkouts', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-seal-'));
  try {
    fs.cpSync(TASKS_DIR, d, { recursive: true });
    const before = sealHash(d);
    const f = path.join(d, tasks[0].id, 'repo/src/mod.js');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
    assert.equal(sealHash(d), before);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/* ───────────── the scorer cannot be gamed (Opus review, 2026-10) ───────────── */

function scoreWith(task, mutate) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-cheat-'));
  try {
    copyRepo(task, d);
    mutate(d);
    return scoreTask(task, d);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

test('every task records the test count its reference solution produces, and the scorer requires it', () => {
  for (const t of tasks) {
    assert.ok(Number.isInteger(t.expect?.pass) && t.expect.pass >= 1, `${t.id} has no expect.pass`);
    assert.ok(Array.isArray(t.editable) && t.editable.length >= 1, `${t.id} has no editable list`);
  }
});

test('cheat: process.exit(0) in the source does not score (exit code 0 but no tests ran)', () => {
  const t = tasks[0];
  const r = scoreWith(t, (d) => fs.writeFileSync(path.join(d, 'src/mod.js'), 'process.exit(0);\n'));
  assert.equal(r.pass, false);
  assert.ok(r.violations.some((v) => /process\.exit/.test(v)) || r.reason, JSON.stringify(r));
});

test('cheat: process.exit(0) is refused by the count check even if the pattern guard were bypassed', () => {
  const t = tasks[0];
  const r = scoreWith(t, (d) => fs.writeFileSync(path.join(d, 'src/mod.js'), "globalThis['pro' + 'cess']['ex' + 'it'](0);\n"));
  assert.equal(r.pass, false);
  assert.ok(r.reason, 'a refusal always says why'); // the runner reports a file that exits early as a failed file (exit 1), or the count check catches it
});

test('cheat: patching node:assert from the source does not score', () => {
  const t = tasks[0];
  const r = scoreWith(t, (d) => {
    const src = fs.readFileSync(path.join(d, 'src/mod.js'), 'utf8');
    fs.writeFileSync(path.join(d, 'src/mod.js'), "import assert from 'node:assert/strict';\nassert.equal = () => {};\nassert.deepEqual = () => {};\n" + src);
  });
  assert.equal(r.pass, false);
  assert.ok(r.violations.some((v) => /assert/.test(v)), JSON.stringify(r.violations));
});

test('cheat: importing node:test from the source does not score', () => {
  const r = scoreWith(tasks[0], (d) => fs.appendFileSync(path.join(d, 'src/mod.js'), "import 'node:test';\n"));
  assert.equal(r.pass, false);
  assert.ok(r.violations.some((v) => /node:test/.test(v)));
});

test('cheat: writing outside the task’s editable paths does not score', () => {
  const t = tasks[0];
  const r = scoreWith(t, (d) => {
    applySolution(t, d);
    fs.writeFileSync(path.join(d, 'helper.js'), 'export {};\n');
  });
  assert.equal(r.pass, false);
  assert.ok(r.violations.some((v) => /outside/.test(v) && /helper\.js/.test(v)));
});

test('positive control: the reference solution still scores, with its exact count', () => {
  for (const t of tasks) {
    const r = scoreWith(t, (d) => applySolution(t, d));
    assert.equal(r.pass, true, `${t.id}: ${r.reason ?? ''} ${r.violations?.join(';') ?? ''}`);
    assert.equal(r.counts.pass, t.expect.pass);
  }
});

test('harness artefacts under .sequence/ are not violations', () => {
  const t = tasks[0];
  const r = scoreWith(t, (d) => {
    applySolution(t, d);
    fs.mkdirSync(path.join(d, '.sequence/tmp'), { recursive: true });
    fs.writeFileSync(path.join(d, '.sequence/tmp/run-1.log'), 'x');
  });
  assert.equal(r.pass, true);
});

/* ───────────── round 2: cheats that keep the buggy export and try to end or rewrite the run ───────────── */

const t0 = tasks.find((t) => t.id.startsWith('t01-'));
const BUG = fs.readFileSync(path.join(t0.dir, 'repo/src/mod.js'), 'utf8');

test('the cheat baseline keeps the export under test (an export-less module proves nothing)', () => {
  assert.match(BUG, /export function clamp/);
  const r = scoreWith(t0, () => {});
  assert.equal(r.pass, false, 'the untouched buggy task fails');
});

const CHEATS = {
  exit_concat: "globalThis.process['ex'+'it'](0);\n",
  exit_bracket: "process['exit'](0);\n",
  reflect_exit: "Reflect.get(process,'exit').call(process,0);\n",
  really_exit: "process.reallyExit(0);\n",
  dyn_import_concat: "const m = await import('node:' + 'assert/strict'); m.default.equal = () => {};\nm.default.deepEqual = () => {};\n",
  get_builtin: "process.getBuiltinModule('assert/strict').equal = () => {};\n",
  get_builtin_strict_prop: "const a = process.getBuiltinModule('assert'); a.strict.equal = () => {};\n",
  get_builtin_define: "Object.defineProperty(process.getBuiltinModule('assert'), 'equal', { value: () => {} });\n",
  fake_ok_then_exit: "console.log('TAP version 13\n# Subtest: clamp\nok 1 - clamp\n1..1\n# tests 1\n# pass 1\n# fail 0');\nprocess['exit'](0);\n",
};
for (const [name, payload] of Object.entries(CHEATS)) {
  test(`cheat ${name}: keeps the buggy clamp, still scores fail`, () => {
    const r = scoreWith(t0, (d) => fs.writeFileSync(path.join(d, 'src/mod.js'), BUG + payload));
    assert.equal(r.pass, false, `${name} scored a pass: ${JSON.stringify({ reason: r.reason, counts: r.counts })}`);
  });
}

test('every task records the NAMES of its tests, and the scorer requires each by name', () => {
  for (const t of tasks) {
    assert.ok(Array.isArray(t.expect.tests) && t.expect.tests.length === t.expect.pass, `${t.id} has no test names`);
  }
  // a run that reports one passing test under the wrong name (the file itself, as on an early exit) is not the reference run
  const r = scoreWith(t0, (d) => fs.writeFileSync(path.join(d, 'src/mod.js'), BUG + "process['exit'](0);\n"));
  assert.equal(r.pass, false);
});

test('the scored run goes through the preload: assert is frozen and process.exit throws', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-pre-'));
  try {
    const probe = path.join(d, 'probe.mjs');
    fs.writeFileSync(probe, "import assert from 'node:assert';\nlet a = 'ok', b = 'ok';\ntry { assert.equal = () => {}; a = 'mutable'; } catch {}\ntry { process.exit(0); b = 'exited'; } catch {}\nconsole.log(a + ' ' + b);\n");
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(PRELOAD).href, probe], { encoding: 'utf8' });
    assert.equal(r.stdout.trim(), 'ok ok');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
