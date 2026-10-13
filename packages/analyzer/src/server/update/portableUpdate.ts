/**
 * The Windows portable (zip) update: the checks the server can make before queueing it.
 *
 * Replacing the app folder must never touch a file that is not Sequence's. The zip ships `app-manifest.json`, the list of
 * every file the build put in the folder (packages/desktop/scripts/app-manifest.mjs, in afterPack). An update is applied in
 * place only when the folder has the OLD version's manifest and every file in it is listed there. Main then builds the
 * delete list itself (old manifest minus the new zip's) and runs a constant helper script that copies (robocopy /E, never
 * purge) and deletes only those files.
 */

import fs from 'node:fs';
import path from 'node:path';

export const APP_MANIFEST = 'app-manifest.json';

export interface AppManifest {
  v: 1;
  /** Forward-slash paths relative to the app folder, files only. */
  files: string[];
}

/** Every file under `dir`, as forward-slash relative paths. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk('');
  return out;
}

export function readManifest(dir: string): string[] | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, APP_MANIFEST), 'utf8')) as AppManifest;
    return m && m.v === 1 && Array.isArray(m.files) && m.files.every((f) => typeof f === 'string') ? m.files : null;
  } catch {
    return null;
  }
}

/** A path that stays inside the folder it is joined to: relative, no `..`, no drive, no stream. */
export function safeRelative(p: string): boolean {
  return p !== '' && !/^[\\/]/.test(p) && !/^[a-zA-Z]:/.test(p) && !p.split(/[\\/]/).some((s) => s === '..' || s === '') && !p.includes(':');
}

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

/** Files in the folder that the manifest does not list (the manifest file itself is Sequence's). */
export function unmanagedFiles(appDir: string, manifest: readonly string[]): string[] {
  const known = new Set(manifest.map(norm));
  known.add(norm(APP_MANIFEST));
  return listFiles(appDir).filter((f) => !known.has(norm(f)));
}

/** Files the old version had and the new one does not: the only ones the update may delete. */
export function filesToDelete(oldFiles: readonly string[], newFiles: readonly string[]): string[] {
  const keep = new Set(newFiles.map(norm));
  keep.add(norm(APP_MANIFEST));
  return oldFiles.filter((f) => !keep.has(norm(f)) && safeRelative(f));
}

export interface PortableRefusal {
  ok: false;
  /** In plain words, for the person. */
  reason: string;
}

/**
 * Whether this folder can be updated in place at all: it must carry the old version's manifest and hold nothing else. A cheap
 * look before the update is queued, so the person is told now rather than after a restart. Main repeats the check and does
 * the unpacking, the delete list and the copy (packages/desktop/src/updateHandoff.ts); this reads the folder and writes nothing.
 */
export function checkPortable(a: { zip: string; appDir: string }): { ok: true } | PortableRefusal {
  const manual = (why: string): PortableRefusal => ({ ok: false, reason: `${why} Unpack ${path.basename(a.zip)} into a new folder yourself and run Sequence from there.` });
  const old = readManifest(a.appDir);
  if (!old) return manual(`This folder has no ${APP_MANIFEST} (it came from a build that did not write one), so Sequence cannot tell which files are its own.`);
  const extra = unmanagedFiles(a.appDir, old);
  if (extra.length) return manual(`This folder holds files that are not part of Sequence (${extra.slice(0, 3).join(', ')}${extra.length > 3 ? ', and more' : ''}), so it is not replaced in place.`);
  return { ok: true };
}
