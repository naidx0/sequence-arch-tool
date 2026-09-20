/**
 * WHICH CONVERSATION IS THIS ASK PART OF?
 *
 * I reported that `/ask` has no session identity and that lesson state could not
 * reach a user without a new request field and a client change. That was wrong,
 * and this test is the correction: `PUT /api/sessions/active` already persists
 * `SessionIndex.activeId`, and the ask handler simply never read it.
 *
 * What sent me wrong is a name: `sessionId` in `repoServer.ts` is the
 * AUTHENTICATED USER. The file warns about that collision in exactly one place;
 * I read the warning's neighbourhood and concluded the wrong thing anyway.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveAskThreadId } from '../server/askSession.js';
import { createSession, ensureSessionsMigrated, setActiveSession } from '../server/sessionsStore.js';

const withWorkspace = (fn: (root: string) => void): void => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-session-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('THE RED CASE: an ask with no id resolves to the workspace active session', () => {
  withWorkspace((root) => {
    ensureSessionsMigrated(root);
    const created = createSession(root, {});
    setActiveSession(root, created.index.activeId);

    const r = resolveAskThreadId(undefined, root);
    assert.equal(r.source, 'active');
    assert.equal(r.threadId, created.index.activeId);
    assert.ok(r.threadId, 'without this, lesson.json has no key and the lesson cannot exist');
  });
});

test('an id on the request wins over the active session', () => {
  /* Two windows share one active id, so the newer window would otherwise claim a
     turn typed in the older one. An explicit id is always preferred. */
  withWorkspace((root) => {
    ensureSessionsMigrated(root);
    const created = createSession(root, {});
    setActiveSession(root, created.index.activeId);
    const r = resolveAskThreadId('some-other-thread', root);
    assert.equal(r.source, 'request');
    assert.equal(r.threadId, 'some-other-thread');
  });
});

test('a traversal is refused, because this becomes a path segment', () => {
  /* `..` passes every "is it a non-empty string" check, and a lesson file is
     read and written under `sessions/<id>/`. */
  for (const bad of ['..', '.', '../../etc', 'a/b', '', '   ']) {
    const r = resolveAskThreadId(bad, null);
    assert.equal(r.threadId, undefined, `${JSON.stringify(bad)} must not become a path segment`);
  }
  assert.match(resolveAskThreadId('..', null).rejected ?? '', /not a usable thread id/);
});

test('a workspace file is not more trusted than a request', () => {
  /* A stored activeId gets the same check: on disk is not a provenance. */
  withWorkspace((root) => {
    ensureSessionsMigrated(root);
    const indexPath = path.join(root, '.sequence', 'sessions', 'index.json');
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    raw.activeId = '../escape';
    fs.writeFileSync(indexPath, JSON.stringify(raw));
    const r = resolveAskThreadId(undefined, root);
    assert.equal(r.threadId, undefined);
    assert.match(r.rejected ?? '', /stored activeId is not usable/);
  });
});

test('no workspace and no id is `none`, not an empty string', () => {
  /* "No conversation" and "a conversation called nothing" are different, and
     only one of them is safe to key a file by. */
  const r = resolveAskThreadId(undefined, null);
  assert.equal(r.source, 'none');
  assert.equal(r.threadId, undefined);
});

test('the handler wiring reads the thread and writes the lesson', async () => {
  /*
   * A source scan, because the ask handler needs a live server, a provider and a
   * scanned repo to exercise — and what this asserts is a WIRING claim: that the
   * identity is resolved on both sides of the turn, and that the write happens
   * before the answer goes out.
   *
   * The read side alone does nothing: with no lesson ever written, every turn
   * resolves a thread and finds an empty slot, which is exactly the state the
   * belt was in when `TeachTurnContext.concept` was read by the belt and written
   * by nobody.
   */
  const fsp = await import('node:fs');
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  /*
   * THE WIRING MOVED, and the scan follows it rather than being relaxed. The
   * lesson used to be assembled inline in `/api/ask`; it now lives in
   * `server/teachTurn.ts`, which BOTH ask routes call — because the stream
   * route, the one the web client drives, had none of it and no user turn ever
   * wrote a lesson. Which routes call it is asserted separately, per route, in
   * ask-teach-context-equivalence.test.ts.
   */
  const turn = fsp.readFileSync(path.resolve(here, '..', '..', 'src', 'server', 'teachTurn.ts'), 'utf8');
  assert.match(turn, /resolveAskThreadId\(/, 'the shared turn resolves a conversation');
  assert.match(turn, /readLesson\(/, 'and reads the lesson filed under it');
  assert.match(turn, /writeLesson\(/, 'and writes it back');

  const src = fsp.readFileSync(path.resolve(here, '..', '..', 'src', 'server', 'repoServer.ts'), 'utf8');
  const write = src.indexOf('askTurn.finish(');
  const payload = src.indexOf('const payload: Record<string, unknown> = { text: result.text }');
  assert.ok(write > 0 && payload > write, 'the lesson is written BEFORE the answer is assembled');
});

test('the lesson advances on the honest check, not on a question mark', async () => {
  const fsp = await import('node:fs');
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const src = fsp.readFileSync(path.resolve(here, '..', '..', 'src', 'server', 'teachTurn.ts'), 'utf8');
  /* Anchor on the write site: the grading has to be what decides the write, not
     merely present somewhere in the file. */
  const w = src.indexOf('writeLesson(');
  assert.ok(w > 0);
  /*
   * THE WINDOW IS THE `finish` BODY, not a byte count.
   *
   * This was `slice(w - 700, w)` and broke the moment a comment was added
   * between the grading and the write — the code was unchanged and correct, and
   * the test failed anyway. A fixed byte count measures how much prose sits
   * between two statements, which is not the property under test. The property
   * is that the grading is what decides the write, and that is "inside the same
   * function, before the call".
   */
  const body = src.lastIndexOf('finish: (', w);
  assert.ok(body > 0 && body < w, 'the write happens inside finish()');
  const window = src.slice(body, w);
  assert.match(window, /gradeCheckIn/, '15 of 31 closing questions were clarifying offers');
  assert.doesNotMatch(window, /endsWithQuestion/);
});

test('the product and the bench agree on what counts as a visual', async () => {
  /*
   * THE QUESTION THAT PROMPTED THIS: the bench calls `runAskPipeline` directly,
   * so it bypasses this handler entirely. That is fine for the BELT — it builds
   * the same `teachContext` — but the two disagreed about the ADVANCE RULE.
   *
   * The bench passes an observer and counts `chart:proposal`. This route does
   * not stream and passed no observer, so it could see a visual only as
   * `result.diagram` — and a turn that drew a chart advanced the lesson in the
   * bench and did not in the product. A bench measuring a more generous rule
   * than the product ships is measuring the wrong product.
   */
  const fsp = await import('node:fs');
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const src = fsp.readFileSync(path.resolve(here, '..', '..', 'src', 'server', 'repoServer.ts'), 'utf8');

  assert.match(src, /chartsThisTurn \+= 1/, 'the handler observes chart proposals');
  const turn = fsp.readFileSync(path.resolve(here, '..', '..', 'src', 'server', 'teachTurn.ts'), 'utf8');
  const w = turn.indexOf('writeLesson(');
  const body2 = turn.lastIndexOf('finish: (', w);
  assert.ok(body2 > 0 && body2 < w, 'the write happens inside finish()');
  const window = turn.slice(body2, w);
  assert.match(window, /chartsThisTurn > 0 \|\| diagram !== undefined/);

  const bench = fsp.readFileSync(
    path.resolve(here, '..', '..', '..', '..', 'tools', 'bench', 'teach-eval.mjs'),
    'utf8',
  );
  /*
   * And the bench advances on the SAME check the product does. It advanced on
   * `endsWithQuestion` once, so a turn closing with "would you like me to show
   * the diagram?" consumed a concept in the bench and did not in the product —
   * the two were measuring different lessons.
   *
   * WHAT THIS LOOKS FOR CHANGED 2026-09-06; WHAT IT GUARDS DID NOT. The rule
   * itself was re-ruled — a turn that taught and did not ask now advances,
   * because the coupling stalled the syllabus — and both callers were moved onto
   * ONE exported predicate. So the parity this test exists for is now enforced by
   * construction rather than by two expressions that happen to match, and
   * asserting the old literal would only assert that the ruling had not landed.
   *
   * The weaker form would have been to delete this. It is stronger instead:
   * neither side may compute the rule itself.
   */
  assert.match(bench, /taughtThisTurn\(\{/, 'the bench calls the shared predicate');
  assert.match(turn, /taughtThisTurn\(\{/, 'and so does the product');
  assert.doesNotMatch(bench, /passed: graded\.visual === true && graded\.endsWithQuestion/);
  assert.doesNotMatch(
    bench,
    /graded\.visual === true && graded\.endsWithCheck === true/,
    'the bench must not keep its own copy of the rule',
  );
});
