import { describe, expect, it } from 'vitest';

import { MIN_REPEAT_CHARS, dropRepeatedTail } from './liveRepeats';

const SAID = 'I changed README.md: added a line "Edited by mock". Review the proposal and apply it.';

describe('a streaming answer does not show the same block twice in a row', () => {
  it('a block that repeats the block before it is dropped, whole or as far as it has streamed', () => {
    expect(dropRepeatedTail(SAID)).toBe(SAID);
    expect(dropRepeatedTail(SAID + SAID)).toBe(SAID);
    expect(dropRepeatedTail(`${SAID}\n\n${SAID}`)).toBe(`${SAID}\n\n`);
    /* So far as it has streamed. */
    expect(dropRepeatedTail(SAID + SAID.slice(0, 40))).toBe(SAID);
    /* Three rounds of it are one. */
    expect(dropRepeatedTail(SAID + SAID + SAID)).toBe(SAID);
  });

  it('the moment the new block says something different, all of it shows', () => {
    const diverged = `${SAID}I changed README.md: added a different line.`;
    expect(dropRepeatedTail(diverged)).toBe(diverged);
    const narration = `Let me read the file first. Now the edit. ${SAID}`;
    expect(dropRepeatedTail(narration)).toBe(narration);
  });

  it('never touches a short echo or text that is only similar', () => {
    expect(dropRepeatedTail('Yes. Yes.')).toBe('Yes. Yes.');
    expect(dropRepeatedTail('a'.repeat(MIN_REPEAT_CHARS - 1) + '.' + 'a'.repeat(MIN_REPEAT_CHARS - 2))).toHaveLength(MIN_REPEAT_CHARS * 2 - 2);
    const list = 'The first file is src/a.ts and it parses the input.\nThe second file is src/b.ts and it prints the output.';
    expect(dropRepeatedTail(list)).toBe(list);
    expect(dropRepeatedTail('')).toBe('');
  });
});
