#!/usr/bin/env node
/*
 * linux-launch-smoke - launch the Linux artefacts the release just built, before they are uploaded.
 *
 *   node tools/ci/linux-launch-smoke.mjs --dir packages/desktop/release
 *
 * The AppImage is run under a virtual display (xvfb-run) with SEQUENCE_DESKTOP_SMOKE=1, which makes the real
 * main process print one `SEQUENCE_DESKTOP_SMOKE PASS|FAIL {...}` line once the window reached the app UI and exit
 * (packages/desktop/src/main.ts, smokeReport). The deb is installed with apt and its /opt/Sequence/sequence is run the
 * same way. A missing line is a failure, never a pass. `--no-sandbox` is for this smoke only (a CI runner has no
 * setuid sandbox); it is not part of the shipped launcher. Exit 0 all launched, 1 something failed, 2 not Linux or
 * nothing to launch. Run by .github/workflows/release.yml on the Linux row; never run by hand on a desktop.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEB_BINARY = '/opt/Sequence/sequence';
export const SMOKE_TIMEOUT_MS = 180_000;

/** The AppImage and deb to launch, from a list of file names. Several of one kind is an error: which would it be? */
export function selectArtefacts(files) {
  const appImages = files.filter((f) => /\.AppImage$/i.test(f));
  const debs = files.filter((f) => /\.deb$/i.test(f));
  const problems = [];
  if (appImages.length === 0) problems.push('no .AppImage in the release folder');
  if (debs.length === 0) problems.push('no .deb in the release folder');
  if (appImages.length > 1) problems.push(`more than one .AppImage: ${appImages.join(', ')}`);
  if (debs.length > 1) problems.push(`more than one .deb: ${debs.join(', ')}`);
  return { appImage: appImages.length === 1 ? appImages[0] : null, deb: debs.length === 1 ? debs[0] : null, problems };
}

/** The command that launches one artefact under a virtual display. */
export function launchCommand(kind, file) {
  const target = kind === 'deb' ? DEB_BINARY : file;
  return { cmd: 'xvfb-run', args: ['-a', target, '--no-sandbox'], env: { SEQUENCE_DESKTOP_SMOKE: '1', ...(kind === 'appimage' ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}) } };
}

/** The verdict from a finished (or timed out) launch. No SEQUENCE_DESKTOP_SMOKE line is a failure. */
export function verdict({ stdout, code, timedOut }) {
  if (timedOut) return { ok: false, reason: 'no verdict within the time limit' };
  const line = String(stdout ?? '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('SEQUENCE_DESKTOP_SMOKE '));
  if (!line) return { ok: false, reason: `the app printed no SEQUENCE_DESKTOP_SMOKE line (exit ${code})` };
  if (!line.startsWith('SEQUENCE_DESKTOP_SMOKE PASS')) return { ok: false, reason: line.slice(0, 400) };
  if (code !== 0) return { ok: false, reason: `reported PASS but exited ${code}` };
  return { ok: true, reason: line.slice(0, 400) };
}

function run({ cmd, args, env }, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    const t = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ stdout, code, timedOut });
    });
    child.on('error', (e) => {
      clearTimeout(t);
      resolve({ stdout: String(e), code: -1, timedOut: false });
    });
  });
}

export async function main(argv) {
  if (process.platform !== 'linux') {
    console.error('linux-launch-smoke runs on Linux only');
    return 2;
  }
  const i = argv.indexOf('--dir');
  const dir = path.resolve(i === -1 ? 'packages/desktop/release' : argv[i + 1]);
  const sel = selectArtefacts(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  if (sel.problems.length) {
    for (const p of sel.problems) console.error(`not launched: ${p}`);
    return 2;
  }
  let failed = 0;
  const appImage = path.join(dir, sel.appImage);
  fs.chmodSync(appImage, 0o755);
  const steps = [
    ['AppImage', launchCommand('appimage', appImage)],
    ['deb', launchCommand('deb', path.join(dir, sel.deb))],
  ];
  for (const [label, c] of steps) {
    if (label === 'deb') {
      const inst = spawnSync('sudo', ['apt-get', 'install', '-y', path.join(dir, sel.deb)], { stdio: 'inherit', windowsHide: true });
      if (inst.status !== 0) {
        console.error(`FAIL ${label}: apt could not install it (exit ${inst.status})`);
        failed += 1;
        continue;
      }
    }
    const v = verdict(await run(c, SMOKE_TIMEOUT_MS));
    console.log(`${v.ok ? 'PASS' : 'FAIL'} ${label}: ${v.reason}`);
    if (!v.ok) failed += 1;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
