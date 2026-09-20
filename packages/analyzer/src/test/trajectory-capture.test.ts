import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';
import {
  buildAskTrajectoryGraph,
  isTrajectoryDoc,
  type TrajectoryDoc,
} from '../server/trajectoryStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-TRAJECTORY-77';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-trajectory-'));
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

async function readSseEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  const events: Array<Record<string, unknown>> = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
    }
  }
  return events;
}

test('/api/ask/stream: persists a trajectory doc with only real streamed events', async () => {
  const repo = plainappRepo();
  const mock = await startMockProvider(() => ({ text: 'The gateway handles orders.' }));
  const { base, close } = await startServer(repo);
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });
    const res = await fetch(`${base}/api/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'What does this app do?',
        intents: [{ id: 'impact', subject: 'backend', subjectNodeId: 'svc:backend' }],
      }),
    });
    assert.strictEqual(res.status, 200);
    const events = await readSseEvents(res);
    const types = events.map((e) => e.type);

    // runId discovery: a trajectory:start SSE event is emitted early.
    assert.ok(types.includes('trajectory:start'), 'stream announces trajectory:start with runId');
    const startEvent = events.find((e) => e.type === 'trajectory:start') as { runId: string };
    const runId = startEvent.runId;
    assert.ok(typeof runId === 'string' && runId.length > 0, 'trajectory:start carries a runId');

    // The persisted doc exists at .sequence/trajectory/<runId>.json.
    const trajPath = path.join(repo, '.sequence', 'trajectory', `${runId}.json`);
    assert.ok(fs.existsSync(trajPath), 'trajectory file written under .sequence/trajectory/');
    const doc = JSON.parse(fs.readFileSync(trajPath, 'utf8')) as TrajectoryDoc;
    assert.ok(isTrajectoryDoc(doc), 'persisted doc passes isTrajectoryDoc');

    // askTrace events are a subset of what was streamed (ignoring trajectory:start,
    // which is a control event, not a fake tool call).
    const streamedPayloadEvents = events.filter((e) => e.type !== 'trajectory:start');
    const streamedJson = new Set(streamedPayloadEvents.map((e) => JSON.stringify(e)));
    for (const ev of doc.askTrace) {
      assert.ok(
        streamedJson.has(JSON.stringify(ev)),
        `askTrace event ${ev.type} was actually streamed`,
      );
    }
    // Same intent/file/provider types appear in the trace.
    const traceTypes = doc.askTrace.map((e) => e.type);
    assert.ok(traceTypes.includes('intent:start'), 'trace carries intent:start');
    assert.ok(traceTypes.includes('provider:start'), 'trace carries provider:start');
    assert.ok(traceTypes.includes('step:start'), 'trace carries pipeline step:start');
    assert.ok(traceTypes.includes('result'), 'trace carries result');

    // question text persisted from the ask body.
    assert.equal(doc.question, 'What does this app do?');

    // Audit G3 — the change receipt is written beside the trajectory, for the
    // same run, stamped with the same instruction hash the stream announced.
    const receiptPath = path.join(repo, '.sequence', 'receipts', `${runId}.json`);
    assert.ok(fs.existsSync(receiptPath), 'run receipt written under .sequence/receipts/');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
    assert.equal(receipt.runId, runId);
    assert.equal(receipt.terminal, 'result');
    assert.equal(receipt.instructionHash, (startEvent as unknown as { instructionHash: string }).instructionHash);
    assert.equal(receipt.model, 'claude-test');
    assert.equal(JSON.stringify(receipt).includes(TEST_KEY), false, 'the key never reaches the receipt');

    // A0.3 — metrics lifted to a top-level field for scorecard export.
    assert.ok(doc.askMetrics, 'trajectory carries askMetrics for M1–M7 export');
    assert.equal(typeof doc.askMetrics!.wallMs, 'number');
    assert.ok(
      typeof doc.askMetrics!.rounds === 'number' || doc.askMetrics!.stopReason !== undefined,
      'askMetrics names rounds or stopReason',
    );

    // graph.runId matches; no fabricated decision nodes from empty fanout.
    assert.strictEqual(doc.graph.runId, runId, 'graph.runId matches the stream runId');
    for (const node of doc.graph.nodes) {
      assert.notStrictEqual(node.kind, 'decision', 'no fabricated decision nodes from ask events');
    }
    // Every graph node traces to a real streamed intent/file/provider event.
    const nodeIds = new Set(doc.graph.nodes.map((n) => n.id));
    for (const id of nodeIds) {
      const prefix = id.split(':')[0];
      assert.ok(
        prefix === 'intent' || prefix === 'file' || prefix === 'provider' || prefix === 'step' || prefix === 'tool',
        `graph node ${id} traces to a real event kind`,
      );
    }
  } finally {
    await close();
    await mock.close();
  }
});

test('buildAskTrajectoryGraph: empty trace yields empty nodes (no fabrication)', () => {
  const graph = buildAskTrajectoryGraph('run-empty', []);
  assert.strictEqual(graph.runId, 'run-empty');
  assert.strictEqual(graph.nodes.length, 0, 'empty trace → empty nodes');
  assert.strictEqual(graph.edges.length, 0, 'empty trace → empty edges');
});

test('buildAskTrajectoryGraph: a result-only trace still yields no nodes', () => {
  const graph = buildAskTrajectoryGraph('run-result-only', [{ type: 'result', text: 'hi' }]);
  assert.strictEqual(graph.nodes.length, 0, 'result is terminal, not a node');
});

test('buildAskTrajectoryGraph: step events become action nodes in encounter order', () => {
  const graph = buildAskTrajectoryGraph('run-steps', [
    { type: 'step:start', id: 'intents' },
    { type: 'step:done', id: 'intents' },
    { type: 'step:start', id: 'provider' },
    { type: 'provider:start' },
    { type: 'provider:done' },
    { type: 'step:done', id: 'provider' },
    { type: 'result', text: 'done' },
  ]);
  assert.strictEqual(graph.nodes.length, 3);
  const intentsNode = graph.nodes.find((n) => n.id === 'step:intents');
  assert.ok(intentsNode, 'intents step node present');
  assert.strictEqual(intentsNode!.status, 'done');
  const providerStep = graph.nodes.find((n) => n.id === 'step:provider');
  assert.ok(providerStep, 'provider step node present');
  assert.strictEqual(providerStep!.status, 'done');
  const providerNode = graph.nodes.find((n) => n.id === 'provider');
  assert.ok(providerNode, 'provider node present');
  assert.strictEqual(providerNode!.status, 'done');
});

test('buildAskTrajectoryGraph: file events become tool nodes with evidence', () => {
  const graph = buildAskTrajectoryGraph('run-files', [
    { type: 'file:read', path: 'src/a.ts' },
    { type: 'file:done', path: 'src/a.ts' },
    { type: 'provider:start' },
    { type: 'provider:done' },
    { type: 'result', text: 'done' },
  ]);
  assert.strictEqual(graph.nodes.length, 2);
  const fileNode = graph.nodes.find((n) => n.id === 'file:src/a.ts');
  assert.ok(fileNode, 'file node present');
  assert.strictEqual(fileNode!.kind, 'tool');
  assert.strictEqual(fileNode!.status, 'done');
  assert.strictEqual(fileNode!.evidence, 'src/a.ts');
  const providerNode = graph.nodes.find((n) => n.id === 'provider');
  assert.ok(providerNode, 'provider node present');
  assert.strictEqual(providerNode!.status, 'done');
  // Linear edge between the two nodes in encounter order.
  assert.strictEqual(graph.edges.length, 1);
  assert.strictEqual(graph.edges[0].from, 'file:src/a.ts');
  assert.strictEqual(graph.edges[0].to, 'provider');
});

test('POST /api/trajectory: persists a program doc; GET /api/trajectory/:runId returns it', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const programDoc: TrajectoryDoc = {
      version: 1,
      runId: 'prog-run-1',
      kind: 'program',
      startedAt: '2026-08-11T00:00:00.000Z',
      finishedAt: '2026-08-11T00:01:00.000Z',
      programId: 'prog-1',
      askTrace: [],
      graph: {
        runId: 'prog-run-1',
        programId: 'prog-1',
        nodes: [
          { id: 'n1', kind: 'start', title: 'Start', order: 0, status: 'done' },
          { id: 'n2', kind: 'action', title: 'Do thing', order: 1, status: 'done' },
        ],
        edges: [{ id: 'e1', from: 'n1', to: 'n2' }],
      },
      runEvents: [{ nodeId: 'n2', status: 'done', at: 123 }],
    };
    const postRes = await fetch(`${base}/api/trajectory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(programDoc),
    });
    assert.strictEqual(postRes.status, 200);
    const postBody = (await postRes.json()) as { runId: string };
    assert.strictEqual(postBody.runId, 'prog-run-1');

    const filePath = path.join(repo, '.sequence', 'trajectory', 'prog-run-1.json');
    assert.ok(fs.existsSync(filePath), 'program trajectory file written');

    const getRes = await fetch(`${base}/api/trajectory/prog-run-1`);
    assert.strictEqual(getRes.status, 200);
    const got = (await getRes.json()) as TrajectoryDoc;
    assert.strictEqual(got.runId, 'prog-run-1');
    assert.strictEqual(got.kind, 'program');
    assert.strictEqual(got.graph.nodes.length, 2);
    assert.deepStrictEqual(got.runEvents, [{ nodeId: 'n2', status: 'done', at: 123 }]);
  } finally {
    await close();
  }
});

test('GET /api/trajectory/:runId — 404 when missing', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/trajectory/does-not-exist`);
    assert.strictEqual(res.status, 404);
  } finally {
    await close();
  }
});

test('POST /api/trajectory — 400 on bad body', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/trajectory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ not: 'a trajectory' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await close();
  }
});
