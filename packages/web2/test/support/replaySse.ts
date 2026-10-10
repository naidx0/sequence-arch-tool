/* ══════════════════════════════════════════════════════════════════════════
   A RECORDED run-node STREAM, FOR web2's RUN STORE
   packages/web2/test/support/replaySse.ts

   The analyzer's S0 replay test plays each recorded codex session through the
   real server and keeps the SSE events it sent (normalized) as golden files
   in packages/acp/src/test/fixtures/replay/sse/. This turns one of those into
   the `fetch` web2's run store calls: `/api/acp/agents` names the agent, and
   `/api/acp/run-node?stream=1` answers with the recorded events as a real SSE
   body, one event per chunk, in order. Nothing waits on time: the body is
   pulled as fast as the store reads it.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

type Json = Record<string, unknown>;

export const SSE_GOLDEN = path.resolve(__dirname, '..', '..', '..', 'acp', 'src', 'test', 'fixtures', 'replay', 'sse');

export function readGolden(name: string): Json[] {
  return fs
    .readFileSync(path.join(SSE_GOLDEN, `${name}.sse.jsonl`), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Json);
}

export function goldenNames(): string[] {
  return fs
    .readdirSync(SSE_GOLDEN)
    .filter((f) => f.endsWith('.sse.jsonl'))
    .map((f) => f.replace('.sse.jsonl', ''))
    .sort();
}

/** A fetch that serves the recorded stream, and records what the store asked. */
export function replayFetch(events: Json[]): { fetch: (input: string, init?: RequestInit) => Promise<Response>; calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  const enc = new TextEncoder();
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (input === '/api/acp/agents') {
      return new Response(JSON.stringify({ agents: [{ id: 'codex' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (input.startsWith('/api/acp/run-node')) {
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (i >= events.length) {
            controller.close();
            return;
          }
          controller.enqueue(enc.encode(`data: ${JSON.stringify(events[i++])}\n\n`));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetchImpl, calls };
}
