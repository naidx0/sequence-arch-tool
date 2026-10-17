import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/* Owner 2026-10-10: the terminal's buttons sit in one transparent strip at the very bottom of the pane. */

vi.mock('./terminalClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('./terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (handlers: { onBackend?: (b: 'pty' | 'pipe') => void }) => {
      handlers.onBackend?.('pty');
      return { sendInput: () => {}, resize: () => {}, close: () => {}, readyState: 1 };
    }),
  };
});

import { TerminalPane } from './TerminalPane';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (css: string, sel: string) => {
  const at = css.indexOf(sel + ' {');
  return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};

describe('the terminal tools strip', () => {
  it('comes after the screen in the pane, and holds the status and every tool', async () => {
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
    const pane = screen.getByTestId('terminal-pane');
    const chrome = screen.getByTestId('terminal-pane-chrome');
    const surface = screen.getByTestId('terminal-pane-surface');
    expect(surface.compareDocumentPosition(chrome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pane.lastElementChild).toBe(chrome);
    for (const id of ['terminal-clear', 'terminal-copy', 'terminal-stop', 'terminal-restart']) expect(chrome.contains(screen.getByTestId(id))).toBe(true);
    expect(chrome.contains(screen.getByTestId('terminal-pane-status'))).toBe(true);
  });

  it('has no fill, no pill, and a hairline on top in both skins', () => {
    for (const [file, sel] of [
      ['../v3/v3.css', '.terminal-pane-chrome,\n.v3-terminal-chrome'],
      ['../shell2/pages.css', '.s2 .terminal-pane-chrome'],
    ] as const) {
      const body = rule(read(file).replace(/\r/g, ''), sel);
      expect(body, file).toMatch(/background:\s*transparent/);
      expect(body, file).not.toMatch(/border-radius:\s*var\(--r-full\)/);
      expect(body, file).not.toMatch(/border-bottom/);
    }
    expect(rule(read('../v3/v3.css'), '.terminal-tool')).toMatch(/background:\s*transparent/);
  });
});
