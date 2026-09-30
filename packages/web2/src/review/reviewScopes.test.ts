import { describe, expect, it } from 'vitest';

import { REVIEW_SCOPES, scopeSupport, servedScopes } from './reviewScopes';
import type { ReviewScope } from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 5.4 — THE FIVE SCOPES, AND THE THREE THE ENGINE CANNOT ANSWER YET.

   §5.2 item 2 steals the segmented control verbatim from Codex: Unstaged /
   Staged / Commit / Branch / Last turn. This file is the test that the control
   is honest about which of those five the engine behind it can actually serve.

   MEASURED, NOT ASSUMED. Read against the shipped engine:

     · GET /api/git/status (`server/repoServer.ts`) answers
       `git status --porcelain=v1 -b --no-renames`, and gitWorkspace.ts's
       `classifyStatus` COLLAPSES the porcelain XY pair into one word: a
       'modified' can be X='M' (staged) or Y='M' (unstaged) and nothing on the
       wire separates them.
     · GET /api/git/diff (`server/repoServer.ts`) takes `?path` and NOTHING ELSE,
       and gitWorkspace.ts's `gitDiff` runs `git diff HEAD -- <path>`. There is
       no `--cached` form and no revision parameter.

   So the wire can answer exactly one git question — "what is different between
   the working tree and the last commit" — and cannot answer "what is staged",
   "what did commit X change" or "what does this branch change against its
   base". A control that rendered five tabs and quietly showed the same thing in
   all five would be the product lying in five places at once.

   CANON's rule for this is not ambiguous: "Nothing fabricated… If the engine
   cannot supply it, render the honest empty state and say what is missing." So
   every unserved scope carries the route that would have to change, by name.
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 5.4 — the scope register', () => {
  it('declares all five scopes, in Codex’s order, ending on Last turn', () => {
    /* The order is load-bearing: "Last turn" is the one §5.2 singles out —
       *what did the agent just do to me*, one click — and a segmented control
       puts the most-reached-for segment where the hand already is. */
    expect(REVIEW_SCOPES.map((s) => s.scope)).toEqual([
      'unstaged',
      'staged',
      'commit',
      'branch',
      'last-turn',
    ] satisfies ReviewScope[]);
  });

  it('gives every scope a label short enough for a compact segment', () => {
    for (const spec of REVIEW_SCOPES) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.label.length).toBeLessThanOrEqual(10);
    }
  });

  it('serves all five — and this assertion is what made each one earn it', () => {
    /*
     * This has fired twice and been re-measured twice, which is what it is for.
     * It read "exactly the two the engine has a route for" until
     * `GET /api/git/diff` grew `?scope=`, and then "unstaged, staged,
     * last-turn" until the pane grew a revision picker off
     * `GET /api/git/revisions`.
     *
     * All five are now served END TO END: the segment sends a scope, the route
     * answers it, and for commit and branch a person names the revision rather
     * than the pane assuming HEAD.
     */
    expect(servedScopes()).toEqual(['unstaged', 'staged', 'commit', 'branch', 'last-turn']);
  });

  it('a served scope says what it measured, and claims no gap', () => {
    for (const spec of REVIEW_SCOPES) {
      expect(spec.served).toBe(true);
      /* The provenance line is not optional: "Unstaged" is the segment's word
         and `git diff HEAD` is the engine's answer, and saying only the first
         is a quiet lie in the place a reader decides whether to trust the
         rest. */
      expect(spec.measures.length).toBeGreaterThan(0);
      expect(spec.missing).toBeNull();
    }
  });

  it('THE REFUSAL MACHINERY STILL WORKS, for a scope the register never heard of', () => {
    /*
     * Every listed scope is served now, so the honest-refusal path has no
     * subject among them — and deleting the lock with the last unserved scope
     * would leave nothing checking it the day a sixth is added.
     *
     * `scopeSupport` is TOTAL and its fallback is a REFUSAL rather than a
     * default: a scope nobody registered must not render as "unstaged".
     */
    const unknown = scopeSupport('deploy' as never);
    expect(unknown.served).toBe(false);
    expect(unknown.missing).toMatch(/no route is registered/i);
  });

  it('states what the served git scope actually measured, caveat included', () => {
    const support = scopeSupport('unstaged');
    expect(support.served).toBe(true);
    /* `git diff HEAD` is working-tree-vs-last-commit: it INCLUDES staged
       changes. Labelling that segment "Unstaged" and saying nothing would be a
       quiet lie, so the provenance line says exactly what was measured. */
    expect(support.measures).toMatch(/git diff HEAD/);
    expect(support.caveat).toMatch(/staged/i);
  });

  it('serves last-turn from the session, not from git, and says so', () => {
    const support = scopeSupport('last-turn');
    expect(support.served).toBe(true);
    expect(support.source).toBe('session');
    expect(support.measures).toMatch(/edit:proposal/);
  });

  it('marks the git scopes as sourced from git', () => {
    expect(scopeSupport('unstaged').source).toBe('git');
    expect(scopeSupport('staged').source).toBe('git');
  });
});
