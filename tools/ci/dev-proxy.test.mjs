import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import url from 'node:url';

/**
 * EVERY ENGINE ROUTE web2 FETCHES MUST BE PROXIED IN DEV.
 *
 * WHY THIS EXISTS
 * ---------------
 * In production the analyzer serves the built UI and the API from one origin, so
 * every path the client asks for reaches the engine. In development Vite serves
 * the UI on 5174 and forwards only what its `server.proxy` names; ANY other path
 * falls through to Vite's SPA fallback, which answers **200 with the index.html
 * shell**. Not a 404 — a 200. The client asks for the graph and gets HTML.
 *
 * That is exactly what happened. The proxy listed `/api` only, and web2 also
 * fetches `/archgraph.json`. Attaching a real repository and reloading produced:
 *
 *     hydrate-failed — "The engine answered 200 … the response was not JSON"
 *
 * and the board never drew. The whole point of the dev server is to be the fast
 * inner loop for UI work, and the main surface could not be looked at in it at
 * all. Nothing caught this: the e2e gate runs against the PRODUCTION build,
 * where one origin serves both, so every test was green while dev was broken.
 *
 * The 200-not-404 detail is what makes it worth a test rather than a comment. A
 * 404 is a loud, obvious failure; a 200 carrying the wrong content-type looks
 * like a client bug and sends you to read the wrong code.
 */

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WEB2 = path.join(REPO, 'packages', 'web2');
const VITE_CONFIG = path.join(WEB2, 'vite.config.ts');

/** Absolute paths the client asks the engine for, harvested from its own source. */
function requestedPaths() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      // A quoted absolute path that looks like a route, e.g. '/api/attach',
      // '/archgraph.json'. Template heads like `/api/program/runs/${id}` start
      // with the same literal prefix, so the first segment is what matters.
      for (const m of text.matchAll(/['"`](\/[a-zA-Z0-9._/-]+)['"`?]/g)) {
        const p = m[1];
        if (p.startsWith('//')) continue;
        found.add(p);
      }
    }
  };
  walk(path.join(WEB2, 'src'));
  return [...found];
}

/** The prefixes `server.proxy` forwards, read out of the config source. */
function proxiedPrefixes() {
  const src = fs.readFileSync(VITE_CONFIG, 'utf8');
  const block = src.slice(src.indexOf('proxy:'));
  const prefixes = [];
  for (const m of block.matchAll(/['"](\/[a-zA-Z0-9._/-]+)['"]\s*:/g)) prefixes.push(m[1]);
  return prefixes;
}

test('the dev proxy config is readable and forwards something', () => {
  const prefixes = proxiedPrefixes();
  assert.ok(prefixes.length > 0, 'no proxy entries found in vite.config.ts — has the shape changed?');
  assert.ok(prefixes.includes('/api'), '/api must be proxied');
});

test('every engine path web2 requests is reachable through the dev server', () => {
  /*
   * Only paths that are ENGINE routes matter. A client also names plenty of
   * absolute strings that are not requests — asset URLs, router paths, test
   * fixtures — so this checks the two shapes that are unambiguously the engine's
   * and would silently return HTML if unproxied.
   */
  const ENGINE_LIKE = /^\/(api\b|archgraph\.json$)/;
  const prefixes = proxiedPrefixes();
  const unreachable = requestedPaths()
    .filter((p) => ENGINE_LIKE.test(p))
    .filter((p) => !prefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)));

  assert.deepEqual(
    unreachable,
    [],
    'These paths reach the engine in production but hit Vite\'s SPA fallback in dev,\n' +
      'which answers 200 with index.html — so the client receives HTML where it\n' +
      'expected JSON. Add each to `server.proxy` in packages/web2/vite.config.ts:\n  ' +
      unreachable.join('\n  '),
  );
});
