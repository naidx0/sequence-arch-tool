import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { MAX_CHECKPOINTS, listCheckpoints } from '../server/checkpointStore.js';

/**
 * P10 — CHECKPOINT AND REWIND. The lock the item names, verbatim: "write a file
 * through a turn, checkpoint, write again, rewind, and assert the file ON DISK
 * is the earlier content. Not a store field — the file."
 *
 * So every assertion below reads the FILE with `fs.readFileSync`. Not the
 * response body, not `listCheckpoints`, not a snapshot record. A restore that
 * updated its own bookkeeping and never touched the working tree would satisfy
 * a test that trusted the response; it cannot satisfy one that opens the file.
 *
 * The writes go through `PUT /api/file` with a `sessionId` — the real turn
 * write path — over a real HTTP server, so the tracking hook, the jail and the
 * checkpoint store are all exercised as they ship.
 */

const cleanups: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  cleanups.push(dir);
  return dir;
}

function cleanupAll(): void {
  while (cleanups.length > 0) {
    const dir = cleanups.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** A scannable repo — `createRepoServer` needs a manifest to attach. */
function fixtureRepo(): string {
  const repo = tempDir('seq-cp-repo-');
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'checkpoint-fixture', version: '0.0.0' }, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  return repo;
}

interface Srv {
  base: string;
  repo: string;
  close: () => Promise<void>;
}

async function startServer(repo: string): Promise<Srv> {
  const userDir = tempDir('seq-cp-user-');
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: userDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    repo,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function readJsonBody<T>(res: Response, expectStatus?: number): Promise<T> {
  // ONE read. `assert.equal(res.status, 200, await res.text())` followed by
  // `res.json()` throws "Body is unusable" — the failure message consumed the
  // stream, so a passing case never saw it and every failing case reported the
  // wrong error. Read the text once, assert against it, parse from it.
  const text = await res.text();
  if (expectStatus !== undefined) {
    assert.equal(res.status, expectStatus, `HTTP ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function postJson(base: string, route: string, body: unknown): Promise<Response> {
  return fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** ONE TURN'S WRITE — the real route, with the session attached. */
async function writeThroughTurn(
  srv: Srv,
  sessionId: string,
  rel: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${srv.base}/api/file`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: rel, content, sessionId }),
  });
  assert.equal(res.status, 200, `PUT ${rel} failed: ${await res.text()}`);
}

/** THE FILE ON DISK. Never a store field. */
function onDisk(repo: string, rel: string): string {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

/* =================== THE NAMED LOCK ====================================== */

test('write → checkpoint → write → rewind puts the EARLIER CONTENT back on disk', async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  const session = 'session-0001';
  try {
    // A turn writes the file.
    await writeThroughTurn(srv, session, 'src/quote.ts', 'export const rate = 1;\n');
    assert.equal(onDisk(repo, 'src/quote.ts'), 'export const rate = 1;\n');

    // Checkpoint.
    const cp = await postJson(srv.base, '/api/checkpoint', { sessionId: session, label: 'after turn 1' });
    assert.equal(cp.status, 200);
    const { checkpoint } = (await cp.json()) as { checkpoint: { seq: number; files: unknown[] } };
    assert.equal(checkpoint.seq, 1);

    // A second turn writes it again.
    await writeThroughTurn(srv, session, 'src/quote.ts', 'export const rate = 999;\n');
    assert.equal(onDisk(repo, 'src/quote.ts'), 'export const rate = 999;\n');

    // Rewind.
    const rw = await postJson(srv.base, '/api/checkpoint/restore', {
      sessionId: session,
      seq: 1,
      scope: 'code',
    });
    const body = await readJsonBody<{
      plan: { touches: { code: boolean; conversation: boolean }; writes: { path: string }[] };
      applied: { ok: boolean; wrote: string[] };
    }>(rw, 200);
    assert.equal(body.applied.ok, true);
    assert.deepEqual(body.applied.wrote, ['src/quote.ts']);

    // ===================== THE LOCK — THE FILE, ON DISK ====================
    assert.equal(onDisk(repo, 'src/quote.ts'), 'export const rate = 1;\n');
  } finally {
    await srv.close();
    cleanupAll();
  }
});

test('a rewind DELETES a file the session created after the checkpoint', async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  const session = 'session-0002';
  try {
    await writeThroughTurn(srv, session, 'a.txt', 'first\n');
    const cp = await postJson(srv.base, '/api/checkpoint', { sessionId: session });
    assert.equal(cp.status, 200);

    // A later turn creates a file that did not exist at the checkpoint.
    await writeThroughTurn(srv, session, 'b.txt', 'made later\n');
    assert.equal(fs.existsSync(path.join(repo, 'b.txt')), true);

    // The plan SAYS SO before it acts.
    const planned = await postJson(srv.base, '/api/checkpoint/plan', {
      sessionId: session,
      seq: 1,
      scope: 'code',
    });
    assert.equal(planned.status, 200);
    const { plan } = (await planned.json()) as { plan: { deletes: string[]; touches: { code: boolean } } };
    assert.deepEqual(plan.deletes, ['b.txt']);
    assert.equal(plan.touches.code, true);
    // …and planning changed nothing.
    assert.equal(fs.existsSync(path.join(repo, 'b.txt')), true, 'a plan must not act');

    const rw = await postJson(srv.base, '/api/checkpoint/restore', {
      sessionId: session,
      seq: 1,
      scope: 'code',
    });
    assert.equal(rw.status, 200);
    assert.equal(fs.existsSync(path.join(repo, 'b.txt')), false, 'the later file must be gone');
    assert.equal(onDisk(repo, 'a.txt'), 'first\n');
  } finally {
    await srv.close();
    cleanupAll();
  }
});

test('a rewind restores a PRE-EXISTING file to what it held before the session, not to nothing', async () => {
  const repo = fixtureRepo();
  // A file that was in the repo before this session ever ran.
  fs.writeFileSync(path.join(repo, 'legacy.txt'), 'owned by someone else\n');
  const srv = await startServer(repo);
  const session = 'session-0003';
  try {
    await writeThroughTurn(srv, session, 'a.txt', 'one\n');
    const cp = await postJson(srv.base, '/api/checkpoint', { sessionId: session });
    assert.equal(cp.status, 200);

    // Only AFTER the checkpoint does the session touch the pre-existing file.
    await writeThroughTurn(srv, session, 'legacy.txt', 'clobbered by the agent\n');
    assert.equal(onDisk(repo, 'legacy.txt'), 'clobbered by the agent\n');

    const rw = await postJson(srv.base, '/api/checkpoint/restore', {
      sessionId: session,
      seq: 1,
      scope: 'code',
    });
    assert.equal(rw.status, 200);

    // THE INVARIANT: it is restored, not deleted. Deleting it would be silent
    // data loss of a file the session did not create.
    assert.equal(fs.existsSync(path.join(repo, 'legacy.txt')), true);
    assert.equal(onDisk(repo, 'legacy.txt'), 'owned by someone else\n');
  } finally {
    await srv.close();
    cleanupAll();
  }
});

/* ============ honest about what it touches: code | conversation | both ==== */

test("scope 'conversation' does not touch a single file on disk", async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  const session = 'session-0004';
  try {
    await writeThroughTurn(srv, session, 'a.txt', 'one\n');
    await postJson(srv.base, '/api/checkpoint', { sessionId: session });
    await writeThroughTurn(srv, session, 'a.txt', 'two\n');

    const planned = await postJson(srv.base, '/api/checkpoint/plan', {
      sessionId: session,
      seq: 1,
      scope: 'conversation',
    });
    assert.equal(planned.status, 200);
    const { plan } = (await planned.json()) as {
      plan: { touches: { code: boolean; conversation: boolean }; writes: unknown[]; deletes: unknown[]; notes: string[] };
    };
    // STATED BEFORE IT ACTS: no code.
    assert.equal(plan.touches.code, false);
    assert.deepEqual(plan.writes, []);
    assert.deepEqual(plan.deletes, []);

    const rw = await postJson(srv.base, '/api/checkpoint/restore', {
      sessionId: session,
      seq: 1,
      scope: 'conversation',
    });
    assert.equal(rw.status, 200);
    // AND IT DID NOT: the file is still the newer content.
    assert.equal(onDisk(repo, 'a.txt'), 'two\n');
  } finally {
    await srv.close();
    cleanupAll();
  }
});

test('a checkpoint with no session on disk says the conversation was not captured', async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  // A session id that is well-formed but is in no session index.
  const session = 'session-9999';
  try {
    await writeThroughTurn(srv, session, 'a.txt', 'one\n');
    const cp = await postJson(srv.base, '/api/checkpoint', { sessionId: session });
    const { checkpoint } = (await cp.json()) as { checkpoint: { conversation?: unknown[] } };
    // ABSENT, never `[]` — the record does not claim to hold a transcript.
    assert.equal(checkpoint.conversation, undefined);

    const planned = await postJson(srv.base, '/api/checkpoint/plan', {
      sessionId: session,
      seq: 1,
      scope: 'both',
    });
    const { plan } = (await planned.json()) as {
      plan: { touches: { conversation: boolean }; notes: string[]; conversationTurns?: number };
    };
    assert.equal(plan.touches.conversation, false);
    assert.equal(plan.conversationTurns, undefined);
    assert.equal(
      plan.notes.some((n) => /captured no conversation/i.test(n)),
      true,
      `expected an honest note, got ${JSON.stringify(plan.notes)}`,
    );
  } finally {
    await srv.close();
    cleanupAll();
  }
});

test("scope 'both' really restores the conversation from the session store", async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  try {
    // A REAL session, created through the real route, so its chat lives on disk.
    const made = await postJson(srv.base, '/api/sessions', {});
    const created = await readJsonBody<{ id?: string; index?: { activeId: string } }>(made, 200);
    const session = created.id ?? created.index!.activeId;

    const twoTurns = {
      version: 1 as const,
      sessionId: session,
      turns: [
        { role: 'user', text: 'first question' },
        { role: 'assistant', text: 'first answer' },
      ],
    };
    const saved = await fetch(`${srv.base}/api/sessions/${encodeURIComponent(session)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat: twoTurns }),
    });
    assert.equal(saved.status, 200, `PUT session chat: ${saved.status}`);

    await writeThroughTurn(srv, session, 'a.txt', 'one\n');
    const cp = await postJson(srv.base, '/api/checkpoint', { sessionId: session });
    assert.equal(cp.status, 200);
    const { checkpoint } = (await cp.json()) as { checkpoint: { conversation?: { text: string }[] } };
    assert.equal(checkpoint.conversation?.length, 2);

    // The conversation grows, and the file changes.
    const grown = await fetch(`${srv.base}/api/sessions/${encodeURIComponent(session)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat: {
          ...twoTurns,
          turns: [...twoTurns.turns, { role: 'user', text: 'second question' }],
        },
      }),
    });
    assert.equal(grown.status, 200);
    await writeThroughTurn(srv, session, 'a.txt', 'two\n');

    const rw = await postJson(srv.base, '/api/checkpoint/restore', {
      sessionId: session,
      seq: 1,
      scope: 'both',
    });
    const body = await readJsonBody<{
      plan: { touches: { code: boolean; conversation: boolean }; conversationTurns?: number };
      applied: { conversationRestored: boolean };
    }>(rw, 200);
    assert.deepEqual(body.plan.touches, { code: true, conversation: true });
    assert.equal(body.plan.conversationTurns, 2);
    assert.equal(body.applied.conversationRestored, true);

    // BOTH halves are real: the file on disk, and the chat the server serves.
    assert.equal(onDisk(repo, 'a.txt'), 'one\n');
    const read = await fetch(`${srv.base}/api/sessions/${encodeURIComponent(session)}`);
    const after = (await read.json()) as { chat: { turns: { text: string }[] } };
    assert.deepEqual(
      after.chat.turns.map((t) => t.text),
      ['first question', 'first answer'],
    );
  } finally {
    await srv.close();
    cleanupAll();
  }
});

/* ============ refusals: nothing half-restored, nothing outside the jail === */

test('a missing snapshot blob refuses the WHOLE restore and writes nothing', async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  const session = 'session-0005';
  try {
    await writeThroughTurn(srv, session, 'a.txt', 'one\n');
    await writeThroughTurn(srv, session, 'b.txt', 'uno\n');
    const cp = await postJson(srv.base, '/api/checkpoint', { sessionId: session });
    assert.equal(cp.status, 200);
    await writeThroughTurn(srv, session, 'a.txt', 'two\n');
    await writeThroughTurn(srv, session, 'b.txt', 'dos\n');

    // Corrupt the store the way a stray `rm` would: delete one blob.
    const blobsDir = path.join(repo, '.sequence', 'checkpoints', session, 'blobs');
    const blobs = fs.readdirSync(blobsDir).filter((n) => /^[0-9a-f]{64}$/.test(n));
    assert.ok(blobs.length >= 2, 'the fixture must have produced at least two blobs');
    fs.rmSync(path.join(blobsDir, blobs[0]));

    const rw = await postJson(srv.base, '/api/checkpoint/restore', {
      sessionId: session,
      seq: 1,
      scope: 'code',
    });
    assert.equal(rw.status, 409);
    const body = (await rw.json()) as { plan: { unrecoverable: string[] }; error: string };
    assert.equal(body.plan.unrecoverable.length >= 1, true);

    // NOTHING was restored — not even the file whose blob survived.
    assert.equal(onDisk(repo, 'a.txt'), 'two\n');
    assert.equal(onDisk(repo, 'b.txt'), 'dos\n');
  } finally {
    await srv.close();
    cleanupAll();
  }
});

test('a traversal session id and an unknown checkpoint are refused, not resolved', async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  try {
    for (const bad of ['../../etc', 'a/b', 'has space', '', '.', 'x'.repeat(65)]) {
      const res = await postJson(srv.base, '/api/checkpoint', { sessionId: bad });
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    const missing = await postJson(srv.base, '/api/checkpoint/plan', {
      sessionId: 'session-0006',
      seq: 7,
      scope: 'both',
    });
    assert.equal(missing.status, 404);
  } finally {
    await srv.close();
    cleanupAll();
  }
});

test('a checkpoint may not widen the tracked set to a reserved path', async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  try {
    for (const bad of ['.sequence/ai.json', '../outside.txt', '.git/config']) {
      const res = await postJson(srv.base, '/api/checkpoint', {
        sessionId: 'session-0007',
        files: [bad],
      });
      assert.equal(res.status, 403, `expected 403 for ${JSON.stringify(bad)}`);
    }
  } finally {
    await srv.close();
    cleanupAll();
  }
});

/* ============ the cap is a cap on DISK, not only on the list ============== */

test(`the log keeps at most ${MAX_CHECKPOINTS} checkpoints and sweeps the blobs they held`, async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  const session = 'session-0008';
  try {
    // One more than the cap, each with distinct content so each mints a blob.
    for (let i = 0; i <= MAX_CHECKPOINTS; i += 1) {
      await writeThroughTurn(srv, session, 'a.txt', `revision ${i}\n`);
      const res = await postJson(srv.base, '/api/checkpoint', { sessionId: session, label: `t${i}` });
      assert.equal(res.status, 200);
    }
    const kept = listCheckpoints(repo, session);
    assert.equal(kept.length, MAX_CHECKPOINTS);
    // The ids did NOT restart: the oldest surviving seq is 2, so "restore #1"
    // cannot silently become somebody else's checkpoint.
    assert.equal(kept[0].seq, 2);
    assert.equal(kept[kept.length - 1].seq, MAX_CHECKPOINTS + 1);

    // And the pruned checkpoint's CONTENT is gone from disk too — a cap on the
    // list alone would leave an unbounded copy of the file in the repo.
    const blobsDir = path.join(repo, '.sequence', 'checkpoints', session, 'blobs');
    const blobs = fs.readdirSync(blobsDir).filter((n) => /^[0-9a-f]{64}$/.test(n));
    const live = new Set<string>();
    for (const c of kept) for (const f of c.files) if (f.blob) live.add(f.blob);
    // The baseline blob (a.txt before the session, which did not exist) adds
    // none, so every blob left on disk must be referenced by a live record.
    for (const b of blobs) {
      assert.equal(live.has(b), true, `blob ${b} survived with nothing referencing it`);
    }

    // A restore to a pruned id is an honest 404, not a wrong file.
    const gone = await postJson(srv.base, '/api/checkpoint/plan', {
      sessionId: session,
      seq: 1,
      scope: 'code',
    });
    assert.equal(gone.status, 404);
  } finally {
    await srv.close();
    cleanupAll();
  }
});

test('GET /api/checkpoints lists what the session took and what it has written', async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  const session = 'session-0009';
  try {
    await writeThroughTurn(srv, session, 'src/one.ts', 'a\n');
    await postJson(srv.base, '/api/checkpoint', { sessionId: session, label: 'first' });
    await writeThroughTurn(srv, session, 'src/two.ts', 'b\n');
    await postJson(srv.base, '/api/checkpoint', { sessionId: session, label: 'second' });

    const res = await fetch(`${srv.base}/api/checkpoints?sessionId=${session}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      checkpoints: { seq: number; label?: string; files: { path: string }[] }[];
      tracked: string[];
    };
    assert.deepEqual(
      body.checkpoints.map((c) => [c.seq, c.label]),
      [
        [1, 'first'],
        [2, 'second'],
      ],
    );
    // The first checkpoint knew about one file; the second about two.
    assert.deepEqual(body.checkpoints[0].files.map((f) => f.path), ['src/one.ts']);
    assert.deepEqual(body.checkpoints[1].files.map((f) => f.path).sort(), ['src/one.ts', 'src/two.ts']);
    assert.deepEqual(body.tracked.sort(), ['src/one.ts', 'src/two.ts']);
  } finally {
    await srv.close();
    cleanupAll();
  }
});

test('a PUT with no sessionId tracks nothing and creates no checkpoint directory', async () => {
  const repo = fixtureRepo();
  const srv = await startServer(repo);
  try {
    const res = await fetch(`${srv.base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'untracked.txt', content: 'hi\n' }),
    });
    assert.equal(res.status, 200);
    assert.equal(onDisk(repo, 'untracked.txt'), 'hi\n');
    assert.equal(
      fs.existsSync(path.join(repo, '.sequence', 'checkpoints')),
      false,
      'a pre-P10 caller must not grow a checkpoint store',
    );
  } finally {
    await srv.close();
    cleanupAll();
  }
});
