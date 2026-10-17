import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { askAboutOutputDraft, commandAbove, findSelection } from './askAboutOutput';

/* ══════════════════════════════════════════════════════════════════════════
   019-17: "ASK ABOUT THIS OUTPUT"
   Select text in the terminal, right-click: the composer is drafted (never
   sent) with the selection fenced, the command read off the screen, and the
   folder. No command on screen means no command line, not a guessed one.
   ══════════════════════════════════════════════════════════════════════════ */

let emit: (s: string) => void = () => {};
vi.mock('./terminalClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('./terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (handlers: { onBackend?: (b: 'pty' | 'pipe') => void; onOutput?: (b: Uint8Array) => void }) => {
      handlers.onBackend?.('pty');
      emit = (s) => handlers.onOutput?.(new TextEncoder().encode(s));
      return { sendInput: () => {}, resize: () => {}, close: () => {}, readyState: 1 };
    }),
  };
});

import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { TerminalPane } from './TerminalPane';

const PROMPT = 'user@HOST MINGW64 ~/proj (main)';
const HEAD = 'Here is some output from my terminal. What does it mean, and what should I do about it?';

describe('askAboutOutputDraft', () => {
  it('fences the selection with the command and the folder', () => {
    expect(askAboutOutputDraft({ selection: 'FAIL x\n', command: 'npm test', folder: '~/proj', startedIn: '/repo' })).toBe(
      `${HEAD}\n\nCommand: \`npm test\`\nFolder: ~/proj\n\n\`\`\`\nFAIL x\n\`\`\``,
    );
  });
  it('omits the command when none is known and says where the shell started', () => {
    expect(askAboutOutputDraft({ selection: 'boom', command: null, folder: null, startedIn: '/repo' })).toBe(
      `${HEAD}\n\nFolder: /repo (where this terminal started)\n\n\`\`\`\nboom\n\`\`\``,
    );
  });
  it('widens the fence past backticks inside the selection', () => {
    expect(askAboutOutputDraft({ selection: 'a ``` b', command: null, folder: null, startedIn: null })).toContain('\n````\na ``` b\n````');
  });
});

describe('commandAbove / findSelection', () => {
  const lines = [PROMPT, '$ npm test', 'FAIL x', 'at y', PROMPT, '$ '];
  it('reads the typed command off the prompt above, not the live prompt', () => {
    const at = findSelection(lines, 'FAIL x');
    expect(at).toBe(2);
    expect(commandAbove(lines, at, 5)).toEqual({ command: 'npm test', folder: '~/proj' });
    expect(commandAbove(lines, 5, 5)).toEqual({ command: 'npm test', folder: '~/proj' });
  });
  it('is null when no prompt is on screen', () => {
    expect(commandAbove(['FAIL x', 'at y'], 0, null)).toBeNull();
  });
});

function mountPane() {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  render(
    <StoreProvider store={store}>
      <TerminalPane repoRoot="/repo" />
    </StoreProvider>,
  );
  return store;
}

function select(text: string) {
  const surface = screen.getByTestId('terminal-pane-surface');
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const at = node.textContent?.indexOf(text) ?? -1;
    if (at >= 0) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      return surface;
    }
  }
  throw new Error(`no text ${text}`);
}

describe('the terminal pane menu', () => {
  beforeEach(() => window.getSelection()?.removeAllRanges());

  it('drafts the selection with the command and folder into the composer, and sends nothing', async () => {
    const store = mountPane();
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
    await act(async () => emit(`${PROMPT}\r\n$ npm test\r\nFAIL x\r\n${PROMPT}\r\n$ `));
    await waitFor(() => expect(screen.getByTestId('terminal-pane-surface').textContent).toContain('FAIL x'));
    const surface = select('FAIL x');
    fireEvent.contextMenu(surface, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByTestId('terminal-ask-output'));
    expect(store.getState().composer.draft).toBe(`${HEAD}\n\nCommand: \`npm test\`\nFolder: ~/proj\n\n\`\`\`\nFAIL x\n\`\`\``);
    expect(screen.queryByTestId('terminal-output-menu')).toBeNull();
  });

  it('offers nothing when nothing is selected', async () => {
    mountPane();
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
    expect(fireEvent.contextMenu(screen.getByTestId('terminal-pane-surface'))).toBe(true);
    expect(screen.queryByTestId('terminal-output-menu')).toBeNull();
  });
});
