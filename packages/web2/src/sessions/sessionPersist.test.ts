import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearSessionFlush,
  flushAndReload,
  flushSessionMemory,
  peekSessionFlush,
  reloadAfterSessionChange,
  rememberBoardForFlush,
  rememberCanvasForFlush,
  rememberChatForFlush,
} from './sessionPersist';
import type { Turn } from '../state/types';

afterEach(() => {
  clearSessionFlush();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const turns: Turn[] = [
  {
    id: 'u1',
    role: 'user',
    text: 'hello',
    intents: [],
    chips: [],
    contextLines: [],
    surface: null,
    at: 1,
  },
];

describe('sessionPersist flush', () => {
  it('remembers chat and flushes with keepalive before switch/reload', async () => {
    const calls: { url: string; keepalive?: boolean; method?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method,
          keepalive: init?.keepalive === true,
        });
        return { ok: true } as Response;
      }),
    );

    rememberChatForFlush(turns, 'session-a');
    rememberCanvasForFlush(
      {
        blocks: [{ id: 'b1', type: 'markdown', payload: '# x', status: 'landed' }],
      },
      'session-a',
    );
    rememberBoardForFlush(
      'session-a',
      {
        version: 1,
        kind: 'service-flow',
        title: 'Local',
        grounded: { graphId: 'scratch:session-a' },
        nodes: [{ id: 'n1', label: 'N', kind: 'service' }],
        edges: [],
      },
      1,
    );
    expect(peekSessionFlush().chat).toContain('hello');
    expect(peekSessionFlush().chatSessionId).toBe('session-a');
    expect(peekSessionFlush().canvas).toContain('# x');
    expect(peekSessionFlush().board).toContain('boardSeqd');

    await flushSessionMemory();
    expect(calls).toEqual(
      expect.arrayContaining([
        /* The canvas rides on the session route WITH its id, like the board —
           never the anonymous `/api/canvas-doc` that lands wherever "active"
           points by the time the server reads it (the New Chat race). */
        expect.objectContaining({
          url: '/api/sessions/session-a',
          method: 'PUT',
          keepalive: true,
        }),
      ]),
    );
  });

  it('skips empty / not-worth payloads', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    rememberChatForFlush([], 'session-a');
    rememberCanvasForFlush({ blocks: [] }, 'session-a');
    await flushSessionMemory();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reloadAfterSessionChange reloads without a second flush', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    rememberChatForFlush(turns, 'session-a');
    reloadAfterSessionChange();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(peekSessionFlush().chat).toContain('hello');
  });

  it('flushAndReload clears the flush buffer after writing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true }) as Response),
    );
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    rememberChatForFlush(turns, 'session-a');
    await flushAndReload();
    expect(peekSessionFlush().chat).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the chat flush names its session in the URL and the body, and never uses /api/chat-memory', async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body ?? '') });
        return { ok: true } as Response;
      }),
    );
    rememberChatForFlush(turns, 'session-a');
    await flushSessionMemory();
    expect(calls.map((c) => c.url)).toEqual(['/api/sessions/session-a']);
    const body = JSON.parse(calls[0]!.body) as { chat: { sessionId: string; turns: { text: string }[] } };
    /* The route refuses a chat whose sessionId is not the path id, so the two must agree. */
    expect(body.chat.sessionId).toBe('session-a');
    expect(body.chat.turns.map((t) => t.text)).toEqual(['hello']);
  });

  it('a chat with no session id is not flushed anywhere', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    rememberChatForFlush(turns, null);
    expect(peekSessionFlush().chat).toBeNull();
    await flushSessionMemory();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
