import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';

/**
 * `GET /api/search` — CORRECT, GATED, AND UNTESTED.
 *
 * The audit's words: "a correct, security-gated endpoint that literally nobody
 * calls, and with no test, so deleting it would not turn anything red." The
 * results surface it was built for was never written, which is a real gap and
 * a separate one — but an untested route is a route that can rot silently
 * before the surface arrives to use it.
 *
 * These pin the CONTRACT a results surface will have to build against, and the
 * jail, which is the part that must not rot: the route reuses `GET /api/file`'s
 * choke point precisely so a search cannot read what the file route refuses.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-search-'));
  const root = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, root, { recursive: true });
  return root;
}

async function serve(root: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(root, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('a text query finds matches and cites where they are', async () => {
  const root = repo();
  fs.writeFileSync(path.join(root, 'needle.ts'), 'export const FINDME_TOKEN = 1;\n');
  const { base, close } = await serve(root);
  try {
    const res = await fetch(`${base}/api/search?query=FINDME_TOKEN`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { matches?: { path: string }[]; files?: { path: string }[] };
    const found = JSON.stringify(body);
    assert.match(found, /needle\.ts/, 'the file holding the match is named');
    assert.match(found, /FINDME_TOKEN/, 'and the matching text is carried');
  } finally {
    await close();
  }
});

test('a glob with no query is a valid search', async () => {
  /* `query || glob` is the documented contract - a reader looking for "every
     .ts file" is asking a real question with no text in it. */
  const root = repo();
  const { base, close } = await serve(root);
  try {
    const res = await fetch(`${base}/api/search?glob=**/*.ts`);
    assert.strictEqual(res.status, 200);
  } finally {
    await close();
  }
});

test('neither a query nor a glob is REFUSED, not answered with everything', async () => {
  /* Guessing here would mean serving the whole repository to a caller that
     lost its argument. */
  const root = repo();
  const { base, close } = await serve(root);
  try {
    const res = await fetch(`${base}/api/search`);
    assert.strictEqual(res.status, 400);
    assert.match(await res.text(), /query or glob required/);
  } finally {
    await close();
  }
});

test('THE JAIL HOLDS — search cannot read what the file route refuses', async () => {
  /*
   * The route reuses `GET /api/file`'s resolver precisely so that a search
   * cannot become a way around it. A search that could reach outside the repo,
   * or into `.git/`, would be the same leak by a wider door - one request
   * greps the whole tree.
   */
  const root = repo();
  const outside = path.join(root, '..', 'outside-secret.txt');
  fs.writeFileSync(outside, 'SECRET_OUTSIDE_VALUE\n');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'config'), 'SECRET_GIT_VALUE\n');

  const { base, close } = await serve(root);
  try {
    for (const q of ['SECRET_OUTSIDE_VALUE', 'SECRET_GIT_VALUE']) {
      const res = await fetch(`${base}/api/search?query=${encodeURIComponent(q)}`);
      assert.strictEqual(res.status, 200, `${q} is refused by returning nothing, not by erroring`);
      const body = (await res.json()) as { text?: string; evidence?: string };

      /*
       * ASSERTED ON THE RESULT, NOT ON THE BODY TEXT.
       *
       * The route ECHOES THE QUERY back in its evidence line - `search "X" - no
       * matches` - so a naive `doesNotMatch(body, /X/)` fails on the echo and
       * reports a leak that did not happen. The first cut of this test did
       * exactly that; the jail was holding the whole time.
       *
       * What actually matters is that no CONTENT came back.
       */
      assert.strictEqual(body.text, '', `${q} must return no content`);
      assert.match(String(body.evidence), /no matches/, `${q} must find nothing`);
    }
  } finally {
    await close();
  }
});

test('a traversing glob does not escape the repository', async () => {
  const root = repo();
  fs.writeFileSync(path.join(root, '..', 'outside-glob.txt'), 'OUTSIDE_GLOB_VALUE\n');
  const { base, close } = await serve(root);
  try {
    const res = await fetch(`${base}/api/search?glob=${encodeURIComponent('../**')}`);
    assert.ok(res.status === 200 || res.status === 400, `status ${res.status}`);
    /* Same rule as above: judge the CONTENT, not the echoed argument. */
    assert.doesNotMatch(await res.text(), /OUTSIDE_GLOB_VALUE/);
  } finally {
    await close();
  }
});
