import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createSession, readSessionIndex, updateSession } from '../server/sessionsStore.js';
import { SEQUENCE_DIR, SESSIONS_INDEX_FILE } from '../server/store.js';

/**
 * FINDING F10 — pin-only patches must not touch `updatedAt`.
 *
 * `updateSession` bumped `updatedAt` on EVERY patch, so unpinning an old
 * session jumped it above newer ones in the newest-first list the sidebar
 * renders. A pin is not a conversation; only content (title, chat, meta,
 * board, mode, clone) makes a session "recently updated".
 */

function freshRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-sessions-pin-'));
}

test('updateSession: a pin-only patch does not bump updatedAt', () => {
  const repo = freshRepo();
  const older = createSession(repo);
  // A second, NEWER session — the one newest-first order should keep on top.
  const newer = createSession(repo);

  const before = readSessionIndex(repo)!;
  const olderBefore = before.sessions.find((s) => s.id === older.id)!.updatedAt;

  const after = updateSession(repo, older.id, { pinned: true })!;
  const entry = after.sessions.find((s) => s.id === older.id)!;
  assert.strictEqual(entry.pinned, true);
  assert.strictEqual(
    entry.updatedAt,
    olderBefore,
    'pinning bumped updatedAt and would jump the session above newer ones',
  );

  // And the newer session is still the most recently updated of the two.
  assert.ok(
    newer.index.sessions.find((s) => s.id === newer.id)!.updatedAt >=
      after.sessions.find((s) => s.id === older.id)!.updatedAt,
  );
});

test('updateSession: an unpin-only patch does not bump updatedAt either', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  updateSession(repo, made.id, { pinned: true });
  const pinnedAt = readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt;

  const after = updateSession(repo, made.id, { pinned: false })!;
  const entry = after.sessions.find((s) => s.id === made.id)!;
  assert.strictEqual(entry.pinned, undefined);
  assert.strictEqual(entry.updatedAt, pinnedAt, 'unpinning bumped updatedAt');
});

test('updateSession: a title rename does NOT bump updatedAt (click≠prompt)', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  const before = readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt;
  const after = updateSession(repo, made.id, { title: 'Renamed' })!;
  const entry = after.sessions.find((s) => s.id === made.id)!;
  assert.strictEqual(entry.title, 'Renamed');
  assert.strictEqual(entry.updatedAt, before, 'title-only rename must not bump timer');
});

test('updateSession: user prompt bumps updatedAt; identical chat re-PUT does not', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  const id = made.id;
  const chat = {
    version: 1 as const,
    sessionId: id,
    turns: [{ role: 'user', text: 'How does routing work?', at: '2026-01-01T00:00:00.000Z' }],
  };
  const afterPrompt = updateSession(repo, id, { chat })!;
  const bumped = afterPrompt.sessions.find((s) => s.id === id)!.updatedAt;
  const before = readSessionIndex(repo)!.sessions.find((s) => s.id === id)!.createdAt;
  assert.ok(bumped >= before);

  const afterReplay = updateSession(repo, id, { chat })!;
  assert.strictEqual(
    afterReplay.sessions.find((s) => s.id === id)!.updatedAt,
    bumped,
    'identical chat re-PUT (activate hydrate) must not bump',
  );
});

/**
 * OWNER 2026-09-02 — the SECOND report of the F10 defect, from the rail:
 * "it also only updates the time when the last activity was within the actual
 * thread, not the last time you opened it. Activity means any type of AI call
 * or tool call, or actual generation apart from just loading the memory of the
 * session in context."
 *
 * The reported shape: SessionsPanel flushes the staged board on every
 * `activate()` / `create()`, so OPENING a session re-PUT the identical
 * `boardSeqd` — and `updateSession` bumped on `typeof body.boardSeqd ===
 * 'string'` unconditionally. Same for `meta`, which is board-pointer UI state.
 */
const BOARD = JSON.stringify({ title: 'Payments flow.seqd', nodes: [] });

test('updateSession: re-PUT of the IDENTICAL boardSeqd (a switch) does not bump updatedAt', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  const id = made.id;

  const afterBoard = updateSession(repo, id, { boardSeqd: BOARD })!;
  const bumped = afterBoard.sessions.find((s) => s.id === id)!.updatedAt;

  // What activating the session does: flush the same staged board again.
  const afterSwitch = updateSession(repo, id, { boardSeqd: BOARD })!;
  assert.strictEqual(
    afterSwitch.sessions.find((s) => s.id === id)!.updatedAt,
    bumped,
    'opening a session re-flushed the identical board and stamped updatedAt',
  );
});

test('updateSession: a CHANGED boardSeqd is activity and does bump updatedAt', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  const id = made.id;
  const first = updateSession(repo, id, { boardSeqd: BOARD })!;
  const bumped = first.sessions.find((s) => s.id === id)!.updatedAt;

  const changed = JSON.stringify({ title: 'Payments flow.seqd', nodes: [{ id: 'n1' }] });
  const after = updateSession(repo, id, { boardSeqd: changed })!;
  assert.ok(
    after.sessions.find((s) => s.id === id)!.updatedAt > bumped,
    'a real board edit must still advance updatedAt',
  );
});

test('updateSession: a meta-only write does not bump updatedAt (pointer state, not a turn)', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  const id = made.id;
  const before = readSessionIndex(repo)!.sessions.find((s) => s.id === id)!.updatedAt;

  const after = updateSession(repo, id, {
    meta: { boardPath: 'docs/payments.seqd', boardFileName: 'payments.seqd', boardSource: 'file' },
  })!;
  assert.strictEqual(
    after.sessions.find((s) => s.id === id)!.updatedAt,
    before,
    'meta is where a board came from, not activity in the thread',
  );
});

/** Wall-clock gap so two entries cannot share an ISO millisecond. */
function tick(): void {
  const start = Date.now();
  while (Date.now() - start < 2) {
    /* spin — the store stamps in ms, and this test is about ORDER */
  }
}

test('sessions rail: an opened session must not sort above one that ran a turn', () => {
  const repo = freshRepo();
  const opened = createSession(repo);
  const ran = createSession(repo);

  // `opened` did real work once, long ago: it has a board on disk.
  updateSession(repo, opened.id, { boardSeqd: BOARD });
  const openedStamp = readSessionIndex(repo)!.sessions.find((s) => s.id === opened.id)!.updatedAt;
  tick();

  // `ran` then actually did work: a user prompt, and the board it drew.
  updateSession(repo, ran.id, {
    chat: {
      version: 1 as const,
      sessionId: ran.id,
      turns: [{ role: 'user', text: 'Draw the payments flow', at: '2026-01-01T00:00:00.000Z' }],
    },
  });
  updateSession(repo, ran.id, { boardSeqd: BOARD });
  tick();

  // Now the owner merely OPENS `opened`: hydrate re-PUTs the same board, and
  // the panel writes its pointer meta. No AI call, no tool call, no generation.
  updateSession(repo, opened.id, { boardSeqd: BOARD });
  updateSession(repo, opened.id, { meta: { boardSource: 'session' } });

  const index = readSessionIndex(repo)!;
  const openedNow = index.sessions.find((s) => s.id === opened.id)!.updatedAt;
  const ranNow = index.sessions.find((s) => s.id === ran.id)!.updatedAt;
  assert.strictEqual(openedNow, openedStamp, 'opening the session restamped it');
  assert.ok(
    ranNow > openedNow,
    `the session that ran a turn must sort above the one merely opened (ran=${ranNow}, opened=${openedNow})`,
  );
});

test('updateSession: a real edit NEVER stamps a row older than the row itself', () => {
  /*
   * THE LINUX-ONLY CI FAILURE, MADE PLATFORM-INDEPENDENT.
   *
   * `a CHANGED boardSeqd is activity` passed on Windows and failed on the
   * runner, and the PRODUCTION code was wrong, not the clock. The old guard
   * advanced one ms only when `now === entry.updatedAt`. So: edit one lands at
   * T, collides with createdAt, and is pushed to T+1; edit two's wall clock
   * still reads T, which is not EQUAL to T+1, so the guard stayed silent and
   * the row was stamped T — OLDER than the edit before it. The rail sorts on
   * updatedAt, so a burst of genuine edits could push a session DOWN the list,
   * which is the mis-sorting the owner reported on 2026-09-02.
   *
   * A BURST OF EDITS IS THE WRONG LOCK. It only collides on a machine fast
   * enough to stay inside one millisecond — it reproduces on Linux and passes
   * on Windows even with the fix reverted, which is a test that lies on the
   * machine the work is done on.
   *
   * The real precondition is not speed, it is `updatedAt` being AHEAD of the
   * wall clock — which the +1ms push itself creates, and which a clock step, a
   * OneDrive sync or a restored file produce just as well. Write that state
   * directly and the bug is deterministic everywhere.
   */
  const repo = freshRepo();
  const id = createSession(repo).id;

  /* Named from the store's own constants — a hardcoded '.sequence/sessions.json'
     was wrong (the index lives at sessions/index.json) and failed as ENOENT. */
  const indexPath = path.join(repo, SEQUENCE_DIR, SESSIONS_INDEX_FILE);
  const doc = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
    sessions: Array<{ id: string; updatedAt: string }>;
  };
  /* One minute ahead — far enough that no wall clock catches up mid-test. */
  const ahead = new Date(Date.now() + 60_000).toISOString();
  doc.sessions.find((s) => s.id === id)!.updatedAt = ahead;
  fs.writeFileSync(indexPath, JSON.stringify(doc), 'utf8');

  const changed = JSON.stringify({ title: 'Payments flow.seqd', nodes: [{ id: 'n1' }] });
  const after = updateSession(repo, id, { boardSeqd: changed })!;
  const stamped = after.sessions.find((s) => s.id === id)!.updatedAt;

  assert.ok(
    stamped > ahead,
    `a real edit stamped ${stamped}, which is not after the row's own ${ahead} — ` +
      'the rail clock ran backwards and the session sorts DOWN the list',
  );
});
