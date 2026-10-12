import assert from 'node:assert';
import { test } from 'node:test';

import { ASK_LEDGER_INSTRUCTION, followUpPrompt, isAskAgain, parseAskLine, stripAskLine } from './askLedger.js';

test('the instruction asks the agent to split, in its own words, with no list from the app', () => {
  assert.match(ASK_LEDGER_INSTRUCTION, /several separate requests/);
  assert.match(ASK_LEDGER_INSTRUCTION, /in your own words/);
  assert.match(ASK_LEDGER_INSTRUCTION, /For a single request, write no such line/);
  assert.doesNotMatch(ASK_LEDGER_INSTRUCTION, /\n1\. /, 'no numbered list of asks from the app');
});

test('the final line is read: requests in the agent’s words, done or not done with a reason', () => {
  const r = parseAskLine('Fixed it.\n<asks>1 fix the login redirect: done; 2 add a test: not done: no test runner here; 3 rename authUtil: done</asks>\n');
  assert.deepStrictEqual(r, {
    closures: [
      { n: 1, text: 'fix the login redirect', done: true, reason: null },
      { n: 2, text: 'add a test', done: false, reason: 'no test runner here' },
      { n: 3, text: 'rename authUtil', done: true, reason: null },
    ],
    open: [2],
  });
});

test('the grammar is tolerant of the forms agents write', () => {
  const forms = ['1 - done', 'Ask 1: done', '1. done', '#1 done', '1) done', 'Request 1 — done', '1 the meter row: done'];
  for (const f of forms) assert.deepStrictEqual(parseAskLine(`ok\n<asks>${f}; 2 - not done - needs your call</asks>`)?.open, [2], f);
  assert.strictEqual(parseAskLine(`ok\n<asks>1 | done</asks>`), null, 'nothing parseable: no report, nothing shown');
});

test('commas separate entries, "failed" is not done, and a line that does not parse whole is never cut', () => {
  const comma = parseAskLine('Did x.\n<asks>1 fix x: done, 2 add y: not done: no runner</asks>');
  assert.deepStrictEqual(comma?.open, [2]);
  assert.strictEqual(comma?.closures[1]!.reason, 'no runner');
  const failed = 'Did x.\n<asks>1 fix x: done; 2 add y: failed, tests broke</asks>';
  assert.deepStrictEqual(parseAskLine(failed)?.closures[1], { n: 2, text: 'add y', done: false, reason: 'tests broke' });
  assert.strictEqual(stripAskLine(failed), 'Did x.');
  const odd = 'Did x.\n<asks>1 fix x: done; 2 add y: ✅ mostly</asks>';
  assert.strictEqual(parseAskLine(odd), null);
  assert.strictEqual(stripAskLine(odd), odd, 'an entry the app cannot read keeps the whole line visible');
});

test('only a well-formed line at the very end counts; mentions elsewhere are the agent’s text', () => {
  const mid = 'I added parsing of the `<asks>` tag. Tests pass.';
  assert.strictEqual(stripAskLine(mid), mid);
  assert.strictEqual(parseAskLine(mid), null);
  const twice = 'I wired <asks> parsing.\n<asks>1 done; 2 done</asks>';
  assert.strictEqual(stripAskLine(twice), 'I wired <asks> parsing.', 'only the last line goes');
  const fence = 'The format is:\n```\n<asks>1 done</asks>';
  assert.strictEqual(stripAskLine(fence), fence, 'inside an open code fence it is quoted text');
  assert.strictEqual(parseAskLine(fence), null);
  const notLast = '<asks>1 done</asks>\nand then more text';
  assert.strictEqual(stripAskLine(notLast), notLast);
  assert.strictEqual(parseAskLine('Single request done.'), null, 'no line: nothing to show');
});

test('while streaming, only a line that has begun to be the closing line is hidden', () => {
  assert.strictEqual(stripAskLine('Done.\n<asks>1 fix: done; 2', true), 'Done.');
  assert.strictEqual(stripAskLine('Done.\n<as', true), 'Done.');
  assert.strictEqual(stripAskLine('Use <as', true), 'Use <as', 'mid-line is text');
  assert.strictEqual(stripAskLine('Done.\n<as', false), 'Done.\n<as', 'once finished only the full line goes');
});

test('the follow-up names the requests and is never ledgered again', () => {
  const t = followUpPrompt([{ text: 'add a test', reason: 'no test runner here' }]);
  assert.match(t, /^Your reply marked this request not done:\n- add a test \(you said: no test runner here\)/);
  assert.ok(isAskAgain(t));
  assert.ok(!isAskAgain('fix the login redirect, and add a test'));
});
