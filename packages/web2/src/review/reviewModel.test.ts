import { describe, expect, it } from 'vitest';

import {
  acceptPlan,
  commentSteer,
  emptyReview,
  pendingComments,
  reviewReduce,
  stagedPaths,
  type ReviewState,
} from './reviewModel';

/* ══════════════════════════════════════════════════════════════════════════
   ITEMS 5.2 AND 5.3 — THE PURE HALF, WHICH IS WHERE "ONLY THAT PATH" IS TRUE.

   The Wave 5 lock is "accepting one file of three writes only that path". That
   sentence has two halves and they fail differently:

     · the DECISION half — which paths does an Accept intend to write — is pure
       arithmetic over a list, and it is tested here;
     · the WIRE half — does the client actually issue one PUT and not three —
       is tested in ReviewPane.test.tsx against a recording fetch, because a
       correct plan handed to a loop that writes `state.files` instead of
       `plan` is exactly the shape of defect a pure test cannot see.

   Both are required. CANON §6: "This project has twice shipped a test asserting
   that a dispatch landed while the button opened nothing."
   ══════════════════════════════════════════════════════════════════════════ */

/** Three proposed files, the shape `edit:proposal` delivers them in. */
const THREE = emptyReviewWith();

function emptyReviewWith(): ReviewState {
  return reviewReduce(emptyReview(), {
    type: 'proposal/load',
    proposalId: 'turn-1:p1',
    title: 'Harden the token check',
      rationale: null,
    files: [
      { path: 'packages/analyzer/src/auth.ts', content: 'a\n' },
      { path: 'packages/schema/src/token.ts', content: 'b\n' },
      { path: 'packages/web2/src/app/App.tsx', content: 'c\n' },
    ],
  });
}

describe('item 5.2 — per-file decisions', () => {
  it('starts every proposed file pending, and nothing staged', () => {
    expect(THREE.files.map((f) => f.decision)).toEqual(['pending', 'pending', 'pending']);
    expect(stagedPaths(THREE)).toEqual([]);
    expect(THREE.scope).toBe('last-turn');
  });

  it('decides ONE file and leaves the other two alone', () => {
    const next = reviewReduce(THREE, {
      type: 'file/decide',
      path: 'packages/schema/src/token.ts',
      decision: 'accepted',
    });
    expect(next.files.map((f) => [f.path, f.decision])).toEqual([
      ['packages/analyzer/src/auth.ts', 'pending'],
      ['packages/schema/src/token.ts', 'accepted'],
      ['packages/web2/src/app/App.tsx', 'pending'],
    ]);
  });

  it('plans a write for the accepted file ONLY — the lock, in its pure form', () => {
    const next = reviewReduce(THREE, {
      type: 'file/decide',
      path: 'packages/schema/src/token.ts',
      decision: 'accepted',
    });
    expect(acceptPlan(next)).toEqual([{ path: 'packages/schema/src/token.ts', content: 'b\n' }]);
  });

  it('plans nothing at all when every file is rejected', () => {
    let state = THREE;
    for (const f of THREE.files) {
      state = reviewReduce(state, { type: 'file/decide', path: f.path, decision: 'rejected' });
    }
    expect(acceptPlan(state)).toEqual([]);
  });

  it('refuses to plan a write for a file with no content — it cannot invent one', () => {
    /* A git-scope file has a diff and no `content`: there is nothing to write,
       because the change is already on disk. If such a file could reach the
       accept plan, Accept would PUT `undefined` and truncate the file. */
    const git = reviewReduce(emptyReview(), {
      type: 'git/status',
      branch: 'main',
      files: [{ path: 'x.ts', status: 'modified' }],
    });
    const decided = reviewReduce(git, { type: 'file/decide', path: 'x.ts', decision: 'accepted' });
    expect(acceptPlan(decided)).toEqual([]);
  });
});

describe('item 5.2 — selective staging', () => {
  it('stages only what was checked, in the file order git reported', () => {
    let state = reviewReduce(emptyReview(), {
      type: 'git/status',
      branch: 'main',
      files: [
        { path: 'a.ts', status: 'modified' },
        { path: 'b.ts', status: 'untracked' },
        { path: 'c.ts', status: 'modified' },
      ],
    });
    state = reviewReduce(state, { type: 'file/stage', path: 'c.ts', staged: true });
    state = reviewReduce(state, { type: 'file/stage', path: 'a.ts', staged: true });
    /* This array IS the `paths` body of POST /api/git/commit. Order comes from
       the status listing, not from click order, so two people who checked the
       same three files produce the same request. */
    expect(stagedPaths(state)).toEqual(['a.ts', 'c.ts']);
  });

  it('unstages a file that is then rejected — you cannot commit what you refused', () => {
    let state = reviewReduce(emptyReview(), {
      type: 'git/status',
      branch: 'main',
      files: [{ path: 'a.ts', status: 'modified' }],
    });
    state = reviewReduce(state, { type: 'file/stage', path: 'a.ts', staged: true });
    state = reviewReduce(state, { type: 'file/decide', path: 'a.ts', decision: 'rejected' });
    expect(stagedPaths(state)).toEqual([]);
  });
});

describe('item 5.1 — diffs arrive per file, out of order, and one cannot clobber another', () => {
  const base = reviewReduce(emptyReview(), {
    type: 'git/status',
    branch: 'main',
    files: [
      { path: 'a.ts', status: 'modified' },
      { path: 'b.ts', status: 'modified' },
    ],
  });

  const DIFF_A = ['--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');

  it('parses a loaded diff onto the file it belongs to and no other', () => {
    let state = reviewReduce(base, { type: 'diff/loading', path: 'a.ts' });
    state = reviewReduce(state, { type: 'diff/loading', path: 'b.ts' });
    state = reviewReduce(state, { type: 'diff/loaded', path: 'a.ts', text: DIFF_A });

    const [a, b] = state.files;
    expect(a.diffState).toBe('ready');
    expect(a.diff?.added).toBe(1);
    expect(b.diffState).toBe('loading');
    expect(b.diff).toBe(null);
  });

  it('calls an empty diff EMPTY rather than a ready diff with no hunks', () => {
    /* The route documents an empty body for an untracked file. "Ready, zero
       hunks" renders as an expanded file showing nothing, which reads as a bug
       in the viewer; "empty" renders a sentence saying why. */
    const state = reviewReduce(base, { type: 'diff/loaded', path: 'a.ts', text: '' });
    expect(state.files[0].diffState).toBe('empty');
  });

  it('keeps a failure attached to its own file, with the message the wire gave', () => {
    const state = reviewReduce(base, {
      type: 'diff/failed',
      path: 'b.ts',
      message: 'path targets a reserved git-internal path',
    });
    expect(state.files[1].diffState).toBe('failed');
    expect(state.files[1].failure).toBe('path targets a reserved git-internal path');
    expect(state.files[0].diffState).toBe('idle');
  });

  it('ignores a diff for a path that is not in the list', () => {
    /* A scope change while a request is in flight: the response arrives for a
       file the surface is no longer showing. Appending it would put a file on
       screen that the current scope never listed. */
    const state = reviewReduce(base, { type: 'diff/loaded', path: 'ghost.ts', text: DIFF_A });
    expect(state.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
  });
});

describe('item 5.4 — changing scope', () => {
  it('drops the previous scope’s files rather than relabelling them', () => {
    const next = reviewReduce(THREE, { type: 'scope/set', scope: 'unstaged' });
    expect(next.scope).toBe('unstaged');
    expect(next.files).toEqual([]);
    expect(next.branch).toBe(null);
  });

  it('is a no-op when the scope is already the one asked for', () => {
    const same = reviewReduce(THREE, { type: 'scope/set', scope: 'last-turn' });
    expect(same).toBe(THREE);
  });
});

describe('item 5.3 — line-anchored comments', () => {
  const withComment = reviewReduce(THREE, {
    type: 'comment/add',
    path: 'packages/schema/src/token.ts',
    line: 42,
    text: 'this branch swallows the expiry case',
    id: 'c1',
    at: 1_700_000_000_000,
  });

  it('anchors a comment to a path and a line, on that file only', () => {
    const target = withComment.files.find((f) => f.path === 'packages/schema/src/token.ts');
    expect(target?.comments).toEqual([
      {
        id: 'c1',
        line: 42,
        text: 'this branch swallows the expiry case',
        sentWith: null,
        at: 1_700_000_000_000,
      },
    ]);
    expect(withComment.files.filter((f) => f.comments.length > 0)).toHaveLength(1);
  });

  it('survives a diff arriving afterwards — a refetch must not erase the review', () => {
    const after = reviewReduce(withComment, {
      type: 'diff/loaded',
      path: 'packages/schema/src/token.ts',
      text: ['--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '+b', ''].join('\n'),
    });
    expect(after.files[1].comments).toHaveLength(1);
  });

  it('lists exactly the comments that have not been carried into a turn yet', () => {
    expect(pendingComments(withComment).map((c) => c.comment.id)).toEqual(['c1']);
    const sent = reviewReduce(withComment, { type: 'comment/sent', ids: ['c1'], turnId: 'turn-9' });
    expect(pendingComments(sent)).toEqual([]);
    expect(sent.files[1].comments[0].sentWith).toBe('turn-9');
  });

  it('writes the steering line the composer receives, path and line included', () => {
    /* §5.2 item 3: "line-anchored comments that feed the chat". The plan's own
       locking test is "comment on line 42, assert the next turn's context
       carries path:42" — so the anchor is in the TEXT, not only in a data
       attribute the model never sees. */
    const line = commentSteer('packages/schema/src/token.ts', 42, 'swallows the expiry case');
    expect(line).toContain('packages/schema/src/token.ts:42');
    expect(line).toContain('swallows the expiry case');
  });

  it('collapses whitespace in the steering line so a pasted block stays one clause', () => {
    const line = commentSteer('a.ts', 7, '  two   words\n\nand more  ');
    expect(line).toBe('`a.ts:7` — two words and more');
  });

  it('refuses an empty comment rather than anchoring a blank one', () => {
    const blank = reviewReduce(THREE, {
      type: 'comment/add',
      path: 'packages/schema/src/token.ts',
      line: 42,
      text: '   ',
      id: 'c2',
      at: 1,
    });
    expect(blank).toBe(THREE);
  });
});

describe('the surface refuses to invent a file', () => {
  it('has no files, no branch and no failure before anything is fetched', () => {
    const empty = emptyReview();
    expect(empty.files).toEqual([]);
    expect(empty.branch).toBe(null);
    expect(empty.failure).toBe(null);
    expect(empty.loading).toBe(false);
  });

  it('records a status failure as a failure, never as an empty clean tree', () => {
    /* "No files changed" and "the engine refused" paint the same when a failure
       is dropped — and the first is a good state while the second is not. */
    const failed = reviewReduce(emptyReview(), {
      type: 'git/failed',
      message: 'no repository is attached',
    });
    expect(failed.failure).toBe('no repository is attached');
    expect(failed.files).toEqual([]);
    expect(failed.loading).toBe(false);
  });
});
