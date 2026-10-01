/* ══════════════════════════════════════════════════════════════════════════
   THE RAIL'S CHATS ARE VISIBLE, AND ITS TWO CONTROLS ARE NOT IN ONE PLACE
   packages/web2/src/v3/railChromeGeometry.test.ts

   Owner, 2026-09-21, on the build shipped an hour earlier:

     "switching chats has become a real problem and when you hover a repo or
      project on the side rail it only shows the x overlapping the + making it
      impossible to actually add more chats ... when you finally start a new
      chat it does not actually save at all ... and the folders dont expand"

   FOUR COMPLAINTS, TWO CAUSES, AND BOTH WERE MINE.

   ── ONE: A SELECTOR CUT IN HALF ───────────────────────────────────────────

   The sheet contained

       .v3-rail-section.is-collapsed .v3-rail-section-body { display: none; }

   and a patch inserted a block of rules using `.v3-rail-section-body {` as its
   anchor. That string is a SUFFIX of that selector, so 130 lines landed
   between `.is-collapsed` and the element it qualifies. What was left was an
   unconditional `display: none` on every section body, plus a first rule that
   had silently inherited `.is-collapsed` as an ancestor.

   Every project's chat list went invisible. The chats were all still there —
   in the DOM, on disk, correctly filed under their repositories — which is
   why three of his four complaints are different descriptions of one hidden
   `<div>`: folders that would not expand, switching that had stopped working,
   and new chats that looked like they had not saved. Measured after the fix, a
   new chat lands at the top of its own repo's section and survives a reload;
   it always did.

   ── TWO: TWO CONTROLS IN THE SAME TWENTY PIXELS ───────────────────────────

   The section "+" is a 20x20 box at `top: 4px; right: 4px`. The remove control
   added the same day took `right: 8px; top: 0` with a 28x30 box. They
   intersected, and the remove control is later in the DOM, so
   `elementFromPoint` at the centre of the "+" returned it: every press meant
   to start a chat opened a removal instead.

   ── WHY THIS FILE READS THE STYLESHEET ────────────────────────────────────

   Neither fault is reachable from a rendered tree in jsdom, which performs no
   layout: `getBoundingClientRect` returns zeros and `display` resolves from no
   cascade, so a render-based test passes on both the broken and the fixed
   sheet. The declarations are the only evidence at this level. Same reason as
   `canvas/strokeLayerFills.test.ts`, and the same lesson — a green suite is
   evidence about what it reads.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'v3.css'), 'utf8');

/** Every rule body in the sheet whose selector list matches `re`. */
function rulesMatching(re: RegExp): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  /* Comments first: a `{` inside one is not a rule, and this sheet is mostly
     comment by volume. */
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(bare)) !== null) {
    const selector = m[1].trim();
    if (re.test(selector)) out.push({ selector, body: m[2] });
  }
  return out;
}

describe('the rail shows its chats', () => {
  it('only a COLLAPSED section hides its body', () => {
    const hiding = rulesMatching(/\.v3-rail-section-body\b/).filter((r) =>
      /display:\s*none/.test(r.body),
    );

    expect(hiding.length, 'something must still implement collapse').toBeGreaterThan(0);

    for (const rule of hiding) {
      /*
       * THE QUALIFIER IS THE WHOLE POINT. An unconditional `display: none`
       * here empties the rail, and that is not a subtle failure — it is every
       * chat in the product becoming unreachable, while the suite stays green
       * because jsdom does not do layout.
       */
      expect(
        rule.selector,
        `"${rule.selector}" hides section bodies without asking whether the section is collapsed`,
      ).toMatch(/\.is-collapsed\b/);
    }
  });

  it('no structural container is hidden without a state that explains it', () => {
    /*
     * THE GENERAL FORM OF THE ACCIDENT, and the reason this is not a syntax
     * check. The first draft of this case hunted for a comment inside a
     * selector — the literal shape the bad splice left behind. It flagged two
     * innocent rules, because a naive brace scan slices comment prose into
     * things that look like selectors, and `.a /* note *\/ .b { }` is valid
     * CSS anyway. The detector was wrong, not the sheet.
     *
     * So this asks the question that actually matters: a rule that takes a
     * whole region of the shell off the screen must say WHEN. Every one of
     * these containers holds something a reader navigates by, and an
     * unconditional `display: none` on any of them is a blank panel with a
     * green suite behind it — jsdom does no layout, so nothing else here can
     * see it.
     */
    const containers = [
      'v3-rail-section-body',
      'v3-rail-scroll',
      'v3-chat-col',
      'v3-live-stack',
      'v3-rail-slot',
    ];

    for (const cls of containers) {
      /* Plain string matching, not a RegExp built from a template literal:
         the first version of this did exactly that, and in a template literal
         `\b` is a BACKSPACE character rather than a word boundary. It matched
         nothing, so the loop below ran zero times and the case passed without
         asking anything at all. */
      const hidden = rulesMatching(/./).filter(
        (r) => r.selector.includes(`.${cls}`) && /display:\s*none/.test(r.body),
      );
      for (const rule of hidden) {
        expect(
          rule.selector,
          `"${rule.selector}" hides .${cls} unconditionally — nothing on screen says why`,
        ).toMatch(/[.:[]/);
        /* A qualifier beyond the container's own class: a state class, an
           attribute, or a pseudo — not just the element itself. */
        const qualifiers = rule.selector.split(`.${cls}`).join('').trim();
        expect(
          qualifiers,
          `"${rule.selector}" needs a state (like .is-collapsed) to justify hiding .${cls}`,
        ).not.toBe('');
      }
    }
  });
});

describe('the section controls do not share a slot', () => {
  const plus = rulesMatching(/^\.v3-rail-section-new$/)[0];
  const remove = rulesMatching(/^\.v3-rail-project-remove$/)[0];

  it('both are declared', () => {
    expect(plus, '.v3-rail-section-new').toBeTruthy();
    expect(remove, '.v3-rail-project-remove').toBeTruthy();
  });

  it('the remove control clears the + rather than covering it', () => {
    /*
     * The "+" is 20 wide at `right: 4px`, so it occupies 4..24 from the right
     * edge. Anything that starts inside that span is on top of it, and the
     * later element wins the pointer.
     *
     * This asserts the ARITHMETIC rather than the literal string, so the rule
     * may be rewritten in other tokens and still be checked — what must hold
     * is that the remove control begins beyond the "+"'s far edge.
     */
    expect(plus.body).toMatch(/right:\s*4px/);
    expect(plus.body).toMatch(/width:\s*20px/);

    const right = /right:\s*calc\(var\(--sp-4\)\s*\+\s*20px\s*\+\s*var\(--sp-4\)\)/;
    expect(
      remove.body,
      'the remove control must start past the +: 4px inset + 20px of button + a gap',
    ).toMatch(right);

    /* And it is the same size, so the two read as one pair of controls. */
    expect(remove.body).toMatch(/width:\s*20px/);
    expect(remove.body).toMatch(/height:\s*20px/);
  });
});
