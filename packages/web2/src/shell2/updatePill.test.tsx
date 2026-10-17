import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StoreProvider, createStore } from '../state';
import type { InstallJob, UpdateCheck, UpdateSnapshot, VersionClient } from '../settings/versionClient';
import { StatusBar } from './StatusBar';
import { afterIdle, BOOT_GRACE_MS, IDLE_FALLBACK_MS, noticeFrom } from './updatePill';

/* The update notice: shown only for a newer, installable release, and not fetched before the first idle. */

const IDLE_JOB: InstallJob = { state: 'idle', version: null, received: 0, total: 0, error: null, howto: null, file: null };
const CHECK: UpdateCheck = {
  current: '0.1.7',
  latest: { version: '0.1.8', tag: 'v0.1.8', name: 'Sequence 0.1.8', htmlUrl: 'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8', publishedAt: null },
  newer: true,
  asset: { name: 'Sequence.Setup.0.1.8.exe', size: 1 },
  installable: true,
  checkedAt: 1,
  offline: false,
};
const snap = (c: Partial<UpdateCheck> = {}): UpdateSnapshot => ({ check: { ...CHECK, ...c }, install: IDLE_JOB });

function client(update: () => Promise<UpdateSnapshot | null>): VersionClient {
  return { version: async () => null, update, install: async () => null, releases: async () => [] };
}

/** An idle host the test fires by hand: nothing runs until `fire()`. */
function manualIdle() {
  let cb: (() => void) | null = null;
  return {
    idle: (fn: () => void) => {
      cb = fn;
      return () => {
        cb = null;
      };
    },
    fire: () => act(() => cb?.()),
    scheduled: () => cb !== null,
  };
}

function mount(c: VersionClient, idle: (fn: () => void) => () => void) {
  const store = createStore({});
  const view = render(
    <StoreProvider store={store}>
      <StatusBar update={{ client: c, idle }} />
    </StoreProvider>,
  );
  return { store, ...view };
}

describe('noticeFrom', () => {
  it('needs newer AND installable', () => {
    expect(noticeFrom(snap())).toEqual({ version: '0.1.8' });
    expect(noticeFrom(snap({ newer: false }))).toBeNull();
    expect(noticeFrom(snap({ installable: false }))).toBeNull();
    expect(noticeFrom(snap({ latest: null }))).toBeNull();
    expect(noticeFrom(null)).toBeNull();
  });
});

describe('afterIdle', () => {
  it('waits out the boot grace, then uses requestIdleCallback with the 30 s ceiling; else a timer that lands at 30 s', () => {
    vi.useFakeTimers();
    try {
      const calls: { timeout?: number }[] = [];
      const host = { requestIdleCallback: (_cb: () => void, o?: { timeout: number }) => (calls.push({ timeout: o?.timeout }), 7), cancelIdleCallback: vi.fn() };
      const cancel = afterIdle(() => undefined, host);
      vi.advanceTimersByTime(BOOT_GRACE_MS - 1);
      expect(calls).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(calls).toEqual([{ timeout: IDLE_FALLBACK_MS }]);
      cancel();
      expect(host.cancelIdleCallback).toHaveBeenCalledWith(7);
      const fn = vi.fn();
      afterIdle(fn, {});
      vi.advanceTimersByTime(IDLE_FALLBACK_MS - 1);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('cancelled before the grace ends, it never asks', () => {
    vi.useFakeTimers();
    try {
      const host = { requestIdleCallback: vi.fn(() => 1) };
      afterIdle(() => undefined, host)();
      vi.advanceTimersByTime(IDLE_FALLBACK_MS * 2);
      expect(host.requestIdleCallback).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the status bar update notice', () => {
  it('is not fetched before the first idle, then shows for a newer installable release', async () => {
    const update = vi.fn(async () => snap());
    const idle = manualIdle();
    mount(client(update), idle.idle);
    expect(idle.scheduled()).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByTestId('s2-status-update')).toBeNull();
    idle.fire();
    await waitFor(() => expect(screen.getByTestId('s2-status-update').textContent).toBe('Update to v0.1.8'));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when the release is not newer, not installable, or the server is unreachable', async () => {
    for (const result of [snap({ newer: false }), snap({ installable: false }), null]) {
      const update = vi.fn(async () => result);
      const idle = manualIdle();
      const { unmount } = mount(client(update), idle.idle);
      idle.fire();
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('s2-status-update')).toBeNull();
      unmount();
    }
  });

  it('opens Settings > General (the version row) through the existing overlay action', async () => {
    const idle = manualIdle();
    const { store } = mount(client(async () => snap()), idle.idle);
    idle.fire();
    fireEvent.click(await screen.findByTestId('s2-status-update'));
    expect(store.getState().shell.overlay).toEqual({ kind: 'settings', pane: 'app' });
  });
});
