import katex from 'katex';
import 'katex/dist/katex.min.css';

import { splitMath } from './canvasMath';

/**
 * One maths run, typeset — or its own source when KaTeX will not have it.
 *
 * NEVER THROWS. KaTeX rejects malformed input, and a canvas that blanks or
 * crashes on one bad formula loses the whole document the model wrote. A
 * rejected span renders as the SOURCE the model asked for, verbatim, so the
 * reader can see and judge it. That is the honest-errors rule applied to a
 * renderer: the one outcome a reader cannot act on is silence.
 *
 * `dangerouslySetInnerHTML` is safe here in the one way that matters: the HTML
 * is produced by KaTeX from the tex, not taken from the payload, and KaTeX's
 * own output is escaped. The raw payload never reaches the DOM as markup.
 */
function MathRun({ tex, display }: { tex: string; display: boolean }) {
  let html: string | null = null;
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: true });
  } catch {
    html = null;
  }
  if (html === null) {
    return (
      <code className="ai-canvas-math-raw" data-testid="ai-canvas-math-raw">
        {display ? `$$${tex}$$` : `$${tex}$`}
      </code>
    );
  }
  return (
    <span
      className={display ? 'ai-canvas-math ai-canvas-math-display' : 'ai-canvas-math'}
      data-testid="ai-canvas-math"
      data-display={display ? 'true' : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A paragraph's text, with any maths runs typeset in place. */
function withMath(text: string, key: string): JSX.Element[] {
  return splitMath(text).map((seg, i) =>
    seg.kind === 'text' ? (
      <span key={`${key}-t${i}`}>{seg.text}</span>
    ) : (
      <MathRun key={`${key}-m${i}`} tex={seg.tex} display={seg.display} />
    ),
  );
}

/**
 * Typed block renderers for AI Canvas — all five native writers (Wave L3).
 */

import type { CanvasDocBlock } from '../state/types';
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
        <div key={`code-${nodes.length}`} className="ai-canvas-md-codewrap">
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
  return (
    <div className="ai-canvas-mermaid" data-testid="ai-canvas-mermaid">
      <div className="ai-canvas-mermaid-box">
        <pre className="ai-canvas-mermaid-src">{payload}</pre>
      </div>
    </div>
  );
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
  const doc = htmlSandboxDocument(payload);
  return (
    <iframe
      className="ai-canvas-html-frame"
      data-testid="ai-canvas-html-frame"
      title="HTML canvas block"
      sandbox=""
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
