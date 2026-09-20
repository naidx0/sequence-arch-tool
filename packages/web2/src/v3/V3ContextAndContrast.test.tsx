import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import v3Source from './v3.css?raw';
import { resolvedStyle, substituteVars } from '../../test/support/css';
import { createStore, StoreProvider, type Store } from '../state';
import '../tokens/graphite.css';
import '../styles/base.css';
import '../chat/chat.css';
import './v3.css';
import { V3Chat } from './V3Chat';

/**
 * TWO OWNER REPORTS FROM THE 2026-09-17 WALK, both about what the composer and
 * the live HUD say to a person reading them:
 *
 *   "I don't see a context window — how many tokens are in my context window?"
 *   …and the live explanation under "Working" is too faint to read.
 *
 * The first was a ring with both of its terms hidden behind a click, and a
 * container-query step that deleted the ring entirely below 380px. The second
 * was caption ink on the one block of text a person actually watches.
 */

function token(name: string): string {
  return substituteVars(`var(${name})`, document.documentElement);
}

/** The text of the at-rule that starts `source`, up to its own closing brace at
 *  column 0. Nested rules close at an indent, so this cannot cut short. */
function blockOf(source: string): string {
  const end = source.indexOf('\n}');
  expect(end, 'the at-rule never closes at column 0').toBeGreaterThan(0);
  return source.slice(0, end + 2);
}

function meteredStore(): Store {
  const store = createStore({});
  store.dispatch({ type: 'composer/context-window', tokens: 32_000 } as never);
  store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
  store.dispatch({ type: 'turn/send', at: 1 });
  store.dispatch({
    type: 'turn/event',
    at: 2,
    event: { type: 'usage', inputTokens: 3_600, outputTokens: 120, estimated: false },
  } as never);
  return store;
}

function draw(store: Store): void {
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat />
      </div>
    </StoreProvider>,
  );
}

describe('the context window is legible without a click', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  /**
   * DECISION 31 REVERSED THE 2026-09-17 FIX, and this pair of cases is where
   * that is recorded. The pair used to be printed beside the ring because the
   * owner could not find it; he then looked at the printed pair on the built
   * app and said: "in every single rendering the context ring should just be a
   * ring; there's no 'out of 130K context'. When you hover it or click on it,
   * it will show the details."
   *
   * The 09-17 complaint is still answered - both numbers are still one gesture
   * away and still in the ring's accessible name - but the composer row is an
   * arc and nothing else. Checked HERE and not only in `ContextRing.test.tsx`
   * because this is the only place the ring renders inside the real composer,
   * and a count re-added by the SURFACE would be invisible to the component's
   * own test.
   */
  it('THE COMPOSER ROW HOLDS THE ARC AND NO NUMBER', () => {
    draw(meteredStore());
    expect(screen.getByTestId('composer-context')).toBeTruthy();
    expect(screen.queryByTestId('v3-context-count')).toBeNull();

    /* DERIVED, NOT LISTED: every element on the composer's foot is asked
       whether it prints a count against a window, so a pair re-added under a
       new testid or a new class fails here too. */
    const foot = document.querySelector('.v3-composer-foot') as HTMLElement;
    const printed = [...foot.querySelectorAll('*')].filter((el) =>
      /\d[\d,.]*\s*(k|K|M)?\s*\/|\bof\s+\d/.test(el.textContent ?? ''),
    );
    expect(printed.map((el) => el.textContent)).toEqual([]);
  });

  it('the ring still names both numbers in full for a reader who cannot see it', () => {
    draw(meteredStore());
    const ring = screen.getByTestId('composer-context');
    expect(ring.getAttribute('aria-label')).toMatch(/3,600/);
    expect(ring.getAttribute('aria-label')).toMatch(/32,000/);
    /* And no native tooltip competing with the panel the ring opens. */
    expect(ring.getAttribute('title')).toBeNull();
  });

  /**
   * Owner, 2026-09-18, on the installed app: "it should open more information
   * in that window instead of showing 0 out of 131,000 on the main page…
   * remove the small text elements: 'last provider call, not the sum', 'usage
   * not yet measured for this model' — you say 0 / 131k and show a breakdown
   * depending on how much is done, that's all."
   *
   * Checked HERE as well as in `ContextRing.test.tsx` because this is the only
   * place the ring is rendered inside the real composer, with the real store
   * and the real stylesheet — a popover that is clean in isolation and picks up
   * a sentence from the surface around it is still a popover with a sentence
   * in it.
   */
  it('the popover the composer opens is a measurement, not an explanation', () => {
    draw(meteredStore());
    fireEvent.click(screen.getByTestId('composer-context'));
    const panel = screen.getByTestId('composer-context-breakdown');
    const text = panel.textContent ?? '';
    for (const gone of [/last provider call/i, /not the sum/i, /not yet measured/i]) {
      expect(text, `the composer's popover still explains itself: ${gone}`).not.toMatch(gone);
    }
    /* The header line is the pair, and since Decision 31 it is the ONLY place
       the pair is drawn — one measurement, one rounding, and no second copy on
       the composer row to drift against. */
    expect(screen.getByTestId('composer-context-label').textContent).toBe('3.6k / 32k');
    /* This store meters a turn but carries no sections, and the panel says only
       that — it does not invent a slice to fill the bar. */
    expect(screen.queryByTestId('composer-context-bar')).toBeNull();
    expect(screen.getByTestId('composer-context-breakdown-empty').textContent).toBe(
      'no breakdown on this turn',
    );
  });

  /*
   * ── WHAT THIS CHECK READS ────────────────────────────────────────────────
   *
   * The stylesheet's own text, imported with `?raw`. jsdom does not evaluate
   * `@container` at all, so a computed-style assertion here would pass whether
   * or not the rule existed — the most expensive kind of green. Reading the
   * source is narrower and honest about itself: it proves the DECLARATION is
   * gone, not that a 300px composer renders a ring.
   */
  it('NO CONTAINER STEP EVER HIDES THE RING', () => {
    const steps = v3Source.split('@container').slice(1);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      const body = blockOf(`@container${step}`);
      if (/ctxring/.test(body)) {
        expect(body, 'a container step still hides the context ring').not.toMatch(
          /display:\s*none/,
        );
      }
    }
  });

  it('drops Send\'s word below 420px, never the ring, and has no number left to drop', () => {
    const body = blockOf(
      v3Source.slice(v3Source.indexOf('@container composer (max-width: 419.98px)')),
    );
    expect(body).toMatch(/v3-btn-send/);
    expect(body).toMatch(/font-size:\s*0/);
    expect(body).not.toMatch(/ctxring/);
    /* AND THE CLASS IS GONE FROM THE WHOLE SHEET, not merely from this step.
       A rule hiding a count at 419px is a rule that expects a count to exist
       at 421, which Decision 31 says it does not. */
    expect(v3Source).not.toContain('v3-ctx-label');
  });
});

describe.each(['white', 'blue'] as const)('chosen is unmistakable under the %s accent', (accent) => {
  /*
   * DECISION 30, the third channel check, RENDERED. graphite.test.ts locks the
   * three deltas in the token sheet; this asks the cascade what a mode row
   * actually paints, which is the question a token cannot answer — a rule that
   * never reaches the element is a token that resolves to nothing.
   *
   * The modes are Plan, Build and Teach (`MODE_ROWS` in V3Chat.tsx); there is
   * no Ask row in this build. Each is drawn with the same two classes, so one
   * chosen row against one not-chosen row is the whole claim.
   */
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-accent', accent);
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-accent');
  });

  function modeRows(): { chosen: HTMLElement; other: HTMLElement; host: HTMLElement } {
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="v3-mode-pop">' +
      '<button class="is-selected"><span class="v3-mode-pop-label">Build</span></button>' +
      '<button><span class="v3-mode-pop-label">Teach</span></button>' +
      '</div>';
    document.body.appendChild(host);
    const [chosen, other] = Array.from(host.querySelectorAll('button')) as HTMLElement[];
    return { chosen, other, host };
  }

  it('gives the chosen mode a fill, a rim and a weight its neighbour does not have', () => {
    const { chosen, other, host } = modeRows();

    /* FILL — the chosen row takes the chosen fill; the resting row takes none. */
    expect(resolvedStyle(chosen, 'background')).toBe(token('--accent-chosen'));
    expect(resolvedStyle(other, 'background')).toBe('transparent');

    /* RIM — the chosen row carries --accent-chosen-edge; the resting row has no
       box-shadow at all. */
    expect(resolvedStyle(chosen, 'box-shadow')).toContain(token('--accent-chosen-edge'));
    expect(resolvedStyle(other, 'box-shadow')).toBe('');

    /* AND NOTHING ELSE IS IN THAT SHADOW. The rim is the whole of it: the lit
       top edge this rule used to carry came off when the owner read the built
       app as shiny (Decision 30). This assertion is the lock ON ITS ABSENCE -
       it used to assert the highlight was there. */
    expect(resolvedStyle(chosen, 'box-shadow')).not.toContain(token('--glass-ctl-hi'));
    expect(resolvedStyle(chosen, 'box-shadow')).not.toMatch(/inset 0 var\(--w-hair\)/);

    /* INK — a different token, and a heavier label. */
    expect(resolvedStyle(chosen, 'color')).toBe(token('--accent-chosen-ink'));
    expect(resolvedStyle(chosen, 'color')).not.toBe(resolvedStyle(other, 'color'));
    const label = chosen.querySelector('.v3-mode-pop-label') as HTMLElement;
    expect(resolvedStyle(label, 'font-weight')).toBe(token('--fw-head'));

    host.remove();
  });

  /**
   * DECISION 31 - THE THREE MODES CARRY THREE HINTS, AND THEY ARE THREE.
   *
   * Owner, 2026-09-18: "the different modes, like Build, Plan, Teach, should be
   * coloured… Small - not standing out."
   *
   * THE PROPERTY IS ABOUT THE SET, NOT ABOUT ANY ROW. Asserting that Plan is
   * blue three times over would pass with one rule copied three times and the
   * selectors mistyped, which is the exact failure a per-item check cannot see.
   * So the three rims are collected and the SIZE OF THE SET is the assertion:
   * three chosen modes, three distinct rims, and none of them the accent's.
   */
  it('gives each chosen mode its own hint rim, and gives the three of them three', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="v3-mode-pop">' +
      ['plan', 'build', 'teach']
        .map(
          (mode) =>
            `<button class="is-selected" data-mode="${mode}">` +
            `<svg class="i"></svg><span class="v3-mode-pop-label">${mode}</span></button>`,
        )
        .join('') +
      '</div>';
    document.body.appendChild(host);
    const rows = [...host.querySelectorAll('button')] as HTMLElement[];

    const rims = rows.map((row) => resolvedStyle(row, 'box-shadow'));
    const fills = rows.map((row) => resolvedStyle(row, 'background'));
    const glyphs = rows.map((row) =>
      resolvedStyle(row.querySelector('.i') as HTMLElement, 'color'),
    );

    expect(new Set(rims).size, `three modes, ${new Set(rims).size} rims`).toBe(3);
    expect(new Set(fills).size).toBe(3);
    expect(new Set(glyphs).size).toBe(3);

    /* Each names the hue its mode is assigned, so a set of three that happened
       to be three WRONG hues still fails. */
    /* YELLOW FOR BUILD SINCE 2026-09-19 (owner: "I don't like the green
       colour - use yellow for build instead of green"). Green kept the one
       claim it already had elsewhere, the done mark on a todo row, so the
       change made the hue budget shorter by one collision rather than longer
       by one hue. */
    expect(rims[0]).toContain(token('--hint-blue-rim'));
    expect(rims[1]).toContain(token('--hint-yellow-rim'));
    expect(rims[2]).toContain(token('--hint-purple-rim'));
    expect(glyphs).toEqual([
      token('--hint-blue'),
      token('--hint-yellow'),
      token('--hint-purple'),
    ]);

    /* A HINT, NOT PAINT. The fill is the hue at wash strength - the same alpha
       band the white chosen fill sat in - and never the hue itself, which would
       be the filled coloured button this decision refuses. */
    expect(fills[0]).toBe(token('--hint-blue-wash'));
    expect(fills[0]).not.toBe(token('--hint-blue'));

    /* AND THE ACCENT'S RIM IS GONE FROM THEM. If --accent-chosen-edge survived
       beside the hint, a chosen mode would be wearing two rims and the hue
       would be decoration rather than the state. */
    for (const rim of rims) expect(rim).not.toContain(token('--accent-chosen-edge'));

    host.remove();
  });

  it('HOVER IS NOT CHOSEN — the quiet wash, not the chosen fill', () => {
    /* The two used to share one declaration, so the mode a person was merely
       pointing at looked exactly like the mode they were in, on the one menu
       whose whole job is to say which mode they are in. */
    const source = blockOf(v3Source.slice(v3Source.indexOf('.v3-mode-pop button:hover')));
    expect(source).toContain('--glass-hover');
    expect(source).not.toContain('--accent-chosen');
  });

  it('paints no reflection anywhere in the chrome sheet', () => {
    /* --glass-sheen is a diagonal white gradient, and a gradient that brightens
       toward one corner is a REFLECTION - the one thing frosted glass does not
       do. No rule in this sheet may paint one. */
    expect(v3Source).not.toContain('--glass-sheen');
    expect(v3Source).not.toMatch(/background-image:\s*linear-gradient\([^)]*rgba\(255/);
  });

  it('Send is the ONE solid, and it carries the inverted ink', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button class="v3-btn-send">Send</button>';
    document.body.appendChild(host);
    const send = host.querySelector('.v3-btn-send') as HTMLElement;
    expect(resolvedStyle(send, 'background')).toBe(token('--accent-solid'));
    expect(resolvedStyle(send, 'color')).toBe(token('--accent-on-solid'));
    host.remove();
  });
});

describe('the chrome tab is one pill', () => {
  /*
   * Owner, 2026-09-18: "the chrome surface board should only show the x when
   * hovered, not have a separate section for that."
   *
   * VISIBILITY, NOT DISPLAY, and that distinction is the test. `display: none`
   * would take the control out of the box and the pill would change width the
   * moment a pointer crossed it, moving every tab beside it; it would also stop
   * a dispatched click landing, which is how V3App's close test drives this
   * control and how an assistive technology activates it.
   */
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('hides the close control until the pill is hovered, without reserving a slot for it', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="v3-tab-wrap is-open"><button class="v3-tab is-open">Architecture</button>' +
      '<button class="v3-tab-close" aria-label="Close Architecture">x</button></div>';
    document.body.appendChild(host);
    const close = host.querySelector('.v3-tab-close') as HTMLElement;

    expect(resolvedStyle(close, 'visibility')).toBe('hidden');
    expect(resolvedStyle(close, 'opacity')).toBe('0');
    /* The box stays. `display: none` here is the width jump. */
    expect(resolvedStyle(close, 'display')).not.toBe('none');
    expect(resolvedStyle(close, 'width')).toBe('16px');
    host.remove();
  });

  it('brings it back on hover and on focus-within, and on nothing else', () => {
    const rule = blockOf(v3Source.slice(v3Source.indexOf('.v3-tab-wrap:hover .v3-tab-close')));
    expect(rule).toContain('.v3-tab-wrap:focus-within .v3-tab-close');
    expect(rule).toContain('visibility: visible');
    expect(rule).toContain('opacity: 1');
  });
});

describe('live prose is read while it moves, so it gets readable ink', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('the thinking stream is --ink-2, not caption ink', () => {
    /* The exact class list `ThinkingBlock` renders — the fold body carries both
       names, and the question is what the cascade settles on for that pair. */
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="v3-thinking chat-scope">' +
      '<div class="reasonfold-body v3-thinking-thought">weighing the two parsers</div>' +
      '</div>';
    document.body.appendChild(host);
    const thought = host.querySelector('.v3-thinking-thought') as HTMLElement;
    expect(resolvedStyle(thought, 'color')).toBe(token('--ink-2'));
    expect(resolvedStyle(thought, 'color')).not.toBe(token('--ink-3'));
    expect(resolvedStyle(thought, 'color')).not.toBe(token('--ink-4'));
    host.remove();
  });

  it('the streamed answer prose stays at the loudest ink', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="v3-thinking chat-scope"><div class="v3-msg-prose">the gateway retries</div></div>';
    document.body.appendChild(host);
    const prose = host.querySelector('.v3-msg-prose') as HTMLElement;
    expect(resolvedStyle(prose, 'color')).toBe(token('--ink-1'));
    host.remove();
  });

  it('the goalbar\'s live line is --ink-2 — it reports what is happening now', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="v3-goalbar"><span class="v3-goalbar-step">Working · Add the guard</span></div>';
    document.body.appendChild(host);
    const step = host.querySelector('.v3-goalbar-step') as HTMLElement;
    expect(resolvedStyle(step, 'color')).toBe(token('--ink-2'));
    expect(resolvedStyle(step, 'color')).not.toBe(token('--ink-3'));
    host.remove();
  });
});
