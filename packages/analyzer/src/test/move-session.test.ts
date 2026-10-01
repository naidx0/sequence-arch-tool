/**
 * A CHAT CAN BE FILED UNDER A DIFFERENT PROJECT.
 *
 * Owner, 2026-09-21: "each project has chats under it that refer to it in
 * specific ... from there you can fork chats, move chats, delete chats, etc."
 *
 * The ordinary case is a conversation that started in the workspace and turned
 * out to be about a repository. Its transcript, canvas and board go with it.
 *
 * ── WHAT THESE LOCK, AND WHY IT IS THE ORDER ──────────────────────────────
 *
 * `moveSession` copies, reads the copy back, and only then removes the source.
 * Every other order has a window in which the only copy of a transcript is the
 * one that did not survive. So the cases below care less about the happy path
 * than about every way the move can fail: in all of them the chat must still be
 * in the project it started in, whole.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createSession,
  moveSession,
  readSessionChat,
  readSessionIndex,
} from '../server/sessionsStore.js';
import { SESSIONS_INDEX_FILE } from '../server/store.js';

function freshRepo(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sequence-${name}-`));
}

/** A chat with something in it, so "the transcript moved" can be checked. */
function seed(repo: string, text: string): string {
  const { index } = createSession(repo);
  const id = index.activeId;
  const dir = path.join(repo, '.sequence', 'sessions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'chat.json'),
    JSON.stringify({ version: 1, sessionId: id, turns: [{ role: 'user', text, at: 1 }] }),
  );
  fs.writeFileSync(path.join(dir, 'board.seqd'), JSON.stringify({ nodes: [], edges: [] }));
  return id;
}

test('the chat, its transcript and everything beside it arrive in the new project', () => {
  const from = freshRepo('from');
  const to = freshRepo('to');
  const id = seed(from, 'why is the gateway hot?');

  const moved = moveSession(from, to, id);
  assert.ok(moved, 'the move reported success');

  /* IT IS THERE, with its words. */
  assert.ok(
    moved.to.sessions.some((s) => s.id === id),
    'the target project lists it',
  );
  assert.strictEqual(readSessionChat(to, id).turns[0]?.text, 'why is the gateway hot?');
  assert.ok(
    fs.existsSync(path.join(to, '.sequence', 'sessions', id, 'board.seqd')),
    'the board came too — a chat is not only its transcript',
  );

  /* AND THE ID IS THE SAME. It names a directory, not a position, and every
     reference the transcript holds to itself would break if it changed. */
  assert.strictEqual(moved.to.sessions.find((s) => s.id === id)?.id, id);

  /* IT IS NO LONGER IN THE OLD ONE. */
  assert.ok(!fs.existsSync(path.join(from, '.sequence', 'sessions', id)));
  assert.ok(!(readSessionIndex(from)?.sessions ?? []).some((s) => s.id === id));
});

test('the moved chat becomes the target project s active one', () => {
  const from = freshRepo('from');
  const to = freshRepo('to');
  seed(to, 'something already here');
  const id = seed(from, 'the one being moved');

  const moved = moveSession(from, to, id);

  /* A person who moves a conversation is going TO it, not filing it away. */
  assert.strictEqual(moved?.to.activeId, id);
});

test('moving into the project it is already in changes nothing', () => {
  const repo = freshRepo('same');
  const id = seed(repo, 'stay put');

  assert.strictEqual(moveSession(repo, repo, id), null, 'refused rather than performed');

  /*
   * THE REASON THIS CASE EXISTS. `moveSession` ends by deleting the source, so
   * a same-repo "move" that ran would copy a directory onto itself and then
   * delete it — the transcript gone, and the operation having reported success.
   */
  assert.strictEqual(readSessionChat(repo, id).turns[0]?.text, 'stay put');
  assert.ok((readSessionIndex(repo)?.sessions ?? []).some((s) => s.id === id));
});

test('a chat that is not in the source project is refused', () => {
  const from = freshRepo('from');
  const to = freshRepo('to');
  seed(from, 'a real one');

  assert.strictEqual(moveSession(from, to, 'session-that-never-existed'), null);
  assert.strictEqual(readSessionIndex(to)?.sessions.length ?? 0, 0, 'nothing was invented');
});

test('an id already taken at the destination is refused, not overwritten', () => {
  const from = freshRepo('from');
  const to = freshRepo('to');
  const id = seed(from, 'the one being moved');

  /*
   * Forge the collision: the same id, already holding a different chat.
   *
   * WRITTEN THROUGH THE STORE'S OWN CONSTANT. The first draft of this wrote
   * `.sequence/sessions.json`, which is not where the index lives —
   * `SESSIONS_INDEX_FILE` is `sessions/index.json` — so the forged state was
   * never read, `moveSession` saw an empty target, and the case failed while
   * the product was correct. The instrument, not the subject.
   */
  const targetIndex = {
    version: 1,
    activeId: id,
    sessions: [
      {
        id,
        title: 'a different conversation',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  };
  fs.mkdirSync(path.join(to, '.sequence', 'sessions', id), { recursive: true });
  fs.writeFileSync(path.join(to, '.sequence', SESSIONS_INDEX_FILE), JSON.stringify(targetIndex));
  fs.writeFileSync(
    path.join(to, '.sequence', 'sessions', id, 'chat.json'),
    JSON.stringify({ version: 1, sessionId: id, turns: [{ role: 'user', text: 'do not lose me', at: 1 }] }),
  );

  assert.strictEqual(moveSession(from, to, id), null, 'refused');

  /*
   * BOTH SURVIVE. Overwriting is the one outcome here that destroys a
   * transcript nobody asked about — the person moving a chat has never heard
   * of the one already sitting at that id.
   */
  assert.strictEqual(readSessionChat(to, id).turns[0]?.text, 'do not lose me');
  assert.strictEqual(readSessionChat(from, id).turns[0]?.text, 'the one being moved');
});
