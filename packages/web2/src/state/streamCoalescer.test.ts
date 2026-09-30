import { describe, expect, it } from 'vitest';

import { createStreamCoalescer } from './streamCoalescer';
import type { AskEvent } from './types';

/*
 * Owner, 2026-09-22: "when prompt is sent, some animations stopped … timer is
 * also not working, tool cards seem to be delayed". One store dispatch per
 * thinking token kept the main thread in React for the whole turn.
 */
function harness() {
  const sent: Array<{ event: AskEvent; at: number }> = [];
  const timers: Array<() => void> = [];
  const c = createStreamCoalescer((event, at) => sent.push({ event, at }), {
    schedule: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    cancel: () => {},
  });
  return { sent, c, tick: () => timers.splice(0).forEach((f) => f()) };
}

describe('the stream coalescer', () => {
  it('a hundred thinking frames reach the store as one', () => {
    const { sent, c, tick } = harness();
    for (let i = 0; i < 100; i++) c.push({ type: 'reasoning', text: 'x' }, 10 + i);
    expect(sent).toHaveLength(0);
    tick();
    expect(sent).toEqual([{ event: { type: 'reasoning', text: 'x'.repeat(100) }, at: 10 }]);
  });

  it('a tool card is never later than the text before it, and never waits for the timer', () => {
    const { sent, c } = harness();
    c.push({ type: 'reasoning', text: 'I should read ' }, 1);
    c.push({ type: 'reasoning', text: 'the README.' }, 2);
    c.push({ type: 'tool:start', id: 't1', name: 'read_file' } as AskEvent, 3);
    expect(sent.map((s) => s.event.type)).toEqual(['reasoning', 'tool:start']);
    expect((sent[0]!.event as { text: string }).text).toBe('I should read the README.');
  });

  it('thinking and answer text never merge into each other', () => {
    const { sent, c } = harness();
    c.push({ type: 'reasoning', text: 'think' }, 1);
    c.push({ type: 'delta', text: 'answer' }, 2);
    c.flush();
    expect(sent.map((s) => s.event)).toEqual([
      { type: 'reasoning', text: 'think' },
      { type: 'delta', text: 'answer' },
    ]);
  });

  it('flush on an empty buffer sends nothing', () => {
    const { sent, c } = harness();
    c.flush();
    expect(sent).toHaveLength(0);
  });
});
