/**
 * THE NULL-DATA SWEEP — every surface, rendered with nothing, saying nothing.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A PER-SURFACE TEST
 * ---------------------------------------------------------
 * The Waves 4/5 gate found four defects. Read as separate bugs they look
 * unrelated; read together they are ONE failure, four times:
 *
 *   F1  the rail printed a function count of `0` on 536 rows when
 *       `/api/functions` had never answered — "none" where the truth was
 *       "nobody looked" — and said "The scan read this file and could not name
 *       a function in it" about a scan that never ran.
 *   F3  a heading read "Plays on board" while clicking moved nothing on the
 *       board.
 *   F4  a header read "69 files +807 −57" while git said 17 files changed.
 *   F2  a note covered 94% of two cards while the e2e that policed it measured
 *       an aggregate that stayed comfortably small.
 *
 * Every one is **a surface asserting something the engine never supplied.**
 * `docs/CANON.md` §1 makes grounded-not-guessed the product's first
 * non-negotiable, and it applies to a rendered number exactly as it applies to
 * a graph edge: a count is a claim about a scan.
 *
 * Each was fixed with its own locking test, and each of those tests only
 * catches the instance it was written for. This file catches the CLASS. It
 * renders every surface in the state the engine leaves it in before it has
 * answered — null graph, null index, no turn, no diff — and asserts the surface
 * invents nothing to fill the space.
 *
 * WHY THE GATE FOUND THESE AND THE SUITE DID NOT. Every existing surface test
 * is handed real fixture data by its own `mount()` helper, because that is what
 * you need to test behaviour. Nothing rendered the null case, so nothing could
 * see the fabrication. That gap is the actual defect this file closes — the
 * point is to fail in `vitest`, where an agent meets it, rather than in a gate
 * that runs after the work is claimed done.
 */
import { describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';

import { IndexRail } from './rail/index.js';
import { twoPackages } from './rail/fixtures.js';
import { EMPTY_CANVAS } from './state/initial.js';
import { Board } from './canvas/index.js';
import { installResizeObserver } from './canvas/testResizeObserver.js';
import { ACTIVITY, ActivityPane, RUN_STATES } from './activity/index.js';

/* @xyflow constructs a ResizeObserver at mount and throws without one, and
 * jsdom has none. The stub never fires, which is why nothing in this file
 * asserts a measured size — every claim here is about text. */
installResizeObserver();

/**
 * Text that asserts work nobody did.
 *
 * Each pattern is drawn from a defect that actually shipped, not imagined. A
 * surface with no data may say "not read yet", "nothing attached", or draw an
 * em dash — those state an ABSENCE. It may not state a RESULT.
 */
const CLAIMS: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /\bThe scan read\b/i,
    why: 'claims a scan happened and reports its finding (F1)',
  },
  {
    pattern: /\bcould not name a function\b/i,
    why: 'reports the outcome of a scan that never ran (F1)',
  },
  {
    pattern: /\b\d+\s+files?\b/i,
    why: 'a file count with no file list behind it (F4)',
  },
  {
    /*
     * F3 WAS FIXED BY BUILDING THE WIRING, NOT BY DELETING THE STRING — item
     * playback. `canvas/canvasChannel.tsx` puts one CanvasSlice above the board
     * and the rail, `canvas/flowFocus.ts` resolves each hop onto the cards the
     * board draws, and `e2e/flow-plays.mjs` proves the whole path in a real
     * browser. So the heading reads "Plays on board" again.
     *
     * THIS PATTERN STILL BINDS, AND ITS SCOPE IS UNCHANGED: with no engine data
     * there is no flow, and a heading announcing that one plays is a claim about
     * work nobody did whether or not the wiring behind it exists. The surface it
     * belongs to is only mounted when a flow is playing, which is what makes the
     * assertion below true rather than a coincidence.
     */
    pattern: /\bPlays on board\b/i,
    why: 'announces a flow when no flow was ever resolved (F3)',
  },
];

/** Render, collect every visible string, and tear down. */
function textOf(node: ReactElement): string {
  render(node);
  const text = document.body.textContent ?? '';
  cleanup();
  return text;
}

/**
 * Any digit at all, because with no index there is nothing to count.
 *
 * A first draft looked for a digit surrounded by WHITESPACE and caught nothing:
 * `textContent` concatenates adjacent elements with no separator, so the
 * fabricated rail read `alpha0one.ts0two.ts0` — the digits are welded to their
 * labels and never stand alone. The sweep passed with the defect reintroduced,
 * twice, before I printed the string and looked at it.
 *
 * The honest assertion is the strict one: given a real graph and NO function
 * index, a correct surface renders `alpha—one.ts—two.ts—` and no numeral
 * anywhere. The em dash is the absence; a digit would be a claim.
 */
function digits(text: string): string[] {
  return text.match(/\d/g) ?? [];
}

describe('a surface with no engine data invents nothing', () => {
  it('the index rail states absence, never a result', () => {
    // THE STATE THAT ACTUALLY PRODUCED F1, and my first draft of this file got it
    // wrong: a REAL graph with a NULL function index. Rendering both null proves
    // nothing, because with no graph the rail draws no rows and so has nothing to
    // fabricate a count for — the sweep passed with the defect reintroduced. The
    // mismatch is the whole bug: rows exist, the index that would populate them
    // does not, and `functionCount` derives to 0 for every one of them.
    const text = textOf(
      <IndexRail
        graph={twoPackages()}
        functions={null}
        coverage={null}
        playback={null}
        onPlay={() => undefined}
        onPlaybackChange={() => undefined}
        onClearFlow={() => undefined}
        onFocusNode={() => undefined}
        onOpenScope={() => undefined}
      />,
    );

    for (const { pattern, why } of CLAIMS) {
      expect(pattern.test(text), `the rail with NO data ${why}: ${JSON.stringify(text.slice(0, 240))}`).toBe(false);
    }
    expect(text, 'the absence must be drawn, not left blank').toContain('—');
    expect(
      digits(text).join(''),
      `no numeral may appear with no index behind it. rendered: ${JSON.stringify(text.slice(0, 200))}`,
    ).toBe('');
  });

  it('the board states absence, never a result', () => {
    const text = textOf(
      <Board
        canvas={EMPTY_CANVAS}
        nodes={[]}
        edges={[]}
        positions={{}}
        dispatch={() => undefined}
        onGround={() => undefined}
      />,
    );

    for (const { pattern, why } of CLAIMS) {
      expect(pattern.test(text), `the board with NO data ${why}: ${JSON.stringify(text.slice(0, 240))}`).toBe(false);
    }
  });

  /**
   * ITEM playback's SURFACE, ADDED TO THE SWEEP.
   *
   * The board can now be handed a flow, and the state that produces a
   * fabrication here is not "no data" but DATA IT CANNOT PLACE: a hop whose
   * ends are nodes the board does not draw. The tempting thing for that surface
   * to do is name the hop's endpoints anyway — they exist in the scan, after
   * all — and that would put two node names on the board for a hop the board
   * has nothing to show, which reads as two cards the reader then cannot find.
   */
  it('the board states a hop it cannot place, and names no node for it', () => {
    const text = textOf(
      <Board
        canvas={EMPTY_CANVAS}
        nodes={[]}
        edges={[]}
        positions={{}}
        dispatch={() => undefined}
        onGround={() => undefined}
        playback={{
          functionId: 'fn:whatever',
          index: 0,
          count: 3,
          shown: 0,
          how: 'none',
          // The resolver placed neither end, so there is no label to print and
          // none is invented from the hop's own ids.
          from: null,
          to: null,
          fromLabel: null,
          toLabel: null,
        }}
      />,
    );

    for (const { pattern, why } of CLAIMS) {
      expect(pattern.test(text), `the board with an unplaceable hop ${why}: ${JSON.stringify(text.slice(0, 240))}`).toBe(false);
    }
    // The absence is DRAWN — the reader is told which hop and that it is not
    // here, which is the difference between an honest board and a still one.
    expect(text).toContain('Hop 1 of 3');
    expect(text).toContain('Neither end of this hop is a node this board draws');
  });

  /**
   * FINDING F4 — THE CASE ABOVE DID NOT LOCK WHAT ITS NAME CLAIMED.
   *
   * The gate replaced the board's guarded label line with an unconditional
   * `` ` · ${playback.fromLabel ?? playback.from ?? '?'} → ...` `` and the sweep
   * stayed GREEN, 5/5. With every id and label null the fallback renders `? → ?`,
   * which contains no node name, so the "names no node" half was unreachable in
   * that fixture: it proved only that nulls print nothing.
   *
   * The dangerous case is the one where ids EXIST but the board does not draw
   * them. A fallback then prints a raw node id — `svc:acp → svc:analyzer` — which
   * reads to a user as two nodes the board placed, when the board placed neither.
   * That is the same defect as a fabricated count: rendering an id you could not
   * resolve is asserting a placement you do not have.
   */
  it('never prints a raw node id for a hop it could not place', () => {
    const text = textOf(
      <Board
        canvas={EMPTY_CANVAS}
        nodes={[]}
        edges={[]}
        positions={{}}
        dispatch={() => undefined}
        onGround={() => undefined}
        playback={{
          functionId: 'fn:whatever',
          index: 0,
          count: 3,
          shown: 0,
          how: 'none',
          // Ids the resolver KNOWS, on a board that draws neither of them.
          from: 'svc:acp',
          to: 'svc:analyzer',
          fromLabel: null,
          toLabel: null,
        }}
      />,
    );

    expect(
      text,
      'a raw node id on screen is a placement the board does not have',
    ).not.toContain('svc:acp');
    expect(text).not.toContain('svc:analyzer');
    expect(text).toContain('Neither end of this hop is a node this board draws');
  });

  /**
   * AND THE RAIL'S HALF: a playback with no hop in it draws no strip.
   *
   * `flowForFunction` returns `traced: false` for the great majority of this
   * repository's functions, and the rail's rule for those is to say so and not
   * play. A
   * strip rendered over an empty hop list would be a play button for a flow
   * that does not exist — the control-with-no-subject shape of the same defect.
   */
  it('the rail draws no flow panel at all for a flow with no hops', () => {
    /* RENDERED IN PLACE RATHER THAN THROUGH `textOf`, because the assertion is
       about what is IN the document and `textOf` tears the document down before
       it returns. A `querySelector` after cleanup returns null for every
       selector ever written, which is the shape of vacuous green this whole
       file exists to stop. */
    render(
      <IndexRail
        graph={twoPackages()}
        functions={null}
        coverage={null}
        playback={{ functionId: 'fn:none', hops: [], cursor: -1, playing: false }}
        onPlay={() => undefined}
        onPlaybackChange={() => undefined}
        onClearFlow={() => undefined}
        onFocusNode={() => undefined}
        onOpenScope={() => undefined}
      />,
    );

    /* NOT JUST THE STRIP — THE WHOLE PANEL. A panel headed "Plays on board"
       over an empty hop list announces a flow that was never resolved, which is
       the F3 pattern above with the wiring now behind it. `flowForFunction`
       returns `traced: false` for most of this repository's functions
       and the rail's rule for those is to SAY so and not play. */
    expect(document.querySelector('[data-testid="rail-flow"]')).toBeNull();
    expect(document.querySelector('[data-testid="rail-strip"]')).toBeNull();

    const text = document.body.textContent ?? '';
    cleanup();
    for (const { pattern, why } of CLAIMS) {
      expect(pattern.test(text), `the rail with an empty flow ${why}: ${JSON.stringify(text.slice(0, 240))}`).toBe(false);
    }
  });

  /**
   * P9 — THE ACTIVITY VIEW, ADDED TO THE SWEEP.
   *
   * This surface is the one with the most to fabricate and the least excuse for
   * doing it. Its whole job is to answer "which of my N runs needs me", and
   * every part of that answer is a NUMBER — a count per bucket, a headline
   * count of what is waiting, a node fraction per row. Before
   * `GET /api/program/runs` has answered there is no list to count, and the
   * bucket bar drawn over an unread list reads `All 0 · Waiting on you 0 ·
   * Blocked 0`: six measurements of nothing, each of which a reader will
   * believe, and the exact shape of F1 — "none" where the truth is "nobody
   * looked".
   *
   * The state words are checked as well as the digits, because a status is a
   * claim about a run and there is no run here to make one about.
   */
  it('the activity view states absence, and counts nothing it has not been given', () => {
    const text = textOf(
      <ActivityPane
        runs={null}
        now={0}
        filter="all"
        onFilter={() => undefined}
        onOpen={() => undefined}
        onCloseRun={() => undefined}
      />,
    );

    for (const { pattern, why } of CLAIMS) {
      expect(
        pattern.test(text),
        `the activity view with NO run list ${why}: ${JSON.stringify(text.slice(0, 240))}`,
      ).toBe(false);
    }
    expect(
      digits(text).join(''),
      `no numeral may appear with no run list behind it. rendered: ${JSON.stringify(text.slice(0, 240))}`,
    ).toBe('');
    for (const state of Object.values(RUN_STATES)) {
      expect(text, `"${state.word}" is a status claimed for a run nobody listed`).not.toContain(
        state.word,
      );
    }
  });

  /**
   * AND THE SAME SURFACE'S OTHER HALF: THE FILTER BAR IS NOT DRAWN AT ALL.
   *
   * Rendered in place rather than through `textOf`, for the reason the rail's
   * case gives — `textOf` tears the document down before it returns, and a
   * `querySelector` after cleanup returns null for every selector ever written,
   * which is the shape of vacuous green this whole file exists to stop.
   *
   * The text assertion above would already fail on a zeroed bar, but only
   * because a zero is a digit. A bar that rendered its five labels with the
   * counts omitted would pass it while still being a control claiming to filter
   * a list that does not exist.
   */
  it('the activity view draws no filter bar and no list over a run list it does not have', () => {
    render(
      <ActivityPane
        runs={null}
        now={0}
        filter="all"
        onFilter={() => undefined}
        onOpen={() => undefined}
        onCloseRun={() => undefined}
      />,
    );

    expect(document.querySelector(`[data-testid="${ACTIVITY.bucketBar}"]`)).toBeNull();
    expect(document.querySelector(`[data-testid="${ACTIVITY.list}"]`)).toBeNull();
    expect(document.querySelectorAll(`[data-testid="${ACTIVITY.row}"]`)).toHaveLength(0);
    /* AND THE ABSENCE IS DRAWN, not left blank. An empty panel on a scrim is
       the "opaque sheet pinned over the whole canvas… it reads as a crash"
       sheet 08.5 names. */
    expect(document.querySelector(`[data-testid="${ACTIVITY.unanswered}"]`)).not.toBeNull();
    cleanup();
  });

  it('every claim pattern is one that really shipped', () => {
    // Guards the list itself. A pattern nobody can point at a defect for is a
    // pattern somebody invented, and this file would then be asserting taste.
    expect(CLAIMS.length).toBeGreaterThanOrEqual(4);
    for (const { why } of CLAIMS) {
      expect(why, 'each pattern names the finding it came from').toMatch(/\(F\d\)$/);
    }
  });
});
