import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-ASK-STREAM-77';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-stream-'));
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

test('/api/ask/stream: emits intent, provider, usage, and result events in order', async () => {
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
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const events = await readSseEvents(res);
    const types = events.map((e) => e.type);
    assert.ok(types.includes('intent:start'), 'stream announces intent start');
    assert.ok(types.includes('step:start'), 'stream announces pipeline step:start');
    assert.ok(types.includes('provider:start'), 'stream announces provider start');
    assert.ok(types.includes('provider:done'), 'stream announces provider done');
    assert.ok(types.includes('usage'), 'stream reports token usage');
    assert.ok(types.includes('result'), 'stream ends with result');
    const usage = events.find((e) => e.type === 'usage') as {
      inputTokens: number;
      outputTokens: number;
    };
    assert.strictEqual(usage.inputTokens, 120);
    assert.strictEqual(usage.outputTokens, 40);
    const result = events.find((e) => e.type === 'result') as { text: string };
    assert.strictEqual(result.text, 'The gateway handles orders.');
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: buffered response includes usage from provider', async () => {
  const repo = plainappRepo();
  const mock = await startMockProvider(() => ({ text: 'Buffered answer.' }));
  const { base, close } = await startServer(repo);
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      text: string;
      usage?: { inputTokens: number; outputTokens: number; estimated: boolean };
    };
    assert.strictEqual(body.text, 'Buffered answer.');
    assert.ok(body.usage, 'buffered ask carries usage');
    assert.strictEqual(body.usage?.inputTokens, 120);
    assert.strictEqual(body.usage?.outputTokens, 40);
    assert.strictEqual(body.usage?.estimated, false);
  } finally {
    await close();
    await mock.close();
  }
});
