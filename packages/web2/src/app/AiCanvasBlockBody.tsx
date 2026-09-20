/*
 * MATHS MOVED, AND NOTHING ABOUT THIS BLOCK'S OUTPUT DID.
 *
 * `MathRun` and `withMath` lived here, which was right while the canvas was
 * the only surface with typeset maths. The chat transcript needs the same
 * thing now (owner, 2026-09-19: "math functions should be output properly as
 * if they were in Obsidian"), and two copies of a maths renderer is how one
 * sentence comes to render differently in two panes. They are in
 * `chat/MathText.tsx`; the `family` argument is what keeps this surface's
 * class names and testids — `ai-canvas-math`, `ai-canvas-math-display`,
 * `ai-canvas-math-raw` — byte-identical to what the stylesheet and the locks
 * here already name.
 */
import { withMath as withMathFamily } from '../chat/MathText';

const MATH_FAMILY = 'ai-canvas';

/** A paragraph's text, with any maths runs typeset in place. */
function withMath(text: string, key: string): JSX.Element[] {
  return withMathFamily(text, key, MATH_FAMILY);
}

/**
 * Typed block renderers for AI Canvas — all five native writers (Wave L3).
 */

import type { CanvasDocBlock } from '../state/types';
import { MermaidBlock } from './MermaidBlock';
import { ReactCanvasMount } from './ReactCanvasMount';
import { htmlSandboxDocument } from './aiCanvasViewers';

function renderMarkdown(payload: string): JSX.Element {
  const lines = payload.split('\n');
  const nodes: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('```')) {
      const fence = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1;
      /*
       * THE LANGUAGE WAS CAPTURED AND NEVER SHOWN.
       *
       * `data-lang` has carried the fence's language since this renderer was
       * written, and nothing rendered it - so every fenced block, in every
       * language, drew as one anonymous grey box. Owner, 2026-09-09, on what
       * the canvas should hold: "really cool boards, math equations, and a lot
       * of different language in that sense."
       *
       * IN THE DOM, not a CSS ::before with `content: attr(data-lang)`. That
       * would have been one line and unreachable: generated content is not
       * reliably in the accessibility tree, and jsdom computes no content, so
       * the lock would have asserted nothing. docs/AI-CANVAS-IS-A-DOCUMENT.md §5.
       *
       * An UNFENCED block says nothing rather than guessing. A label reading
       * "text" over a shell snippet would be the product inventing a fact about
       * content it was handed - the same rule the context ring follows.
       */
      const lang = fence.split(/\s+/)[0] ?? '';
      nodes.push(
        <div key={`code-${nodes.length}`} className="ai-canvas-md-fence">
          {lang ? (
            <span className="ai-canvas-md-lang" data-testid="ai-canvas-md-lang">
              {lang}
            </span>
          ) : null}
          <pre className="ai-canvas-md-code" data-lang={lang || undefined}>
            {body.join('\n')}
          </pre>
        </div>,
      );
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s*/, '');
      const Tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
      nodes.push(
        <Tag key={`h-${nodes.length}`} className="ai-canvas-md-h">
          {text}
        </Tag>,
      );
      i += 1;
      continue;
    }
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.startsWith('#')) {
      para.push(lines[i]!);
      i += 1;
    }
    nodes.push(
      <p key={`p-${nodes.length}`} className="ai-canvas-md-p">
        {withMath(para.join(' '), `p-${nodes.length}`)}
      </p>,
    );
  }
  return <div className="ai-canvas-md">{nodes}</div>;
}

function renderMermaid(payload: string): JSX.Element {
  /* Drawn, not printed: MermaidBlock.tsx holds the gate and the fallback. */
  return <MermaidBlock payload={payload} />;
}

function renderSvg(payload: string): JSX.Element {
  if (payload.trimStart().startsWith('<svg')) {
    return (
      <div
        className="ai-canvas-svg"
        data-testid="ai-canvas-svg-inline"
        // SVG from the model — no script; contract forbids it server-side too.
        dangerouslySetInnerHTML={{ __html: payload }}
      />
    );
  }
  return <pre className="ai-canvas-block-body">{payload}</pre>;
}

function renderHtml(payload: string): JSX.Element {
  const doc = htmlSandboxDocument(payload, { scripts: true });
  return (
    <iframe
      className="ai-canvas-html-frame"
      data-testid="ai-canvas-html-frame"
      title="HTML canvas block"
      /*
       * STAGE 4 — the canvas may run scripts. Owner, 2026-09-14: "i allow
       * scrits in sandbox"; Decision 15 carries the ruling and the threat
       * model, `aiCanvasViewers.ts` the mechanism.
       *
       * `allow-scripts` AND NOTHING ELSE. Adding `allow-same-origin` beside it
       * is not a weaker sandbox, it is no sandbox — a frame holding both can
       * reach this very element through `window.parent` and delete the
       * attribute. The omission is the boundary, so it is spelled out at the
       * only place someone would be tempted to "just add one more".
       *
       * The document it renders carries a CSP of `default-src 'none'`, so the
       * widget can compute and draw and cannot reach the network.
       */
      sandbox="allow-scripts"
      srcDoc={doc}
    />
  );
}

function renderReact(payload: string): JSX.Element {
  return <ReactCanvasMount source={payload} />;
}

export function AiCanvasBlockBody({ block }: { block: CanvasDocBlock }) {
  switch (block.type) {
    case 'markdown':
      return renderMarkdown(block.payload);
    case 'mermaid':
      return renderMermaid(block.payload);
    case 'svg':
      return renderSvg(block.payload);
    case 'html':
      return renderHtml(block.payload);
    case 'react':
      return renderReact(block.payload);
    default:
      return <pre className="ai-canvas-block-body">{block.payload}</pre>;
  }
}
