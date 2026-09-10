import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Stamp the build with the commit it came from.
 *
 * The reason is on the record and is not cosmetic: an owner walk ended with
 * "did you push to the wrong main?" because none of the landed changes were
 * visible and nothing in the running app said which build it was. An
 * unfalsifiable "it didn't change" costs more than any of the changes being
 * argued about. A visible sha makes the question answerable in one glance, and
 * the boot surface prints it.
 *
 * Falls back to 'unknown' outside a git checkout — tarball installs and CI
 * archives have no .git, and the app must still build there, so this can never
 * be fatal.
 */
function commitStamp(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],

  server: {
    /*
     * strictPort: a dev server that silently moves to the next free port is
     * how two builds end up running at once and a fix gets tested against the
     * stale one. Fail loudly instead.
     */
    port: 5174,
    strictPort: true,
    /*
     * Proxy /api to the analyzer. Production is same-origin, so nothing here
     * exists at build time — this closes the gap that makes UI iteration in v1
     * require a full production build before anything can be served. The
     * rebuild's inner loop should be the fastest one available, not the
     * slowest.
     *
     * 4173 is the analyzer's own default (packages/analyzer/src/cli.ts:133,
     * `--port` ?? 4173). It is read from the environment first so a second
     * analyzer on a non-default port does not require editing a checked-in
     * file. web2's dev port is 5174 rather than Vite's 5173, so it can run
     * beside packages/web until the Wave 7 cutover.
     */
    /*
     * EVERY engine route, not just `/api`.
     *
     * Vite answers an unproxied path with its SPA fallback: **200, and the
     * index.html shell**. Not a 404 — a 200. `/archgraph.json` is an engine
     * route that does NOT live under `/api`, so it fell through, and attaching a
     * real repository then reloading gave "the engine answered 200 … the
     * response was not JSON" with no board at all. The production build was fine
     * throughout, because there one origin serves both — which is also why the
     * e2e gate stayed green while the dev inner loop could not draw the main
     * surface. `tools/ci/dev-proxy.test.mjs` now fails if a new engine route is
     * added to the client and not to this list.
     */
    proxy: {
      '/api': {
        target: process.env.SEQUENCE_ENGINE_ORIGIN ?? 'http://127.0.0.1:4173',
        changeOrigin: false,
      },
      '/archgraph.json': {
        target: process.env.SEQUENCE_ENGINE_ORIGIN ?? 'http://127.0.0.1:4173',
        changeOrigin: false,
      },
    },
  },

  /*
   * ES workers. Item 3.2 loads elkjs inside graph/elk.worker.ts and nowhere
   * else, and that worker is an ES module.
   */
  worker: { format: 'es' },

  define: {
    __SEQUENCE_COMMIT__: JSON.stringify(commitStamp()),
  },
});
