import { describe, expect, it } from 'vitest';

import {
  blockNamesItself,
  canvasBlockTypeFromToolName,
  canvasToolLabel,
} from './aiCanvasBlockMeta';

describe('canvasBlockTypeFromToolName', () => {
  it('maps canvas.write_* tools to block types', () => {
    expect(canvasBlockTypeFromToolName('canvas.write_svg')).toBe('svg');
    expect(canvasBlockTypeFromToolName('canvas.write_mermaid')).toBe('mermaid');
    expect(canvasBlockTypeFromToolName('propose_topology')).toBeNull();
  });
});

describe('canvasToolLabel', () => {
  it('names the block kind being drawn', () => {
    expect(canvasToolLabel('canvas.write_svg')).toBe('Drawing SVG');
    expect(canvasToolLabel('canvas.write_react')).toBe('Drawing React');
  });
});

describe('blockNamesItself — the rule the document turns on', () => {
  /*
   * docs/AI-CANVAS-IS-A-DOCUMENT.md §3. Owner, 2026-09-09: "The AI canvas right
   * now seems to open up little section cards within the canvas."
   */
  it('a markdown block opening with a heading names itself', () => {
    expect(blockNamesItself({ type: 'markdown', payload: '# Plan\n\nfirst para' })).toBe(true);
    expect(blockNamesItself({ type: 'markdown', payload: '### Deep\n' })).toBe(true);
  });

  it('leading blank lines do not hide the heading', () => {
    expect(blockNamesItself({ type: 'markdown', payload: '\n\n  # Plan\n' })).toBe(true);
  });

  it('a heading LATER in the block does not name the passage', () => {
    /* `#` on line 40 does not name what the reader meets at line 1, and
       renderMarkdown only makes a heading from a line that STARTS with #. */
    expect(blockNamesItself({ type: 'markdown', payload: 'intro para\n\n# Later' })).toBe(false);
  });

  it('a hash that is not a heading does not count', () => {
    /* `#tag` and `#` alone are not headings to renderMarkdown either — the
       regex asks exactly what that renderer will draw. */
    expect(blockNamesItself({ type: 'markdown', payload: '#tag line' })).toBe(false);
    expect(blockNamesItself({ type: 'markdown', payload: '#' })).toBe(false);
    expect(blockNamesItself({ type: 'markdown', payload: '' })).toBe(false);
  });

  it('NO OTHER TYPE CAN ANSWER YES — this is the load-bearing half', () => {
    /*
     * An html/react/svg payload can render anything at all; with no label the
     * reader cannot tell what they are looking at or that a tool wrote it.
     * Dropping the header everywhere would trade "too much chrome" for
     * "unreadable", which is a fix that guts the feature. A mermaid diagram is
     * not a title either.
     */
    for (const type of ['html', 'react', 'svg', 'mermaid']) {
      expect(blockNamesItself({ type, payload: '# looks like a heading' })).toBe(false);
    }
  });
});
