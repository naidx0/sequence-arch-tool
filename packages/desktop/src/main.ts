import { allowFrameNavigation } from './frameNavigation';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  ipcMain,
  Notification,
  nativeImage,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { ATTENTION_CHANNEL, AttentionController, type AttentionRequest } from './attention';
import { MainLog, pushTail } from './mainLog';
import { systemProxyEnv } from './proxyEnv';
import { launchPendingUpdate, registerUpdateOnQuit } from './updateHandoff';
import { decideRendererRecovery } from './rendererRecovery';
import { ServerController } from './server-control';
import { claimSingleInstance, showOrCreate, stopWithin } from './singleInstance';

/**
 * LAUNCH STAGES, as wall-clock epoch milliseconds, so the smoke runner (another
 * process) and the renderer (a third) land on one timeline. `processStart` is
 * Node's own time origin for this process; the rest are stamped as they happen.
 * Read only by smoke mode; an ordinary launch records a handful of numbers and
 * never looks at them.
 */
const launchMarks: Record<string, number> = { processStart: performance.timeOrigin };
function mark(name: string): void {
  launchMarks[name] = performance.timeOrigin + performance.now();
}
mark('mainStart');

/**
 * EVIDENCE FOR "THE WINDOW CLOSED ON ME". A small rotating log at
 * <userData>/logs/main.log (mainLog.ts): window close/closed and who asked,
 * renderer and child-process deaths, the server child's exit and respawn,
 * quit, and uncaught errors. No secrets, no repo contents, no prompt text.
 */
const userDataDir = app.getPath('userData');
const mainLog = new MainLog(path.join(userDataDir, 'logs'), { keepPrefix: userDataDir });
/** The release this build is: build-info's version (it can be four-part, 0.1.7.1), else the package version. */
function appVersion(): string {
  try {
    const info = JSON.parse(
      fs.readFileSync(path.join(process.resourcesPath, 'server', 'build-info.json'), 'utf8')
    ) as { version?: unknown };
    if (typeof info.version === 'string' && /^\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(info.version)) return info.version;
  } catch {
    /* no bundle info (a dev run): the package version */
  }
  return app.getVersion();
}
function buildCommit(): string {
  try {
    const info = JSON.parse(
      fs.readFileSync(path.join(process.resourcesPath, 'server', 'build-info.json'), 'utf8')
    ) as { commit?: unknown };
    return typeof info.commit === 'string' ? info.commit : 'unknown';
  } catch {
    return 'unknown';
  }
}
mainLog.write(
  'app-start',
  `version=${appVersion()} commit=${buildCommit()} packaged=${app.isPackaged} electron=${process.versions.electron} platform=${process.platform} pid=${process.pid} log=${mainLog.file}`
);
process.on('uncaughtExceptionMonitor', (err, origin) => {
  mainLog.write('uncaught-exception', `origin=${origin} ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  mainLog.write('unhandled-rejection', reason instanceof Error ? (reason.stack ?? `${reason.name}: ${reason.message}`) : String(reason));
});
app.on('child-process-gone', (_e, details) => {
  mainLog.write('child-process-gone', `type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name ?? ''}`);
});
/** The last few lines the embedded server wrote to stderr, for an unexpected-exit entry. */
const serverStderrTail: string[] = [];
function flushServerTail(): void {
  if (serverStderrTail.length === 0) return;
  mainLog.write('server-stderr-tail', JSON.stringify(serverStderrTail));
  serverStderrTail.length = 0;
}
/** Who asked the window to close: set by the window-close IPC, read by the 'close' event. */
/* Only the window-close IPC is attributed. Alt+F4, the taskbar and a renderer
   window.close() all arrive as the OS/user path and read 'os-or-user'. */
let closeInitiator: string | null = null;

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
  const packagesDir = packaged
    ? path.join(process.resourcesPath, 'server', 'packages')
    : path.resolve(__dirname, '..', '..'); // dist -> desktop -> packages
  const dist = path.join(packagesDir, 'analyzer', 'dist');
  /* THE BUNDLED SERVER WHEN IT IS THERE. `sequence-server-entry.cjs` runs one
     esbuild bundle of the CLI with a V8 code cache (analyzer
     scripts/bundle-server.mjs); it starts the same server as `cli.js` from
     one file instead of ~235 modules. `cli.js` stays the fallback for a build
     that has no bundle. */
  const entry = path.join(dist, 'sequence-server-entry.cjs');
  return {
    cliPath: fs.existsSync(entry) ? entry : path.join(dist, 'cli.js'),
    webDist: path.join(packagesDir, 'web2', 'dist'),
  };
}

const { cliPath, webDist } = serverPaths();

/* Merged into the server child's environment: the system proxy is added to it before the first start (bootstrap). */
const serverEnv: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1', SEQUENCE_APP_VERSION: appVersion(), SEQUENCE_COMPILE_CACHE: path.join(app.getPath('userData'), 'server-v8-cache') };

const controller = new ServerController({
  cliPath,
  webDist,
  // In a packaged app there is no system `node`; run the analyzer with Electron's
  // own bundled Node by re-invoking `process.execPath` as a plain Node process.
  nodeExecPath: process.execPath,
  /* The server's V8 code cache lives with the app's own data, per user, and
     survives updates only as long as the bundle is the same (the entry keys it
     by bundle size, mtime and Node version). */
  env: serverEnv,
  onLog: (line) => {
    console.log(line);
    if (line.startsWith('[server:err] ')) {
      pushTail(serverStderrTail, line.slice(13));
    } else if (line.startsWith('[server] exited on its own')) {
      /* every unexpected exit, including the one that is about to respawn */
      mainLog.write('server', line.slice(9));
      flushServerTail();
    } else if (/^\[server\] (exited|spawn error|restored)/.test(line)) {
      mainLog.write('server', line.slice(9));
    }
  },
  /* S1: a server that crashed is started again once, on the same port and
     repo; the page reloads and an agent chat resumes its thread. */
  onRespawned: () => {
    serverStderrTail.length = 0;
    mainLog.write('server-respawned', `port=${controller.url.split(':').pop()}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  },
  onUnexpectedExit: ({ code, signal }) => {
    mainLog.write('server-unexpected-exit', `code=${code ?? 'null'} signal=${signal ?? 'null'} stderr-tail=${JSON.stringify(serverStderrTail)}`);
    serverStderrTail.length = 0;
    // The embedded server died on its own and the one automatic restart did not
    // hold (or it never started). Surface it rather than leaving a blank window;
    // the user can relaunch. (Only fires for crashes, not our own kills.)
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

/*
 * S5, NEVER MISS A TURN. The renderer says when a turn ended or an approval is
 * waiting; this raises the OS notification, sets the dock badge and flashes
 * the Windows taskbar button, and clears both when the window comes forward.
 * The logic is Electron-free in ./attention.ts and unit-tested there.
 */
/*
 * WINDOWS DRAWS A TOAST ONLY FOR A KNOWN AppUserModelID. It must be the one
 * the Start-menu shortcut carries, which electron-builder sets from `appId`
 * (electron-builder.yml; attention.test.ts holds the two equal). Set at
 * startup, in dev as well as packaged, before any notification is built.
 */
export const APP_USER_MODEL_ID = 'dev.sequence.desktop';
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

/**
 * The taskbar overlay dot's colour: S4's dark-theme accent (#6b91ff). The
 * taskbar is drawn by Windows over the app's dark icon whatever the page's
 * theme, so the dark-ground blue is the one that reads there; S4's light
 * accent is #1f4fe0. Main has no token sheet, so the value is named once here.
 */
export const OVERLAY_DOT_RGB = { r: 0x6b, g: 0x91, b: 0xff } as const;

/** A 16 px dot for the Windows taskbar overlay, in OVERLAY_DOT_RGB. */
function overlayDot(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const a = Math.max(0, Math.min(1, 7.5 - d)) * 255;
      const i = (y * size + x) * 4;
      /* BGRA, premultiplied. */
      buf[i] = Math.round(OVERLAY_DOT_RGB.b * (a / 255));
      buf[i + 1] = Math.round(OVERLAY_DOT_RGB.g * (a / 255));
      buf[i + 2] = Math.round(OVERLAY_DOT_RGB.r * (a / 255));
      buf[i + 3] = Math.round(a);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

const attention = new AttentionController({
  window: () => mainWindow,
  app,
  notifier: {
    isSupported: () => Notification.isSupported(),
    create: (opts) => new Notification({ title: opts.title, body: opts.body }),
  },
  platform: process.platform,
  overlayIcon: overlayDot,
  log: (line) => console.log(line),
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
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
      ? {
          titleBarStyle: 'hiddenInset' as const,
          /* 0.1.8 C1 (owner: the red, yellow and green lights "are kind of blending in with the actual Sequence
             title ... a little bit of buffer space at the top"). x 18 / y 14: 14 px of window above the lights, and
             the web shell leaves their row clear: the sidebar's title row sits below it (--mac-lights-row) and a
             folded sidebar's chat header keeps 78 px to their right (--mac-lights-w), both in shell2.css. */
          trafficLightPosition: { x: 18, y: 14 },
        }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      /* Cache the renderer's compiled scripts from the first load, not only
         after V8 decides a script is hot; the app loads the same bundle every
         launch. */
      v8CacheOptions: 'bypassHeatCheck',
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

  mainWindow.once('ready-to-show', () => {
    mark('readyToShow');
    mainWindow?.show();
  });
  mainWindow.on('close', () => {
    mainLog.write('window-close', `initiator=${closeInitiator ?? (isQuitting ? 'app-quit' : 'os-or-user')}`);
    closeInitiator = null;
  });
  mainWindow.on('closed', () => {
    mainLog.write('window-closed');
    mainWindow = null;
  });
  /* A renderer that dies must not leave a silent blank window: reload once;
     a second death inside the policy window shows the error dialog. */
  let recentRendererDeaths: number[] = [];
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    mainLog.write('render-process-gone', `reason=${details.reason} exitCode=${details.exitCode}`);
    if (SMOKE || isQuitting || details.reason === 'clean-exit') return;
    const decision = decideRendererRecovery(recentRendererDeaths, Date.now());
    recentRendererDeaths = decision.recent;
    if (decision.action === 'reload') {
      mainLog.write('renderer-reload', 'first death in window');
      mainWindow?.webContents.reload();
    } else {
      mainLog.write('renderer-dialog', 'second death in window; not reloading');
      dialog.showErrorBox(
        'Sequence window stopped',
        `The window's renderer process ended unexpectedly twice in a row (${details.reason}). Please restart the app. Details are in ${mainLog.file}`
      );
    }
  });
  mainWindow.on('focus', () => attention.onFocus());
  mainWindow.on('blur', () => attention.onBlur());

  // Keep navigation inside the embedded app; open any external link in the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(controller.url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  /* A sandboxed srcdoc frame (an agent's html block) may not navigate anywhere (frameNavigation.ts). */
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (!allowFrameNavigation(event.isMainFrame, event.url)) event.preventDefault();
  });

  void mainWindow.loadURL(controller.url);
}

/**
 * The native "Open Repo…" flow (DESKTOP trust context). Shows the OS directory
 * picker; on a pick, restart the embedded server against that absolute path and
 * reload the window. Returns the chosen dir (or null if cancelled/failed) so the
 * IPC caller in the renderer can react too.
 */
/** Where the shell keeps what it has to know before a server exists. */
function placeFile(): string {
  return path.join(userStoreDir(), 'last-place.json');
}

/**
 * The user store, as the engine resolves it: SEQUENCE_USER_DIR when set (the
 * desktop smoke points it at a temp dir so a gate run cannot rewrite the
 * person's remembered place), else ~/.sequence. The shell reads and writes
 * last-place.json itself, before any server exists, so it must agree with
 * the server about where that file lives.
 */
function userStoreDir(): string {
  /* The engine's own rule (analyzer server/store.ts userStoreDir): an absolute
     override, anything else ignored. */
  const moved = process.env.SEQUENCE_USER_DIR;
  return moved && path.isAbsolute(moved) ? moved : path.join(os.homedir(), '.sequence');
}

function readPlace(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(placeFile(), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * ── THE PORT IS THE ORIGIN, AND THE ORIGIN IS THE MEMORY ──────────────────
 *
 * Owner, 2026-09-21: "there should be client wide memory, remember the last
 * prompt, project, folder, mode, everything."
 *
 * The web app already remembers most of that — the composer mode, which
 * surfaces are open, the rail and chat widths, the Files tree width — all in
 * `localStorage`. None of it ever came back, and not because the writes were
 * missing.
 *
 * `localStorage` is keyed by ORIGIN. This shell asked for a free port on every
 * launch (`findFreePort`, because no `port` was ever passed), so the window
 * loaded `http://127.0.0.1:<random>` and every launch was a brand-new origin
 * with nothing in it. The app was saving faithfully into a drawer it then
 * threw away.
 *
 * So the port is remembered and re-used. It is a HINT, not a requirement: if
 * something else has taken it since, a free one is chosen and that launch
 * loses its layout — which is the old behaviour, and strictly better than
 * refusing to start over a convenience.
 */
function rememberedPort(): number | undefined {
  const v = readPlace().port;
  return typeof v === 'number' && Number.isInteger(v) && v > 1024 && v < 65536 ? v : undefined;
}

function rememberPort(port: number): void {
  try {
    const next = { ...readPlace(), port };
    fs.mkdirSync(path.dirname(placeFile()), { recursive: true });
    fs.writeFileSync(placeFile(), JSON.stringify(next, null, 2));
  } catch {
    /* read-only home — the next launch picks a fresh port, as it always did */
  }
}

/**
 * Is this port actually free right now?
 *
 * Asked before it is handed to the controller, because the controller treats a
 * given port as a requirement and would fail the whole launch on EADDRINUSE.
 * A remembered port that something else has taken must degrade to "pick a new
 * one", not to "the app does not start".
 */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/**
 * The repository this person was last in, or null.
 *
 * A DIRECT READ of `~/.sequence/last-place.json`, which the engine writes on
 * every attach. The shell cannot ask the server for this — it is deciding what
 * to start the server on — so it reads the same file the server serves.
 *
 * Every failure is null: no file, bad JSON, a path that is not a string, a
 * folder that has since been moved or deleted, a home directory it cannot
 * read. Opening on the home screen is the correct outcome for all of them, and
 * it is what happened before this existed.
 */
function lastRepoDir(): string | null {
  try {
    const file = placeFile();
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const repo = (raw as { repo?: unknown }).repo;
    if (typeof repo !== 'string' || !path.isAbsolute(repo)) return null;
    /* A folder he has since moved is not where he was; starting the engine on
       it would fail the launch to honour a memory. */
    return fs.statSync(repo).isDirectory() ? repo : null;
  } catch {
    return null;
  }
}

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

  return attachWithRetry(dir);
}

/**
 * -- A FAILED ATTACH MUST NOT COST HIM THE FOLDER HE PICKED ----------------
 *
 * Owner, 2026-09-21, photo 27:
 *
 *   `Scanning .../GitHub/t3code failed: server did not become healthy at
 *    http://127.0.0.1:52621 within 30000ms: ECONNREFUSED`
 *
 * and then: "I tried it again. And T3 code loaded good."
 *
 * TWO FAULTS, AND THE SENTENCE IS THE FIRST ONE. The scan never began. The
 * embedded engine is restarted on every attach and polled for 30 seconds, and
 * ECONNREFUSED for the whole window means the child never bound its port. A
 * message that names the scan sends a reader to look at their repository for a
 * problem that is in ours.
 *
 * THE SECOND IS THAT IT WAS A DEAD END. `showErrorBox` has one button, so the
 * only way back was to reopen the dialog and find the folder again -- for a
 * failure he had already discovered was intermittent. The retry is here
 * because retrying is what actually worked.
 *
 * The race itself is NOT fixed by this, and pretending otherwise would be
 * worse than the dead end: five attaches from the CLI never reproduced it, so
 * there is nothing yet to point at. This makes the failure legible and
 * survivable, which is what can be done honestly without a reproduction.
 */
async function attachWithRetry(dir: string): Promise<string | null> {
  for (;;) {
    try {
      const status = await controller.setRepo(dir);
      if (mainWindow) {
        await mainWindow.loadURL(status.url); // stable port, same URL, fresh load
        mainWindow.webContents.send('sequence:repo-changed', {
          repoDir: status.repoDir,
          url: status.url,
        });
      }
      return dir;
    } catch (e) {
      const message = (e as Error).message;
      /* Told apart on the engine's own words. The scan is a separate stage and
         its failures read differently -- a manifest it could not parse, a file
         it could not open -- and those keep their own sentence. */
      const engineNeverStarted = /did not become healthy|ECONNREFUSED/i.test(message);

      const choice = await dialog.showMessageBox(mainWindow ?? undefined!, {
        type: 'warning',
        buttons: ['Try again', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Could not open repository',
        message: engineNeverStarted
          ? 'The Sequence engine did not start in time.'
          : `Scanning ${dir} failed.`,
        detail: engineNeverStarted
          ? `Nothing was read from ${dir} -- the scan never began, so this is not a problem with the folder. This is usually intermittent; trying again generally works.\n\n${message}`
          : message,
      });

      if (choice.response !== 0) return null;
      /* Round again on the SAME path. Not having to find the folder a second
         time is most of the point. */
    }
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
        reimplemented, deliberately. On Windows and Linux Chromium applies them
        to a focused text field from the keystroke itself with no menu in the
        chain, so removing the menu removes only the menu items. That is NOT
        true on macOS: there Electron routes Cmd+Z/X/C/V/A through the Edit
        menu's key equivalents, so with no Edit menu they do nothing anywhere
        in the app. The mac template therefore carries `editMenu` (below); the
        Windows/Linux path stays menu-less.

   macOS keeps a MINIMAL app-menu-only template rather than a null menu. On mac
   the menu bar belongs to the OS, not to our window: with `setApplicationMenu(null)`
   the system bar still draws, but with no Quit, no Hide and no Services, so
   Cmd+Q stops working at the OS level in a way the renderer cannot fix — the
   `before-input-event` route below never sees a keystroke aimed at the system
   bar. `{ role: 'appMenu' }` restores exactly that, and `{ role: 'editMenu' }` is
   what makes Cmd+C / V / X / A / Z work at all on mac. The File / View / Window /
   Help bar the ask was about stays gone. Windows and Linux —
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
  | 'restart-for-update'
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
      closeInitiator = 'renderer-ipc';
      /* a cancelled or never-emitted close must not tag a later one */
      setTimeout(() => { closeInitiator = null; }, 2000).unref();
      win.close();
      return null;
    case 'window-state':
      return { maximized: win.isMaximized() };
    case 'quit':
      app.quit();
      return null;
    /* The update is on disk and a helper is waiting for this process to exit (mac in-place swap, Windows portable
       zip): quit so it can finish and open the new version. Its own name so the log says why the app went. */
    case 'restart-for-update':
      mainLog.write('restart-for-update');
      app.quit();
      return null;
    case 'info':
      return {
        appVersion: appVersion(),
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
  const template: MenuItemConstructorOptions[] = [{ role: 'appMenu' }, { role: 'editMenu' }];
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
        /* On the wall clock, the same clock main.ts marks with. */
        settledAt: performance.timeOrigin + performance.now(),
        href: location.href,
        title: document.title,
        breakpoint: shell.getAttribute('data-breakpoint'),
        showing: boot ? 'boot' : canvas ? 'canvas' : 'composer',
        bootState: boot ? boot.getAttribute('data-state') : null,
        bootTitle: text('boot-title'),
        bootMessage: text('boot-message'),
        bootAction: text('boot-action'),
        composer: !!composer,
        /* When index.html's prerendered composer took focus, if it was shown. */
        staticShownAt: window.__sequenceStaticShell ? performance.timeOrigin + window.__sequenceStaticShell.shownAt : null,
        staticDropped: window.__sequenceStaticShellDropped || null,
      };
    }
    /* 20 ms, not 100: the settle time is a measured stage, and the poll
       interval is its resolution. */
    await new Promise((r) => setTimeout(r, 20));
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
    /*
     * FIRST PAINT IS THE FIRST FRAME, NOT THE PAINT-TIMING ENTRY. The window
     * is created hidden (show: false), and Chromium records no first-paint
     * entry for a page that painted while hidden. requestAnimationFrame does
     * not run until the window is visible, so the second frame callback is the
     * first frame a person could have seen.
     */
    const firstFrame: Promise<number | null> = win.webContents
      .executeJavaScript(
        'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.timeOrigin + performance.now()))))',
        true,
      )
      .catch(() => null);
    win.webContents
      .executeJavaScript(SMOKE_PROBE, true)
      .then(async (seen: Record<string, unknown>) => {
        const firstPaint = await firstFrame;
        /* TYPEABLE: the first moment a key would land in a composer. The
           window is hidden until ready-to-show and shown there, so a static
           composer counts from that moment, not from when it was parsed.
           (Not from `firstPaint`: that mark is taken after did-finish-load,
           which waits for the bundle, so it can come after React's composer.) */
        const staticAt = typeof seen.staticShownAt === 'number' ? seen.staticShownAt : null;
        const shownAt = typeof launchMarks.readyToShow === 'number' ? launchMarks.readyToShow : null;
        const composerTypeable =
          staticAt !== null && shownAt !== null ? Math.max(staticAt, shownAt) : ((seen.settledAt as number | undefined) ?? null);
        return smokeReport(seen.mounted === true, {
          ...seen,
          marks: {
            ...launchMarks,
            firstPaint,
            composerInteractive: seen.settledAt ?? null,
            composerTypeable,
          },
        });
      })
      .catch((e: Error) => smokeReport(false, { reason: 'the probe threw', message: e.message }));
  });

  /* A renderer that dies takes the evidence with it unless we say so here. */
  win.webContents.on('render-process-gone', (_e, details) =>
    smokeReport(false, { reason: 'renderer gone', details }),
  );
}

async function bootstrap(): Promise<void> {
  mark('appReady');
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
  /* S5: notifications, the waiting-approvals badge and flashFrame. One named
     channel, like `sequence:shell`; ./attention.ts throws on unknown kinds. */
  ipcMain.handle(ATTENTION_CHANNEL, (_e, req: AttentionRequest) => attention.handle(req));

  try {
    /*
     * ── IT OPENS WHERE HE LEFT IT ───────────────────────────────────────
     *
     * Owner, 2026-09-21: "there should be client wide memory, remember the
     * last prompt, project, folder, mode, everything."
     *
     * This was `controller.start()` with no argument, and its comment said
     * what that meant: "no-repo start → the web app's home screen takes over".
     * The project LIST survived a restart — that is `recent.json` — so the
     * rail came back with four projects in it and none of them open. Every
     * launch put him at the beginning of a workspace he had been working in.
     *
     * READ DIRECTLY, NOT OVER HTTP. The shell has to decide what to start the
     * engine ON, which is before any server exists to ask. It is the same file
     * `GET /api/last-place` serves, read with the same tolerance: anything
     * missing, unreadable or pointing at a folder that is no longer there
     * yields no repo and the old behaviour, because a launch must never fail
     * to honour a convenience.
     */
    /* THE SAME ORIGIN AS LAST TIME, so the window opens with its layout, its
       mode and its widths — see `rememberedPort`. A port that is no longer
       free degrades to a fresh one rather than failing the launch. */
    const wanted = rememberedPort();
    if (wanted !== undefined && (await portIsFree(wanted))) controller.usePort(wanted);
    /* The system proxy (Windows registry, macOS scutil) becomes HTTPS_PROXY for the server and everything it starts, unless
       the person set one: the Claude bridge download, the agent CLIs and the update check all read it. Before the spawn. */
    Object.assign(
      serverEnv,
      await systemProxyEnv({
        run: (cmd, args) => new Promise<string>((resolve, reject) => execFile(cmd, args, { windowsHide: true, timeout: 5000, encoding: 'utf8' }, (e, out) => (e ? reject(e) : resolve(out)))),
        resolveProxy: (url) => session.defaultSession.resolveProxy(url),
        log: (line) => mainLog.write('system-proxy', line),
      }),
    );
    const status = await controller.start(lastRepoDir() ?? undefined);
    mark('serverUp');
    rememberPort(status.port);
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
  mark('windowCreated');

  if (SMOKE && mainWindow) runSmoke(mainWindow);

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

/*
 * ONE SEQUENCE AT A TIME (round 7, A8; singleInstance.ts). A second launch
 * (a double click while one is running, or one left without a window) hands
 * over to the running app, which shows or re-creates its window, and quits
 * before it starts a second server or waits on the first one's profile.
 */
const firstInstance = claimSingleInstance(app, {
  smoke: SMOKE,
  onSecondInstance: () => {
    if (!app.isReady()) return;
    showOrCreate(mainWindow, createWindow);
  },
});
if (!firstInstance) app.quit();
else app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  mainLog.write('window-all-closed');
  // Standard convention: stay resident on macOS, quit elsewhere.
  if (process.platform !== 'darwin') app.quit();
});

// Tear the embedded server down cleanly before the process exits.
app.on('before-quit', (event) => {
  if (isQuitting) return;
  isQuitting = true;
  mainLog.write('before-quit');
  event.preventDefault();
  /* Bounded: a teardown that hangs must not leave a windowless Sequence
     holding the profile, which made the next launch wait about 6 s. */
  void stopWithin(() => controller.stop(), 5000).then((how) => {
    /* A stop that timed out may leave the server still holding files: the update is not run then; it stays for the next quit. */
    if (how === 'timeout') app.exit(0);
    else app.quit();
  });
});

/**
 * Start the update the server left behind (installer, portable copy, mac or AppImage swap) now that the server is
 * stopped. It cannot be started by the server: the server's whole process tree is ended on quit. Main vets the request
 * and builds every command itself (updateHandoff.ts). Vetting can take a moment (SHASUMS256.txt, the zip's manifest), so
 * the quit waits for it, at most 20 s, then goes on.
 */
registerUpdateOnQuit(app, {
  firstInstance,
  smoke: SMOKE,
  run: () =>
    launchPendingUpdate(
      {
        userDir: userStoreDir(),
        platform: process.platform,
        arch: process.arch,
        currentVersion: appVersion(),
        execPath: process.execPath,
        pid: process.pid,
        systemRoot: process.env.SystemRoot,
        appImage: process.env.APPIMAGE,
      },
      { log: (line) => mainLog.write('update-handoff', line) },
    ).catch((e: Error) => mainLog.write('update-handoff', `error: ${e.message}`)),
});
