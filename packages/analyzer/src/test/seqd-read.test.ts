import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const MINIMAL_SEQD = fs.readFileSync(
  path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'minimal.seqd'),
  'utf8'
);

function freshRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-seqd-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
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

test('GET /api/file reads .sequence/diagrams/*.seqd after PUT round-trip', async () => {
  const repo = freshRepo();
  const SECRET = 'sk-ant-LIVE-KEY-should-never-leak-seqd';
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  const rel = '.sequence/diagrams/minimal.seqd';
  const { base, close } = await startRepoServer(repo);
  try {
    const put = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: rel, content: MINIMAL_SEQD }),
    });
    assert.strictEqual(put.status, 200, 'writing a .seqd must be allowed');
    assert.strictEqual(fs.readFileSync(path.join(repo, rel), 'utf8'), MINIMAL_SEQD);

    const get = await fetch(`${base}/api/file?path=${encodeURIComponent(rel)}`);
    assert.strictEqual(get.status, 200, 'reopening the .seqd by path must be allowed');
    assert.strictEqual(await get.text(), MINIMAL_SEQD);

    const key = await fetch(`${base}/api/file?path=${encodeURIComponent('.sequence/ai.json')}`);
    assert.strictEqual(key.status, 403);
    assert.ok(!(await key.text()).includes(SECRET));
  } finally {
    await close();
  }
});

test('a symlink inside .sequence/diagrams cannot read out of the allowlist', async () => {
  const repo = freshRepo();
  const SECRET = 'sk-ant-LIVE-KEY-should-never-leak-seqd-symlink';
  fs.mkdirSync(path.join(repo, '.sequence', 'diagrams'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  try {
    fs.symlinkSync(
      path.join(repo, '.sequence', 'ai.json'),
      path.join(repo, '.sequence', 'diagrams', 'leak.seqd')
    );
  } catch {
    return;
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(
      `${base}/api/file?path=${encodeURIComponent('.sequence/diagrams/leak.seqd')}`
    );
    assert.strictEqual(res.status, 403, 'a symlink out of diagrams/ must stay refused');
    assert.ok(!(await res.text()).includes(SECRET));
  } finally {
    await close();
  }
});

test('a HARD link inside .sequence/diagrams cannot read the stored API key', async () => {
  const repo = freshRepo();
  const SECRET = 'sk-ant-LIVE-KEY-hardlink-seqd';
  fs.mkdirSync(path.join(repo, '.sequence', 'diagrams'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'ai.json'),
    JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: SECRET })
  );
  try {
    fs.linkSync(
      path.join(repo, '.sequence', 'ai.json'),
      path.join(repo, '.sequence', 'diagrams', 'leak.seqd')
    );
  } catch {
    return;
  }
  const { base, close } = await startRepoServer(repo);
  try {
    const res = await fetch(
      `${base}/api/file?path=${encodeURIComponent('.sequence/diagrams/leak.seqd')}`
    );
    assert.strictEqual(res.status, 403, 'a hard link into the key must be refused');
    assert.ok(!(await res.text()).includes(SECRET));
  } finally {
    await close();
  }
});
