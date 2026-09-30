/**
 * THE CLIENT REMEMBERS WHERE IT WAS.
 *
 * Owner, 2026-09-21: "there should be client wide memory, remember the last
 * prompt, project, folder, mode, everything, in workspaces, sometimes across
 * different projects."
 *
 * The desktop shell opened on nothing, every time — `controller.start()` with
 * no argument and a comment saying "no-repo start → the web app's home screen
 * takes over". The project LIST survived (that is `recent.json`), so the rail
 * came back holding four projects with none of them open, and every launch put
 * him at the beginning of a workspace he had been working in.
 *
 * ── WHY MERGING IS THE PROPERTY WORTH LOCKING ─────────────────────────────
 *
 * The three facts are learned at different moments by different callers: a
 * repository on attach, a chat when one is opened, a mode when it is switched.
 * A write that replaced the record would mean whichever fired last erased the
 * other two, and the symptom — "it remembers the project but not the mode" —
 * would look like a missing feature rather than a clobber.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LAST_PLACE_FILE, readLastPlace, writeLastPlace } from '../server/lastPlace.js';

function freshStore(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-place-'));
}

function freshRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-proj-'));
}

test('nothing recorded is an empty place, not a failure', () => {
  const store = freshStore();
  /* A launch must never depend on this: the whole record is a convenience, and
     the correct outcome for a missing one is the home screen. */
  assert.deepStrictEqual(readLastPlace(store), {});
});

test('each fact is learned separately and none erases the others', () => {
  const store = freshStore();
  const repo = freshRepo();

  writeLastPlace(store, { repo });
  writeLastPlace(store, { sessionId: 'session-42' });
  writeLastPlace(store, { mode: 'build' });

  const place = readLastPlace(store);
  assert.strictEqual(place.repo, repo);
  assert.strictEqual(place.sessionId, 'session-42');
  assert.strictEqual(place.mode, 'build');
  assert.match(String(place.at), /^\d{4}-\d{2}-\d{2}T/, 'stamped, so staleness is visible');
});

test('null forgets one fact without forgetting the rest', () => {
  const store = freshStore();
  const repo = freshRepo();
  writeLastPlace(store, { repo, sessionId: 'session-42', mode: 'build' });

  /* What a DETACH says: no repository now, and the mode is still his. */
  writeLastPlace(store, { repo: null });

  const place = readLastPlace(store);
  assert.strictEqual(place.repo, undefined);
  assert.strictEqual(place.mode, 'build', 'detaching is not a reason to forget the mode');
  assert.strictEqual(place.sessionId, 'session-42');
});

test('a project that has since moved is not somewhere to open', () => {
  const store = freshStore();
  const repo = freshRepo();
  writeLastPlace(store, { repo, mode: 'plan' });

  fs.rmSync(repo, { recursive: true, force: true });

  /*
   * THE ONE FIELD WITH A CORRECTNESS CONSEQUENCE. The shell starts the engine
   * on this path; a folder he has since moved or deleted would fail the whole
   * launch in order to honour a memory. The rest of the record survives — the
   * mode is still true.
   */
  const place = readLastPlace(store);
  assert.strictEqual(place.repo, undefined, 'a vanished folder is not a place');
  assert.strictEqual(place.mode, 'plan');
});

test('a malformed file reads as empty rather than throwing', () => {
  const store = freshStore();
  fs.mkdirSync(store, { recursive: true });
  for (const junk of ['not json', '[]', 'null', '{"repo": 7}']) {
    fs.writeFileSync(path.join(store, LAST_PLACE_FILE), junk);
    assert.deepStrictEqual(
      readLastPlace(store).repo,
      undefined,
      `${junk} must not become a repository path`,
    );
  }
});

test('a relative path is refused — the shell spawns on this', () => {
  const store = freshStore();
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(
    path.join(store, LAST_PLACE_FILE),
    JSON.stringify({ repo: path.join('..', '..', 'somewhere') }),
  );
  assert.strictEqual(readLastPlace(store).repo, undefined);
});
