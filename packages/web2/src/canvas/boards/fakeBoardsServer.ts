/* Test-only: an in-memory /api/boards and a fake EventSource, so a surface's
   whole round trip (fetch, ops, the change stream) runs in jsdom. The writes
   an "agent" makes go through `agentDraw`, which changes the store and fires
   the stream exactly as the MCP's file write does in the app. */

import type { WbItem } from '../../whiteboard/whiteboardModel';
import type { BoardDoc, BoardMeta, BoardOp, BoardsIndex } from './boardsModel';

type Handler = ((e: MessageEvent) => void) | null;

export class FakeEventSource {
  static open: FakeEventSource[] = [];
  onmessage: Handler = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.open.push(this);
  }
  close(): void {
    this.closed = true;
    FakeEventSource.open = FakeEventSource.open.filter((s) => s !== this);
  }
  static fire(data: unknown): void {
    for (const s of [...FakeEventSource.open]) s.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

export function fakeBoardsServer() {
  const t = '2026-10-06T00:00:00.000Z';
  const meta = (id: string, name: string, kind: BoardMeta['kind']): BoardMeta => ({ id, name, kind, rev: 0, createdAt: t, updatedAt: t });
  let boards: BoardMeta[] = [meta('architecture', 'Architecture', 'architecture'), meta('whiteboard', 'Whiteboard', 'whiteboard')];
  const items = new Map<string, WbItem[]>();
  const calls: string[] = [];
  const reply = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  const doc = (id: string): BoardDoc => ({ version: 1, id, rev: boards.find((b) => b.id === id)!.rev, items: items.get(id) ?? [] });
  const bump = (id: string) => {
    boards = boards.map((b) => (b.id === id ? { ...b, rev: b.rev + 1 } : b));
  };
  const apply = (id: string, ops: BoardOp[]) => {
    const m = new Map((items.get(id) ?? []).map((i) => [i.id, i]));
    for (const op of ops) {
      if (op.op === 'put') m.set(op.item.id, op.item);
      else m.delete(op.id);
    }
    items.set(id, [...m.values()]);
    bump(id);
  };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const rest = url.replace(/^\/api\/boards\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (!url.startsWith('/api/boards')) return reply(404, { error: 'not here' });
    if (rest.length === 0 && method === 'GET') return reply(200, { version: 1, boards } satisfies BoardsIndex);
    if (rest.length === 0 && method === 'POST') {
      const id = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const m = meta(id, body.name, 'whiteboard');
      boards = [...boards, m];
      return reply(201, m);
    }
    const id = rest[0]!;
    if (!boards.some((b) => b.id === id)) return reply(404, { error: `no board "${id}"` });
    if (rest.length === 1 && method === 'GET') return reply(200, doc(id));
    if (rest.length === 1 && method === 'PATCH') {
      boards = boards.map((b) => (b.id === id ? { ...b, name: body.name, rev: b.rev + 1 } : b));
      return reply(200, boards.find((b) => b.id === id));
    }
    if (rest.length === 1 && method === 'DELETE') {
      boards = boards.filter((b) => b.id !== id);
      items.delete(id);
      /* The real route emits on a delete, and the tab answers it by re-reading the board it was showing. */
      queueMicrotask(() => FakeEventSource.fire({ type: 'boards', id }));
      return reply(200, { ok: true });
    }
    if (rest[1] === 'ops' && method === 'POST') {
      apply(id, body.ops);
      return reply(200, doc(id));
    }
    return reply(405, { error: 'method' });
  };
  return {
    fetch: fetchImpl,
    calls,
    items: (id: string) => items.get(id) ?? [],
    boards: () => boards,
    /** What the MCP `draw` does: write the store, then the stream fires. */
    agentDraw(id: string, ops: BoardOp[]) {
      apply(id, ops);
      FakeEventSource.fire({ type: 'boards', id });
    },
  };
}
