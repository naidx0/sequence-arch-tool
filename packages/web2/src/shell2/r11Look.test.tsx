import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { FilesPanel } from '../files/FilesPanel';
import { FILES } from '../files/anchors';
import { STEP_MS } from './ActivityLoader';
import { AsciiSpinner, SPINNER_FRAMES, SPINNER_STILL } from './AsciiSpinner';

/*
 * ROUND 11, lane "look" (Jaden 10-08): the surface bar's three states
 * ("coloring, dimming, shimmering to differentiate"), an ASCII spinner on a
 * live surface, an empty Files folder as one quiet line, and New chat staying
 * neutral under every accent.
 */

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
const css = read('shell2.css');
const body = (sheet: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...sheet.matchAll(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('the surface bar tells three states apart', () => {
  it('open surfaces carry NO dot (round 12): the dot is only for a surface that is working', () => {
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
    render(<V3App appStore={store} />);
    fireEvent.click(screen.getByTestId('s2-tab-architecture'));
    fireEvent.click(screen.getByTestId('s2-tab-terminal'));
    fireEvent.click(screen.getByTestId('s2-tab-files'));
    const state = (id: string) => document.querySelector(`.s2-sp[data-pill="${id}"]`)?.getAttribute('data-state');
    expect(state('files')).toBe('focused');
    expect(state('architecture')).toBe('open');
    expect(state('terminal')).toBe('open');
    expect(document.querySelectorAll('.s2-sp-dot')).toHaveLength(0);
    expect(document.querySelectorAll('.s2-sp[data-state="closed"]').length).toBeGreaterThan(0);
  });

  it('the CSS: closed dimmed, open plain ink, focused a deeper outline only: no tint, no shadow, no shimmer', () => {
    /* Closed is a text step on the bar (ink-2), not an opacity: the label reads at 4.5:1. */
    expect(body(css, ".s2-sp[data-state='closed']")).toMatch(/color:\s*var\(--b-ink2\)/);
    expect(body(css, ".s2-sp[data-state='closed']")).not.toMatch(/opacity:/);
    expect(body(css, '.s2-sp.is-on')).toMatch(/background:\s*transparent/);
    const ind = body(css, '.s2-sp-ind');
    expect(ind).toMatch(/border:\s*1px solid color-mix\(in srgb, var\(--b-ink1\)/);
    expect(ind).toMatch(/background:\s*transparent/);
    expect(ind).not.toMatch(/box-shadow/);
    expect(ind).not.toMatch(/--b-acc/);
    expect(css).not.toMatch(/s2-sp-shimmer/);
    expect(body(css, '.s2-sp-dot')).not.toMatch(/--b-acc/);
  });
});

describe('the ASCII spinner', () => {
  it('steps through the radar frames while mounted and stops when it unmounts', () => {
    vi.useFakeTimers();
    const { unmount } = render(<AsciiSpinner />);
    const glyph = () => screen.getByTestId('s2-ascii-spinner').textContent;
    expect(glyph()).toBe(SPINNER_FRAMES[0]);
    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    expect(glyph()).toBe(SPINNER_FRAMES[1]);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds one still glyph under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    vi.useFakeTimers();
    render(<AsciiSpinner />);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByTestId('s2-ascii-spinner').textContent).toBe(SPINNER_STILL);
  });

  it('is the braille radar, never the Claude Code star cycle: braille cells only, neutral ink', () => {
    expect(SPINNER_FRAMES.length).toBeGreaterThanOrEqual(8);
    for (const f of SPINNER_FRAMES) expect(f).toMatch(/^[\u2800-\u28FF]{2}$/u);
    for (const f of SPINNER_FRAMES) expect(f).not.toMatch(/[\u2722\u2733\u2736\u273B\u273D]/u);
    const css = readFileSync(resolve(__dirname, 'shell2.css'), 'utf8');
    expect(body(css, '.act-loader')).toMatch(/color:\s*var\(--b-ink2\)/);
    expect(body(css, '.act-loader')).not.toMatch(/--b-acc/);
  });
});

describe('an empty Files folder is one quiet line', () => {
  it('draws only the note, with no preview pane to expand into', () => {
    render(
      <FilesPanel
        paths={[]}
        selected={null}
        expanded={new Set<string>()}
        query=""
        view="code"
        content={{ state: 'idle' }}
        diff={{ state: 'idle' }}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
        onQuery={vi.fn()}
        onView={vi.fn()}
      />,
    );
    expect(screen.getByTestId(FILES.panel).className).toContain('is-bare');
    expect(screen.getByTestId(FILES.empty).textContent).toBe('No files yet.');
    const files = read('../files/files.css');
    expect(files).toMatch(/\.files-scope\.is-bare \.files-main[\s\S]*?display:\s*none/);
  });
});

describe('New chat is neutral whatever the accent', () => {
  it('no rule that paints the solid button, or the New chat control, names an accent', () => {
    const sheets = ['shell2.css', 'chat2.css', 'pages.css', 'edits.css', 'railSubagents.css'].map(read);
    const rules = sheets.flatMap((s) => [...s.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! })));
    const solid = rules.filter((r) => /s2-solid|s2-new-chat/.test(r.sel));
    expect(solid.length).toBeGreaterThan(0);
    for (const r of solid) expect(`${r.sel} ${r.body}`).not.toMatch(/accent|--b-acc/);
    expect(body(css, '.s2-btn.s2-solid')).toMatch(/background:\s*var\(--solid-neutral\);/);
  });

  it('the button is the solid kind in the rail', () => {
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
    render(<V3App appStore={store} />);
    expect(screen.getByTestId('s2-new-chat').className).toContain('s2-solid');
  });
});

describe('the shared text shimmer', () => {
  const tokens = read('../tokens/graphite.css');
  it('.shimmer-text clips a moving gradient to the words and is still under reduced motion', () => {
    expect(tokens).toMatch(/\.shimmer-text \{[^}]*background-clip: text;[^}]*animation: shimmer-text [\d.]+s linear infinite;/);
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.shimmer-text \{\s*animation: none;/);
  });
  it('is put on a running surface label and a working chat title, and only then', () => {
    expect(read('Shell2.tsx')).toMatch(/st === 'running' \? ' shimmer-text' : ''/);
    expect(read('SessionPanel.tsx')).toMatch(/working \? ' shimmer-text' : ''/);
  });
});
