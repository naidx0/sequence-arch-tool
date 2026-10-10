import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';
import { parseAnswer, scoreAnswer } from './score.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));

test('parseAnswer takes the last files object and ignores prose around it', () => {
  const text = 'I looked.\n{"files": ["a.ts"]}\nOn reflection:\n{"files": ["b.ts", "c.py", "b.ts"]}';
  assert.deepEqual(parseAnswer(text), ['b.ts', 'c.py']);
  assert.deepEqual(parseAnswer('no json here'), []);
  assert.deepEqual(parseAnswer('{"files": not json}'), []);
});

test('scoreAnswer: exact, partial, wrong, and path spellings', () => {
  const q = { answer: ['src/a.ts', 'svc/b.py'] };
  assert.equal(scoreAnswer(q, ['src/a.ts', 'svc/b.py']).exact, true);
  const half = scoreAnswer(q, ['src/a.ts', 'x.ts']);
  assert.equal(half.precision, 0.5);
  assert.equal(half.recall, 0.5);
  assert.equal(scoreAnswer(q, []).f1, 0);
  /* Windows separators, ./ prefixes, absolute paths and :line suffixes are the same file. */
  const spelled = scoreAnswer(q, ['.\\src\\a.ts', 'C:/work/repo/svc/b.py:42']);
  assert.equal(spelled.exact, true);
});

test('the runner scores the mock agent: sequence arm exact, plain arm half', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ab-test-'));
  const qf = path.join(dir, 'q.json');
  const rf = path.join(dir, 'repos.json');
  fs.writeFileSync(qf, JSON.stringify({ questions: [{ id: 't-1', repo: 'r', type: 'who_calls', question: 'who calls x?', answer: ['a.ts', 'b.ts'] }] }));
  fs.writeFileSync(rf, JSON.stringify({ r: dir }));
  const rows = {};
  for (const arm of ['plain', 'sequence']) {
    const out = path.join(dir, `${arm}.jsonl`);
    execFileSync(process.execPath, [path.join(HERE, 'run.mjs'), '--questions', qf, '--repos', rf, '--agent', 'mock', '--arm', arm, '--out', out], { stdio: 'ignore' });
    rows[arm] = JSON.parse(fs.readFileSync(out, 'utf8').trim());
  }
  assert.equal(rows.sequence.exact, true);
  assert.equal(rows.plain.recall, 0.5);
  assert.equal(rows.plain.precision, 0.5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bash agent: vet refuses writes, .sequence/, and the map in the plain arm', async () => {
  const { vet, extractBash, runBashAgent } = await import('./bash-agent.mjs');
  assert.equal(vet('grep -rn payments . | head -20', 'plain'), null);
  assert.equal(vet("sed -n '1,40p' app/db.py", 'plain'), null);
  assert.match(vet('echo hi > x.txt', 'plain'), /refused/);
  assert.match(vet('rm -rf src', 'plain'), /refused/);
  assert.match(vet('cat .sequence/graph.json', 'sequence'), /off limits/);
  assert.match(vet('sequence-map who_calls payments', 'plain'), /not available/);
  assert.equal(vet('sequence-map who_calls payments', 'sequence'), null);
  assert.match(vet('git checkout main', 'plain'), /only git/);
  assert.equal(extractBash('THOUGHT: look\n```bash\nls -la\n```'), 'ls -la');
  assert.equal(extractBash('{"files": ["a"]}'), null);

  /* A scripted model: one command, then the answer. The loop must run it and stop. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-agent-'));
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;\n');
  const replies = ['THOUGHT: list\n```bash\nls\n```', '{"files": ["a.ts"]}'];
  const seen = [];
  const r = await runBashAgent({
    question: 'which file?',
    cwd: dir,
    arm: 'plain',
    llm: async (msgs) => {
      seen.push(msgs.at(-1).content);
      return { text: replies.shift(), tin: 10, tout: 2 };
    },
  });
  assert.equal(r.toolCalls, 1);
  assert.match(seen[1], /a\.ts/);
  assert.deepEqual(parseAnswer(r.last), ['a.ts']);
  fs.rmSync(dir, { recursive: true, force: true });
});
