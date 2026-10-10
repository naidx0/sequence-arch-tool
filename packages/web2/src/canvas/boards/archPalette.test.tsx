import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ARCH_TOOLS, ArchPalette } from './ArchDraw';

afterEach(cleanup);

describe('the draw palette says what each tool does, and says it accurately', () => {
  it('Sketch: a box adds a service and a line between two boxes connects them (inkToEdit.ts)', () => {
    const sketch = ARCH_TOOLS.find((t) => t.id === 'sketch')!;
    expect(sketch.hint).toBe('Draw a box to add a service. Draw a line between two boxes to connect them.');
    expect(sketch.hint).not.toMatch(/surface/i);
  });

  it('every tool button carries its hint as a hover tooltip drawn by the sheet, with the tool name as its accessible name', () => {
    render(<ArchPalette tool="sketch" onTool={() => undefined} onDone={() => undefined} hidden={0} />);
    for (const t of ARCH_TOOLS) {
      const button = screen.getByTestId(`annot-tool-${t.id}`);
      expect(button.getAttribute('data-hint')).toBe(t.hint);
      expect(button.getAttribute('aria-label')).toBe(t.label);
    }
  });

  it('the tooltip wraps inside a fixed width and opens beside the button, never under the palette', () => {
    const css = readFileSync(`${__dirname}/archDraw.css`, 'utf8');
    const block = css.match(/\.annot-tool\[data-hint\]:hover::after[\s\S]*?\}/)?.[0] ?? '';
    expect(block).toContain('content: attr(data-hint)');
    expect(block).toContain('white-space: normal');
    expect(block).toContain('left: calc(100% + var(--sp-8))');
  });
});

describe('palette: the hint is in the accessibility tree and the palette is opaque', () => {
  it('every tool is described by its hint, in text the sheet never paints', () => {
    render(<ArchPalette tool="sketch" onTool={() => undefined} onDone={() => undefined} hidden={0} />);
    for (const t of ARCH_TOOLS) {
      const button = screen.getByTestId(`annot-tool-${t.id}`);
      const id = button.getAttribute('aria-describedby')!;
      expect(document.getElementById(id)?.textContent).toBe(t.hint);
    }
    const css = readFileSync(`${__dirname}/archDraw.css`, 'utf8');
    expect(css).toMatch(/\.annot-sr \{[^}]*clip: rect\(0 0 0 0\)/);
  });
  it('the palette paints the board card, not the see-through glass', () => {
    const css = readFileSync(`${__dirname}/archDraw.css`, 'utf8');
    const block = css.match(/\.annot-palette \{[\s\S]*?\}/)?.[0] ?? '';
    expect(block).toContain('background: var(--board-card)');
  });
});
