/* ══════════════════════════════════════════════════════════════════════════
   A REFUSAL SAYS WHAT THE ANSWER WILL BE MISSING
   packages/web2/src/chat/refusalConsequence.test.ts

   Owner walk, 2026-09-21, photo 29: `git_status ⊘ REFUSED`, and under it
   `git_status failed: fatal: not a git repository`.

   The refusal itself was CORRECT and well reported — he had attached a folder
   with no `.git` in it. What was missing is the half a reader of a transcript
   actually needs. The reason says WHAT FAILED, which is a fact about a tool.
   Whether to go and check something by hand depends on a different fact: what
   the reply they are about to read does not cover.

   ── THE PROPERTY THAT MATTERS MOST HERE IS THE SILENCE ────────────────────

   `refusalConsequence` returns `null` far more often than it returns a
   sentence, and that is the design rather than an incompleteness. A generic
   "some information may be missing" is true of every refusal ever written, so
   it tells a reader nothing — while occupying the one line where something
   real could have gone. See `an-absence-is-a-claim`: a sentence here is a
   claim about the answer, and a claim needs grounds.
   ══════════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';

import { refusalConsequence } from './ToolCallCard';

describe('what a refusal costs the answer', () => {
  it('names the consequence for the refusal he actually hit', () => {
    const said = refusalConsequence('git_status', 'failed: fatal: not a git repository');

    expect(said).toBeTruthy();
    /* It is about the ANSWER, not about git. "not a git repository" was
       already on screen and did not help. */
    expect(said).toMatch(/nothing in the answer/i);
    expect(said).toMatch(/changed/i);
  });

  it('does not care which tool reported it', () => {
    /*
     * The same fact refused through a different door is the same fact. Keying
     * on the tool name here would have left `git_diff` and any later
     * git-backed call silent about a consequence we plainly know.
     */
    expect(refusalConsequence('git_diff', 'fatal: not a git repository')).toBe(
      refusalConsequence('git_status', 'fatal: not a git repository'),
    );
  });

  it('says nothing when it does not know', () => {
    for (const reason of [
      'the model declined to call it',
      'unexpected end of JSON input',
      'exit code 3',
      '',
    ]) {
      expect(
        refusalConsequence('some_tool', reason),
        `"${reason}" has no consequence we can state without inventing one`,
      ).toBeNull();
    }
  });

  it('reads the reason, not the tool, so an unknown tool still gets it', () => {
    /*
     * A tool nobody has heard of that times out has a knowable consequence,
     * and a tool we know that fails for an unknown cause does not. The
     * evidence is the sentence.
     */
    expect(refusalConsequence('future_tool', 'the call timed out after 30s')).toMatch(
      /did not come back in time/i,
    );
    expect(refusalConsequence('git_status', 'something nobody predicted')).toBeNull();
  });

  it('is case-insensitive, because stderr is not written for us', () => {
    expect(refusalConsequence('git_status', 'FATAL: Not A Git Repository')).toBeTruthy();
  });
});
