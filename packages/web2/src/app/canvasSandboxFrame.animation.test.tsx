import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AiCanvasBlockBody } from './AiCanvasBlockBody';
import { CANVAS_SANDBOX_CSP, htmlSandboxDocument } from './aiCanvasViewers';
import type { CanvasDocBlock } from '../state/types';

/*
 * ══════════════════════════════════════════════════════════════════════════
 * CAN A BLOCK MOVE?
 *
 * Owner, 2026-09-18: "can it draw animations". The answer was yes and nobody
 * had written it down, so the belt never said so and the model never tried.
 *
 * The belt now DOES say so (`askPipeline.ts`, CANVAS BLOCK CRAFT) — which
 * makes it a claim about this renderer, and a prompt that promises a capability
 * the sandbox strips is worse than one that stays quiet. These are the tests
 * that keep the promise true: not "the CSP contains the word style", but the
 * two mechanisms, asserted on what the browser is actually handed.
 *
 * The sandbox attribute itself is locked next door in `canvasSandboxFrame.test.tsx`
 * — `allow-scripts` and NEVER `allow-same-origin`. Nothing here weakens it.
 * ══════════════════════════════════════════════════════════════════════════
 */

function block(type: CanvasDocBlock['type'], payload: string): CanvasDocBlock {
  return { id: 'b1', type, payload, status: 'landed' };
}

const KEYFRAME_WIDGET = [
  '<style>',
  '@keyframes pulse { from { opacity: 0.2 } to { opacity: 1 } }',
  '.dot { animation: pulse 2s infinite; background: var(--accent) }',
  '</style>',
  '<div class="dot">request</div>',
].join('\n');

const SMIL_DIAGRAM = [
  '<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">',
  '  <circle cx="10" cy="50" r="6" fill="currentColor">',
  '    <animate attributeName="cx" from="10" to="190" dur="3s" repeatCount="indefinite" />',
  '  </circle>',
  '  <rect x="150" y="30" width="40" height="40">',
  '    <animateTransform attributeName="transform" type="rotate" from="0 170 50" to="360 170 50" dur="4s" repeatCount="indefinite" />',
  '  </rect>',
  '</svg>',
].join('\n');

describe('CSS animation survives into the sandboxed HTML block', () => {
  it('the keyframes reach the document the frame renders, byte for byte', () => {
    render(<AiCanvasBlockBody block={block('html', KEYFRAME_WIDGET)} />);
    const doc = screen.getByTestId('ai-canvas-html-frame').getAttribute('srcdoc') ?? '';
    expect(doc).toContain('@keyframes pulse');
    expect(doc).toContain('animation: pulse 2s infinite');
    /* The <style> element itself, not just the text inside it. */
    expect(doc).toMatch(/<style>[\s\S]*@keyframes pulse/);
  });

  it('AND THE POLICY PERMITS IT — style-src is unsafe-inline, which is the whole reason it runs', () => {
    /*
     * `default-src 'none'` alone would kill an inline <style>. The policy is
     * asserted as an exact string rather than by a regex over the document,
     * because "contains the word style-src" is not the claim being made.
     */
    expect(CANVAS_SANDBOX_CSP).toContain("style-src 'unsafe-inline'");
    const doc = htmlSandboxDocument(KEYFRAME_WIDGET, { scripts: true });
    expect(doc).toContain(CANVAS_SANDBOX_CSP);
  });

  it('a full document from the model gets the policy too, and keeps its animation', () => {
    /* The one input shape that used to skip every guard is the one a model
       reaches for when asked for "a complete page". */
    const full = `<!DOCTYPE html><html><head>${KEYFRAME_WIDGET}</head><body><p>hi</p></body></html>`;
    const doc = htmlSandboxDocument(full, { scripts: true });
    expect(doc).toContain(CANVAS_SANDBOX_CSP);
    expect(doc).toContain('@keyframes pulse');
    /* The policy is the FIRST thing in the head — a CSP after the resource it
       governs is decoration. */
    expect(doc.indexOf(CANVAS_SANDBOX_CSP)).toBeLessThan(doc.indexOf('@keyframes pulse'));
  });

  it('NOTHING IN THE PIPELINE STRIPS A STYLE, on either path', () => {
    /* The non-interactive path strips <script>. It must not have been quietly
       stripping the stylesheet with it — that is the capability the belt now
       promises. */
    const inert = htmlSandboxDocument(KEYFRAME_WIDGET, {});
    expect(inert).toContain('@keyframes pulse');
  });
});

describe('SVG animation survives into the inline SVG block', () => {
  it('the <animate> element reaches the DOM as an element, not as text', () => {
    render(<AiCanvasBlockBody block={block('svg', SMIL_DIAGRAM)} />);
    const host = screen.getByTestId('ai-canvas-svg-inline');
    expect(host.querySelectorAll('animate')).toHaveLength(1);
    expect(host.querySelectorAll('animateTransform')).toHaveLength(1);
  });

  it('with its attributes intact — a stripped `dur` is a still picture', () => {
    render(<AiCanvasBlockBody block={block('svg', SMIL_DIAGRAM)} />);
    const anim = screen.getByTestId('ai-canvas-svg-inline').querySelector('animate');
    expect(anim?.getAttribute('attributeName')).toBe('cx');
    expect(anim?.getAttribute('dur')).toBe('3s');
    expect(anim?.getAttribute('repeatCount')).toBe('indefinite');
  });

  it('AN SVG BLOCK IS NOT FRAMED, which is why SMIL is unconstrained here', () => {
    /* It is inlined into the host page — so the sandbox CSP never applies to
       it, and so the no-script rule on `canvas.write_svg` is load-bearing
       rather than decorative. */
    render(<AiCanvasBlockBody block={block('svg', SMIL_DIAGRAM)} />);
    expect(screen.queryByTestId('ai-canvas-html-frame')).toBeNull();
  });
});

describe('what the policy still forbids, and must keep forbidding', () => {
  it('the network is closed — default-src none, and no connect/font/frame escape hatch', () => {
    expect(CANVAS_SANDBOX_CSP).toContain("default-src 'none'");
    expect(CANVAS_SANDBOX_CSP).not.toContain('connect-src');
    expect(CANVAS_SANDBOX_CSP).not.toContain('font-src');
    expect(CANVAS_SANDBOX_CSP).not.toContain('frame-src');
    /* Images only as inline bytes — a remote img is a request channel. */
    expect(CANVAS_SANDBOX_CSP).toContain('img-src data:');
    expect(CANVAS_SANDBOX_CSP).not.toMatch(/img-src[^;]*https?:/);
  });

  it('so a CDN animation library renders an empty box, exactly as the belt warns', () => {
    /* Not a theory about the browser: the tag is carried through untouched and
       the policy above is what refuses it. Both halves are asserted, because a
       model told "no remote scripts" will still try one, and the failure the
       reader sees is silence. */
    const remote = '<script src="https://cdn.example.com/anime.min.js"></script><div id="x"></div>';
    const doc = htmlSandboxDocument(remote, { scripts: true });
    expect(doc).toContain('cdn.example.com');
    expect(doc).toContain(CANVAS_SANDBOX_CSP);
  });
});
