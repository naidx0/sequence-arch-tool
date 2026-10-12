import { describe, expect, it } from 'vitest';

import { foldApproval, parseSse, streamRunNode, type AgentApproval, type RunNodeEvent } from './runNodeStream';

const frame = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;

function sseStub() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const enc = new TextEncoder();
  return {
    response: () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (e: unknown) => ctrl.enqueue(enc.encode(frame(e))),
    raw: (s: string) => ctrl.enqueue(enc.encode(s)),
    end: () => ctrl.close(),
  };
}

const PENDING_FILE = {
  type: 'acp:permission',
  requestId: 'r1',
  pending: true,
  decision: null,
  title: 'Edit /repo/hello.txt',
  toolKind: 'edit',
  proposal: { proposalId: 'r1', title: 'Edit /repo/hello.txt', rationale: null, files: [{ path: '/repo/hello.txt', diff: '+hello\n', decision: 'pending' }] },
};

describe('run-node event stream', () => {
  it('parses data frames across chunk boundaries and CRLF, keeping the unfinished tail', () => {
    const a = parseSse('data: {"type":"acp:update","update":1}\r\n\r\ndata: {"type":"acp:res');
    expect(a.events).toEqual([{ type: 'acp:update', update: 1 }]);
    const b = parseSse(a.rest + 'ult","text":"hi"}\n\n');
    expect(b.events).toEqual([{ type: 'acp:result', text: 'hi' }]);
    expect(b.rest).toBe('');
    expect(parseSse('data: not json\n\n').events).toEqual([]);
  });

  it('folds a pending request into a card and its settling event into an answer', () => {
    let list: AgentApproval[] = [];
    list = foldApproval(list, PENDING_FILE as RunNodeEvent);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ requestId: 'r1', toolKind: 'edit', decision: null, answeredBy: null });
    expect(list[0].proposal.files).toEqual([{ path: '/repo/hello.txt', diff: '+hello\n' }]);
    /* A request the mode answered itself (no requestId) is not a card. */
    expect(foldApproval(list, { type: 'acp:permission', decision: 'deny', title: 'x' })).toBe(list);
    list = foldApproval(list, { type: 'acp:permission', requestId: 'r1', pending: false, decision: 'deny', answeredBy: 'timeout' });
    expect(list[0]).toMatchObject({ decision: 'deny', answeredBy: 'timeout' });
  });

  it('asks for the stream with the interactive opt-in and returns the honest result', async () => {
    const s = sseStub();
    const seen: RunNodeEvent[] = [];
    let sent: { url: string; init?: RequestInit } | undefined;
    const run = streamRunNode({ agentRef: 'codex', prompt: 'p', permissionMode: 'propose' }, { onEvent: (e) => seen.push(e) }, async (url, init) => {
      sent = { url, init };
      return s.response();
    });
    s.push(PENDING_FILE);
    s.raw('data: {"type":"acp:result","stopReason":"end_turn",');
    s.raw('"text":"done"}\n\n');
    s.end();
    expect(await run).toEqual({ ok: true, text: 'done', stopReason: 'end_turn' });
    expect(sent?.url).toBe('/api/acp/run-node?stream=1');
    expect((sent?.init?.headers as Record<string, string>).accept).toBe('text/event-stream');
    expect(JSON.parse(String(sent?.init?.body))).toMatchObject({ permissionMode: 'propose', interactivePermissions: true });
    expect(seen.map((e) => e.type)).toEqual(['acp:permission', 'acp:result']);
  });

  it('a refused run (no stream) is read as the JSON error it is', async () => {
    const out = await streamRunNode({}, {}, async () => new Response(JSON.stringify({ error: 'Full access needs a one-time confirmation' }), { status: 409 }));
    expect(out).toEqual({ ok: false, text: 'Full access needs a one-time confirmation' });
  });
});
