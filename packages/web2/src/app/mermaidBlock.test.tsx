import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  canDrawDiagrams,
  DIAGRAM_MAX_WIDTH,
  fitScale,
  graphiteMermaidTheme,
  MermaidBlock,
  normalizeMermaidArrows,
} from './MermaidBlock';

/**
 * A MERMAID BLOCK IS DRAWN, NOT PRINTED — the parts a DOM without layout can
 * still prove. jsdom cannot measure SVG text, so the drawing itself is
 * checked in the browser; here: the gate, the fallback, the arrow repair and
 * the palette.
 */

describe('MermaidBlock', () => {
  it('without SVG geometry (jsdom) it keeps the source in the box and says so', () => {
    expect(canDrawDiagrams()).toBe(false);
    render(<MermaidBlock payload={'flowchart TD\n a --> b'} />);
    const block = screen.getByTestId('ai-canvas-mermaid');
    expect(block.getAttribute('data-mermaid-state')).toBe('source');
    expect(document.querySelector('.ai-canvas-mermaid-box')).toBeTruthy();
    expect(document.querySelector('.ai-canvas-mermaid-src')?.textContent).toContain('a --> b');
    expect(screen.queryByTestId('ai-canvas-mermaid-svg')).toBeNull();
  });

  it('normalises only the unicode arrow glyphs a small model writes', () => {
    /* The walk's 2B model, every arrow: `User—»Input`. */
    expect(normalizeMermaidArrows('User—»Input: Prompt')).toBe('User-->>Input: Prompt');
    expect(normalizeMermaidArrows('a—>b')).toBe('a-->b');
    expect(normalizeMermaidArrows('a→b')).toBe('a-->b');
    expect(normalizeMermaidArrows('a-»b')).toBe('a->>b');
    /* A diagram that already parses is byte-identical. */
    const ok = 'sequenceDiagram\n  A->>B: hi\n  B-->>A: hello\n  C-->D: dash label';
    expect(normalizeMermaidArrows(ok)).toBe(ok);
  });

  it('a wide drawing is fitted to the cap, but never below the legible floor', () => {
    expect(fitScale(600, DIAGRAM_MAX_WIDTH)).toBe(1);
    expect(fitScale(DIAGRAM_MAX_WIDTH, DIAGRAM_MAX_WIDTH)).toBe(1);
    expect(fitScale(1200, DIAGRAM_MAX_WIDTH)).toBeCloseTo(0.8, 5);
    /* The walk's nine-participant sequence, 2215px at mermaid's defaults. */
    expect(fitScale(2215, DIAGRAM_MAX_WIDTH)).toBe(0.7);
    expect(fitScale(0, DIAGRAM_MAX_WIDTH)).toBe(1);
  });

  it('the palette is one ink, one surface, one edge and the accent — no mermaid hues', () => {
    const t = {
      surface: 'tok-surface',
      surfaceRaised: 'tok-surface-raised',
      ink: 'tok-ink',
      inkMuted: 'tok-ink-muted',
      edge: 'tok-edge',
      accent: 'tok-accent',
      fontUi: 'DM Sans',
      fontMono: 'JetBrains Mono',
    };
    const theme = graphiteMermaidTheme(t);
    const allowed = new Set([...Object.values(t), 'transparent', '12px']);
    for (const [name, value] of Object.entries(theme)) {
      expect(allowed.has(value), `${name} = ${value} is not a Graphite token`).toBe(true);
    }
    expect(theme.actorBkg).toBe(t.surfaceRaised);
    expect(theme.signalColor).toBe(t.ink);
    expect(theme.activationBorderColor).toBe(t.accent);
  });
});
