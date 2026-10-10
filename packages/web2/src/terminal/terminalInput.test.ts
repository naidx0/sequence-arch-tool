import { describe, expect, it } from 'vitest';

import { queueTerminalInput, takeTerminalInput } from './terminalInput';

describe('a line for the terminal to run', () => {
  it('waits for a live terminal, then goes to it; once live, lines go at once to the newest', () => {
    queueTerminalInput('claude --settings "a"');
    const first: string[] = [];
    const releaseFirst = takeTerminalInput((l) => first.push(l));
    expect(first).toEqual(['claude --settings "a"']);
    const second: string[] = [];
    const releaseSecond = takeTerminalInput((l) => second.push(l));
    queueTerminalInput('ls');
    expect(second).toEqual(['ls']);
    expect(first).toEqual(['claude --settings "a"']);
    releaseSecond();
    releaseFirst();
    queueTerminalInput('later');
    const third: string[] = [];
    const releaseThird = takeTerminalInput((l) => third.push(l));
    expect(third).toEqual(['later']);
    releaseThird();
  });
});
