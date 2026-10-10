// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { graphiteMermaidCss, graphiteMermaidTheme } from '../app/MermaidBlock';
// @ts-expect-error plain .mjs fixture shared with the e2e shots
import { GATEWAY_BOXES, gatewayEdges, gatewaySvg } from '../../e2e/fixtures/gatewayPath.mjs';
import { sanitizeSvg } from './svgSanitize';

const css = readFileSync(join(__dirname, 'diagramBlock.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const T = { surface: 's', surfaceRaised: 'r', ink: 'i', inkMuted: 'm', edge: 'e', accent: 'a', fontUi: 'f', fontMono: 'fm', line: 'strong' };

describe('"Request path through the gateway" is drawn like a real agent drawing', () => {
  const edges = gatewayEdges() as { x1: number; y1: number; x2: number; y2: number }[];
  const boxes = GATEWAY_BOXES as { x: number; y: number; w: number; h: number }[];
  it('has an arrow on every edge, from the middle of one box side to the middle of the next', () => {
    const r = sanitizeSvg(gatewaySvg());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = Array.from(r.node.querySelectorAll('line'));
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l.getAttribute('marker-end')).toBe('url(#arrow)'); // survives the sanitizer
    expect(r.node.querySelector('marker#arrow')).not.toBeNull();
    edges.forEach((e, i) => {
      const a = boxes[i]!;
      const b = boxes[i + 1]!;
      expect(e.x1).toBe(a.x + a.w); // leaves the right side
      expect(e.y1).toBe(a.y + a.h / 2); // at its middle
      expect(e.x2).toBe(b.x); // reaches the next box's left side
      expect(e.y2).toBe(b.y + b.h / 2);
      expect(e.y1).toBe(e.y2); // level: no diagonal across the corners
    });
  });
  it('is not the old fixture: no bare diagonal path touching boxes at odd points', () => {
    expect(gatewaySvg()).not.toMatch(/<path d="M58 64 L100 74/);
  });
});

describe('the theme a hand-written svg gets (both themes: it uses currentColor and tokens)', () => {
  const rule = (needle: string): string => new RegExp(`${needle.replace(/[.[\]()|:]/g, '\\$&')}[^{]*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  it('text with no fill is the ink, not the default black', () => {
    expect(css).toMatch(/\.dgm\[data-kind='svg'\] \.dgm-art svg text:not\(\[fill\]\)/);
    expect(rule("svg tspan:not([fill])")).toMatch(/fill:\s*currentColor/);
  });
  it('a connector with a stroke and no width is 1.5px, so it holds on a transparent card', () => {
    expect(css).toMatch(/:is\(line, polyline, path\)\[stroke\]:not\(\[stroke-width\]\)\s*\{\s*stroke-width:\s*1\.5px/);
  });
  it('an arrowhead with no fill takes the line colour, never black on a dark card', () => {
    expect(css).toMatch(/marker :is\(path, polygon, polyline, circle\):not\(\[fill\]\)\s*\{\s*fill:\s*currentColor;\s*fill:\s*context-stroke/);
  });
  it('anything the agent coloured is left alone: every rule needs its attribute to be missing', () => {
    const agentRules = css.slice(css.indexOf("svg text:not([fill])"), css.indexOf('.dgm-body {'));
    for (const sel of agentRules.split('{').filter((_, i, a) => i < a.length - 1).map((p) => p.split('}').pop()!.trim()).filter(Boolean)) expect(sel).toMatch(/:not\(\[/);
  });
});

describe('the mermaid theme draws edges that read', () => {
  it('the line and arrowhead colour is the stronger line token, not the muted ink', () => {
    const th = graphiteMermaidTheme(T);
    expect(th.lineColor).toBe('strong');
    expect(th.arrowheadColor).toBe('strong');
    expect(th.actorLineColor).toBe('strong');
    expect(graphiteMermaidTheme({ ...T, line: undefined }).lineColor).toBe('m'); // no line token: the old muted ink
  });
  it('edges are 1.5px and the arrowhead is filled in the line colour', () => {
    const c = graphiteMermaidCss(T);
    expect(c).toMatch(/\.flowchart-link[^{]*\{stroke-width:1\.5px\}/);
    expect(c).toMatch(/\.marker,\.arrowMarkerPath,\.arrowheadPath\{fill:strong;stroke:strong/);
  });
  it('the theme reads --ink-2 for the line, and flowcharts route in straight segments, not swoops', () => {
    const src = readFileSync(join(__dirname, '..', 'app', 'MermaidBlock.tsx'), 'utf8');
    expect(src).toMatch(/line: read\('--ink-2'/);
    expect(src).toMatch(/curve: 'linear'/);
    expect(src).toMatch(/themeCSS: graphiteMermaidCss\(/);
  });
});
