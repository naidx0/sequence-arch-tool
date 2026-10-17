import { describe, expect, it } from 'vitest';

import { composerKeyIntent, lastPrompt } from './composerKeys';

const ev = (key: string, shift = false) => ({ key, shiftKey: shift, metaKey: false, ctrlKey: false, altKey: false });
const idle = { running: false, draft: '', composing: false };
const running = { running: true, draft: 'also check the README', composing: false };

describe('composerKeyIntent (S5)', () => {
  it('Enter while a turn runs steers; Tab queues', () => {
    expect(composerKeyIntent(ev('Enter'), running, false)).toBe('steer');
    expect(composerKeyIntent(ev('Tab'), running, false)).toBe('queue');
  });

  it('when nothing runs, Enter and Tab are the composer\'s own (send, focus move)', () => {
    expect(composerKeyIntent(ev('Enter'), { ...idle, draft: 'hi' }, false)).toBeNull();
    expect(composerKeyIntent(ev('Tab'), { ...idle, draft: 'hi' }, false)).toBeNull();
  });

  it('Shift+Enter is still a newline and Shift+Tab still cycles access, while running', () => {
    expect(composerKeyIntent(ev('Enter', true), running, false)).toBeNull();
    expect(composerKeyIntent(ev('Tab', true), running, false)).toBeNull();
  });

  it('nothing to steer or queue with an empty draft', () => {
    expect(composerKeyIntent(ev('Enter'), { ...running, draft: '   ' }, false)).toBeNull();
  });

  it('Up recalls the last prompt only in an EMPTY composer', () => {
    expect(composerKeyIntent(ev('ArrowUp'), idle, false)).toBe('recall');
    expect(composerKeyIntent(ev('ArrowUp'), { ...idle, draft: 'line one' }, false)).toBeNull();
    expect(composerKeyIntent(ev('ArrowUp'), { ...idle, running: true }, false)).toBe('recall');
  });

  it('an open IME composition owns its keys', () => {
    expect(composerKeyIntent(ev('Enter'), { ...running, composing: true }, false)).toBeNull();
  });

  it('lastPrompt is the newest non-empty user turn', () => {
    expect(
      lastPrompt([
        { role: 'user', text: 'first' },
        { role: 'assistant', text: 'answer' },
        { role: 'user', text: 'second' },
        { role: 'assistant', text: 'answer 2' },
        { role: 'user', text: '  ' },
      ]),
    ).toBe('second');
    expect(lastPrompt([])).toBeNull();
  });
});
