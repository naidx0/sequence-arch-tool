import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
let backend: 'pty' | 'pipe' = 'pty';
let emit: (s: string) => void = () => {};

vi.mock('./terminalClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('./terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (handlers: { onBackend?: (b: 'pty' | 'pipe') => void; onOutput?: (b: Uint8Array) => void }) => {
      handlers.onBackend?.(backend);
      emit = (s) => handlers.onOutput?.(new TextEncoder().encode(s));
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
    backend = 'pty';
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

  it('sends Enter as a carriage return so cmd and PowerShell on ConPTY run the line', async () => {
    const surface = await liveSurface();
    fireEvent.keyDown(surface, { key: 'e' });
    fireEvent.keyDown(surface, { key: 'Enter' });
    expect(sent).toEqual(['e', '\r']);
  });

  it('a pipe shell echoes Enter as a new line, so output does not overwrite what was typed', async () => {
    backend = 'pipe';
    const surface = await liveSurface();
    fireEvent.keyDown(surface, { key: 'a' });
    fireEvent.keyDown(surface, { key: 'Enter' });
    act(() => emit('XYZ'));
    await waitFor(() => expect(surface.textContent).toContain('XYZ'));
    expect(surface.textContent).toMatch(/a[\s\S]*XYZ/);
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

describe('TerminalPane disconnect (UX audit R11 #15)', () => {
  it('the status is a plain word, not backend jargon', async () => {
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
    expect(screen.getByTestId('terminal-pane-status').textContent).not.toMatch(/pty|pipe/i);
  });
  it('says the terminal disconnected in one quiet line, and Reconnect opens it again', async () => {
    const { connectTerminal } = await import('./terminalClient');
    const connect = vi.mocked(connectTerminal);
    const before = connect.mock.calls.length;
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(connect.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));

    const handlers = connect.mock.calls.at(-1)![0] as { onClose: (c: { code: number; reason: string }) => void };
    act(() => handlers.onClose({ code: 1006, reason: '' }));
    const status = await screen.findByTestId('terminal-pane-status');
    expect(status.textContent).toBe('Terminal disconnected. Reconnect');
    /* The raw close code is not on the line; it stays in the tooltip. */
    expect(status.textContent).not.toMatch(/1006/);
    expect(status.getAttribute('title')).toMatch(/1006/);

    const afterClose = connect.mock.calls.length;
    fireEvent.click(screen.getByTestId('terminal-pane-reconnect'));
    await waitFor(() => expect(connect.mock.calls.length).toBe(afterClose + 1));
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
  });
});
