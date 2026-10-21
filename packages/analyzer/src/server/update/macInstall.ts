/**
 * Installing a mac update in place from the verified zip, and the zip cache the next differential update diffs against.
 *
 * In place: extract the zip to a temp folder NEXT TO the app (same volume, so the swap is a rename), then a detached
 * shell helper waits for the running app to exit, renames the old bundle aside, moves the new one in, removes the old
 * one, and opens the new app. The helper takes every path as a positional argument (never spliced into the script
 * text), so a path with spaces or quotes is just data. If the swap fails the old bundle is put back and opened.
 *
 * The cache: after an update the verified zip and its block map are kept in <userDir>/updates/cache/ with a small
 * meta file naming the version they are. The next update diffs against them only when that version is the one running.
 */

import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/* ── where the app lives ────────────────────────────────────────────────── */

/** The .app bundle an executable path lives in (".../Sequence.app/Contents/MacOS/Sequence"), or null. */
export function appBundleFromExecPath(execPath: string): string | null {
  const m = /^(.*?\.app)(?:\/|$)/.exec(execPath.replace(/\\/g, '/'));
  return m ? m[1]! : null;
}

export interface Writable {
  ok: boolean;
  /** In plain words, for the person, when not ok. */
  reason: string | null;
}

/** Can the bundle be swapped for another from this process? Needs to write the bundle's parent folder and the bundle. */
export function canSwapInPlace(bundle: string, access: (p: string, mode: number) => void = fs.accessSync): Writable {
  const parent = path.dirname(bundle);
  try {
    access(parent, fs.constants.W_OK);
    access(bundle, fs.constants.W_OK);
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: `Sequence is installed in ${parent}, which this user cannot write to, so it cannot replace itself there.` };
  }
}

/* ── the swap helper ────────────────────────────────────────────────────── */

/**
 * The helper script. Positional arguments: $1 app pid, $2 new bundle, $3 current bundle, $4 temp folder to remove.
 * It waits for the app to exit however long that takes: it is detached, and a reboot loses nothing (the update stays
 * unpacked beside the app and the cached zip is kept until the new version is seen running).
 */
export function swapScript(): string {
  return [
    '#!/bin/sh',
    '# Replaces the running Sequence.app with the verified new one once Sequence has quit.',
    'PID="$1"; NEW="$2"; APP="$3"; TMP="$4"',
    'while kill -0 "$PID" 2>/dev/null; do',
    '  sleep 1',
    'done',
    'xattr -dr com.apple.quarantine "$NEW" 2>/dev/null',
    'OLD="$APP.old-$$"',
    'if ! mv "$APP" "$OLD"; then rm -rf "$TMP"; open "$APP"; exit 1; fi',
    'if mv "$NEW" "$APP"; then',
    '  rm -rf "$OLD"',
    'else',
    '  mv "$OLD" "$APP"',
    '  rm -rf "$TMP"',
    '  open "$APP"',
    '  exit 1',
    'fi',
    'rm -rf "$TMP"',
    'open "$APP"',
    '',
  ].join('\n');
}

export interface HandoffArgs {
  script: string;
  pid: number;
  newBundle: string;
  appBundle: string;
  tmpDir: string;
}

/** argv for `/bin/sh`: the script path, then the four positional arguments. */
export function handoffArgv(a: HandoffArgs): string[] {
  return [a.script, String(a.pid), a.newBundle, a.appBundle, a.tmpDir];
}

/** Write the helper and start it detached. Rejects on a spawn error. */
export function startSwapHelper(a: HandoffArgs): Promise<void> {
  fs.mkdirSync(path.dirname(a.script), { recursive: true });
  fs.writeFileSync(a.script, swapScript(), { mode: 0o755 });
  return new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('/bin/sh', handoffArgv(a), { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (e) {
      reject(e as Error);
      return;
    }
    child.on('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/* ── extraction ─────────────────────────────────────────────────────────── */

/** A fresh temp folder next to the app (same volume), hidden by its leading dot. */
export function makeTempBeside(appBundle: string): string {
  const dir = path.join(path.dirname(appBundle), `.${path.basename(appBundle, '.app')}-update-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { mode: 0o700 });
  return dir;
}

/** `ditto -x -k` keeps symlinks, modes and resource forks, which a mac app bundle needs. Returns the .app inside. */
export function extractZip(zip: string, dest: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile('ditto', ['-x', '-k', zip, dest], { timeout: 10 * 60_000, windowsHide: true }, (err) => {
      if (err) return reject(new Error(`could not unpack the update (${err.message})`));
      const apps = fs.readdirSync(dest).filter((n) => n.endsWith('.app'));
      if (apps.length !== 1) return reject(new Error(`the update zip holds ${apps.length} apps, expected one`));
      resolve(path.join(dest, apps[0]!));
    });
  });
}

/* ── the zip cache ──────────────────────────────────────────────────────── */

export interface CacheMeta {
  version: string;
  sha256: string;
  size: number;
}

/**
 * Two slots in <userDir>/updates/cache/. `installed`: the zip of the version that is running (what the next update
 * diffs against). `pending`: the zip of the version just handed to the swap helper. A pending zip is promoted to
 * installed only once that version is seen running (promoteZipCache); until then the installed slot is kept, so a
 * swap that never happened (reboot, failure) loses nothing.
 */
export type Slot = 'installed' | 'pending';

const cacheDir = (userDir: string): string => path.join(userDir, 'updates', 'cache');
const slotFiles = (userDir: string, slot: Slot): { zip: string; map: string; meta: string } => {
  const d = cacheDir(userDir);
  return { zip: path.join(d, `${slot}.zip`), map: path.join(d, `${slot}.zip.blockmap`), meta: path.join(d, `${slot}.json`) };
};

/** The slot's zip and block map when `matches(its version)`, or null (absent, other version, or size changed on disk). */
export function readZipCache(userDir: string, matches: (cachedVersion: string) => boolean, slot: Slot = 'installed'): { zip: string; blockmap: Buffer; meta: CacheMeta } | null {
  const f = slotFiles(userDir, slot);
  try {
    const meta = JSON.parse(fs.readFileSync(f.meta, 'utf8')) as CacheMeta;
    if (!matches(meta.version)) return null;
    if (fs.statSync(f.zip).size !== meta.size) return null;
    return { zip: f.zip, blockmap: fs.readFileSync(f.map), meta };
  } catch {
    return null;
  }
}

function clearSlot(userDir: string, slot: Slot): void {
  const f = slotFiles(userDir, slot);
  for (const x of [f.zip, f.map, f.meta]) fs.rmSync(x, { force: true });
}

/** Keep `zipFile` (moved in) and its block map as the PENDING cache for `version`. Without a block map there is nothing to diff against later, so nothing is kept. */
export function writePendingZip(userDir: string, version: string, zipFile: string, sha256: string, blockmap: Buffer | null): void {
  clearSlot(userDir, 'pending');
  if (!blockmap) return;
  const f = slotFiles(userDir, 'pending');
  fs.mkdirSync(cacheDir(userDir), { recursive: true });
  const size = fs.statSync(zipFile).size;
  fs.renameSync(zipFile, f.zip);
  fs.writeFileSync(f.map, blockmap);
  const meta: CacheMeta = { version, sha256, size };
  fs.writeFileSync(f.meta, JSON.stringify(meta));
}

/**
 * Called at startup: when the pending version is the one now running, it becomes the installed cache and the old one is
 * deleted. A pending zip for any other version that is not newer than the running one is stale and is deleted.
 * `cmp` returns the sign of (a - b) for versions, or null when not comparable.
 */
export function promoteZipCache(userDir: string, running: string, cmp: (a: string, b: string) => number | null): 'promoted' | 'stale' | 'none' {
  const f = slotFiles(userDir, 'pending');
  let meta: CacheMeta;
  try {
    meta = JSON.parse(fs.readFileSync(f.meta, 'utf8')) as CacheMeta;
  } catch {
    return 'none';
  }
  const c = cmp(meta.version, running);
  if (c === 0) {
    const g = slotFiles(userDir, 'installed');
    clearSlot(userDir, 'installed');
    fs.renameSync(f.zip, g.zip);
    fs.renameSync(f.map, g.map);
    fs.renameSync(f.meta, g.meta);
    return 'promoted';
  }
  if (c !== null && c < 0) {
    clearSlot(userDir, 'pending');
    return 'stale';
  }
  return 'none';
}

/** Delete both slots (an update that went through the disk image leaves no cached zip for the new version). */
export function clearZipCache(userDir: string): void {
  fs.rmSync(cacheDir(userDir), { recursive: true, force: true });
}

/* ── leftovers ──────────────────────────────────────────────────────────── */

/** Where the live helper's unpack folder and pid are recorded, so a sweep never deletes what a waiting helper will use. */
const handoffFile = (userDir: string): string => path.join(userDir, 'updates', 'handoff.json');

export function recordHandoff(userDir: string, tmpDir: string, pid: number): void {
  fs.mkdirSync(path.dirname(handoffFile(userDir)), { recursive: true });
  fs.writeFileSync(handoffFile(userDir), JSON.stringify({ tmpDir, pid }));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Remove `.<App>-update-*` folders beside the app that were made before this process started, except the one a still-waiting
 * helper (recorded at handoff) is going to use. Returns the names removed.
 */
export function sweepLeftovers(appBundle: string, startedAtMs: number, userDir: string, isAlive: (pid: number) => boolean = alive): string[] {
  const parent = path.dirname(appBundle);
  const prefix = `.${path.basename(appBundle, '.app')}-update-`;
  let keep: string | null = null;
  try {
    const h = JSON.parse(fs.readFileSync(handoffFile(userDir), 'utf8')) as { tmpDir?: string; pid?: number };
    if (typeof h.tmpDir === 'string' && typeof h.pid === 'number' && isAlive(h.pid)) keep = path.resolve(h.tmpDir);
  } catch {
    /* no handoff recorded */
  }
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(parent);
  } catch {
    return removed;
  }
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const full = path.join(parent, n);
    try {
      if (path.resolve(full) === keep) continue;
      if (fs.statSync(full).mtimeMs >= startedAtMs) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(n);
    } catch {
      /* leave what cannot be removed */
    }
  }
  return removed;
}
