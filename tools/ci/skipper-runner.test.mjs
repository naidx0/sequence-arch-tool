/**
 * THE SKIPPER RUNNER'S SUCCESS PATH.
 *
 * Its refusal path was proved against a real report with no `questions` field.
 * The path that actually produces the deliverable was not, and "the error case
 * works" is the half of an instrument that never runs in anger.
 *
 * This drives the real script over a synthetic report, so the first time it meets
 * a genuine bench output is not the first time it has ever succeeded.
 */
import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = path.join(ROOT, 'tools', 'bench', 'skipper-eval.mjs');

function runOver(report) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skipper-'));
  const file = path.join(dir, 'report.json');
  fs.writeFileSync(file, JSON.stringify(report));
  const out = execFileSync('node', [RUNNER], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SKIPPER_REPORT: file },
  });
  return { out, dir };
}

test('the runner inventories questions, types them, and states its denominator', () => {
  const { out } = runOver({
    model: 'granite42-hermes',
    results: [
      {
        id: 'ml-01',
        turns: [
          {
            turn: 1,
            questions: [
              'Which service do you think it calls next?',
              'What happens when that queue backs up?',
            ],
          },
          { turn: 2, questions: ['Why does the scanner do this ahead of time?'] },
        ],
      },
      { id: 'ml-02', turns: [{ turn: 1, questions: [] }] },
    ],
  });

  assert.match(out, /model granite42-hermes/);
  /* The denominator is turns-with-the-field over turns, not a bare count: a
     report where half the turns predate the field is a different measurement
     from one where half the turns asked nothing. */
  assert.match(out, /turns with the field: 3 of 3; questions: 3/);
  assert.match(out, /"prediction":1/);
  assert.match(out, /"what-breaks-if":1/);
  assert.match(out, /"why":1/);
});

test('the inventory file is written and carries every row with its conversation id', () => {
  /* The rows are the input the scored run consumes; losing which conversation a
     question came from would make a defect unreportable by name, which is the
     one thing the deliverable has to do. */
  const { out } = runOver({
    model: 'm',
    results: [{ id: 'law-02', turns: [{ turn: 1, questions: ['Which one do you think wins?'] }] }],
  });
  const written = /wrote (.+skipper-inventory\.json)/.exec(out);
  assert.ok(written, `runner must name the file it wrote:\n${out}`);
  const inv = JSON.parse(fs.readFileSync(written[1].trim(), 'utf8'));
  assert.equal(inv.questions, 1);
  assert.equal(inv.rows[0].convo, 'law-02');
  assert.equal(inv.rows[0].type, 'prediction');
});

test('a report whose turns asked NOTHING is not the same as one that predates the field', () => {
  /*
   * Both yield zero questions and they are opposite findings. The field present
   * and empty is a real measurement — the lesson asked nothing. The field absent
   * is a report that cannot answer, and the runner must refuse that one.
   */
  const { out } = runOver({
    model: 'm',
    results: [{ id: 'x', turns: [{ turn: 1, questions: [] }] }],
  });
  assert.match(out, /turns with the field: 1 of 1; questions: 0/);
  /* And the summary says its share is NULL rather than 0% — 0/0 is not zero. */
  assert.match(out, /"goodShare":null/);

  assert.throws(
    () => runOver({ model: 'm', results: [{ id: 'x', turns: [{ turn: 1 }] }] }),
    /Command failed/,
    'a report with no questions field must exit non-zero, not report zero questions',
  );
});
