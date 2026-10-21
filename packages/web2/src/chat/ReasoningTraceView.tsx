import { useState } from 'react';

import { REASONING_TRACE_VISIBLE, segmentReasoning } from './reasoningTrace';
import { S2Icon } from '../shell2/icons';

/* ══════════════════════════════════════════════════════════════════════════
   THE REASONING TRACE (AI-Traces port, 0.1.8.4)
   packages/web2/src/chat/ReasoningTrace.tsx

   The renderer side of `reasoningTrace.ts` (`ReasoningTraceView`, named for
   the case-insensitive Windows FS: `ReasoningTrace.tsx` resolved to
   `reasoningTrace.ts` and the component imported undefined): the fold's body walks the model's
   reasoning as steps — a dot on the rail per step (the reference's marker; the paragraph
   still being written is the lit one), not a logo repeated down the rail, the step's lead in ink-2, its remainder recessive, a title only where
   the model wrote one. More steps than one glance holds fold behind a
   "Show N more steps" button; a press is the reader's own choice.

   Renders NOTHING for empty or garbage text: a turn that thought nothing
   shows no fold, and one whose stream is unsegmentable shows no trace shell.
   ══════════════════════════════════════════════════════════════════════════ */

export function ReasoningTraceView({ chunks, streaming }: { chunks: readonly string[]; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  /* Each source chunk segments on its own, so the provider's reasoning
     channel and an inline think-tag chunk never merge into one fabricated
     paragraph break. The LAST chunk is the only one that can still be
     mid-paragraph. */
  const steps = chunks.flatMap((chunk, i) =>
    segmentReasoning(chunk, { tailOpen: Boolean(streaming) && i === chunks.length - 1 }),
  );
  if (steps.length === 0) return null;

  const shown = expanded ? steps : steps.slice(0, REASONING_TRACE_VISIBLE);
  const hidden = steps.length - REASONING_TRACE_VISIBLE;

  return (
    <div className="s2-think-trace" data-testid="reasoning-trace">
      {shown.map((step, i) => (
        <div
          className="s2-think-step"
          data-testid="reasoning-step"
          data-open={step.open ? 'true' : undefined}
          key={i}
        >
          <span className="s2-think-dot" data-testid="reasoning-step-mark" data-state={step.open ? 'live' : 'done'} aria-hidden="true" />
          <div className="s2-think-step-c">
            {step.title !== null ? <div className="s2-think-step-t">{step.title}</div> : null}
            <div className="s2-think-step-lead">{step.lead}</div>
            {step.body ? <div className="s2-think-step-b">{step.body}</div> : null}
          </div>
        </div>
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          className="s2-think-more s2-ibtn s2-ibtn-xs"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((v) => !v);
          }}
          data-testid="reasoning-more"
        >
          <S2Icon name={expanded ? 'chev' : 'chevr'} small />
          {expanded ? 'Show fewer steps' : `Show ${hidden} more step${hidden === 1 ? '' : 's'}`}
        </button>
      ) : null}
    </div>
  );
}
