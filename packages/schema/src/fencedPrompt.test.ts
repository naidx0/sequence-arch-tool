import assert from 'node:assert/strict';
import test from 'node:test';

import { extractFencedPrompt } from './fencedPrompt.js';

test('takes the content of a fenced block, trimmed, whatever the language tag', () => {
  assert.equal(extractFencedPrompt('Analysis.\n\n```\nDo the deeper thing.\n```\n\nWant me to run it?'), 'Do the deeper thing.');
  assert.equal(extractFencedPrompt('x\n```text\nline one\nline two\n```'), 'line one\nline two');
  assert.equal(extractFencedPrompt('x\n~~~\ntilde fence\n~~~'), 'tilde fence');
});

test('the last complete block wins, because the rewrite is what comes last', () => {
  assert.equal(extractFencedPrompt('Quote:\n```\nfirst\n```\nRewrite:\n```\nsecond\n```'), 'second');
});

test('a longer fence holds a shorter one inside it', () => {
  assert.equal(extractFencedPrompt('````\nRun:\n```\npnpm test\n```\nthen stop\n````'), 'Run:\n```\npnpm test\n```\nthen stop');
});

test('CRLF answers parse the same', () => {
  assert.equal(extractFencedPrompt('a\r\n```\r\nbody\r\n```\r\n'), 'body');
});

test('no block, an empty block, an unclosed block, and non-text are all null (negative controls)', () => {
  assert.equal(extractFencedPrompt('just prose'), null);
  assert.equal(extractFencedPrompt('```\n\n```'), null);
  assert.equal(extractFencedPrompt('```\ncut off mid-answer'), null);
  assert.equal(extractFencedPrompt(''), null);
  assert.equal(extractFencedPrompt(undefined as unknown as string), null);
});

test('inline backticks are not a block', () => {
  assert.equal(extractFencedPrompt('use ```code``` inline'), null);
});
