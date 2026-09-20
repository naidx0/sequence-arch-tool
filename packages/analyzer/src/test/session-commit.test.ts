import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createSession, headCommit, readSessionIndex } from '../server/sessionsStore.js';

/**
 * A SESSION PINS THE COMMIT, NOT THE BRANCH NAME.
 *
 * A branch is a NAME and it resolves to a different tree every hour. A session's
 * answers cite `path:line`, and auditing those later means resolving them
 * against the tree the agent was actually looking at.
 *
 * THE REASON IS THE PLAIN ONE, and an earlier version of this comment gave a
 * better story that turned out to be false. It claimed an audit had caught
 * citations drifting under churn; hand-labelling found **0 fabricated of 40**,
 * with 1 unknowable. Every apparent miss was the instrument — a regex matching
 * `ts` before `tsx`, and a package-name citation form that resolves once the
 * package name is kept.
 *
 * The field stands anyway, on the reason that needed no incident: `HEAD` is a
 * name, it resolves to a different tree every hour, and an audit run later
 * resolves at the wrong commit unless the SHA was written down at the time. The
 * third law (`docs/how-to-verify.md`) applied to provenance.
 */

const tmp = (name: string): string => fs.mkdtempSync(path.join(os.tmpdir(), `seq-${name}-`));

test('a session created in a git checkout records the SHA at HEAD', () => {
  const root = tmp('sess-git');
  /* A real ref layout, written by hand — no git binary, because the store must
     not need one and neither should its test. */
  fs.mkdirSync(path.join(root, '.git', 'refs', 'heads'), { recursive: true });
  const sha = 'a'.repeat(40);
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root, '.git', 'refs', 'heads', 'main'), `${sha}\n`);

  const { id } = createSession(root);
  const index = readSessionIndex(root);
  if (!index) throw new Error('createSession must leave a readable index behind');
  const entry = index.sessions.find((s) => s.id === id);
  if (!entry) throw new Error('the session it just created must be in the index');
  assert.equal(entry.commit, sha);
  assert.equal(entry.commitState, 'recorded');
});

test('a DETACHED head is the SHA itself', () => {
  const root = tmp('sess-detached');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const sha = 'b'.repeat(40);
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), `${sha}\n`);
  assert.deepStrictEqual(headCommit(root), { commit: sha, state: 'recorded' });
});

test('NO GIT and UNREADABLE are different answers, and neither is a blank', () => {
  /*
   * The second law, on this field. "Not a checkout" and "a checkout whose HEAD I
   * could not resolve" are different facts, and an absent value that meant both
   * would be a gap read as a fact.
   */
  const plain = tmp('sess-nogit');
  assert.deepStrictEqual(headCommit(plain), { state: 'no-git' });

  const broken = tmp('sess-broken');
  fs.mkdirSync(path.join(broken, '.git', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(broken, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  /* THE NUL-FILLED REF FILE. `.git/refs/heads/main` in this repository was once
     41 bytes of NUL after a OneDrive sync; a reader that trusted its contents
     would have pinned a session to garbage. */
  fs.writeFileSync(path.join(broken, '.git', 'refs', 'heads', 'main'), '\0'.repeat(41));
  assert.deepStrictEqual(headCommit(broken), { state: 'unreadable' });

  const missingRef = tmp('sess-packed');
  fs.mkdirSync(path.join(missingRef, '.git'), { recursive: true });
  fs.writeFileSync(path.join(missingRef, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  /* A packed ref: HEAD names a file that is not on disk. Unreadable, not a
     guess — resolving packed-refs is a second parser and a second way to be
     wrong about a commit. */
  assert.deepStrictEqual(headCommit(missingRef), { state: 'unreadable' });
});

test('a session in a non-checkout still records WHY, never a blank', () => {
  const root = tmp('sess-plain');
  const { id } = createSession(root);
  const index = readSessionIndex(root);
  if (!index) throw new Error('createSession must leave a readable index behind');
  const entry = index.sessions.find((s) => s.id === id);
  if (!entry) throw new Error('the session it just created must be in the index');
  assert.equal(entry.commit, undefined);
  assert.equal(entry.commitState, 'no-git', 'absence must carry its reason');
});
