import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static-viewer helpers, mirrored from serve.ts so the legacy `serveGraph`
 * path can stay byte-for-byte untouched while the repo server reuses the same
 * MIME map / dist discovery / SPA-fallback behaviour.
 */
export const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

/**
 * The app's HTML carries `frame-src 'self'` (lane visual). An agent's html block runs in a sandboxed
 * srcdoc frame; CSP has no navigation directive of its own, but the PARENT's frame-src governs what
 * its child frames may navigate to, and srcdoc is unaffected. With it a page's location.href, meta
 * refresh or clicked link makes no request at all in the browser build (the desktop window also
 * blocks it in the main process).
 */
export const APP_FRAME_POLICY = "frame-src 'self'";

export function findWebDist(): string | undefined {
  /*
   * Anchored to where this MODULE lives, never to `process.cwd()`. `sequence` is a CLI: its
   * documented use is `cd ~/my-project && sequence --repo .`, so the working directory belongs to
   * the user's project and is the one thing the resolver cannot assume. When it did assume it, the
   * app served `{"error":"web viewer not built"}` to every user outside this monorepo.
   *
   * The walk looks for a sibling `web2/dist` above this file. That relationship holds in the
   * monorepo (packages/analyzer -> packages/web2) and in an install
   * (node_modules/@sequence/analyzer -> node_modules/@sequence/web2), which is why it replaced
   * `require.resolve('@sequence/analyzer/package.json')`: a package cannot self-resolve without an
   * `exports` field, so that branch threw MODULE_NOT_FOUND on every call and the cwd fallback was
   * doing all the work. Bounded, so a stray `web2/dist` far up the disk cannot be adopted.
   */
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 5; up += 1) {
    const guess = path.resolve(dir, '..', 'web2', 'dist');
    if (fs.existsSync(path.join(guess, 'index.html'))) return guess;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const local = path.resolve(process.cwd(), 'packages', 'web2', 'dist');
  if (fs.existsSync(path.join(local, 'index.html'))) return local;
  return undefined;
}

/** Serve a file from the web dist with SPA fallback (same rules as serveGraph). */
export function serveStatic(webDist: string, pathname: string, res: http.ServerResponse): void {
  let filePath = path.join(webDist, pathname === '/' ? 'index.html' : pathname);
  if (!path.resolve(filePath).startsWith(path.resolve(webDist))) {
    res.statusCode = 400;
    res.end();
    return;
  }
  let found = true;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(webDist, 'index.html'); // SPA fallback
    found = false;
  }
  res.setHeader('content-type', MIME[path.extname(filePath)] ?? 'application/octet-stream');
  /* Opening a chat in another workspace reloads the page (web2 V3App.openProject). With no caching header the
     browser downloaded and compiled the whole app again on every switch (0.1.5 review). Vite names every file
     under assets/ by its content hash, so those are kept for good; anything else, the page above all, is asked
     again each time so a new build is picked up at once. A missing asset's html fallback is never pinned. */
  res.setHeader('cache-control', found && /^\/assets\/[^/]+$/.test(pathname) ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (path.extname(filePath) === '.html') res.setHeader('content-security-policy', APP_FRAME_POLICY);
  const body = fs.readFileSync(filePath);
  res.end(body);
}
