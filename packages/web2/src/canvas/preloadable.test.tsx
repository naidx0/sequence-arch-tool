import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { preloadable } from './preloadable';

/* A component kept out of boot JS: nothing until its chunk is in, then it
   renders on its own; once preloaded it renders on the first frame. */

describe('preloadable', () => {
  it('renders nothing until loaded, then the component, without a remount', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => (resolve = r));
    const L = preloadable<{ word: string }>(() => gate.then(() => (p: { word: string }) => <span data-testid="x">{p.word}</span>));
    render(<L.Component word="hi" />);
    expect(screen.queryByTestId('x')).toBeNull();
    await act(async () => {
      resolve();
      await L.preload();
    });
    expect(screen.getByTestId('x').textContent).toBe('hi');
  });

  it('once preloaded, renders on the first frame', async () => {
    const L = preloadable<object>(async () => () => <span data-testid="y">ok</span>);
    await L.preload();
    render(<L.Component />);
    expect(screen.getByTestId('y').textContent).toBe('ok');
  });
});

describe('a part that waits for the idle preload', () => {
  it('does not load itself on mount, and appears when the preload lands', async () => {
    let loads = 0;
    const L = preloadable<object>(
      async () => {
        loads += 1;
        return () => <span data-testid="z">here</span>;
      },
      { loadOnMount: false },
    );
    render(<L.Component />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(loads).toBe(0);
    expect(screen.queryByTestId('z')).toBeNull();
    await act(async () => {
      await L.preload();
    });
    expect(loads).toBe(1);
    expect(screen.getByTestId('z').textContent).toBe('here');
  });
});
