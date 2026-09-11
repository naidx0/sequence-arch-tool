import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';
import { readAskTurnEvents } from '../server/askTurnLog.js';

/**
 * A TURN THAT OUTLIVES ITS CONNECTION — against a real server.
 *
 * `ask-turn-log.test.ts` covers the store. This covers the SEAM, which is
 * where the equivalent defect actually lived: the ask stream wrote `data:`
 * with no `id:` line at all, so a browser sent no `Last-Event-ID` on reconnect
 * and there was nothing a client could say it had already seen — while the
 * provider call kept running, because `ProviderStreamOptions` declares only
 * `onDelta` and the abort signal was never read. The answer was paid for and
 * discarded.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-RESUME-91';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-resume-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

async function startServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Parse SSE into `{ id, event }` pairs, which is the point of this file. */
function parseFrames(text: string): Array<{ id: number | null; event: Record<string, unknown> }> {
  const out: Array<{ id: number | null; event: Record<string, unknown> }> = [];
  for (const block of text.split('\n\n')) {
    let id: number | null = null;
    let data: string | null = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('id: ')) id = Number.parseInt(line.slice(4).trim(), 10);
      if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (data === null) continue;
    out.push({ id, event: JSON.parse(data) as Record<string, unknown> });
  }
  return out;
}

async function ask(base: string): Promise<Response> {
  return fetch(`${base}/api/ask/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question: 'What does this app do?',
      intents: [{ id: 'impact', subject: 'backend', subjectNodeId: 'svc:backend' }],
    }),
  });
}

test('the ask stream carries an id on every frame, and the turn is on disk', async () => {
  const repo = plainappRepo();
  const mock = await startMockProvider(() => ({ text: 'The gateway handles orders.' }));
  const { base, close } = await startServer(repo);
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });

    const frames = parseFrames(await (await ask(base)).text());
    assert.ok(frames.length > 0, 'the stream produced frames');

    /* THE DEFECT, STATED: every frame used to arrive with no id, so a browser
       sent no Last-Event-ID and nothing could be resumed. */
    for (const f of frames) {
      assert.ok(typeof f.id === 'number' && f.id > 0, `frame ${JSON.stringify(f.event)} carries an id`);
    }
    /* Monotonic, so a client's cursor only ever moves forward. */
    const ids = frames.map((f) => f.id as number);
    assert.deepStrictEqual(ids, [...ids].sort((a, b) => a - b));

    const start = frames.find((f) => f.event.type === 'trajectory:start');
    const runId = start?.event.runId as string;
    assert.ok(typeof runId === 'string' && runId.length > 0);

    /* COMMIT BEFORE YIELD: everything the socket saw is on disk. */
    const logged = readAskTurnEvents(repo, runId);
    assert.strictEqual(logged.length, frames.length, 'every streamed frame was committed first');
    assert.deepStrictEqual(
      logged.map((e) => e.event.type),
      frames.map((f) => f.event.type),
    );
  } finally {
    await close();
    await mock.close();
  }
});

test('a client that dropped mid-turn replays exactly what it missed', async () => {
  const repo = plainappRepo();
  const mock = await startMockProvider(() => ({ text: 'The gateway handles orders.' }));
  const { base, close } = await startServer(repo);
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });

    const frames = parseFrames(await (await ask(base)).text());
    const runId = frames.find((f) => f.event.type === 'trajectory:start')?.event.runId as string;

    /* Pretend the socket died after the second frame. */
    const seen = 2;
    const res = await fetch(`${base}/api/ask/events?runId=${encodeURIComponent(runId)}&since=${seen}`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { events: { seq: number; event: Record<string, unknown> }[]; lastSeq: number };

    assert.deepStrictEqual(
      body.events.map((e) => e.event.type),
      frames.slice(seen).map((f) => f.event.type),
      'the replay is exactly the tail the client had not seen',
    );
    assert.strictEqual(body.lastSeq, frames.length);

    /* And nothing already seen is repeated - a client that replayed from zero
       would render the whole answer twice. */
    assert.ok(body.events.every((e) => e.seq > seen));
  } finally {
    await close();
    await mock.close();
  }
});

test('the RUN ID is in the durable log even though it is not in askTrace', async () => {
  /*
   * These two records answer different questions and the difference is load
   * bearing. `askTrace` is what the assistant DID, and `trajectory:start` is a
   * control event - `trajectory-capture.test.ts` asserts every askTrace entry
   * was streamed as a payload event and excludes this one by name.
   *
   * The DURABLE log has the opposite requirement: a client replaying from
   * scratch needs the run id, so it must be recorded there. Routing the
   * control event through the tracing path satisfies one and breaks the other,
   * which is exactly what happened while this was being built.
   */
  const repo = plainappRepo();
  const mock = await startMockProvider(() => ({ text: 'The gateway handles orders.' }));
  const { base, close } = await startServer(repo);
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });

    const frames = parseFrames(await (await ask(base)).text());
    const runId = frames.find((f) => f.event.type === 'trajectory:start')?.event.runId as string;

    const logged = readAskTurnEvents(repo, runId);
    assert.ok(
      logged.some((e) => e.event.type === 'trajectory:start'),
      'the durable log carries the control event a replay needs',
    );

    const doc = JSON.parse(
      fs.readFileSync(path.join(repo, '.sequence', 'trajectory', `${runId}.json`), 'utf8'),
    ) as { askTrace: Record<string, unknown>[] };
    assert.ok(
      !doc.askTrace.some((e) => e.type === 'trajectory:start'),
      'and askTrace does NOT, because it records what the assistant did',
    );
  } finally {
    await close();
    await mock.close();
  }
});

test('an unknown turn is a 404, never an empty replay', async () => {
  /* "This turn was never recorded" and "you have seen everything" are
     different answers. A client that cannot tell them apart waits forever for
     the second half of a turn that does not exist. */
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/ask/events?runId=run-nope99-0000aaaa`);
    assert.strictEqual(res.status, 404);
  } finally {
    await close();
  }
});

test('a traversal in the run id never reaches the filesystem', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    for (const hostile of ['../../etc/passwd', '..%2F..%2Fpackage.json', '..']) {
      const res = await fetch(`${base}/api/ask/events?runId=${encodeURIComponent(hostile)}`);
      assert.ok(res.status === 400 || res.status === 404, `${hostile} refused (${res.status})`);
    }
  } finally {
    await close();
  }
});
