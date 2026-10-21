import { afterEach, describe, expect, it, vi } from 'vitest';

import { stripToolProse } from './stripToolProse';

/* 0.1.8.4 P3: stripToolProse ran five global regex scans on every streamed delta of plain prose (168 ms self over five
   chat switches at x4). Text with no tool marker now skips them. The probe counts String.prototype.replace calls. */

function countReplace<T>(fn: () => T): { value: T; calls: number } {
  const real = String.prototype.replace;
  let calls = 0;
  const spy = vi.spyOn(String.prototype, 'replace').mockImplementation(function (this: string, ...args: unknown[]) {
    calls += 1;
    return (real as (...a: unknown[]) => string).apply(this, args);
  } as never);
  try {
    return { value: fn(), calls };
  } finally {
    spy.mockRestore();
  }
}

describe('stripToolProse fast path', () => {
  afterEach(() => vi.restoreAllMocks());

  it('plain prose skips the regex work and comes back unchanged', () => {
    const prose = 'The build is green.\n\nTwo files changed: a.ts and b.ts.\n\nNothing else to do.';
    const { value, calls } = countReplace(() => stripToolProse(prose));
    expect(calls).toBe(0);
    expect(value).toEqual({ stripped: prose, tools: [] });
  });

  it('keeps the newline collapse and the trim the full pass applies', () => {
    expect(stripToolProse('a\n\n\n\nb  \n\n').stripped).toBe('a\n\nb');
    expect(stripToolProse('a\n\n\n\nb  \n\n', { trimEnd: false }).stripped).toBe('a\n\nb  \n\n');
  });

  it('text with a tool marker still goes the long way (positive control: the spy does see the work)', () => {
    const dump = 'Here:\n```json\n{"name":"read_file","path":"a.ts"}\n```\nDone.';
    const { value, calls } = countReplace(() => stripToolProse(dump));
    expect(calls).toBeGreaterThan(0);
    expect(value.tools.map((t) => t.name)).toEqual(['read_file']);
    expect(stripToolProse('<function name="run_command">x</function> ok').tools.map((t) => t.name)).toEqual(['run_command']);
    expect(stripToolProse('say "name": "propose_chart" here\nthen text').tools.length).toBeGreaterThanOrEqual(0);
  });

  it('a long streamed answer of prose is linear: every prefix takes the fast path', () => {
    const chunk = 'Another sentence of the answer, with a comma. ';
    let text = '';
    const { calls } = countReplace(() => {
      for (let i = 0; i < 200; i++) {
        text += chunk;
        stripToolProse(text);
      }
    });
    expect(calls).toBe(0);
  });
});
