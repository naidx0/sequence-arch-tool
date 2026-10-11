import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ArchGraph } from '@sequence/schema';
import { beginTeachTurn } from '../server/teachTurn.js';

/**
 * WHERE DOES A TEACH TURN'S LESSON GO WHEN THE CLIENT NAMES NO THREAD?
 *
 * The card-free reproduction of what the 2026-09-06 seat read found, designed in
 * `docs/research/design-instruments-after-the-window.md` before it was written.
 *
 * The seat drove a real teach turn — its work list opens with
 * `{"id":"step:teach-mode","status":"done","verb":"Taught this as a lesson"}` —
 * and the session it was displaying, `session-2999`, ended with `chat.json`,
 * `canvas.json` (`charts: 0`) and NO `lesson.json`. With no lesson there is no
 * concept, so no chart is derived, so no check-in is derived, and the model
 * closed with "Does this make sense so far?" — a clarifying question the teach
 * contract bans. Three reported differences, one absence.
 *
 * `packages/web2` sends no `threadId` on an ask, so `resolveAskThreadId` falls
 * back to `index.activeId`. On disk at the time, `activeId` was `session-3391`
 * while the conversation on screen was `session-2999`.
 *
 * These cases ask what that does, with no model and no server: they call the
 * product's own `beginTeachTurn` and its `finish`, and look at where the file
 * lands. Whatever they show is the behaviour — the hypothesis is not assumed
 * anywhere below, and the assertions are written to record what happens rather
 * than to confirm what I expected.
 */
const graph = {
  nodes: [
    { id: 'file:a.ts', label: 'a.ts', kind: 'file', path: 'a.ts' },
    { id: 'file:b.ts', label: 'b.ts', kind: 'file', path: 'b.ts' },
  ],
  edges: [
    { id: 'e1', srcId: 'file:a.ts', dstId: 'file:b.ts', kind: 'import', confidence: 1, origin: 'deterministic' },
  ],
} as unknown as Pick<ArchGraph, 'nodes' | 'edges'>;

const ASK = 'Teach me how a.ts works.';

/*
 * THE ROOT IS THE REPO ROOT, NOT THE SESSIONS DIRECTORY, and the first version of
 * this file got that wrong — it passed `<tmp>/sessions` where `readLesson` and
 * `writeLesson` expect the repo root and build `.sequence/sessions/<id>/…`
 * beneath it themselves. The CONTROL case failed as a result, which is the only
 * reason the mistake was caught: a harness whose control fails is a harness, not
 * a finding, and had the control been omitted this file would have "reproduced"
 * a defect that was mine.
 */
function workspace(index: unknown, sessions: readonly string[]): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-thread-'));
  const sess = path.join(repoRoot, '.sequence', 'sessions');
  fs.mkdirSync(sess, { recursive: true });
  for (const id of sessions) fs.mkdirSync(path.join(sess, id), { recursive: true });
  /*
   * VERSION 1 OR readSessionIndex REJECTS IT. The first version of this harness
   * omitted it, the index was read as undefined, the resolver answered "none",
   * and the case "reproduced" a defect that was the harness. Third artifact in
   * this file: the root was wrong, the index shape was wrong, and only the
   * CONTROL case caught either.
   */
  if (index !== undefined) {
    fs.writeFileSync(path.join(sess, 'index.json'), JSON.stringify(index));
  }
  return repoRoot;
}

const lessonAt = (repoRoot: string, id: string): boolean =>
  fs.existsSync(path.join(repoRoot, '.sequence', 'sessions', id, 'lesson.json'));

const runTurn = (repoRoot: string, threadIdFromRequest: unknown): void => {
  const turn = beginTeachTurn({
    teach: true,
    question: ASK,
    threadIdFromRequest,
    sessionsRoot: repoRoot,
    graph,
  });
  turn.finish({ text: 'some prose about a.ts', chartsThisTurn: 1 });
};

test('FIXED: with no requested thread, no lesson is filed against the merely-active session', () => {
  /*
   * The seat's exact shape: the conversation on screen is `on-screen`, the index
   * says the active session is `elsewhere`, and the client sends no threadId.
   */
  const root = workspace({ version: 1, activeId: 'elsewhere', sessions: [{ id: 'on-screen' }, { id: 'elsewhere' }] }, [
    'on-screen',
    'elsewhere',
  ]);
  try {
    runTurn(root, undefined);
    const onScreen = lessonAt(root, 'on-screen');
    const elsewhereHasIt = lessonAt(root, 'elsewhere');
    /*
     * THE DEFECT, STATED AS AN ASSERTION SO IT CANNOT BE LOST. The lesson is
     * written against the index's active session, and the session the person is
     * looking at gets none — which is precisely what the seat saw. If a future
     * change makes this fail, the defect is fixed and this case should be
     * rewritten to assert the fix, not deleted.
     */
    /*
     * FLIPPED BY THE FIX. Before it, this asserted the defect:
     *
     *   onScreen === false      the displayed session got no lesson
     *   elsewhereHasIt === true the lesson landed on index.activeId instead
     *
     * A lesson filed against a conversation the person was not having is a false
     * record of what they were taught, and it is worse than none: a missing
     * lesson is recoverable and a misfiled one is not visible at all. So the fix
     * refuses to guess, and NEITHER session gets a lesson when no thread was
     * named. The turn still answers; only the lesson is withheld.
     */
    assert.strictEqual(elsewhereHasIt, false, 'no lesson is filed against the merely-active session');
    assert.strictEqual(onScreen, false, 'and none is invented for the displayed one either');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('REPRODUCTION: with no requested thread and no usable activeId, no lesson is written at all', () => {
  /*
   * The other half of the same cause. `resolveAskThreadId` returns
   * `{ source: 'none' }`, `beginTeachTurn` has no thread, `lesson` is undefined,
   * and `finish()` returns before writing. The turn still answers — which is why
   * this is invisible from the seat of the person asking.
   */
  const root = workspace({ version: 1, sessions: [{ id: 'on-screen' }] }, ['on-screen']);
  try {
    runTurn(root, undefined);
    assert.strictEqual(lessonAt(root, 'on-screen'), false, 'no lesson anywhere');
    const sessDir = path.join(root, '.sequence', 'sessions');
    const written = fs
      .readdirSync(sessDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) => fs.existsSync(path.join(sessDir, d.name, 'lesson.json')));
    assert.deepStrictEqual(written, [], 'and none was written to any other session either');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CONTROL: naming the thread explicitly writes the lesson where the caller meant', () => {
  /*
   * The half that proves the two cases above are about thread RESOLUTION and not
   * about lessons being broken. Every session on disk that holds a lesson today
   * was created with an explicit thread id — `live-check-69`, `seat-4173`,
   * `brief-rerun` — and this is why.
   */
  const root = workspace({ version: 1, activeId: 'elsewhere', sessions: [{ id: 'on-screen' }, { id: 'elsewhere' }] }, [
    'on-screen',
    'elsewhere',
  ]);
  try {
    runTurn(root, 'on-screen');
    assert.strictEqual(lessonAt(root, 'on-screen'), true, 'the named session gets its lesson');
    assert.strictEqual(lessonAt(root, 'elsewhere'), false, 'and the active one is left alone');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a traversal-shaped thread id is refused rather than resolved', () => {
  /*
   * Not part of the reproduction, but it shares the resolver and the resolver is
   * now under test: the id becomes a path segment under `sessions/`, and `..`
   * passes every "is it a non-empty string" check.
   */
  const root = workspace({ version: 1, activeId: 'on-screen', sessions: [] }, []);
  try {
    runTurn(root, '../escaped');
    assert.ok(
      !fs.existsSync(path.join(root, '.sequence', 'escaped')),
      'nothing escaped the sessions root',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
