import { beforeEach, describe, expect, it } from 'vitest';

import { clearReverted, isRevertedAt, markReverted, resetRevertedMarks } from './revertedMarks';

beforeEach(() => resetRevertedMarks());

describe('the turns a restore undid', () => {
  it('a turn that began inside the span is reverted; one before or after it is not; another chat is not', () => {
    markReverted('chat-a', 1000, 5000);
    expect(isRevertedAt('chat-a', 1000)).toBe(true);
    expect(isRevertedAt('chat-a', 3000)).toBe(true);
    expect(isRevertedAt('chat-a', 5000)).toBe(true);
    expect(isRevertedAt('chat-a', 999)).toBe(false);
    expect(isRevertedAt('chat-a', 5001)).toBe(false);
    expect(isRevertedAt('chat-b', 3000)).toBe(false);
    expect(isRevertedAt(null, 3000)).toBe(false);
  });

  it('Undo revert takes the span back, and only that span', () => {
    markReverted('chat-a', 1000, 5000);
    markReverted('chat-a', 8000, 9000);
    clearReverted('chat-a', 1000);
    expect(isRevertedAt('chat-a', 3000)).toBe(false);
    expect(isRevertedAt('chat-a', 8500)).toBe(true);
  });

  it('survives a reload (it is kept in storage) and a storage that is not there is no error', () => {
    markReverted('chat-a', 1000, 5000);
    expect(JSON.parse(localStorage.getItem('sequence.reverted.v1')!)).toEqual({ 'chat-a': [{ from: 1000, to: 5000 }] });
  });
});
