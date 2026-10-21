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

export function fakeBoardsServer(opts: { empty?: boolean } = {}) {
  const t = '2026-10-06T00:00:00.000Z';
  const meta = (id: string, name: string, kind: BoardMeta['kind']): BoardMeta => ({ id, name, kind, rev: 0, createdAt: t, updatedAt: t });
  let boards: BoardMeta[] = [
    meta('architecture', 'Architecture', 'architecture'),
    ...(opts.empty ? [] : [meta('whiteboard', 'Whiteboard', 'whiteboard')]),
  ];
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
    const [path, query = ''] = url.split('?');
    const chat = new URLSearchParams(query).get('chat');
    const rest = path!.replace(/^\/api\/boards\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (!url.startsWith('/api/boards')) return reply(404, { error: 'not here' });
    /* The per-chat rules of boardStore.ts, in memory: a chat lists the architecture board and its own. */
    if (rest.length === 0 && method === 'GET') {
      const mine = chat ? boards.filter((b) => b.kind === 'architecture' || (b.chats ?? []).includes(chat)) : boards;
      return reply(200, { version: 1, boards: mine } satisfies BoardsIndex);
    }
    if (rest.length === 1 && rest[0] === 'linkable' && method === 'GET') {
      const groups = new Map<string, BoardMeta[]>();
      const earlier: BoardMeta[] = [];
      for (const b of boards.filter((x) => x.kind === 'whiteboard')) {
        const cs = b.chats ?? [];
        if (cs.length === 0) earlier.push(b);
        else if (!cs.includes(String(chat))) for (const c of cs) groups.set(c, [...(groups.get(c) ?? []), b]);
      }
      return reply(200, { groups: [...groups].map(([c, bs]) => ({ chat: c, boards: bs })), earlier });
    }
    if (rest.length === 0 && method === 'POST') {
      let id = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      for (let n = 2; boards.some((b) => b.id === id); n += 1) id = `${String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${n}`;
      const m = { ...meta(id, body.name, 'whiteboard'), ...(body.chat ? { chats: [body.chat] } : {}) };
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
    if (rest.length === 2 && rest[1] === 'link' && method === 'POST') {
      boards = boards.map((b) => (b.id === id ? { ...b, chats: [...new Set([...(b.chats ?? []), body.chat])] } : b));
      queueMicrotask(() => FakeEventSource.fire({ type: 'boards', id }));
      return reply(200, boards.find((b) => b.id === id));
    }
    if (rest.length === 1 && method === 'DELETE') {
      const held = boards.find((b) => b.id === id)!.chats ?? [];
      if (chat && held.length > 1 && held.includes(chat)) {
        boards = boards.map((b) => (b.id === id ? { ...b, chats: held.filter((c) => c !== chat) } : b));
        queueMicrotask(() => FakeEventSource.fire({ type: 'boards', id }));
        return reply(200, { ok: true, deleted: false });
      }
      boards = boards.filter((b) => b.id !== id);
      items.delete(id);
      /* The real route emits on a delete, and the tab answers it by re-reading the board it was showing. */
      queueMicrotask(() => FakeEventSource.fire({ type: 'boards', id }));
      return reply(200, { ok: true, deleted: true });
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
