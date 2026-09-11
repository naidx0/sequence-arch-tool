import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { scanRepo } from '../scan.js';

/**
 * A BROWSER APP CALLING ITS OWN BACKEND IS AN HTTP EDGE.
 *
 * `isUrlShaped` accepted exactly two things: a literal beginning `http://` or
 * `https://`, or an environment variable. A RELATIVE path — `'/api/items'` —
 * returned false, so it produced no client fact at all. That is the single
 * commonest way a browser application talks to its own server, and it was
 * invisible.
 *
 * And real frontends do not call `fetch` with a literal. They funnel through a
 * thin helper. Measured verbatim in ml-harness:
 *
 *     fetch(`${session.baseUrl}${path}`, { ... })   // client.ts:153
 *     return getJson('/api/recipes');               // client.ts:278
 *     return postJson('/api/threads', { ... });     // client.ts:346
 *
 * The `fetch` has no literal path and the literal paths are not at a `fetch`.
 * Neither half is URL-shaped on its own, which is why a two-tier repo produced
 * zero http edges AND zero warnings — the joiner never received a fact to
 * discard.
 *
 * TWO GUARDS KEEP THIS FROM INVENTING EDGES:
 *   1. The file must demonstrably make HTTP calls — a real known client call at
 *      a real line — before a relative literal in it counts as a URL. A module
 *      that merely passes '/tmp/x' to something is not calling a server.
 *   2. The path must MATCH a route another service actually registered. A
 *      same-origin path with no matching route yields no edge, because the
 *      target would be a guess.
 */

function tree(spec: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sameorigin-')));
  for (const [rel, body] of Object.entries(spec)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

/** A frontend that calls through a wrapper, exactly as a real one does. */
const CLIENT_TS = `
const base = { url: '' };
async function send(path: string, init: RequestInit) {
  return fetch(\`\${base.url}\${path}\`, init);
}
export async function getJson(path: string) {
  const r = await send(path, { method: 'GET' });
  return r.json();
}
export async function listItems() {
  return getJson('/api/items');
}
`;

const BACKEND_PY = `
from fastapi import FastAPI

app = FastAPI()

@app.get("/api/items")
def list_items():
    return []
`;

test('a relative path through a client wrapper draws frontend -> backend', async () => {
  const repo = tree({
    'pyproject.toml': '[project]\nname = "api"\n',
    'app/main.py': BACKEND_PY,
    'frontend/package.json': JSON.stringify({ name: 'ui', dependencies: { react: '^18' } }),
    'frontend/src/client.ts': CLIENT_TS,
  });
  try {
    const g = await scanRepo(repo, { cluster: true });
    const http = g.edges.filter((e) => e.kind === 'http');

    assert.ok(
      http.length >= 1,
      `expected an http edge; kinds present: ${JSON.stringify(
        g.edges.reduce<Record<string, number>>((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {}),
      )}`,
    );

    /* Cited to the call site, not merely asserted — the whole product rests on
     * an edge being traceable to a line someone can open. */
    const evidence = http[0]!.evidence?.[0];
    assert.ok(evidence, 'an http edge must carry evidence');
    assert.match(String(evidence.file), /client\.ts$/);
    assert.ok(Number(evidence.line) > 0, 'the evidence names a real line');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/*
 * GUARD 1. A file that never makes an HTTP call does not get to turn a string
 * that looks like a path into a call to a server.
 */
test('a relative path in a file that never calls out is NOT an http edge', async () => {
  const repo = tree({
    'pyproject.toml': '[project]\nname = "api"\n',
    'app/main.py': BACKEND_PY,
    'frontend/package.json': JSON.stringify({ name: 'ui', dependencies: { react: '^18' } }),
    'frontend/src/paths.ts': `
export function routeFor(kind: string) {
  return kind === 'items' ? '/api/items' : '/api/other';
}
`,
  });
  try {
    const g = await scanRepo(repo, { cluster: true });
    assert.equal(
      g.edges.filter((e) => e.kind === 'http').length,
      0,
      'a module that only names a path is not calling a server',
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/*
 * GUARD 2. A same-origin path that matches no registered route yields nothing.
 * The target would be a guess, and a guessed edge with a citation is the exact
 * failure CANON records as worse than no tool at all.
 */
test('a relative path matching no route yields no edge', async () => {
  const repo = tree({
    'pyproject.toml': '[project]\nname = "api"\n',
    'app/main.py': BACKEND_PY,
    'frontend/package.json': JSON.stringify({ name: 'ui', dependencies: { react: '^18' } }),
    'frontend/src/client.ts': CLIENT_TS.replace("'/api/items'", "'/api/nothing-registered'"),
  });
  try {
    const g = await scanRepo(repo, { cluster: true });
    assert.equal(g.edges.filter((e) => e.kind === 'http').length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
