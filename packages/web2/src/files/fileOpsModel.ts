/* ══════════════════════════════════════════════════════════════════════════
   FILE OPERATIONS — the pure half (round 9, ask 20)
   packages/web2/src/files/fileOpsModel.ts

   Path arithmetic for drag-to-move, rename, duplicate and delete, kept out of
   the components so it can be tested without a DOM. Repo paths are POSIX,
   relative, no leading or trailing slash; '' is the project root.
   ══════════════════════════════════════════════════════════════════════════ */

export type FileOpName = 'create' | 'mkdir' | 'rename' | 'move' | 'duplicate' | 'delete' | 'reveal';

/** What the tree asks of whoever owns the disk. Each resolves to an error sentence, or null on success. */
export interface FileTreeOps {
  move(from: string, toDir: string): Promise<string | null>;
  rename(path: string, newName: string): Promise<string | null>;
  create(parentDir: string, name: string, kind: 'file' | 'folder'): Promise<string | null>;
  duplicate(path: string): Promise<string | null>;
  remove(path: string): Promise<string | null>;
  copyPath(path: string): void;
  reveal(path: string): Promise<string | null>;
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

export function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}

/** True when `path` is `root` or lives under it. */
export function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Can `from` be dropped into the folder `toDir` ('' is the root)? Not into
 * itself or its own descendants, and not where it already is.
 */
export function canMoveInto(from: string, toDir: string): boolean {
  if (from === '' || from === toDir) return false;
  if (isWithin(toDir, from)) return false;
  return parentDir(from) !== toDir;
}

/** Where `path` lands after `from` is renamed or moved to `to`; unchanged if unrelated. */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  return path;
}

/** A name a person typed: non-empty, no separators, not . or .. */
export function validName(raw: string): string | null {
  const name = raw.trim();
  if (name === '' || name === '.' || name === '..') return null;
  if (/[\\/\0]/.test(name)) return null;
  return name;
}
