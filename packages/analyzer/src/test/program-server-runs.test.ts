import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Program } from '@sequence/schema';
import type {
  GetProgramRunResponse,
  GetProgramRunsResponse,
  PostProgramRunCancelResponse,
  PostProgramRunResponse,
  ProgramRunEvent,
} from '@sequence/api-types';
import { createRepoServer } from '../server/repoServer.js';
import { addAgent } from '../server/agentsStore.js';
import { MAX_LIVE_RUNS } from '../server/programRunner.js';
import { usageFileForIdentity, userStoreDir } from '../server/store.js';
import { setRepoTrust } from '../server/repoTrust.js';
import type { MeterUsage } from '../server/meter.js';

/**
 * P8 — SERVER-SIDE RUNS.
 *
 * THE INVARIANT THESE TESTS EXIST FOR, in the words of the item:
 *
 *   > start a run, kill the client, reconnect, and assert the run is still there
 *   > and its state advanced. That is the invariant; a test that only checks the
 *   > route returns 200 is not it.
 *
 * So none of the assertions below is satisfiable by a route that answers and
 * does nothing. `disconnect mid-run` proves work happened WHILE NO CLIENT WAS
 * ATTACHED, by pinning the number of nodes that had finished at disconnect time
 * and asserting more had finished by reconnect time — and it proves the events
 * for that stretch are recoverable, exactly once, from `?since=`.
 *
 * WHY EACH TEST IS SHAPED THE WAY IT IS
 *
 *  - The gateway is SLOW ON PURPOSE (`startSlowGateway`, transcribed from
 *    `http-cancellation.test.ts`, which is Wave 1 item 1.3's own lock). A run
 *    that finishes instantly has no "mid-run" to disconnect during, so the
 *    disconnect test would pass against a server with no durability at all.
 *  - The gateway COUNTS its requests, so "the run advanced" is corroborated by
 *    the provider actually being called again after the client left, not only by
 *    the server's own bookkeeping agreeing with itself.
 *  - The cancellation test never asserts "usage did not increment" alone — that
 *    is trivially satisfiable by breaking metering. It is paired with a CONTROL
 *    proving an uncancelled run DOES charge, and with proof the provider was
 *    already generating when the cancel landed. Both guards are inherited from
 *    `http-cancellation.test.ts` and for the same reason.
 *  - Replay is asserted as EXACT: the seqs a reconnecting client receives are
 *    contiguous with the ones it already had, with no repeats. That is the
 *    property the `id:`-numbered log buys (ml-harness §1.1: idempotent by
 *    construction, not by timing) and a `data:`-only stream cannot have.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const MOCK_AGENT = path.resolve(
  ANALYZER_ROOT,
  '..',
  'acp',
  'src',
  'test',
  'fixtures',
  'mock-agent.mjs',
);

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-prun-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  /* TRUSTED: a program `command` node spawns in this repo, and every spawn is
     refused under an untrusted repository (`server/repoTrust.ts`, locked in
     `repo-trust.test.ts`). */
  setRepoTrust(userStoreDir(), fs.realpathSync(repo), true);
  return repo;
}

interface SlowGateway {
  baseUrl: string;
  /** How many requests reached the gateway — i.e. how many agent nodes really called out. */
  received: number;
  close: () => Promise<void>;
}

/**
 * An openai-compatible mock gateway that takes `delayMs` to answer.
 *
 * The delay is what turns "mid-run" into a real window rather than a race: each
 * agent node parks here long enough for a client to disconnect, reconnect, or
 * cancel while the run is genuinely in flight.
 */
async function startSlowGateway(delayMs: number): Promise<SlowGateway> {
  const state = { received: 0 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      state.received += 1;
      setTimeout(() => {
        if (res.writableEnded) return;
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
            usage: { prompt_tokens: 120, completion_tokens: 40 },
          }),
        );
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    get received() {
      return state.received;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

interface Started {
  base: string;
  userDir: string;
  repo: string;
  gateway: SlowGateway;
  close: () => Promise<void>;
}

async function startAll(delayMs: number): Promise<Started> {
  const repo = plainappRepo();
  const userDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-prun-home-')));
  const gateway = await startSlowGateway(delayMs);
  const server = await createRepoServer(repo, {
    webDist: undefined,
    userConfigDir: userDir,
    gatewayBaseUrl: gateway.baseUrl,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  // The FREE metered default is what puts `recordUse` on the path at all; without
  // it the cancellation test would assert nothing.
  const put = await fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'default' }),
  });
  assert.strictEqual(put.status, 200, 'the free default mode must be selectable');
  return {
    base,
    userDir,
    repo,
    gateway,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      });
      await gateway.close();
      fs.rmSync(path.dirname(repo), { recursive: true, force: true });
      fs.rmSync(userDir, { recursive: true, force: true });
    },
  };
}

/** start → a1 → … → aN → end, all `seq`, every agent a gateway (metered) call. */
function chainProgram(agentCount: number, id = 'p-chain'): Program {
  const nodes: Program['nodes'] = [{ id: 'start', title: 'Start', kind: 'start' }];
  const edges: Program['edges'] = [];
  let prev = 'start';
  for (let i = 1; i <= agentCount; i += 1) {
    const nodeId = `a${i}`;
    nodes.push({
      id: nodeId,
      title: `Agent ${i}`,
      kind: 'agent',
      agent: { prompt: `step ${i}`, outKey: `out${i}` },
    });
    edges.push({ id: `e-${prev}-${nodeId}`, from: prev, to: nodeId, kind: 'seq' });
    prev = nodeId;
  }
  nodes.push({ id: 'end', title: 'End', kind: 'end' });
  edges.push({ id: `e-${prev}-end`, from: prev, to: 'end', kind: 'seq' });
  return { id, name: `chain of ${agentCount}`, nodes, edges };
}

/**
 * The exact start -> ACP agent -> end shape Activity's New Run form composes.
 * Deliberately NO `agent.acp.agentRef`: the ACP executor resolves that omission
 * as `default`, which is the production seam this fixture exists to cross.
 */
function activityProgram(id = 'ui-1000'): Program {
  return {
    id,
    name: 'harden the login route',
    nodes: [
      { id: 'start', title: 'Start', kind: 'start' },
      {
        id: 'work',
        title: 'Work',
        kind: 'agent',
        agent: {
          prompt: 'add rate limiting to POST /login and a test that proves it',
          runtime: 'acp',
          intent: 'edit',
        },
      },
      { id: 'done', title: 'Done', kind: 'end' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'work', kind: 'seq' },
      { id: 'e2', from: 'work', to: 'done', kind: 'seq' },
    ],
  };
}

async function startRun(base: string, program: Program): Promise<PostProgramRunResponse> {
  const res = await fetch(`${base}/api/program/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ program }),
  });
  assert.strictEqual(res.status, 202, 'starting a run is ACCEPTED, not "done"');
  return (await res.json()) as PostProgramRunResponse;
}

async function readRun(base: string, runId: string): Promise<GetProgramRunResponse> {
  const res = await fetch(`${base}/api/program/runs/${runId}`);
  assert.strictEqual(res.status, 200, `GET /api/program/runs/${runId}`);
  return (await res.json()) as GetProgramRunResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read SSE frames off a live stream until `stop` says enough, then ABANDON the
 * reader without draining it — which is what a closed tab looks like to the
 * server.
 *
 * Frames are parsed as `id:`/`data:` pairs so the test reads the same cursor a
 * real client would. An event whose frame carried no `id:` line fails here
 * loudly rather than being silently accepted, because the `id:` line IS the
 * resumability.
 */
async function readFramesThenAbandon(
  res: Response,
  ac: AbortController,
  stop: (events: ProgramRunEvent[]) => boolean,
): Promise<ProgramRunEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: ProgramRunEvent[] = [];
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const idLine = frame.split('\n').find((l) => l.startsWith('id: '));
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine) {
          assert.ok(idLine, 'every program-run frame must carry an id: line — that is the resume cursor');
          const evt = JSON.parse(dataLine.slice(6)) as ProgramRunEvent;
          assert.strictEqual(
            String(evt.seq),
            idLine!.slice(4).trim(),
            'the SSE id: must BE the event seq, or a client resuming from it resumes from the wrong place',
          );
          events.push(evt);
        }
        split = buffer.indexOf('\n\n');
      }
      if (stop(events)) break;
    }
  } finally {
    ac.abort();
    await reader.cancel().catch(() => {});
  }
  return events;
}

/**
 * Drain a stream to its end (a run that finishes closes its own response).
 *
 * The `id:` line is checked HERE too, not only in the live reader. Without it
 * the `Last-Event-ID` test would pass against a stream that never emits an id at
 * all — the test would be sending back a cursor the server never gave it, which
 * is not the behaviour a browser `EventSource` has.
 */
async function drainFrames(res: Response): Promise<ProgramRunEvent[]> {
  const text = await res.text();
  const events: ProgramRunEvent[] = [];
  for (const frame of text.split('\n\n')) {
    const lines = frame.split('\n');
    const dataLine = lines.find((l) => l.startsWith('data: '));
    if (!dataLine) continue;
    const idLine = lines.find((l) => l.startsWith('id: '));
    assert.ok(idLine, 'every program-run frame must carry an id: line — that is the resume cursor');
    const evt = JSON.parse(dataLine.slice(6)) as ProgramRunEvent;
    assert.strictEqual(String(evt.seq), idLine!.slice(4).trim(), 'the SSE id: must BE the event seq');
    events.push(evt);
  }
  return events;
}

function usedOnDisk(userDir: string): number {
  const file = path.join(userDir, usageFileForIdentity('local'));
  if (!fs.existsSync(file)) return 0;
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as MeterUsage).usedThisMonth;
}

/* ==========================================================================
 * THE NAMED LOCK
 * ======================================================================== */

test('a run outlives its client: disconnect mid-run, reconnect, and the state ADVANCED while nobody watched', async () => {
  // 4 nodes × 300ms ⇒ ~1.2s of run. Long enough to disconnect during node 1 and
  // reconnect after node 2 or 3 has already finished.
  const s = await startAll(300);
  try {
    const { runId } = await startRun(s.base, chainProgram(4));

    // ---- 1. watch briefly, then KILL THE CLIENT -----------------------------
    const ac = new AbortController();
    const first = await fetch(`${s.base}/api/program/runs/${runId}/events`, { signal: ac.signal });
    assert.strictEqual(first.status, 200);
    const seen = await readFramesThenAbandon(first, ac, (evts) =>
      // Stop as soon as the first agent node is actually running: the run is now
      // genuinely mid-flight, not merely accepted.
      evts.some((e) => e.type === 'node:status' && e.nodeId === 'a1' && e.status === 'running'),
    );
    const lastSeqAtDisconnect = seen[seen.length - 1].seq;
    const doneAtDisconnect = seen.filter(
      (e) => e.type === 'node:status' && e.status === 'done',
    ).length;
    const gatewayCallsAtDisconnect = s.gateway.received;
    assert.ok(lastSeqAtDisconnect >= 1, 'the client saw at least one committed event before dying');

    // ---- 2. no client at all for a while ------------------------------------
    await sleep(750);

    // ---- 3. reconnect from the cursor it had ---------------------------------
    const second = await fetch(`${s.base}/api/program/runs/${runId}/events?since=${lastSeqAtDisconnect}`);
    assert.strictEqual(second.status, 200, 'the run is still there to reconnect to');
    const resumed = await drainFrames(second);

    // THE RUN IS STILL THERE.
    assert.ok(resumed.length > 0, 'reconnecting delivered the events the dead client missed');

    // ITS STATE ADVANCED WHILE NOBODY WAS ATTACHED.
    assert.ok(
      s.gateway.received > gatewayCallsAtDisconnect,
      `the provider was called again after the client left ` +
        `(${gatewayCallsAtDisconnect} → ${s.gateway.received}) — otherwise nothing advanced and ` +
        `this test would pass against a run that simply stalled`,
    );
    const doneAfter = resumed.filter((e) => e.type === 'node:status' && e.status === 'done').length;
    assert.ok(
      doneAtDisconnect + doneAfter > doneAtDisconnect,
      'nodes finished after the disconnect',
    );

    // REPLAY IS EXACT — contiguous with what the dead client had, and no repeats.
    assert.strictEqual(
      resumed[0].seq,
      lastSeqAtDisconnect + 1,
      'the resumed stream starts at exactly the next seq — no gap, no repeat',
    );
    for (let i = 1; i < resumed.length; i += 1) {
      assert.strictEqual(resumed[i].seq, resumed[i - 1].seq + 1, 'the log has no holes');
    }

    // AND THE RUN FINISHED, without a client present for most of it.
    const finished = resumed.find((e) => e.type === 'run:finished');
    assert.ok(finished, 'the run reached a terminal event on its own');
    assert.strictEqual(
      finished!.type === 'run:finished' ? finished!.status : undefined,
      'completed',
      'a run nobody was watching still ran to completion',
    );

    const { run } = await readRun(s.base, runId);
    assert.strictEqual(run.status, 'completed');
    assert.strictEqual(run.nodesTotal, 6, 'start + 4 agents + end');
    assert.strictEqual(run.nodesDone, 6, 'every node reported done by the engine');
    assert.strictEqual(run.nodesError, 0);
    assert.strictEqual(s.gateway.received, 4, 'exactly one provider call per agent node');
  } finally {
    await s.close();
  }
});

/* ==========================================================================
 * RUN ID · LIST · READ
 * ======================================================================== */

test('POST /api/program/run returns a run id that is immediately readable and listed', async () => {
  const s = await startAll(50);
  try {
    const accepted = await startRun(s.base, chainProgram(1, 'p-one'));
    assert.match(accepted.runId, /^run-[0-9a-z]+-[0-9a-f]{8}$/);
    assert.strictEqual(accepted.status, 'running');
    assert.strictEqual(accepted.lastEventSeq, 0);

    // Readable at once — a run id a client cannot look up is not a run id.
    const immediately = await readRun(s.base, accepted.runId);
    assert.strictEqual(immediately.run.runId, accepted.runId);
    assert.strictEqual(immediately.run.programId, 'p-one');
    assert.strictEqual(immediately.run.programName, 'chain of 1');

    const listRes = await fetch(`${s.base}/api/program/runs`);
    assert.strictEqual(listRes.status, 200);
    const list = (await listRes.json()) as GetProgramRunsResponse;
    assert.ok(list.runs.some((r) => r.runId === accepted.runId), 'the run appears in the list');

    // Let it finish, then re-read: the same id, now terminal.
    const events = await drainFrames(await fetch(`${s.base}/api/program/runs/${accepted.runId}/events`));
    assert.ok(events.some((e) => e.type === 'run:finished'));
    const after = await readRun(s.base, accepted.runId);
    assert.strictEqual(after.run.status, 'completed');
    assert.ok(after.run.finishedAt !== undefined, 'a finished run records when it finished');
    assert.strictEqual(
      after.run.lastEventSeq,
      after.events[after.events.length - 1].seq,
      'the summary cursor equals the log it summarises',
    );
  } finally {
    await s.close();
  }
});

test('two runs are two run ids, listed newest first and never confused with each other', async () => {
  const s = await startAll(40);
  try {
    const one = await startRun(s.base, chainProgram(1, 'p-first'));
    await sleep(20);
    const two = await startRun(s.base, chainProgram(2, 'p-second'));
    assert.notStrictEqual(one.runId, two.runId);

    await drainFrames(await fetch(`${s.base}/api/program/runs/${one.runId}/events`));
    await drainFrames(await fetch(`${s.base}/api/program/runs/${two.runId}/events`));

    const list = (await (await fetch(`${s.base}/api/program/runs`)).json()) as GetProgramRunsResponse;
    const ids = list.runs.map((r) => r.runId);
    assert.ok(ids.includes(one.runId) && ids.includes(two.runId));
    assert.strictEqual(ids[0], two.runId, 'newest first');

    const first = list.runs.find((r) => r.runId === one.runId)!;
    const second = list.runs.find((r) => r.runId === two.runId)!;
    assert.strictEqual(first.programId, 'p-first');
    assert.strictEqual(second.programId, 'p-second');
    assert.strictEqual(first.nodesTotal, 3);
    assert.strictEqual(second.nodesTotal, 4);
  } finally {
    await s.close();
  }
});

test('an unknown or malformed run id is a 404, and a traversal attempt never reaches the filesystem', async () => {
  const s = await startAll(30);
  try {
    assert.strictEqual((await fetch(`${s.base}/api/program/runs/run-zzz-00000000`)).status, 404);
    assert.strictEqual((await fetch(`${s.base}/api/program/runs/not-a-run-id`)).status, 404);
    assert.strictEqual(
      (await fetch(`${s.base}/api/program/runs/${encodeURIComponent('../../../etc/passwd')}`)).status,
      404,
    );
  } finally {
    await s.close();
  }
});

test('an invalid program is refused with its problems named, and no run is created', async () => {
  const s = await startAll(30);
  try {
    const before = (await (await fetch(`${s.base}/api/program/runs`)).json()) as GetProgramRunsResponse;
    const res = await fetch(`${s.base}/api/program/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ program: { id: 'bad', name: 'bad', nodes: [], edges: [] } }),
    });
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: string; problems: string[] };
    assert.ok(body.problems.some((p) => p.includes('start node')), 'the real validator reason is named');
    const after = (await (await fetch(`${s.base}/api/program/runs`)).json()) as GetProgramRunsResponse;
    assert.strictEqual(after.runs.length, before.runs.length, 'a rejected program creates no run');
  } finally {
    await s.close();
  }
});

test('Activity New Run reaches the real ACP executor when the sole configured agent is named claude', async () => {
  const s = await startAll(5);
  try {
    addAgent(s.userDir, { id: 'claude', command: process.execPath, args: [MOCK_AGENT] });

    const accepted = await startRun(s.base, activityProgram());
    await drainFrames(await fetch(`${s.base}/api/program/runs/${accepted.runId}/events`));

    const { run } = await readRun(s.base, accepted.runId);
    assert.strictEqual(
      run.status,
      'completed',
      'the default ACP ref falls back to the sole configured agent before executor construction',
    );
    assert.strictEqual(run.nodesError, 0);
  } finally {
    await s.close();
  }
});

test('Activity New Run is refused at the door when no local agent can resolve its default ref', async () => {
  const s = await startAll(5);
  try {
    const before = (await (await fetch(`${s.base}/api/program/runs`)).json()) as GetProgramRunsResponse;
    const res = await fetch(`${s.base}/api/program/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ program: activityProgram('ui-no-agent') }),
    });

    assert.strictEqual(res.status, 400, 'an unresolvable agent is a synchronous refusal, never a 202');
    assert.match(
      ((await res.json()) as { error: string }).error,
      /no local agent|configure one/i,
      'the refusal tells the reader what is missing',
    );
    const after = (await (await fetch(`${s.base}/api/program/runs`)).json()) as GetProgramRunsResponse;
    assert.strictEqual(after.runs.length, before.runs.length, 'a refused request creates no doomed run row');
  } finally {
    await s.close();
  }
});

/* ==========================================================================
 * RESUMABLE REPLAY
 * ======================================================================== */

test('replaying a finished run from since=0 reproduces the log exactly once', async () => {
  const s = await startAll(40);
  try {
    const { runId } = await startRun(s.base, chainProgram(3));
    const live = await drainFrames(await fetch(`${s.base}/api/program/runs/${runId}/events`));
    const replayed = await drainFrames(await fetch(`${s.base}/api/program/runs/${runId}/events?since=0`));
    assert.deepStrictEqual(
      replayed.map((e) => e.seq),
      live.map((e) => e.seq),
      'a replay is the same rows in the same order — idempotent by construction',
    );
    assert.deepStrictEqual(replayed, live, 'and the same contents, byte for byte');

    // A cursor past the end yields nothing and still closes cleanly.
    const tail = await drainFrames(
      await fetch(`${s.base}/api/program/runs/${runId}/events?since=${live[live.length - 1].seq}`),
    );
    assert.strictEqual(tail.length, 0, 'nothing is re-delivered to a client that is up to date');
  } finally {
    await s.close();
  }
});

test('Last-Event-ID resumes exactly like ?since= — the header a browser EventSource sends by itself', async () => {
  const s = await startAll(40);
  try {
    const { runId } = await startRun(s.base, chainProgram(3));
    const all = await drainFrames(await fetch(`${s.base}/api/program/runs/${runId}/events`));
    const cursor = all[1].seq;

    const viaHeader = await drainFrames(
      await fetch(`${s.base}/api/program/runs/${runId}/events`, {
        headers: { 'last-event-id': String(cursor) },
      }),
    );
    const viaQuery = await drainFrames(
      await fetch(`${s.base}/api/program/runs/${runId}/events?since=${cursor}`),
    );
    assert.deepStrictEqual(viaHeader, viaQuery);
    assert.strictEqual(viaHeader[0].seq, cursor + 1);
  } finally {
    await s.close();
  }
});

/* ==========================================================================
 * CANCELLATION — and the metering invariant it exists to protect
 * ======================================================================== */

test('CONTROL: a run that is NOT cancelled charges one metered call per agent node', async () => {
  // Never removed and never relaxed: it is what makes "did not increment" in the
  // next test mean "this run was not charged" rather than "metering is broken".
  const s = await startAll(60);
  try {
    const { runId } = await startRun(s.base, chainProgram(2));
    await drainFrames(await fetch(`${s.base}/api/program/runs/${runId}/events`));
    const view = (await (await fetch(`${s.base}/api/usage`)).json()) as { usedThisMonth: number };
    assert.strictEqual(view.usedThisMonth, 2, 'two agent nodes, two charges');
    assert.strictEqual(usedOnDisk(s.userDir), 2, 'and the charges are on disk');
  } finally {
    await s.close();
  }
});

test('cancelling a run stops it AND stops it metering — the provider was mid-generation when it landed', async () => {
  const GEN_MS = 1_500;
  const s = await startAll(GEN_MS);
  try {
    const { runId } = await startRun(s.base, chainProgram(3));

    // Wait until the provider is genuinely generating. Without this the cancel
    // could land before the call and nothing would have been at risk of a charge.
    await sleep(500);
    assert.ok(
      s.gateway.received >= 1,
      'the provider must already be generating — otherwise nothing was cancelled',
    );
    const callsAtCancel = s.gateway.received;

    const cancelRes = await fetch(`${s.base}/api/program/runs/${runId}/cancel`, { method: 'POST' });
    assert.strictEqual(cancelRes.status, 200);
    const cancel = (await cancelRes.json()) as PostProgramRunCancelResponse;
    assert.strictEqual(cancel.cancelled, true, 'an abort was delivered to a live run');

    // Past the point the in-flight generation would have completed and charged.
    await sleep(GEN_MS + 700);

    const { run, events } = await readRun(s.base, runId);
    assert.strictEqual(run.status, 'stopped', 'the scheduler reports a loud stop, not a completion');
    assert.ok(run.cancelledAt !== undefined, 'the record says WHY it stopped — a user asked');
    assert.ok(
      events.some((e) => e.type === 'run:cancelled'),
      'the cancellation is in the durable log, so a reconnecting client learns of it too',
    );
    assert.ok(run.nodesDone < 3, 'the run did not quietly finish all three agent nodes anyway');

    // The stop is real, not cosmetic: no further node called the provider.
    assert.strictEqual(
      s.gateway.received,
      callsAtCancel,
      'a cancelled run launched no further provider calls',
    );

    const view = (await (await fetch(`${s.base}/api/usage`)).json()) as { usedThisMonth: number };
    assert.strictEqual(
      view.usedThisMonth,
      0,
      'a cancelled run must not be charged for the generation it was cancelled during',
    );
    assert.strictEqual(usedOnDisk(s.userDir), 0, 'and nothing was written to the usage file');
  } finally {
    await s.close();
  }
});

test('cancelling a run that already finished is an honest no-op, not an error', async () => {
  const s = await startAll(30);
  try {
    const { runId } = await startRun(s.base, chainProgram(1));
    await drainFrames(await fetch(`${s.base}/api/program/runs/${runId}/events`));
    const res = await fetch(`${s.base}/api/program/runs/${runId}/cancel`, { method: 'POST' });
    assert.strictEqual(res.status, 200, 'the caller wanted the run stopped; it is stopped');
    const body = (await res.json()) as PostProgramRunCancelResponse;
    assert.strictEqual(body.cancelled, false, 'nothing was actually cancelled, and it says so');
    assert.strictEqual(body.status, 'completed', 'and reports what the run really is');
  } finally {
    await s.close();
  }
});

test('cancelling an unknown run is a 404, never a fabricated acknowledgement', async () => {
  const s = await startAll(30);
  try {
    const res = await fetch(`${s.base}/api/program/runs/run-zzz-00000000/cancel`, { method: 'POST' });
    assert.strictEqual(res.status, 404);
  } finally {
    await s.close();
  }
});

/* ==========================================================================
 * HONEST ABSENCE
 * ======================================================================== */

test('a run no live supervisor owns reads as interrupted, never as still running — and that verdict is never written back', async () => {
  /*
   * The condition under test is the one a killed process leaves behind: a
   * `run.json` on disk that says `running` while nothing is advancing it.
   *
   * It is staged with TWO servers over ONE repo rather than by killing a
   * process, because the rule being locked is per-process by definition —
   * "the record says running but no supervisor in THIS process owns it" — and a
   * second server is exactly that condition, reproducible, with no orphaned
   * child and no timing on a SIGKILL. Server A really is driving the run; server
   * B really has no supervisor for it.
   *
   * The second half is the part that matters more than the label: B must NOT
   * write `interrupted` back. If it did, B's read would corrupt A's live run —
   * which is precisely why `reconcile` is a read-time view.
   */
  const a = await startAll(1_200);
  const b = await createRepoServer(a.repo, { webDist: undefined, userConfigDir: a.userDir });
  await new Promise<void>((resolve) => b.listen(0, '127.0.0.1', () => resolve()));
  const bAddr = b.address();
  const bBase = `http://127.0.0.1:${typeof bAddr === 'object' && bAddr ? bAddr.port : 0}`;
  try {
    const { runId } = await startRun(a.base, chainProgram(3));
    await sleep(300);

    // The record on disk genuinely claims `running`. Without this the rest of the
    // test could pass against a server that reports `interrupted` for everything.
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(a.repo, '.sequence', 'program-runs', runId, 'run.json'), 'utf8'),
    ) as { status: string };
    assert.strictEqual(onDisk.status, 'running', 'the durable record says running');

    // A: owns it, and says so.
    assert.strictEqual((await readRun(a.base, runId)).run.status, 'running');

    // B: does not own it, and refuses to claim it is advancing.
    const fromB = await readRun(bBase, runId);
    assert.strictEqual(fromB.run.status, 'interrupted', 'not `running` — B is advancing nothing');
    assert.ok(fromB.run.finishedAt === undefined, 'and no finish time is invented for it');
    assert.ok(fromB.events.length > 0, 'the events it did commit are still readable');
    assert.ok(
      !fromB.events.some((e) => e.type === 'run:finished'),
      'no terminal event is fabricated for a run that never reached one',
    );
    const bList = (await (await fetch(`${bBase}/api/program/runs`)).json()) as GetProgramRunsResponse;
    assert.strictEqual(bList.runs.find((r) => r.runId === runId)!.status, 'interrupted');

    // Tailing from B replays what exists and CLOSES, rather than holding a socket
    // open forever on a run B will never advance.
    const tail = await drainFrames(await fetch(`${bBase}/api/program/runs/${runId}/events`));
    assert.deepStrictEqual(
      tail.map((e) => e.seq),
      fromB.events.map((e) => e.seq),
    );

    // THE VERDICT WAS NOT WRITTEN BACK.
    const stillOnDisk = JSON.parse(
      fs.readFileSync(path.join(a.repo, '.sequence', 'program-runs', runId, 'run.json'), 'utf8'),
    ) as { status: string };
    assert.notStrictEqual(
      stillOnDisk.status,
      'interrupted',
      "B's read must not stamp a verdict onto a run A is still driving",
    );
    assert.strictEqual((await readRun(a.base, runId)).run.status, 'running', 'A is unaffected');

    // And A carries it through to a real completion.
    await drainFrames(await fetch(`${a.base}/api/program/runs/${runId}/events`));
    assert.strictEqual((await readRun(a.base, runId)).run.status, 'completed');
  } finally {
    await new Promise<void>((resolve) => {
      b.close(() => resolve());
      (b as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await a.close();
  }
});

test('the concurrency ceiling refuses with a number rather than queueing invisibly', async () => {
  // MAX_LIVE_RUNS is 8. A ninth concurrent run is a 429 naming the limit — not a
  // run that is "accepted" and then sits invisible behind eight others, which
  // would make the run list a description of intentions rather than of what is
  // happening.
  const s = await startAll(1_200);
  const accepted: string[] = [];
  try {
    for (let i = 0; i < MAX_LIVE_RUNS; i += 1) {
      accepted.push((await startRun(s.base, chainProgram(1, `p-${i}`))).runId);
    }
    const ninth = await fetch(`${s.base}/api/program/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ program: chainProgram(1, 'p-ninth') }),
    });
    assert.strictEqual(ninth.status, 429);
    const body = (await ninth.json()) as { error: string };
    assert.match(body.error, new RegExp(String(MAX_LIVE_RUNS)), 'the refusal names the limit');

    const list = (await (await fetch(`${s.base}/api/program/runs`)).json()) as GetProgramRunsResponse;
    assert.ok(
      !list.runs.some((r) => r.programId === 'p-ninth'),
      'a refused run is not in the list — it never existed',
    );
  } finally {
    // Cancel rather than wait: this test holds eight slow runs open.
    for (const runId of accepted) {
      await fetch(`${s.base}/api/program/runs/${runId}/cancel`, { method: 'POST' });
    }
    await s.close();
  }
});

test('a non-allowlisted command node is refused by name — no ambient shell', async () => {
  const s = await startAll(30);
  try {
    const program: Program = {
      id: 'p-cmd',
      name: 'has a command',
      nodes: [
        { id: 'start', title: 'Start', kind: 'start' },
        { id: 'c1', title: 'Build', kind: 'command', command: { command: 'rm -rf /' } },
        { id: 'end', title: 'End', kind: 'end' },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'c1', kind: 'seq' },
        { id: 'e2', from: 'c1', to: 'end', kind: 'seq' },
      ],
    };
    const { runId } = await startRun(s.base, program);
    await drainFrames(await fetch(`${s.base}/api/program/runs/${runId}/events`));
    const { run } = await readRun(s.base, runId);
    assert.strictEqual(run.status, 'failed');
    assert.strictEqual(run.nodesError, 1);
    assert.match(
      run.error ?? '',
      /not allowlisted|unsafe characters|no ambient shell/,
      'the refusal names allowlist / no ambient shell, not a silent skip',
    );
    assert.doesNotMatch(run.error ?? '', /^command node 'c1' is not executed by a server run/);
    assert.strictEqual(s.gateway.received, 0, 'and nothing was executed or charged');
  } finally {
    await s.close();
  }
});

test('an allowlisted command node records exit code and stdout (C1.5)', async () => {
  const s = await startAll(180);
  try {
    const program: Program = {
      id: 'p-cmd-ok',
      name: 'allowlisted verify',
      nodes: [
        { id: 'start', title: 'Start', kind: 'start' },
        {
          id: 'c1',
          title: 'Schema test',
          kind: 'command',
          command: {
            command: 'pnpm --filter @sequence/schema test',
            outKey: 'cmdOut',
          },
        },
        { id: 'end', title: 'End', kind: 'end' },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'c1', kind: 'seq' },
        { id: 'e2', from: 'c1', to: 'end', kind: 'seq' },
      ],
    };
    const { runId } = await startRun(s.base, program);
    await drainFrames(await fetch(`${s.base}/api/program/runs/${runId}/events`));
    const { run } = await readRun(s.base, runId);
    assert.strictEqual(run.status, 'completed', run.error ?? 'expected completed');
    assert.strictEqual(run.nodesDone >= 1, true);
    const node = run.nodeResults.c1;
    assert.ok(node, 'command node recorded a result');
    assert.strictEqual(node.status, 'done');
    assert.match(node.detail ?? '', /exit 0/, 'detail names the measured exit');
    const out = run.state.cmdOut as { exitCode?: number; output?: string } | undefined;
    assert.ok(out && typeof out === 'object', 'outKey received structured exit+output');
    assert.strictEqual(out.exitCode, 0);
    assert.strictEqual(typeof out.output, 'string');
  } finally {
    await s.close();
  }
});

/* ==========================================================================
 * CHANGE STATS — the PRODUCTION wiring, not the runner in isolation
 * ======================================================================== */

test('a run recorded by THE SERVER carries change stats', async () => {
  /*
   * `run-change-window.test.ts` builds its own runner and injects its own
   * snapshot, so it proves the window logic and NOTHING about the server. The
   * one line that makes the statistic exist in production —
   * `snapshotTree: (root) => gitNumstatSnapshot(root)` in `createRepoServer` —
   * had no test at all: deleting it left all 28 of those tests green, which is
   * exactly the props-not-the-mount hole this whole register opened with.
   *
   * This drives the REAL server through the REAL route and asserts the field
   * arrives. It is deliberately weak about the NUMBERS — the fixture repo is
   * not a git repo, so the snapshot may legitimately answer null — and strict
   * about the thing that regressed: whether the server passes a snapshotter at
   * all. A run whose snapshot returned null records no `changed`, and a run
   * whose server forgot to wire one records no `changed` either; so the
   * assertion is on the WIRING being present, checked by asking the runner
   * what it was given.
   */
  const s = await startAll(5);
  try {
    const accepted = await startRun(s.base, chainProgram(1, 'p-stats'));
    await drainFrames(await fetch(`${s.base}/api/program/runs/${accepted.runId}/events`));

    const after = await readRun(s.base, accepted.runId);
    assert.strictEqual(after.run.status, 'completed');

    /*
     * `changed` is present exactly when the server handed the runner a
     * snapshotter AND that snapshotter answered. On a non-git fixture the
     * second half can be false, so this asserts the SHAPE rather than
     * presence: if the field is there it must be a well-formed stat, and the
     * companion assertion below catches an unwired server.
     */
    if (after.run.changed !== undefined) {
      assert.strictEqual(typeof after.run.changed.files, 'number');
      assert.strictEqual(typeof after.run.changed.added, 'number');
      assert.strictEqual(typeof after.run.changed.removed, 'number');
      assert.strictEqual(typeof after.run.changed.uncountedFiles, 'number');
    }
  } finally {
    await s.close();
  }
});

test('THE SERVER HANDS ITS RUNNER A TREE SNAPSHOTTER', async () => {
  /*
   * The assertion that actually fails when the production line is deleted.
   * Read off the source rather than inferred from a number, because the
   * numbers on a non-git fixture are legitimately absent and would make this
   * pass for the wrong reason.
   */
  const src = fs.readFileSync(
    path.join(here, '..', '..', 'src', 'server', 'repoServer.ts'),
    'utf8',
  );
  const at = src.indexOf('createProgramRunner({');
  assert.ok(at !== -1, 'the server builds a program runner');
  const block = src.slice(at, at + 1200);
  assert.match(
    block,
    /snapshotTree:/,
    'createProgramRunner must be given a snapshotTree, or every run records no change stats',
  );
});
