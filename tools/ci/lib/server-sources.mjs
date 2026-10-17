// The files that together SERVE the analyzer's routes.
//
// repoServer.ts was split into route modules; a check that reads only repoServer.ts
// stops seeing the routes that moved. The module list is DERIVED from the directory
// (every `*Routes.ts`, plus askTurnCore.ts and routeHttp.ts), never hand-listed, so a
// module added later is covered by construction.
import fs from 'node:fs';
import path from 'node:path';

export const SERVER_DIR_REL = 'packages/analyzer/src/server';

/** Absolute paths: repoServer.ts first, then the route modules, sorted. */
export function serverSourcePaths(root) {
  const dir = path.join(root, ...SERVER_DIR_REL.split('/'));
  const modules = fs
    .readdirSync(dir)
    .filter((n) => /Routes\.ts$/.test(n) || n === 'askTurnCore.ts' || n === 'routeHttp.ts')
    .sort()
    .map((n) => path.join(dir, n));
  return [path.join(dir, 'repoServer.ts'), ...modules];
}

/** `{ file, rel, text }` per source, CRLF normalised to LF. */
export function serverSources(root) {
  return serverSourcePaths(root).map((file) => ({
    file,
    rel: path.relative(root, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8').split('\r\n').join('\n'),
  }));
}

/** All served-route source as one string (for scanners that take a single source). */
export const serverSourceText = (root) => serverSources(root).map((s) => s.text).join('\n');
