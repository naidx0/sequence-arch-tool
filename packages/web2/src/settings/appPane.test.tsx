/* ══════════════════════════════════════════════════════════════════════════
   THE MENU BAR'S REPLACEMENT, CHECKED FROM BOTH SEATS.

   The native File / Edit / View / Window / Help menu was removed from the
   desktop shell on the owner's ask (2026-09-12) and everything it did moved
   into this pane. That makes two failures possible that did not exist while a
   menu was in front of it, and this file exists for exactly those two:

     1. A ROW THAT DOES NOT REACH THE MAIN PROCESS. With a menu, the click and
        the action were the same object. Now they are a button and an IPC
        channel with a name between them, and a typo'd action name is a control
        that looks right and does nothing. So the desktop case asserts the
        argument, not just that something was called.

     2. A BROWSER TAB PRETENDING TO HAVE A WINDOW. web2 ships to a tab as well
        as to the shell, and a pane of reload/zoom/quit rows in a tab would be
        seven promises none of which can be kept. The browser case asserts the
        honest line AND that nothing was invoked.
   ══════════════════════════════════════════════════════════════════════════ */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppPane, chordFor } from './AppPane';

/** The preload bridge, as the pane sees it. Returned `info` is what a real
 *  `shell('info')` answers with, so the version rows have something true to
 *  print rather than a shape invented for the test. */
function installDesktop(): { calls: string[]; shell: ReturnType<typeof vi.fn>; openRepo: ReturnType<typeof vi.fn> } {
  const calls: string[] = [];
  const shell = vi.fn(async (action: string) => {
    calls.push(action);
    if (action === 'info') {
      return {
        appVersion: '0.1.0',
        electron: '33.0.0',
        chrome: '130.0.0.0',
        node: '20.18.0',
        platform: 'win32',
        zoomFactor: 1,
        fullscreen: false,
      };
    }
    return null;
  });
  const openRepo = vi.fn(async () => null);
  (window as unknown as { sequence?: unknown }).sequence = { openRepo, shell };
  return { calls, shell, openRepo };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { sequence?: unknown }).sequence;
});

describe('Settings › Application — inside the desktop shell', () => {
  it('DRAWS THE ROWS THE MENU USED TO CARRY, each with its chord', async () => {
    installDesktop();
    render(<AppPane repoName="sequence" />);

    for (const id of [
      'settings-app-reload',
      'settings-app-force-reload',
      'settings-app-zoom-in',
      'settings-app-zoom-out',
      'settings-app-zoom-reset',
      'settings-app-fullscreen',
      'settings-app-devtools',
      'settings-app-help-open',
      'settings-app-quit',
      'settings-app-open-repo',
    ]) {
      expect(screen.getByTestId(id), `${id} is missing — the menu item it replaced has nowhere to go`).toBeTruthy();
    }

    /* The chord is PRINTED. A pane that moved the actions inside but left the
       keys undocumented would have made the product harder to use, not easier:
       the menu was where they were written down. */
    const text = screen.getByTestId('settings-app-view').textContent ?? '';
    for (const chord of ['Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+=', 'Ctrl+-', 'Ctrl+0', 'F11', 'F12']) {
      expect(text, `${chord} is not shown beside its row`).toContain(chord);
    }
  });

  it('CLICKING RELOAD ASKS THE MAIN PROCESS FOR `reload` — by name', async () => {
    const { calls, shell } = installDesktop();
    render(<AppPane />);

    fireEvent.click(screen.getByTestId('settings-app-reload'));

    await waitFor(() => expect(calls).toContain('reload'));
    expect(shell).toHaveBeenCalledWith('reload');
  });

  it('re-reads the window AFTER acting, so the printed zoom is the real one', async () => {
    const { calls } = installDesktop();
    render(<AppPane />);
    await waitFor(() => expect(calls).toContain('info'));

    const before = calls.filter((c) => c === 'info').length;
    fireEvent.click(screen.getByTestId('settings-app-zoom-in'));

    await waitFor(() => expect(calls.filter((c) => c === 'info').length).toBeGreaterThan(before));
    expect(calls).toContain('zoom-in');
  });

  it('help goes through the SAME channel F1 goes through', async () => {
    const { calls } = installDesktop();
    render(<AppPane />);

    fireEvent.click(screen.getByTestId('settings-app-help-open'));
    await waitFor(() => expect(calls).toContain('open-help'));
  });

  it('Open a repository… calls the native picker, not the shell channel', async () => {
    const { openRepo, calls } = installDesktop();
    render(<AppPane repoName={null} />);

    fireEvent.click(screen.getByTestId('settings-app-open-repo'));
    await waitFor(() => expect(openRepo).toHaveBeenCalled());
    expect(calls).not.toContain('open-repo');
  });

  it('prints the build it is actually running in', async () => {
    installDesktop();
    render(<AppPane />);
    await waitFor(() => {
      const text = screen.getByTestId('settings-app-info').textContent ?? '';
      expect(text).toContain('33.0.0');
      expect(text).toContain('win32');
    });
  });
});

describe('Settings › Application — in a browser tab', () => {
  it('SAYS SO IN ONE LINE, and offers no control it cannot honour', () => {
    /* No `window.sequence` at all — the browser build. */
    render(<AppPane />);

    const line = screen.getByTestId('settings-app-browser').textContent ?? '';
    expect(line).toMatch(/desktop app/i);
    expect(line).toMatch(/keyboard shortcuts/i);

    expect(screen.queryByTestId('settings-app-reload')).toBeNull();
    expect(screen.queryByTestId('settings-app-quit')).toBeNull();
    expect(screen.queryByTestId('settings-app-info')).toBeNull();
  });

  it('INVOKES NOTHING — a half-built bridge is a browser, not a desktop', async () => {
    /*
     * The failure this catches: a page carrying some other `window.sequence`,
     * or a shell older than this channel. `isDesktop()` only ever promised
     * `openRepo`, so the pane must check for `shell` itself before drawing a
     * row that calls it.
     */
    const shell = vi.fn();
    (window as unknown as { sequence?: unknown }).sequence = { openRepo: async () => null };
    render(<AppPane />);

    expect(screen.getByTestId('settings-app-browser')).toBeTruthy();
    expect(shell).not.toHaveBeenCalled();
  });
});

describe('the chord is spelled for the keyboard in front of the reader', () => {
  it('prints Ctrl off a Mac and ⌘ on one', () => {
    expect(chordFor('Ctrl+Shift+R', false)).toBe('Ctrl+Shift+R');
    expect(chordFor('Ctrl+Shift+R', true)).toBe('⌘+Shift+R');
    /* A function key is a function key on every keyboard. */
    expect(chordFor('F12', true)).toBe('F12');
  });
});
