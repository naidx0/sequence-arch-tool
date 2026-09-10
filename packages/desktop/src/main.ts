import path from 'node:path';
import { app, BrowserWindow, dialog, Menu, ipcMain, shell, type MenuItemConstructorOptions } from 'electron';
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
    backgroundColor: '#0b0d12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Repo…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            void openRepoDialog();
          },
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    { role: 'windowMenu' },
    {
      /*
       * A HELP MENU, BECAUSE A DOWNLOADED APP HAS ONE.
       *
       * The register's onboarding row was marked done and corrected to
       * "OVERSTATED — not built": the whole of it was a Ctrl-K hint in the app
       * bar. In a browser tab that is at least discoverable by accident; in a
       * window somebody double-clicked, the menu bar is where a person who has
       * never met this product looks first.
       *
       * It opens the SAME page the palette opens. One help page, two doors.
       */
      role: 'help',
      submenu: [
        {
          label: 'What can I do here?',
          click: () => mainWindow?.webContents.send('sequence:open-help'),
        },
      ],
    },
  ];
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
