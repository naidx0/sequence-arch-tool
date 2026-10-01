import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ══════════════════════════════════════════════════════════════════════════
   TERMINAL PANE — NO KEYBOARD TRAP
   packages/web2/src/terminal/TerminalPane.test.tsx

   The pane sends Tab to the shell (completion needs it). Before this test it
   also swallowed Shift+Tab and had no other exit, so a keyboard user who
   tabbed into a live terminal could not reach anything else in the app — the
   a11y audit's Tab walk stopped on "Terminal output" at 1440 and 400 wide
   (WCAG 2.1.2, Level A). The way out is Shift+Tab, or Esc then Tab; both must
   be left to the browser (not default-prevented, not sent to the shell), and
   the pane must say so to assistive tech.

   The socket is mocked: what is asserted is the pane's key routing, not the
   protocol (terminalClient.test.ts owns that).
   ══════════════════════════════════════════════════════════════════════════ */

const sent: string[] = [];

vi.mock('./terminalClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('./terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (handlers: { onBackend?: (b: 'pty' | 'pipe') => void }) => {
      handlers.onBackend?.('pty');
      return {
        sendInput: (d: string | Uint8Array) => sent.push(typeof d === 'string' ? d : new TextDecoder().decode(d)),
        resize: () => {},
        close: () => {},
        readyState: 1,
      };
    }),
  };
});

import { TerminalPane } from './TerminalPane';

async function liveSurface(): Promise<HTMLElement> {
  render(<TerminalPane repoRoot="/repo" />);
  await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
  const surface = screen.getByTestId('terminal-pane-surface');
  surface.focus();
  return surface;
}

describe('TerminalPane keyboard exit', () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it('still sends a plain Tab to the shell', async () => {
    const surface = await liveSurface();
    const notPrevented = fireEvent.keyDown(surface, { key: 'Tab' });
    expect(notPrevented).toBe(false);
    expect(sent).toEqual(['\t']);
  });

  it('lets Shift+Tab move focus out instead of sending it to the shell', async () => {
    const surface = await liveSurface();
    fireEvent.keyDown(surface, { key: 'Shift', shiftKey: true });
    const notPrevented = fireEvent.keyDown(surface, { key: 'Tab', shiftKey: true });
    expect(notPrevented).toBe(true);
    expect(sent).toEqual([]);
  });

  it('lets Esc then Tab move focus out, once', async () => {
    const surface = await liveSurface();
    fireEvent.keyDown(surface, { key: 'Escape' });
    expect(fireEvent.keyDown(surface, { key: 'Tab' })).toBe(true);
    expect(sent).toEqual([]);
    // the release is one-shot: the next Tab is completion again
    expect(fireEvent.keyDown(surface, { key: 'Tab' })).toBe(false);
    expect(sent).toEqual(['\t']);
  });

  it('any other key cancels a pending Esc release', async () => {
    const surface = await liveSurface();
    fireEvent.keyDown(surface, { key: 'Escape' });
    fireEvent.keyDown(surface, { key: 'a' });
    expect(fireEvent.keyDown(surface, { key: 'Tab' })).toBe(false);
    expect(sent).toEqual(['a', '\t']);
  });

  it('tells assistive tech how to leave', async () => {
    const surface = await liveSurface();
    const id = surface.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    const hint = document.getElementById(id!);
    expect(hint?.textContent).toMatch(/Shift\+Tab/);
    expect(hint?.textContent).toMatch(/Esc then Tab/);
  });
});
