/**
 * Shared prose renderer for V3 bubbles and any surface that must not
 * print literal `**markdown**`. Same rules as Transcript's ProseBlockView,
 * including tool-dump fences → ToolCallCard (not wide `<pre>`).
 */
import { createElement, Fragment, lazy, memo, Suspense, useContext, useMemo, useRef } from 'react';

import { CodeBlock } from './CodeBlock';
import { DiagramBlock, isDiagramLanguage, StreamingContext } from './DiagramBlock';
import { HtmlBlock } from './VisualBlock';

/* The visual kit loads on first use: its renderers stay out of the boot chunk. */
const VisualKitBlock = lazy(() => import('./VisualKitBlock'));
import { DrawingContext, type DrawingOrigin } from './drawingContext';
import { VisualFile, visualFilesIn } from './VisualFile';
import './r9.css';
import { withMath } from './MathText';
import { growSegments, isLocalPath, proseBlocks, type ProseBlock, type ProseSpan } from './proseBlocks';
import { isToolDumpCode, toolNameFromDump } from './stripToolProse';
import { ToolCallCard } from './ToolCallCard';

/*
 * ── MATHS IN THE TRANSCRIPT, LIKE OBSIDIAN (owner, 2026-09-19) ────────────
 *
 * "Fix also the embed in the chat output — math functions should be output
 * properly as if they were in Obsidian."
 *
 * The AI Canvas has typeset `$…$` and `$$…$$` since the maths wave and the
 * chat printed the dollars, so the product typeset maths in the document it
 * writes and not in the sentence it says.
 *
 * NEVER INSIDE A CODE SPAN, which is the same line `inlineSpans` already
 * draws for emphasis: a backtick span is what the model asked to be shown
 * verbatim, and `$HOME` or `awk '{print $1}'` inside one is a shell, not an
 * equation. The parser behind this (`canvasMath.splitMath`) refuses a lone
 * `$` for the same reason — "it cost $5" is not an opening delimiter.
 *
 * A STRONG SPAN STILL GETS IT. Obsidian typesets `**$E=mc^2$**`, and a rule
 * that dropped maths inside emphasis would be a second, quieter place the two
 * surfaces disagreed.
 */
function Spans({ spans }: { spans: ProseSpan[] }) {
  return (
    <>
      {spans.map((span, i) =>
        span.link !== undefined ? (
          isLocalPath(span.link) ? (
            /* A file on this machine: its name as the agent labelled it, the
               full path on hover (never a 70-character path in the sentence). */
            <span key={i} className="prose-path" data-testid="chat-path" data-path={span.link} title={span.link}>
              {span.text}
            </span>
          ) : /^https?:\/\//i.test(span.link) ? (
            <a key={i} className="prose-link" href={span.link} title={span.link} target="_blank" rel="noopener noreferrer">
              {span.text}
            </a>
          ) : (
            <span key={i} title={span.link}>
              {span.text}
            </span>
          )
        ) : span.code && span.strong ? (
          /* Code inside a bold sentence — see `inlineSpans`. */
          <strong key={i} data-testid="chat-strong">
            <code className="prose-tick" data-testid="chat-tick">
              {span.text}
            </code>
          </strong>
        ) : span.code ? (
          <code key={i} className="prose-tick" data-testid="chat-tick">
            {span.text}
          </code>
        ) : span.strong && span.em ? (
          <strong key={i} data-testid="chat-strong">
            <em data-testid="chat-em">{withMath(span.text, `s${i}`, 'prose')}</em>
          </strong>
        ) : span.strong ? (
          <strong key={i} data-testid="chat-strong">
            {withMath(span.text, `s${i}`, 'prose')}
          </strong>
        ) : span.em ? (
          <em key={i} data-testid="chat-em">
            {withMath(span.text, `s${i}`, 'prose')}
          </em>
        ) : (
          <span key={i}>{withMath(span.text, `s${i}`, 'prose')}</span>
        ),
      )}
    </>
  );
}

export function ProseBlockView({ block }: { block: ProseBlock }) {
  switch (block.kind) {
    case 'code':
      /* A visual block is the kit's spec, which can look like a tool dump (nodes, edges): decide it first. */
      if (block.language === 'visual') {
        return (
          <Suspense fallback={null}>
            <VisualKitBlock source={block.text} open={block.open === true} drawingId={block.drawingId} />
          </Suspense>
        );
      }
      if (isToolDumpCode(block.language, block.text)) {
        const name = toolNameFromDump(block.text);
        return (
          <ToolCallCard
            tool={{
              id: `fence-${name}`,
              name,
            }}
            detail={block.text}
          />
        );
      }
      if (isDiagramLanguage(block.language)) return <DiagramBlock kind={block.language} source={block.text} open={block.open === true} drawingId={block.drawingId} />;
      if (block.language === 'html') return <HtmlBlock source={block.text} open={block.open === true} drawingId={block.drawingId} />;
      return <CodeBlock text={block.text} language={block.language} />;
    case 'heading':
      return createElement(
        `h${block.level}`,
        { className: 'prose-h', 'data-testid': 'chat-heading', 'data-level': block.level },
        <Spans spans={block.spans} />,
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className="prose-list" data-testid="chat-list" data-ordered={block.ordered || undefined} {...(block.ordered && block.start ? { start: block.start } : {})}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Spans spans={item} />
              {block.nested?.[i] ? <ProseBlockView block={block.nested[i]!} /> : null}
            </li>
          ))}
        </Tag>
      );
    }
    case 'details':
      return (
        <details className="prose-details" data-testid="chat-details">
          <summary>
            <Spans spans={block.summary} />
          </summary>
          {block.blocks.map((inner, i) => (
            <ProseBlockView key={i} block={inner} />
          ))}
        </details>
      );
    case 'quote':
      return (
        <blockquote className="prose-quote" data-testid="chat-quote">
          {block.blocks.map((inner, i) => (
            <ProseBlockView key={i} block={inner} />
          ))}
        </blockquote>
      );
    case 'table':
      return (
        <div className="prose-table-wrap" data-testid="chat-table">
          <table className="prose-table">
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} style={block.align[i] ? { textAlign: block.align[i]! } : undefined}>
                    <Spans spans={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} style={block.align[i] ? { textAlign: block.align[i]! } : undefined}>
                      <Spans spans={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="prose-rule" />;
    case 'para':
    default:
      return (
        <>
          <p>
            <Spans spans={block.spans} />
          </p>
          {visualFilesIn(block.spans).map((f) => (
            <VisualFile key={f.path} path={f.path} kind={f.kind} />
          ))}
        </>
      );
  }
}

/*
 * ── A STREAMED ANSWER COSTS ITS NEW TEXT, NOT ITS WHOLE LENGTH ───────────
 *
 * The answer arrives in chunks and this component re-renders on each one. It
 * used to re-parse and re-draw the whole message every time: on a 9 KB reply
 * in 48-character chunks that was 862 K characters parsed (95x the reply).
 * The message is now cut at its top-level blank lines (`proseSegments`), each
 * piece is parsed and drawn by a memoised component keyed by position, and a
 * piece whose source string has not changed is not touched again. Only the
 * open piece at the end re-parses. Code blocks are drawn as their own
 * strings inside their own piece, so a long two-byte message (an em dash is
 * enough) is never walked whole per chunk. Locked by proseStreaming.test.tsx.
 */
const ProseSegment = memo(function ProseSegment({ source }: { source: string }) {
  const streaming = useContext(StreamingContext);
  const blocks = useMemo(() => proseBlocks(source, streaming), [source, streaming]);
  return (
    <>
      {blocks.map((block, i) => (
        <Fragment key={i}>
          <ProseBlockView block={block} />
        </Fragment>
      ))}
    </>
  );
});

export function ProseMessage({ text, className, streaming = false, drawing = null }: { text: string; className?: string; streaming?: boolean; drawing?: DrawingOrigin | null }) {
  /* The finished pieces are kept across chunks; only the text after them is
     scanned again (`growSegments`). */
  const scan = useRef<ReturnType<typeof growSegments> | null>(null);
  const segments = useMemo(() => {
    scan.current = growSegments(scan.current, text);
    return scan.current.segments;
  }, [text]);
  return (
    <DrawingContext.Provider value={drawing}>
      <StreamingContext.Provider value={streaming}>
        <div className={className ? `prose ${className}` : 'prose'} data-testid="v3-prose" data-streaming={streaming || undefined}>
          {segments.map((source, i) => (
            <ProseSegment key={i} source={source} />
          ))}
        </div>
      </StreamingContext.Provider>
    </DrawingContext.Provider>
  );
}
