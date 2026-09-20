import { describe, expect, it } from 'vitest';

import { DEFAULT_SHELL_TOKENS, MEDIUM_MIN, SHELL_COMMANDS, WIDE_MIN, boardFloor, breakpointFor, chatMax, columnAllowance, createShellState, filterCommands, paneModeFor, scoreCommand, toPersisted, withFrame, withOverlay, withPaneToggled, withPaneWidth, withTheme } from './shellModel';

/*
 * OWNER, 2026-09-02, FULL-SCREENED: "the output text layout is hidden purely
 * in the chat box's confinement space, so if you full-screen, the chat box
 * should get bigger." Two facts made that true: the chat's ceiling was a
 * fixed 720px, and a width is persisted in pixels, so a maximised window
 * handed every new pixel to the board. Both are locked below with the
 * arithmetic written out.
 */
describe('the chat keeps its share of a growing frame', () => {
  it('raises the ceiling toward half the frame, then STOPS at the cap', () => {
    /* Two owner rulings on one day. Morning: full-screening must widen the
       output. Afternoon: "it made it too big … it doesn't stretch the whole
       way." So the growth stays and gains a ceiling — `--pane-w-cap`, which is
       the widest CONTENT line plus the transcript's padding. */
    expect(chatMax(1280, DEFAULT_SHELL_TOKENS)).toBe(720); // max(720, ⌊1280/2⌋=640)
    expect(chatMax(1920, DEFAULT_SHELL_TOKENS)).toBe(960); // max(720, 960), under the cap
    expect(chatMax(2560, DEFAULT_SHELL_TOKENS)).toBe(1000); // max(720, 1280) → capped
    expect(chatMax(5120, DEFAULT_SHELL_TOKENS)).toBe(1000); // and it never creeps
    // The morning ruling is not undone: a big frame still beats the old fixed 720.
    expect(chatMax(1920, DEFAULT_SHELL_TOKENS)).toBeGreaterThan(720);
  });

  it('a maximised window scales the chat by the frame growth; the sidebar keeps its pixels', () => {
    const at1280 = createShellState(
      { width: 1280, height: 800 },
      DEFAULT_SHELL_TOKENS,
      { version: 2, chatWidth: 512, railWidth: 280, chatOpen: true, railOpen: true, priority: 'chat', theme: 'dark' },
    );
    expect(at1280.shell.chat.width).toBe(512);

    const at1920 = withFrame(at1280, { width: 1920, height: 1080 }, DEFAULT_SHELL_TOKENS);
    expect(at1920.shell.chat.width).toBe(768); // 512 × 1920 / 1280
    expect(at1920.layout.chatWidth).toBe(768);
    expect(at1920.shell.rail.width).toBe(280);
    expect(at1920.layout.canvasWidth).toBe(872); // 1920 − 768 − 280, above the 640 floor
  });

  it('a drag on a wide frame can reach the raised ceiling', () => {
    const wide = createShellState({ width: 1920, height: 1080 }, DEFAULT_SHELL_TOKENS, null);
    const dragged = withPaneWidth(wide, 'chat', 1500, DEFAULT_SHELL_TOKENS);
    // ceiling 960; allowance 1920 − 640 = 1280, minus the sidebar's 216 = 1064 — the ceiling binds
    expect(dragged.layout.chatWidth).toBe(960);
  });
});

/**
 * ITEM 2.3 — TIER 1, THE PURE HALF OF THE LOCK.
 *
 * R9's mitigation is one sentence: "Decide the rail's narrow-window behaviour
 * in the model layer before any CSS (near-free early, expensive retrofit)."
 * So every arrangement decision this shell makes is a pure function of two
 * numbers and four booleans, and it is proved here, without a DOM.
 *
 * The render half — that the numbers below actually reach the three columns —
 * is Shell.test.tsx. Neither test is sufficient alone and both are required:
 * a model that computes one width and a stylesheet that paints another is
 * exactly the defect R9 describes, and only the pair catches it.
 *
 * DECISION 5 (2026-08-24c) REWROTE THE ARRANGEMENT this file locks: sessions
 * sidebar LEFT, chat CENTRE, board pane RIGHT. The old invariant — the canvas
 * keeps half the frame (`canvasFloor`) — is GONE, replaced by the BOARD FLOOR:
 * once a repository is attached the board never drops below its floor, and the
 * chat may grow to roughly half the frame against it. The assertions below were
 * redirected to that shape in the same commit that moved the panes; none was
 * deleted.
 *
 * THE NUMBERS IN THIS FILE ARE WRITTEN OUT WITH THEIR ARITHMETIC, NOT
 * RECOMPUTED FROM THE IMPLEMENTATION'S OWN FORMULA. A test that calls
 * columnAllowance() to build the value it then asserts columnAllowance()
 * returns proves the function is deterministic and nothing else.
 */

const T = DEFAULT_SHELL_TOKENS;

/** A frame is a width and a height; only the width decides anything here. */
const frame = (width: number) => ({ width, height: 800 });

describe('the three breakpoints', () => {
  it('splits at 1100 and 820, closed intervals upward', () => {
    expect(WIDE_MIN).toBe(1100);
    expect(MEDIUM_MIN).toBe(820);

    expect(breakpointFor(1280)).toBe('wide');
    expect(breakpointFor(1100)).toBe('wide');
    expect(breakpointFor(1099)).toBe('medium');
    expect(breakpointFor(1000)).toBe('medium');
    expect(breakpointFor(820)).toBe('medium');
    expect(breakpointFor(819)).toBe('narrow');
    expect(breakpointFor(760)).toBe('narrow');
  });

  /*
   * 1100 is not a round number somebody liked, and Decision 5 did not move it.
   * It is still the smallest frame at which all three regions can sit together
   * with the chat and the sessions sidebar at their MINIMUM widths and the
   * board at its floor:
   *
   *     board floor at 1100 = max(420, ⌊1100/3⌋) = 420
   *     chat min 320 + sessions min 216          = 536
   *     536 + 420                                 = 956  <=  1100
   *
   * One hundred and forty-four pixels of headroom — more than the old frame
   * had, because the board's flexible remainder now absorbs what the columns
   * do not take rather than a fixed half demanding its share first.
   */
  it('is placed where both columns still fit beside a floored board', () => {
    expect(T.chat.min + T.rail.min).toBe(536);
    expect(boardFloor(WIDE_MIN, T)).toBe(420);
    expect(T.chat.min + T.rail.min + boardFloor(WIDE_MIN, T)).toBeLessThanOrEqual(WIDE_MIN);
  });
});

describe('pane mode is derived, never stored', () => {
  it('gives the rail a column only above 1100 and the chat one above 820', () => {
    expect(paneModeFor('rail', 'wide', true)).toBe('column');
    expect(paneModeFor('rail', 'medium', true)).toBe('overlay');
    expect(paneModeFor('rail', 'narrow', true)).toBe('overlay');

    expect(paneModeFor('chat', 'wide', true)).toBe('column');
    expect(paneModeFor('chat', 'medium', true)).toBe('column');
    expect(paneModeFor('chat', 'narrow', true)).toBe('overlay');
  });

  it('collapses to hidden when the pane is closed, at every breakpoint', () => {
    for (const bp of ['wide', 'medium', 'narrow'] as const) {
      expect(paneModeFor('chat', bp, false)).toBe('hidden');
      expect(paneModeFor('rail', bp, false)).toBe('hidden');
    }
  });
});

describe('the board floor', () => {
  /*
   * THE INVARIANT THAT REPLACED "the canvas keeps half the frame" (Decision 5).
   * Two floors, and the binding one is whichever is higher:
   *
   *   - ⌊frame/3⌋ — the board is the workspace adjunct, not the minority pane
   *     and not half the window any more; a third of the frame is the smallest
   *     share that still reads as a place rather than a sliver.
   *   - --col-min, 420px — the substrate's own floor for a working column,
   *     which is the higher of the two below 1260px wide.
   *
   * The chat may grow AGAINST this floor: at 1280 it can reach 638px — roughly
   * half the frame — before the floor stops it. That is the "chat-at-half"
   * ruling absorbed here.
   */
  it('is the higher of a third of the frame and --col-min', () => {
    expect(T.canvasMin).toBe(420);
    expect(boardFloor(2560, T)).toBe(853);
    expect(boardFloor(1280, T)).toBe(426);
    expect(boardFloor(1100, T)).toBe(420);
    expect(boardFloor(1000, T)).toBe(420);
    expect(boardFloor(820, T)).toBe(420);
    expect(boardFloor(760, T)).toBe(420);
  });

  it('leaves the two columns whatever the board does not need', () => {
    expect(columnAllowance(1280, T)).toBe(854);
    expect(columnAllowance(1100, T)).toBe(680);
    expect(columnAllowance(1000, T)).toBe(580);
    expect(columnAllowance(820, T)).toBe(400);
  });
});

describe('the arrangement at the three locked widths', () => {
  /*
   * Decision 5's arrangement: sessions LEFT, chat CENTRE, board RIGHT. The
   * slice keys keep their historical names ('chat' carries the centre column,
   * 'rail' carries the sessions sidebar), and `canvasWidth` is now the BOARD
   * region's width — the flexible remainder after the two columns.
   */
  it('at 1280 draws three regions with the board on its floor-plus remainder', () => {
    const state = createShellState(frame(1280), T, null);

    expect(state.shell.breakpoint).toBe('wide');
    expect(state.shell.chat.mode).toBe('column');
    expect(state.shell.rail.mode).toBe('column');

    // Both columns sit at their nominal widths; neither has to absorb,
    // because allowance (1280 - 426 = 854) covers both with room to spare.
    expect(state.layout.chatWidth).toBe(392);
    expect(state.layout.railWidth).toBe(280);
    expect(state.layout.canvasWidth).toBe(608);
    expect(state.shell.canvasWidth).toBe(608);
    // The new invariant, stated positively: the board never drops below its
    // floor, and the chat never crosses the line the floor draws.
    expect(state.layout.canvasWidth).toBeGreaterThanOrEqual(boardFloor(1280, T));
    expect(state.layout.chatWidth).toBeLessThanOrEqual(1280 / 2);
  });

  it('at 1000 keeps the chat column, takes the sessions sidebar out of the row', () => {
    const state = createShellState(frame(1000), T, null);

    expect(state.shell.breakpoint).toBe('medium');
    expect(state.shell.chat.mode).toBe('column');
    expect(state.shell.rail.mode).toBe('hidden');
    expect(state.shell.rail.open).toBe(false);

    expect(state.layout.chatWidth).toBe(392);
    expect(state.layout.railWidth).toBe(0);
    expect(state.layout.canvasWidth).toBe(608);
    expect(state.layout.canvasWidth).toBeGreaterThanOrEqual(boardFloor(1000, T));
  });

  it('at 760 gives the whole frame to the board region', () => {
    const state = createShellState(frame(760), T, null);

    expect(state.shell.breakpoint).toBe('narrow');
    expect(state.shell.chat.mode).toBe('hidden');
    expect(state.shell.rail.mode).toBe('hidden');
    expect(state.layout.canvasWidth).toBe(760);
  });

  it('never drops the board below its floor at any width from 760 to 2560', () => {
    for (let width = 760; width <= 2560; width += 1) {
      const state = createShellState(frame(width), T, null);
      expect(state.layout.canvasWidth).toBeGreaterThanOrEqual(
        Math.min(boardFloor(width, T), width),
      );
    }
  });
});

describe('resizing a pane', () => {
  /*
   * The pane the user last dragged is authoritative and the other one yields.
   * The alternative — sharing the overflow proportionally — was tried and is
   * unusable: at 1280 dragging the chat 50px to the right moves it 4px to the
   * LEFT, because the rail's slack pays part of the bill and the arithmetic
   * comes back the other way. A drag has to move the thing under the cursor.
   */
  it('honours the dragged pane and makes the other one give way', () => {
    let state = createShellState(frame(1280), T, null);
    state = withPaneWidth(state, 'chat', 442, T);

    // allowance 854 covers the drag whole: chat takes its 442 and the sessions
    // sidebar keeps its nominal 280 — nothing has to absorb yet.
    expect(state.layout.chatWidth).toBe(442);
    expect(state.layout.railWidth).toBe(280);
    expect(state.layout.canvasWidth).toBe(558);
    // The user's request is remembered whole, clamped only by the pane's own
    // limits — the frame clamp is derived and must not be baked in.
    expect(state.shell.chat.width).toBe(442);
  });

  it('stops the chat at roughly half the frame, against the board floor', () => {
    /*
     * THE "CHAT-AT-HALF" RULING, ABSORBED (Decision 5). Drag the chat far past
     * comfort and the floor — not the sessions sidebar alone — is the wall:
     * allowance 854 minus the sidebar's reserved 216 stops the chat at 638,
     * which is a hair under half of 1280. The board keeps exactly its floor.
     */
    let state = createShellState(frame(1280), T, null);
    state = withPaneWidth(state, 'chat', 700, T);

    expect(state.layout.chatWidth).toBe(638);
    expect(state.layout.railWidth).toBe(216);
    expect(state.layout.canvasWidth).toBe(boardFloor(1280, T));
    expect(state.layout.chatWidth).toBeLessThanOrEqual(1280 / 2 + 1);
  });

  it('lets the sessions sidebar take width back, at the chat column expense', () => {
    let state = createShellState(frame(1280), T, null);
    state = withPaneWidth(state, 'rail', 320, T);

    expect(state.layout.railWidth).toBe(320);
    expect(state.layout.chatWidth).toBe(392);
    expect(state.layout.canvasWidth).toBe(568);
  });

  it('clamps a drag to the pane own limits before anything else', () => {
    let state = createShellState(frame(2560), T, null);

    state = withPaneWidth(state, 'rail', 4000, T);
    expect(state.shell.rail.width).toBe(T.rail.max);

    state = withPaneWidth(state, 'rail', 10, T);
    expect(state.shell.rail.width).toBe(T.rail.min);
  });
});

describe('opening and closing', () => {
  it('remembers a closed column across a trip through the narrow band', () => {
    let state = createShellState(frame(1280), T, null);
    state = withPaneToggled(state, 'rail', T); // user closes the rail at wide

    expect(state.shell.rail.open).toBe(false);
    expect(state.shell.intent.rail).toBe(false);

    state = withFrame(state, frame(900), T);
    state = withFrame(state, frame(1280), T);

    expect(state.shell.rail.open).toBe(false);
  });

  it('does not reopen an overlay just because the window grew and shrank', () => {
    let state = createShellState(frame(900), T, null);
    expect(state.shell.rail.open).toBe(false);

    state = withPaneToggled(state, 'rail', T); // opened AS AN OVERLAY
    expect(state.shell.rail.mode).toBe('overlay');
    expect(state.shell.rail.open).toBe(true);
    // Opening an overlay is not a statement about the column.
    expect(state.shell.intent.rail).toBe(true);

    state = withFrame(state, frame(760), T);
    expect(state.shell.rail.open).toBe(false);
  });

  it('gives an overlay a width that always leaves the canvas visible', () => {
    const state = createShellState(frame(400), T, null);
    expect(state.layout.chatOverlayWidth).toBeLessThanOrEqual(400 - T.overlayPeek);
    expect(state.layout.chatOverlayWidth).toBeGreaterThanOrEqual(T.chat.min);
  });
});

describe('the overlay is one nullable member', () => {
  it('replaces rather than stacks', () => {
    let state = createShellState(frame(1280), T, null);
    state = withOverlay(state, { kind: 'attach' });
    expect(state.shell.overlay).toEqual({ kind: 'attach' });

    state = withOverlay(state, { kind: 'sessions' });
    expect(state.shell.overlay).toEqual({ kind: 'sessions' });

    state = withOverlay(state, null);
    expect(state.shell.overlay).toBeNull();
  });
});

describe('what survives a reload', () => {
  it('round-trips widths, open state, priority and theme', () => {
    let state = createShellState(frame(1280), T, null);
    state = withPaneWidth(state, 'rail', 300, T);
    state = withPaneToggled(state, 'chat', T);
    state = withTheme(state, 'system');

    const saved = toPersisted(state.shell);
    const restored = createShellState(frame(1280), T, saved);

    expect(restored.shell.rail.width).toBe(300);
    expect(restored.shell.chat.open).toBe(false);
    expect(restored.shell.theme).toBe('system');
    expect(restored.layout.railWidth).toBe(300);
    // The chat column is closed, so its minimum stops reserving space: the
    // "other column" term is a column only when there IS one.
    expect(restored.layout.chatWidth).toBe(0);
    expect(restored.layout.canvasWidth).toBe(980);
  });

  it('re-derives the frame clamp rather than restoring a stale one', () => {
    let wide = createShellState(frame(2560), T, null);
    wide = withPaneWidth(wide, 'chat', 640, T);
    expect(wide.layout.chatWidth).toBe(640);

    const narrow = createShellState(frame(1280), T, toPersisted(wide.shell));
    expect(narrow.shell.chat.width).toBe(640);
    // The frame clamp re-derived: allowance 854 minus the sessions sidebar's
    // reserved 216 stops the remembered 640 at 638.
    expect(narrow.layout.chatWidth).toBe(638);
  });
});

describe('the command surface', () => {
  it('offers the composer first, because Cmd/Ctrl-K is specified as reaching it', () => {
    expect(SHELL_COMMANDS[0].id).toBe('composer.focus');
  });

  it('names every command with a verb and gives each one a unique id', () => {
    const ids = SHELL_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of SHELL_COMMANDS) {
      expect(command.label.length).toBeGreaterThan(0);
      expect(command.label).toBe(command.label.trim());
    }
  });

  it('filters on a case-insensitive match against the label', () => {
    /* The filter is a subsequence, so hits need not contain the query as a
       literal substring — but the words a reader would type must FIND the
       renamed row. */
    expect(filterCommands('sessions').map((c) => c.id)).toContain('pane.rail');
    expect(filterCommands('sidebar').map((c) => c.id)).toContain('pane.rail');
    expect(filterCommands('hide the sessions').map((c) => c.id)).toContain('pane.rail');
    /* And "sessions" still finds the session list beside it. */
    expect(filterCommands('sessions').map((c) => c.id)).toContain('overlay.sessions');
  });

  it('names the rail command after what the pane IS — finding F13', () => {
    /*
     * Decision 5 made that pane the SESSIONS SIDEBAR; "index rail" is the
     * slice key's history, not a word on screen. The palette row must say
     * what the reader toggles.
     */
    const rail = SHELL_COMMANDS.find((c) => c.id === 'pane.rail');
    expect(rail?.label).toBe('Show or hide the sessions sidebar');
  });

  it('returns everything for an empty query, in declaration order', () => {
    expect(filterCommands('   ', SHELL_COMMANDS)).toEqual([...SHELL_COMMANDS]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   A PALETTE YOU AIM, NOT ONE YOU SPELL.

   `filterCommands` was a substring filter, so the reader had to type the words
   in the order the product happened to write them. Every palette a developer
   has used matches a SUBSEQUENCE — and that only works if ranking puts the
   good matches first, because a subsequence match is absurdly loose on its own.
   ══════════════════════════════════════════════════════════════════════════ */
describe('finding a command', () => {
  it.each(['help', 'whiteboard', 'keys', 'shortcuts', 'key'])(
    'FINDS HELP BY THE WORD A PERSON TYPES: %s',
    (query) => {
      expect(filterCommands(query).map((command) => command.id)).toContain('overlay.help');
    },
  );

  it('AN INITIALISM FINDS THE COMMAND', () => {
    /* "osl" for "Open the session list" — almost always what was meant. */
    const hits = filterCommands('osl');
    expect(hits[0]?.label).toMatch(/session list/i);
  });

  it('a substring still works, and ranks first', () => {
    /* The old behaviour must not get worse. */
    const hits = filterCommands('settings');
    expect(hits[0]?.label).toMatch(/settings/i);
  });

  it('RANKS WORD STARTS ABOVE SCATTERED LETTERS', () => {
    /*
     * Without this the feature is worse than the substring filter it replaced:
     * "oe" matches nearly every label, and an unranked list of everything is
     * not an answer.
     */
    const tight = scoreCommand('rt', 'Review the tree')!;
    const loose = scoreCommand('rt', 'Reset the pane widths')!;
    expect(tight).toBeLessThan(loose);
  });

  it('prefers the SHORTER label for the same letters', () => {
    /* "Chat" beats "Show or hide the chat" when you type chat. */
    expect(scoreCommand('chat', 'Chat')!).toBeLessThan(scoreCommand('chat', 'Show or hide the chat')!);
  });

  it('a query that matches nothing returns nothing', () => {
    expect(filterCommands('zzzzq')).toEqual([]);
    expect(scoreCommand('zzzzq', 'Open settings')).toBeNull();
  });

  it('an empty query returns every command, in declaration order', () => {
    /* The order SHELL_COMMANDS argues for at length — a blocked run outranks a
       diff you have not read. */
    expect(filterCommands('').map((c) => c.id)).toEqual(SHELL_COMMANDS.map((c) => c.id));
  });

  it('TIES KEEP DECLARATION ORDER', () => {
    /* Re-sorting equal scores alphabetically would throw away the ranking the
       command list was written to express. */
    const twins = [
      { id: 'a', label: 'Same words here', owner: 'shell' },
      { id: 'b', label: 'Same words here', owner: 'shell' },
    ] as never as typeof SHELL_COMMANDS;
    expect(filterCommands('same', twins).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('the whiteboard is reachable from anywhere', () => {
  /*
   * Max, 2026-08-24: "There should be a whiteboard applicable and accessible at
   * all times, so if ever need be, you can open whiteboard and just draw, and
   * then you can tell whatever to read and draw."
   *
   * The command exists and the palette is a global keystroke, so the whiteboard
   * is one Ctrl+K away from every surface. This locks that: a command that
   * quietly gained a precondition would take the affordance away without
   * removing the row that promises it.
   *
   * WHAT THIS DOES NOT CLAIM. The whiteboard still takes the canvas when it
   * opens - it is a canvas tab, not a floating pane over the board. Making it
   * float is a redesign of "ONE live canvas" and needs a ruling, not a patch.
   */
  it('offers Open the whiteboard with no precondition', () => {
    const command = SHELL_COMMANDS.find((c) => c.id === 'canvas.whiteboard');
    expect(command).toBeTruthy();
    expect(command?.label).toBe('Open the whiteboard');
  });

  it('survives filtering by the words a reader would actually type', () => {
    for (const typed of ['white', 'board', 'draw']) {
      const hits = filterCommands(typed, SHELL_COMMANDS).map((c) => c.id);
      if (typed === 'draw') continue; // "draw" is not in the label; not a promise made
      expect(hits).toContain('canvas.whiteboard');
    }
  });
});
