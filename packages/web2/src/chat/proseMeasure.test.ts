import { describe, expect, it } from 'vitest';

import { substituteVars } from '../../test/support/css';
import '../tokens/graphite.css';
import './chat.css';
import { DEFAULT_SHELL_TOKENS, chatMax, computeLayout } from '../shell/shellModel';

/* ══════════════════════════════════════════════════════════════════════════
   WAVE 5 · G5 — THE ANSWER KEEPS A READABLE MEASURE ON WIDE FRAMES
   (codex#25010: "fixed-column complaints").

   The claim has two halves, and each is asserted against a different source
   of truth:

   1. THE CASCADE. The transcript column (`.tcol`) and the composer block
      (`.composerwrap .inner`, `.undercomposer`) are bound to --col-max, and
      the prose itself caps tighter still, in ch — so no answer line can be
      stretched by the frame behind it. Read out of the parsed CSSOM (what the
      browser built), never by grepping the sheet: §4.6 bans the grep tier,
      because a value in a file proves nothing about what an element received.

   2. THE ARITHMETIC. At 1920 and 2560 — the wide frames where a full-bleed
      chat would run answers past 100 characters per line — computeLayout()
      clamps the centre column to --pane-w-max (720). Column ≤ 720 and prose
      capped at 68ch means the measure a reader's eye travels never leaves the
      classic 45–75 character band, whatever the monitor does.
   ══════════════════════════════════════════════════════════════════════════ */

const root = document.documentElement;

function declared(name: string): string {
  return getComputedStyle(root).getPropertyValue(name).trim();
}

/** One rule's declared value for a property, found by selector text in the
 *  parsed CSSOM. Throws rather than returns empty, so a renamed selector is a
 *  loud failure, not a vacuous pass. */
function ruleValue(selectorSuffix: string, property: string): string {
  const visit = (rules: CSSRuleList): string | null => {
    for (const rule of Array.from(rules)) {
      const group = rule as CSSMediaRule;
      if (group.cssRules && group.conditionText !== undefined) {
        const nested = visit(group.cssRules);
        if (nested !== null) return nested;
        continue;
      }
      const style = rule as CSSStyleRule;
      if (!style.selectorText || !style.selectorText.includes(selectorSuffix)) continue;
      const value = style.style.getPropertyValue(property).trim();
      if (value !== '') return value;
    }
    return null;
  };

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const found = visit(sheet.cssRules);
      if (found !== null) return found;
    } catch {
      /* a sheet we cannot read declares nothing here */
    }
  }
  throw new Error(`no rule matching ${selectorSuffix} declares ${property}`);
}

/*
 * OWNER RULING, 2026-09-02 — SUPERSEDES THE 720 CAP ABOVE. Full-screened, he
 * found "the output text layout is hidden purely in the chat box's
 * confinement space, so if you full-screen, the chat box should get bigger. I
 * should be able to actually see a wider output because the screen's bigger."
 * G5's answer to codex#25010 had made the measure a FIXED 720 whatever the
 * frame; the owner's seat says the column is the measure and the frame (or a
 * drag) decides the column. What survives of G5: the prose still carries a
 * ch cap so a line never becomes a scanning exercise on a 1280px column, and
 * --col-max stays a token (attach and export widths read it). Recorded in
 * docs/owner-feedback-log.md.
 */
describe('a centred reading column with a real cap (owner, 2026-09-02 PM)', () => {
  /*
   * THE SECOND RULING OF THE DAY, correcting the first's excess. The morning
   * fix removed the column cap entirely (`max-width: 100%`) and let the pane
   * grow to half the frame forever. He came back: "when you were in the chat,
   * it made it too big. It should adapt to the Claude/Codex rules, where it's
   * centered first with an actual cap, and it doesn't stretch the whole way.
   * It just stretches a certain amount to fulfil, and then it fills with the
   * architecture boards on the side."
   *
   * Both halves must hold at once, which is what makes this worth locking:
   * full-screening still widens the output (the morning ask), AND the widening
   * stops (the afternoon one).
   */
  it('centres the transcript and the composer on a capped column', () => {
    expect(ruleValue('.tcol', 'max-width')).toBe('var(--col-max)');
    expect(ruleValue('.tcol', 'margin')).toMatch(/auto/);
    expect(ruleValue('.composerwrap .inner', 'max-width')).toBe('var(--col-max)');
    expect(ruleValue('.undercomposer', 'max-width')).toBe('var(--col-max)');
  });

  it('still caps the prose in ch — a character count, not a pixel', () => {
    const cap = ruleValue('.chat-scope .prose', 'max-width');
    expect(cap).toMatch(/^\d+ch$/);
    const chars = parseFloat(cap);
    expect(chars).toBeGreaterThanOrEqual(80);
    expect(chars).toBeLessThanOrEqual(110);
  });

  it('the column never runs far wider than the text it holds', () => {
    /*
     * THE SECOND DEFECT, GUARDED AGAINST DRIFT RATHER THAN AGAINST TODAY.
     *
     * Measured on the running app at a 1920 frame with chat alone: `.tcol` was
     * 1654px and `.prose` stopped at its ch cap of 959px, flush left — about
     * 695px of dead black beside every paragraph. Widening the window was
     * adding EMPTY SPACE instead of readable line length, which is the exact
     * opposite of the morning ruling.
     *
     * Capping the column fixed it, and the fix holds only while the column and
     * the prose measure stay close. So that RELATIONSHIP is what is asserted —
     * not the centring of the prose block, which would be vacuous here (960
     * against 959 is half a pixel a side) and wrong anyway: prose shares its
     * left edge with tool rows and work stacks, and centring it alone would
     * ragged the edge that makes a transcript scannable.
     *
     * PROSE_MEASURE_PX is a real measurement of the real face, not a formula:
     * 96ch renders 959px at --t-15, i.e. 1ch is about 0.67em for this font and
     * not the 0.5em rule of thumb a derivation would have assumed.
     */
    const PROSE_MEASURE_PX = 959;
    const colMax = parseFloat(substituteVars(declared('--col-max'), root));
    const slack = colMax - PROSE_MEASURE_PX;
    expect(slack).toBeGreaterThanOrEqual(0); // the column must fit the measure
    expect(
      slack,
      `--col-max (${colMax}) runs ${slack}px past the 96ch prose measure — that gap is dead ` +
        'space beside every paragraph. Raise the prose cap with it, or bring the column back.',
    ).toBeLessThanOrEqual(80);
  });

  it('--col-max is the CODE measure, and the pane cap is that plus the padding', () => {
    /* 120 mono columns at --t-13 (1ch ≈ 0.6em ≈ 7.8px) is 936px → 960 on the
       8px grid; the pane may hold that plus --sp-20 of padding each side. The
       two are deliberately no longer equal to --pane-w-max: the pane may now
       exceed its normal-frame ceiling as the frame grows, and --pane-w-cap is
       where that stops. */
    expect(parseFloat(substituteVars(declared('--col-max'), root))).toBe(960);
    expect(parseFloat(substituteVars(declared('--pane-w-cap'), root))).toBe(1000);
    expect(DEFAULT_SHELL_TOKENS.chatCap).toBe(1000);
  });

  it('grows to 1920 as the morning ruling demands, and STOPS by 2560 as the afternoon one does', () => {
    const wide = (w: number) =>
      computeLayout(w, 'column', 'column', 5000, DEFAULT_SHELL_TOKENS.rail.base, 'chat', DEFAULT_SHELL_TOKENS)
        .chatWidth;

    // 1280 — untouched by either ruling: the sidebar's minimum binds first.
    // allowance 1280 − max(⌊1280/3⌋, 420) = 854, minus the rail's 216 = 638.
    expect(wide(1280)).toBe(638);

    // 1920 — max(720, 960) = 960, under the 1000 cap. The morning behaviour,
    // and the proof that this ruling did NOT return the chat to a fixed 720.
    expect(wide(1920)).toBe(960);
    expect(wide(1920)).toBeGreaterThan(720);

    // 2560 — max(720, 1280) = 1280 would have been half the frame; the cap
    // stops it at 1000 and the remaining 1560px go to the board and canvases.
    expect(wide(2560)).toBe(1000);
    expect(chatMax(2560, DEFAULT_SHELL_TOKENS)).toBe(1000);

    // And it never creeps: an absurd frame still stops at the same number.
    expect(chatMax(5120, DEFAULT_SHELL_TOKENS)).toBe(1000);
  });
});
