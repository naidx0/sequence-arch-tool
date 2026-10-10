import { describe, expect, it } from 'vitest';

import { readStillAnswers, type RootRead } from './bootRead';

const client = {};
const other = {};
const read = (booted: boolean, root: string | null, deps: unknown[] = [client, 's1']): RootRead => ({
  booted,
  root,
  deps,
});

describe('readStillAnswers: only the boot-settle render is excused', () => {
  it('excuses boot bringing the root the server already had', () => {
    expect(readStillAnswers(read(false, null), read(true, '/repo'))).toBe(true);
  });

  it('excuses boot settling with nothing else moved (no repo)', () => {
    expect(readStillAnswers(read(false, null), read(true, null))).toBe(true);
  });

  it('reads on first mount', () => {
    expect(readStillAnswers(null, read(false, null))).toBe(false);
    expect(readStillAnswers(null, read(true, '/repo'))).toBe(false);
  });

  it('reads again when the root changes after boot (attach, switch)', () => {
    expect(readStillAnswers(read(true, null), read(true, '/repo'))).toBe(false);
    expect(readStillAnswers(read(true, '/a'), read(true, '/b'))).toBe(false);
  });

  it('reads again when boot brings a root different from one the client already knew', () => {
    expect(readStillAnswers(read(false, '/a'), read(true, '/b'))).toBe(false);
  });

  it('reads again when anything else the read depends on moved', () => {
    expect(readStillAnswers(read(false, null, [client, 's1']), read(true, '/repo', [client, 's2']))).toBe(false);
    expect(readStillAnswers(read(false, null, [client, 's1']), read(true, '/repo', [other, 's1']))).toBe(false);
  });

  it('reads again on an identical key (a remount whose read was cancelled)', () => {
    expect(readStillAnswers(read(false, null), read(false, null))).toBe(false);
    expect(readStillAnswers(read(true, '/repo'), read(true, '/repo'))).toBe(false);
  });
});
