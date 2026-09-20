import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  ipcMain,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { ServerController } from './server-control';

/**
 * Sequence desktop — Electron main process.
 *
 * ARCHITECTURE (child-process, not in-process)
 * --------------------------------------------
 * On `ready` we start the embedded Sequence server by SPAWNING the already-built
 * analyzer CLI (`packages/analyzer/dist/cli.js`) as a child process in `sequence`
 * launch mode (`--no-open --port <free>`), wait until it answers 200 on `/`, then
 * point a BrowserWindow at `http://127.0.0.1:<port>`. The child is the EXACT same
 * server the standing gate verifies — we reuse it rather than reimplement it, and
 * spawning it as a separate Node process avoids all ESM(analyzer)/CJS(Electron)
 * interop. The child is killed on quit. See ./server-control.ts for the lifecycle
 * (which is itself Electron-free and unit-tested with `node --test`).
 *
 * TWO-CONTEXT SECURITY MODEL (read before changing repo-attach code)
 * ------------------------------------------------------------------
 * There are two DISTINCT trust contexts for "attach a repo", and they must stay
 * separate:
 *
 *   1. BROWSER context — the web app's own home screen uses the server's HTTP
 *      `GET /api/browse` + `POST /api/attach`. Those are hardened by Phase B with
 *      a realpath jail rooted at the user's home dir (no `..`, no absolute escape,
 *      no symlink escape, sub-directories only, never file contents). That HTTP
 *      surface is UNTOUCHED here and stays exactly as hardened — it is reachable
 *      by anything that can talk to localhost, so it must remain jailed.
 *
 *   2. DESKTOP context — the native OS folder picker (`dialog.showOpenDialog`)
 *      IS the trust boundary: the human explicitly picked a folder on their own
 *      machine. So the desktop flow is NOT constrained by the web `$HOME` jail.
 *      We honour the chosen absolute path by RESTARTING the child server with
 *      `--repo <chosenDir>` (kill + respawn on the same port, then reload the
 *      window). This reuses the analyzer's TRUSTED startup `--repo` path and
 *      touches NO server security code. We deliberately do NOT route the native
 *      choice through `/api/attach` (that would re-impose the browser jail) and
 *      we deliberately do NOT weaken `/api/browse`/`/api/attach` to accept the
 *      wider desktop path (that would widen the browser surface for everyone).
 */

/** True in `electron-builder` output; false under `electron .` from the repo. */
const packaged = app.isPackaged;

/**
 * Resolve where the built analyzer CLI + web dist live in each mode.
 *
 * - dev (`electron .`): straight from the monorepo `packages/` tree, relative to
 *   this file at `packages/desktop/dist/main.js`.
 * - packaged: from the self-contained server bundle that `scripts/prepare-server.mjs`
 *   assembles and `electron-builder.yml`'s `extraResources` copies to
 *   `<resources>/server/packages/...`. Kept OUTSIDE the asar archive so the child
 *   Node process can execute the real files + resolve node_modules normally.
 */
function serverPaths(): { cliPath: string; webDist: string } {
  if (packaged) {
    const root = path.join(process.resourcesPath, 'server', 'packages');
    return {
      cliPath: path.join(root, 'analyzer', 'dist', 'cli.js'),
      webDist: path.join(root, 'web2', 'dist'),
    };
  }
  const packagesDir = path.resolve(__dirname, '..', '..'); // dist -> desktop -> packages
  return {
    cliPath: path.join(packagesDir, 'analyzer', 'dist', 'cli.js'),
    webDist: path.join(packagesDir, 'web2', 'dist'),
  };
}

const { cliPath, webDist } = serverPaths();

const controller = new ServerController({
  cliPath,
  webDist,
  // In a packaged app there is no system `node`; run the analyzer with Electron's
  // own bundled Node by re-invoking `process.execPath` as a plain Node process.
  nodeExecPath: process.execPath,
  env: { ELECTRON_RUN_AS_NODE: '1' },
  onLog: (line) => console.log(line),
  onUnexpectedExit: ({ code, signal }) => {
    // The embedded server died on its own. Surface it rather than leaving a blank
    // window; the user can relaunch. (Only fires for crashes, not our own kills.)
    /* The same modal trap as the bootstrap catch: in smoke mode a crashed
       child would block on a dialog instead of reporting. */
    if (SMOKE) {
      smokeReport(false, { reason: 'the embedded server exited on its own', code, signal });
      return;
    }
    if (app.isReady() && !isQuitting) {
      dialog.showErrorBox(
        'Sequence server stopped',
        `The embedded Sequence server exited unexpectedly (code=${code ?? 'null'} signal=${signal ?? 'null'}). Please restart the app.`
      );
    }
  },
});

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Sequence (unsigned engineer build)',
    /* The app's own ground (tokens/graphite.css --bg-base, dark), so the first
       frame before the page paints is the same colour as the page. */
    backgroundColor: '#202025',
    show: false,
    /* Belt and braces beside `Menu.setApplicationMenu(null)`: on Windows and
       Linux the bar is drawn INSIDE our own window, and a future menu added by
       a library or an Electron default would otherwise reappear at the top of
       the app the owner asked to have it removed from.

       IT STAYS UNDER THE FRAMELESS WINDOW BELOW, and the two agree rather than
       overlap: `frame: false` removes the frame Chromium draws,
       `autoHideMenuBar` removes a menu anything else might add inside it.
       Dropping either leaves one of the two ways a bar comes back. */
    autoHideMenuBar: true,
    /*
     * WE DRAW THE WINDOW BUTTONS — the owner, 2026-09-13, looking at the first
     * cut: "on ML Harness we did a really good job with the way we were able
     * to use the minimise, close, expand within our application. Right now it
     * doesn't look as good."
     *
     * That first cut was `titleBarStyle: 'hidden'` plus `titleBarOverlay`,
     * which hides Chromium's frame and then asks Chromium to paint the SYSTEM
     * buttons over the app bar. They are the platform's glyphs at the
     * platform's metrics on a rectangle we only get to colour — so they sit
     * in our chrome without belonging to it, which is exactly what he saw.
     * ML Harness is Tauri with `decorations: false` and draws its own; that is
     * the difference, and it is the whole difference.
     *
     * So: `frame: false`, and `WindowControls` in the app bar draws minimise,
     * maximise and close on our own rungs, in our own tokens, through
     * `sequence:shell`. `env(titlebar-area-*)` goes with the overlay — with no
     * overlay there is no reserved strip, and shell.css's padding rule falls
     * back to --sp-12 on its own.
     *
     * macOS KEEPS `hiddenInset`. Its traffic lights are an OS affordance
     * people reach for by muscle memory and they already sit inside the
     * window; replacing them would be worse, not better, and would be a
     * change nobody asked for on a platform this has never been run on.
     */
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  /* The chords the removed menu used to carry. Per window, because
     `before-input-event` is a webContents event and a re-created window (macOS
     dock activate) gets a new one. */
  bindShortcuts(mainWindow);

  /* Chromium persists zoom per ORIGIN, and every load in this app is the
     same 127.0.0.1 origin — a new window, a reload, or the repo-attach
     respawn would otherwise all inherit an old zoom. `did-finish-load`
     rather than once: it has to hold for every load, not the first. */
  applyZoom(mainWindow.webContents);
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) applyZoom(mainWindow.webContents);
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Keep navigation inside the embedded app; open any external link in the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(controller.url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  void mainWindow.loadURL(controller.url);
}

/**
 * The native "Open Repo…" flow (DESKTOP trust context). Shows the OS directory
 * picker; on a pick, restart the embedded server against that absolute path and
 * reload the window. Returns the chosen dir (or null if cancelled/failed) so the
 * IPC caller in the renderer can react too.
 */
async function openRepoDialog(): Promise<string | null> {
  const win = mainWindow ?? undefined;
  const result = await dialog.showOpenDialog(win!, {
    title: 'Open a repository',
    message: 'Choose a project folder for Sequence to scan',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Open Repo',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dir = result.filePaths[0];

  try {
    const status = await controller.setRepo(dir);
    if (mainWindow) {
      await mainWindow.loadURL(status.url); // stable port ⇒ same URL, fresh load
      mainWindow.webContents.send('sequence:repo-changed', { repoDir: status.repoDir, url: status.url });
    }
    return dir;
  } catch (e) {
    dialog.showErrorBox('Could not open repository', `Scanning ${dir} failed:\n\n${(e as Error).message}`);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   THE MENU BAR IS GONE, AND EVERYTHING IT DID MOVED INSIDE THE APP.

   Owner, 2026-09-12, looking at the Windows build: "make sure the File / Edit /
   View / Window / Help functions are editable via the settings page inside the
   actual application instead of the Windows menu bar options."

   So there is no application menu. What the menu used to own splits three ways,
   and all three still work:

     1. THE CHORDS. Every accelerator the menu carried is handled here, in
        `before-input-event`, off the SHORTCUTS table below. An accelerator that
        only existed as a menu item's `accelerator:` string dies with the menu;
        one that is matched against the real keystroke does not. The table is
        the single source of truth for both the chord and the string the
        Settings pane prints beside each row.

     2. THE ACTIONS. `sequence:shell` is one invoke channel carrying a named
        action, so the in-app Settings page can do everything the View / Help /
        File menus did — reload, force reload, devtools, the three zoom steps,
        full screen, the help page, quit — plus `info`, which is what the old
        Window/About surfaces were for.

     3. THE EDIT MENU. Undo / redo / cut / copy / paste / select-all are NOT
        reimplemented, deliberately. Those menu items are `role`s that map onto
        Chromium's own editing commands, and Chromium applies them to a focused
        text field from the keystroke itself with no menu in the chain. Removing
        the menu removes the menu items, not the behaviour: Ctrl/Cmd+Z, +X, +C,
        +V and +A keep editing text in the composer exactly as before. There is
        therefore nothing for the Settings pane to offer here, and offering a
        row that merely re-fires a chord the field already handles would be a
        control that claims to do something it does not.

   macOS keeps a MINIMAL app-menu-only template rather than a null menu. On mac
   the menu bar belongs to the OS, not to our window: with `setApplicationMenu(null)`
   the system bar still draws, but with no Quit, no Hide and no Services, so
   Cmd+Q stops working at the OS level in a way the renderer cannot fix — the
   `before-input-event` route below never sees a keystroke aimed at the system
   bar. One `{ role: 'appMenu' }` restores exactly that and adds no File / Edit /
   View / Window / Help bar, which is what the ask is about. Windows and Linux —
   where the ask was made and where the bar is drawn inside our own window — get
   no menu at all, plus `autoHideMenuBar` as a belt-and-braces second line.
   ══════════════════════════════════════════════════════════════════════════ */

const isMac = process.platform === 'darwin';

/**
 * Everything the removed menu could do, named. `info` is read-only.
 *
 * THE LAST THREE ARE THE WINDOW ITSELF, added 2026-09-13. They ride this
 * channel rather than a new one because the channel already exists, is already
 * gated by `contextIsolation` and a named union, and already returns a value
 * the pane can read back — `window-state` is how the maximise glyph knows
 * which of its two shapes to draw. A second IPC surface for three verbs would
 * be a second thing to keep in step with the preload, which is how a pane and
 * a main process drift.
 */
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
  | 'window-minimize'
  | 'window-maximize-toggle'
  | 'window-close'
  | 'window-state';

/** The one keystroke shape `before-input-event` hands us that we care about. */
interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** Cmd on mac, Ctrl elsewhere — and never with Alt, which is a different chord. */
function mod(input: KeyInput): boolean {
  return (isMac ? input.meta : input.control) && !input.alt;
}

/**
 * THE CHORDS, MATCHED AGAINST REAL KEYSTROKES.
 *
 * `accelerator` is not wired to anything by Electron any more — it is the name
 * of the chord, printed in Settings and asserted by the desktop source test.
 * `match` is what actually fires. Keeping both on one row is what stops the
 * printed shortcut and the working shortcut drifting apart, which is the
 * failure mode of every "shortcuts" help page ever written.
 */
const SHORTCUTS: readonly { accelerator: string; action: ShellAction; match: (i: KeyInput) => boolean }[] = [
  { accelerator: 'CmdOrCtrl+O', action: 'open-repo', match: (i) => mod(i) && !i.shift && i.key.toLowerCase() === 'o' },
  { accelerator: 'CmdOrCtrl+R', action: 'reload', match: (i) => mod(i) && !i.shift && i.key.toLowerCase() === 'r' },
  { accelerator: 'CmdOrCtrl+Shift+R', action: 'force-reload', match: (i) => mod(i) && i.shift && i.key.toLowerCase() === 'r' },
  { accelerator: 'F12', action: 'toggle-devtools', match: (i) => i.key === 'F12' },
  { accelerator: 'CmdOrCtrl+Shift+I', action: 'toggle-devtools', match: (i) => mod(i) && i.shift && i.key.toLowerCase() === 'i' },
  /* '+' is what Shift+= reports, and a keyboard with a dedicated + on the
     numpad reports it without Shift. Both mean "zoom in" to a person. */
  { accelerator: 'CmdOrCtrl+=', action: 'zoom-in', match: (i) => mod(i) && (i.key === '=' || i.key === '+') },
  { accelerator: 'CmdOrCtrl+-', action: 'zoom-out', match: (i) => mod(i) && (i.key === '-' || i.key === '_') },
  { accelerator: 'CmdOrCtrl+0', action: 'zoom-reset', match: (i) => mod(i) && i.key === '0' },
  { accelerator: 'F11', action: 'toggle-fullscreen', match: (i) => i.key === 'F11' },
  { accelerator: 'F1', action: 'open-help', match: (i) => i.key === 'F1' },
  { accelerator: 'CmdOrCtrl+Q', action: 'quit', match: (i) => mod(i) && i.key.toLowerCase() === 'q' },
];

/* ══════════════════════════════════════════════════════════════════════════
   ZOOM IS A LADDER OF FACTORS, NOT A WALK ALONG CHROMIUM'S LEVEL AXIS.

   Owner, 2026-09-17, on the installed Windows app: "some icon resolution
   stuff, some font resolution issues — typical UI elements."

   The cause was here. Electron's zoom ROLES step `zoomLevel` by 0.5, and a
   level is an exponent: factor = 1.2 ** level. So the old `zoomBy(win, ±0.5)`
   walked 1 → 1.0954… → 1.2 → 1.3145… → 1.44. Every rung but the third is an
   irrational-looking scale factor, and a fractional device scale is the one
   thing that makes a raster asset resample and text miss its hinting grid: a
   16px icon drawn at 1.0954 lands on 17.53 device pixels and is filtered
   across the boundary, which is precisely "icon resolution stuff, font
   resolution issues, typical UI elements". Nothing about the assets was
   wrong; the viewport they were being drawn into was off-grid.

   So the steps are PRESET FACTORS, chosen because each is either a whole
   number of device pixels for a 16px unit or a clean half — and `setZoomFactor`
   sets them exactly, rather than asking for a level and accepting whatever
   power of 1.2 comes back.

   AND CHROMIUM REMEMBERS. Zoom is persisted per origin for the life of the
   session, so a window created after a zoom — or a reload, or the repo-attach
   respawn, which reloads the same 127.0.0.1 origin — silently inherits it.
   That is how a person ends up with a permanently soft app and no memory of
   having zoomed. `applyZoom` therefore puts every fresh load back on 1 unless
   the user has moved it THIS session, and `zoom-reset` clears that flag.
   ══════════════════════════════════════════════════════════════════════════ */

/** The rungs. 1 is the default and must be one of them. */
const ZOOM_STEPS: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const DEFAULT_ZOOM = 1;

/**
 * The factor the user chose with Ctrl+= / Ctrl+- in THIS session, or null.
 *
 * Module-level rather than per-window on purpose: it is a preference about how
 * big the app should be, and it must outlive the window (macOS dock-activate
 * builds a new one) while NOT outliving the process the way Chromium's own
 * per-origin memory does. `zoom-reset` clears it, which is what makes Ctrl+0
 * mean "back to 1 and stay there" instead of "1 until the next reload".
 */
let userZoom: number | null = null;

/** The rung nearest a factor — so a zoom inherited from anywhere lands on the ladder. */
function nearestStep(factor: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STEPS.length; i++) {
    if (Math.abs(ZOOM_STEPS[i] - factor) < Math.abs(ZOOM_STEPS[best] - factor)) best = i;
  }
  return best;
}

/** One rung up (+1) or down (-1), clamped at the ends. Returns the new factor. */
function stepZoom(win: BrowserWindow, direction: 1 | -1): number {
  const from = nearestStep(win.webContents.getZoomFactor());
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, from + direction));
  const factor = ZOOM_STEPS[next];
  win.webContents.setZoomFactor(factor);
  userZoom = factor;
  return factor;
}

/** Put a freshly loaded page on the default rung unless the user moved it. */
function applyZoom(wc: WebContents): void {
  wc.setZoomFactor(userZoom === null ? DEFAULT_ZOOM : userZoom);
}

/**
 * Run one named action. The ONE implementation behind both doors — the chord
 * and the Settings row — so the two can never mean different things.
 */
async function runShellAction(action: ShellAction): Promise<unknown> {
  const win = mainWindow;
  if (!win) return null;
  const wc = win.webContents;

  switch (action) {
    case 'open-repo':
      return openRepoDialog();
    case 'reload':
      wc.reload();
      return null;
    case 'force-reload':
      wc.reloadIgnoringCache();
      return null;
    case 'toggle-devtools':
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: 'detach' });
      return null;
    case 'zoom-in':
      return { zoomFactor: stepZoom(win, 1) };
    case 'zoom-out':
      return { zoomFactor: stepZoom(win, -1) };
    case 'zoom-reset':
      /* Clearing the flag FIRST is the point: reset means the next reload
         also comes back at 1, not just this frame. */
      userZoom = null;
      wc.setZoomFactor(DEFAULT_ZOOM);
      return { zoomFactor: wc.getZoomFactor() };
    case 'toggle-fullscreen':
      win.setFullScreen(!win.isFullScreen());
      return { fullscreen: win.isFullScreen() };
    case 'open-help':
      /* THE SAME CHANNEL THE HELP MENU USED. One help page, and now three
         doors onto it: F1, the Settings row, and the command palette. */
      wc.send('sequence:open-help');
      return null;
    /*
     * THE WINDOW BUTTONS. Every one of these returns the resulting state, so
     * the pane never has to assume a press worked — it redraws from what the
     * main process reports. `window-close` is the exception and returns
     * nothing, because there is no pane left to tell.
     */
    case 'window-minimize':
      win.minimize();
      return { maximized: win.isMaximized() };
    case 'window-maximize-toggle':
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return { maximized: win.isMaximized() };
    case 'window-close':
      win.close();
      return null;
    case 'window-state':
      return { maximized: win.isMaximized() };
    case 'quit':
      app.quit();
      return null;
    case 'info':
      return {
        appVersion: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        zoomFactor: wc.getZoomFactor(),
        fullscreen: win.isFullScreen(),
      };
    default:
      /* An unknown action is a contract breach, not a silent no-op: the
         renderer asked for something this build does not have. */
      throw new Error(`unknown shell action: ${String(action)}`);
  }
}

/** Wire the chords to a window. Called once per window, at creation. */
function bindShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const hit = SHORTCUTS.find((s) => s.match(input as unknown as KeyInput));
    if (!hit) return;
    /* Swallowed so the page never also sees it — Ctrl+R reaching the renderer
       as a keypress AND reloading is one action happening twice. */
    event.preventDefault();
    void runShellAction(hit.action);
  });
}

/** No File / Edit / View / Window / Help bar anywhere. See the block above. */
function buildMenu(): void {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [{ role: 'appMenu' }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ──────────────────────────────────────────────────────────────────────────
   SMOKE MODE — "the window opens and shows the real app", made checkable.

   README.md has said since this package landed that the two claims a desktop
   shell exists to make — THE WINDOW OPENS and THE INSTALLER PACKAGES — were
   never demonstrated, because Electron's prebuilt binary 403s in the build
   sandbox. That is an honest disclosure and a permanent hole: every other
   package in this repo is gated, and the one a person actually double-clicks
   was gated only as far as `tsc` compiling and `server-control.ts` spawning a
   CLI with no window over it.

   With the binary present on a real machine the claim becomes testable, and
   this is the smallest hook that tests THE REAL PATH rather than a copy of it:
   the same `bootstrap()`, the same spawned analyzer child, the same
   `BrowserWindow`, the same `loadURL`. A separate smoke entry point would have
   been tidier and would have proved nothing about the file that ships.

   Gated on an env var, so an ordinary launch never reaches any of it.
   ────────────────────────────────────────────────────────────────────────── */

/** True only under `tools/desktop-smoke.mjs`. */
const SMOKE = process.env.SEQUENCE_DESKTOP_SMOKE === '1';

/**
 * Runs INSIDE the renderer, and waits for a SETTLED boot rather than a mounted
 * one. `did-finish-load` fires when the document and its module script are
 * done, which is before the app has asked `/api/status` anything. The boot
 * ladder's own contract is that every rung "terminates in a named outcome";
 * `probing` is the rung before that. An earlier cut of this probe returned the
 * instant the shell existed and reported `probing` as a pass — which would
 * have gone green against the one failure the ladder exists to forbid, "a
 * spinner that never resolves".
 */
const SMOKE_PROBE = `(async () => {
  const deadline = Date.now() + 45000;
  const pick = (id) => document.querySelector('[data-testid="' + id + '"]');
  const text = (id) => { const el = pick(id); return el ? (el.textContent || '').trim() : null; };
  while (Date.now() < deadline) {
    const shell = pick('shell');
    const boot = pick('boot-surface');
    const canvas = pick('canvas-region');
    const composer = pick('composer-field');
    /*
     * THREE SETTLED STATES, AND THE THIRD IS THE ONE A STRANGER SEES.
     *
     * This waited for a boot surface that had stopped probing, or a canvas
     * region. Measured 2026-09-10 against the running app with NO repository
     * attached: shell true, composer-field TRUE, boot-surface absent,
     * canvas-region absent — a usable app, and neither branch above matches it.
     * The gate then failed for 45 seconds on the ONE state it most exists to
     * check, packaged and unpackaged alike.
     *
     * A check that cannot pass in the state it is written for is the mirror of
     * one that cannot fail. Both report something other than the truth about
     * their subject; this one had been reporting a broken app since web2's
     * first run stopped rendering a boot surface.
     *
     * So a settled turn is any of: the boot ladder finished, the canvas drew,
     * or the composer is on screen and ready for the first question. The
     * returned "state" NAMES which one, because "it settled" without saying
     * into what is how this went unnoticed.
     *
     * NO BACKTICKS IN THIS COMMENT. It lives inside SMOKE_PROBE, which is a
     * template literal, so one backtick ends the string and the rest of the
     * probe becomes TypeScript — which is exactly how the first draft failed,
     * at src/main.ts(284,72).
     */
    const state = boot
      ? (boot.getAttribute('data-state') !== 'probing' ? 'boot' : null)
      : canvas
        ? 'canvas'
        : composer
          ? 'composer'
          : null;
    if (shell && state) {
      return {
        mounted: true,
        state,
        href: location.href,
        title: document.title,
        breakpoint: shell.getAttribute('data-breakpoint'),
        showing: boot ? 'boot' : canvas ? 'canvas' : 'composer',
        bootState: boot ? boot.getAttribute('data-state') : null,
        bootTitle: text('boot-title'),
        bootMessage: text('boot-message'),
        bootAction: text('boot-action'),
        composer: !!composer,
      };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const boot = pick('boot-surface');
  return {
    mounted: false,
    href: location.href,
    /* REPORT BOTH FACTS RATHER THAN INFER ONE. A mutation run proved why:
       with the shell anchor broken the timeout blamed the boot ladder, which
       had in fact settled. Two fields cannot mislead the way one verdict can. */
    shellPresent: !!pick('shell'),
    bootState: boot ? boot.getAttribute('data-state') : null,
    /* Named too, so a timeout says which anchors were missing rather than
       leaving the reader to guess which of three states failed to arrive. */
    canvasPresent: !!pick('canvas-region'),
    composerPresent: !!pick('composer-field'),
  };
})()`;

/** One line, machine readable, then down cleanly — the child server included. */
function smokeReport(ok: boolean, detail: unknown): void {
  console.log('SEQUENCE_DESKTOP_SMOKE ' + (ok ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(detail));
  if (isQuitting) return;
  isQuitting = true;
  void controller.stop().finally(() => app.exit(ok ? 0 : 1));
}

function runSmoke(win: BrowserWindow): void {
  /* A hang reports nothing at all, and CI reads that as a timeout rather than
     as a verdict. Every exit from smoke mode goes through smokeReport. */
  const timer = setTimeout(
    () => smokeReport(false, { reason: 'the window never finished loading within 90s' }),
    90000,
  );

  win.webContents.once('did-finish-load', () => {
    clearTimeout(timer);
    win.webContents
      .executeJavaScript(SMOKE_PROBE, true)
      .then((seen: Record<string, unknown>) => smokeReport(seen.mounted === true, seen))
      .catch((e: Error) => smokeReport(false, { reason: 'the probe threw', message: e.message }));
  });

  /* A renderer that dies takes the evidence with it unless we say so here. */
  win.webContents.on('render-process-gone', (_e, details) =>
    smokeReport(false, { reason: 'renderer gone', details }),
  );
}

async function bootstrap(): Promise<void> {
  // IPC: the renderer (via the preload bridge) can also trigger the native picker.
  ipcMain.handle('sequence:open-repo', () => openRepoDialog());

  /*
   * ONE CHANNEL FAMILY FOR THE WHOLE REMOVED MENU.
   *
   * A channel per menu item would have been eleven channels to add, eleven to
   * whitelist in the preload and eleven to keep in step with the Settings pane.
   * One channel carrying a NAMED action keeps the preload surface at a single
   * function and puts the list of what is allowed in one place — the switch in
   * `runShellAction`, which throws on anything it does not recognise rather
   * than quietly doing nothing.
   */
  ipcMain.handle('sequence:shell', (_e, action: ShellAction) => runShellAction(action));

  try {
    await controller.start(); // no-repo start → the web app's home screen takes over
  } catch (e) {
    /*
     * SMOKE FIRST, AND THE ORDER IS THE WHOLE POINT.
     *
     * `dialog.showErrorBox` is MODAL: it blocks the main process until a human
     * clicks OK. Reporting after it meant a smoke run against a server that
     * could not start hung forever on a dialog nobody was there to dismiss —
     * measured, three minutes with no output.
     *
     * And the first cut of this hook exited 0 on this branch entirely: a server
     * that never comes up quits before the window is created, so the probe
     * never runs and nothing reports. A gate that goes green when the product
     * does not start is worse than no gate. Both faults were found by mutating
     * `cliPath` to a file that does not exist; that mutation must exit non-zero.
     */
    if (SMOKE) {
      smokeReport(false, { reason: 'the embedded server did not come up', message: (e as Error).message, cliPath });
      return;
    }
    dialog.showErrorBox(
      'Sequence failed to start',
      `The embedded server did not come up:\n\n${(e as Error).message}\n\nCLI: ${cliPath}`
    );
    app.quit();
    return;
  }

  buildMenu();
  createWindow();

  if (SMOKE && mainWindow) runSmoke(mainWindow);

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  // Standard convention: stay resident on macOS, quit elsewhere.
  if (process.platform !== 'darwin') app.quit();
});

// Tear the embedded server down cleanly before the process exits.
app.on('before-quit', (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  void controller.stop().finally(() => app.quit());
});
