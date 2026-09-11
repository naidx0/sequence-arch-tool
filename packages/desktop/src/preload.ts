import { contextBridge, ipcRenderer } from 'electron';

/**
 * preload — runs with `contextIsolation: ON` and `nodeIntegration: OFF`. It
 * exposes ONLY a tiny, explicit bridge to the renderer (the web app), never the
 * Node/Electron internals. No remote module, no `require` leaked into the page.
 *
 * The single capability offered is "ask the main process to open the native OS
 * folder picker and attach the chosen repo". The web app can feature-detect
 * `window.sequence` to render an in-page "Open Repo…" button that defers to the
 * native dialog; when it does not (today), the application MENU item + Cmd/Ctrl+O
 * drive the exact same main-process flow, so the desktop is fully usable either
 * way. This bridge adds no filesystem access of its own — the main process runs
 * the dialog and the trusted `--repo` restart.
 */

export interface RepoChangedInfo {
  repoDir: string | null;
  url: string;
}

const api = {
  /** Trigger the native folder picker; resolves with the chosen repo dir, or null if cancelled. */
  openRepo: (): Promise<string | null> => ipcRenderer.invoke('sequence:open-repo'),
  /**
   * Subscribe to the application menu asking for the help page.
   *
   * A DOWNLOADED APP HAS A HELP MENU, and a person who has never met this
   * product looks there before they guess a chord. The web build reaches the
   * same page through the palette; this is the door the desktop convention
   * puts in front of them.
   *
   * One more receive-only channel, deliberately: the renderer can be TOLD that
   * a menu item was chosen and can do nothing new as a result of having it.
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
