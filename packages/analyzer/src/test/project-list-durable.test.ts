/**
 * "AFTER OPENING A NEW PROJECT, MY OTHER ONE'S GONE."
 *
 * Owner walk, 2026-09-21: "I click again, ML max, and it gets rid of the T3
 * code. I don't know where T3 code is. That one's gone ... This should only
 * add, it should add to the side rail. It shouldn't substitute different ones."
 *
 * Driving the real dialog could not reproduce it — all four projects survived
 * every attach. The reason is that the loss does not happen on the attach a
 * person watches; it happens on an attach where a DIFFERENT entry in the list
 * happened to be unreachable at that moment, and nothing on screen refers to
 * that entry at all.
 *
 * The mechanism was `addRecent` building the next file out of `readRecent`.
 * `readRecent` prunes any entry whose `statSync` does not come back a
 * directory — correct for a list you are about to DISPLAY, fatal for one you
 * are about to WRITE. A read that drops is a filter on the way out and a delete
 * on the way back in.
 *
 * His projects live under OneDrive, where a dehydrated folder can fail a stat
 * while being entirely present. So: attach one project, and any other whose
 * folder was briefly unreadable is erased from `recent.json` — permanently, and
 * with nothing anywhere having said so.
 *
 * These tests are built from that shape rather than from the shape that was
 * convenient: an entry that cannot be stat'd at the moment of a write must
 * still be in the file afterwards, and must come back the moment it can be
 * reached again.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { addRecent, readRecent, readRecentRaw, removeRecent } from '../server/store.js';

function freshStore(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-projects-'));
}

function freshDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sequence-${name}-`));
  return dir;
}

test('attaching one project does not erase another that is briefly unreachable', () => {
  const store = freshStore();

  /*
   * TWO PROJECTS, exactly as his rail had them. `t3code` is real to begin with,
   * because a project he has been working in is real — the point is what
   * happens to it later, not whether he ever had it.
   */
  const t3code = freshDir('t3code');
  const mlHarness = freshDir('ml-harness');
  addRecent(store, t3code);
  assert.deepStrictEqual(readRecentRaw(store), [t3code]);

  /*
   * NOW IT GOES DEHYDRATED. Under OneDrive this is a folder that is still his,
   * still listed in Explorer, and still fails a `statSync` — so for this test
   * the folder simply is not there for a moment. That is the same fact from the
   * filesystem's point of view, and it is the fact `readRecent` acted on.
   */
  fs.rmSync(t3code, { recursive: true, force: true });

  /* He opens ML Harness. He does nothing whatsoever to t3code. */
  addRecent(store, mlHarness);

  assert.ok(
    readRecentRaw(store).includes(t3code),
    'attaching ml-harness must not remove t3code from the file — he never asked for that',
  );
  assert.deepStrictEqual(
    readRecentRaw(store),
    [mlHarness, t3code],
    'the new project is added in front; the existing one keeps its place behind it',
  );
});

test('an unreachable project is hidden from the rail, not deleted, and returns', () => {
  const store = freshStore();
  const project = freshDir('t3code');
  addRecent(store, project);

  fs.rmSync(project, { recursive: true, force: true });

  /*
   * THE VIEW DECLINES TO LIST IT. This is right: a rail section pointing at a
   * folder that cannot be opened is a control that fails when pressed.
   */
  assert.deepStrictEqual(readRecent(store), [], 'the rail does not offer what it cannot open');

  /* THE LIST STILL HOLDS IT. This is the part that was missing. */
  assert.deepStrictEqual(
    readRecentRaw(store),
    [project],
    'being unreachable is a fact about right now, not a decision about membership',
  );

  /* OneDrive rehydrates it / the drive reconnects / he plugs the disk back in. */
  fs.mkdirSync(project, { recursive: true });

  assert.deepStrictEqual(
    readRecent(store),
    [project],
    'the moment it can be reached, it is his project again — no re-adding, no re-finding',
  );
});

test('the list holds far more projects than the ten it used to', () => {
  const store = freshStore();

  /*
   * The old `MAX_RECENT` of 10 was a sensible bound on a "recent files" menu
   * and an arbitrary one on "the projects in my workspace" — the eleventh
   * project silently evicted the first. Twelve is past the old edge and small
   * enough to stay a fast test; the bound that remains is a runaway guard.
   */
  const dirs = Array.from({ length: 12 }, (_, i) => freshDir(`p${i}`));
  for (const d of dirs) addRecent(store, d);

  const held = readRecentRaw(store);
  assert.strictEqual(held.length, 12, 'no project falls off the end at eleven');
  for (const d of dirs) assert.ok(held.includes(d), `${path.basename(d)} is still in the list`);
});

test('removing a project edits the list and leaves the folder alone', () => {
  const store = freshStore();
  const keep = freshDir('sequence');
  const drop = freshDir('scratch');
  addRecent(store, keep);
  addRecent(store, drop);

  const left = removeRecent(store, drop);

  assert.deepStrictEqual(left, [keep], 'the removed project is out of the list');
  assert.deepStrictEqual(readRecentRaw(store), [keep], 'and out of the file, not just the return');

  /*
   * "Just delete it from that workspace" — his words, and the word he used was
   * delete. The folder is untouched, and any surface that offers this owes him
   * wording that makes that unmistakable before he presses it.
   */
  assert.ok(fs.existsSync(drop), 'removing a project from the workspace does not touch the folder');
});

test('a re-attached project moves to the front without being duplicated', () => {
  const store = freshStore();
  const a = freshDir('a');
  const b = freshDir('b');
  addRecent(store, a);
  addRecent(store, b);

  addRecent(store, a);

  assert.deepStrictEqual(
    readRecentRaw(store),
    [a, b],
    'order still follows the most recent attach — that part was never the problem',
  );
});
