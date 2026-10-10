/* ══════════════════════════════════════════════════════════════════════════
   DOES THE BUNDLED SERVER REALLY SERVE?
   packages/analyzer/scripts/check-server-bundle.mjs

   Boots dist/sequence-server-entry.cjs on a temp copy of a fixture repo and
   checks the three things a bundle can quietly break:

     wasm      the repo is attached and scanned: tree-sitter loads its .wasm
               from node_modules through a dynamic import, which the bundle
               routes through the entry
     require   graphology is required at load through
               createRequire(import.meta.url), which the bundle redefines;
               a wrong base path stops the server before it listens
     web dist  `/` answers the web app's index.html

   Plus, with a cache directory, that V8's cache was written.

   Used by the analyzer's server-bundle test and by the desktop's
   prepare-server step (on the copy an installer would ship).
   ══════════════════════════════════════════════════════════════════════════ */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/* A child killed by a signal keeps exitCode null and sets signalCode instead, and its one 'exit' event
   has already fired: waiting on exitCode alone, or on a later once('exit'), never ends. With nothing else
   holding the loop, Node then quits with code 13 (an unsettled top-level await) and no message, which is
   how the 0.1.4 macOS release build ended. */
const gone = (child) => child.exitCode !== null || child.signalCode !== null;

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/**
 * @param {{ entry: string, fixture: string, webDist?: string, nodeBin?: string, env?: Record<string,string>, cacheDir?: string|null, waitForCacheMs?: number }} o
 * @returns {Promise<{ ok: boolean, problems: string[], output: string }>}
 */
export async function checkServerBundle(o) {
  const problems = [];
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-bundle-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-bundle-home-'));
  fs.cpSync(o.fixture, repo, { recursive: true, filter: (p) => !/[\\/]\.sequence([\\/]|$)/.test(p) });
  const port = await freePort();
  const args = [o.entry, 'app', '--no-open', '--port', String(port), '--repo', repo];
  if (o.webDist) args.push('--web', o.webDist);
  const child = spawn(o.nodeBin ?? process.execPath, args, {
    env: {
      ...process.env,
      SEQUENCE_USER_DIR: home,
      SEQUENCE_COMPILE_CACHE: o.cacheDir ?? 'off',
      SEQUENCE_COMPILE_CACHE_DELAY_MS: '200',
      ...(o.env ?? {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (const t0 = Date.now(); Date.now() - t0 < 60000; ) {
      if (gone(child)) break;
      try {
        if ((await fetch(`${base}/api/status`)).ok) {
          up = true;
          break;
        }
      } catch {
        /* still binding */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!up) {
      problems.push(
        gone(child)
          ? `the server exited before answering /api/status (${child.signalCode ?? `code ${child.exitCode}`}): ${output.slice(-1500)}`
          : 'the server never answered /api/status',
      );
      return { ok: false, problems, output };
    }
    const status = await (await fetch(`${base}/api/status`)).json();
    if (status.attached !== true) problems.push(`the repo did not attach: ${JSON.stringify(status.attachFailure ?? status)}`);
    const graph = await (await fetch(`${base}/archgraph.json`)).json().catch(() => null);
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    if (nodes.length === 0) problems.push('the scanned graph has no nodes (wasm / tree-sitter)');
    const parseWarn = (graph?.warnings ?? []).find((w) => /tree-sitter|wasm|parser/i.test(String(w)));
    if (parseWarn) problems.push(`a parser warning: ${parseWarn}`);
    if (nodes.length > 0 && !nodes.some((n) => n.kind === 'module' || n.kind === 'service')) problems.push('no services or modules in the graph');
    const html = await (await fetch(`${base}/`)).text();
    if (!/id="root"/.test(html)) problems.push('`/` did not answer the web app (web dist path)');
    if (o.cacheDir) {
      await new Promise((r) => setTimeout(r, o.waitForCacheMs ?? 1500));
      const files = fs.existsSync(o.cacheDir) ? fs.readdirSync(o.cacheDir) : [];
      if (files.length === 0) problems.push(`no V8 cache was written to ${o.cacheDir}`);
    }
    return { ok: problems.length === 0, problems, output };
  } finally {
    child.kill();
    await new Promise((r) => (gone(child) ? r() : child.once('exit', r)));
    for (const d of [repo, home]) {
      for (let i = 0; i < 50; i++) {
        try {
          fs.rmSync(d, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
  }
}
