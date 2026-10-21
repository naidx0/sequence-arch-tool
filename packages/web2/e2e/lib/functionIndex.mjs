import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The engine's own function index for a repository: `.sequence/functions.json`, what `GET /api/functions` serves.
 *
 * It is a gitignored cache written by the app server (`buildRepoFunctionGraphCached`), and `sequence scan` does
 * NOT write it, so a fresh clone or a CI checkout has none. The specs that serve it (app-mounted, flow-plays) used
 * to exit 2 telling the reader to run `sequence scan`, which never created it; the chain could not go green on any
 * machine that had not once run the app against this repo. When the file is absent this builds it the way the
 * server does, through the analyzer's own `buildRepoFunctionGraphCached`, from the graph the spec just scanned. It
 * is never invented: the same builder, the same repository, read-only on the source.
 *
 * Returns `{ functionGraph, warnings }`, or `{ failure }` when the analyzer cannot produce one.
 */
export function readFunctionIndex(repo, graphFile) {
  const cache = path.join(repo, '.sequence', 'functions.json');
  if (!fs.existsSync(cache)) {
    const analyzer = path.join(repo, 'packages', 'analyzer', 'dist', 'index.js');
    if (!fs.existsSync(analyzer)) return { failure: 'the analyzer is not built, so there is no function index to read' };
    const code =
      `const m = await import(${JSON.stringify(pathToFileURL(analyzer).href)});` +
      `const g = JSON.parse(await (await import('node:fs/promises')).readFile(${JSON.stringify(graphFile)}, 'utf8'));` +
      `await m.buildRepoFunctionGraphCached(${JSON.stringify(repo)}, g);`;
    try {
      execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: repo, stdio: ['ignore', 'ignore', 'pipe'], timeout: 240_000, maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      return { failure: `building the function index failed — ${error.message}` };
    }
  }
  if (!fs.existsSync(cache)) return { failure: `the engine's function cache is missing at ${cache} and building it wrote nothing` };
  const file = JSON.parse(fs.readFileSync(cache, 'utf8'));
  if (!file.functionGraph) return { failure: `${cache} carries no functionGraph` };
  return { functionGraph: file.functionGraph, warnings: file.warnings ?? [] };
}
