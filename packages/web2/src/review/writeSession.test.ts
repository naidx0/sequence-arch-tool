import { beforeEach, describe, expect, it } from 'vitest';

import { createReviewClient } from './reviewClient';
import {
  WRITE_SESSION_KEY,
  checkpointSessionId,
  setCheckpointSessionIdResolver,
  writeSessionId,
} from './writeSession';

/* The server's own rule, copied from `checkpointStore.isCheckpointSessionId`.
   An id that fails it is not merely rejected — `sessionDir` THROWS, and the
   write endpoint swallows that into a stderr line, so a bad id looks exactly
   like a working feature that never captured anything. */
const SERVER_CONTRACT = /^[A-Za-z0-9_-]{1,64}$/;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

describe('the id a write is filed under', () => {
  let store: Storage;
  beforeEach(() => {
    store = memoryStorage();
    setCheckpointSessionIdResolver(null);
  });

  it('satisfies the server contract', () => {
    expect(writeSessionId(store)).toMatch(SERVER_CONTRACT);
  });

  it('is the SAME id on the second call', () => {
    /* A fresh id per write would file every edit under its own session, and
       the rewind list would be a thousand one-file sessions with no way to
       say "put back what this sitting did". */
    expect(writeSessionId(store)).toBe(writeSessionId(store));
  });

  it('survives a reload, because that is when you want to undo', () => {
    const first = writeSessionId(store);
    expect(writeSessionId(memoryStorageFrom(store))).toBe(first);
  });

  it('refuses an id the server would reject, rather than passing it on', () => {
    store.setItem(WRITE_SESSION_KEY, '../../etc/passwd');
    const id = writeSessionId(store);
    expect(id).toMatch(SERVER_CONTRACT);
    expect(id).not.toContain('..');
  });

  it('has no storage to persist in and still answers', () => {
    /* Storage throws in a locked-down browser. A write must still happen. */
    expect(writeSessionId(null)).toMatch(SERVER_CONTRACT);
  });
});

function memoryStorageFrom(other: Storage): Storage {
  const next = memoryStorage();
  for (let i = 0; i < other.length; i++) {
    const k = other.key(i)!;
    next.setItem(k, other.getItem(k)!);
  }
  return next;
}

describe('a write says which session it belongs to', () => {
  beforeEach(() => {
    setCheckpointSessionIdResolver(null);
  });

  it('sends sessionId in the PUT body', async () => {
    let sent: unknown = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, path: 'a.ts' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await createReviewClient(fetchImpl).writeFile('a.ts', 'next');

    /* WITHOUT THIS the server takes no baseline, `listCheckpoints` stays
       empty, and rewind is a button over an empty list. */
    const body = sent as { path: string; content: string; sessionId?: string };
    expect(body.path).toBe('a.ts');
    expect(body.content).toBe('next');
    expect(body.sessionId).toMatch(SERVER_CONTRACT);
  });

  it('prefers the active chat session id when wired (B3.3)', async () => {
    setCheckpointSessionIdResolver(() => 'session-active');
    let sent: unknown = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, path: 'a.ts' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await createReviewClient(fetchImpl).writeFile('a.ts', 'next');
    expect((sent as { sessionId: string }).sessionId).toBe('session-active');
    expect(checkpointSessionId()).toBe('session-active');
  });
});
