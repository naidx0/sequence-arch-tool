import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { addRecent, SESSIONS_INDEX_FILE } from '../server/store.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

/**
 * POST /api/sessions WITH A repoPath — start a chat in a workspace section.
 *
 * Owner walk 2026-09-17: "there should be a start-chat button near each folder
 * workspace so you can start a chat in that workspace." The rail already lists
 * every catalogued repo and can soft-open a thread in one without attaching
 * it; it could not MAKE one, because POST has only ever written the active
 * root.
 *
 * THE FENCE IS THE PUT'S FENCE, not a second set of rules: `sessionWriteRoot`
 * accepts exactly the paths `GET /api/sessions` disclosed as `repos`, so "you
 * may create where you can see" and "you may write where you can see" cannot
 * drift apart. `shopfront-secrets` below is a startsWith-prefix sibling of the
 * catalogued `shopfront` and is NOT catalogued — the trap a prefix check would
 * fall into.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

async function startRepoServer(
  repoRoot: string | null,
  opts: Parameters<typeof createRepoServer>[1] = {},
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined, ...opts });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface Workspace {
  base: string;
  close: () => Promise<void>;
  homeRoot: string;
  catalogRepo: string;
  siblingRepo: string;
}

async function workspaceWithCatalog(): Promise<Workspace> {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-create-in-repo-'));
  const homeRoot = path.join(userDir, 'home');
  fs.mkdirSync(homeRoot, { recursive: true });
  const catalogRepo = path.join(homeRoot, 'shopfront');
  const siblingRepo = path.join(homeRoot, 'shopfront-secrets');
  fs.cpSync(PLAINAPP, catalogRepo, { recursive: true });
  fs.cpSync(PLAINAPP, siblingRepo, { recursive: true });
  ensureSessionsMigrated(catalogRepo);
  ensureSessionsMigrated(siblingRepo);
  const storeDir = path.join(homeRoot, '.sequence');
  addRecent(storeDir, catalogRepo);
  ensureSessionsMigrated(homeRoot);
  const { base, close } = await startRepoServer(null, {
    webDist: undefined,
    userConfigDir: storeDir,
    recentStoreDir: storeDir,
    browseRoot: homeRoot,
  });
  return { base, close, homeRoot, catalogRepo, siblingRepo };
}

function readIndexOnDisk(root: string): { activeId: string; sessions: Array<{ id: string }> } {
  return JSON.parse(fs.readFileSync(path.join(root, '.sequence', SESSIONS_INDEX_FILE), 'utf8'));
}

async function postSessions(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /api/sessions with a catalogued repoPath creates the thread THERE', async () => {
  const c = await workspaceWithCatalog();
  try {
    /* The catalog the rail renders — the same list the create is fenced
       against, so the assertion below is about the fence and not about a path
       that happened to work. */
    const listed = (await (await fetch(`${c.base}/api/sessions`)).json()) as {
      repos: Array<{ path: string }>;
    };
    assert.ok(
      listed.repos.some((r) => r.path === c.catalogRepo),
      'shopfront must be in the catalog for this test to mean anything',
    );
    const workspaceBefore = readIndexOnDisk(c.homeRoot);
    const catalogBefore = readIndexOnDisk(c.catalogRepo);

    const res = await postSessions(c.base, { mode: 'code', repoPath: c.catalogRepo });
    assert.strictEqual(res.status, 200);
    const created = (await res.json()) as {
      index: { sessions: Array<{ id: string; mode?: string }> };
      session: { id: string };
    };

    /* The bytes on disk, in the repo the caller named. */
    const onDisk = readIndexOnDisk(c.catalogRepo);
    assert.ok(
      onDisk.sessions.some((s) => s.id === created.session.id),
      'the new thread must be in the NAMED repo index on disk',
    );
    assert.strictEqual(
      onDisk.sessions.length,
      catalogBefore.sessions.length + 1,
      'exactly one thread was added there',
    );
    assert.strictEqual(
      created.index.sessions.find((s) => s.id === created.session.id)?.mode,
      'code',
      'the answer is the NAMED repo index, and the mode was stamped',
    );

    /* And the ACTIVE root — the workspace — is untouched. Creating in a
       section must not move the reader's own home, which is the whole reason
       the rail can do this without attaching. */
    assert.deepStrictEqual(readIndexOnDisk(c.homeRoot), workspaceBefore);
  } finally {
    await c.close();
  }
});

test('POST /api/sessions refuses a repoPath the workspace catalog does not list', async () => {
  const c = await workspaceWithCatalog();
  try {
    const before = readIndexOnDisk(c.siblingRepo);

    const res = await postSessions(c.base, { repoPath: c.siblingRepo });
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), /catalog/i);

    /* A 400 that still wrote would be the worst of both: the index in the
       uncatalogued sibling is byte-identical. */
    assert.deepStrictEqual(readIndexOnDisk(c.siblingRepo), before);

    /* Nor did it fall back to the active root and create there quietly. */
    const alsoEmpty = await postSessions(c.base, { repoPath: '   ' });
    assert.strictEqual(alsoEmpty.status, 400, 'a blank repoPath is not "absent"');
  } finally {
    await c.close();
  }
});

test('POST /api/sessions with no repoPath still creates in the active root', async () => {
  const c = await workspaceWithCatalog();
  try {
    const catalogBefore = readIndexOnDisk(c.catalogRepo);

    const res = await postSessions(c.base, { mode: 'work' });
    assert.strictEqual(res.status, 200);
    const created = (await res.json()) as { session: { id: string } };

    const home = readIndexOnDisk(c.homeRoot);
    assert.ok(
      home.sessions.some((s) => s.id === created.session.id),
      'absent repoPath means the active root, byte-identical to before the field existed',
    );
    assert.deepStrictEqual(
      readIndexOnDisk(c.catalogRepo),
      catalogBefore,
      'and the catalogued repo was not touched',
    );
  } finally {
    await c.close();
  }
});
