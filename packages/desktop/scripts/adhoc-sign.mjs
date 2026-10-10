// adhoc-sign — electron-builder `afterPack` hook. Ad-hoc signs the macOS app
// bundle so that a downloaded copy can open at all.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
//
// Owner, 2026-09-19: "I asked my friend who installed 0.1.0 and he said the
// actual package is broken — he downloaded it and it was corrupted. Make sure
// people can just fresh download with nothing else and literally run the
// product. Fix this on everything: the EXE, DMGs, etc."
//
// `electron-builder.yml` sets `mac.identity: null`, which is a deliberate
// owner ruling (2026-09-10: no Apple developer account). Read what that
// actually does, in app-builder-lib@25.1.8 `out/macPackager.js:182-189`:
//
//     const qualifier = options.identity;
//     if (qualifier === null) { … log "skipped macOS code signing"; return false }
//
// It returns BEFORE any signing, including ad-hoc. That is fine for Intel and
// fatal for Apple silicon: arm64 macOS requires every executable to carry a
// signature, and ad-hoc ("-") counts. Electron ships its own binaries ad-hoc
// signed, but packaging rewrites Info.plist, renames the executable and adds
// the resource tree, which invalidates it. The app that comes out is not
// signed at all, and macOS refuses it with
//
//     "Sequence" is damaged and can't be opened. You should move it to the Trash.
//
// — which is exactly what a person reports as "the package is corrupted". The
// file is intact; the OS will not run it.
//
// AD-HOC IS NOT NOTARISATION AND DOES NOT PRETEND TO BE. Gatekeeper still
// warns on first open and the reader still has to right-click → Open once.
// What this buys is that the app CAN open at all on an M-series Mac, which
// without it it cannot, at any number of clicks.
//
// ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
//
// It is a no-op on every platform but darwin, and a no-op when a real identity
// is configured (`CSC_LINK` / `CSC_NAME`) — re-signing a properly signed
// bundle with "-" would REPLACE a distribution signature with a worthless one,
// which is a worse failure than the one this fixes because it looks fine.
//
// STILL UNVERIFIED ON A MAC. There is no macOS machine in this project; the
// `codesign` invocation is the documented one and the branch logic is locked
// by tools/ci/desktop-packaging.test.mjs, but nobody has watched it run.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Should this pack be ad-hoc signed?
 *
 * Exported and pure so the gate can check the branch on a machine that is not
 * a Mac — the same argument `pnpmInvocation` makes, and for the same reason:
 * a check that only runs on the target platform leaves the target platform's
 * bug invisible to everybody else.
 *
 * @param {string} platform electron-builder's `electronPlatformName`
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function shouldAdhocSign(platform, env) {
  if (platform !== 'darwin' && platform !== 'mas') return false;
  /* A REAL CERTIFICATE OUTRANKS US. electron-builder reads these to find an
     identity; if either is set the build intends a real signature and ours
     would overwrite it. */
  if (env.CSC_LINK || env.CSC_NAME || env.CSC_IDENTITY_AUTO_DISCOVERY === 'true') return false;
  return true;
}

/** The .app inside an electron-builder output directory, or null. */
export function appBundleIn(appOutDir, readdir = fs.readdirSync) {
  const hit = readdir(appOutDir).find((name) => name.endsWith('.app'));
  return hit ? path.join(appOutDir, hit) : null;
}

export default async function afterPack(context) {
  if (!shouldAdhocSign(context.electronPlatformName, process.env)) return;
  const app = appBundleIn(context.appOutDir);
  if (!app) {
    throw new Error(`adhoc-sign: no .app found in ${context.appOutDir}`);
  }
  /* --deep is deprecated for distribution signing and is the right tool here:
     this is the one case it was built for, signing a whole tree with one
     throwaway identity. --force replaces the framework's own invalidated
     signatures rather than failing on them. */
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`adhoc-sign: signed ${path.basename(app)} with the ad-hoc identity`);
}
