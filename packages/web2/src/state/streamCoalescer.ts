/**
 * ══ THE TOKEN STREAM, HANDED TO THE STORE IN BREATHS ═══════════════════════
 *
 * Owner, 2026-09-22: "when prompt is sent, some animations stopped like the
 * loading symbol and the thinking sparkle … timer is also not working, tool
 * cards seem to be delayed sometimes".
 *
 * The same afternoon the model's thinking started streaming: tens of
 * thousands of characters a turn, one `reasoning` frame per token. Every
 * frame was a store dispatch and every dispatch re-rendered the app, so the
 * main thread spent the turn in React. The braille spinner steps its glyph on
 * the main thread and stopped; the sparkle stalled; a `tool:start` waited
 * behind a queue of token renders before its card appeared.
 *
 * So text frames — `delta` and `reasoning` — are merged and dispatched at most
 * once per interval. Everything else flushes the pending text FIRST and then
 * goes straight through, so the order the reducer sees is the order the wire
 * sent, and a tool card is never later than the text before it.
 */
import type { AskEvent } from './types';

export const STREAM_COALESCE_MS = 100;

type TextEvent = Extract<AskEvent, { type: 'delta' } | { type: 'reasoning' }>;

function isTextEvent(event: AskEvent): event is TextEvent {
  return event.type === 'delta' || event.type === 'reasoning';
}

export interface StreamCoalescer {
  push: (event: AskEvent, at: number) => void;
  /** Send whatever is pending now — call when the stream ends, however it ends. */
  flush: () => void;
}

export function createStreamCoalescer(
  dispatch: (event: AskEvent, at: number) => void,
  options: {
    intervalMs?: number;
    schedule?: (fn: () => void, ms: number) => unknown;
    cancel?: (handle: unknown) => void;
  } = {},
): StreamCoalescer {
  const intervalMs = options.intervalMs ?? STREAM_COALESCE_MS;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let pending: { type: TextEvent['type']; text: string; at: number } | null = null;
  let timer: unknown = null;

  const flush = (): void => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (pending === null) return;
    const { type, text, at } = pending;
    pending = null;
    dispatch({ type, text } as TextEvent, at);
  };

  const push = (event: AskEvent, at: number): void => {
    if (!isTextEvent(event)) {
      flush();
      dispatch(event, at);
      return;
    }
    if (pending !== null && pending.type !== event.type) flush();
    if (pending === null) {
      /* The FIRST frame's time: `firstTokenAt` is measured off it. */
      pending = { type: event.type, text: event.text, at };
      timer = schedule(flush, intervalMs);
    } else {
      pending.text += event.text;
    }
  };

  return { push, flush };
}
