import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { condensePrompt, fitPath, parsePromptLine, PROMPT_MAX, tildeHome } from './promptLine';

/* The owner's line, from the screenshot (settings/after-terminal-1.png). */
const OWNER = 'dev@DESKTOP-TEST01 MINGW64 ~/Projects/seq-wt13-settings (wip/settings)';

let emit: (s: string) => void = () => {};
const sent: string[] = [];
vi.mock('./terminalClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('./terminalClient')>();
  return {
    ...real,
    connectTerminal: vi.fn(async (h: { onBackend?: (b: 'pty') => void; onOutput?: (b: Uint8Array) => void }) => {
      h.onBackend?.('pty');
      emit = (s) => h.onOutput?.(new TextEncoder().encode(s));
      return { sendInput: (d: string | Uint8Array) => sent.push(typeof d === 'string' ? d : new TextDecoder().decode(d)), resize: () => {}, close: () => {}, readyState: 1 };
    }),
  };
});
import { TerminalPane } from './TerminalPane';

describe('prompt: the working path, not the machine (owner 2026-10-09)', () => {
  it('drops user@HOST and the MINGW64 tag and keeps the path', () => {
    const p = parsePromptLine(OWNER)!;
    expect(p.path).toBe('~/Projects/seq-wt13-settings (wip/settings)');
    expect(p.user).toBe('dev');
    expect(parsePromptLine(OWNER + '\r')!.path).toBe(p.path);
  });
  it('turns the home directory into ~ in each form a shell prints', () => {
    expect(tildeHome('/c/Users/dev/Projects/x', 'dev')).toBe('~/Projects/x');
    expect(tildeHome('C:\\Users\\dev\\Projects', 'dev')).toBe('~\\Projects');
    expect(tildeHome('/home/max/code', 'max')).toBe('~/code');
    expect(tildeHome('/Users/max', 'max')).toBe('~');
    /* Negative controls: another user's home and a lookalike prefix stay. */
    expect(tildeHome('/c/Users/other/x', 'dev')).toBe('/c/Users/other/x');
    expect(tildeHome('/home/maxine/x', 'max')).toBe('/home/maxine/x');
  });
  it('is only a prompt: output, commands and an email in text stay alone (negative controls)', () => {
    for (const l of ['$ echo one', 'one', 'mail me at a@b.com MINGW64', 'dev@host: not a prompt here $x', '']) expect(parsePromptLine(l)).toBeNull();
  });
  it('accepts a non-ASCII user and a user name with a space (Windows allows both)', () => {
    expect(parsePromptLine('Zoë Ünal@DESKTOP-1 MINGW64 ~/proj')!.user).toBe('Zoë Ünal');
    expect(parsePromptLine('Zoë Ünal@DESKTOP-1 MINGW64 ~/proj')!.path).toBe('~/proj');
    expect(parsePromptLine('максим@ПК MINGW64 /c/Users/максим/код')!.path).toBe('~/код');
    /* Still not a prompt: no @, or no shell tag. */
    expect(parsePromptLine('Zoë Ünal DESKTOP-1 MINGW64 ~/proj')).toBeNull();
    expect(parsePromptLine('Zoë Ünal@DESKTOP-1 ~/proj')).toBeNull();
  });
});

describe('the Git Bash pair joins into one line: "<short path> $ typed"', () => {
  it('the owner line and its `$ ` line become one line with the dollar sign after the path', () => {
    const c = condensePrompt(OWNER, '$ echo one')!;
    expect(c.consumed).toBe(2);
    expect(c.text).toBe('…seq-wt13-settings $ echo one');
    expect(c.text).not.toMatch(/DESKTOP|dev@|MINGW/);
    expect(c.full).toBe(OWNER);
    /* A cursor at column 7 of the typed line lands after the joined prefix. */
    expect(c.cursorCol(7)).toBe('…seq-wt13-settings '.length + 7);
  });
  it('the path part is at most PROMPT_MAX characters and the dollar sign follows it', () => {
    const long = 'dev@DESKTOP-TEST01 MINGW64 ~/Projects/some/very/deep/folder/seq-wt13-shell2r (wip/shell2r)';
    const c = condensePrompt(long, '$ ')!;
    const label = c.text.slice(0, c.text.indexOf(' $ '));
    expect(label.length).toBeLessThanOrEqual(PROMPT_MAX);
    expect(label.startsWith('…/')).toBe(true);
    expect(label.endsWith('seq-wt13-shell2r')).toBe(true);
    expect(c.text.endsWith(' $ ')).toBe(true);
    expect(PROMPT_MAX).toBeLessThanOrEqual(18);
  });
  it('a short path keeps its branch while it all fits', () => {
    expect(condensePrompt('a@b MINGW64 ~/app (dev)', '$ ')!.text).toBe('~/app (dev) $ ');
    expect(condensePrompt('a@b MINGW64 ~/app (a-long-branch-name)', '$ ')!.text).toBe('~/app $ ');
  });
  it('a one-line bash prompt keeps what was typed on the same line', () => {
    const c = condensePrompt('max@box:/home/max/code/app$ ls -la', undefined)!;
    expect(c.consumed).toBe(1);
    expect(c.text).toBe('~/code/app $ ls -la');
    expect(c.cursorCol('max@box:/home/max/code/app$ '.length + 2)).toBe('~/code/app $ '.length + 2);
  });
  it('a prompt line whose next line is not the `$ ` line is left alone', () => {
    expect(condensePrompt(OWNER, 'one')).toBeNull();
    expect(condensePrompt(OWNER, undefined)).toBeNull();
    expect(condensePrompt('one', '$ ')).toBeNull();
  });
});

describe('fitPath: front ellipsis, the branch goes first', () => {
  it('cut from the front, never longer than the line, last folder whole when it fits', () => {
    for (const cols of [8, 12, 18, 30]) {
      const t = fitPath('~/Projects/some/very/deep/folder/seq-wt13 (wip/x)', cols);
      expect(t.length).toBeLessThanOrEqual(cols);
      expect(t.startsWith('…')).toBe(true);
    }
    expect(fitPath('~/Projects/some/deep/seq-wt13', 14)).toBe('…/seq-wt13');
    expect(fitPath('~/a/b', 40)).toBe('~/a/b');
  });
  it('a width smaller than the branch keeps the ellipsis (reviewer: it dropped it)', () => {
    const t = fitPath('~/p (a-very-long-branch-name)', 12);
    expect(t.length).toBeLessThanOrEqual(12);
    expect(t).toMatch(/^(~\/p|…)/);
    const narrow = fitPath('~/Projects/seq (a-very-long-branch-name)', 8);
    expect(narrow.length).toBeLessThanOrEqual(8);
    expect(narrow.startsWith('…')).toBe(true);
    expect(narrow).not.toMatch(/branch/);
  });
  it('the audit detached HEAD: path keeps the budget, no doubled parens, no 8-hex hash', () => {
    const t = fitPath('~/Projects/seq-wt13-audit ((788b5466...))', PROMPT_MAX);
    expect(t.length).toBeLessThanOrEqual(PROMPT_MAX);
    expect(t).not.toMatch(/\(\(|\)\)/);
    expect(t).not.toMatch(/788b5466/);
    expect(t.replace(/[^\w-]/g, '').length).toBeGreaterThan(10);
    expect(fitPath('~/p ((788b5466...))', 30)).toBe('~/p (788b546)');
    expect(fitPath('~/p (HEAD detached at 788b546)', 30)).toBe('~/p (788b546)');
    expect(fitPath('~/p (HEAD detached)', 30)).toBe('~/p');
  });
  it('the branch shows only when the whole label fits', () => {
    expect(fitPath('~/seq (main)', 18)).toBe('~/seq (main)');
    const t = fitPath('~/Projects/seq-wt13-settings (wip/shell3)', 18);
    expect(t).toBe('…/seq-wt13-settings'.length <= 18 ? '…/seq-wt13-settings' : t);
    expect(t).not.toMatch(/wip/);
  });
  it('one folder name longer than the room keeps its end behind the ellipsis', () => {
    expect(fitPath('~/an-extremely-long-folder-name', 10)).toBe('…lder-name');
  });
});

describe('the pane draws the prompt on one line, with the caret after the dollar sign', () => {
  const pairs = `\r\n\u001b[32m${OWNER.slice(0, 22)}\u001b[35m${OWNER.slice(22)}\u001b[m\r\n$ `;
  it('one block with the full line as its tooltip; the typed text follows the $ on that line; other output untouched', async () => {
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
    act(() => emit(pairs + 'echo one'));
    const line = await screen.findByTestId('terminal-prompt-line');
    expect(line.textContent).toBe('…seq-wt13-settings $ echo one ');
    expect(line.getAttribute('title')).toBe(OWNER);
    expect(screen.getByTestId('terminal-caret')).toBeTruthy();
    const surface = screen.getByTestId('terminal-pane-surface');
    expect(surface.textContent).not.toMatch(/DESKTOP-TEST01/);
    act(() => emit('\r\none\r\n' + pairs));
    await waitFor(() => expect(surface.textContent).toContain('one\n'));
    expect(screen.getAllByTestId('terminal-prompt-line')).toHaveLength(2);
  });
  it('the sheet draws the prompt as a block and gives the screen a glass fill and a hairline', () => {
    const css = readFileSync(resolve(__dirname, '../v3/v3.css'), 'utf8').replace(/\r\n/g, '\n');
    expect(/\.terminal-prompt-line \{([^}]*)\}/.exec(css)![1]).toMatch(/display:\s*block/);
    const surface = [...css.matchAll(/\n\.terminal-pane-surface \{([^}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(surface).toMatch(/background:\s*var\(--glass-pane\)/);
    expect(surface).toMatch(/border:[^;]*var\(--glass-edge\)/);
  });
});

describe('the shell works: keys, paste, copy, tools', () => {
  const live = async () => {
    sent.length = 0;
    render(<TerminalPane repoRoot="/repo" />);
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
    const surface = screen.getByTestId('terminal-pane-surface');
    surface.focus();
    return surface;
  };
  it('Backspace sends DEL, arrows send history and cursor sequences, Enter sends a newline, Ctrl+C interrupts', async () => {
    const surface = await live();
    for (const key of ['Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete', 'Enter']) fireEvent.keyDown(surface, { key });
    fireEvent.keyDown(surface, { key: 'c', ctrlKey: true });
    expect(sent).toEqual(['\x7f', '\x1b[A', '\x1b[B', '\x1b[D', '\x1b[C', '\x1b[H', '\x1b[F', '\x1b[3~', '\n', '\x03']);
  });
  it('Backspace after typed text really deletes it on screen (the old pane painted a stray control char)', async () => {
    const surface = await live();
    act(() => emit('$ abc\b\u001b[K'));
    await waitFor(() => expect(surface.textContent).toMatch(/\$ ab/));
    expect(surface.textContent).not.toMatch(/\$ abc/);
    expect(surface.textContent).not.toContain('\b');
  });
  it('Ctrl+V is a paste, not a ^V to the shell; a paste event sends the text with newlines as returns', async () => {
    const surface = await live();
    expect(fireEvent.keyDown(surface, { key: 'v', ctrlKey: true })).toBe(true);
    expect(sent).toEqual([]);
    fireEvent.paste(surface, { clipboardData: { getData: () => 'echo a\necho b' } });
    expect(sent).toEqual(['echo a\recho b']);
  });
  it('copy keys really copy: Ctrl+C with a selection, Ctrl+Shift+C and Cmd+C call the clipboard and are default-prevented (no inspector)', async () => {
    const surface = await live();
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
    act(() => emit('hello world'));
    await waitFor(() => expect(surface.textContent).toMatch(/hello world/));
    const select = () => {
      const range = document.createRange();
      range.selectNodeContents(surface);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    };
    select();
    /* fireEvent returns false when the handler called preventDefault. */
    expect(fireEvent.keyDown(surface, { key: 'c', ctrlKey: true })).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toMatch(/hello world/);
    expect(fireEvent.keyDown(surface, { key: 'C', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(write).toHaveBeenCalledTimes(2);
    expect(fireEvent.keyDown(surface, { key: 'c', metaKey: true })).toBe(false);
    expect(write).toHaveBeenCalledTimes(3);
    expect(sent).toEqual([]);
    /* Negative control: nothing selected, Ctrl+C is the shell's interrupt and copies nothing. */
    window.getSelection()!.removeAllRanges();
    fireEvent.keyDown(surface, { key: 'c', ctrlKey: true });
    expect(write).toHaveBeenCalledTimes(3);
    expect(sent).toEqual(['\x03']);
  });
  it('AltGr typing (Ctrl+Alt with a composed character) sends the character; Ctrl+Alt+letter stays a control', async () => {
    const surface = await live();
    fireEvent.keyDown(surface, { key: '@', ctrlKey: true, altKey: true });
    fireEvent.keyDown(surface, { key: '{', ctrlKey: true, altKey: true });
    fireEvent.keyDown(surface, { key: 'q', ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(sent).toEqual(['@', '{', 'q']);
    sent.length = 0;
    fireEvent.keyDown(surface, { key: 'a', ctrlKey: true, altKey: true });
    expect(sent).toEqual(['\x01']);
  });
  it('the toolbar: Clear, Copy, Stop, Restart, each with a tooltip and a name', async () => {
    await live();
    const bar = screen.getByRole('toolbar', { name: 'Terminal tools' });
    for (const [id, name] of [['clear', 'Clear'], ['copy', 'Copy'], ['stop', 'Stop'], ['restart', 'Restart']] as const) {
      const b = screen.getByTestId(`terminal-${id}`);
      expect(bar.contains(b)).toBe(true);
      expect(b.getAttribute('aria-label')).toBe(name);
      expect(b.getAttribute('title')).toBeTruthy();
      expect(b.querySelector('svg')).not.toBeNull();
    }
    fireEvent.click(screen.getByTestId('terminal-stop'));
    expect(sent).toEqual(['\x03']);
    sent.length = 0;
    act(() => emit('line one\r\nline two'));
    await waitFor(() => expect(screen.getByTestId('terminal-pane-surface').textContent).toMatch(/line two/));
    fireEvent.click(screen.getByTestId('terminal-clear'));
    await waitFor(() => expect(screen.getByTestId('terminal-pane-surface').textContent).not.toMatch(/line two/));
    expect(sent).toEqual(['\x0c']);
  });
  it('a sign-in pane has no toolbar (it runs one command)', async () => {
    render(<TerminalPane signIn="claude" />);
    await waitFor(() => expect(screen.getByTestId('terminal-pane-status').textContent).toContain('Connected'));
    expect(screen.queryByTestId('terminal-tools')).toBeNull();
  });
  it('the sheet centres the tool glyphs in a fixed square', () => {
    const css = readFileSync(resolve(__dirname, '../v3/v3.css'), 'utf8').replace(/\r\n/g, '\n');
    const tool = /\n\.terminal-tool \{([^}]*)\}/.exec(css)![1]!;
    expect(tool).toMatch(/display:\s*inline-flex/);
    expect(tool).toMatch(/align-items:\s*center/);
    expect(tool).toMatch(/justify-content:\s*center/);
    expect(tool).toMatch(/width:\s*var\(--icon-btn\)/);
    expect(tool).toMatch(/height:\s*var\(--icon-btn\)/);
  });
});

describe('the condensed prompt is the same before and after Clear (a redrawn line is padded with blanks)', () => {
  const at = 'dev@DESKTOP-X MINGW64 /c/seqdemo/e2e-shop';
  it('trailing blanks after ` (branch)` do not change what is shown', () => {
    const plain = condensePrompt(`${at} (master)`, '$ ')!.text;
    const padded = condensePrompt(`${at} (master)     `, '$ ')!.text;
    expect(padded).toBe(plain);
    expect(padded).toBe('…/seqdemo/e2e-shop $ ');
    /* and the first prompt, which had no branch yet, reads the same */
    expect(condensePrompt(at, '$ ')!.text).toBe(plain);
  });
  it('a branch that fits is still shown, padded or not (the rule is "when it all fits")', () => {
    const short = 'u@H MINGW64 /c/a/b';
    expect(condensePrompt(`${short} (main)   `, '$ ')!.text).toBe(condensePrompt(`${short} (main)`, '$ ')!.text);
    expect(condensePrompt(`${short} (main)   `, '$ ')!.text).toContain('(main)');
  });
});
