/* ══════════════════════════════════════════════════════════════════════════
   0021 — THE QUIET LABELS CAN BE READ, AND THE TRANSCRIPT'S NAME IS ALLOWED
   packages/web2/src/v3/quietInkContrast.test.tsx

   The accessibility audit (axe, color-contrast, serious) measured six labels
   below the 4.5:1 text floor in the shipped dark room, every one of them
   `--ink-4` at 10-13px:
     rail      .v3-rail-section-label, .v3-rail-pick-toggle   4.03:1 on --bg-base
               .v3-session-more on the loaded row              2.8:1 on --state-selected
     terminal  .terminal-pane-meta                             4.03:1 on --bg-base
     browser   .browser-pane-meta                              4.16:1 on --bg-ground
     board     .kindlegend .grp                                3.57:1 on --surface-2
   The fix is one token per rule, as in boot/contrast.test.tsx: the resting
   ink moves up one rung to --ink-3, and the "Chat actions" glyph on the
   loaded row takes --ink-2, as the row's own time does.

   HOW IT MEASURES. jsdom has no compositor, so this reads each rule's colour
   token out of the stylesheet text (the last rule naming the selector wins,
   as it would in the cascade for these single-class rules), resolves both
   tokens through the real token sheet in each dark palette the app ships
   (gold, white, blue), composites any translucent ground over the room, and
   does the WCAG arithmetic. Dark only: light is deferred by owner ruling
   (GRAPHITE-DECISIONS.md Decision 1), as boot/contrast.test.tsx explains.
   Chromium evidence is the audit probe (axe on the real page).
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { substituteVars } from '../../test/support/css';
import { createStore, StoreProvider } from '../state';
import { V3Chat } from './V3Chat';

import '../tokens/graphite.css';

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const V3 = strip(readFileSync(resolvePath(__dirname, 'v3.css'), 'utf8'));
const BOARD = strip(readFileSync(resolvePath(__dirname, '..', 'canvas', 'board.css'), 'utf8'));

/** The colour token of the last flat rule whose selector list names `selector`. */
function inkOf(css: string, selector: string): string {
  let found: string | null = null;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (!selectors.includes(selector)) continue;
    const color = /(?:^|;|\s)color:\s*(var\(--[\w-]+\))/.exec(m[2]);
    if (color) found = color[1];
  }
  expect(found, `${selector} declares a colour token`).not.toBeNull();
  return found as string;
}

const root = document.documentElement;
const PALETTES = ['gold', 'white', 'blue'] as const;
type Palette = (typeof PALETTES)[number];

function inPalette<T>(palette: Palette, fn: () => T): T {
  root.setAttribute('data-theme', 'dark');
  if (palette !== 'gold') root.setAttribute('data-accent', palette);
  try {
    return fn();
  } finally {
    root.removeAttribute('data-theme');
    root.removeAttribute('data-accent');
  }
}

const token = (value: string): string =>
  substituteVars(value.startsWith('var(') ? value : `var(${value})`, root).trim();

type Rgba = [number, number, number, number];
function parse(value: string): Rgba {
  const text = value.trim();
  if (text.startsWith(String.fromCharCode(35)) && text.length === 7) {
    return [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(text);
  expect(m, `${value} is a colour`).not.toBeNull();
  const parts = (m as RegExpExecArray)[1].split(',').map((p) => Number(p.trim()));
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

/** Paint each layer over the one before it, starting from an opaque ground. */
function composite(...layers: string[]): Rgba {
  let [r, g, b] = parse(layers[0]);
  for (const layer of layers.slice(1)) {
    const [lr, lg, lb, a] = parse(layer);
    r = lr * a + r * (1 - a);
    g = lg * a + g * (1 - a);
    b = lb * a + b * (1 - a);
  }
  return [r, g, b, 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Each audited label: its sheet, its selector, and the ground(s) it is read on,
 *  bottom layer first. */
const CASES: Array<{ what: string; css: string; selector: string; ground: string[] }> = [
  { what: 'rail section label', css: V3, selector: '.v3-rail-section-label', ground: ['--bg-base'] },
  { what: 'rail Select toggle', css: V3, selector: '.v3-rail-pick-toggle', ground: ['--bg-base'] },
  { what: 'Chat actions, resting row', css: V3, selector: '.v3-session-more', ground: ['--bg-base'] },
  { what: 'Chat actions, hovered row', css: V3, selector: '.v3-session-more', ground: ['--bg-base', '--glass-hover'] },
  {
    what: 'Chat actions, loaded row',
    css: V3,
    selector: '.v3-session.is-loaded .v3-session-more',
    ground: ['--bg-base', '--state-selected'],
  },
  { what: 'terminal header meta', css: V3, selector: '.terminal-pane-meta', ground: ['--bg-base'] },
  { what: 'browser header meta', css: V3, selector: '.browser-pane-meta', ground: ['--bg-ground'] },
  { what: 'board legend group label', css: BOARD, selector: '.board-scope .kindlegend .grp', ground: ['--surface-2'] },
];

describe('the quiet labels clear the 4.5:1 text floor in every dark palette', () => {
  for (const palette of PALETTES) {
    for (const c of CASES) {
      it(`${palette}: ${c.what}`, () => {
        const ink = inkOf(c.css, c.selector);
        inPalette(palette, () => {
          const fg = parse(token(ink));
          const bg = composite(...c.ground.map(token));
          const ratio = contrast(fg, bg);
          expect(ratio, `${c.selector} ${ink} on ${c.ground.join(' + ')} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        });
      });
    }
  }

  it('keeps the hover a step brighter than the resting label (the look is unchanged)', () => {
    for (const [rest, hover] of [
      ['.v3-rail-section-label', '.v3-rail-section-label:hover'],
      ['.v3-rail-pick-toggle', '.v3-rail-pick-toggle:hover'],
      ['.v3-session-more', '.v3-session-more:hover'],
    ]) {
      expect(inkOf(V3, rest), rest).not.toBe(inkOf(V3, hover));
      inPalette('blue', () => {
        const bg = parse(token('--bg-base'));
        expect(contrast(parse(token(inkOf(V3, hover))), bg), hover).toBeGreaterThan(
          contrast(parse(token(inkOf(V3, rest))), bg),
        );
      });
    }
  });
});

describe('the chat transcript names itself with a role that allows a name', () => {
  afterEach(() => localStorage.clear());

  it('is a named region, so its aria-label is not a prohibited attribute', () => {
    const { container } = render(
      <StoreProvider store={createStore({})}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    const transcript = container.querySelector('.v3-transcript');
    expect(transcript).not.toBeNull();
    expect(transcript!.getAttribute('aria-label')).toBe('Chat transcript');
    /* axe aria-prohibited-attr: a div with no role may not carry aria-label. */
    expect(transcript!.getAttribute('role')).toBe('region');
  });
});
