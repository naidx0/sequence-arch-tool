import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DiagramBlock } from './DiagramBlock';
import { sanitizeSvg } from './svgSanitize';
import { themeSvg } from './svgTheme';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* B13: inline art follows the app theme (font, colours, buttons). */

const themed = (svg: string): SVGElement => {
  const r = sanitizeSvg(svg);
  if (!r.ok) throw new Error(r.reason);
  themeSvg(r.node);
  return r.node;
};
const styleOf = (el: Element | null): string => el?.getAttribute('style') ?? '';

describe('themeSvg', () => {
  it('sets the app font on the drawing and drops the agent’s own face', () => {
    const n = themed('<svg viewBox="0 0 100 40"><text x="1" y="10" font-family="Comic Sans MS, cursive">hi</text><text x="1" y="30" font-family="Courier New">code</text></svg>');
    const [a, b] = Array.from(n.querySelectorAll('text'));
    expect(styleOf(n)).toContain('font-family:var(--font-sans)');
    expect(styleOf(a!)).toContain('font-family:var(--font-sans)');
    expect(styleOf(a!)).not.toContain('Comic');
    expect(styleOf(b!)).toContain('font-family:var(--font-mono)');
  });

  it('keeps the agent’s font when the root says own-fonts', () => {
    const n = themed('<svg class="own-fonts" viewBox="0 0 10 10"><text font-family="Georgia">x</text></svg>');
    expect(n.querySelector('text')!.getAttribute('font-family')).toBe('Georgia');
  });

  it('maps theme words and black to tokens, leaves a deliberate colour alone', () => {
    const n = themed('<svg viewBox="0 0 100 40"><rect id="a" width="10" height="10" fill="accent" stroke="border"/><rect id="b" width="10" height="10" fill="#ff00aa" stroke="black"/><circle id="c" r="3" fill="danger"/></svg>');
    expect(styleOf(n.querySelector('#a'))).toContain('fill:var(--accent)');
    expect(styleOf(n.querySelector('#a'))).toContain('stroke:var(--edge-strong)');
    expect(n.querySelector('#b')!.getAttribute('fill')).toBe('#ff00aa');
    expect(styleOf(n.querySelector('#b'))).toContain('stroke:var(--ink-1)');
    expect(styleOf(n.querySelector('#c'))).toContain('fill:var(--wont)');
  });

  it('unset fills: text is the ink, a shape is a surface with an edge, an arrowhead follows ink', () => {
    const n = themed('<svg viewBox="0 0 100 40"><defs><marker id="m"><path id="head" d="M0 0L4 2L0 4z"/></marker></defs><rect id="r" width="10" height="10"/><text id="t">x</text></svg>');
    expect(styleOf(n.querySelector('#r'))).toContain('fill:var(--surface-1)');
    expect(styleOf(n.querySelector('#r'))).toContain('stroke:var(--edge-strong)');
    expect(styleOf(n.querySelector('#t'))).toContain('fill:var(--ink-1)');
    expect(styleOf(n.querySelector('#head'))).toContain('fill:var(--ink-2)');
  });

  it('draws the two existing button looks for rect.btn', () => {
    const n = themed('<svg viewBox="0 0 100 40"><g><rect id="soft" class="btn" width="40" height="16"/><text>Cancel</text></g><g><rect id="solid" class="btn primary" width="40" height="16"/><text id="lbl">Save</text></g></svg>');
    expect(styleOf(n.querySelector('#soft'))).toContain('fill:var(--surface-2)');
    expect(styleOf(n.querySelector('#solid'))).toContain('fill:var(--accent-solid)');
    expect(n.querySelector('#solid')!.getAttribute('rx')).toBe('8');
    expect(styleOf(n.querySelector('#lbl'))).toContain('fill:var(--accent-on-solid)');
  });
});

describe('the chat’s inline svg block', () => {
  it('is drawn themed', async () => {
    render(<DiagramBlock kind="svg" source={'<svg viewBox="0 0 100 40"><rect width="10" height="10"/><text x="1" y="30" font-family="Papyrus">hi</text></svg>'} />);
    await waitFor(() => expect(screen.getByTestId('chat-diagram-art').querySelector('svg')).toBeTruthy());
    const svg = screen.getByTestId('chat-diagram-art').querySelector('svg')!;
    expect(styleOf(svg.querySelector('rect'))).toContain('var(--surface-1)');
    expect(styleOf(svg.querySelector('text'))).toContain('var(--font-sans)');
  });
});

describe('the rules document', () => {
  it('exists next to the code and names the tokens the code uses', () => {
    const md = readFileSync(join(process.cwd(), 'src/chat/INLINE-ART-RULES.md'), 'utf8');
    for (const t of ['--font-sans', '--ink-1', '--surface-1', '--edge-strong', '--accent', 'own-fonts', 'btn primary']) expect(md).toContain(t);
  });
});

describe('review fixes', () => {
  it('a font set on a group does not leak past the app font', () => {
    const n = themed('<svg viewBox="0 0 10 10"><g id="g" font-family="Comic Sans MS"><text>x</text></g></svg>');
    expect(styleOf(n.querySelector('#g'))).toContain('font-family:var(--font-sans)');
    expect(n.querySelector('#g')!.getAttribute('font-family')).toBeNull();
  });
});
