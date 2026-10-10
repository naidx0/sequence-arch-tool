import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/* Owner: "Terminal should start at the top and go top down, instead of bottom up." Measured in a browser:
   the shell's first output is a screenful of blank lines (the PTY painting its screen) ahead of the prompt,
   so the prompt sat at the bottom of the pane. The pane keeps the first visible line at the top. */

let handlers: { onOutput: (b: Uint8Array) => void } | null = null;

vi.mock('./terminalClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('./terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (h: { onOutput: (b: Uint8Array) => void; onBackend?: (b: 'pty') => void }) => {
      handlers = h;
      h.onBackend?.('pty');
      return { sendInput: () => {}, resize: () => {}, close: () => {}, readyState: 1 };
    }),
  };
});

import { TerminalPane } from './TerminalPane';
import { appendTerminalOutput } from './terminalClient';

const enc = (s: string) => new TextEncoder().encode(s);

describe('terminal output starts at the top', () => {
  it('appendTerminalOutput drops whitespace that arrives before any visible character', () => {
    expect(appendTerminalOutput('', '\r\n\r\n\r\n$ ')).toBe('$ ');
    expect(appendTerminalOutput('\r\n', '\r\n  \r\nhi')).toBe('hi');
    expect(appendTerminalOutput('', '\r\n\r\n   banner')).toBe('   banner');
    expect(appendTerminalOutput('\r\n', '  \r\n  x')).toBe('  x');
    /* negative control: once something is visible, blank lines are content and are kept */
    expect(appendTerminalOutput('hi\r\n', '\r\n\r\nthere')).toBe('hi\r\n\r\n\r\nthere');
  });

  it('a screenful of leading blank lines does not push the prompt down the pane', async () => {
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(handlers).not.toBeNull());
    act(() => handlers!.onOutput(enc('\r\n'.repeat(57))));
    act(() => handlers!.onOutput(enc('user@host MINGW64 ~/repo\r\n$ ')));
    const surface = screen.getByTestId('terminal-pane-surface');
    /* The screen repaints on the next frame, and draws the prompt pair as ONE line at the top. */
    await waitFor(() => expect(surface.textContent!.startsWith('~/repo $ ')).toBe(true));
    expect(surface.textContent!.split('\n').length).toBeLessThanOrEqual(2);
  });
});
