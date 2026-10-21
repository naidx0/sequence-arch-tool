/* Directory listings in ONE order on every filesystem. `fs.readdirSync` returns what the filesystem returns: NTFS lists
   names sorted with case folded, ext4 and overlayfs list them in hash or creation order. A scan that walks in that order
   writes it into the graph (file order, fact order, edge ids), so the same repo scanned on two machines drew two graphs.
   The order here is NTFS's, so the output a Windows scan already produced does not move. */
import fs from 'node:fs';
import path from 'node:path';

const key = (name: string): string => name.toUpperCase();
const byName = (a: string, b: string): number => {
  const x = key(a);
  const y = key(b);
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/** `fs.readdirSync(dir, { withFileTypes: true })`, in the same order everywhere. */
export function sortedDirents(dir: string): fs.Dirent[] {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name));
}

/** `fs.readdirSync(dir)`, in the same order everywhere. */
export function sortedNames(dir: string): string[] {
  return fs.readdirSync(dir).sort(byName);
}

/**
 * `path.relative(from, to)` with `/` between segments on every OS. A scan writes these paths into the graph (evidence files, warnings,
 * node paths); on Windows `path.relative` returns backslashes, so the same repo drew a different graph there (found by the scan oracle:
 * the golden, recorded on Windows, held `svc-a\\Dockerfile` and `kubernetes-manifests\\api.yaml`).
 */
export function posixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/');
}
