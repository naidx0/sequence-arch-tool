import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SERVE THE BUILT APP, AND REFUSE TO SERVE A STALE ONE.
 *
 * THE E2E TIER RUNS AGAINST dist/, NOT AGAINST THE DEV SERVER. The two are
 * different programs: vite's dev server transforms on demand, keeps every
 * module separate, and never runs the production minifier or the CSS
 * ordering that the real bundle does. Item 2.4's whole style block is an
 * argument about cascade ORDER, and order is exactly the property a bundler
 * can change. A suite that passes on the dev server and has never seen the
 * bundle is asserting about a build nobody ships.
 *
 * THE STALENESS GUARD IS THE POINT OF THIS FILE. vite.config.ts already
 * carries the reason in prose — "a dev server that silently moves to the next
 * free port is how two builds end up running at once and a fix gets tested
 * against the stale one" — and the same failure arrives here by a quieter
 * road: edit a file, forget to build, watch the old bundle pass. The guard
 * compares the newest mtime under src/ and index.html against dist/index.html
 * and exits 2 with the command to run. Exit 2 is "the harness could not run",
 * distinct from exit 1, "the product is wrong".
 *
 * NO DEPENDENCY. node:http and node:fs serve a directory in forty lines, and
 * every alternative is a package whose behaviour on a 404 or a byte-range
 * request would itself become something to reason about.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WEB2 = path.resolve(HERE, '..', '..');
export const DIST = path.join(WEB2, 'dist');

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

function newestMtime(dir) {
  let newest = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        stack.push(full);
        continue;
      }
      const { mtimeMs } = fs.statSync(full);
      if (mtimeMs > newest) newest = mtimeMs;
    }
  }
  return newest;
}

/**
 * Assert dist/ exists and is not older than the source it was built from.
 * Returns a reason string when the build is unusable, null when it is good.
 */
export function buildProblem() {
  const entry = path.join(DIST, 'index.html');
  if (!fs.existsSync(entry)) return 'dist/index.html is missing — the app has never been built';

  const built = fs.statSync(entry).mtimeMs;
  const sources = Math.max(newestMtime(path.join(WEB2, 'src')), fs.statSync(path.join(WEB2, 'index.html')).mtimeMs);

  if (sources > built) {
    const behind = Math.round((sources - built) / 1000);
    return `dist/ is ${behind}s older than src/ — this run would assert against a stale bundle`;
  }
  return null;
}

/**
 * A static server over dist/, on an ephemeral port.
 *
 * SPA fallback to index.html, because app/routes.ts says there are no routes
 * and the fallback is what makes that true from the server's side as well: any
 * path the user lands on is the one screen.
 *
 * Path traversal is refused rather than normalised away. This server only ever
 * faces a test, but "only ever faces a test" is how a helper ends up in a
 * product, and `..` resolving outside dist/ is not something to leave to the
 * next reader's attention.
 */
export async function serveDist(routes = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    /*
     * ROUTES BEFORE FILES, AND THE SPA FALLBACK NEVER SEES THEM.
     *
     * `serveDist()` on its own is a file host: every unknown path becomes
     * index.html with a 200, which is exactly the shape `bootClient.ts`
     * describes ("a static file host answers every unknown path with
     * index.html, a 200, and content-type: text/html") and exactly why it
     * decides JSON by parsing rather than by header. That behaviour is right
     * for a spec about the shell and wrong for a spec about the BOARD, which
     * has to be handed a graph.
     *
     * So a spec may pass an explicit route table. A value of `null` is a hard
     * 404 — the honest answer for a route this origin genuinely does not
     * serve, and the one that sends `runBoot` down its static-graph rung
     * instead of leaving it to infer an absence from an HTML page. Nothing is
     * invented here: the only body a route ever returns is one the spec
     * supplied.
     */
    const route = Object.prototype.hasOwnProperty.call(routes, url.pathname)
      ? routes[url.pathname]
      : undefined;
    if (route !== undefined) {
      if (route === null) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: `this origin does not serve ${url.pathname}` }));
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(typeof route === 'string' ? route : JSON.stringify(route));
      return;
    }

    const requested = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));

    let file = requested;
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end('outside dist');
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');

    const type = TYPES.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      // No caching. Two runs against two builds on one port is the staleness
      // failure again, arriving through the browser instead of the filesystem.
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
