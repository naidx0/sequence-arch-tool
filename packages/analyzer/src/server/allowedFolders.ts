import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readUserJson, writeUserJson } from './store.js';

/* ══════════════════════════════════════════════════════════════════════════
   "ALLOW THIS FOLDER" — 0.1.8.1 C5 (audit P1-8)
   packages/analyzer/src/server/allowedFolders.ts

   Sequence opens folders inside the home folder. A project on another drive
   (D:\code, /mnt/work) was simply refused, with a message naming internals.
   Now the person can allow that one folder, once, and it is remembered at user
   level: `/api/browse` and `/api/attach` (and a clone's destination) accept a
   path inside an allowed folder exactly as they accept one inside home.

   An allowed folder may NOT hold the home folder (the filesystem root, `C:\`,
   `/Users`): opening that would put `~/.ssh` and every other secret inside the
   project, the reason opening home itself is refused. Local app only.

   REVIEW B (blocker 2): `\\localhost\C$\Users\<me>` names home by another
   spelling, and a path comparison let it through. So:
     - a UNC or device path (`\\server\share`, `\\?\`, `\\.\`) is refused
       outright, on the way in and after `realpath.native`;
     - "holds home" is decided by IDENTITY where the filesystem gives one
       (device + inode / Windows file id): the candidate is compared with home
       and every ancestor of home, so no spelling of the same directory passes;
     - every stored entry is re-validated on READ, so a hand-edited `C:\` in
       allowed-folders.json is ignored rather than trusted.
   ══════════════════════════════════════════════════════════════════════════ */

export const ALLOWED_FOLDERS_FILE = 'allowed-folders.json';

interface AllowedFile {
  version: 1;
  folders: string[];
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** `\\server\share`, `\\?\…`, `\\.\…` (either slash). Windows only: on POSIX `//x` is an ordinary path. */
export function isUncOrDevicePath(p: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && /^[\\/]{2}/.test(p);
}

interface Identity {
  dev: bigint;
  ino: bigint;
}

function identityOf(p: string): Identity | null {
  try {
    const st = fs.statSync(p, { bigint: true });
    /* A filesystem with no stable file ids reports 0; then identity says nothing. */
    return st.ino === 0n ? null : { dev: st.dev, ino: st.ino };
  } catch {
    return null;
  }
}

function sameIdentity(a: Identity | null, b: Identity | null): boolean {
  return a !== null && b !== null && a.dev === b.dev && a.ino === b.ino;
}

/** `dir` and every ancestor of it, realpath'd. */
function selfAndAncestors(dir: string): string[] {
  const out: string[] = [];
  let cur = dir;
  for (;;) {
    out.push(cur);
    const up = path.dirname(cur);
    if (up === cur) return out;
    cur = up;
  }
}

function realNative(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/** Does `candidate` hold (equal or contain) any of `homes`? By identity, and by path as a second check. */
function holdsAHome(candidate: string, homes: readonly string[]): boolean {
  const cand = identityOf(candidate);
  for (const h of homes) {
    const home = realNative(h) ?? h;
    for (const anc of selfAndAncestors(home)) {
      if (samePath(anc, candidate) || sameIdentity(identityOf(anc), cand)) return true;
    }
  }
  return false;
}

/** Is `candidate` inside (or equal to) a home? Same two checks. */
function insideAHome(candidate: string, homes: readonly string[]): boolean {
  const ancestors = selfAndAncestors(candidate).map((a) => ({ a, id: identityOf(a) }));
  for (const h of homes) {
    const home = realNative(h) ?? h;
    const hid = identityOf(home);
    if (ancestors.some(({ a, id }) => samePath(a, home) || sameIdentity(id, hid))) return true;
  }
  return false;
}

export type Validated = { ok: true; real: string } | { ok: false; status: number; error: string };

/** The one rule for an allowed folder, applied on the way in and to every stored entry. */
export function validateAllowedFolder(target: unknown, homes: readonly string[]): Validated {
  if (typeof target !== 'string' || target.trim() === '' || target.includes('\0') || !path.isAbsolute(target.trim())) {
    return { ok: false, status: 400, error: 'Choose a folder to allow.' };
  }
  const wanted = target.trim();
  if (isUncOrDevicePath(wanted)) {
    return { ok: false, status: 400, error: 'Sequence can only allow a folder on this computer\'s own drives, not a network or device path.' };
  }
  const real = realNative(path.resolve(wanted));
  if (real === null) return { ok: false, status: 404, error: 'That folder doesn\'t exist.' };
  if (isUncOrDevicePath(real)) {
    return { ok: false, status: 400, error: 'Sequence can only allow a folder on this computer\'s own drives, not a network or device path.' };
  }
  try {
    if (!fs.statSync(real).isDirectory()) return { ok: false, status: 400, error: 'That isn\'t a folder.' };
  } catch {
    return { ok: false, status: 404, error: 'That folder doesn\'t exist.' };
  }
  if (path.parse(real).root === real || holdsAHome(real, homes)) {
    return {
      ok: false,
      status: 400,
      error: 'That folder holds your home folder, so it can\'t be allowed. Choose the project folder itself.',
    };
  }
  return { ok: true, real };
}

function defaultHomes(): string[] {
  return [os.homedir()];
}

/** The allowed folders, each RE-VALIDATED (a hand-edited entry that fails the rule is ignored). */
export function readAllowedFolders(storeDir: string, homes: readonly string[] = defaultHomes()): string[] {
  const raw = readUserJson<Partial<AllowedFile>>(storeDir, ALLOWED_FOLDERS_FILE);
  if (!raw || !Array.isArray(raw.folders)) return [];
  const out: string[] = [];
  for (const f of raw.folders) {
    const v = validateAllowedFolder(f, homes);
    if (v.ok && !out.some((o) => samePath(o, v.real))) out.push(v.real);
  }
  return out;
}

export type AllowOutcome = { ok: true; folders: string[] } | { ok: false; status: number; error: string };

/** Allow `target` (an existing local folder that does not hold the home folder). */
export function addAllowedFolder(storeDir: string, target: unknown, homes: readonly string[]): AllowOutcome {
  const v = validateAllowedFolder(target, homes);
  if (!v.ok) return v;
  const folders = readAllowedFolders(storeDir, homes);
  /* Already openable: inside the FIRST home (the browse root, which attach accepts). */
  if (insideAHome(v.real, homes.slice(0, 1)) || folders.some((f) => samePath(f, v.real))) return { ok: true, folders };
  const next = [...folders, v.real].sort();
  writeUserJson(storeDir, ALLOWED_FOLDERS_FILE, { version: 1, folders: next } satisfies AllowedFile);
  return { ok: true, folders: next };
}

/** Stop allowing `target` (by the realpath it was stored under, or as given). */
export function removeAllowedFolder(storeDir: string, target: unknown, homes: readonly string[] = defaultHomes()): string[] {
  const raw = readUserJson<Partial<AllowedFile>>(storeDir, ALLOWED_FOLDERS_FILE);
  const stored = raw && Array.isArray(raw.folders) ? raw.folders.filter((f): f is string => typeof f === 'string') : [];
  if (typeof target !== 'string' || target.trim() === '') return readAllowedFolders(storeDir, homes);
  const given = path.resolve(target.trim());
  const real = realNative(given) ?? given;
  const next = stored.filter((f) => !samePath(f, real) && !samePath(f, given));
  if (next.length !== stored.length) writeUserJson(storeDir, ALLOWED_FOLDERS_FILE, { version: 1, folders: next } satisfies AllowedFile);
  return readAllowedFolders(storeDir, homes);
}
