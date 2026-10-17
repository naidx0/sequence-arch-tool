// app-manifest - writes app-manifest.json into the unpacked Windows app folder (electron-builder afterPack), so the
// portable zip carries the list of every file the build put there. An update replaces a portable folder in place only
// when it holds the old version's manifest and nothing outside it, and it deletes only files an old manifest listed and
// the new one does not (packages/analyzer/src/server/update/portableUpdate.ts).
import fs from 'node:fs';
import path from 'node:path';

export const APP_MANIFEST = 'app-manifest.json';

/** Every file under `dir` as forward-slash relative paths, sorted, the manifest itself excluded. */
export function listAppFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (r !== APP_MANIFEST) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

export function writeAppManifest(appOutDir) {
  const files = listAppFiles(appOutDir);
  fs.writeFileSync(path.join(appOutDir, APP_MANIFEST), JSON.stringify({ v: 1, files }));
  return files.length;
}
