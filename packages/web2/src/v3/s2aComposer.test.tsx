import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * S2a IN THE COMPOSER: the agent sees the board.
 *
 *   - a pasted or dropped image, in a chat that talks to an agent, is scaled
 *     to a 1568 px long edge, stored (POST /api/attachment/image, its bytes),
 *     and shown as a chip; the next agent turn carries it by id, and the
 *     chips go once sent
 *   - without an agent, an image is refused, and the sentence says where
 *     images go; nothing is uploaded
 *   - mention chips go as attachments too: a board node by id (the server
 *     cuts its map slice), a file by its repo path, a function by its file
 *   - "Send the board to the agent" reuses the board's own PNG export
 *   - a dropped binary is refused by name; a dropped text file attaches
 *
 * jsdom has no canvas: the scaling is checked as arithmetic (fitLongEdge) and
 * replaced here by a pass-through that records what it was asked to scale.
 */

const scaled: Blob[] = [];
vi.mock('../chat/imageAttach', async (orig) => {
  const real = await orig<typeof import('../chat/imageAttach')>();
  return { ...real, scaleImage: async (b: Blob) => (scaled.push(b), b) };
});

import { agentRuns, type RunAttachment } from '../agents/agentRuns';
import '../agents/agentRunFold';
import { registerBoardExporter } from '../chat/boardPngBus';
import { fitLongEdge, IMAGE_MAX_EDGE } from '../chat/imageAttach';
import { createStore } from '../state';
import { V3App } from './V3App';

type Json = Record<string, unknown>;
const LAZY = { timeout: 10_000 };
vi.setConfig({ testTimeout: 20_000 });

let calls: { url: string; body: unknown; type?: string }[] = [];
let nextImage = 0;

beforeEach(() => {
  calls = [];
  scaled.length = 0;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const type = (init?.headers as Record<string, string> | undefined)?.['content-type'];
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body, type });
      if (url.startsWith('/api/attachment/image')) {
        const name = decodeURIComponent(new URL(url, 'http://x').searchParams.get('name') ?? '');
        const id = String(++nextImage).padStart(64, 'a');
        return new Response(JSON.stringify({ attachment: { id, name, bytes: 120, kind: 'image', mimeType: 'image/png', width: 1568, height: 10, truncated: false, at: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/attachment') {
        return new Response(JSON.stringify({ attachment: { id: 'b'.repeat(64), name: 'trace.log', bytes: 11, truncated: false } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('/api/acp/capabilities')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('data:')) return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
      return new Promise<Response>(() => {});
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  agentRuns.patch((s) => ({ ...s, agents: {}, caps: {}, config: {} }));
  registerBoardExporter(null);
});

function app(chat: string) {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [{ id: chat, title: 'Agent chat', pinned: false, updatedAt: '2026-01-01' }], activeId: chat } as never);
  render(<V3App appStore={store} />);
  return store;
}

/** The chat talks to codex: an earlier run that has ended. */
async function agentChat(chat: string) {
  const store = app(chat);
  await act(async () => {
    void agentRuns.start({ agentRef: 'codex', question: 'first', access: 'ask', sessionId: chat }, () => new Promise<Response>(() => {}));
  });
  const id = agentRuns.get().runs.filter((r) => r.sessionId === chat).at(-1)!.id;
  act(() => agentRuns.apply(id, { type: 'acp:result', text: 'done' } as never));
  return store;
}

const png = (name = 'shot.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

const paste = async (files: File[]) => {
  const field = screen.getByTestId('composer-field');
  await act(async () => {
    fireEvent.paste(field, { clipboardData: { files } });
  });
};

const send = async (text: string) => {
  const field = screen.getByTestId('composer-field');
  fireEvent.change(field, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(field, { key: 'Enter' });
    await Promise.resolve();
  });
};

const runNodeBodies = () => calls.filter((c) => c.url.startsWith('/api/acp/run-node')).map((c) => c.body as Json);

describe('the agent sees the board, from the composer', () => {
  it(`scales to a ${IMAGE_MAX_EDGE} px long edge, keeping the aspect (the board exports at 2058 x 2144)`, () => {
    expect(fitLongEdge(2058, 2144)).toEqual({ width: 1505, height: 1568, scaled: true });
    expect(fitLongEdge(3000, 1000)).toEqual({ width: 1568, height: 523, scaled: true });
    expect(fitLongEdge(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
  });

  it('a pasted image in an agent chat is scaled, stored as bytes, shown as a chip, and sent with the next turn by id; the chips go once sent', async () => {
    await agentChat('s2a-paste');
    await paste([png()]);
    /* Decision 49: the name, then its size in a quiet column (no dot separator). */
    await waitFor(() => expect(screen.getByTestId('composer-attachment').textContent).toBe('shot.png1568 × 10'), LAZY);
    expect(scaled).toHaveLength(1);
    const upload = calls.find((c) => c.url.startsWith('/api/attachment/image'))!;
    expect([upload.url, upload.type, upload.body instanceof Blob]).toEqual(['/api/attachment/image?session=s2a-paste&name=shot.png', 'image/png', true]);
    await send('What is wrong here?');
    await waitFor(() => expect(runNodeBodies()).toHaveLength(1));
    expect(runNodeBodies()[0]!.attachments).toEqual([{ kind: 'image', id: '1'.padStart(64, 'a') } satisfies RunAttachment]);
    expect(screen.queryByTestId('composer-attachment')).toBeNull();
  });

  it('without an agent, an image is refused, the sentence says where images go, and nothing is uploaded', async () => {
    const store = app('s2a-noagent');
    await paste([png()]);
    await waitFor(() => expect(store.getState().net.lastFailure?.message).toMatch(/Images go to a coding agent/), LAZY);
    expect(calls.some((c) => c.url.startsWith('/api/attachment/image'))).toBe(false);
    expect(screen.queryByTestId('composer-attachment')).toBeNull();
  });

  it('mention chips go as attachments: a node by id, a file by its path, a function by its file', async () => {
    const store = await agentChat('s2a-chips');
    act(() => {
      store.dispatch({ type: 'composer/chip-add', chip: { id: 'c1', kind: 'node', ref: 'svc:orders', label: 'orders', nodeKind: 'service' } } as never);
      store.dispatch({ type: 'composer/chip-add', chip: { id: 'c2', kind: 'file', ref: 'orders/app/main.py', label: 'main.py', nodeKind: null } } as never);
      store.dispatch({ type: 'composer/chip-add', chip: { id: 'c3', kind: 'function', ref: 'fn:orders/app/db.py#save@12', label: 'save', nodeKind: null } } as never);
    });
    await send('What does this touch?');
    await waitFor(() => expect(runNodeBodies()).toHaveLength(1));
    expect(runNodeBodies()[0]!.attachments).toEqual([
      { kind: 'node', nodeId: 'svc:orders' },
      { kind: 'file', path: 'orders/app/main.py' },
      { kind: 'file', path: 'orders/app/db.py' },
    ]);
    expect(store.getState().composer.chips).toEqual([]);
  });

  it('"Send the board to the agent" reuses the board\'s PNG export (only offered when the chat talks to an agent)', async () => {
    const store = await agentChat('s2a-board');
    /* The mounted board registered its own export (an empty board answers "Nothing on the board to export."); this one stands in for a drawn board. */
    registerBoardExporter(async () => ({ dataUrl: 'data:image/png;base64,iVBORw==', width: 2058, height: 2144 }));
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    fireEvent.click(await screen.findByTestId('v3-tools-board-png'));
    await waitFor(() => expect(JSON.stringify([store.getState().net.lastFailure?.message ?? null, screen.queryByTestId('composer-attachment')?.textContent ?? null])).toMatch(/^\[null,".*board\.png/), LAZY);
    expect(calls.find((c) => c.url.startsWith('/api/attachment/image'))!.url).toBe('/api/attachment/image?session=s2a-board&name=board.png');
    expect(scaled).toHaveLength(1);
  });

  it('a dropped binary is refused by name; a dropped text file attaches as text', async () => {
    const store = await agentChat('s2a-drop');
    const footer = document.querySelector('footer.v3-composer')!;
    await act(async () => {
      fireEvent.drop(footer, { dataTransfer: { files: [new File(['PK'], 'bundle.zip', { type: 'application/zip' })], types: ['Files'] } });
    });
    await waitFor(() => expect(store.getState().net.lastFailure?.message).toMatch(/bundle\.zip is not text/), LAZY);
    await act(async () => {
      /* jsdom's File has no working text(); a browser's does (the attach picker already relies on it). */
      const log = Object.assign(new File(['stack trace'], 'trace.log', { type: 'text/plain' }), { text: async () => 'stack trace' });
      fireEvent.drop(footer, { dataTransfer: { files: [log], types: ['Files'] } });
    });
    await waitFor(() => expect(JSON.stringify([store.getState().net.lastFailure?.message ?? null, calls.some((c) => c.url === '/api/attachment')])).toMatch(/bundle\.zip.*,true\]$/), LAZY);
    expect(calls.find((c) => c.url === '/api/attachment')!.body).toEqual({ name: 'trace.log', text: 'stack trace' });
  });
});
