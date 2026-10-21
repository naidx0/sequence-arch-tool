import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error e2e/lib is .mjs and ships no .d.ts.
import { closeBrowser } from '../e2e/lib/chromium.mjs';

/* The rendered tests' teardown: a starved machine can keep Chromium's graceful close from finishing,
   and a hook that waits for it outlives its bound. closeBrowser bounds the wait and ends the process. */
describe('closeBrowser', () => {
  it('a close that never finishes ends the browser process after the grace period', async () => {
    const kill = vi.fn();
    const browser = { close: () => new Promise(() => {}), process: () => ({ kill }) };
    const t0 = Date.now();
    await closeBrowser(browser, 50);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('a close that finishes in time does not end the process (control)', async () => {
    const kill = vi.fn();
    const browser = { close: () => Promise.resolve(), process: () => ({ kill }) };
    await closeBrowser(browser, 1000);
    expect(kill).not.toHaveBeenCalled();
  });

  it('no browser (the suite skipped) is a no-op', async () => {
    await expect(closeBrowser(undefined)).resolves.toBeUndefined();
  });
});
