import { describe, expect, it } from 'vitest';

import { formatElapsed as chatElapsed } from '../chat/workRowModel';
import { tickLabel } from './AgentsPanel';
import { formatElapsed as streamElapsed } from './agentStream';

describe('durations over an hour read as hours and minutes, never raw minutes', () => {
  it.each([
    [95 * 60_000, '1h 35m'],
    [60 * 60_000, '1h 00m'],
    [180 * 60_000 + 20_000, '3h 00m'],
    [59 * 60_000 + 5_000, '59m 05s'],
    [65 * 60_000, '1h 05m'],
  ])('%d ms', (ms, text) => {
    expect(chatElapsed(ms)).toBe(text);
    expect(streamElapsed(ms)).toBe(text);
  });
  it('the timeline ticks agree with the row formats at every hour boundary', () => {
    for (const min of [60, 65, 95, 120, 605]) expect(tickLabel(min * 60_000)).toBe(chatElapsed(min * 60_000));
  });
  it('the timeline ticks too', () => {
    expect(tickLabel(95 * 60_000)).toBe('1h 35m');
    expect(tickLabel(120 * 60_000)).toBe('2h 00m');
    expect(tickLabel(65 * 60_000)).toBe('1h 05m');
    expect(tickLabel(90_000)).toBe('1m 30s');
  });
});
