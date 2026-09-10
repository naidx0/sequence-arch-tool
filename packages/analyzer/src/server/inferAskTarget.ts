/**
 * Pure ask-target inference (no I/O). Decides whether a question targets the
 * architecture graph or the canvas/whiteboard. Explicit choice wins; else a
 * canvas word in the question routes to the canvas; else a recommended target
 * if supplied; else `architecture` (the historical default).
 */
export type AskTarget = 'architecture' | 'canvas';

const CANVAS_RE = /\b(canvas|whiteboard|tldraw|freehand|sketch artifact)\b/i;

export function inferAskTarget(
  question: string,
  opts?: { explicit?: AskTarget; recommended?: AskTarget },
): AskTarget {
  if (opts?.explicit === 'architecture' || opts?.explicit === 'canvas') {
    return opts.explicit;
  }
  if (CANVAS_RE.test(question ?? '')) {
    return 'canvas';
  }
  if (opts?.recommended === 'architecture' || opts?.recommended === 'canvas') {
    return opts.recommended;
  }
  return 'architecture';
}
