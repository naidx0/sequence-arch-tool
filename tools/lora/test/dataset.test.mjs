/**
 * JSONL validity, round-tripping, and — the one the guide cares most about —
 * that the template-verification artifact is actually produced and actually
 * notices a training/inference divergence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  IM_END,
  IM_START,
  QWEN_DEFAULT_SYSTEM,
  comparePrefixes,
  readJsonl,
  renderQwenChatML,
  renderVerifyTemplate,
  toChatSample,
  validateChatSample,
  writeJsonl,
} from '../lib/dataset.mjs';
import { GOOD } from '../fixtures/candidates.mjs';

const PROMPT = 'You are a grounded assistant...\n--- QUESTION ---\nAdd a read cache in front of `svc:catalog`.';

test('a chat sample is one user turn and one assistant turn — no system role', () => {
  const row = toChatSample({ prompt: PROMPT, completion: GOOD });
  assert.deepEqual(validateChatSample(row), []);
  assert.equal(row.messages.length, 2);
  assert.equal(row.messages[0].role, 'user');
  assert.equal(row.messages[1].role, 'assistant');
  // Production sends a single user message with no system role; training must match.
  assert.ok(!row.messages.some((m) => m.role === 'system'));
});

test('empty prompt or completion is refused rather than written', () => {
  assert.throws(() => toChatSample({ prompt: '', completion: GOOD }), /prompt/);
  assert.throws(() => toChatSample({ prompt: PROMPT, completion: '' }), /completion/);
});

test('validateChatSample names what is wrong', () => {
  assert.deepEqual(validateChatSample({ messages: [{ role: 'user', content: 'x' }] }), ['expected exactly 2 messages, got 1', 'second message role is "undefined", expected "assistant"']);
});

test('JSONL round-trips exactly, including embedded newlines and backticks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lora-ds-'));
  const file = path.join(dir, 'train.jsonl');
  const rows = [
    toChatSample({ prompt: PROMPT, completion: GOOD, meta: { repoId: 'fixture-shop', recipeId: 'cache-in-front-of-service' } }),
    toChatSample({ prompt: PROMPT + '\nsecond', completion: GOOD }),
  ];
  writeJsonl(file, rows);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.split('\n').filter((l) => l !== '').length, 2, 'one sample per line, always');
  // A literal newline inside a prompt must be escaped, never break the line format.
  assert.ok(text.split('\n')[0].includes('\\n'), 'embedded newlines must be JSON-escaped');
  const back = readJsonl(file);
  assert.deepEqual(back, rows);
  for (const r of back) assert.deepEqual(validateChatSample(r), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readJsonl reports the line number of a bad line instead of failing vaguely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lora-ds-'));
  const file = path.join(dir, 'bad.jsonl');
  fs.writeFileSync(file, '{"messages":[]}\nnot json\n', 'utf8');
  assert.throws(() => readJsonl(file), /line 2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the ChatML render carries the special tokens and the default system turn', () => {
  const r = renderQwenChatML([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }]);
  assert.ok(r.startsWith(`${IM_START}system\n${QWEN_DEFAULT_SYSTEM}${IM_END}`));
  assert.ok(r.includes(`${IM_START}user\nhi${IM_END}`));
  assert.ok(r.trimEnd().endsWith(`${IM_START}assistant\nyo${IM_END}`), 'the assistant turn must end with the EOS marker');
});

test('the generation prompt is the ONLY difference between an inference render and a training render', () => {
  const training = renderQwenChatML([{ role: 'user', content: PROMPT }, { role: 'assistant', content: GOOD }]);
  const inference = renderQwenChatML([{ role: 'user', content: PROMPT }], { addGenerationPrompt: true });
  const cut = training.indexOf(`${IM_START}assistant\n`) + `${IM_START}assistant\n`.length;
  assert.equal(training.slice(0, cut), inference);
});

test('the verification artifact is produced, shows both renders, and passes on a matching pair', () => {
  const artifact = renderVerifyTemplate({
    trainingSample: toChatSample({ prompt: PROMPT, completion: GOOD }),
    inferencePrompt: PROMPT,
    context: { repo: 'fixture-shop', contract: 'phase0/v1' },
  });
  assert.match(artifact, /A · ONE FULLY-RENDERED TRAINING EXAMPLE/);
  assert.match(artifact, /B · ONE FULLY-RENDERED INFERENCE PROMPT/);
  assert.match(artifact, /IDENTICAL up to the assistant turn/);
  // Both renders must be present in full, special tokens and all — this artifact
  // exists to be READ, so a summarised version of it would be useless.
  assert.ok(artifact.includes(GOOD), 'the assistant turn must appear verbatim');
  assert.ok(artifact.includes(`${IM_START}assistant\n`));
  assert.match(artifact, /tok\.chat_template/, 'it must tell the owner to check the REAL template');
  assert.match(artifact, /repo: fixture-shop/);
});

test('the artifact FAILS LOUDLY when training and inference drift apart', () => {
  const artifact = renderVerifyTemplate({
    trainingSample: toChatSample({ prompt: PROMPT, completion: GOOD }),
    // The classic real-world drift: an extra instruction added on one side only.
    inferencePrompt: PROMPT + '\nAnswer concisely.',
  });
  assert.match(artifact, /DIVERGES at byte \d+/);
  assert.doesNotMatch(artifact, /IDENTICAL up to the assistant turn/);
});

test('comparePrefixes points at the first differing byte', () => {
  const v = comparePrefixes('abcdef', 'abcXef');
  assert.equal(v.identical, false);
  assert.equal(v.firstDivergence, 3);
  assert.equal(comparePrefixes('abc', 'abc').identical, true);
});
