import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROGRAM_RUN_LOG_HEADER } from '@sequence/schema';
import { appendProgramRunLog, readProgramEditAllowlist, readProgramStrategy } from '../server/programMemory.js';

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-program-mem-'));
}

test('readProgramEditAllowlist parses ## Agent may edit section', () => {
  const repo = tempRepo();
  const dir = path.join(repo, '.sequence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'program.md'),
    '# Strategy\n\n## Agent may edit\n\npay/**\n\n## Loop\n',
    'utf8',
  );
  assert.deepStrictEqual(readProgramEditAllowlist(repo), ['pay/**']);
});

test('readProgramEditAllowlist is undefined when section absent', () => {
  const repo = tempRepo();
  const dir = path.join(repo, '.sequence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'program.md'), '# Strategy\nLOOP until checker clean.\n', 'utf8');
  assert.strictEqual(readProgramEditAllowlist(repo), undefined);
});

test('readProgramStrategy returns markdown when present', () => {
  const repo = tempRepo();
  const dir = path.join(repo, '.sequence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'program.md'), '# Strategy\nLOOP until checker clean.\n', 'utf8');
  assert.match(readProgramStrategy(repo)!, /LOOP until checker/);
});

test('readProgramStrategy is undefined when absent', () => {
  const repo = tempRepo();
  assert.strictEqual(readProgramStrategy(repo), undefined);
});

test('appendProgramRunLog writes header + row under .sequence/runs/', () => {
  const repo = tempRepo();
  appendProgramRunLog(repo, {
    runId: 'run-1',
    programId: 'dogfood-loop',
    metric: 'steps:4',
    status: 'keep',
    description: 'completed clean',
  });
  const p = path.join(repo, '.sequence', 'runs', 'results.tsv');
  const body = fs.readFileSync(p, 'utf8');
  assert.ok(body.startsWith(PROGRAM_RUN_LOG_HEADER));
  assert.match(body, /run-1\tdogfood-loop\tsteps:4\tkeep/);
  appendProgramRunLog(repo, {
    runId: 'run-2',
    programId: 'dogfood-loop',
    metric: 'steps:1',
    status: 'crash',
    description: 'node error',
  });
  const body2 = fs.readFileSync(p, 'utf8');
  assert.equal(body2.split('\n').filter(Boolean).length, 3);
});
