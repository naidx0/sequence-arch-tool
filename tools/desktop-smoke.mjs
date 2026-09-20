#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   THE DESKTOP GATE — does the unsigned engineer package actually open?
   tools/desktop-smoke.mjs

   `packages/desktop/README.md` has carried this disclosure since the package
   landed:

     "The claims 'the window opens' and 'the installer packages' are NOT
      demonstrated in CI."

   That was honest and it was a hole. Electron's prebuilt binary 403s from the
   build sandbox, so the one package a person double-clicks was gated only as
   far as `tsc` compiling and `server-control.ts` spawning a CLI with no window
   over it. Everything above the window — does the renderer load the real app,
   does the boot ladder settle, is there a composer on screen — was untested by
   construction.

   This runs the REAL app in smoke mode (see `packages/desktop/src/main.ts`),
   reads its one machine-readable line, and turns it into an exit code.

   ── IT SKIPS, IT DOES NOT PASS ───────────────────────────────────────────
   Where the binary is absent this exits 0 with SKIP printed loudly, because
   failing a machine that cannot download Electron would make the whole gate
   something people learn to ignore. A SKIP that reads like a PASS is the
   defect this file exists to avoid, so the word is on its own line and the
   reason is named.
   ══════════════════════════════════════════════════════════════════════════ */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = path.join(ROOT, 'packages', 'desktop');

/** Electron's own record of where it unpacked its binary. */
function electronBinary() {
  const pathTxt = path.join(DESKTOP, 'node_modules', 'electron', 'path.txt');
  if (!fs.existsSync(pathTxt)) return null;
  const rel = fs.readFileSync(pathTxt, 'utf8').trim();
  const bin = path.join(DESKTOP, 'node_modules', 'electron', 'dist', rel);
  return fs.existsSync(bin) ? bin : null;
}

/*
 * TWO THINGS CAN BE SMOKED, AND THE SECOND IS THE ONE PEOPLE DOWNLOAD.
 *
 * `--packaged` runs `release/win-unpacked/Sequence.exe` (or its mac/linux
 * sibling) instead of `electron .`. It is a different code path in the file
 * under test: `serverPaths()` branches on `app.isPackaged`, and the packaged
 * arm resolves `<resources>/server/packages/...` — the `extraResources` layout
 * that `electron-builder.yml` writes and that `README.md` listed as never
 * validated at runtime. Running the dev build proves nothing about it.
 */
const PACKAGED = process.argv.includes('--packaged');

function packagedBinary() {
  const dir = path.join(DESKTOP, 'release');
  const candidates = {
    win32: [path.join(dir, 'win-unpacked', 'Sequence.exe')],
    darwin: [path.join(dir, 'mac-arm64', 'Sequence.app', 'Contents', 'MacOS', 'Sequence'),
             path.join(dir, 'mac', 'Sequence.app', 'Contents', 'MacOS', 'Sequence')],
    linux: [path.join(dir, 'linux-unpacked', 'sequence')],
  }[process.platform] ?? [];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function skip(why) {
  console.log('SKIP  desktop-smoke');
  console.log('      ' + why);
  console.log('      run `node packages/desktop/node_modules/electron/install.js` to fetch it');
  process.exit(0);
}

const bin = PACKAGED ? packagedBinary() : electronBinary();
if (!bin) {
  skip(
    PACKAGED
      ? 'no packaged app under packages/desktop/release — run `pnpm desktop:dist` first'
      : 'the Electron binary is not present on this machine',
  );
}

/* The window needs something to serve. Checked here rather than left to a
   confusing runtime failure inside Electron. */
for (const need of PACKAGED ? [] : [
  path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js'),
  path.join(ROOT, 'packages', 'web2', 'dist', 'index.html'),
]) {
  if (!fs.existsSync(need)) {
    console.error('FAIL  desktop-smoke — build first, missing: ' + path.relative(ROOT, need));
    process.exit(1);
  }
}

const child = spawn(bin, ['.'], {
  cwd: DESKTOP,
  env: { ...process.env, SEQUENCE_DESKTOP_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (b) => { out += b.toString(); });
child.stderr.on('data', (b) => { out += b.toString(); });

/* A belt over the main process's own 90s timer: if Electron itself wedges,
   nothing inside it can report. */
const kill = setTimeout(() => {
  console.error('FAIL  desktop-smoke — Electron did not exit within 150s');
  child.kill('SIGKILL');
  process.exit(1);
}, 150000);

child.on('exit', (code) => {
  clearTimeout(kill);
  const line = out.split(/\r?\n/).find((l) => l.startsWith('SEQUENCE_DESKTOP_SMOKE '));

  /*
   * NO LINE IS A FAILURE, NEVER A PASS. An exit code of 0 with nothing
   * reported is exactly what the first cut of the main-process hook produced
   * when the embedded server could not start — it quit before the window was
   * created, said nothing, and returned success.
   */
  if (!line) {
    console.error('FAIL  desktop-smoke — Electron exited ' + code + ' without reporting');
    console.error(out.split(/\r?\n/).slice(-25).join('\n'));
    process.exit(1);
  }

  const passed = line.startsWith('SEQUENCE_DESKTOP_SMOKE PASS');
  const detail = JSON.parse(line.slice(line.indexOf('{')));

  if (!passed || code !== 0) {
    console.error('FAIL  desktop-smoke');
    console.error('      ' + JSON.stringify(detail, null, 2).split('\n').join('\n      '));
    process.exit(1);
  }

  console.log('PASS  desktop-smoke' + (PACKAGED ? ' --packaged' : '') + ' — the window opened and the app settled');
  console.log('      url        ' + detail.href);
  /* WHICH STATE SETTLED, by name. A pass that does not say what it passed on
     is how this gate spent weeks failing on the no-repo first run without
     anyone reading it as a gate problem rather than an app problem. */
  console.log('      settled on ' + (detail.state ?? '(unnamed)') +
    '  — showing ' + detail.showing + ' / boot ' + detail.bootState);
  console.log('      first screen "' + detail.bootTitle + '" -> [' + detail.bootAction + ']');
  console.log('      composer   ' + (detail.composer ? 'on screen' : 'ABSENT'));
});
