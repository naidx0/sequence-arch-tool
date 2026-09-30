import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';

/**
 * WAVE 1 ITEM 1.5 — STALENESS + PROGRESS.
 *
 * Two defects, both in repoServer.ts:
 *
 *  1. `PUT /api/file` writes the file and calls `clearCachedGraph` (:1580) WITHOUT
 *     rescanning, so the graph the board is showing is knowingly behind the disk —
 *     and says nothing about it. The canvas is stale the moment the user acts on
 *     it, silently (gap G5). The marker must be on BOTH the write's own response
 *     and on the graph read, because a client that reloads the graph in another
 *     tab never saw the write's response.
 *
 *  2. `POST /api/scan` is a single blocking call: a long scan is a spinner and
 *     nothing else (gap G4 / P6).
 *
 * WHAT THE PROGRESS ASSERTIONS PIN. `done`/`total` count the PHASES this route
 * actually executes, and the test asserts the properties that make a progress
 * feed trustworthy rather than a specific phase count: monotonic non-decreasing
 * `done`, `done <= total`, a terminal event with `done === total`, and every
 * event arriving BEFORE the graph payload. A test that pinned "4 events" would
 * break the day a phase is added while learning nothing about honesty.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function copyFixture(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-stale-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(src, repo, { recursive: true });
  return repo;
}

function plainappRepo(): string {
  return copyFixture(PLAINAPP);
}

interface Started {
  base: string;
  repo: string;
  close: () => Promise<void>;
}

async function startServer(fixture: string = PLAINAPP): Promise<Started> {
  const repo = copyFixture(fixture);
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    repo,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      });
      fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    },
  };
}

type Json = Record<string, unknown>;

async function putFile(base: string, relPath: string, content: string): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}/api/file`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: relPath, content }),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

async function getGraph(base: string, query = ''): Promise<{ status: number; body: Json; headers: Headers }> {
  const res = await fetch(`${base}/archgraph.json${query}`);
  return { status: res.status, body: (await res.json()) as Json, headers: res.headers };
}

/** Parse an SSE body into its `data:` payloads (framing mirrors writeSseEvent). */
function sseEvents(text: string): Json[] {
  const out: Json[] = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (!clean.startsWith('data: ')) continue;
      out.push(JSON.parse(clean.slice(6)) as Json);
    }
  }
  return out;
}

test('PUT /api/file reports that the graph it left behind is now stale', async () => {
  const s = await startServer();
  try {
    const put = await putFile(s.base, 'backend/app/extra.py', 'X = 1\n');
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.ok, true);
    assert.strictEqual(
      put.body.stale,
      true,
      'the write invalidates the cached graph without rescanning, so the response must say so',
    );
  } finally {
    await s.close();
  }
});

test('GET /archgraph.json carries the stale marker after a write, and drops it after a scan', async () => {
  const s = await startServer();
  try {
    const before = await getGraph(s.base);
    assert.strictEqual(before.status, 200);
    assert.notStrictEqual(before.body.stale, true, 'a freshly scanned graph is not stale');

    await putFile(s.base, 'backend/app/extra.py', 'X = 1\n');

    const after = await getGraph(s.base);
    assert.strictEqual(after.status, 200);
    assert.strictEqual(
      after.body.stale,
      true,
      'the graph on the wire is behind the disk and the reader is not told',
    );
    // The marker names WHAT went behind, not just that something did — a bare
    // boolean cannot tell a client whether the file it is looking at is affected.
    assert.ok(
      Array.isArray(after.body.stalePaths) && (after.body.stalePaths as string[]).length > 0,
      'the stale marker names at least one path that moved under the graph',
    );

    const rescan = await fetch(`${s.base}/api/scan`, { method: 'POST' });
    assert.strictEqual(rescan.status, 200);
    await rescan.text();

    const fresh = await getGraph(s.base);
    assert.notStrictEqual(fresh.body.stale, true, 'a rescan clears staleness — it is not a sticky flag');
  } finally {
    await s.close();
  }
});

/*
 * NOT LOCKED HERE: scoped cache invalidation on PUT /api/file.
 *
 * W1.4's `clearCachedGraph(root, changedPath)` invalidates one package's part
 * instead of deleting the whole cache, and its report names this route as the
 * call site. A test for it lived here and passed against the one-line change —
 * a write into `frontend-ace` left `backend-shared`'s cached slice readable while
 * `frontend-ace` correctly missed. It is not shipped because
 * `graph-cache.test.ts:257` asserts the cache FILE is removed, which the scoped
 * form does not do, and that file belongs to another owner this wave. See the
 * comment at the `clearCachedGraph` call in repoServer.ts.
 */
test('POST /api/scan streams at least 3 scan:progress events before the graph', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.base}/api/scan`, {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
    });
    assert.strictEqual(res.status, 200);
    assert.match(
      res.headers.get('content-type') ?? '',
      /text\/event-stream/,
      'a caller that asks for a stream gets one',
    );
    const events = sseEvents(await res.text());
    const progress = events.filter((e) => e.type === 'scan:progress');
    assert.ok(
      progress.length >= 3,
      `a long scan must report progress; got ${progress.length} scan:progress events`,
    );

    // Honesty properties of the feed, not its length.
    let last = -1;
    for (const p of progress) {
      assert.strictEqual(typeof p.done, 'number', 'every progress event carries done');
      assert.strictEqual(typeof p.total, 'number', 'every progress event carries total');
      assert.strictEqual(typeof p.path, 'string', 'every progress event carries a path');
      const done = p.done as number;
      const total = p.total as number;
      assert.ok(done >= last, `progress never goes backwards (${done} after ${last})`);
      assert.ok(done <= total, `progress never exceeds its own denominator (${done} of ${total})`);
      last = done;
    }
    const terminal = progress[progress.length - 1];
    assert.strictEqual(terminal.done, terminal.total, 'the feed ends complete, never stuck short');

    // The result still arrives, and it arrives last.
    const resultIdx = events.findIndex((e) => e.type === 'scan:result');
    assert.ok(resultIdx >= 0, 'the stream still delivers the scanned graph');
    const lastProgressIdx = events.map((e) => e.type).lastIndexOf('scan:progress');
    assert.ok(lastProgressIdx < resultIdx, 'progress precedes the payload it is progress towards');
    const graph = (events[resultIdx] as { graph?: Json }).graph;
    assert.ok(graph && Array.isArray(graph.nodes) && (graph.nodes as unknown[]).length > 0);
  } finally {
    await s.close();
  }
});

test('the progress feed reaches the client DURING the scan, not all at once at the end', async () => {
  // Measured against the real monorepo on the first cut of this route: all four
  // scan:progress frames and the result arrived together at +5,395 ms — a 5.4 s
  // blocking scan with a progress feed that was itself buffered until the end.
  // Every assertion in the test above still passed, because "the events exist" and
  // "the events arrive while they are still news" are different claims.
  //
  // This is asserted WITHOUT wall-clock thresholds: read the body chunk by chunk
  // and require that the chunk carrying the first scan:progress does NOT already
  // carry the scan:result. One chunk holding both IS the buffered failure, and it
  // is what the defect produces every time rather than only on a slow machine.
  const s = await startServer();
  try {
    const res = await fetch(`${s.base}/api/scan`, {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
    });
    assert.strictEqual(res.status, 200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let sawProgress = false;
    let progressAndResultInSameChunk = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const hasProgress = chunk.includes('"scan:progress"');
      const hasResult = chunk.includes('"scan:result"');
      if (!sawProgress && hasProgress) {
        sawProgress = true;
        if (hasResult) progressAndResultInSameChunk = true;
      }
    }
    assert.ok(sawProgress, 'the stream carried progress at all');
    assert.strictEqual(
      progressAndResultInSameChunk,
      false,
      'progress and the finished graph arrived in one write — the feed was buffered until the scan ended',
    );
  } finally {
    await s.close();
  }
});

test('POST /api/scan without an event-stream accept header is unchanged: one JSON graph', async () => {
  const s = await startServer();
  try {
    const res = await fetch(`${s.base}/api/scan`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    const body = (await res.json()) as Json;
    assert.ok(Array.isArray(body.nodes) && (body.nodes as unknown[]).length > 0);
    assert.ok(body.nodeDetail && typeof body.nodeDetail === 'object');
  } finally {
    await s.close();
  }
});
