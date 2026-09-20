import { describe, expect, it } from 'vitest';

import { answerText, hasThinking, splitThinking } from './splitThinking';

/*
 * "IF IT'S IN THINKING MODE VERSUS OUTPUT MODE IT SHOULD BE A DIFFERENT FONT
 *  COLOUR."                                        — the owner, 2026-09-13
 *
 * There is a real defect under the request. `provider.ts:199` measured it
 * against granite42-hermes: "every Teach turn opened a reasoning block the
 * reader never sees … 316 characters of unseen reasoning." Local models put
 * that reasoning INLINE in `content`, in <think> tags, and nothing on the
 * client had ever looked for them — so the tags and their contents printed
 * into the answer as literal text.
 */

describe('thinking is separated from the answer', () => {
  it('splits a closed think block out of the answer', () => {
    const s = splitThinking('<think>the user wants X</think>Here is X.');
    expect(s).toEqual([
      { kind: 'thinking', text: 'the user wants X' },
      { kind: 'answer', text: 'Here is X.' },
    ]);
  });

  it('KEEPS ORDER — think, answer, think, answer', () => {
    // A model may think, answer, think again and correct itself. Bucketing the
    // two would produce a transcript of something that did not happen.
    const s = splitThinking('<think>a</think>one<think>b</think>two');
    expect(s.map((x) => [x.kind, x.text])).toEqual([
      ['thinking', 'a'],
      ['answer', 'one'],
      ['thinking', 'b'],
      ['answer', 'two'],
    ]);
  });

  it('an UNCLOSED tag is the normal mid-stream state, not a malformed one', () => {
    // This is why it cannot be a regex replace: during a stream the closing tag
    // may be seconds away, and the reader needs to be told what is happening
    // now rather than after it finishes.
    const s = splitThinking('<think>I should read the file');
    expect(s).toEqual([{ kind: 'thinking', text: 'I should read the file', open: true }]);
  });

  it('accepts <thinking> too, and is case-insensitive', () => {
    expect(splitThinking('<THINKING>x</THINKING>y').map((s) => s.kind)).toEqual([
      'thinking',
      'answer',
    ]);
  });

  it('text with NO tags is one answer segment — every ordinary turn', () => {
    // The property that keeps every existing transcript byte-identical.
    const s = splitThinking('Just an answer.');
    expect(s).toEqual([{ kind: 'answer', text: 'Just an answer.' }]);
    expect(hasThinking(s)).toBe(false);
  });

  it('does NOT eat an ordinary tag out of a code snippet', () => {
    // A permissive "any tag" rule would swallow the thing the model is
    // explaining. Only the two literal tags that actually occur.
    const code = 'Use `<div>` for that, and `<thinker>` is not a tag.';
    expect(splitThinking(code)).toEqual([{ kind: 'answer', text: code }]);
  });

  it('drops empty segments rather than rendering blank paragraphs', () => {
    expect(splitThinking('<think></think>Answer.')).toEqual([
      { kind: 'answer', text: 'Answer.' },
    ]);
  });

  it('a turn that ONLY thought produces no answer text', () => {
    // Counting a thought as an answer is how a turn that said nothing reads as
    // a turn that answered.
    expect(answerText('<think>hmm</think>')).toBe('');
    expect(hasThinking(splitThinking('<think>hmm</think>'))).toBe(true);
  });

  it('answerText strips the thinking, which is what Copy puts on the clipboard', () => {
    // Pasting a model's <think> block into a commit message is never what the
    // reader meant by Copy.
    expect(answerText('<think>internal</think>The real answer.')).toBe('The real answer.');
  });
});
