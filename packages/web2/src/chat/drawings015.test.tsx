// @vitest-environment jsdom
/* Round 0.1.5, group G3: inline chat drawings. Each test is a line from the owner's walkthrough:
   "don't condense all the way" (one-click fold), "the scroll bar is weird" (none: the drawing scales),
   "titling is not centred", "more vertical than horizontal", "text overflows its box / labels on borders",
   "in full screen they should be more centred". */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetCardMemory } from './cardState';
import { verticalMermaid } from './DiagramBlock';
import { ProseMessage } from './ProseMessage';
import { estimateWidth, fitSvgText, MIN_FONT, wrapWords, type Measure } from './svgFit';
import { resolveVisual } from './VisualKitBlock';
import { centreStyle, FilePreview, previewDefaults, previewDocument, readingStyle as readingStyleOf } from '../files/FilePreview';
import type { RepoPath } from '../files/filesModel';

const css = readFileSync(join(__dirname, 'diagramBlock.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ORIGIN = { chat: 'c1', turn: 't1', repoRoot: null, at: 1 };
const SVG = '```svg\n<svg viewBox="0 0 40 30"><rect width="20" height="10"/></svg>\n```';
let NATURAL = 300;

beforeEach(() => {
  NATURAL = 300;
  forgetCardMemory();
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains('dgm-body')) return 0;
      const mh = parseFloat(this.style.maxHeight);
      return Number.isFinite(mh) ? Math.min(mh, NATURAL) : NATURAL;
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ drawing: { id: 'd3', title: 'Request path' }, name: '3-request-path.svg', version: 1 }) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
});

describe('one click folds and unfolds, and the state is remembered', () => {
  it('the fold button in the header collapses in one click, the row opens it in one click, and it stays folded after a reload', async () => {
    const first = render(<ProseMessage text={SVG} drawing={ORIGIN} />);
    const fold = await screen.findByTestId('chat-card-fold');
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(fold.getAttribute('aria-label')).toBe('Collapse drawing');
    fireEvent.click(fold);
    const row = screen.getByTestId('chat-card-row');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('chat-card-body').hasAttribute('hidden')).toBe(true);
    first.unmount();
    forgetCardMemory(); // a reload: only storage is left
    render(<ProseMessage text={SVG} drawing={ORIGIN} />);
    fireEvent.click(await screen.findByTestId('chat-card-row'));
    expect(screen.getByTestId('chat-card-body').hasAttribute('hidden')).toBe(false);
    expect(screen.queryByTestId('chat-card-row')).toBeNull();
    expect(screen.getByTestId('chat-card-fold')).toBeTruthy();
  });
  it('the fold button is always shown (not hover-only) and is the kit icon button, not a new button type', () => {
    const fold = /\.dgm-fold \{([^}]*)\}/.exec(css)![1]!;
    expect(fold).not.toMatch(/opacity:\s*0/);
    const tsx = readFileSync(join(__dirname, 'VisualCard.tsx'), 'utf8');
    expect(tsx).toMatch(/className="s2-ibtn s2-ibtn-sm dgm-fold"/);
  });
});

describe('no nested scroll area: the drawing scales to the column', () => {
  it('a tall svg card is not clipped at the default cap and shows no drag strip pill at rest', async () => {
    NATURAL = 900;
    const { container } = render(<ProseMessage text={SVG} drawing={ORIGIN} />);
    await screen.findByTestId('chat-card-fold');
    expect(screen.getByTestId('chat-card-body').style.maxHeight).toBe('');
    expect(container.querySelector('.dgm')!.getAttribute('data-capped')).toBeNull();
    expect(container.querySelector('.dgm')!.getAttribute('data-clipped')).toBeNull();
    expect(/\.dgm-grip-pill \{([^}]*)\}/.exec(css)![1]).toMatch(/opacity:\s*0;/);
  });
  it('the css scales the svg to the width and one tall maximum, centred, and no drawing surface has a scrollbar', () => {
    const rule = /\.dgm-art svg \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/max-height:\s*960px/);
    expect(rule).toMatch(/margin:\s*0 auto/);
    const scrolling = [...css.matchAll(/([^{}]+)\{([^}]*overflow(?:-y)?:\s*(?:auto|scroll)[^}]*)\}/g)].map((m) => m[1]!.trim());
    expect(scrolling.filter((s) => !/dgm-open/.test(s))).toEqual([]);
  });
});

describe('vertical first', () => {
  it('a 6-step flow the model sends as a left-to-right strip comes out a column that fits the chat column', async () => {
    const spec = JSON.stringify({
      component: 'flow',
      spec: {
        title: 'Request path',
        direction: 'LR',
        nodes: ['Client', 'Gateway', 'Auth', 'Router', 'Model', 'Store'].map((label) => ({ id: label.toLowerCase(), label })),
        edges: ['client>gateway', 'gateway>auth', 'auth>router', 'router>model', 'model>store'].map((e) => ({ from: e.split('>')[0], to: e.split('>')[1] })),
      },
    });
    for (const column of [340, 440, 700]) {
      const v = await resolveVisual(spec, fetch, column);
      expect(v.kind).toBe('svg');
      if (v.kind !== 'svg') return;
      const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(v.svg)!;
      expect(Number(vb[1])).toBeLessThanOrEqual(column);
      expect(Number(vb[2])).toBeGreaterThan(Number(vb[1]));
    }
  });
  it('a wide mermaid flow is turned top down; a short one, a sequence diagram and other graphs are left alone', () => {
    expect(verticalMermaid('flowchart LR\nA-->B-->C-->D-->E')).toBe('flowchart TB\nA-->B-->C-->D-->E');
    expect(verticalMermaid('graph RL\nA-->B\nB-->C\nC-->D')).toBe('graph BT\nA-->B\nB-->C\nC-->D');
    expect(verticalMermaid('---\ntitle: X\n---\ngraph LR\nA-->B\nB-->C\nC-->D')).toContain('graph TB');
    expect(verticalMermaid('flowchart LR\nA-->B')).toBe('flowchart LR\nA-->B');
    expect(verticalMermaid('flowchart TD\nA-->B-->C-->D')).toBe('flowchart TD\nA-->B-->C-->D');
    expect(verticalMermaid('sequenceDiagram\nA->>B: hi\nB->>A: ok\nA->>B: bye')).toContain('sequenceDiagram');
  });
});

const svgOf = (inner: string, view = '0 0 400 200'): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">${inner}</svg>`, 'image/svg+xml');
  return doc.documentElement as unknown as SVGSVGElement;
};
const est: Measure = (_el, size, bold, text) => estimateWidth(text, size, bold);
const lines = (t: Element): string[] => (t.querySelector('tspan') ? Array.from(t.querySelectorAll('tspan')).map((s) => s.textContent ?? '') : [t.textContent ?? '']);

describe('text never overflows its box', () => {
  it('long text in a narrow box is shrunk, then wrapped, and every line fits the box', () => {
    const svg = svgOf('<rect x="10" y="10" width="90" height="44" rx="6" fill="none" stroke="#999"/><text x="55" y="36" font-size="13" text-anchor="middle">Observe the tool result and decide</text>');
    const report = fitSvgText(svg, est);
    expect(report.shrunk + report.wrapped + report.cut).toBe(1);
    const t = svg.querySelector('text')!;
    const size = parseFloat(t.getAttribute('font-size') ?? '13');
    expect(size).toBeGreaterThanOrEqual(MIN_FONT);
    for (const ln of lines(t)) expect(estimateWidth(ln, size, false)).toBeLessThanOrEqual(90 - 12);
    expect(lines(t).length).toBeLessThanOrEqual(Math.floor(40 / (size * 1.2)));
  });
  it('text that cannot fit even wrapped is cut with an ellipsis and keeps the whole text as a tooltip', () => {
    const svg = svgOf('<rect x="10" y="10" width="70" height="24" fill="none" stroke="#999"/><text x="45" y="26" font-size="12" text-anchor="middle">Reconcile the ledger with the upstream billing export</text>');
    const report = fitSvgText(svg, est);
    expect(report.cut).toBe(1);
    const t = svg.querySelector('text')!;
    expect(t.querySelector('title')!.textContent).toBe('Reconcile the ledger with the upstream billing export');
    expect(lines(t).join(' ')).toContain('…');
    for (const ln of lines(t)) expect(estimateWidth(ln, parseFloat(t.getAttribute('font-size') ?? '12'), false)).toBeLessThanOrEqual(70 - 12 + 0.5);
  });
  it('left-anchored text is measured from its x to the right edge of its box', () => {
    const svg = svgOf('<rect x="10" y="10" width="120" height="30" fill="none" stroke="#999"/><text x="100" y="30" font-size="12">Overruns the right edge</text>');
    const r = fitSvgText(svg, est);
    expect(r.shrunk + r.wrapped + r.cut).toBe(1);
    const t = svg.querySelector('text')!;
    const size = parseFloat(t.getAttribute('font-size') ?? '12');
    for (const ln of lines(t)) expect(100 + estimateWidth(ln, size, false)).toBeLessThanOrEqual(130 - 6 + 0.5);
  });
  it('control: text that fits, text on a background and text in a transformed group are left exactly as written', () => {
    const fits = svgOf('<rect x="10" y="10" width="160" height="40" fill="none" stroke="#999"/><text x="90" y="34" font-size="13" text-anchor="middle">Gateway</text>');
    const before = fits.outerHTML;
    expect(fitSvgText(fits, est)).toEqual({ shrunk: 0, wrapped: 0, cut: 0, moved: 0 });
    expect(fits.outerHTML).toBe(before);
    const bg = svgOf('<rect width="400" height="200" fill="#eee"/><text x="200" y="100" font-size="30" text-anchor="middle">A very large heading across the whole canvas</text>');
    expect(fitSvgText(bg, est)).toEqual({ shrunk: 0, wrapped: 0, cut: 0, moved: 0 });
    const moved = svgOf('<rect x="10" y="10" width="60" height="30"/><g transform="translate(200 0)"><text x="10" y="30" font-size="13">An unrelated long label in another frame</text></g>');
    expect(fitSvgText(moved, est)).toEqual({ shrunk: 0, wrapped: 0, cut: 0, moved: 0 });
  });
  it('M6: a text-anchor set on a parent group counts, like font-size does', () => {
    for (const g of ['<g text-anchor="middle">', '<g style="text-anchor: middle">']) {
      const svg = svgOf(`<rect x="10" y="10" width="160" height="40" fill="none" stroke="#999"/>${g}<text x="90" y="34" font-size="13">Gateway service</text></g>`);
      const before = svg.outerHTML;
      expect(fitSvgText(svg, est), g).toEqual({ shrunk: 0, wrapped: 0, cut: 0, moved: 0 });
      expect(svg.outerHTML).toBe(before);
    }
    /* control: the same text, start-anchored at the same x, does overrun the right edge and is fitted */
    const start = svgOf('<rect x="10" y="10" width="160" height="40" fill="none" stroke="#999"/><g><text x="90" y="34" font-size="13">Gateway service</text></g>');
    const r = fitSvgText(start, est);
    expect(r.shrunk + r.wrapped + r.cut).toBe(1);
  });
  it('wrapWords breaks on words and keeps a single long word on its own line', () => {
    const w = (s: string): number => s.length * 6;
    expect(wrapWords('aa bb cc dd'.split(' '), 30, w)).toEqual(['aa bb', 'cc dd']);
    expect(wrapWords(['supercalifragilistic', 'x'], 30, w)).toEqual(['supercalifragilistic', 'x']);
  });
});

describe('arrow labels never sit on a box border', () => {
  it('a label straddling a border is stepped clear of the box (positive); a label already clear is not moved (negative)', () => {
    const on = svgOf('<rect x="20" y="60" width="120" height="50" fill="none" stroke="#999"/><text x="60" y="62" font-size="12">loop 3-4 until done</text>');
    expect(fitSvgText(on, est).moved).toBe(1);
    const t = on.querySelector('text')!;
    const y = Number(t.getAttribute('y'));
    const bottom = y + 12 * 0.25;
    const top = y - 12 * 0.85;
    expect(bottom <= 60 || top >= 110).toBe(true);
    const clear = svgOf('<rect x="20" y="60" width="120" height="50" fill="none" stroke="#999"/><text x="60" y="40" font-size="12">loop 3-4 until done</text>');
    expect(fitSvgText(clear, est).moved).toBe(0);
  });
});

describe('titles are centred, in the card and in the drawing', () => {
  it('the kit heading is anchored on the middle of the drawing', async () => {
    const v = await resolveVisual(JSON.stringify({ component: 'bar', spec: { title: 'Peak load', categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] } }), fetch, 440);
    if (v.kind !== 'svg') throw new Error('not drawn');
    expect(v.svg).toMatch(/<text x="220" y="14" font-size="14" font-weight="600"[^>]*text-anchor="middle"/);
  });
});

describe('full screen: the drawing is centred both ways with even padding', () => {
  it('the preview frame centres a lone svg with a flex body, equal padding, and scales it to fit instead of scrolling', () => {
    const style = centreStyle({ scheme: 'dark', ground: '#111', ink: '#eee', muted: '#999', edge: '#444', link: '#69f', font: 'sans-serif', mono: 'monospace' });
    expect(style).toMatch(/body\{display:flex;align-items:center;justify-content:center;/);
    expect(style).toMatch(/padding:24px/);
    expect(style).toMatch(/body>svg\{display:block;width:100%;height:100%;/); // the viewBox is centred inside the padded frame
    expect(style).toMatch(/overflow:hidden/);
    expect(style).toContain('--seq-fg:#eee');
    expect(style).toContain('body>svg text:not([fill]),body>svg tspan:not([fill]){fill:currentColor}'); // legible on the dark ground
    expect(previewDocument('<svg/>', false, style)).toContain('data-sequence-centre');
    const dlg = readFileSync(join(__dirname, 'VisualOpenDialog.tsx'), 'utf8');
    expect(dlg).toMatch(/center=\{kind === 'svg'\}/);
  });
  it('L4: an animated svg that carries its own <style> is still centred in full screen, and its own colours are left alone', () => {
    const d = { scheme: 'dark' as const, ground: '#111', ink: '#eee', muted: '#999', edge: '#444', link: '#69f', font: 'sans-serif', mono: 'monospace' };
    const animated = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><style>@keyframes p{to{opacity:.2}}.dot{animation:p 1s infinite;fill:#f60}</style><circle class="dot" cx="100" cy="50" r="10"/></svg>';
    /* in the full-screen frame itself */
    render(<FilePreview kind="html" path={'preview.html' as RepoPath} text={animated} center />);
    expect(screen.getByTestId('files-preview-frame').getAttribute('srcdoc') ?? '').toContain('data-sequence-centre');
    cleanup();
    if (typeof previewDefaults !== 'function') throw new Error('previewDefaults is not exported yet');
    const styled = previewDefaults(animated, true, d);
    expect(styled).toMatch(/body\{display:flex;align-items:center;justify-content:center;/);
    expect(styled).toMatch(/body>svg\{display:block;width:100%;height:100%;/);
    expect(styled).not.toContain('fill:currentColor'); // the author's colours win
    expect(styled).not.toContain('data-sequence-defaults');
    /* controls: a styled html page is never touched; an unstyled svg gets the full centring and ink, as before */
    expect(previewDefaults('<html><head><style>body{color:red}</style></head><body><p>hi</p></body></html>', true, d)).toBe('');
    expect(previewDefaults(animated, false, d)).toBe('');
    expect(previewDefaults('<svg viewBox="0 0 10 10"><text x="1" y="5">a</text></svg>', true, d)).toBe(readingStyleOf(d) + centreStyle(d));
  });
});
