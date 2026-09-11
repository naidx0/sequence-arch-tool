import type { AskStreamEvent, PostAskStreamRequest } from '@sequence/api-types';

import { isSameOriginPath, type WireResult } from '../boot';

/**
 * THE ASK TRANSPORT — item 2.9, and until now it did not exist.
 *
 * `packages/web2` never called `/api/ask` or `/api/ask/stream`. The only two
 * mentions of either route in the whole package were in test files, and
 * `state/store.ts` says why in as many words: *"WHAT THIS FILE DELIBERATELY DOES
 * NOT DO: fetch. There is no transport in the store. Item 2.9 owns the ask
 * transport."* The store was right to refuse it and item 2.9 was never built, so
 * `onSend` dispatched `turn/send` — which records the user's message — and
 * nothing else happened. Measured in the running app: type a question, press
 * Send, and the text lands in the transcript while NO request is made at all.
 * No answer, no error, and nothing to stop.
 *
 * The reducer has been waiting the whole time: `turn/send`, `turn/event`,
 * `turn/stopping` and `turn/stopped` all exist and are tested. This file is the
 * missing half — it turns an SSE body into `AskStreamEvent`s and hands them in
 * as actions, exactly as `boot/bootClient.ts` does for the boot ladder.
 *
 * INJECTABLE `fetch` for the same reason the boot transport takes one: a
 * transport that reaches for the global cannot be tested without a server, and
 * that is how v1's `aiClient.ts` reached 48 KB and thirty-odd bespoke call sites.
 */

/** The one route this transport touches. Relative, so it is same-origin by construction. */
export const ASK_STREAM_ROUTE = '/api/ask/stream';

export interface AskStreamHandlers {
  /** Every frame the server sent, in order, as it arrives. */
  onEvent: (event: AskStreamEvent) => void;
  /** Aborting this is what Stop does; the server already races the abort. */
  signal?: AbortSignal;
}

export interface AskTransport {
  stream(request: PostAskStreamRequest, handlers: AskStreamHandlers): Promise<WireResult<null>>;
}

/**
 * Split an SSE buffer into complete frames, returning the remainder.
 *
 * Exported because the framing is the part that breaks: a chunk boundary can
 * fall anywhere, including inside a JSON payload, and a parser that assumes one
 * chunk is one frame works on a fast localhost and corrupts the first slow
 * answer a user ever sees.
 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  for (;;) {
    const at = rest.indexOf('\n\n');
    if (at < 0) break;
    frames.push(rest.slice(0, at));
    rest = rest.slice(at + 2);
  }
  return { frames, rest };
}

/**
 * The `AskStreamEvent` a frame carries, or `null` when it carries none.
 *
 * A frame that is not JSON, or is JSON without a `type`, is DROPPED rather than
 * thrown: an SSE stream also carries comments and keep-alives, and one
 * unparseable frame must not end an answer that is otherwise arriving fine.
 */
/**
 * The `id:` a frame carries, or null.
 *
 * This is the cursor that makes a dropped connection recoverable: the server
 * commits every event to a per-turn log BEFORE writing it here, so an id a
 * client has seen is an id that is on disk and can be replayed from.
 *
 * Null is ordinary - a keep-alive comment has no id, and so does a turn the
 * server could not record - and a null must never be read as zero, which
 * would ask for a replay of the whole turn.
 */
export function seqFromFrame(frame: string): number | null {
  for (const line of frame.split('\n')) {
    if (!line.startsWith('id:')) continue;
    const n = Number.parseInt(line.slice(3).trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function eventFromFrame(frame: string): AskStreamEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string') {
      return parsed as AskStreamEvent;
    }
  } catch {
    /* not JSON — a comment or a keep-alive. */
  }
  return null;
}

/** Where a dropped turn is picked back up. */
const ASK_REPLAY_ROUTE = '/api/ask/events';

/**
 * Ask the engine for everything this turn emitted after `since`.
 *
 * Answers true only when the turn was found AND replayed, so the caller can
 * tell "recovered" from "there was nothing to recover" and report the failure
 * honestly in the second case. A resume that silently reported success would
 * leave the reader looking at half an answer with no error to explain it.
 */
async function resumeTurn(
  fetchImpl: typeof fetch,
  runId: string | null,
  since: number,
  onEvent: (event: AskStreamEvent) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  if (runId === null || since <= 0) return false;
  if (!isSameOriginPath(ASK_REPLAY_ROUTE)) return false;
  try {
    const res = await fetchImpl(
      `${ASK_REPLAY_ROUTE}?runId=${encodeURIComponent(runId)}&since=${String(since)}`,
      { signal },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { events?: { event?: unknown }[] };
    if (!Array.isArray(body.events)) return false;
    for (const row of body.events) {
      const event = row?.event;
      if (event && typeof event === 'object' && typeof (event as { type?: unknown }).type === 'string') {
        onEvent(event as AskStreamEvent);
      }
    }
    return true;
  } catch {
    /* The engine is gone too. The original failure is the true one. */
    return false;
  }
}

export function createAskTransport(fetchImpl: typeof fetch): AskTransport {
  return {
    async stream(request, { onEvent, signal }) {
      if (!isSameOriginPath(ASK_STREAM_ROUTE)) {
        return { outcome: 'unreachable', message: 'the ask route is not same-origin' };
      }

      let response: Response;
      try {
        response = await fetchImpl(ASK_STREAM_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal,
        });
      } catch (error) {
        /* An abort is the user pressing Stop, not a failure to report. */
        if (signal?.aborted) return { outcome: 'ok', status: 200, body: null };
        return { outcome: 'unreachable', message: (error as Error).message };
      }

      if (!response.ok) {
        return { outcome: 'error', status: response.status, body: null };
      }

      const body = response.body;
      if (!body) {
        return { outcome: 'not-json', status: response.status };
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      /* THE TWO THINGS A RESUME NEEDS: which turn, and how far it got. */
      let runId: string | null = null;
      let lastSeq = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = splitFrames(buffer);
          buffer = rest;
          for (const frame of frames) {
            const event = eventFromFrame(frame);
            if (!event) continue;
            /* The turn names itself in its first event, and every event
               carries the cursor to resume from. Both are recorded before the
               event is handed on, so a throw inside `onEvent` cannot lose the
               position the resume depends on. */
            if (event.type === 'trajectory:start' && typeof (event as { runId?: unknown }).runId === 'string') {
              runId = (event as { runId: string }).runId;
            }
            const seq = seqFromFrame(frame);
            if (seq !== null) lastSeq = seq;
            onEvent(event);
          }
        }
        /* A stream that ends mid-frame has one last complete frame only if the
         * server closed cleanly after it; anything partial is discarded rather
         * than half-parsed into an event nobody sent. */
        const tail = eventFromFrame(buffer);
        if (tail) onEvent(tail);
      } catch (error) {
        /* An abort is the user pressing Stop. Nothing to recover - they asked
           for it to end - and replaying would put back the answer they just
           stopped. */
        if (signal?.aborted) return { outcome: 'ok', status: 200, body: null };

        /*
         * THE CONNECTION DIED, BUT THE TURN DID NOT.
         *
         * The server commits every event to a per-turn log before writing it
         * to the socket, and the provider call keeps running regardless -
         * `ProviderStreamOptions` has no `signal`, so the socket closing never
         * stopped it. Before this, that answer was paid for and discarded.
         *
         * Replaying needs both cursors. Without a `runId` there is no turn to
         * name, and without an id the server never recorded one - in either
         * case the honest outcome is the failure, not a silent empty resume.
         */
        const replayed = await resumeTurn(fetchImpl, runId, lastSeq, onEvent, signal);
        if (replayed) return { outcome: 'ok', status: 200, body: null };
        return { outcome: 'unreachable', message: (error as Error).message };
      }

      return { outcome: 'ok', status: response.status, body: null };
    },
  };
}
