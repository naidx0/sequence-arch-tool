/**
 * THE MODEL MUST NOT BE ABLE TO ANSWER WITH ITS OWN CONTEXT.
 *
 * Found by hard-pathway testing, not by review: asked "which provider kinds does
 * validateAiConfig accept", granite4-hermes replied with 5,750 output tokens that
 * began `<untrusted_repo_content> {"repo":{"id":"repo",...` and the harness printed
 * the whole digest to the reader as the answer. 49.6s wall, on this repo.
 *
 * llm/untrusted.ts wraps repo-derived text so the model treats it as data. That guard
 * had no output half. These lock it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
  UNTRUSTED_ECHO_REFUSAL,
  answerEchoesUntrustedBlock,
} from '../llm/untrusted.js';

test('an answer carrying the untrusted sentinels is recognised as an echo', () => {
  assert.equal(
    answerEchoesUntrustedBlock(`${UNTRUSTED_OPEN} {"repo":{"id":"repo","name":"sequence"}}`),
    true,
    'the exact shape the local model produced',
  );
  assert.equal(answerEchoesUntrustedBlock(`trailing ${UNTRUSTED_CLOSE}`), true);
});

test('an ordinary answer that cites files is NOT an echo', () => {
  /* The guard must not be a similarity heuristic: a real answer may quote a lot of
     the repository and must survive. Only OUR sentinels condemn it. */
  const honest =
    'validateAiConfig accepts two provider kinds: `anthropic` and `openai-compatible`. ' +
    'See packages/analyzer/src/server/provider.ts, which returns an error for anything else.';
  assert.equal(answerEchoesUntrustedBlock(honest), false);
  assert.equal(answerEchoesUntrustedBlock(''), false);
  assert.equal(answerEchoesUntrustedBlock('untrusted_repo_content is discussed in the docs'), false);
});

test('the refusal names what happened and what to do, and is not the digest', () => {
  assert.ok(!answerEchoesUntrustedBlock(UNTRUSTED_ECHO_REFUSAL), 'the refusal must not trip its own guard');
  assert.match(UNTRUSTED_ECHO_REFUSAL, /echo/i);
  assert.match(UNTRUSTED_ECHO_REFUSAL, /stronger model/i);
});
