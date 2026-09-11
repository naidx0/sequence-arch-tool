import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { addRecent, CHAT_MEMORY_FILE, SESSIONS_INDEX_FILE } from '../server/store.js';
import { createSession, ensureSessionsMigrated } from '../server/sessionsStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function freshRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-sessions-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

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

test('ensureSessionsMigrated imports legacy chat-memory.json once and archives it', () => {
  const repo = freshRepo();
  const legacy = {
    version: 1,
    sessionId: 'session-0099',
    turns: [{ role: 'user', text: 'legacy turn', at: '2026-01-01T00:00:00.000Z' }],
  };
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', CHAT_MEMORY_FILE),
    JSON.stringify(legacy),
  );
  const index = ensureSessionsMigrated(repo);
  assert.strictEqual(index.activeId, 'session-0099');
  assert.strictEqual(index.sessions.length, 1);
  assert.ok(
    fs.existsSync(path.join(repo, '.sequence', SESSIONS_INDEX_FILE)),
    'sessions index must be written',
  );
  const chatPath = path.join(repo, '.sequence', 'sessions', 'session-0099', 'chat.json');
  assert.ok(fs.existsSync(chatPath));
  const chat = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
  assert.strictEqual(chat.turns[0].text, 'legacy turn');
  assert.ok(
    !fs.existsSync(path.join(repo, '.sequence', CHAT_MEMORY_FILE)),
    'live chat-memory.json must be archived after migrate',
  );
  assert.ok(
    fs.existsSync(path.join(repo, '.sequence', `${CHAT_MEMORY_FILE}.migrated`)),
    'migrated archive must exist',
  );

  // Idempotent — second call keeps the same index / turns
  const again = ensureSessionsMigrated(repo);
  assert.strictEqual(again.activeId, 'session-0099');
  assert.strictEqual(again.sessions.length, 1);
  const chat2 = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
  assert.strictEqual(chat2.turns[0].text, 'legacy turn');
});

test('concurrent first-touch ensureSessionsMigrated mints exactly one session', async () => {
  /*
   * Seat-walk: SessionsPanel list + chat-memory hydrate both call ensure on
   * attach. Without a lock, three "hi"s could leave three index rows.
   */
  const repo = freshRepo();
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });

  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      Promise.resolve().then(() => ensureSessionsMigrated(repo)),
    ),
  );

  const activeIds = new Set(results.map((r) => r.activeId));
  assert.strictEqual(activeIds.size, 1, `expected one activeId, got ${[...activeIds].join(',')}`);
  for (const r of results) {
    assert.strictEqual(r.sessions.length, 1);
  }
  const onDisk = JSON.parse(
    fs.readFileSync(path.join(repo, '.sequence', SESSIONS_INDEX_FILE), 'utf8'),
  ) as { sessions: unknown[] };
  assert.strictEqual(onDisk.sessions.length, 1);
});

test('GET/POST /api/sessions without a repo uses workspace storage', async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-user-'));
  const homeRoot = path.join(userDir, 'home');
  fs.mkdirSync(homeRoot, { recursive: true });
  const { base, close } = await startRepoServer(null, {
    webDist: undefined,
    userConfigDir: path.join(homeRoot, '.sequence'),
    recentStoreDir: path.join(homeRoot, '.sequence'),
    browseRoot: homeRoot,
  });
  try {
    const get = await fetch(`${base}/api/sessions`);
    assert.strictEqual(get.status, 200);
    const getBody = (await get.json()) as {
      index: { version: number; activeId: string; sessions: unknown[] };
      scope: string;
      repos?: unknown[];
    };
    assert.strictEqual(getBody.scope, 'workspace');
    assert.strictEqual(getBody.index.version, 1);
    assert.ok(getBody.index.activeId);
    assert.ok(Array.isArray(getBody.repos));

    const chatGet = await fetch(`${base}/api/chat-memory`);
    assert.strictEqual(chatGet.status, 200);
    const chat = (await chatGet.json()) as { sessionId: string; turns: unknown[] };
    assert.strictEqual(chat.sessionId, getBody.index.activeId);

    const post = await fetch(`${base}/api/sessions`, { method: 'POST' });
    assert.strictEqual(post.status, 200);
    const postBody = (await post.json()) as {
      index: { sessions: unknown[] };
    };
    assert.strictEqual(postBody.index.sessions.length, 2);

    const indexPath = path.join(homeRoot, '.sequence', SESSIONS_INDEX_FILE);
    assert.ok(fs.existsSync(indexPath), 'workspace sessions index must exist under ~/.sequence');
  } finally {
    await close();
  }
});

test('GET/POST /api/sessions migrates and creates sessions', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const get = await fetch(`${base}/api/sessions`);
    assert.strictEqual(get.status, 200);
    const getBody = (await get.json()) as {
      index: { version: number; activeId: string; sessions: unknown[] };
    };
    assert.strictEqual(getBody.index.version, 1);
    assert.ok(getBody.index.activeId);

    const post = await fetch(`${base}/api/sessions`, { method: 'POST' });
    assert.strictEqual(post.status, 200);
    const postBody = (await post.json()) as {
      index: { sessions: unknown[]; activeId: string };
      session: { id: string; chat: { turns: unknown[] } };
    };
    assert.strictEqual(postBody.index.sessions.length, 2);
    assert.strictEqual(postBody.session.chat.turns.length, 0);
    assert.notStrictEqual(postBody.session.id, getBody.index.activeId);
  } finally {
    await close();
  }
});

test('sessions A/B isolation + board.seqd round-trip + PUT active', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const list1 = await (await fetch(`${base}/api/sessions`)).json() as {
      index: { activeId: string };
    };
    const a = list1.index.activeId;

    const boardA = JSON.stringify({
      schemaVersion: 1,
      id: 'board-a',
      title: 'Checkout',
      vocab: 'process',
      nodes: [],
      edges: [],
    });
    const putA = await fetch(`${base}/api/sessions/${encodeURIComponent(a)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat: {
          version: 1,
          sessionId: a,
          turns: [{ role: 'user', text: 'Design checkout', at: '2026-01-01T00:00:00.000Z' }],
        },
        boardSeqd: boardA,
        meta: { boardSource: 'chat' },
      }),
    });
    assert.strictEqual(putA.status, 200);

    const created = await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json() as {
      session: { id: string };
      index: { activeId: string };
    };
    const b = created.session.id;
    assert.notStrictEqual(a, b);
    assert.strictEqual(created.index.activeId, b);

    const putB = await fetch(`${base}/api/sessions/${encodeURIComponent(b)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat: {
          version: 1,
          sessionId: b,
          turns: [{ role: 'user', text: 'Explain auth', at: '2026-01-01T00:00:01.000Z' }],
        },
      }),
    });
    assert.strictEqual(putB.status, 200);

    const getA = await (await fetch(`${base}/api/sessions/${encodeURIComponent(a)}`)).json() as {
      chat: { turns: Array<{ text: string }> };
      boardSeqd?: string;
    };
    const getB = await (await fetch(`${base}/api/sessions/${encodeURIComponent(b)}`)).json() as {
      chat: { turns: Array<{ text: string }> };
      boardSeqd?: string;
    };
    assert.strictEqual(getA.chat.turns[0]?.text, 'Design checkout');
    assert.ok(getA.boardSeqd?.includes('board-a'));
    assert.strictEqual(getB.chat.turns[0]?.text, 'Explain auth');
    assert.strictEqual(getB.boardSeqd, undefined);

    const switchA = await fetch(`${base}/api/sessions/active`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activeId: a }),
    });
    assert.strictEqual(switchA.status, 200);
    const switched = (await switchA.json()) as { index: { activeId: string } };
    assert.strictEqual(switched.index.activeId, a);

    // Compat shim: /api/chat-memory reads/writes the active session, not a shared blob
    const memGet = await (await fetch(`${base}/api/chat-memory`)).json() as {
      sessionId: string;
      turns: Array<{ text: string }>;
    };
    assert.strictEqual(memGet.sessionId, a);
    assert.strictEqual(memGet.turns[0]?.text, 'Design checkout');

    const memPut = await fetch(`${base}/api/chat-memory`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        sessionId: 'ignored-wrong-id',
        turns: [
          { role: 'user', text: 'Design checkout', at: '2026-01-01T00:00:00.000Z' },
          { role: 'assistant', text: '## Plan\n\n- Cart', at: '2026-01-01T00:00:02.000Z' },
        ],
      }),
    });
    assert.strictEqual(memPut.status, 200);
    const memPutBody = (await memPut.json()) as { path: string };
    assert.ok(memPutBody.path.includes(`sessions/${a}/chat.json`));
    assert.ok(!fs.existsSync(path.join(repo, '.sequence', CHAT_MEMORY_FILE)));

    const getA2 = await (await fetch(`${base}/api/sessions/${encodeURIComponent(a)}`)).json() as {
      chat: { turns: unknown[]; sessionId: string };
    };
    assert.strictEqual(getA2.chat.sessionId, a);
    assert.strictEqual(getA2.chat.turns.length, 2);
  } finally {
    await close();
  }
});

test('GET /api/chat-memory returns version-2 transcripts written by the client', async () => {
  /*
   * Client toChatMemory writes version 2. readSessionChat used to require
   * version === 1 only, so every modern save hydrated as an empty thread —
   * the "sessions aren't saving" seat report while chat.json on disk was full.
   */
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const list = (await (await fetch(`${base}/api/sessions`)).json()) as {
      index: { activeId: string };
    };
    const id = list.index.activeId;
    const put = await fetch(`${base}/api/chat-memory`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 2,
        sessionId: 'active',
        turns: [
          { role: 'user', text: 'SAVE_TEST_MARKER_v2', at: '2026-01-01T00:00:00.000Z' },
          {
            role: 'assistant',
            text: 'ok',
            at: '2026-01-01T00:00:01.000Z',
            work: [],
            evidence: { tools: [], filesRead: [], proposals: [] },
          },
        ],
      }),
    });
    assert.strictEqual(put.status, 200);
    const got = (await (await fetch(`${base}/api/chat-memory`)).json()) as {
      version: number;
      sessionId: string;
      turns: Array<{ text: string }>;
    };
    assert.strictEqual(got.version, 2);
    assert.strictEqual(got.sessionId, id);
    assert.strictEqual(got.turns[0]?.text, 'SAVE_TEST_MARKER_v2');
    assert.strictEqual(got.turns.length, 2);
  } finally {
    await close();
  }
});

test('PUT /api/sessions/:id rejects mismatched chat.sessionId', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const list = await (await fetch(`${base}/api/sessions`)).json() as {
      index: { activeId: string };
    };
    const id = list.index.activeId;
    const bad = await fetch(`${base}/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat: {
          version: 1,
          sessionId: 'session-other',
          turns: [{ role: 'user', text: 'nope', at: '2026-01-01T00:00:00.000Z' }],
        },
      }),
    });
    assert.strictEqual(bad.status, 400);
  } finally {
    await close();
  }
});

test('DELETE /api/sessions removes a session; PUT can pin and rename', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const created = await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json() as {
      index: { sessions: Array<{ id: string }>; activeId: string };
      session: { id: string };
    };
    const extra = created.session.id;
    const first = created.index.sessions.find((s) => s.id !== extra)?.id;
    assert.ok(first);
    const pin = await fetch(`${base}/api/sessions/${encodeURIComponent(first)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Pinned walk', pinned: true }),
    });
    assert.strictEqual(pin.status, 200);
    const pinnedBody = await pin.json() as {
      index: { sessions: Array<{ id: string; title: string; pinned?: boolean }> };
    };
    const pinned = pinnedBody.index.sessions.find((s) => s.id === first);
    assert.strictEqual(pinned?.title, 'Pinned walk');
    assert.strictEqual(pinned?.pinned, true);

    const del = await fetch(`${base}/api/sessions/${encodeURIComponent(extra)}`, { method: 'DELETE' });
    assert.strictEqual(del.status, 200);
    const after = await del.json() as {
      index: { sessions: Array<{ id: string }>; activeId: string };
    };
    assert.equal(after.index.sessions.some((s) => s.id === extra), false);
    assert.ok(after.index.sessions.some((s) => s.id === first));
  } finally {
    await close();
  }
});

test('GET/PUT /api/canvas-doc reads and writes active session canvas.json', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const list = await (await fetch(`${base}/api/sessions`)).json() as {
      index: { activeId: string };
    };
    const id = list.index.activeId;

    const empty = await (await fetch(`${base}/api/canvas-doc`)).json() as {
      version: number;
      sessionId: string;
      blocks: unknown[];
    };
    assert.strictEqual(empty.version, 1);
    assert.strictEqual(empty.sessionId, id);
    assert.deepStrictEqual(empty.blocks, []);

    const put = await fetch(`${base}/api/canvas-doc`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        sessionId: 'ignored-wrong-id',
        blocks: [
          {
            id: 'blk-1',
            type: 'markdown',
            title: 'Plan',
            payload: '# Hello',
            status: 'landed',
          },
        ],
      }),
    });
    assert.strictEqual(put.status, 200);
    const putBody = (await put.json()) as { path: string };
    assert.ok(putBody.path.includes(`sessions/${id}/canvas.json`));

    const got = await (await fetch(`${base}/api/canvas-doc`)).json() as {
      sessionId: string;
      blocks: Array<{ id: string; payload: string }>;
    };
    assert.strictEqual(got.sessionId, id);
    assert.strictEqual(got.blocks.length, 1);
    assert.strictEqual(got.blocks[0]?.payload, '# Hello');

    const onDisk = path.join(repo, '.sequence', 'sessions', id, 'canvas.json');
    assert.ok(fs.existsSync(onDisk));
  } finally {
    await close();
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   REPORT C — A SESSION WRITE THAT NAMES ITS REPO

   OWNER, 2026-09-02: "Should also let you edit any type of chat session
   without actually being in that chat session, just whenever you want."

   `PUT`/`DELETE /api/sessions/:id` now take an optional `repoPath` — body field
   on the PUT, query param on the DELETE (a DELETE has no body). That is a
   write-anywhere primitive unless it is fenced, so the path is accepted ONLY
   when it is one of the repos the workspace catalog itself was built from.
   ══════════════════════════════════════════════════════════════════════════ */

/** A workspace server plus a catalogued repo and a PREFIX SIBLING of it. */
async function workspaceWithCatalog(opts?: { catalogThreads?: number }): Promise<{
  base: string;
  close: () => Promise<void>;
  homeRoot: string;
  catalogRepo: string;
  siblingRepo: string;
  catalogSessionId: string;
}> {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-catalog-'));
  const homeRoot = path.join(userDir, 'home');
  fs.mkdirSync(homeRoot, { recursive: true });

  // `shopfront` is catalogued; `shopfront-secrets` is NOT — and it is a
  // startsWith-prefix of it, the sibling trap insightTools.ts fixed at its jail.
  const catalogRepo = path.join(homeRoot, 'shopfront');
  const siblingRepo = path.join(homeRoot, 'shopfront-secrets');
  fs.cpSync(PLAINAPP, catalogRepo, { recursive: true });
  fs.cpSync(PLAINAPP, siblingRepo, { recursive: true });
  const catalogIndex = ensureSessionsMigrated(catalogRepo);
  // TWO threads by default, so a delete leaves a section behind to assert on.
  // Ask for ONE to exercise the last-thread case: deleting it used to empty the
  // index and immediately mint a replacement inside a repo the user is not in.
  const threads = opts?.catalogThreads ?? 2;
  for (let i = 1; i < threads; i += 1) createSession(catalogRepo);
  ensureSessionsMigrated(siblingRepo);

  const storeDir = path.join(homeRoot, '.sequence');
  addRecent(storeDir, catalogRepo);
  // The workspace root as the panel finds it: `GET /api/sessions` has already
  // minted the General thread, so "the active root is untouched" has bytes to
  // compare rather than an absent file.
  ensureSessionsMigrated(homeRoot);

  const { base, close } = await startRepoServer(null, {
    webDist: undefined,
    userConfigDir: storeDir,
    recentStoreDir: storeDir,
    browseRoot: homeRoot,
  });
  return { base, close, homeRoot, catalogRepo, siblingRepo, catalogSessionId: catalogIndex.activeId };
}

function readIndexOnDisk(root: string): { activeId: string; sessions: Array<{ id: string; title: string }> } {
  return JSON.parse(fs.readFileSync(path.join(root, '.sequence', SESSIONS_INDEX_FILE), 'utf8'));
}

test('PUT /api/sessions/:id writes the repo it names, and leaves the active root alone', async () => {
  const c = await workspaceWithCatalog();
  try {
    // The catalog the panel renders — the same list the write is fenced against.
    const listed = (await (await fetch(`${c.base}/api/sessions`)).json()) as {
      index: { activeId: string };
      scope: string;
      repos: Array<{ path: string }>;
    };
    assert.strictEqual(listed.scope, 'workspace');
    assert.ok(
      listed.repos.some((r) => r.path === c.catalogRepo),
      'shopfront must be in the catalog for this test to mean anything',
    );
    const workspaceBefore = readIndexOnDisk(c.homeRoot);

    const put = await fetch(`${c.base}/api/sessions/${c.catalogSessionId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Checkout bug', repoPath: c.catalogRepo }),
    });
    assert.strictEqual(put.status, 200);
    const answered = (await put.json()) as { index: { sessions: Array<{ id: string; title: string }> } };
    assert.strictEqual(
      answered.index.sessions.find((s) => s.id === c.catalogSessionId)?.title,
      'Checkout bug',
      'the answer is the NAMED repo index, not the workspace one',
    );

    // The bytes on disk, in the repo the caller named.
    const onDisk = readIndexOnDisk(c.catalogRepo);
    assert.strictEqual(
      onDisk.sessions.find((s) => s.id === c.catalogSessionId)?.title,
      'Checkout bug',
    );

    // And the ACTIVE root — the workspace — is untouched.
    assert.deepStrictEqual(readIndexOnDisk(c.homeRoot), workspaceBefore);
  } finally {
    await c.close();
  }
});

test('PUT /api/sessions/:id refuses a repoPath outside the catalog and writes nothing', async () => {
  const c = await workspaceWithCatalog();
  try {
    const siblingBefore = readIndexOnDisk(c.siblingRepo);
    const workspaceBefore = readIndexOnDisk(c.homeRoot);
    const sessionId = siblingBefore.activeId;

    const put = await fetch(`${c.base}/api/sessions/${sessionId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      // A REAL repo with a REAL sessions index, and a startsWith-prefix of the
      // catalogued one. Only membership stands between it and a write.
      body: JSON.stringify({ title: 'written where it should not be', repoPath: c.siblingRepo }),
    });
    assert.strictEqual(put.status, 400, 'an uncatalogued repo is a refusal, not a fallback');
    const err = (await put.json()) as { error: string };
    assert.match(err.error, /repoPath/, `the refusal must name the field: ${err.error}`);

    assert.deepStrictEqual(
      readIndexOnDisk(c.siblingRepo),
      siblingBefore,
      'the refused repo must be byte-identical',
    );
    assert.deepStrictEqual(
      readIndexOnDisk(c.homeRoot),
      workspaceBefore,
      'a refused repoPath must NEVER fall back to the active root',
    );
  } finally {
    await c.close();
  }
});

test('DELETE /api/sessions/:id?repoPath= deletes in the named repo, and refuses an unknown one', async () => {
  const c = await workspaceWithCatalog();
  try {
    const workspaceBefore = readIndexOnDisk(c.homeRoot);

    const refused = await fetch(
      `${c.base}/api/sessions/${c.catalogSessionId}?repoPath=${encodeURIComponent(c.siblingRepo)}`,
      { method: 'DELETE' },
    );
    assert.strictEqual(refused.status, 400);
    assert.deepStrictEqual(readIndexOnDisk(c.homeRoot), workspaceBefore);
    assert.ok(
      readIndexOnDisk(c.catalogRepo).sessions.some((s) => s.id === c.catalogSessionId),
      'a refused delete deletes nothing anywhere',
    );

    const gone = await fetch(
      `${c.base}/api/sessions/${c.catalogSessionId}?repoPath=${encodeURIComponent(c.catalogRepo)}`,
      { method: 'DELETE' },
    );
    assert.strictEqual(gone.status, 200);
    assert.ok(
      !readIndexOnDisk(c.catalogRepo).sessions.some((s) => s.id === c.catalogSessionId),
      'the named repo lost the session',
    );
    assert.deepStrictEqual(
      readIndexOnDisk(c.homeRoot),
      workspaceBefore,
      'the workspace pointer never moved for a foreign delete',
    );
  } finally {
    await c.close();
  }
});

test('DELETE of the LAST thread in a catalogued repo removes the row instead of re-minting it', async () => {
  // OWNER SHAPE: the catalog shows `shopfront` with exactly ONE thread, titled
  // "Checkout bug". Clicking its trash used to rm the session dir, then call
  // `createSession` in that same repo — so the section came back with one row,
  // the title silently reverted to the id-derived default, the transcript was
  // gone, and the repo's `activeId` had moved to a thread the user never opened.
  const c = await workspaceWithCatalog({ catalogThreads: 1 });
  try {
    const titled = await fetch(`${c.base}/api/sessions/${c.catalogSessionId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Checkout bug', repoPath: c.catalogRepo }),
    });
    assert.strictEqual(titled.status, 200);
    const before = readIndexOnDisk(c.catalogRepo);
    assert.strictEqual(before.sessions.length, 1, 'the owner shape is ONE thread');
    const workspaceBefore = readIndexOnDisk(c.homeRoot);

    const gone = await fetch(
      `${c.base}/api/sessions/${c.catalogSessionId}?repoPath=${encodeURIComponent(c.catalogRepo)}`,
      { method: 'DELETE' },
    );
    assert.strictEqual(gone.status, 200);

    // The row is GONE from the list the panel re-reads — no replacement thread.
    const listed = (await (await fetch(`${c.base}/api/sessions`)).json()) as {
      repos: Array<{ path: string; index: { sessions: unknown[] } }>;
    };
    assert.ok(
      !listed.repos.some((r) => r.path === c.catalogRepo),
      'the section must disappear, not come back holding a minted stand-in',
    );

    // And nothing was re-minted on disk: no index, no new session directory.
    assert.ok(
      !fs.existsSync(path.join(c.catalogRepo, '.sequence', SESSIONS_INDEX_FILE)),
      'a repo whose last thread was deleted reads as never-opened',
    );
    const sessionsDir = path.join(c.catalogRepo, '.sequence', 'sessions');
    const leftover = fs.existsSync(sessionsDir)
      ? fs.readdirSync(sessionsDir).filter((n) => n.startsWith('session-'))
      : [];
    assert.deepStrictEqual(leftover, [], `no replacement session dir: ${leftover.join(',')}`);

    assert.deepStrictEqual(
      readIndexOnDisk(c.homeRoot),
      workspaceBefore,
      'the workspace the user is actually in never moved',
    );
  } finally {
    await c.close();
  }
});

test('DELETE of the last thread in the repo you are IN still leaves one live thread', async () => {
  // The other half of the rule: with no `repoPath` this is the repo the user is
  // typing in, and there must always be a thread to type into.
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const list = (await (await fetch(`${base}/api/sessions`)).json()) as {
      index: { activeId: string; sessions: unknown[] };
    };
    assert.strictEqual(list.index.sessions.length, 1);
    const del = await fetch(`${base}/api/sessions/${list.index.activeId}`, { method: 'DELETE' });
    assert.strictEqual(del.status, 200);
    const body = (await del.json()) as { index: { activeId: string; sessions: Array<{ id: string }> } };
    assert.strictEqual(body.index.sessions.length, 1, 'a replacement thread is minted here');
    assert.ok(body.index.activeId, 'and it is active');
    assert.notStrictEqual(body.index.sessions[0]?.id, undefined);
  } finally {
    await close();
  }
});

test('a canvas.json holding a junk block can still be overwritten', async () => {
  // The PUT route narrows a canvas on version/sessionId/Array.isArray(blocks)
  // only, and readSessionCanvas returns disk content after the same three
  // checks. When the updatedAt fingerprint started reading BOTH sides, a
  // `blocks: [null]` on disk — torn write, sync conflict, hand edit — threw on
  // `b.id` and 500'd every later save for that session, forever: the write that
  // would have healed the file could never land.
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const list = (await (await fetch(`${base}/api/sessions`)).json()) as {
      index: { activeId: string };
    };
    const id = list.index.activeId;
    const canvasPath = path.join(repo, '.sequence', 'sessions', id, 'canvas.json');
    fs.writeFileSync(
      canvasPath,
      JSON.stringify({ version: 1, sessionId: id, blocks: [null] }),
      'utf8',
    );

    const put = await fetch(`${base}/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        canvas: {
          version: 1,
          sessionId: id,
          blocks: [{ id: 'blk-1', type: 'markdown', payload: '# Healed' }],
        },
      }),
    });
    assert.strictEqual(put.status, 200, 'the healing write must land, not 500');
    const healed = JSON.parse(fs.readFileSync(canvasPath, 'utf8')) as {
      blocks: Array<{ payload: string }>;
    };
    assert.strictEqual(healed.blocks[0]?.payload, '# Healed');

    // The same shape arriving as a BODY is admitted by the route, so it must
    // not blow up on the way to the fingerprint either.
    const junk = await fetch(`${base}/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        canvas: { version: 1, sessionId: id, blocks: [null], storyRoute: { title: 'x' } },
      }),
    });
    assert.strictEqual(junk.status, 200, 'a body the route accepted must not 500 in the store');
  } finally {
    await close();
  }
});

test('REPO SCOPE serves no catalog, so a session write may not name another repo', async () => {
  // The fence must never be wider than what the read route discloses. With a
  // repo attached, `GET /api/sessions` answers `{scope:'repo'}` and omits
  // `repos` entirely — no catalog is offered — yet the first version of the
  // fence still honoured any recently-browsed repo, rewriting/rm'ing threads in
  // a repo this mode never shows. The only path accepted here is the attached
  // repo itself, which is exactly what omitting the field does.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-reposcope-'));
  const homeRoot = path.join(dir, 'home');
  const attached = path.join(homeRoot, 'app');
  const other = path.join(homeRoot, 'other');
  fs.mkdirSync(homeRoot, { recursive: true });
  fs.cpSync(PLAINAPP, attached, { recursive: true });
  fs.cpSync(PLAINAPP, other, { recursive: true });
  const otherIndex = ensureSessionsMigrated(other);
  const storeDir = path.join(homeRoot, '.sequence');
  // `other` is in recents — the list the old fence consulted. `attached` is not
  // (a `--repo` start never records), so a pass here cannot come from recents.
  addRecent(storeDir, other);

  const { base, close } = await startRepoServer(attached, {
    userConfigDir: storeDir,
    recentStoreDir: storeDir,
    browseRoot: homeRoot,
  });
  try {
    const listed = (await (await fetch(`${base}/api/sessions`)).json()) as {
      index: { activeId: string };
      scope: string;
      repos?: unknown;
    };
    assert.strictEqual(listed.scope, 'repo');
    assert.strictEqual(listed.repos, undefined, 'repo scope discloses no catalog');

    const otherBefore = readIndexOnDisk(other);
    const refused = await fetch(`${base}/api/sessions/${otherIndex.activeId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'WRITTEN FROM REPO SCOPE', repoPath: other }),
    });
    assert.strictEqual(refused.status, 400, 'a repo the GET never listed is not writable');
    const err = (await refused.json()) as { error: string };
    assert.match(err.error, /repoPath/, `the refusal must name the field: ${err.error}`);
    assert.deepStrictEqual(readIndexOnDisk(other), otherBefore, 'and nothing was written there');

    const del = await fetch(
      `${base}/api/sessions/${otherIndex.activeId}?repoPath=${encodeURIComponent(other)}`,
      { method: 'DELETE' },
    );
    assert.strictEqual(del.status, 400);
    assert.deepStrictEqual(readIndexOnDisk(other), otherBefore, 'a refused delete deletes nothing');

    // The other half: naming the repo you ARE in behaves like omitting the field.
    const mine = await fetch(`${base}/api/sessions/${listed.index.activeId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed in place', repoPath: attached }),
    });
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(
      readIndexOnDisk(attached).sessions.find((s) => s.id === listed.index.activeId)?.title,
      'Renamed in place',
    );
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
