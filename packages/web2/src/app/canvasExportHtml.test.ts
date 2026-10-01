import { describe, expect, it } from 'vitest';

import { canvasDocToHtml } from './canvasExportHtml';
import type { CanvasDoc } from '../state/types';

describe('canvasExportHtml', () => {
  const doc: CanvasDoc = {
    blocks: [
      {
        id: 'b1',
        type: 'markdown',
        title: 'Intro',
        payload: '# Hello\n\nWorld.',
        status: 'landed',
      },
    ],
    storyRoute: {
      title: 'Walkthrough',
      steps: [{ blockId: 'b1', caption: 'Intro' }],
    },
  };

  it('produces self-contained HTML with blocks and story nav', () => {
    const html = canvasDocToHtml(doc);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('id="block-b1"');
    expect(html).toContain('Walkthrough');
    expect(html).toContain('story-nav');
    expect(html).toContain('Exported from Sequence AI Canvas');
  });

  it('escapes user content in titles', () => {
    const html = canvasDocToHtml({
      blocks: [{ id: 'x', type: 'html', payload: '<p>ok</p>', status: 'landed', title: '<script>' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
