import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { STATUS_BAR_KEY, readStatusBar, setStatusBar, useStatusBar } from './statusBarPref';

afterEach(() => {
  localStorage.removeItem(STATUS_BAR_KEY);
  setStatusBar(true);
  localStorage.removeItem(STATUS_BAR_KEY);
});

describe('the status bar preference', () => {
  it('is on by default and persists an off', () => {
    localStorage.removeItem(STATUS_BAR_KEY);
    expect(readStatusBar()).toBe(true);
    setStatusBar(false);
    expect(localStorage.getItem(STATUS_BAR_KEY)).toBe('0');
    expect(readStatusBar()).toBe(false);
  });

  it('re-renders a subscriber when it is flipped', () => {
    const { result } = renderHook(() => useStatusBar());
    expect(result.current).toBe(true);
    act(() => setStatusBar(false));
    expect(result.current).toBe(false);
    act(() => setStatusBar(true));
    expect(result.current).toBe(true);
  });
});
