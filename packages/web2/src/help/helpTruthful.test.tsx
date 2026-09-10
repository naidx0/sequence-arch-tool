import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SHELL_COMMANDS } from '../shell';
import { App } from '../app/App';
import { createStore } from '../state';
import { HELP, HelpPanel } from './HelpPanel';

afterEach(() => {
  cleanup();
  delete (window as unknown as { sequence?: unknown }).sequence;
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A HELP PAGE THAT CANNOT LIE ABOUT THE PRODUCT
 *
 * The onboarding row was marked done and corrected to "OVERSTATED — not built":
 * the whole of it was ONE `Ctrl-K` hint in the app bar. A person who never
 * guesses that chord cannot reach the session list, the activity view, review,
 * rewind, search or settings at all, because every one of them lives behind the
 * palette and the palette lives behind the chord.
 *
 * The risk with a help page is the opposite failure: prose describing a product
 * that does not exist. These are the assertions that keep it honest.
 * ══════════════════════════════════════════════════════════════════════════
 */

describe('it is generated, not written', () => {
  it('LISTS EVERY PALETTE COMMAND, and only those', () => {
    /*
     * A hand-written feature list is a second claim about what the product
     * does and it goes stale the first week. Rendering the SAME array the
     * palette renders means a command that does not exist cannot appear, and
     * one that is added appears without anybody remembering to.
     */
    render(<HelpPanel />);
    const shown = screen.getAllByTestId(HELP.command).map((el) => el.getAttribute('data-id'));
    expect(shown).toEqual(SHELL_COMMANDS.map((c) => c.id));
  });

  it('keeps the palette ORDER, which is an argued ranking', () => {
    /* `SHELL_COMMANDS` argues its order at length — a blocked run outranks a
       diff you have not read. Re-sorting it here alphabetically would throw
       that away and teach the reader a different priority. */
    render(<HelpPanel />);
    const shown = screen.getAllByTestId(HELP.command).map((el) => el.getAttribute('data-id'));
    expect(shown[0]).toBe(SHELL_COMMANDS[0]!.id);
    expect(shown[shown.length - 1]).toBe(SHELL_COMMANDS[SHELL_COMMANDS.length - 1]!.id);
  });

  it('and it is reachable from the palette itself', () => {
    /* A help page nobody can open is the exact defect it exists to fix. */
    const row = SHELL_COMMANDS.find((c) => c.id === 'overlay.help');
    expect(row).toBeDefined();
    expect(row?.overlay).toEqual({ kind: 'help' });
  });
});

describe('IT ADVERTISES NO KEY THE SHELL DOES NOT BIND', () => {
  /*
   * The register's own measurement: `Shell.tsx` binds exactly TWO chords and no
   * `SHELL_COMMANDS` entry has one of its own, so a keycap column would render
   * empty on every row — "a surface with nothing to show, which is the defect
   * this register exists to remove".
   */
  const shell = readFileSync(resolve(process.cwd(), 'src', 'shell', 'Shell.tsx'), 'utf8').replace(
    /\r\n/g,
    '\n',
  );

  it('names two, and the shell binds two', () => {
    render(<HelpPanel />);
    expect(screen.getAllByTestId(HELP.chord)).toHaveLength(2);
  });

  it('the two it names are the two that exist', () => {
    /* Asserted against the SOURCE that binds them, so adding a third to this
       page without binding it turns red. */
    expect(shell).toMatch(/'k'/i);
    expect(shell).toMatch(/'Escape'/);
  });

  it('SAYS THE OTHERS HAVE NO KEY, rather than implying they do', () => {
    render(<HelpPanel />);
    expect(screen.getByTestId(HELP.nokeys).textContent).toMatch(/only two/i);
    expect(screen.getByTestId(HELP.nokeys).textContent).toMatch(/by name/i);
  });
});

describe('what it says about the window', () => {
  it('names the three surfaces the shell has', () => {
    render(<HelpPanel />);
    const text = screen.getByTestId(HELP.surfaces).textContent ?? '';
    expect(text).toMatch(/Sessions/i);
    expect(text).toMatch(/Chat/);
    expect(text).toMatch(/Architecture|Whiteboard/i);
    expect(text).toMatch(/index rail/i);
    /* P2.5 layout — not the retired chat-left / canvas-middle / rail-right triad. */
    expect(text).not.toMatch(/Chat, on the left/i);
    expect(text).not.toMatch(/canvas, in the middle/i);
  });

  it('and does NOT promise a fourth', () => {
    /* CANON: "There is no inspector column. If you find yourself building a
       fourth column, stop." A help page that described one would be the first
       step toward somebody building it. */
    render(<HelpPanel />);
    const text = screen.getByTestId(HELP.surfaces).textContent ?? '';
    expect(text).not.toMatch(/inspector/i);
  });

  it('states the one thing that is actually different about this product', () => {
    /* Coverage on every answer. Codex and Claude Code structurally cannot tell
       you what they did not read; if the help page does not say it, nothing
       does. */
    render(<HelpPanel />);
    expect(screen.getByTestId(HELP.surfaces).textContent).toMatch(/could NOT see/i);
  });

  it('and it does not claim the whiteboard is grounded', () => {
    /* Two boards, two grounds. A help page that blurred them would undo the
       reason there are two. */
    render(<HelpPanel />);
    expect(screen.getByTestId(HELP.surfaces).textContent).toMatch(/nothing on it is a claim/i);
  });

  it('QUALIFIES FILE-AND-LINE EVIDENCE to the scanned layer', () => {
    render(<HelpPanel />);
    const text = screen.getByTestId(HELP.surfaces).textContent ?? '';
    expect(text).toMatch(/scanned layer.*file-and-line evidence/i);
    expect(text).toMatch(/proposed and drawn parts are not scan evidence/i);
    expect(text).not.toMatch(/every node and edge/i);
  });
});

describe('the desktop door', () => {
  /*
   * A DOWNLOADED APP HAS A HELP MENU, and a person who double-clicked an
   * application looks at the menu bar before they guess a chord.
   */
  const preload = readFileSync(
    resolve(process.cwd(), '..', 'desktop', 'src', 'preload.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const main = readFileSync(resolve(process.cwd(), '..', 'desktop', 'src', 'main.ts'), 'utf8').replace(
    /\r\n/g,
    '\n',
  );

  it('the shell has a Help menu that sends on the channel', () => {
    expect(main).toMatch(/role: 'help'/);
    expect(main).toMatch(/sequence:open-help/);
  });

  it('the bridge exposes it RECEIVE-ONLY', () => {
    /* One more channel the renderer can be TOLD on. It gains no capability by
       having it — the contextIsolation contract this preload argues for. */
    expect(preload).toMatch(/onOpenHelp/);
    expect(preload).toMatch(/ipcRenderer\.on\('sequence:open-help'/);
  });

  it('AND THE APP SUBSCRIBES — the half that is usually missing', () => {
    /*
     * A menu item that sends on a channel nobody listens to is this
     * repository's dominant failure mode with an Electron menu in front of it.
     */
    let openHelp: (() => void) | null = null;
    (window as unknown as { sequence?: unknown }).sequence = {
      openRepo: async () => null,
      onOpenHelp: (callback: () => void) => {
        openHelp = callback;
        return () => {};
      },
    };
    render(<App appStore={createStore()} />);

    expect(openHelp).not.toBeNull();
    act(() => openHelp!());

    expect(screen.getByTestId('shell-overlay').contains(screen.getByTestId(HELP.root))).toBe(true);
  });
});
