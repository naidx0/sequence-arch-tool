import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextRing } from '../chat/ContextRing';
import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { AsciiSpinner, SPINNER_FRAMES, SPINNER_STILL } from './AsciiSpinner';
import { S2Icon } from './icons';

/*
 * ROUND 13, LANE S (Jaden 10-09, walkthrough of the r12 shots). One lock per item, S1 to S10. The
 * measured half (ink centres, box geometry, overlap, stacking) is e2e/r13-shell-shots.mjs.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
const shell = read('shell2.css');
const menu = read('modelMenu.css');
const chat2 = read('chat2.css');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const body = (sheet: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...strip(sheet).matchAll(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');
};
const freshStore = () => createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('S1 the surface bar keeps every name at 1024', () => {
  it('no container query folds a pill to its icon; the dot stays in the flow after the name', () => {
    expect(strip(shell)).not.toMatch(/@container s2main[^{]*\{\s*\.s2-surfaces:not\(\.is-compact\)/);
    expect(body(shell, '.s2-sp-dot')).not.toMatch(/position:\s*absolute/);
    expect(strip(shell)).not.toMatch(/\.s2-sp-dot \{[^}]*position:\s*absolute/);
  });
  it('the bar renders a visible name for every surface and scrolls when they do not fit', () => {
    render(<V3App appStore={freshStore()} />);
    const bar = screen.getByTestId('s2-surfaces');
    const labels = [...bar.querySelectorAll('.s2-seg-l')].map((e) => e.textContent);
    expect(labels.length).toBeGreaterThanOrEqual(5);
    expect(labels.every((t) => !!t)).toBe(true);
    expect(body(shell, '.s2-surfaces')).toMatch(/overflow-x:\s*auto/);
  });
});

describe('S2 the surface tabs are a little more transparent', () => {
  it('the track is a 3% wash with no shadow', () => {
    const b = body(shell, '.s2-surfaces');
    expect(b).toMatch(/color-mix\(in srgb, var\(--b-ink1\) 3%, transparent\)/);
    expect(b).toMatch(/box-shadow:\s*none/);
  });
});

describe('S3 the worktree badge is smaller and centred in its disc', () => {
  it('10 px disc, 7 px glyph, no margins', () => {
    const b = body(shell, '.s2-rail-badge');
    expect(b).toMatch(/width:\s*10px/);
    expect(b).toMatch(/height:\s*10px/);
    expect(b).toMatch(/justify-content:\s*center/);
    expect(body(shell, '.s2-rail-badge > svg.s2-i')).toMatch(/width:\s*7px/);
  });
});

describe('S4 the Plan icon is a clipboard on the Smart shield footprint', () => {
  it('the plan glyph exists, is not the old map, and the pill uses it', () => {
    const { container } = render(<S2Icon name="plan" />);
    expect(container.querySelector('rect')).toBeTruthy();
    /* N2: thinner than the 1.7 base stroke, same footprint. */
    expect(Number(container.querySelector('g')?.getAttribute('stroke-width'))).toBeLessThan(1.6);
    expect(container.querySelectorAll('path').length).toBe(2);
    const src = read('../v3/V3Chat.tsx');
    expect(src).toMatch(/\{ plan: 'plan', smart: 'shield', full: 'bolt' \}/);
  });
  it('its outline spans the shield: x 4 to 20, y 3 to 21', () => {
    const d = read('icons.tsx');
    expect(d).toMatch(/plan: \(\s*<g strokeWidth="1.4">\s*<path d="M8 5H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3h-1" \/>\s*<rect x="8" y="3" width="8" height="4" rx="1.5" \/>/);
  });
  it('N1 send and stop svg are 16 px (whole-pixel start in the 30 px button)', () => {
    expect(body(chat2, '.s2-comp .s2-send svg')).toMatch(/width:\s*16px/);
    expect(body(chat2, '.s2-comp .s2-send svg')).toMatch(/height:\s*16px/);
  });
});

describe('S5 the agent icon and the mode icon share one box and one room', () => {
  it('both buttons are one height; the mode button is a square so its glyph centres in the circle', () => {
    const tail = strip(menu).slice(strip(menu).indexOf('--pill-pb-h'));
    expect(tail).toMatch(/\.s2-pillbar \.s2-pb \{\s*height: var\(--pill-pb-h\);/);
    expect(tail).toMatch(/\.s2-pillbar \.s2-pb-mode \{\s*width: var\(--pill-pb-h\);\s*padding: 0;\s*justify-content: center;/);
    expect(tail).toMatch(/\.s2-pillbar \.s2-pb-model \{\s*padding: 0 var\(--sp-8\) 0 var\(--pill-ico-pad\);/);
  });
});

describe('S6 the send and stop glyphs sit on their button centre', () => {
  it('the button centres its svg and the stop square is symmetric in its viewBox', () => {
    expect(body(chat2, '.s2-send')).toMatch(/display:\s*inline-flex/);
    expect(body(chat2, '.s2-send')).toMatch(/align-items:\s*center/);
    expect(body(chat2, '.s2-send')).toMatch(/justify-content:\s*center/);
    const src = read('../v3/V3Chat.tsx');
    expect(src).toMatch(/viewBox="0 0 16 16"[^>]*>\s*<rect x="4" y="4" width="8" height="8"/);
  });
});

describe('S7 the agent spinner is the braille radar with a shimmering live label', () => {
  it('braille cells only (no star glyph, no middle dot), a settled still that is one of the frames', () => {
    expect(SPINNER_FRAMES.length).toBeGreaterThanOrEqual(8);
    for (const f of SPINNER_FRAMES) expect(f).toMatch(/^[\u2800-\u28FF]{2}$/u);
    expect(SPINNER_FRAMES).toContain(SPINNER_STILL);
    expect(read('AsciiSpinner.tsx')).not.toContain('\u00b7');
  });
  it('is never squeezed out of a row', () => {
    expect(body(shell, '.act-loader')).toMatch(/flex:\s*none/);
    const { container } = render(<AsciiSpinner />);
    expect(container.querySelector('[data-testid="s2-ascii-spinner"]')).toBeTruthy();
  });
  it('the status bar swaps its dot for the spinner and shimmers the label while working', () => {
    const src = read('StatusBar.tsx');
    expect(src).toMatch(/agentState === 'working' \? <AsciiSpinner \/>/);
    expect(src).toMatch(/s2-sb-state\$\{agentState === 'working' \? ' shimmer-text' : ''\}/);
    expect(read('Shell2.tsx')).toMatch(/<span className="shimmer-text">Working<\/span>/);
  });
});

describe('S8 the context hover', () => {
  it('has no footnote, only the numbers', () => {
    render(<ContextRing used={27_640} window={131_100} breakdown={null} />);
    expect(screen.queryByTestId('composer-context-explanation')).toBeNull();
    expect(read('../chat/ContextRing.tsx')).not.toMatch(/Parts are estimates/);
  });
  it('has 16 by 20 px of inner room and sits on the popover layer above the board toolbar', () => {
    const b = body(shell, '.s2 .s2-status .s2-ctx .ctxring-panel');
    expect(b).toMatch(/padding:\s*var\(--ctx-pop-pad-y\) var\(--ctx-pop-pad-x\)/);
    expect(b).toMatch(/z-index:\s*var\(--z-popover\)/);
    expect(shell).toMatch(/--ctx-pop-pad-y:\s*var\(--sp-16\)/);
    expect(shell).toMatch(/--ctx-pop-pad-x:\s*var\(--sp-20\)/);
    expect(shell).toMatch(/--z-popover:\s*80/);
    expect(body(shell, '.s2-chat:has(.s2-ctx .ctxring-panel)')).toMatch(/z-index:\s*var\(--z-popover\)/);
  });
});

describe('S9 the background is undimmed a little', () => {
  const op = (sel: string) => Number(new RegExp(`${sel.replace(/[[\]'.]/g, '\\$&')} \\{\\s*opacity: ([\\d.]+);`).exec(strip(shell))?.[1]);
  it('dark: stronger than round 12 (0.11 / 0.05) and still quiet', () => {
    const behind = op(".s2-backdrop[data-drawn='true'][data-mode='behind-chat']");
    const under = op(".s2-backdrop[data-drawn='true'][data-mode='under']");
    expect(behind).toBeGreaterThan(0.11);
    expect(behind).toBeLessThanOrEqual(0.25);
    expect(under).toBeGreaterThan(0.05);
    expect(under).toBeLessThanOrEqual(behind / 2);
  });
  it('light: stronger than round 12 (0.15 / 0.07) and still quiet', () => {
    const behind = op(":root[data-theme='light'] .s2-backdrop[data-drawn='true'][data-mode='behind-chat']");
    const under = op(":root[data-theme='light'] .s2-backdrop[data-drawn='true'][data-mode='under']");
    expect(behind).toBeGreaterThan(0.15);
    expect(behind).toBeLessThanOrEqual(0.3);
    expect(under).toBeGreaterThan(0.07);
    expect(under).toBeLessThanOrEqual(behind / 2);
  });
  it('0.1.7: about 10% more background than round 13 (0.17 / 0.22 behind the chat)', () => {
    expect(op(".s2-backdrop[data-drawn='true'][data-mode='behind-chat']")).toBeGreaterThanOrEqual(0.18);
    expect(op(":root[data-theme='light'] .s2-backdrop[data-drawn='true'][data-mode='behind-chat']")).toBeGreaterThanOrEqual(0.24);
  });
  it('0.1.8.2: the background a little less dim again (Jaden 10-16), both rooms', () => {
    expect(op(".s2-backdrop[data-drawn='true'][data-mode='behind-chat']")).toBeGreaterThanOrEqual(0.22);
    expect(op(":root[data-theme='light'] .s2-backdrop[data-drawn='true'][data-mode='behind-chat']")).toBeGreaterThanOrEqual(0.27);
  });
  it('more colour: saturation up in both rooms, not fully', () => {
    const css = strip(shell);
    expect(css).toMatch(/:root:not\(\[data-theme='light'\]\) \.s2-backdrop-c \{\s*filter: saturate\(0\.45\)/);
    expect(css).toMatch(/:root\[data-theme='light'\] \.s2-backdrop-c \{\s*filter: saturate\(0\.95\)/);
  });
});

describe('S10 the folder icons draw crisp at small sizes', () => {
  it('the folder is grid-snapped (every coordinate a multiple of 0.75 on a half pixel at 16 px)', () => {
    const m = /folder: <path d="([^"]+)"/.exec(read('icons.tsx'));
    expect(m).toBeTruthy();
    const nums = [...m![1]!.matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => Number(x[0]));
    expect(nums.every((n) => Math.abs(n * 4 - Math.round(n * 4)) < 1e-9)).toBe(true);
  });
  it('a project row draws its folder at the rail glyph size (14 px), the same as a folder row in the file rail', () => {
    /* e2e/rails-match.mjs: a project row and a folder row at depth 0 are the same row. No size of its own. */
    expect(shell).not.toMatch(/\.s2-proj-row \.s2-rail-ic > svg/);
    expect(body(shell, '.s2-rail-ic > svg,\n.s2-rail-ic > .s2-brand')).toMatch(/width:\s*14px/);
  });
});

describe('A5 (chat side) a subagent row keeps its definition to one line', () => {
  const css = read('../chat/subagent.css');
  it('the description ellipsises on one line and the row can shrink', () => {
    const d = body(css, '.agsub-desc');
    expect(d).toMatch(/white-space:\s*nowrap/);
    expect(d).toMatch(/text-overflow:\s*ellipsis/);
    expect(d).toMatch(/overflow:\s*hidden/);
    expect(d).not.toMatch(/overflow-wrap/);
    expect(body(css, '.agsub-hd')).toMatch(/min-width:\s*0/);
  });
  it('the full text is the title', () => {
    expect(read('../chat/AgentRunThread.tsx')).toMatch(/data-testid="agent-subagent-desc" title=\{label\.detail\}/);
  });
});

describe('S7 the shimmer never blanks the label (review blocker)', () => {
  const gr = read('../tokens/graphite.css');
  const rule = /\n\.shimmer-text \{([^}]*)\}/.exec(gr)![1]!;
  const kf = /@keyframes shimmer-text \{\s*from \{ background-position: (-?[\d.]+)% 0; \}\s*to \{ background-position: (-?[\d.]+)% 0; \}/.exec(gr)!;
  it('the gradient tiles and has ink at both ends, so every pixel is painted at every keyframe position', () => {
    expect(rule).toMatch(/background-repeat:\s*repeat-x/);
    const stops = [...rule.matchAll(/(var\(--ink-2\)|color-mix\([^)]*\)[^,)]*\)?) (\d+)%/g)];
    expect(stops[0]![2]).toBe('0');
    expect(stops[0]![1]).toBe('var(--ink-2)');
    expect(stops.at(-1)![2]).toBe('100');
    expect(stops.at(-1)![1]).toBe('var(--ink-2)');
  });
  it('computed coverage: at every position the tiled image spans the whole text box, and the loop moves exactly one tile', () => {
    const size = Number(/background-size:\s*(\d+)%/.exec(rule)![1]) / 100;
    const from = Number(kf[1]);
    const to = Number(kf[2]);
    const W = 1;
    const tile = size * W;
    for (let i = 0; i <= 20; i++) {
      const p = (from + ((to - from) * i) / 20) / 100;
      const offset = (W - tile) * p;
      /* repeat-x: tiles start at offset + k * tile; the text box [0, W] is covered when one tile edge lies at or before 0 and the pattern is unbroken. */
      const first = offset - Math.ceil(offset / tile) * tile;
      expect(first).toBeLessThanOrEqual(1e-9);
      expect(first + Math.ceil((W - first) / tile) * tile).toBeGreaterThanOrEqual(W);
    }
    expect(Math.abs(((to - from) / 100) * (W - tile))).toBeCloseTo(tile, 6);
  });
});

describe('N4 long text never wraps and never shrinks: ellipsis plus the full text on hover', () => {
  it('the status bar, the live row and its phase are nowrap with an ellipsis', () => {
    expect(body(shell, '.s2-status')).toMatch(/white-space:\s*nowrap/);
    expect(body(chat2, '.s2-live-bar')).toMatch(/white-space:\s*nowrap/);
    expect(body(chat2, '.s2-live-phase')).toMatch(/text-overflow:\s*ellipsis/);
    expect(strip(shell)).toMatch(/\.s2-sb-state,[^{]*\{[^}]*text-overflow:\s*ellipsis/);
  });
  it('their full text is a title, and no rule shrinks the type below 11 px in them', () => {
    expect(read('StatusBar.tsx')).toMatch(/title: stateWord/);
    expect(read('../chat/ChatStatus.tsx')).toMatch(/title=\{statusText\(status\)\}/);
    for (const css of [shell, chat2]) for (const m of strip(css).matchAll(/\.(?:s2-status|s2-sb-state|s2-live-phase)[^{]*\{[^}]*font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(11);
  });
});

void act;
