import { describe, expect, it } from 'vitest';

import { territoryView, type WorktreeEntry } from './territoriesModel';

/**
 * AGENTS AS TERRITORIES — and the conflict the gap study describes cannot
 * happen here, which is the finding.
 *
 * That study's failure class is two agents editing one file, and its fix is a
 * board showing each agent's claimed file ownership. This product does not put
 * two agents in one tree: `gitHandoffWorktree` gives each its own working tree
 * on its own branch, so the overlap is prevented STRUCTURALLY rather than
 * detected.
 *
 * `schema/territories.ts` computes that overlap and currently has no producer —
 * `.sequence/program.md` carries ONE "Agent may edit" allowlist for the
 * repository rather than one per agent. That is recorded rather than fed with
 * something invented, the same way "Waiting on you" was.
 *
 * What remains worth building is the question the five collapsing rows actually
 * failed at: who is where, and is anything moving.
 */

const MAIN = 'C:/repos/shop';

function tree(over: Partial<WorktreeEntry>): WorktreeEntry {
  return { path: MAIN, branch: 'main', head: 'a'.repeat(40), bare: false, detached: false, ...over };
}

describe('territoryView', () => {
  it('names each tree by what a person recognises, and marks the main checkout', () => {
    const v = territoryView(
      [tree({}), tree({ path: 'C:/repos/shop-agent-a', branch: 'agent-a' })],
      MAIN,
    );
    expect(v.territories.map((t) => t.name)).toEqual(['shop', 'shop-agent-a']);
    expect(v.territories[0]!.isMain).toBe(true);
    expect(v.territories[1]!.isMain).toBe(false);
  });

  it('the main checkout is matched by PATH, not by position', () => {
    /*
     * git lists the main checkout first today. Matching on position would
     * silently mislabel every row the day that changes, and the label is the
     * one thing a reader uses to know which tree they are looking at.
     */
    const v = territoryView(
      [tree({ path: 'C:/repos/shop-agent-a', branch: 'agent-a' }), tree({})],
      MAIN,
    );
    expect(v.territories.find((t) => t.isMain)!.name).toBe('shop');
  });

  it('separators and trailing slashes do not make a second repo', () => {
    const v = territoryView([tree({ path: 'C:\\repos\\shop\\' })], MAIN);
    expect(v.territories[0]!.isMain).toBe(true);
  });

  it('counts the parallel work, and says so when there is none', () => {
    const alone = territoryView([tree({})], MAIN);
    expect(alone.parallel).toBe(0);
    /* "No parallel work" and "the view is broken" look identical when a surface
       renders nothing, so this is said rather than left blank. */
    expect(alone.summary).toMatch(/only the main checkout/i);

    const busy = territoryView(
      [
        tree({}),
        tree({ path: 'C:/repos/shop-a', branch: 'a' }),
        tree({ path: 'C:/repos/shop-b', branch: 'b' }),
      ],
      MAIN,
    );
    expect(busy.parallel).toBe(2);
    expect(busy.summary).toMatch(/2 working trees/);
  });

  it('a bare or detached tree SAYS what it is', () => {
    const v = territoryView(
      [
        tree({ path: 'C:/repos/bare', bare: true, branch: null }),
        tree({ path: 'C:/repos/loose', detached: true, branch: null }),
      ],
      MAIN,
    );
    /*
     * Both are real states, and a row saying nothing about them would look like
     * an agent that had simply stopped reporting — the exact failure this view
     * exists to avoid.
     */
    expect(v.territories.find((t) => t.name === 'bare')!.note).toMatch(/bare/);
    expect(v.territories.find((t) => t.name === 'loose')!.note).toMatch(/detached/);
  });

  it('a branch in two trees is reported, even though git refuses it', () => {
    const v = territoryView(
      [
        tree({ path: 'C:/repos/shop-a', branch: 'shared' }),
        tree({ path: 'C:/repos/shop-b', branch: 'shared' }),
      ],
      MAIN,
    );
    /* git will not normally allow this. Reporting it rather than assuming it
       cannot happen is how a wrong assumption becomes visible instead of
       becoming a silence. */
    expect(v.sharedBranches).toEqual(['shared']);
    expect(v.summary).toMatch(/more than one tree/);
  });

  it('the head is shortened, so two trees on one branch are still tellable apart', () => {
    const v = territoryView([tree({ head: 'abcdef1234567890' })], MAIN);
    expect(v.territories[0]!.head).toBe('abcdef1');
  });

  it('no attached repo still lists the trees — nothing is just unmarked', () => {
    const v = territoryView([tree({}), tree({ path: 'C:/repos/shop-a', branch: 'a' })], null);
    expect(v.territories).toHaveLength(2);
    expect(v.territories.every((t) => !t.isMain)).toBe(true);
  });

  it('the order is stable, so a list two agents are watching does not reorder', () => {
    const entries = [
      tree({ path: 'C:/repos/shop-z', branch: 'z' }),
      tree({}),
      tree({ path: 'C:/repos/shop-a', branch: 'a' }),
    ];
    expect(territoryView(entries, MAIN)).toEqual(territoryView([...entries].reverse(), MAIN));
  });

  it('an empty list is an empty view, not a crash', () => {
    const v = territoryView([], MAIN);
    expect(v.territories).toEqual([]);
    expect(v.parallel).toBe(0);
  });
});
