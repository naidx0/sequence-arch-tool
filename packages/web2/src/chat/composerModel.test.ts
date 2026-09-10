import { describe, expect, it } from 'vitest';

import {
  autosizeHeight,
  deriveSendState,
  keyIntent,
  placeholderFor,
  slashCommands,
  slashMatches,
  slashQuery,
  TOOLBELT,
} from './composerModel';

/**
 * ITEM 2.7 — THE COMPOSER, PURE HALF.
 *
 * Every rule below is a decision the render layer must not be allowed to
 * re-make. They live in a module with no React and no DOM so that the
 * behaviours the owner named — "what happens when the user types mid-stream",
 * "Enter vs Shift+Enter" — are asserted against a function rather than against
 * a simulated keystroke that a later refactor can route around.
 *
 * Cited: docs/brand/graphite/pages/12-the-agentic-surfaces.html §12.4,
 * docs/research/ml-harness-adoption.md §1.12 and §2 item 8.
 */

describe('keyIntent — Enter sends, Shift+Enter newlines', () => {
  it('sends on a bare Enter', () => {
    expect(keyIntent({ key: 'Enter', shiftKey: false, composing: false })).toBe('send');
  });

  it('newlines on Shift+Enter', () => {
    /*
     * The one binding both halves of the product depend on. A composer that
     * cannot make a second paragraph forces the user to write one long line,
     * and a composer that needs a mouse to send is not a chat box.
     */
    expect(keyIntent({ key: 'Enter', shiftKey: true, composing: false })).toBe('newline');
  });

  it('newlines on Enter while an IME candidate is open', () => {
    /*
     * MLH/frontend/src/components/Composer.tsx:182-192. Without this guard a
     * CJK user pressing Enter to ACCEPT a candidate sends a half-composed
     * message — confirmed absent in v1 and recorded in the adoption study as a
     * live bug. `composing` is not a modifier: it is a different keyboard.
     */
    expect(keyIntent({ key: 'Enter', shiftKey: false, composing: true })).toBe('newline');
  });

  it('leaves every other key to the textarea', () => {
    expect(keyIntent({ key: 'a', shiftKey: false, composing: false })).toBe('pass');
    expect(keyIntent({ key: 'Escape', shiftKey: false, composing: false })).toBe('pass');
    expect(keyIntent({ key: 'Tab', shiftKey: true, composing: false })).toBe('pass');
  });
});

describe('deriveSendState — the button never lies about what it will do', () => {
  it('is disabled on an empty draft, and on whitespace only', () => {
    expect(deriveSendState('', null)).toBe('disabled');
    expect(deriveSendState('   \n  ', null)).toBe('disabled');
  });

  it('is ready once there are words', () => {
    expect(deriveSendState('what breaks', null)).toBe('ready');
  });

  it('is running while a turn is in flight, whatever the draft says', () => {
    /*
     * Sheet 12.4: while a run is in flight the same circle becomes stop, "so
     * the control that started the work is the control that ends it". A draft
     * typed mid-stream must not turn stop back into send.
     */
    expect(deriveSendState('', { phase: 'queued' })).toBe('running');
    expect(deriveSendState('typed mid-stream', { phase: 'streaming' })).toBe('running');
    expect(deriveSendState('x', { phase: 'stopping' })).toBe('running');
  });

  it('is not running once the stream has ended', () => {
    expect(deriveSendState('x', { phase: 'done' })).toBe('ready');
    expect(deriveSendState('', { phase: 'error' })).toBe('disabled');
  });
});

describe('autosizeHeight — four lines and then it scrolls', () => {
  it('grows with the content', () => {
    expect(autosizeHeight(21, 21, 4)).toBe(21);
    expect(autosizeHeight(63, 21, 4)).toBe(63);
  });

  it('caps at four lines rather than eating the transcript', () => {
    expect(autosizeHeight(210, 21, 4)).toBe(84);
  });

  it('never returns less than one line, even on a zero measurement', () => {
    // A textarea measured before layout reports 0. Returning 0 collapses the
    // composer to a hairline and the user cannot find the field again.
    expect(autosizeHeight(0, 21, 4)).toBe(21);
  });
});

describe('placeholderFor — the most-read line in the product', () => {
  it('names @ in both states, because that is the affordance nothing else teaches', () => {
    expect(placeholderFor(false)).toContain('@');
    expect(placeholderFor(true)).toContain('@');
  });

  it('says "this repo" on a new thread and "a follow-up change" on a live one', () => {
    expect(placeholderFor(false)).toContain('Ask about this repo');
    expect(placeholderFor(true)).toContain('Ask for a follow-up change');
  });

  it('names the two affordances that exist, and no more', () => {
    /*
     * REDIRECTED, not weakened. This test used to read "advertises no slash
     * commands, because this composer has none" and cited sheet 12.4: "a
     * placeholder that advertises one would be the product lying in its
     * most-read line."
     *
     * The sheet's rule was never "no slash commands" — it was that this line
     * claims nothing that does not exist. Decision 4 (2026-08-24, GRAPHITE-
     * DECISIONS.md) added them on the owner's ruling, so the honest line names
     * them. The old assertion recorded a premise, not a principle, and keeping
     * it would now forbid telling the truth.
     *
     * The principle it was protecting is kept below, and made stricter: exactly
     * two markers. A third would need its own decision, because the line is
     * worth reading only while it is short enough to be read every time.
     */
    for (const line of [placeholderFor(false), placeholderFor(true)]) {
      expect(line).toContain('/');
      expect(line).toContain('@');
      expect(line).toContain('/ for commands');
      expect(line).not.toContain('/ for skills');
      /* The guard against creep: count the markers, do not just check presence. */
      expect(line.match(/\B[/@]/g) ?? []).toHaveLength(2);
    }
  });
});

describe('TOOLBELT — ONE keeper list', () => {
  it('is the sheet 12.4 menu and nothing more', () => {
    // v1 shipped three competing lists. Three lists is three answers to "what
    // can I do here", and the plan records that as a defect. One list, and the
    // count is asserted so a fourth item has to be argued into this test.
    expect(TOOLBELT.map((i) => i.label)).toEqual([
      'Break it down',
      'What breaks',
      'Start a workflow',
      'Reasoning',
    ]);
  });

  it('renders no glyph twice — an icon that means two things means neither', () => {
    const glyphs = TOOLBELT.map((i) => i.icon);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('separates the model picker from the three verbs', () => {
    // Sheet 12.4 draws an <hr> above Models: the three above it change what
    // will be asked, the one below it changes who is asked.
    expect(TOOLBELT.filter((i) => i.separatorBefore).map((i) => i.label)).toEqual(['Reasoning']);
  });
});

describe('slash commands — Decision 4', () => {
  const modes = [
    { mode: 'plan' as const, label: 'Plan', description: 'Reads the repository and changes nothing at all. The turn ends in a written plan.', icon: 'file' as const },
    { mode: 'propose' as const, label: 'Propose', description: 'Every change arrives as a proposal you read and accept. Nothing reaches disk on its own.', icon: 'file' as const },
  ];

  it('IS DERIVED FROM THE KEEPER LISTS, not written out again', () => {
    /*
     * v1 shipped three competing `+` menus and item 2.7 names that as a defect:
     * "three lists is three answers to 'what can I do here'". A hand-written
     * slash list would be the fourth. So every command must trace back to a
     * toolbelt item or a mode that already exists.
     */
    const commands = slashCommands(modes);
    const toolIds = TOOLBELT.map((t) => t.id).sort();
    const covered = commands
      .filter((c) => c.source.kind === 'toolbelt')
      .map((c) => (c.source as { id: string }).id)
      .sort();
    expect(covered).toEqual(toolIds);
    expect(commands.filter((c) => c.source.kind === 'mode').map((c) => c.name)).toEqual([
      'plan',
      'propose',
    ]);
  });

  it('gives every command a typeable name', () => {
    for (const c of slashCommands(modes)) {
      expect(c.name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('opens only at the start of the line', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/pl')).toBe('pl');
    expect(slashQuery('/PLAN')).toBe('plan');
  });

  it('DOES NOT OPEN ON A PATH', () => {
    /*
     * The reason it is anchored. This product's questions are full of paths —
     * `packages/web2/src` — and a menu that opened on those would fight the
     * reader on every one of them. A slash mid-sentence is a separator far more
     * often than it is a command.
     */
    expect(slashQuery('what is packages/web2/src')).toBeNull();
    expect(slashQuery('look at /packages/web2 please')).toBeNull();
    expect(slashQuery('')).toBeNull();
    expect(slashQuery('plan the work')).toBeNull();
  });

  it('ranks an exact prefix above a loose match', () => {
    const commands = slashCommands(modes);
    const hit = slashMatches('pl', commands);
    expect(hit[0].name).toBe('plan');
  });

  it('an empty query offers everything, and an unknown one offers nothing', () => {
    const commands = slashCommands(modes);
    expect(slashMatches('', commands)).toHaveLength(commands.length);
    expect(slashMatches('zzzz', commands)).toEqual([]);
  });
});
