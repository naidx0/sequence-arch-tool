/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS › APPLICATION — the menu bar, moved inside the app.
   packages/web2/src/settings/AppPane.tsx

   Owner, 2026-09-12, looking at the Windows build: "make sure the File / Edit /
   View / Window / Help functions are editable via the settings page inside the
   actual application instead of the Windows menu bar options."

   So `packages/desktop/src/main.ts` no longer builds an application menu, and
   this pane is where what it used to carry now lives: File's Open Repo, View's
   reload / force reload / devtools / three zoom steps / full screen, Help's one
   page, and the version block that Window/About was for. Every row calls the
   SAME main-process action the keyboard chord calls — `sequence:shell` with a
   named action — so the two doors cannot drift into meaning different things.

   EDIT IS ABSENT, AND THAT IS THE HONEST ANSWER. Undo / redo / cut / copy /
   paste / select-all were `role`s on the Edit menu, which is to say they were
   Chromium's own editing commands with a menu item drawn over them. Chromium
   applies them to a focused text field straight from the keystroke; removing
   the menu removed the drawing, not the behaviour. A row here labelled "Paste"
   would either do nothing (this page has no focused field to paste into by the
   time you have clicked it) or re-fire a chord the field already handles — a
   control that claims to do something it does not, which is the one thing this
   repository's standard forbids outright. The pane says so in words instead.

   IN A BROWSER TAB there is no bridge and no window to reload on someone's
   behalf, so the pane draws ONE line saying whose controls these are. Not a
   disabled copy of the desktop list: a greyed-out row is a promise that it
   could work here, and it could not.

   UNSHEETED, like the rest of settings.css. Every value is a token; the rows
   sit on shapes `.settings-row` already defines.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';

import { desktopBridge } from '../boot/desktopBridge';

/** What the removed menu could do. Mirrors `ShellAction` in the preload. */
export type ShellAction =
  | 'open-repo'
  | 'reload'
  | 'force-reload'
  | 'toggle-devtools'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'toggle-fullscreen'
  | 'open-help'
  | 'quit'
  | 'info';

/** What `shell('info')` answers with. Every field is printed verbatim. */
export interface ShellInfo {
  appVersion?: string;
  electron?: string;
  chrome?: string;
  node?: string;
  platform?: string;
  zoomFactor?: number;
  fullscreen?: boolean;
}

/**
 * `navigator.platform` is deprecated and still the only thing that answers this
 * question in every browser this ships to. It is used for ONE cosmetic decision
 * — whether the chord prints ⌘ or Ctrl — so a wrong answer mislabels a key and
 * breaks nothing. `userAgentData.platform` is checked first where it exists.
 */
function isMacHost(): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (!nav) return false;
  const hinted = (nav as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const name = hinted?.platform ?? nav.platform ?? '';
  return /mac/i.test(name);
}

/** `Ctrl+Shift+R` on Windows and Linux, `⌘+Shift+R` on a Mac. */
export function chordFor(accelerator: string, mac = isMacHost()): string {
  return mac ? accelerator.replace(/Ctrl/g, '⌘') : accelerator;
}

interface ActionRow {
  id: string;
  label: string;
  /** Written the Windows/Linux way; `chordFor` translates it for a Mac. */
  accelerator: string;
  action: ShellAction;
}

const VIEW_ROWS: readonly ActionRow[] = [
  { id: 'reload', label: 'Reload', accelerator: 'Ctrl+R', action: 'reload' },
  { id: 'force-reload', label: 'Force reload', accelerator: 'Ctrl+Shift+R', action: 'force-reload' },
  { id: 'zoom-in', label: 'Zoom in', accelerator: 'Ctrl+=', action: 'zoom-in' },
  { id: 'zoom-out', label: 'Zoom out', accelerator: 'Ctrl+-', action: 'zoom-out' },
  { id: 'zoom-reset', label: 'Reset zoom', accelerator: 'Ctrl+0', action: 'zoom-reset' },
  { id: 'fullscreen', label: 'Full screen', accelerator: 'F11', action: 'toggle-fullscreen' },
  { id: 'devtools', label: 'Developer tools', accelerator: 'F12', action: 'toggle-devtools' },
];

export interface AppPaneProps {
  /** The attached repository, when the store knows of one. */
  repoName?: string | null;
}

export function AppPane({ repoName = null }: AppPaneProps) {
  const bridge = desktopBridge();
  const desktop = bridge !== undefined && typeof bridge.shell === 'function';

  const [info, setInfo] = useState<ShellInfo | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * ONE CALL PATH FOR EVERY ROW, including the refresh that follows it.
   *
   * A zoom row that changed the window and left "Currently 100%" on screen
   * would be a control reporting the state it had before it acted, which is the
   * shape of half the wrong claims in this repository's history. So every
   * action is followed by a fresh `info`, and the number beside the zoom rows
   * is always the one the window actually has.
   */
  const run = useCallback(
    (action: ShellAction): void => {
      const api = desktopBridge();
      const shell = api?.shell;
      /* Captured OUT HERE. TypeScript drops a narrowing of `api.shell` at the
         boundary of the async closure below — a property could have been
         reassigned by the time it runs — so the function itself is what crosses
         the boundary, not the object it hangs off. */
      if (typeof shell !== 'function') return;
      setFailure(null);
      void (async () => {
        try {
          await shell(action);
          if (action === 'quit') return; // nothing left to ask
          const next = (await shell('info')) as ShellInfo | null;
          setInfo(next ?? null);
        } catch (e) {
          /* The main process's own words. A pane that rewrote them would hide
             the one sentence that says what broke. */
          setFailure((e as Error).message);
        }
      })();
    },
    [],
  );

  useEffect(() => {
    if (!desktop) return;
    let live = true;
    void (async () => {
      const shell = desktopBridge()?.shell;
      if (typeof shell !== 'function') return;
      try {
        const answer = (await shell('info')) as ShellInfo | null;
        if (live) setInfo(answer ?? null);
      } catch (e) {
        if (live) setFailure((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  if (!desktop) {
    return (
      <section className="settings-section" data-testid="settings-app">
        <h3 className="settings-h">Application</h3>
        <p className="settings-note" data-testid="settings-app-browser">
          These controls belong to the Sequence desktop app — reloading, zoom, full screen,
          developer tools and quitting are the window&rsquo;s own, and a browser tab has no
          window to give. The keyboard shortcuts still apply wherever your browser allows
          them.
        </p>
      </section>
    );
  }

  const zoom = typeof info?.zoomFactor === 'number' ? `${Math.round(info.zoomFactor * 100)}%` : null;

  return (
    <>
      <section className="settings-section" data-testid="settings-app">
        <h3 className="settings-h">Repository</h3>
        <div className="settings-row settings-row-act" data-testid="settings-app-open-repo-row">
          <span className="settings-row-title">
            {repoName ? `Open another repository — currently ${repoName}` : 'Open a repository…'}
          </span>
          <span className="settings-key">{chordFor('Ctrl+O')}</span>
          <button
            type="button"
            className="settings-save"
            data-testid="settings-app-open-repo"
            onClick={() => {
              const api = desktopBridge();
              if (api) void api.openRepo();
            }}
          >
            Choose folder…
          </button>
        </div>
        <p className="settings-hint">
          The native folder picker, the same one Ctrl+O opens. Scanning restarts against the
          folder you pick.
        </p>
      </section>

      <section className="settings-section" data-testid="settings-app-view">
        <h3 className="settings-h">View</h3>
        {VIEW_ROWS.map((row) => (
          <div key={row.id} className="settings-row settings-row-act" data-testid={`settings-app-row-${row.id}`}>
            <span className="settings-row-title">{row.label}</span>
            {/* The zoom rows are the only ones with a state worth printing, and
                it is printed as a fact rather than implied by a mark. */}
            {zoom && row.action.startsWith('zoom') ? (
              <span className="settings-row-state" data-state="ready">
                {zoom}
              </span>
            ) : null}
            <span className="settings-key">{chordFor(row.accelerator)}</span>
            <button
              type="button"
              className="settings-save"
              data-testid={`settings-app-${row.id}`}
              onClick={() => run(row.action)}
            >
              {row.label}
            </button>
          </div>
        ))}
        <p className="settings-hint">
          Text editing — undo, redo, cut, copy, paste, select all — needs no row here: the
          browser engine applies those to whichever field has focus, straight from the
          keystroke, with or without a menu.
        </p>
      </section>

      <section className="settings-section" data-testid="settings-app-help">
        <h3 className="settings-h">Help</h3>
        <div className="settings-row settings-row-act">
          <span className="settings-row-title">What can I do here?</span>
          <span className="settings-key">{chordFor('F1')}</span>
          <button
            type="button"
            className="settings-save"
            data-testid="settings-app-help-open"
            onClick={() => run('open-help')}
          >
            Open help
          </button>
        </div>
      </section>

      <section className="settings-section" data-testid="settings-app-about">
        <h3 className="settings-h">This build</h3>
        <ul className="settings-list" data-testid="settings-app-info">
          {[
            ['Sequence', info?.appVersion],
            ['Electron', info?.electron],
            ['Chrome', info?.chrome],
            ['Node', info?.node],
            ['Platform', info?.platform],
          ].map(([label, value]) => (
            <li key={String(label)} className="settings-row settings-row-act">
              <span className="settings-row-title">{label}</span>
              {/* An unanswered field says so. A blank would read as a version
                  of nothing rather than as a question not yet answered. */}
              <span className="settings-key">{value ? String(value) : 'not reported'}</span>
            </li>
          ))}
        </ul>
        <div className="settings-row settings-row-act">
          <span className="settings-row-title">Quit Sequence</span>
          <span className="settings-key">{chordFor('Ctrl+Q')}</span>
          <button
            type="button"
            className="settings-save"
            data-testid="settings-app-quit"
            onClick={() => run('quit')}
          >
            Quit
          </button>
        </div>
        {failure === null ? null : (
          <p className="settings-failure" data-testid="settings-app-failure" role="alert">
            {failure}
          </p>
        )}
      </section>
    </>
  );
}
