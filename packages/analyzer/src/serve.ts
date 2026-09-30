import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchGraph } from '@sequence/schema';

// Repo-serving mode (the local platform backend) lives in ./server; re-exported
// here so the CLI imports both serve entry points from one module. serveGraph
// below is unchanged — the frozen-graph path is byte-for-byte backward compatible.
import {
  serveRepo,
  createRepoServer,
  assertSafeBind,
  resolveTerminalEnabled,
  type RepoServerOptions,
} from './server/repoServer.js';
export { serveRepo, createRepoServer };

/**
 * Launch-shell entry point (Phase A). Binds the platform server for the app
 * shell — the CLI surface behind `sequence` / `sequence app` / a no-arg
 * `sequence serve` — on 127.0.0.1 and hands the listening server back. Localhost
 * only, matching serveRepo; the caller prints the URL / banner.
 *
 *  - `repoDir` given    ⇒ scan + serve that repo live (same as `serve --repo`).
 *  - `repoDir` absent   ⇒ a NO-REPO start: serve the web app with no repo
 *                          attached yet, so Phase B's home screen can take over
 *                          (browse + attach a repo as a UI action).
 *
 * COORDINATION NOTE (Phase A ⇄ Phase B): the no-repo START itself is implemented
 * on the SERVER side by Phase B, whose `createRepoServer` (in server/repoServer.ts
 * — NOT owned by Phase A) already accepts an absent repo root, skips the initial
 * scan, and 409s the repo endpoints until a repo is attached from the UI. This
 * wrapper is pure CLI-side glue: it binds that server and returns it. It never
 * scans, attaches, or reimplements any server behaviour. The loose cast keeps this
 * package compiling regardless of the exact `createRepoServer` signature while
 * Phase B's no-repo widening settles; the runtime contract is
 * "absent repo ⇒ no-repo start".
 */
export async function serveApp(
  repoDir: string | undefined,
  port: number,
  webDist?: string
): Promise<http.Server> {
  // serveApp is the LOCAL launcher and wires NO auth. A non-loopback bind is
  // therefore HARD-REFUSED here (assertSafeBind throws, since auth is never enabled
  // on this path) — that is correct: the deploy path is serveRepo, not serveApp.
  const bindHost = (process.env.SEQUENCE_BIND_HOST ?? '127.0.0.1').trim() || '127.0.0.1';
  const loopbackBind = assertSafeBind(bindHost);
  const opts: RepoServerOptions = {
    webDist,
    // serveApp wires no auth ⇒ authOn=false. Loopback keeps the local default (on);
    // a non-loopback bind would force it off, but assertSafeBind already refused that.
    terminalEnabled: resolveTerminalEnabled(loopbackBind, false, process.env),
  };
  const server = await createRepoServer(repoDir ?? null, opts);
  await new Promise<void>((resolve) => {
    server.listen(port, bindHost, () => resolve());
  });
  return server;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

function findWebDist(): string | undefined {
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

export function serveGraph(graphPath: string, port: number, webDistArg?: string): http.Server {
  const graphAbs = path.resolve(graphPath);
  if (!fs.existsSync(graphAbs)) {
    throw new Error(`graph file not found: ${graphAbs} — run "sequence scan <repo>" first`);
  }
  const graph = JSON.parse(fs.readFileSync(graphAbs, 'utf8')) as ArchGraph;
  const webDist = webDistArg ?? findWebDist();
  if (!webDist) {
    throw new Error(
      'web viewer build not found — run "pnpm --filter @sequence/web2 build" first, or pass --web <dist-dir>'
    );
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/archgraph.json') {
        res.setHeader('content-type', 'application/json');
        res.end(fs.readFileSync(graphAbs));
        return;
      }
      if (url.pathname === '/api/file') {
        // evidence click-through: serve source files from the scanned repo only
        const rel = url.searchParams.get('path') ?? '';
        const abs = path.resolve(graph.repoRoot, rel);
        if (!abs.startsWith(path.resolve(graph.repoRoot) + path.sep)) {
          res.statusCode = 400;
          res.end('path escapes repo root');
          return;
        }
        if (!fs.existsSync(abs)) {
          res.statusCode = 404;
          res.end('file not found (repo moved since scan?)');
          return;
        }
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(fs.readFileSync(abs, 'utf8'));
        return;
      }
      // static viewer
      let filePath = path.join(webDist, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!path.resolve(filePath).startsWith(path.resolve(webDist))) {
        res.statusCode = 400;
        res.end();
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(webDist, 'index.html'); // SPA fallback
      }
      res.setHeader('content-type', MIME[path.extname(filePath)] ?? 'application/octet-stream');
      res.end(fs.readFileSync(filePath));
    } catch (e) {
      res.statusCode = 500;
      res.end(`server error: ${(e as Error).message}`);
    }
  });

  server.listen(port, () => {
    console.log(`sequence: serving ${graph.repoName} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
    console.log(`  http://localhost:${port}`);
  });
  // Returned so programmatic callers (e.g. tests) can read the bound address and
  // close the server. The CLI ignores it; the served surface is unchanged.
  return server;
}
