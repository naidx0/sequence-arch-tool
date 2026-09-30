/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD CAN BE ASKED TO DRAW ITSELF — AND NEVER DOES IT UNASKED
   packages/web2/src/v3/drawAffordance.test.tsx

   Owner, 2026-09-21: "it shouldn't also auto implement ... if there's nothing
   already done, then there should be like a button top right next to the art
   board or bottom left, which basically says generate ... or it'll be like a
   slash skill or slash tool. I think a slash skill is definitely easier."

   Photo 29 is the case: an empty board reading "Nothing at this scope" with no
   way forward except knowing what to type. He then typed "draw the arch board
   behind our project" and it worked — so the capability was already there and
   the AFFORDANCE was not. That is what this locks.

   ── AND THE HALF THAT IS EASY TO GET WRONG ────────────────────────────────

   Both the button and the command WRITE THE REQUEST. Neither sends it. That is
   this canvas's standing rule (`onGenerate` in ConnectedBoard: "a canvas
   gesture never starts a run on its own ... the difference between a tool that
   proposes and one that acts") and it is also the thing he asked for in the
   same sentence. A `/draw` that ran on pick would be the auto-implement he is
   objecting to, reached through the palette instead of through an attach.
   ══════════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';

import { slashCommands, slashGroupOf, TOOLBELT } from '../chat/composerModel';

const MODES = [
  { mode: 'Plan' as const, label: 'Plan', description: 'think first', icon: 'plan' as const },
];

describe('/draw', () => {
  it('is offered where a board exists', () => {
    const cmds = slashCommands(MODES, TOOLBELT, { board: true });
    const draw = cmds.find((c) => c.name === 'draw');

    expect(draw, 'a workspace with a board can carry this out').toBeTruthy();
    expect(draw?.source.kind).toBe('board');
    /* A verb belongs under Commands, beside /goal — not under Skills, which is
       where things the person wrote on disk live. */
    expect(slashGroupOf(draw!.source)).toBe('commands');
  });

  it('is absent where there is no board to draw on', () => {
    /*
     * The same rule `/goal` follows, and for the same reason: `chat/Composer`
     * owns no architecture pane, and a menu row that does nothing when picked
     * has told the reader the product can do something it cannot.
     */
    const cmds = slashCommands(MODES, TOOLBELT, {});
    expect(cmds.some((c) => c.name === 'draw')).toBe(false);
  });

  it('says what it does before it is picked', () => {
    const draw = slashCommands(MODES, TOOLBELT, { board: true }).find((c) => c.name === 'draw');

    /*
     * The hint is the only place a reader is told this writes rather than
     * runs, and it is read BEFORE Enter. "write the request" is the whole
     * promise; a hint that said "draw the board" would be describing something
     * the row does not do.
     */
    expect(draw?.hint).toMatch(/write the request/i);
    expect(draw?.hint, 'nothing here should read as though it runs on pick').not.toMatch(
      /^(draws|generates|runs)\b/i,
    );
  });

  it('is typeable — the name has no space and no capital', () => {
    const draw = slashCommands(MODES, TOOLBELT, { board: true }).find((c) => c.name === 'draw');
    /* It is reached by typing it, so the name has to survive being typed. */
    expect(draw?.name).toBe(draw?.name.toLowerCase());
    expect(draw?.name).not.toMatch(/\s/);
  });
});
