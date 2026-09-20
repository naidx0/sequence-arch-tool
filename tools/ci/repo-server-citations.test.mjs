import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import url from 'node:url';

/**
 * CITATIONS INTO `server/repoServer.ts` MUST BE ANCHORS, NOT LINE NUMBERS.
 *
 * WHY THIS EXISTS
 * ---------------
 * `packages/analyzer/src/server/repoServer.ts` is the biggest and most-edited
 * file in the repo — 6,000+ lines serving every route — and comments all over
 * `api-types`, `web2` and the analyzer tests point INTO it to say where a
 * contract is implemented. Those pointers were written as line numbers.
 *
 * On 2026-08-21 all 29 of them were resolved against the file. Of the 15 that
 * carried a nearby symbol or route to check against, **13 were wrong** — 87%.
 * `GET /api/git/status` was cited at 4209 and lives at 4666. `SENSITIVE_EXACT`
 * was cited at 287-311 and is defined at 343. Several pointed into a path that
 * no longer exists at all: the citations said `repoServer.ts` while the file had
 * moved under `server/`. Every one of them sends an agent to the wrong place in
 * a 6,000-line file, and reading the wrong code is worse than reading none.
 *
 * This is the third time citation rot has bitten this repo. `inherited-
 * constraints.test.mjs` caught it twice in `docs/rebuild/inherited-constraints.md`
 * — once when the v1 book was deleted, once when a wave moved the lines out from
 * under three quotes. That resolver fixed the docs; nothing watched the source.
 *
 * THE RULE
 * --------
 * Cite the invariant, not the expression: name the route literal or the symbol.
 * `POST /api/ask` is greppable, survives every edit above it, and is checkable —
 * which is what A2 below does. A line number is a claim that decays silently on
 * the next unrelated insertion.
 *
 * WHAT THIS DOES NOT ASSERT, AND WHY
 * ----------------------------------
 * Only citations into `repoServer.ts` are policed. Line pins naming DELETED v1
 * files (`FileEditProposalBar.tsx:24`, `ProductChat.tsx:646-651`) are left
 * alone on purpose: they appear in "WHAT THIS REPLACES" notes, their files are
 * gone so they cannot rot further, and the history they record is why web2 is
 * shaped the way it is. Pins into the ml-harness reference implementation
 * (`MLH/frontend/...`) are outside this tree and unresolvable from here. And
 * synthetic evidence refs in fixtures (`packages/alpha/src/one.ts:3`) are test
 * DATA, not pointers at all.
 */

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PACKAGES = path.join(REPO, 'packages');
const SERVER = path.join(PACKAGES, 'analyzer', 'src', 'server', 'repoServer.ts');

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(PACKAGES);

const readSource = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const EXACT_HANDLER =
  /^pathname\s*===\s*(['"])((?:\/api\/[A-Za-z0-9/:*_-]+)|\/archgraph\.json)\1/;
const PREFIX_HANDLER =
  /^pathname\s*\.startsWith\(\s*(['"])((?:\/api\/[A-Za-z0-9/:*_-]+)|\/archgraph\.json)\1\s*\)/;

/** Read one `if (...)` condition from its opening parenthesis.
 *
 * This is intentionally narrower than the general lexical scanner in
 * reachability.test.mjs: this gate needs only direct pathname witnesses in
 * live `if` conditions. Comments and quoted prose are skipped while balancing
 * the condition, and a literal `false &&` conjunct makes the witness dead.
 */
function readIfCondition(text, open) {
  const routes = [];
  let depth = 1;
  let state = 'code';
  let quote = '';
  let dead = false;

  for (let i = open + 1; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        i += 1;
        state = 'code';
      }
      continue;
    }
    if (state === 'string') {
      if (char === '\\') {
        i += 1;
      } else if (char === quote) {
        state = 'code';
      }
      continue;
    }

    if (char === '/' && next === '/') {
      i += 1;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 1;
      state = 'block-comment';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      state = 'string';
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return { end: i, routes, dead };
      continue;
    }

    if (text.startsWith('false', i) && !/[A-Za-z0-9_$]/.test(text[i - 1] ?? '')) {
      const before = text.slice(open + 1, i).trimEnd();
      const startsConjunct = before === '' || /(?:&&|\|\||\()$/.test(before);
      if (startsConjunct && /^false\b\s*&&/.test(text.slice(i))) dead = true;
    }

    if (!text.startsWith('pathname', i) || /[A-Za-z0-9_$]/.test(text[i - 1] ?? '')) continue;
    const tail = text.slice(i);
    const handler = EXACT_HANDLER.exec(tail) ?? PREFIX_HANDLER.exec(tail);
    if (handler) routes.push(handler[2]);
  }

  return { end: text.length - 1, routes: [], dead: true };
}

function servedRoutes(source) {
  const text = source.replace(/\r\n/g, '\n');
  const routes = new Set();
  let state = 'code';
  let quote = '';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        i += 1;
        state = 'code';
      }
      continue;
    }
    if (state === 'string') {
      if (char === '\\') {
        i += 1;
      } else if (char === quote) {
        state = 'code';
      }
      continue;
    }

    if (char === '/' && next === '/') {
      i += 1;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 1;
      state = 'block-comment';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      state = 'string';
      continue;
    }

    if (!text.startsWith('if', i) || /[A-Za-z0-9_$]/.test(text[i - 1] ?? '')) continue;
    let open = i + 2;
    while (/\s/.test(text[open] ?? '')) open += 1;
    if (text[open] !== '(') continue;

    const condition = readIfCondition(text, open);
    if (!condition.dead) {
      for (const route of condition.routes) routes.add(route);
    }
    i = condition.end;
  }

  return routes;
}

function servesRoute(routes, route) {
  if (routes.has(route)) return true;
  return route.endsWith('/') && [...routes].some((candidate) => candidate.startsWith(route));
}

test('the engine file this all points at is where we say it is', () => {
  // If this moves again, every anchor below is still findable by grep, but the
  // test itself must be repointed — so it fails loudly rather than vacuously.
  assert.ok(fs.existsSync(SERVER), `${path.relative(REPO, SERVER)} does not exist`);
  assert.ok(FILES.length > 100, `expected a real source tree, scanned ${FILES.length} files`);
});

test('A1 — no source comment pins a LINE NUMBER inside repoServer.ts', () => {
  const pin = /repoServer\.ts:(\d+)/g;
  const offenders = [];

  for (const file of FILES) {
    const text = readSource(file);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      pin.lastIndex = 0;
      let m;
      while ((m = pin.exec(lines[i])) !== null) {
        offenders.push(`${path.relative(REPO, file)}:${i + 1} cites ${m[0]}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Line pins into repoServer.ts rot silently — 13 of 15 checkable ones were wrong.\n' +
      'Cite the route or the symbol instead, e.g. "the `POST /api/ask` handler in\n' +
      '`server/repoServer.ts`". Offenders:\n  ' +
      offenders.join('\n  '),
  );
});

test('A2 scanner ignores dead handlers, comments and quoted prose', () => {
  const source = [
    "if (false && pathname === '/api/tree' && method === 'GET') {}",
    "// if (pathname === '/api/commented') {}",
    "const note = \"if (pathname === '/api/prose') {}\";",
    "if (pathname === '/api/live' && method === 'GET') {}",
  ].join('\r\n');

  assert.deepEqual([...servedRoutes(source)].sort(), ['/api/live']);
});

test('A2 — every route named beside a repoServer citation really is served there', () => {
  const server = servedRoutes(readSource(SERVER));
  const NEAR = 3;
  // `/api/…` or `/archgraph.json`, as written in a backtick or after a verb.
  const route = /(?:^|[\s`(])((?:\/api\/[A-Za-z0-9/:*_-]+)|\/archgraph\.json)/g;
  const unresolved = [];
  const checked = new Set();

  for (const file of FILES) {
    const lines = readSource(file).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes('server/repoServer.ts')) continue;

      const from = Math.max(0, i - NEAR);
      const to = Math.min(lines.length, i + NEAR + 1);
      for (let j = from; j < to; j += 1) {
        route.lastIndex = 0;
        let m;
        while ((m = route.exec(lines[j])) !== null) {
          /*
           * Normalise to the literal the server can actually contain. A wildcard
           * family (`/api/harness/*`) and a parameterised path
           * (`/api/program/runs/:runId`) are written for a human; the engine
           * holds the fixed prefix, so compare on that and nothing more.
           */
          let r = m[1].replace(/[.,)`]+$/, '');
          const cut = r.search(/[:*]/);
          if (cut > 0) r = r.slice(0, cut);
          if (r.length < '/api/x'.length) continue;

          const key = `${path.relative(REPO, file)}::${r}`;
          if (checked.has(key)) continue;
          checked.add(key);

          if (!servesRoute(server, r)) {
            unresolved.push(`${path.relative(REPO, file)}:${j + 1} names ${r}`);
          }
        }
      }
    }
  }

  // A citation that names no route is fine (it may name a symbol instead), but
  // if this ever scans nothing at all the assertion below is vacuous.
  assert.ok(checked.size > 0, 'scanned no routes beside any repoServer citation — check the scan');
  assert.deepEqual(
    unresolved,
    [],
    'These routes are cited as living in server/repoServer.ts but are not there:\n  ' +
      unresolved.join('\n  '),
  );
});
