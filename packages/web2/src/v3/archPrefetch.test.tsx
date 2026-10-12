import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const warm = vi.fn();
vi.mock('./prefetch', () => ({ prefetchArchitecture: () => warm() }));

const { createStore } = await import('../state');
const { V3App } = await import('./V3App');

afterEach(() => vi.unstubAllGlobals());

describe('the Architecture tab warms on hover', () => {
  it('a pointer on the Architecture tab starts its chunks and worker; other tabs do not', () => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    render(<V3App appStore={createStore({})} />);
    const tab = (label: string) => screen.getAllByRole('button', { name: label }).find((b) => b.hasAttribute('data-tab-id'))!;
    fireEvent.pointerEnter(tab('Files'));
    expect(warm).not.toHaveBeenCalled();
    fireEvent.pointerEnter(tab('Architecture'));
    expect(warm).toHaveBeenCalledTimes(1);
  });
});
