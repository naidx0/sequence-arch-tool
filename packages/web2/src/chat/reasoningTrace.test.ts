import { describe, expect, it } from 'vitest';

import { REASONING_LEAD_MAX, segmentReasoning } from './reasoningTrace';

/* ══════════════════════════════════════════════════════════════════════════
   THE SEGMENTER'S LOCK: ONLY THE MODEL'S OWN DELIMITERS CREATE STEPS
   packages/web2/src/chat/reasoningTrace.test.ts

   Every test payloads here is the shape real providers hand the fold: one
   accumulated string (reasoning deltas joined), paragraphs on blank lines,
   the occasional markdown heading the local models write, and the tail that
   is still being written. Grounding: a step's lead is always a verbatim
   slice of the input and a title exists only where the model wrote one.
   ══════════════════════════════════════════════════════════════════════════ */

describe('segments come from the model own delimiters', () => {
  it('paragraph breaks make steps, and the lead is the first sentence verbatim', () => {
    const text =
      'The gateway routes /checkout to the payments service. I need to see who writes that queue.\n\n' +
      'orders emits payment.requested, payments consumes it.';
    const steps = segmentReasoning(text);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.lead).toBe('The gateway routes /checkout to the payments service.');
    expect(steps[0]!.body).toBe('I need to see who writes that queue.');
    expect(steps[1]!.lead).toBe('orders emits payment.requested, payments consumes it.');
    expect(steps[1]!.body).toBe('');
  });

  it('a markdown heading the model wrote becomes the title of the step that follows it', () => {
    const steps = segmentReasoning('First, orient.\n\n## Check the gateway\n\nIt fans out to three callers.');
    expect(steps).toHaveLength(2);
    expect(steps[0]!.title).toBeNull();
    expect(steps[1]!.title).toBe('Check the gateway');
    expect(steps[1]!.lead).toBe('It fans out to three callers.');
  });

  it('"Plan:" closes a lead the way ai-traces formats a step', () => {
    const steps = segmentReasoning('Plan: read the router, then check its callers. The callers are indexed.');
    expect(steps).toHaveLength(1);
    expect(steps[0]!.lead).toBe('Plan: read the router, then check its callers.');
    expect(steps[0]!.body).toBe('The callers are indexed.');
  });

  it('one stream, no delimiters: one step, not five', () => {
    const text = 'Just read the README first and answer from what it actually says';
    expect(segmentReasoning(text)).toHaveLength(1);
    expect(segmentReasoning(text)[0]!.body).toBe('');
  });

  it('CRLF arrives and breaks paragraphs the same way', () => {
    const steps = segmentReasoning('First thought.\r\n\r\nSecond thought.');
    expect(steps).toHaveLength(2);
    expect(steps[1]!.lead).toBe('Second thought.');
  });
});

describe('nothing is invented, nothing crashes', () => {
  it('empty, whitespace-only and non-string input render nothing', () => {
    expect(segmentReasoning('')).toEqual([]);
    expect(segmentReasoning('\n\n \t \n')).toEqual([]);
  });

  it('a bare # line names no title', () => {
    const steps = segmentReasoning('#\n\nIt fans out.');
    expect(steps).toHaveLength(1);
    expect(steps[0]!.title).toBeNull();
  });

  it('every lead is a slice of the input (no paraphrase, no synthesis)', () => {
    const text =
      'First, orient. Where does the ask land?\n\n## Notes\n\n- read the router\n- then its callers';
    for (const step of segmentReasoning(text)) {
      expect(text.includes(step.lead)).toBe(true);
      if (step.body) expect(text.includes(step.body)).toBe(true);
      if (step.title !== null) expect(text.includes(step.title)).toBe(true);
    }
  });

  it('a very long run still stays one whole record, capped per step', () => {
    const para = 'x'.repeat(600);
    const steps = segmentReasoning(`${para}\n\n${para}`);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.lead).toHaveLength(REASONING_LEAD_MAX);
    expect(steps[0]!.body.length).toBeGreaterThan(0);
  });
});

describe('the in-flight tail', () => {
  const text = 'First paragraph, done. Continue elsewhere.\n\nNow thinking about the callers';

  it('tailOpen marks only the last paragraph, and only when asked', () => {
    const settled = segmentReasoning(text);
    expect(settled.every((s) => !s.open)).toBe(true);
    const live = segmentReasoning(text, { tailOpen: true });
    expect(live[live.length - 1]!.open).toBe(true);
    expect(live[live.length - 1]!.body).toBe('');
  });

  it('tailOpen on a settled stream that already ended a paragraph still marks the tail honestly', () => {
    const live = segmentReasoning('Done thinking.\n\nMid-sentence no period', { tailOpen: true });
    expect(live.map((s) => s.lead)).toEqual(['Done thinking.', 'Mid-sentence no period']);
    expect(live[1]!.open).toBe(true);
  });
});
