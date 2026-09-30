/**
 * THINKING IS NOT THE ANSWER, AND UNTIL NOW IT PAINTED AS IF IT WERE.
 *
 * Owner, 2026-09-13: *"If it's in thinking mode versus output mode it should be
 * a different font colour."* `GRAPHITE-DECISIONS.md` recorded it as open
 * because it was not clear whether he meant the reasoning ROWS (which already
 * carry their own treatment) or the streaming answer text. Reading the code
 * settles it: the streaming answer text, and it is a real defect underneath the
 * request.
 *
 * MEASURED IN THE CODE, not guessed at. Two separate facts:
 *
 *  1. `provider.ts:1604` deliberately does NOT read `reasoning_content`
 *     (DeepSeek-R1 and friends) — "folding reasoning in here would make the two
 *     paths answer differently." So THAT channel never reaches the client, and
 *     it is not what this is about.
 *
 *  2. Local models put their reasoning INLINE, in `content`, wrapped in
 *     `<think>` tags. `provider.ts:199` records it against granite42-hermes:
 *     "every Teach turn opened a reasoning block the reader never sees …
 *     316 characters of unseen reasoning". `reasoningEffort` turns it off where
 *     the model honours the field. Where it does not, the tags arrive in the
 *     stream — and nothing on the client has ever looked for them, so
 *     `<think>` and its contents print into the answer as literal text.
 *
 * So the answer to "a different font colour" is: separate the two, and let the
 * transcript recede the thinking. That is one change closing a request and a
 * defect at once.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 *
 * It does not HIDE anything. `docs/vision.md` §5's honesty invariants and this
 * surface's whole job are fidelity: the reader sees what the model actually
 * produced. Recessive ink and a label say "this is the model thinking"; a
 * `display:none` would say "the model did not say this", which is false.
 *
 * It also does not invent a thinking segment. A turn with no tags produces one
 * answer segment and the transcript is byte-identical to before.
 */

export type ThoughtKind = 'thinking' | 'answer';

export interface ThoughtSegment {
  kind: ThoughtKind;
  text: string;
  /**
   * True for a `<think>` that has not closed yet — the model is mid-thought.
   * The renderer uses it to say "Thinking…" rather than "Thought", and it is
   * the reason this cannot be a simple regex replace: an unterminated tag is
   * the NORMAL state during a stream, not a malformed one.
   */
  open?: true;
}

/**
 * The tags local models actually emit.
 *
 * `<think>` is the common one (Qwen, DeepSeek-distills, the hermes builds Max
 * runs). `<thinking>` is Anthropic-shaped and shows up in models trained on
 * that transcript style. Both, because getting this wrong shows the reader raw
 * XML in the middle of an answer, and the cost of the extra alternative is one
 * regex branch.
 *
 * Deliberately NOT a general XML parse: these are the two literal tags that
 * occur, and a permissive "any tag" rule would eat `<div>` out of a code
 * snippet the model was explaining.
 */
const OPEN_RE = /<(think|thinking)\s*>/i;
const closeReFor = (tag: string): RegExp => new RegExp(`</${tag}\\s*>`, 'i');

/**
 * Split streamed assistant text into thinking and answer, in order.
 *
 * ORDER IS KEPT rather than the two being bucketed, because a model may think,
 * answer, think again and correct itself, and a transcript that showed all the
 * thinking first would be a record of something that did not happen.
 *
 * Empty segments are dropped — a `</think>` immediately followed by the answer
 * must not produce a blank paragraph — but a segment that is only whitespace
 * INSIDE an open think is kept as open, so the "Thinking…" label appears the
 * moment the tag does rather than one token later.
 */
export function splitThinking(text: string): ThoughtSegment[] {
  const segments: ThoughtSegment[] = [];
  let rest = text;

  const pushAnswer = (s: string): void => {
    if (s.trim() !== '') segments.push({ kind: 'answer', text: s });
  };

  for (;;) {
    const open = OPEN_RE.exec(rest);
    if (open === null) {
      pushAnswer(rest);
      break;
    }
    pushAnswer(rest.slice(0, open.index));
    const after = rest.slice(open.index + open[0].length);
    const close = closeReFor(open[1]!).exec(after);
    if (close === null) {
      /* STILL THINKING. The tag opened and the stream has not closed it, which
         is the ordinary mid-stream state — the whole reason this returns a flag
         instead of waiting for a closing tag that may be seconds away. */
      segments.push({ kind: 'thinking', text: after, open: true });
      break;
    }
    const body = after.slice(0, close.index);
    if (body.trim() !== '') segments.push({ kind: 'thinking', text: body });
    rest = after.slice(close.index + close[0].length);
  }

  return segments;
}

/** True when any of the text is the model thinking rather than answering. */
export function hasThinking(segments: readonly ThoughtSegment[]): boolean {
  return segments.some((s) => s.kind === 'thinking');
}

/**
 * The answer alone — every thinking segment removed.
 *
 * For the places that need the ANSWER and not the record of producing it: the
 * "did this turn say anything?" test, and anything that measures the reply.
 * Counting a thought as an answer is how a turn that only thought reads as a
 * turn that answered.
 */
export function answerText(text: string): string {
  return splitThinking(text)
    .filter((s) => s.kind === 'answer')
    .map((s) => s.text)
    .join('')
    .trim();
}
