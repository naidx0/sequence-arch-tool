import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  canDrawDiagrams,
  DIAGRAM_MAX_WIDTH,
  fitScale,
  graphiteMermaidTheme,
  MERMAID_FONT_SIZE,
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
    const allowed = new Set([...Object.values(t), 'transparent', MERMAID_FONT_SIZE]);
    for (const [name, value] of Object.entries(theme)) {
      expect(allowed.has(value), `${name} = ${value} is not a Graphite token`).toBe(true);
    }
    expect(theme.actorBkg).toBe(t.surfaceRaised);
    expect(theme.signalColor).toBe(t.ink);
    expect(theme.activationBorderColor).toBe(t.accent);
  });
});

describe('Mermaid labels are sized to be read (owner, 2026-09-22)', () => {
  it('14px, not the 12px that arrived under the type floor on a zoomed-out pad', () => {
    expect(MERMAID_FONT_SIZE).toBe('14px');
    expect(
      graphiteMermaidTheme({
        surface: 's', surfaceRaised: 'r', ink: 'i', inkMuted: 'm', edge: 'e', accent: 'a', fontUi: 'f', fontMono: 'fm',
      } as never).fontSize,
    ).toBe('14px');
  });
});

describe('sources that make the browser fetch', () => {
  it('refuses an img: / icon: node shape before any render', async () => {
    const { blockedMermaidSource, drawMermaid } = await import('./MermaidBlock');
    for (const src of ['flowchart LR\n A@{ img: "https://evil.example/n.png" }', 'flowchart LR\n A@{ icon: "fa:user", label: "x" }', 'flowchart LR\n A@{ shape: rect, "img" : "x" }']) {
      expect(blockedMermaidSource(src)).toMatch(/external image or icon/);
      await expect(drawMermaid(src)).rejects.toThrow(/external image or icon/);
    }
    expect(blockedMermaidSource('flowchart LR\n A["img: x"] --> B')).toBeNull();
    for (const src of ['flowchart LR\n A@{ img: "https://x/n.png" }', 'flowchart LR\n A@{ shape: rect, icon: "fa:x" }', 'flowchart LR\n A@{ label: "a}b", img: "https://x" }', "flowchart LR\n A@{ label: 'it\\'s}', icon: 'fa:x' }"]) {
      expect(blockedMermaidSource(src)).toMatch(/external image or icon/);
    }
    for (const src of ['flowchart LR\n A@{ shape: rect, label: "img: preview pane" } --> B[Next]', 'flowchart LR\n A@{ shape: rect, label: "icon: settings" } --> B[Next]', "flowchart LR\n A@{ label: 'img: x' } --> B"]) {
      expect(blockedMermaidSource(src)).toBeNull();
    }
  });
});
