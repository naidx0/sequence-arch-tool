import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WindowControls } from './WindowControls';

/**
 * THE WINDOW BUTTONS ARE OURS, AND THEY ONLY EXIST WHERE THERE IS A WINDOW.
 *
 * Owner, 2026-09-13: ML Harness "did a really good job with the way we were
 * able to use the minimise, close, expand within our application. Right now it
 * doesn't look as good." The cut he was looking at handed the job to Chromium's
 * `titleBarOverlay`, which paints the SYSTEM buttons over our bar. These cases
 * lock the three things that could quietly undo the replacement.
 */
function bridge(shell: (action: string) => Promise<unknown>) {
  return { sequence: { openRepo: async () => null, shell } };
}

describe('WindowControls', () => {
  it('DRAWS NOTHING IN A BROWSER TAB — a page cannot minimise anything', () => {
    /* Three dead buttons over a tab that already has its own controls is the
       worst of both. The host here is a plain page: no bridge at all. */
    const { container } = render(<WindowControls host={{}} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('shell-window-controls')).toBeNull();
  });

  it('draws nothing for a shell that predates the channel, rather than throwing in a click', () => {
    /*
     * The gate is `shell` being a FUNCTION, never `isDesktop()`. A desktop
     * build from before 2026-09-12 exposes `openRepo` and no `shell`, and
     * `isDesktop()` answers true for it — so keying off that would render three
     * buttons whose first press is a TypeError.
     */
    render(<WindowControls host={{ sequence: { openRepo: async () => null } }} />);
    expect(screen.queryByTestId('shell-window-controls')).toBeNull();
  });

  it('sends each action, and READS THE STATE BACK rather than assuming the press worked', async () => {
    /*
     * A window can be maximised by a double-click on the bar, by the OS, or by
     * a chord — none of which comes through this component. Every press
     * returns the resulting state and the glyph redraws from that, so the
     * control cannot start lying about the thing it controls.
     */
    let maximized = false;
    const shell = vi.fn(async (action: string) => {
      if (action === 'window-maximize-toggle') maximized = !maximized;
      return { maximized };
    });
    render(<WindowControls host={bridge(shell)} />);

    await waitFor(() => expect(shell).toHaveBeenCalledWith('window-state'));
    expect(screen.getByTestId('shell-window-maximize').getAttribute('aria-label')).toBe('Maximise');

    fireEvent.click(screen.getByTestId('shell-window-maximize'));
    await waitFor(() =>
      expect(screen.getByTestId('shell-window-maximize').getAttribute('aria-label')).toBe('Restore down'),
    );

    fireEvent.click(screen.getByTestId('shell-window-minimize'));
    fireEvent.click(screen.getByTestId('shell-window-close'));
    await waitFor(() => expect(shell).toHaveBeenCalledWith('window-close'));
    expect(shell.mock.calls.map((c) => c[0])).toEqual([
      'window-state',
      'window-maximize-toggle',
      'window-minimize',
      'window-close',
    ]);
  });

  it('opens already maximised when the window was restored that way', async () => {
    /* The mount read exists for exactly this: the component may render into a
       window the OS reopened maximised, and a default glyph would be wrong
       before anybody touched anything. */
    render(<WindowControls host={bridge(async () => ({ maximized: true }))} />);
    await waitFor(() =>
      expect(screen.getByTestId('shell-window-maximize').getAttribute('aria-label')).toBe('Restore down'),
    );
  });

  it('a shell that refuses an action leaves the bar standing', async () => {
    /* An older build that does not know `window-state` rejects it. The app bar
       must not come down with it — the failure is silent HERE and only here. */
    const shell = vi.fn(async () => {
      throw new Error('unknown shell action');
    });
    render(<WindowControls host={bridge(shell)} />);
    await waitFor(() => expect(shell).toHaveBeenCalled());
    expect(screen.getByTestId('shell-window-controls')).toBeTruthy();
    fireEvent.click(screen.getByTestId('shell-window-minimize'));
    expect(screen.getByTestId('shell-window-controls')).toBeTruthy();
  });
});
