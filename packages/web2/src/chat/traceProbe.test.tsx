import { describe, expect, it } from 'vitest';
import * as ViewMod from './ReasoningTraceView';
import * as IconsMod from '../shell2/icons';

describe('probe', () => {
  it('module keys', () => {
    expect(Object.keys(ViewMod)).toEqual(['ReasoningTraceView']);
    expect(typeof IconsMod.S2Icon).toBe('function');
    expect(IconsMod.S2Icon).toEqual(expect.any(Function));
  });
});
