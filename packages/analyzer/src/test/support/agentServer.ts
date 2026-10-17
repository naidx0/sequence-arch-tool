/* ══════════════════════════════════════════════════════════════════════════
   THE REAL SERVER WITH A REPLAYED AGENT, ON A FAKE CLOCK (S2b tests)
   packages/analyzer/src/test/support/agentServer.ts

   A temp user store with one registered agent, the repo server with the
   agent process replaced by an in-process replay (`acpTurn.spawn`), and one
   streamed run-node turn read while the replay is drained. Nothing sleeps.
   ══════════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import type { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import type { ReplayHandle } from '@sequence/acp/dist/replay/codexReplay.js';
import { readFixture, type Json } from '@sequence/acp/dist/replay/fixture.js';

import { addAgent } from '../../server/agentsStore.js';
import { createRepoServer } from '../../server/repoServer.js';
import { ensureSessionsMigrated } from '../../server/sessionsStore.js';
import { REPLAY_FIXTURES, normalizeEvents } from './replayRunNode.js';

export interface AgentSpecimen {
  dir: string;
  store: string;
  root: string;
  work: string;
  chatId: string;
}

export function agentSpecimen(agent: { id: string; command: string }): AgentSpecimen {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s2b-')));
  const root = path.join(dir, 'user');
  const store = path.join(root, '.sequence');
  const work = path.join(dir, 'work');
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const chatId = ensureSessionsMigrated(root).activeId;
  addAgent(store, { id: agent.id, command: agent.command, cwd: work });
  return { dir, store, root, work, chatId };
}

export async function serveAgent(store: string, h: ReplayHandle, clock: ManualClock): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store, acpTurn: { clock, spawn: h.spawn, killGraceMs: 0 } });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

/** Drain the replay while `step` runs (a request whose answer needs the agent to speak). */
export async function whileDraining<T>(h: ReplayHandle, step: Promise<T>): Promise<T> {
  let done = false;
  const pump = (async () => {
    while (!done) {
      await h.drain();
      await new Promise((r) => setImmediate(r));
    }
  })();
  try {
    return await step;
  } finally {
    done = true;
    await pump;
  }
}

/** One streamed run-node turn; `onEvent` may answer an approval. */
export async function streamTurn(base: string, body: Json, h: ReplayHandle, onEvent: (e: Json) => Promise<void> | void = () => {}): Promise<Json[]> {
  return whileDraining(
    h,
    (async () => {
      const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ interactivePermissions: true, ...body }),
      });
      assert.strictEqual(res.status, 200, await (res.status === 200 ? Promise.resolve('') : res.text()));
      const events: Json[] = [];
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const e = JSON.parse(line.slice(6)) as Json;
            events.push(e);
            await onEvent(e);
          }
        }
      }
      return events;
    })(),
  );
}

export const replayFixture = (dir: string, name: string) => readFixture(path.join(REPLAY_FIXTURES, dir, `${name}.jsonl`));

/** Keep a normalized stream as a golden under fixtures/replay/<dir>/; SEQUENCE_UPDATE_REPLAY=1 rewrites it. */
export function sseGolden(dir: string, name: string, events: Json[], work: string): void {
  const folder = path.join(REPLAY_FIXTURES, dir);
  const file = path.join(folder, `${name}.sse.jsonl`);
  const now = normalizeEvents(events, work).map((e) => JSON.stringify(e)).join('\n') + '\n';
  if (process.env.SEQUENCE_UPDATE_REPLAY === '1' || !fs.existsSync(file)) {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(file, now);
  }
  assert.strictEqual(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), now, `the stream matches ${dir}/${name}.sse.jsonl`);
}

export const updatesOf = (events: Json[], kind: string): Json[] =>
  events.filter((e) => e.type === 'acp:update' && ((e.update as Json)?.update as Json)?.sessionUpdate === kind).map((e) => (e.update as Json).update as Json);
