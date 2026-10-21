/* ══════════════════════════════════════════════════════════════════════════
   THE REASONING AS STRUCTURED STEPS (AI-Traces port, 0.1.8.4)
   packages/web2/src/chat/reasoningTrace.ts

   The thinking channel arrives as ONE stream of text, and until now the fold
   painted it as one wall (the store keeps only the tail and V3Chat paints the
   chunks flat). The owner asked for the AI-Traces shape: the model's reasoning
   broken into steps a reader can walk, in a fold that stays collapsed until
   asked.

   THE LAW IS GROUNDING. The breakdown comes only from delimiters the model
   itself produced — a `## Heading` line, a paragraph break, a sentence
   boundary. Nothing is invented: no synthesised titles, no status labels the
   wire did not carry. A reasoning stream that arrives as one sentence is ONE
   step, not five.
   ══════════════════════════════════════════════════════════════════════════ */

/** The model's own heading (`## Like this`), or null where it wrote none. */
export interface ReasoningStep {
  title: string | null;
  /** The model's own first sentence, verbatim. */
  lead: string;
  /** The rest of the paragraph, verbatim. Empty when the paragraph was one sentence. */
  body: string;
  /** The stream is still writing this paragraph (`tailOpen`, mid-stream). */
  open?: true;
}

/** A markdown ATX heading line. Only these count — no `#hashtag` false hits. */
const HEADING_RE = /^\s*#{1,6}[ \t]+(.+?)[ \t]*$/;

/** A terminator the model itself set down. Only a strong one splits a lead:
    "Plan: read the router, then check its callers." reads as one sentence. */
const SENTENCE_END_RE = /[.!?]['")\]]?(?=\s|$)/;

/** A bare marker line (`#`, `##`) is a heading painted without ink: it names no step. */
const BARE_MARKER_RE = /^\s*#{1,6}\s*$/;

/** Beyond this the lead is cut at the cap's byte, with no invented ellipsis. */
export const REASONING_LEAD_MAX = 220;

/** The steps a fold shows before the reader asks for the rest. */
export const REASONING_TRACE_VISIBLE = 6;

function leadOf(raw: string): { lead: string; body: string } {
  const windowed = raw.slice(0, REASONING_LEAD_MAX + 40);
  const strong = SENTENCE_END_RE.exec(windowed);
  if (strong !== null) {
    const cut = strong.index + strong[0].length;
    const lead = raw.slice(0, cut).trim();
    const body = raw.slice(cut).trim();
    return lead === '' ? leadOf(body) : { lead, body };
  }
  /* No sentence boundary: the paragraph's first line carries the lead, so a
     multi-line block still opens with one readable line. */
  const firstBreak = raw.indexOf('\n');
  if (firstBreak > 0 && firstBreak <= REASONING_LEAD_MAX) {
    return { lead: raw.slice(0, firstBreak).trim(), body: raw.slice(firstBreak + 1).trim() };
  }
  if (raw.length <= REASONING_LEAD_MAX) return { lead: raw.trim(), body: '' };
  return { lead: raw.slice(0, REASONING_LEAD_MAX).trim(), body: raw.slice(REASONING_LEAD_MAX).trim() };
}

export function segmentReasoning(text: string, opts?: { tailOpen?: boolean }): ReasoningStep[] {
  if (typeof text !== 'string' || text.trim() === '') return [];

  const steps: ReasoningStep[] = [];
  let title: string | null = null;
  let lines: string[] = [];

  const flush = (): void => {
    const raw = lines.join('\n').trim();
    lines = [];
    if (raw === '' || BARE_MARKER_RE.test(raw)) return;
    const { lead, body } = leadOf(raw);
    if (lead === '') return;
    steps.push({ title, lead, body });
    title = null;
  };

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const head = HEADING_RE.exec(line);
    if (head !== null) {
      flush();
      // A bare `##` with no text names nothing; no invented title.
      title = head[1]!.trim() === '' ? null : head[1]!.trim();
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    lines.push(line);
  }
  flush();

  if (opts?.tailOpen && steps.length > 0 && !steps[steps.length - 1]!.open) {
    const last = steps[steps.length - 1]!;
    steps[steps.length - 1] = { title: last.title, lead: last.lead, body: last.body, open: true };
  }
  return steps;
}
