import { contextBridge, ipcRenderer } from 'electron';

/**
 * preload — runs with `contextIsolation: ON` and `nodeIntegration: OFF`. It
 * exposes ONLY a tiny, explicit bridge to the renderer (the web app), never the
 * Node/Electron internals. No remote module, no `require` leaked into the page.
 *
 * The first capability offered is "ask the main process to open the native OS
 * folder picker and attach the chosen repo". The web app feature-detects
 * `window.sequence` and renders an in-page "Open a repository…" row that defers
 * to the native dialog; Cmd/Ctrl+O drives the exact same main-process flow, so
 * the desktop is fully usable either way. This bridge adds no filesystem access
 * of its own — the main process runs the dialog and the trusted `--repo` restart.
 *
 * THE SECOND IS `shell`, AND IT EXISTS BECAUSE THE MENU BAR DOES NOT.
 *
 * Owner, 2026-09-12: the File / Edit / View / Window / Help functions belong on
 * the settings page inside the app, not on the Windows menu bar. So the menu is
 * gone (see `buildMenu` in main.ts) and the Settings > Application pane drives
 * the same actions through ONE invoke channel carrying a named action. One
 * function here rather than eleven: the list of what is permitted lives in the
 * main process's own switch, which throws on anything it does not recognise, so
 * widening the surface is a main-process edit and not a preload oversight.
 *
 * STILL ONE `exposeInMainWorld`. The bridge grows a key, not a second global.
 */

export interface RepoChangedInfo {
  repoDir: string | null;
  url: string;
}

/** Everything the removed menu could do. Mirrors `ShellAction` in main.ts —
 *  mirrored rather than imported, because the preload must not drag the main
 *  module (and its `app`/`BrowserWindow` references) into the sandbox. */
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
  | 'info'
  /* The window buttons (main.ts says why they ride this channel). */
  | 'window-minimize'
  | 'window-maximize-toggle'
  | 'window-close'
  | 'window-state';

const api = {
  /** Trigger the native folder picker; resolves with the chosen repo dir, or null if cancelled. */
  openRepo: (): Promise<string | null> => ipcRenderer.invoke('sequence:open-repo'),
  /**
   * Run one of the actions the removed application menu used to carry.
   *
   * Resolves with whatever the main process returns for that action — `null`
   * for the ones that just do something, `{ zoomFactor }` / `{ fullscreen }`
   * for the ones whose result the pane prints back, and the full version block
   * for `'info'`. Rejects on an action this build does not know, which is how
   * a drift between the pane and the main process surfaces as an error instead
   * of a dead button.
   */
  shell: (action: ShellAction): Promise<unknown> => ipcRenderer.invoke('sequence:shell', action),
  /**
   * Subscribe to the in-app Help row (and F1) asking for the help page.
   *
   * The help page has three doors and one implementation: F1, the Settings >
   * Application row, and the command palette. The first two arrive here — main
   * sends on this channel for both — so the pane never needs its own copy of
   * what "open help" means.
   *
   * One more receive-only channel, deliberately: the renderer can be TOLD that
   * help was asked for and can do nothing new as a result of having it.
   */
  onOpenHelp: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on('sequence:open-help', listener);
    return () => ipcRenderer.removeListener('sequence:open-help', listener);
  },
  /** Subscribe to repo-change notifications pushed by the main process after a successful attach. */
  onRepoChanged: (cb: (info: RepoChangedInfo) => void): (() => void) => {
    const listener = (_e: unknown, info: RepoChangedInfo): void => cb(info);
    ipcRenderer.on('sequence:repo-changed', listener);
    return () => ipcRenderer.removeListener('sequence:repo-changed', listener);
  },
};

export type SequenceDesktopApi = typeof api;

contextBridge.exposeInMainWorld('sequence', api);
