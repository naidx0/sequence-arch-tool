# @sequence/desktop

An Electron desktop shell around the Sequence local architecture app: a
double-click window with a **native OS folder picker** for attaching a repo, plus
an `electron-builder` config that can produce **unsigned engineer** macOS /
Windows / Linux installers for local smoke — **not** a public download or signed
release.

It does **not** reimplement anything. On launch it spawns the already-built
Sequence server (`packages/analyzer/dist/cli.js` in `sequence` launch mode) as a
child process, waits until it answers on `http://127.0.0.1:<port>/`, and points a
`BrowserWindow` at it. The window is the same web app you get from `pnpm serve`.

---

## ✅ What is now verified — and how (read this first)

This section used to say the two claims a desktop shell exists to make were
never demonstrated. **Both are now demonstrated**, on Windows 11 / x64, and
getting there took two real fixes rather than a download.

| claim | how it is checked | result |
| --- | --- | --- |
| the Electron binary can be fetched | `node packages/desktop/node_modules/electron/install.js` | fetched; the 403 was the sandbox, not the package |
| **the window opens and shows the real app** | `node tools/desktop-smoke.mjs` | PASS — settles on "No graph yet" → *Open a repository*, composer on screen |
| the server bundle assembles | `node packages/desktop/scripts/prepare-server.mjs` | 14 MB bundle with a real `node_modules` |
| **the installer packages** | `pnpm --filter @sequence/desktop dist` | `release/Sequence Setup 0.1.0.exe`, 138 MB |
| **the PACKAGED app runs** | `node tools/desktop-smoke.mjs --packaged` | PASS — `app.isPackaged` resolves `<resources>/server/...` and the child server starts under `ELECTRON_RUN_AS_NODE` |

### The two things that were actually broken

Both were invisible for the same reason: the only platform that could not run
the packaging step was the only platform the config ships an installer for.

1. **`spawnSync pnpm ENOENT`.** `prepare-server.mjs` spawned `pnpm` by bare
   name. On Windows pnpm is `pnpm.cmd`, and since the fix for CVE-2024-27980
   Node refuses to spawn a `.cmd` without a shell. The error read as *"pnpm is
   not installed"* and the script's own advice sent the reader to `pnpm install`.
   Fixed in `scripts/pnpm-invocation.mjs`, locked by
   `tools/ci/desktop-packaging.test.mjs` (9 tests, 3 proven RED first).

2. **`ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`.** pnpm 10 will not deploy from a
   workspace that has not opted into injected dependencies. `prepare-server.mjs`
   now tries the plain form first and retries with `--legacy` on exactly that
   error — `--legacy` rather than setting `inject-workspace-packages=true`,
   which would change how every install in this workspace links its local
   packages to fix one packaging step.

### The gate

```bash
node tools/desktop-smoke.mjs              # dev shell: electron .
node tools/desktop-smoke.mjs --packaged   # unsigned engineer installer smoke
```

It runs the REAL `main.ts` under `SEQUENCE_DESKTOP_SMOKE=1`, waits for the boot
ladder to reach a **settled** state (not merely a mounted one), and turns the
result into an exit code. Where the Electron binary is absent it prints `SKIP`
on its own line with the reason — failing a machine that cannot download
Electron would make the gate something people learn to ignore.

Two mutations proved it is not vacuous: a `cliPath` pointing at a file that
does not exist exits 1, and breaking the probe's `shell` anchor exits 1. The
first mutation also found two faults in the hook itself — it exited **0** when
the server never came up, and it hung forever on a modal error dialog nobody
was there to dismiss.

### Still not verified here

- **macOS and Linux installers.** The config targets dmg/zip/AppImage/deb;
  only `--win nsis` has been run. `pnpmInvocation`'s non-Windows arm is
  unit-tested, not executed.
- **Code signing.** `no signing info identified, signing is skipped` — the
  installer is unsigned, so Windows SmartScreen will warn on first run.
- **An application icon.** `default Electron icon is used`.

---

## Run it on your machine

From the **repo root**:

```bash
# 1. Install (Electron's JS + types install without the binary under pnpm 10).
pnpm install

# 2. Let Electron fetch its actual binary (skipped by pnpm 10's default policy).
#    Pick ONE:
pnpm approve-builds            # interactive: approve `electron` (and esbuild if asked)
#    …or run Electron's own install step directly:
node node_modules/electron/install.js
#    …or approve just electron non-interactively by adding it to
#    pnpm.onlyBuiltDependencies in a LOCAL package.json edit, then `pnpm install`.

# 3. Build everything (analyzer + web2 + this package's tsc).
pnpm build

# 4. Launch the desktop app.
pnpm desktop                   # root convenience script
#    equivalently:
pnpm --filter @sequence/desktop dev
```

`pnpm desktop` starts the embedded server, opens the window, and lands on the
home screen (no repo attached yet). Use **File → Open Repo…** (or **Cmd/Ctrl+O**)
to pick a folder with the native OS dialog; the app rescans and shows it.

### Package installers

```bash
pnpm desktop:dist              # root convenience script
#    equivalently:
pnpm --filter @sequence/desktop dist
```

`dist` runs `scripts/prepare-server.mjs` (assembles the self-contained server
bundle via `pnpm deploy`) and then `electron-builder`. Installers land in
`packages/desktop/release/`:

- macOS: `Sequence-<version>-arm64.dmg`, `-x64.dmg`, and matching `.zip`
- Windows: `Sequence Setup <version>.exe` (NSIS)
- Linux: `Sequence-<version>.AppImage`, `sequence_<version>_amd64.deb`

Build each OS's installers on that OS (electron-builder does not cross-compile
macOS/Windows targets from Linux without extra tooling).

---

## Architecture

### Child process, not in-process

The Electron main process is CommonJS; the analyzer is ESM. Rather than fight
ESM/CJS interop, `server-control.ts` spawns `analyzer/dist/cli.js` as a **child
Node process** (`--no-open --port <free>` [+ `--repo <dir>`]). This:

- reuses the **exact** server the standing gate verifies (no reimplementation),
- picks a free port once and reuses it, so switching repos is a kill+respawn on
  the **same** port and the window just reloads the same URL,
- in a packaged app runs the child with Electron's own bundled Node
  (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`), so no system `node` is needed.

`server-control.ts` imports no Electron, so it is unit-tested headlessly.

### Two-context security model

"Attach a repo" has **two distinct trust contexts**, kept separate on purpose:

| Context | Path | Boundary |
| --- | --- | --- |
| **Browser** — the web app's home-screen folder picker | HTTP `GET /api/browse` + `POST /api/attach` | Realpath jail rooted at `$HOME` (no `..`, no absolute/symlink escape, sub-dirs only). **Untouched here** — it stays exactly as Phase B hardened it, because anything on localhost can call it. |
| **Desktop** — the native OS folder picker | `dialog.showOpenDialog` → restart child with `--repo <dir>` | The OS dialog **is** the trust boundary: the human picked the folder on their own machine. So it is not constrained by the `$HOME` jail; it reuses the analyzer's trusted startup `--repo` path and touches no server security code. |

The native pick deliberately does **not** go through `/api/attach` (that would
re-impose the browser jail) and we deliberately do **not** widen `/api/browse` /
`/api/attach` to accept the desktop path (that would widen the localhost-reachable
surface for everyone). See the big comment block in `src/main.ts`.

---

## Packaging assumptions that need on-machine validation

`electron-builder.yml` ships the server as `extraResources` (outside the asar,
because a child Node process must execute real files and resolve `node_modules`
normally). The assumptions to validate when you first package:

1. **`pnpm deploy` output.** `scripts/prepare-server.mjs` runs
   `pnpm --filter @sequence/analyzer deploy --prod server-bundle/packages/analyzer`.
   Confirm it produces `dist/cli.js` **and** a real `node_modules/` containing the
   workspace deps (`@sequence/schema`, `@sequence/export`) and the runtime deps
   (`graphology`, `graphology-communities-louvain`, `@vscode/tree-sitter-wasm`,
   `yaml`). If your pnpm rejects `deploy` for a workspace package, set
   `inject-workspace-packages=true` in `.npmrc` or upgrade pnpm.
2. **tree-sitter wasm.** `@vscode/tree-sitter-wasm` ships `.wasm` files the scanner
   loads at runtime; confirm they are present under the bundled analyzer's
   `node_modules` after deploy (they are ordinary files, so they should be).
3. **Runtime paths.** `src/main.ts` resolves the packaged CLI at
   `<resources>/server/packages/analyzer/dist/cli.js` and web dist at
   `<resources>/server/packages/web2/dist`. Verify these exist inside a built app
   (`.../Sequence.app/Contents/Resources/server/...` on macOS).
4. **Child spawn under `ELECTRON_RUN_AS_NODE`.** Confirm the packaged app spawns
   the CLI with Electron's Node and reaches 200 on `/` (check the app's console).
5. **Code signing / notarization** (macOS) and installer signing (Windows) are not
   configured here; add credentials for distribution outside your own machine.

---

## Building for macOS — the command for a MacBook, and what it will do on first run

**This cannot be produced on Windows.** `electron-builder` does not cross-compile a macOS target
from Windows, so the `.dmg` has to be built on the Mac. From a clean machine:

```bash
git clone https://github.com/naidx0/sequence-arch-tool
cd sequence-arch-tool
corepack enable
pnpm install
pnpm --filter @sequence/desktop dist
```

`electron-builder` defaults to the host platform, so on macOS that produces the `mac` targets in
`electron-builder.yml` — `Sequence-0.1.0-arm64.dmg`, `-x64.dmg` and the matching `.zip`, into
`packages/desktop/release/`.

**The mac target has never been run.** The config header has said so since the package landed and it
is still true: dmg/zip are authored from the electron-builder docs, and the first person to run the
command above is the first person to find out whether they build.

### Two things a stranger meets before the app, on either OS

Measured from the Windows build on 2026-09-10, in `electron-builder`'s own output:

- **The installer is unsigned** — `no signing info identified, signing is skipped`. On Windows that
  means SmartScreen shows *"Windows protected your PC"* and the person has to click **More info →
  Run anyway**. On macOS an unsigned, un-notarised `.dmg` is worse: Gatekeeper refuses with *"cannot
  be opened because the developer cannot be verified"*, and the way past it is **right-click → Open**
  (double-clicking gives no such option). Signing and notarisation are not configured here.
- **There is no application icon** — `default Electron icon is used, reason=application icon is not
  set`. `electron-builder.yml` has no `icon:` key, so the installer, the window and the dock/taskbar
  entry all carry the stock Electron logo.

Both are barriers between a download and a running app, and neither is a bug in the app.
