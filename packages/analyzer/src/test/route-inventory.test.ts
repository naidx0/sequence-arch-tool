import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';

/**
 * ROUTE INVENTORY — every path the monolith decided on still reaches a handler.
 *
 * repoServer.ts used to be one 13k-line `handle()` of flat `if (pathname === ...)` blocks, and it is being split
 * into route modules behind one dispatch line each. A block that moves out and is left out of its dispatch line
 * does not fail to compile and does not fail its own test file's neighbours: it turns into the `/api/*` catch-all
 * 404. Twice that happened in this split (the `/api/import/*` blocks inside the ACP range, `/api/fanout` inside the
 * sessions range), and a hand-kept list of routes is exactly what missed them.
 *
 * So the subject set is DERIVED. `scripts/gen-route-inventory.mjs <rev>` reads the pre-split `handle()` and writes
 * route-inventory.routes.json: every `pathname === '/x'`, `pathname.startsWith('/x/')` and route regex, with the
 * methods its `if` mentions and example request paths. This test boots the real server on a small fixture, sends
 * each (method, path) with no body, and asserts the answer is not the catch-all's `unknown endpoint:` 404. A route may
 * legitimately answer 400/401/403/404/405/409/415 to an empty request; it may not answer as if it did not exist.
 *
 * What it reads: the committed JSON list, and the live server's HTTP answers. It does not prove a route's behaviour,
 * only that it is dispatched. A route the generator cannot see (a path built at run time) is not covered.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const LIST = path.join(here, '..', '..', 'src', 'test', 'route-inventory.routes.json');

interface Route {
  kind: 'exact' | 'prefix' | 'regex';
  pattern: string;
  examples: string[];
  methods: string[];
  /** Written as (path, method) pairs: every declared method must be served. */
  precise: boolean;
}
const inventory = JSON.parse(fs.readFileSync(LIST, 'utf8')) as { generatedFrom: string; catchAllMarker: string; routes: Route[] };

/** Paths that are the catch-all machinery itself, not routes. */
const MACHINERY = new Set(['/api', '/api/']);

/** Probes that would do real work or leave the process; their dispatch is covered by their own tests. */
const SKIP = new Set([
  'POST /api/net-fetch',
  'POST /api/github/clone',
  'POST /api/local/setup',
  'GET /api/local/pull',
  'POST /api/research',
]);
/** Same, any method: these probe the machine's real claude / codex binaries, which tests must never run. */
const SKIP_PATHS = new Set(['/api/onboarding/providers']);

function project(): { dir: string; repo: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-routes-')));
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  return { dir, repo };
}

async function boot(repo: string, recentStoreDir: string) {
  const server = await createRepoServer(repo, { webDist: undefined, recentStoreDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

/** True when the request reached no handler: the `/api/*` catch-all answered it. */
async function hitsCatchAll(base: string, method: string, p: string): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch(base + p, { method, signal: ac.signal });
    if (res.status !== 404) {
      void res.body?.cancel().catch(() => {});
      return false;
    }
    const text = await res.text();
    return text.includes(inventory.catchAllMarker);
  } catch {
    /* held open (an event stream) or reset: a handler had the request */
    return false;
  } finally {
    clearTimeout(timer);
  }
}

test('the inventory is derived from the pre-split handle(), not hand-listed', () => {
  assert.ok(inventory.generatedFrom.length >= 7);
  assert.ok(inventory.routes.length >= 100, `only ${inventory.routes.length} routes in the list`);
  const patterns = new Set(inventory.routes.map((r) => r.pattern));
  for (const must of ['/api/ask', '/api/ask/stream', '/api/file', '/api/git/status', '/api/program/run', '/api/acp/live', '/api/sessions', '/api/import/sessions', '/api/fanout']) {
    assert.ok(
      patterns.has(must) || [...patterns].some((p) => p.includes(must.replace(/\//g, '\\/'))),
      `${must} is missing from the derived list`,
    );
  }
});

test('negative control: a made-up path IS the catch-all, so the check can fail', async () => {
  const { dir, repo } = project();
  const s = await boot(repo, path.join(dir, 'recent'));
  try {
    assert.equal(await hitsCatchAll(s.base, 'GET', '/api/this-route-does-not-exist'), true);
    assert.equal(await hitsCatchAll(s.base, 'POST', '/api/this/route/does/not/exist'), true);
    /* positive control: a route that exists is not the catch-all */
    assert.equal(await hitsCatchAll(s.base, 'GET', '/api/status'), false);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** What a response looks like, for telling a route's own handler from the fallback behind it. */
async function signature(base: string, method: string, p: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch(base + p, { method, signal: ac.signal, redirect: 'manual' });
    const text = res.status === 200 && (res.headers.get('content-type') ?? '').includes('event-stream') ? '' : await res.text();
    void res.body?.cancel().catch(() => {});
    return `${res.status}|${res.headers.get('content-type') ?? ''}|${res.headers.get('location') ?? ''}|${text.slice(0, 300)}`;
  } catch {
    return 'held-open';
  } finally {
    clearTimeout(timer);
  }
}

test('every (method, path) the old handle() paired still reaches its handler; every other path reaches at least one', async () => {
  const { dir, repo } = project();
  const s = await boot(repo, path.join(dir, 'recent'));
  const orphaned: string[] = [];
  let probed = 0;
  try {
    /* What a path that no route owns answers outside /api/ (the web viewer's fallback), per method. */
    const fallback = new Map<string, string>();
    for (const m of ['GET', 'POST', 'PUT', 'DELETE']) fallback.set(m, await signature(s.base, m, '/zz-no-route-owns-this-zz'));

    for (const r of inventory.routes) {
      if (MACHINERY.has(r.pattern)) continue;
      /* HEAD is left out: its 404 has no body, so the catch-all's marker cannot be read from it. */
      const declared = r.methods.filter((m) => m !== 'HEAD');
      /* PRECISE routes were written as (path, method) pairs: EACH declared method must be served, so a route reached by GET
         but dropped for PUT fails. The others only say the path is served by something, so any method will do. */
      const mustAll = r.precise && declared.length > 0;
      const methods = mustAll ? declared : [...new Set([...declared, 'GET', 'POST', 'PUT', 'DELETE'])];
      for (const example of r.examples) {
        if (SKIP_PATHS.has(example)) continue;
        const isApi = example.startsWith('/api');
        const reachedBy = async (m: string): Promise<boolean> => {
          if (SKIP.has(`${m} ${example}`)) return true;
          probed += 1;
          /* Outside /api there is no catch-all: the fallback is the web viewer, so a route is reached when its answer is
             not the viewer's answer for a path nobody owns. */
          if (!isApi) return (await signature(s.base, m, example)) !== fallback.get(m);
          return !(await hitsCatchAll(s.base, m, example));
        };
        if (mustAll) {
          for (const m of methods) {
            if (!(await reachedBy(m))) orphaned.push(`${m} ${example}   (${r.kind} ${r.pattern}; declared ${declared.join('|')})`);
          }
        } else {
          let reached = false;
          for (const m of methods) {
            if (await reachedBy(m)) {
              reached = true;
              break;
            }
          }
          if (!reached) orphaned.push(`${methods.join('|')} ${example}   (${r.kind} ${r.pattern})`);
        }
      }
    }
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(probed >= 150, `only ${probed} probes ran`);
  assert.deepEqual(orphaned, [], `routes the old handle() served that no longer reach a handler:\n${orphaned.join('\n')}`);
});

test('non-/api routes are told apart from the web viewer fallback (negative control)', async () => {
  const { dir, repo } = project();
  const s = await boot(repo, path.join(dir, 'recent'));
  try {
    const nobody = await signature(s.base, 'GET', '/zz-no-route-owns-this-zz');
    const alsoNobody = await signature(s.base, 'GET', '/zz-another-unowned-path');
    assert.equal(nobody, alsoNobody, 'two unowned paths must look the same, or the fallback signature means nothing');
    /* /archgraph.json is a real route: its answer is not the fallback's. */
    assert.notEqual(await signature(s.base, 'GET', '/archgraph.json'), nobody);
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
