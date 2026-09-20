/**
 * Shared prose renderer for V3 bubbles and any surface that must not
 * print literal `**markdown**`. Same rules as Transcript's ProseBlockView,
 * including tool-dump fences → ToolCallCard (not wide `<pre>`).
 */
import { createElement, Fragment } from 'react';

import { withMath } from './MathText';
import { proseBlocks, type ProseBlock, type ProseSpan } from './proseBlocks';
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
        span.code ? (
          <code key={i} className="prose-tick" data-testid="chat-tick">
            {span.text}
          </code>
        ) : span.strong ? (
          <strong key={i} data-testid="chat-strong">
            {withMath(span.text, `s${i}`, 'prose')}
          </strong>
        ) : (
          <span key={i}>{withMath(span.text, `s${i}`, 'prose')}</span>
        ),
      )}
    </>
  );
}

function ProseBlockView({ block }: { block: ProseBlock }) {
  switch (block.kind) {
    case 'code':
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
      return (
        <pre className="prose-code" data-testid="chat-code" data-language={block.language ?? undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case 'heading':
      return createElement(
        `h${block.level}`,
        { className: 'prose-h', 'data-testid': 'chat-heading', 'data-level': block.level },
        <Spans spans={block.spans} />,
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className="prose-list" data-testid="chat-list" data-ordered={block.ordered || undefined}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Spans spans={item} />
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
    case 'para':
    default:
      return (
        <p>
          <Spans spans={block.spans} />
        </p>
      );
  }
}

export function ProseMessage({ text, className }: { text: string; className?: string }) {
  const blocks = proseBlocks(text);
  return (
    <div className={className ? `prose ${className}` : 'prose'} data-testid="v3-prose">
      {blocks.map((block, i) => (
        <Fragment key={i}>
          <ProseBlockView block={block} />
        </Fragment>
      ))}
    </div>
  );
}
