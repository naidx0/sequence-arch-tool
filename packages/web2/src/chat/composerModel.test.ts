import { describe, expect, it } from 'vitest';

import {
  autosizeHeight,
  chipLabel,
  MODEL_CHIP_CHARS,
  deriveSendState,
  keyIntent,
  placeholderFor,
  slashCommands,
  slashInvocation,
  slashMatches,
  slashQuery,
  slashSections,
  slashVisible,
  slashGroupOf,
  SLASH_SECTION_PREVIEW,
  TOOLBELT,
  type SlashCommand,
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
      'Blast radius',
      'Start a workflow',
      'Reasoning',
    ]);
  });

  it('every label stands on its own, because the gloss is a tooltip now', () => {
    /* DECISION 36 — the rows lost their second line, so a label that needed
       its gloss to be understood would be a menu that got shorter by getting
       worse. "What breaks" beside a warning triangle read as an error the
       product was reporting; "Blast radius" is the name of the thing.

       The gloss did not go anywhere — it is the row's `title` — so this
       asserts the pair stayed a pair, and that no label is now a word the
       reader has to hover to decode. */
    for (const item of TOOLBELT) {
      expect(item.hint.length).toBeGreaterThan(0);
      expect(item.label).not.toBe(item.hint);
      expect(item.label.length).toBeGreaterThan(4);
    }
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
    { mode: 'plan' as const, label: 'Plan', description: 'Draws and drafts. File changes arrive as proposals you accept.', icon: 'file' as const },
    { mode: 'build' as const, label: 'Build', description: 'Writes files and runs commands without asking.', icon: 'sensitive' as const },
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
      'build',
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

  /* ── /goal, owner 2026-09-17 ────────────────────────────────────────────── */

  it('OFFERS /goal ONLY WHERE IT CAN BE PERFORMED', () => {
    /*
     * A row that does nothing when picked is worse than a missing row: the
     * reader has been told the product can do something it cannot. `goal` is a
     * session field plus a run, and only the V3 seat owns both, so the default
     * registry does not carry it and `chat/Composer.tsx` — which calls this
     * with no options — never draws it.
     */
    expect(slashCommands(modes).map((c) => c.name)).not.toContain('goal');
    const withGoal = slashCommands(modes, TOOLBELT, { goal: true });
    expect(withGoal.map((c) => c.name)).toContain('goal');
    /* First, because it is the only row that starts long-running work. */
    expect(withGoal[0].name).toBe('goal');
    expect(withGoal[0].source).toEqual({ kind: 'goal' });
  });

  it('leaves the derived rows exactly as they were when goal is added', () => {
    /* The point of the third kind is that it is ADDITIVE. If turning it on
       changed what the toolbelt or the modes produce, the registry would have
       stopped being derived. */
    const plain = slashCommands(modes);
    const withGoal = slashCommands(modes, TOOLBELT, { goal: true });
    expect(withGoal.filter((c) => c.source.kind !== 'goal')).toEqual(plain);
  });

  it('every command, goal included, still has a typeable name', () => {
    for (const c of slashCommands(modes, TOOLBELT, { goal: true })) {
      expect(c.name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('READS THE ARGUMENT THE MENU CANNOT', () => {
    /*
     * `slashQuery` answers "is a menu open" and stops at the first space, which
     * is right for a menu and useless for `/goal <text>` — the words after the
     * name ARE the goal. Two readers, two questions.
     */
    expect(slashQuery('/goal ship the parser guard')).toBeNull();
    expect(slashInvocation('/goal ship the parser guard')).toEqual({
      name: 'goal',
      rest: 'ship the parser guard',
    });
  });

  it('tells a bare command from one with an argument', () => {
    expect(slashInvocation('/goal')).toEqual({ name: 'goal', rest: '' });
    expect(slashInvocation('/goal   ')).toEqual({ name: 'goal', rest: '' });
    expect(slashInvocation('/GOAL Ship It')).toEqual({ name: 'goal', rest: 'Ship It' });
  });

  it('IS ANCHORED, for the same reason the menu is', () => {
    expect(slashInvocation('what is in packages/web2/src')).toBeNull();
    expect(slashInvocation('look at /packages/web2 please')).toBeNull();
    expect(slashInvocation('/')).toBeNull();
    expect(slashInvocation('')).toBeNull();
  });

  it('keeps the argument the reader typed, punctuation and all', () => {
    /* The goal is a sentence a person wrote. Lower-casing or collapsing it
       would be this layer editing their words. */
    expect(slashInvocation('/goal Make /api/ask idempotent — no retries')?.rest).toBe(
      'Make /api/ask idempotent — no retries',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   DECISION 35 — THE PALETTE'S SHELVES

   Owner, 2026-09-19, with a reference shot: Skills over Commands over Modes,
   three rows each, then "Show 44 more". The rule lives in a pure function for
   the reason `goalRunVerdict.ts` gives about stop reasons — a rule that
   decides what a reader is shown cannot be checked by rendering the cases
   nobody thought to render, and those are the ones that matter.
   ══════════════════════════════════════════════════════════════════════════ */

const MODES = [
  { mode: 'plan' as const, label: 'Plan', description: 'Draws and drafts.', icon: 'file' as const },
  { mode: 'build' as const, label: 'Build', description: 'Writes files.', icon: 'hammer' as const },
];

function skills(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    slug: `skill-${i}`,
    name: `Skill ${i}`,
    description: `does thing ${i}`,
  }));
}

describe('slash groups', () => {
  it('reads the shelf off the SOURCE, so it cannot be set wrongly by hand', () => {
    expect(slashGroupOf({ kind: 'skill', slug: 'onboard' })).toBe('skills');
    expect(slashGroupOf({ kind: 'mode', mode: 'plan' })).toBe('modes');
    expect(slashGroupOf({ kind: 'goal' })).toBe('commands');
    expect(slashGroupOf({ kind: 'toolbelt', id: 'break-down' })).toBe('commands');
  });

  it('derives a command per skill, typed by its slug, and none when there are none', () => {
    const none = slashCommands(MODES, TOOLBELT, { goal: true });
    expect(none.some((c) => c.source.kind === 'skill')).toBe(false);

    const withSkills = slashCommands(MODES, TOOLBELT, { goal: true, skills: skills(2) });
    const derived = withSkills.filter((c) => c.source.kind === 'skill');
    expect(derived.map((c) => c.name)).toEqual(['skill-0', 'skill-1']);
    /* The SLUG is what is typed, because the slug is what the directory is
       called and what the engine's own loader keys on. */
    expect(derived[0]!.label).toBe('Skill 0');
    expect(derived[0]!.hint).toBe('does thing 0');
  });
});

describe('slashSections', () => {
  const all = slashCommands(MODES, TOOLBELT, { goal: true, skills: skills(9) });

  it('shelves in a fixed order and caps each shelf at the preview', () => {
    const sections = slashSections(slashMatches('', all));
    expect(sections.map((s) => s.group)).toEqual(['skills', 'commands', 'modes']);
    expect(sections[0]!.items).toHaveLength(SLASH_SECTION_PREVIEW);
    expect(sections[0]!.hidden).toBe(9 - SLASH_SECTION_PREVIEW);
  });

  it('reports ZERO hidden on a shelf that is showing everything', () => {
    /* "Show 0 more" is a row that lies; the count is what decides whether one
       is drawn at all. */
    const sections = slashSections(slashMatches('', all));
    const modes = sections.find((s) => s.group === 'modes')!;
    expect(modes.items).toHaveLength(2);
    expect(modes.hidden).toBe(0);
  });

  it('expands only the shelf that was opened', () => {
    const sections = slashSections(slashMatches('', all), { expanded: new Set(['skills']) });
    expect(sections[0]!.items).toHaveLength(9);
    expect(sections[0]!.hidden).toBe(0);
    expect(sections.find((s) => s.group === 'commands')!.hidden).toBeGreaterThan(0);
  });

  it('A SEARCH SHOWS EVERYTHING IT MATCHED — capping a narrowed list hides the row typed toward', () => {
    const hits = slashMatches('skill', all);
    const capped = slashSections(hits);
    const searching = slashSections(hits, { searching: true });
    expect(capped[0]!.hidden).toBeGreaterThan(0);
    expect(searching[0]!.hidden).toBe(0);
    expect(searching[0]!.items).toHaveLength(9);
  });

  it('draws no heading for a shelf a search emptied', () => {
    const sections = slashSections(slashMatches('plan', all), { searching: true });
    expect(sections.map((s) => s.group)).toEqual(['modes']);
  });

  it('hides nothing at the cap, and nothing at one over it either', () => {
    /* DECISION 36 — one over the cap used to hide one row behind a row that
       said "Show 1 more": a trade that costs a row to save a row and charges
       a click for it, which is the cap doing the opposite of its job. Two
       over is where shelving starts paying. */
    const exact = slashSections(slashMatches('', slashCommands([], [], { skills: skills(SLASH_SECTION_PREVIEW) })));
    expect(exact[0]!.hidden).toBe(0);
    const one = slashSections(slashMatches('', slashCommands([], [], { skills: skills(SLASH_SECTION_PREVIEW + 1) })));
    expect(one[0]!.hidden).toBe(0);
    expect(one[0]!.items).toHaveLength(SLASH_SECTION_PREVIEW + 1);
    const two = slashSections(slashMatches('', slashCommands([], [], { skills: skills(SLASH_SECTION_PREVIEW + 2) })));
    expect(two[0]!.hidden).toBe(2);
    expect(two[0]!.items).toHaveLength(SLASH_SECTION_PREVIEW);
  });
});

describe('slashVisible', () => {
  it('flattens in drawn order, so the keyboard index and the screen agree', () => {
    const all = slashCommands(MODES, TOOLBELT, { goal: true, skills: skills(5) });
    const sections = slashSections(slashMatches('', all));
    const rows = slashVisible(sections);
    expect(rows).toHaveLength(sections.reduce((n, s) => n + s.items.length, 0));
    expect(rows[0]).toBe(sections[0]!.items[0]);
    expect(rows[rows.length - 1]).toBe(sections[sections.length - 1]!.items.at(-1));
    /* Nothing hidden is reachable by arrow — the highlight can never land on a
       row that is not on screen. */
    expect(rows.every((r) => sections.some((s) => s.items.includes(r)))).toBe(true);
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   DECISION 36 — THE MODEL'S NAME, CUT TO WHAT THE COMPOSER ROW CAN SPEND
   ══════════════════════════════════════════════════════════════════════════ */

describe('chipLabel', () => {
  it('leaves a name that already fits completely alone', () => {
    expect(chipLabel('gpt-5')).toBe('gpt-5');
    expect(chipLabel('Opus')).toBe('Opus');
  });

  it('cuts to the chip budget and marks the cut', () => {
    /* NINE since 2026-09-19. Five was the owner's first number and he
       revised it after looking at it: "allow for more length with model
       nickname, maybe around 8-10 characters?" Nine is the middle of the
       range he named, and the point where `minicpm5-hermes` and
       `granite42-hermes` stop reading as the same word. */
    expect(MODEL_CHIP_CHARS).toBe(9);
    expect(chipLabel('qwen2.5-coder-32b-instruct')).toBe('qwen2.5-c…');
    expect(chipLabel('Sonnet')).toBe('Sonnet');
    expect(chipLabel('minicpm5-hermes')).toBe('minicpm5-…');
  });

  it('never leaves a space before the mark', () => {
    /* "Sonnet 4 …" reads as a typo; "Sonnet 4…" reads as a cut. The trim is
       why this is a function and not a `slice` at the call site. */
    expect(chipLabel('Sonnet 4 turbo')).toBe('Sonnet 4…');
  });

  it('gives every model the same chip, which is the whole point', () => {
    /* A CSS ellipsis would size the chip by the name, so the row's three
       controls would land somewhere different for every model and Send —
       the thing the reader is aiming at — would move when they switched. */
    const widths = ['gpt-5o-mini-high', 'claude-opus-5', 'llama3.3:70b'].map(
      (n) => chipLabel(n).length,
    );
    expect(new Set(widths).size).toBe(1);
  });

  it('is empty for an empty name rather than a bare ellipsis', () => {
    expect(chipLabel('')).toBe('');
    expect(chipLabel('   ')).toBe('');
  });
});
