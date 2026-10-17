import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Terminal start-up races (owner: "sometimes loads blank, should always initialise in the project path").
   1. A pane with no layout (0x0: hidden tab / first frame) must not tell the shell a size, least of all a
      made-up 20x8 or zeros. 2. A refused open (the server had no root yet: 409) is retried and ends live. */

const resizes: Array<[number, number]> = [];
let connectImpl: () => Promise<unknown>;

vi.mock('./terminalClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('./terminalClient')>();
  return { ...real, connectTerminal: vi.fn(() => connectImpl()) };
});

import { TerminalPane } from './TerminalPane';
import { createScreen } from './terminalScreen';

const liveClient = () => ({
  sendInput: () => {},
  resize: (c: number, r: number) => resizes.push([c, r]),
  close: () => {},
  readyState: 1,
});

let roCallback: (() => void) | null = null;

beforeEach(() => {
  resizes.length = 0;
  roCallback = null;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        roCallback = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('TerminalPane start-up', () => {
  it('never reports a size from a 0x0 container (no zeros, no invented 20x8)', async () => {
    connectImpl = async () => liveClient();
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
    act(() => roCallback?.());
    const def = createScreen();
    expect(resizes.length).toBeGreaterThan(0);
    for (const [c, r] of resizes) {
      expect(c).toBeGreaterThan(0);
      expect(r).toBeGreaterThan(0);
      expect([c, r]).toEqual([def.cols, def.rows]);
    }
  });

  it('a refused first open (409: no root yet) is retried and ends with a live terminal', async () => {
    let calls = 0;
    connectImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error('terminal WebSocket failed to open');
      return liveClient();
    };
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'), { timeout: 4000 });
    expect(calls).toBe(2);
  });

  it.each([403, 429])('a %i refusal shows the error at once and is not retried', async (status) => {
    let calls = 0;
    connectImpl = async () => {
      calls += 1;
      throw Object.assign(new Error('terminal refused'), { status });
    };
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('terminal refused'), { timeout: 1500 });
    expect(calls).toBe(1);
  });

  it('unmounting during the retry wait cancels the retry', async () => {
    let calls = 0;
    connectImpl = async () => {
      calls += 1;
      throw new Error('terminal WebSocket failed to open');
    };
    const { unmount } = render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toMatch(/Waiting for the project/));
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    unmount();
    expect(clear, 'the pending retry timer is cleared on unmount').toHaveBeenCalled();
    clear.mockRestore();
    await new Promise((r) => setTimeout(r, 1000));
    expect(calls).toBe(1);
  });
});
