import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AiCanvasBlockBody } from './AiCanvasBlockBody';
import { CANVAS_SANDBOX_CSP } from './aiCanvasViewers';
import type { CanvasDocBlock } from '../state/types';

/*
 * THE ONE MISTAKE THAT WOULD VOID THE WHOLE BOUNDARY.
 *
 * `sandbox="allow-scripts allow-same-origin"` is not a weaker sandbox, it is NO
 * sandbox: a frame holding both can reach its own <iframe> element through
 * `window.parent` and delete the attribute. Everything else in Decision 15 —
 * the CSP, the opaque origin, the absent cookies — rests on that one token
 * being absent, and nothing else in this repo would notice it appearing.
 *
 * So it is asserted on the RENDERED ELEMENT rather than on the string that
 * builds the document: the attribute is what the browser reads.
 */
function htmlBlock(payload: string): CanvasDocBlock {
  return { id: 'b1', type: 'html', payload, status: 'landed' };
}

describe('the canvas iframe never loses its sandbox', () => {
  it('runs scripts, and is NEVER same-origin', () => {
    render(<AiCanvasBlockBody block={htmlBlock('<button onclick="x()">go</button>')} />);
    const frame = screen.getByTestId('ai-canvas-html-frame');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    // And nothing else crept in beside it.
    expect(sandbox.trim().split(/\s+/)).toEqual(['allow-scripts']);
  });

  it('the document it renders carries the network-denying policy', () => {
    render(<AiCanvasBlockBody block={htmlBlock('<script>fetch("/x")</script>')} />);
    const doc = screen.getByTestId('ai-canvas-html-frame').getAttribute('srcdoc') ?? '';
    expect(doc).toContain(CANVAS_SANDBOX_CSP);
    // The script survives — it is meant to run — and cannot reach the network.
    expect(doc).toContain('fetch("/x")');
  });
});
