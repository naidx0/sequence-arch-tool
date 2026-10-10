import { afterEach, expect, it, vi } from 'vitest';
import { applyTheme, readTheme, watchTheme, writeTheme } from './themePreference';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('system responds to device changes, explicit choices ignore them, and cleanup detaches', () => {
  let dark = true;
  let change: (() => void) | undefined;
  const remove = vi.fn();
  vi.stubGlobal('matchMedia', () => ({ get matches() { return dark; }, addEventListener: (_: string, cb: () => void) => { change = cb; }, removeEventListener: remove }));
  writeTheme('system');
  const stop = watchTheme();
  expect(document.documentElement.dataset.theme).toBe('dark');
  dark = false;
  change?.();
  expect(document.documentElement.dataset.theme).toBe('light');
  writeTheme('dark');
  change?.();
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(readTheme()).toBe('dark');
  stop();
  expect(remove).toHaveBeenCalledOnce();
});

it('invalid stored choices and blocked storage cannot break the window', () => {
  localStorage.setItem('seq.theme', 'bogus');
  expect(readTheme()).toBe('dark');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  expect(() => writeTheme('light')).not.toThrow();
  expect(document.documentElement.dataset.theme).toBe('light');
  applyTheme('dark');
});
