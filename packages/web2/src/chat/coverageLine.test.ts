import { describe, expect, it } from 'vitest';

import { coverageSentence } from './coverageLine';

/**
 * THE CUT, NAMED — in words, beside the answer.
 *
 * CANON calls coverage "the single strongest thing we have and nothing else on
 * the list is close": Codex and Claude Code structurally cannot report what they
 * did NOT read, because neither holds a complete model of the repository to
 * subtract a read-set from.
 *
 * It was computed by the engine, sent on the wire, stored on the turn, and used
 * to colour per-file badges in the rail — and `packagesMissed`, the actual cut,
 * was rendered to a user NOWHERE. `grep packagesMissed packages/web2/src` outside
 * tests returned one hit, in a specimen fixture. The claim existed everywhere
 * except in front of the person reading the answer.
 */
describe('coverageSentence', () => {
  /*
   * The denominator is the whole point — the digest cap cannot shrink it, so
   * "296 of 2,326" is the sentence that makes a partial read visible. Asserted
   * as a prefix because what FOLLOWS it depends on whether anything was cut,
   * and the two cases below own that half.
   */
  it('states the denominator, because the cap cannot shrink it', () => {
    expect(
      coverageSentence({ edgesSeen: 296, edgesTotal: 2326, packagesSeen: ['a'], packagesMissed: [] }),
    ).toMatch(/^answered from 296 of 2,326 edges\b/);
  });

  /*
   * EMPTY IS A REAL ANSWER, NOT A MISSING ONE. For a whole-system ask, ranked
   * selection reaches every package and the loss shows up as depth rather than
   * absence — so "nothing was cut" must read as a finding, not as silence.
   */
  it('says nothing was cut when nothing was', () => {
    const s = coverageSentence({
      edgesSeen: 39,
      edgesTotal: 39,
      packagesSeen: ['gateway', 'orders'],
      packagesMissed: [],
    });
    expect(s).toBe('answered from 39 of 39 edges — every component contributed');
  });

  it('names the components that contributed nothing', () => {
    const s = coverageSentence({
      edgesSeen: 60,
      edgesTotal: 2847,
      packagesSeen: ['packages/analyzer'],
      packagesMissed: ['packages/web2', 'packages/mcp'],
    });
    expect(s).toBe(
      'answered from 60 of 2,847 edges — 2 components contributed nothing: packages/web2, packages/mcp',
    );
  });

  /*
   * A LONG LIST IS TRUNCATED WITH ITS OWN COUNT, never silently. "and 7 more"
   * is a measurement; a list that simply stops is a lie about how much was cut.
   */
  it('truncates a long list and says how many it did not print', () => {
    const missed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const s = coverageSentence({ edgesSeen: 1, edgesTotal: 100, packagesSeen: [], packagesMissed: missed });
    expect(s).toBe('answered from 1 of 100 edges — 10 components contributed nothing: a, b, c, and 7 more');
  });

  it('uses the singular for one component', () => {
    const s = coverageSentence({ edgesSeen: 5, edgesTotal: 9, packagesSeen: ['x'], packagesMissed: ['y'] });
    expect(s).toBe('answered from 5 of 9 edges — 1 component contributed nothing: y');
  });

  /*
   * ZERO OF ZERO IS NOT A COVERAGE CLAIM. A repo with no edges gives a
   * denominator of nothing, and "0 of 0" reads as a failure to look rather than
   * as nothing to look at. Withheld — the card simply has no line.
   */
  it('is null when there is no denominator to speak of', () => {
    expect(
      coverageSentence({ edgesSeen: 0, edgesTotal: 0, packagesSeen: [], packagesMissed: [] }),
    ).toBeNull();
    expect(coverageSentence(null)).toBeNull();
  });
});
