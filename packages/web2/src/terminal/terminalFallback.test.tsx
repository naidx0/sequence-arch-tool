import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* G4: a terminal that connects and then shows nothing, or fails to start, gets a calm fallback with the folder it
   tried and a Start again. The socket is faked: it opens and never sends a byte. */

let connects = 0;
let mode: 'silent' | 'fail' | 'speaks' = 'silent';
let closeIt: (code: number, reason: string) => void = () => {};
let emit: (s: string) => void = () => {};

vi.mock('./terminalClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('./terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (handlers: { onOutput?: (b: Uint8Array) => void; onClose?: (i: { code: number; reason: string }) => void }) => {
      closeIt = (code, reason) => handlers.onClose?.({ code, reason });
      connects += 1;
      if (mode === 'fail') throw new Error('could not open the socket');
      emit = (s) => handlers.onOutput?.(new TextEncoder().encode(s));
      return { sendInput: () => {}, resize: () => {}, close: () => {}, readyState: 1 };
    }),
  };
});

import { BLANK_MS, TerminalPane } from './TerminalPane';

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
}

describe('terminal blank-load fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    connects = 0;
    mode = 'silent';
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a connected terminal that shows nothing gets the fallback with the folder and Start again, which reconnects', async () => {
    render(<TerminalPane repoRoot="C:/work/app" />);
    await settle();
    expect(screen.queryByTestId('terminal-fallback')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BLANK_MS + 50);
    });
    const box = screen.getByTestId('terminal-fallback');
    expect(box.textContent).toMatch(/shown nothing yet/);
    expect(screen.getByTestId('terminal-fallback-folder').textContent).toContain('C:/work/app');
    fireEvent.click(screen.getByTestId('terminal-fallback-restart'));
    await settle();
    expect(connects).toBe(2);
    expect(screen.queryByTestId('terminal-fallback')).toBeNull();
  });

  it('no fallback when the shell speaks in time, and it goes away if output arrives late', async () => {
    mode = 'speaks';
    render(<TerminalPane repoRoot="/repo" />);
    await settle();
    await act(async () => {
      emit('hello\r\n');
      await vi.advanceTimersByTimeAsync(BLANK_MS + 50);
    });
    expect(screen.queryByTestId('terminal-fallback')).toBeNull();
    cleanup();
    mode = 'silent';
    render(<TerminalPane repoRoot="/repo" />);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BLANK_MS + 50);
    });
    expect(screen.getByTestId('terminal-fallback')).toBeTruthy();
    await act(async () => {
      emit('late\r\n');
    });
    expect(screen.queryByTestId('terminal-fallback')).toBeNull();
  });

  it('a terminal that fails to start says so, with the folder, and Start again', async () => {
    mode = 'fail';
    render(<TerminalPane repoRoot="C:/work/app" />);
    await settle();
    /* A refused open is retried while the server may still have no root (TerminalPane.startup.test.tsx); the
       fallback is what is left when the retries run out. */
    expect(connects).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9 * 750 + 100);
    });
    expect(screen.getByTestId('terminal-fallback').textContent).toMatch(/could not start/);
    /* the reason is printed once (in the status line), not twice */
    expect(document.body.textContent!.split('could not open the socket').length - 1).toBe(1);
    expect(screen.getByTestId('terminal-fallback-folder').textContent).toContain('C:/work/app');
    const before = connects;
    fireEvent.click(screen.getByTestId('terminal-fallback-restart'));
    await settle();
    expect(connects).toBe(before + 1);
  });
});

describe('review fixes (terminal)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mode = 'silent';
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  it('the blank notice goes away when the socket closes', async () => {
    render(<TerminalPane repoRoot="/repo" />);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BLANK_MS + 50);
    });
    expect(screen.getByTestId('terminal-fallback')).toBeTruthy();
    await act(async () => closeIt(1006, 'gone'));
    expect(screen.queryByTestId('terminal-fallback')).toBeNull();
  });
});
