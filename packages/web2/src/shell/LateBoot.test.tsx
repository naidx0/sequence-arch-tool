import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, StoreProvider } from '../state';
import { LateBoot } from './LateBoot';

/*
 * S5: the attention watcher is a lazy chunk mounted once the app has settled,
 * so the boot bundle carries only this stub. Fake timers; nothing waits.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('LateBoot', () => {
  it('loads nothing at first paint; mounts the watcher (which draws nothing) once the timer fires', async () => {
    vi.useFakeTimers();
    const imported = vi.fn();
    const view = render(
      <StoreProvider store={createStore({})}>
        <LateBoot afterMs={2500} />
      </StoreProvider>,
    );
    expect(view.container.innerHTML).toBe('');
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    vi.useRealTimers();
    await vi.dynamicImportSettled().then(imported);
    await act(async () => {});
    expect(imported).toHaveBeenCalled();
    expect(view.container.innerHTML).toBe('');
  });
});
