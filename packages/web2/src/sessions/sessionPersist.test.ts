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

    rememberChatForFlush(turns);
    rememberCanvasForFlush({
      blocks: [{ id: 'b1', type: 'markdown', payload: '# x', status: 'landed' }],
    });
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
    expect(peekSessionFlush().canvas).toContain('# x');
    expect(peekSessionFlush().board).toContain('boardSeqd');

    await flushSessionMemory();
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: '/api/chat-memory', method: 'PUT', keepalive: true }),
        expect.objectContaining({ url: '/api/canvas-doc', method: 'PUT', keepalive: true }),
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
    rememberChatForFlush([]);
    rememberCanvasForFlush({ blocks: [] });
    await flushSessionMemory();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reloadAfterSessionChange reloads without a second flush', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    rememberChatForFlush(turns);
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
    rememberChatForFlush(turns);
    await flushAndReload();
    expect(peekSessionFlush().chat).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
