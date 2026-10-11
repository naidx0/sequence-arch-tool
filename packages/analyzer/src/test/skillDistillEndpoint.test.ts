import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import type { TrajectoryDoc } from '../server/trajectoryStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-skill-endpoint-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

async function startServer(repoRoot: string | null): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function askDoc(runId: string, intentId: string, filePaths: string[]): TrajectoryDoc {
  const askTrace: Array<Record<string, unknown>> = [
    { type: 'intent:start', id: intentId },
    { type: 'intent:done', id: intentId },
  ];
  for (const p of filePaths) {
    askTrace.push({ type: 'file:read', path: p });
    askTrace.push({ type: 'file:done', path: p });
  }
  askTrace.push({ type: 'provider:start' });
  askTrace.push({ type: 'provider:done' });
  askTrace.push({ type: 'result', text: 'answer' });
  return {
    version: 1,
    runId,
    kind: 'ask',
    startedAt: '2026-08-11T00:00:00.000Z',
    finishedAt: '2026-08-11T00:00:01.000Z',
    askTrace,
    askTerminal: { type: 'result', text: 'answer' },
    graph: { runId, nodes: [], edges: [] },
  };
}

function writeTrajectory(repoRoot: string, doc: TrajectoryDoc): void {
  const dir = path.join(repoRoot, '.sequence', 'trajectory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${doc.runId}.json`), JSON.stringify(doc, null, 2));
}

test('POST /api/harness/distill-skills: writes a SKILL.md from trajectory evidence (owner path, no key)', async () => {
  const repo = plainappRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts']));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts']));
  writeTrajectory(repo, askDoc('r3', 'impact', ['src/a.ts', 'src/c.ts']));
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/harness/distill-skills`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { written: { slug: string; name: string; filePath: string }[]; errors: string[] };
    assert.deepEqual(body.errors, []);
    assert.equal(body.written.length, 1);
    assert.equal(body.written[0].slug, 'impact');
    assert.ok(fs.existsSync(body.written[0].filePath), 'SKILL.md written to disk');
    const fileText = fs.readFileSync(body.written[0].filePath, 'utf8');
    assert.ok(fileText.includes('evidenceRunIds:'), 'frontmatter persisted');
    assert.ok(fileText.includes('- r1'), 'evidence run id listed');
  } finally {
    await close();
  }
});

test('POST /api/harness/distill-skills: 409 when no repo attached', async () => {
  const { base, close } = await startServer(null);
  try {
    const res = await fetch(`${base}/api/harness/distill-skills`, { method: 'POST' });
    assert.strictEqual(res.status, 409);
  } finally {
    await close();
  }
});
