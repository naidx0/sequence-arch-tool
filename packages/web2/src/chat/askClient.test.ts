import { describe, expect, it, vi } from 'vitest';

import type { AskStreamEvent } from '@sequence/api-types';

import { createAskTransport, eventFromFrame, seqFromFrame, splitFrames } from './askClient';

/**
 * The transport that did not exist.
 *
 * `packages/web2` never called `/api/ask/stream` — pressing Send put the message
 * in the transcript and made no request at all. These lock the two things that
 * decide whether an answer arrives intact: the framing, and what happens when it
 * does not.
 */

/** A body that yields the given chunks, so a frame can be split across them. */
function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = {
    getReader: () => ({
      read: async () =>
        i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]!) } : { done: true, value: undefined },
    }),
  };
  return { ok: true, status: 200, body } as unknown as Response;
}

const frame = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;

describe('splitFrames — a chunk boundary can fall anywhere', () => {
  it('returns complete frames and keeps the remainder', () => {
    const { frames, rest } = splitFrames('data: a\n\ndata: b\n\ndata: par');
    expect(frames).toEqual(['data: a', 'data: b']);
    expect(rest).toBe('data: par');
  });

  it('returns nothing when no frame is complete', () => {
    expect(splitFrames('data: hal').frames).toEqual([]);
  });
});

describe('eventFromFrame — one bad frame must not end a good answer', () => {
  it('reads a data frame', () => {
    expect(eventFromFrame('data: {"type":"file:read","path":"a.ts"}')).toEqual({ type: 'file:read', path: 'a.ts' });
  });

  it('joins a multi-line data payload, as SSE requires', () => {
    expect(eventFromFrame('data: {"type":"file:read",\ndata: "path":"a.ts"}')).toEqual({
      type: 'file:read',
      path: 'a.ts',
    });
  });

  it('drops a comment, a keep-alive and anything that is not an event', () => {
    expect(eventFromFrame(': keep-alive')).toBeNull();
    expect(eventFromFrame('data: not json')).toBeNull();
    expect(eventFromFrame('data: {"no":"type"}')).toBeNull();
    expect(eventFromFrame('')).toBeNull();
  });
});

describe('createAskTransport', () => {
  it('delivers every event in order, even when frames split across chunks', async () => {
    /* Real variants. There is deliberately no `delta` here: the stream has
     * sixteen event types and NONE of them carries a token — token streaming is
     * an open Phase 1 item, and a test that invented the variant would assert a
     * wire that does not exist. */
    const sent = [
      { type: 'file:read', path: 'app/db.py' },
      { type: 'provider:start' },
      { type: 'result', text: 'It reads the graph.' },
    ] as unknown as AskStreamEvent[];
    const whole = sent.map(frame).join('');
    // Cut mid-JSON on purpose: a parser that assumes one chunk is one frame
    // works on localhost and corrupts the first slow answer a user ever sees.
    const chunks = [whole.slice(0, 17), whole.slice(17, 44), whole.slice(44)];

    const seen: AskStreamEvent[] = [];
    const fetchImpl = vi.fn(async () => streamOf(chunks));
    const out = await createAskTransport(fetchImpl as unknown as typeof fetch).stream(
      { question: 'what talks to the database?' },
      { onEvent: (e) => seen.push(e) },
    );

    expect(out.outcome).toBe('ok');
    expect(seen).toEqual(sent);
  });

  it('POSTs the question as JSON to the stream route', async () => {
    const fetchImpl = vi.fn(async () => streamOf([frame({ type: 'result', text: 'ok' })]));
    await createAskTransport(fetchImpl as unknown as typeof fetch).stream(
      { question: 'q', mode: 'research' },
      { onEvent: () => undefined },
    );
    const call = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(call[0]).toBe('/api/ask/stream');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(String(call[1].body))).toEqual({ question: 'q', mode: 'research' });
  });

  it('reports a refusal with its status rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, body: null }) as unknown as Response);
    const out = await createAskTransport(fetchImpl as unknown as typeof fetch).stream(
      { question: 'q' },
      { onEvent: () => undefined },
    );
    expect(out.outcome).toBe('error');
    if (out.outcome === 'error') expect(out.status).toBe(400);
  });

  /*
   * STOP IS NOT A FAILURE. The user pressing Stop aborts the fetch, and an
   * aborted fetch rejects — reporting that as a transport error would put a red
   * sentence on the screen for a button the user deliberately pressed.
   */
  it('treats an abort as a clean end, not an error', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const out = await createAskTransport(fetchImpl as unknown as typeof fetch).stream(
      { question: 'q' },
      { onEvent: () => undefined, signal: controller.signal },
    );
    expect(out.outcome).toBe('ok');
  });

  it('reports a body that never arrives', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body: null }) as unknown as Response);
    const out = await createAskTransport(fetchImpl as unknown as typeof fetch).stream(
      { question: 'q' },
      { onEvent: () => undefined },
    );
    expect(out.outcome).toBe('not-json');
  });
});

/**
 * A TURN THAT OUTLIVES ITS CONNECTION.
 *
 * Close the tab, sleep the laptop or lose wifi mid-answer and the turn was
 * gone — along with everything it had already read and already cost. The
 * durable pattern was proven in this repo for program runs and the ask stream
 * wrote `data:` with no `id:` line at all.
 */
describe('resuming a dropped turn', () => {
  const RUN = 'run-abc123-0000ffff';

  /** A body that yields two frames and then throws, as a dead socket does. */
  function droppingBody(frames: string[]) {
    let i = 0;
    return {
      getReader: () => ({
        read: async () => {
          if (i < frames.length) {
            const value = new TextEncoder().encode(frames[i]!);
            i += 1;
            return { done: false, value };
          }
          throw new Error('network error');
        },
      }),
    };
  }

  function transportOver(frames: string[], replay: unknown, replayOk = true) {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      if (String(url).startsWith('/api/ask/events')) {
        return {
          ok: replayOk,
          status: replayOk ? 200 : 404,
          json: async () => replay,
        } as unknown as Response;
      }
      return { ok: true, status: 200, body: droppingBody(frames) } as unknown as Response;
    }) as unknown as typeof fetch;
    return { calls, transport: createAskTransport(fetchImpl) };
  }

  const START = `id: 1\ndata: ${JSON.stringify({ type: 'trajectory:start', runId: RUN, instructionHash: 'test' })}\n\n`;
  const DELTA = `id: 2\ndata: ${JSON.stringify({ type: 'delta', text: 'It walks ' })}\n\n`;

  it('replays what it missed instead of losing the turn', async () => {
    const seen: unknown[] = [];
    const { calls, transport } = transportOver([START, DELTA], {
      events: [
        { seq: 3, event: { type: 'delta', text: 'the repository.' } },
        { seq: 4, event: { type: 'result', text: 'It walks the repository.' } },
      ],
    });

    const result = await transport.stream({ question: 'q' } as never, { onEvent: (e) => seen.push(e) });

    expect(result.outcome).toBe('ok');
    /* Asked from where it actually got to — not from zero, which would repeat
       everything the reader has already watched arrive. */
    expect(calls.some((c) => c.includes(`runId=${RUN}`) && c.includes('since=2'))).toBe(true);
    expect(seen).toHaveLength(4);
    expect((seen[3] as { text: string }).text).toBe('It walks the repository.');
  });

  it('does NOT replay when the user pressed Stop', async () => {
    /* An abort is the reader asking for it to end. Replaying would put back
       the answer they just stopped, and bill for reading it again. */
    const controller = new AbortController();
    const { calls, transport } = transportOver([START, DELTA], { events: [] });
    controller.abort();

    await transport.stream({ question: 'q' } as never, {
      onEvent: () => undefined,
      signal: controller.signal,
    });
    expect(calls.some((c) => c.includes('/api/ask/events'))).toBe(false);
  });

  it('reports the real failure when there is nothing to resume from', async () => {
    /* No id line means the server never recorded the turn. A resume that
       silently reported success would leave the reader looking at half an
       answer with no error to explain it. */
    const plain = `data: ${JSON.stringify({ type: 'delta', text: 'a' })}\n\n`;
    const { calls, transport } = transportOver([plain], { events: [] });

    const result = await transport.stream({ question: 'q' } as never, { onEvent: () => undefined });
    expect(result.outcome).toBe('unreachable');
    expect(calls.some((c) => c.includes('/api/ask/events'))).toBe(false);
  });

  it('reports the real failure when the engine cannot replay either', async () => {
    const { transport } = transportOver([START, DELTA], null, false);
    const result = await transport.stream({ question: 'q' } as never, { onEvent: () => undefined });
    expect(result.outcome).toBe('unreachable');
  });
});

describe('the id a frame carries', () => {
  it('reads the cursor', () => {
    expect(seqFromFrame('id: 7\ndata: {}')).toBe(7);
  });

  it('is null for a frame that has none, which must not read as zero', () => {
    /* Zero would ask for a replay of the whole turn and duplicate everything
       the reader already watched arrive. */
    expect(seqFromFrame('data: {}')).toBeNull();
    expect(seqFromFrame(': keep-alive')).toBeNull();
  });

  it('ignores a malformed id rather than resuming from NaN', () => {
    expect(seqFromFrame('id: not-a-number\ndata: {}')).toBeNull();
    expect(seqFromFrame('id: 0\ndata: {}')).toBeNull();
  });
});
