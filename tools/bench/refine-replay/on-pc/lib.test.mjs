import assert from 'node:assert';
import { test } from 'node:test';
import { mcnemarP, mentionsReason, reasonWords } from './lib.mjs';

test('reasonWords: only what the note carries, not what the person already typed', () => {
  const c = { reason: 'No audit trail yet: the chat store has no archived flag.' };
  const w = reasonWords(c, 'add a way to archive old chats');
  assert.ok(w.includes('audit') && w.includes('flag'));
  assert.ok(!w.includes('chat'), 'the person said chats');
});

test('mentionsReason: two of the note-only words in the reply, no judge model', () => {
  const w = ['audit', 'trail', 'flag'];
  assert.equal(mentionsReason('There is no audit trail to build on.', w), true);
  assert.equal(mentionsReason('Sure, I will add archiving.', w), false);
  assert.equal(mentionsReason('anything', []), true, 'nothing to look for is not a miss');
});

test('mcnemarP: exact, two-sided', () => {
  assert.equal(mcnemarP(0, 0), 1);
  assert.ok(Math.abs(mcnemarP(10, 0) - 0.001953125) < 1e-9);
  assert.ok(mcnemarP(5, 5) > 0.99);
});
