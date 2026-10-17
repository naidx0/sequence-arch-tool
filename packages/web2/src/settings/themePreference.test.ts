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

it('0.1.6: the switch is one blended step, a View Transition where there is one, a short fade where not, nothing under reduced motion', async () => {
  const root = document.documentElement;
  const doc = document as Document & { startViewTransition?: unknown };
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  /* A View Transition: the update runs inside it, the root says it is switching until it finishes. */
  let finish: () => void = () => {};
  const calls: number[] = [];
  doc.startViewTransition = (update: () => void) => {
    calls.push(1);
    update();
    return { finished: new Promise<void>((r) => { finish = r; }) };
  };
  writeTheme('light');
  expect(calls).toHaveLength(1);
  expect(root.dataset.theme).toBe('light');
  expect(root.hasAttribute('data-theme-switching')).toBe(true);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(root.hasAttribute('data-theme-switching')).toBe(false);
  /* No View Transitions: applied at once, faded by the body keyframe for a moment. */
  delete doc.startViewTransition;
  vi.useFakeTimers();
  writeTheme('dark');
  expect(root.dataset.theme).toBe('dark');
  expect(root.hasAttribute('data-theme-fade')).toBe(true);
  vi.advanceTimersByTime(400);
  expect(root.hasAttribute('data-theme-fade')).toBe(false);
  expect(root.hasAttribute('data-theme-switching')).toBe(false);
  vi.useRealTimers();
  /* Reduced motion: no transition, no attribute, still applied. */
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
  doc.startViewTransition = () => { throw new Error('must not run under reduced motion'); };
  writeTheme('light');
  expect(root.dataset.theme).toBe('light');
  expect(root.hasAttribute('data-theme-switching')).toBe(false);
  delete doc.startViewTransition;
});

it('0.1.6: a quick second toggle keeps data-theme-switching until the LAST transition ends', async () => {
  const root = document.documentElement;
  const doc = document as Document & { startViewTransition?: unknown };
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  const finishers: Array<() => void> = [];
  doc.startViewTransition = (update: () => void) => {
    update();
    return { finished: new Promise<void>((r) => { finishers.push(r); }) };
  };
  writeTheme('light');
  writeTheme('dark');
  finishers[0]!();
  await Promise.resolve();
  await Promise.resolve();
  expect(root.hasAttribute('data-theme-switching')).toBe(true);
  finishers[1]!();
  await Promise.resolve();
  await Promise.resolve();
  expect(root.hasAttribute('data-theme-switching')).toBe(false);
  delete doc.startViewTransition;
});
