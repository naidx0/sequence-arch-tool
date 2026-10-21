import path from 'node:path';

/** Files below each requested absolute directory, in the original walk order. */
export function groupFilesUnder(files: readonly string[], dirs: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const prefixes = new Map<string, string[]>();
  for (const dir of dirs) {
    if (groups.has(dir)) continue;
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    let bucket = prefixes.get(prefix);
    if (!bucket) prefixes.set(prefix, bucket = []);
    groups.set(dir, bucket);
  }
  if (groups.size === 0) return groups;
  // Visit each file once, looking up its ancestors instead of filtering the
  // whole repo once per service. Preserve walk order, including nested roots.
  for (const file of files) {
    for (let cut = file.lastIndexOf(path.sep); cut >= 0; cut = file.lastIndexOf(path.sep, cut - 1)) {
      prefixes.get(file.slice(0, cut + 1))?.push(file);
      if (cut === 0) break;
    }
  }
  return groups;
}
