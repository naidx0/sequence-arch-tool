import { describe, expect, it } from 'vitest';

import { baseName, canMoveInto, isWithin, joinPath, parentDir, remapPath, validName } from './fileOpsModel';

describe('fileOpsModel', () => {
  it('splits and joins paths', () => {
    expect(baseName('a/b/c.ts')).toBe('c.ts');
    expect(parentDir('a/b/c.ts')).toBe('a/b');
    expect(parentDir('c.ts')).toBe('');
    expect(joinPath('', 'c.ts')).toBe('c.ts');
    expect(joinPath('a', 'c.ts')).toBe('a/c.ts');
  });

  it('refuses drops that make no sense', () => {
    expect(canMoveInto('src', 'src')).toBe(false);
    expect(canMoveInto('src', 'src/inner')).toBe(false);
    expect(canMoveInto('src/a.ts', 'src')).toBe(false); // already there
    expect(canMoveInto('src/a.ts', '')).toBe(true);
    expect(canMoveInto('a.ts', 'src')).toBe(true);
    expect(canMoveInto('src', 'srcx')).toBe(true); // prefix is not ancestry
  });

  it('remaps a selection through a rename or move', () => {
    expect(remapPath('src/a.ts', 'src', 'lib')).toBe('lib/a.ts');
    expect(remapPath('src', 'src', 'lib')).toBe('lib');
    expect(remapPath('srcx/a.ts', 'src', 'lib')).toBe('srcx/a.ts');
    expect(isWithin('src/a', 'src')).toBe(true);
    expect(isWithin('srcx', 'src')).toBe(false);
  });

  it('validates typed names', () => {
    expect(validName('  ok.ts ')).toBe('ok.ts');
    for (const bad of ['', '  ', '.', '..', 'a/b', 'a\\b']) expect(validName(bad)).toBeNull();
  });
});
