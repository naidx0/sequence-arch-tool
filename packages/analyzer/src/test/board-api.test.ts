import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { emptySequenceBoardDoc, defaultTaskCardDocProps } from '@sequence/schema';
import { createRepoServer } from '../server/repoServer.js';
import { BOARD_FILE } from '../server/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function freshRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-board-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

async function startRepoServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('GET/PUT /api/board round-trips .sequence/board.json', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const empty = await fetch(`${base}/api/board`);
    assert.strictEqual(empty.status, 200);
    const emptyBody = await empty.json();
    assert.deepStrictEqual(emptyBody, emptySequenceBoardDoc());

    const doc = {
      version: 1 as const,
      nodes: [
        {
          id: 'native-card-1',
          kind: 'task-card' as const,
          x: 80,
          y: 120,
          w: 260,
          h: 148,
          props: defaultTaskCardDocProps({ title: 'Persist me', owner: 'Ada' }),
        },
      ],
      edges: [] as const,
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const put = await fetch(`${base}/api/board`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    assert.strictEqual(put.status, 200);
    const disk = path.join(repo, '.sequence', BOARD_FILE);
    assert.ok(fs.existsSync(disk), 'board.json must be written to disk');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(disk, 'utf8')), doc);

    const get = await fetch(`${base}/api/board`);
    assert.strictEqual(get.status, 200);
    assert.deepStrictEqual(await get.json(), doc);
  } finally {
    await close();
  }
});

test('PUT /api/board rejects invalid documents', async () => {
  const repo = freshRepo();
  const { base, close } = await startRepoServer(repo);
  try {
    const put = await fetch(`${base}/api/board`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 2, nodes: [], edges: [] }),
    });
    assert.strictEqual(put.status, 400);
  } finally {
    await close();
  }
});
