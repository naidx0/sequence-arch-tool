import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import { createRepoServer, serverSettled } from '../server/repoServer.js';
import { askFileIndexPending, askIndexEvents, planAskFileIndex, readyAskFileIndex, warmAskFileIndex } from '../explain/askFileIndex.js';
import { gatherAskFileResearch } from '../explain/askFileResearch.js';

/** perf P6-1: the ask index builds when it is needed (the first ask), not when a scan lands. */

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function repo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-lazy-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'caret-app', version: '1.0.0', main: 'src/app.ts' }));
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), "import './theme.css';\nexport const app = 1;\n");
  fs.writeFileSync(path.join(dir, 'src', 'theme.css'), '.composer { --composer-caret-blink: 1s; }\n');
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('attach does not start the ask index; the first ask starts it (through the scan\'s plan) and still gets results', async () => {
  const dir = repo();
  const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-lazy-store-')));
  process.env.SEQUENCE_ASK_WARM_DELAY_MS = '0';
  process.env.SEQUENCE_ASK_INDEX_WORKER = '0';
  const starts: string[] = [];
  const onStart = (root: unknown) => starts.push(String(root));
  askIndexEvents.on('start', onStart);
  const server = await createRepoServer(dir, { webDist: undefined, browseRoot: store, recentStoreDir: store, userConfigDir: store, askIndexWarm: true });
  try {
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(starts, [], 'nothing started the index at attach');
  } finally {
    askIndexEvents.off('start', onStart);
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as typeof server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    delete process.env.SEQUENCE_ASK_INDEX_WORKER;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test('a planned scan: the first ask starts the build with the plan, answers at once, and the second ask is served from the index', async () => {
  const dir = repo();
  try {
    const graph = await scanRepo(dir, { cluster: true });
    const digest = buildDigest(graph);
    let started = 0;
    planAskFileIndex(graph, { workerFile: null, fresh: false, started: () => started++ });
    assert.equal(askFileIndexPending(graph, dir), false, 'planning builds nothing');
    assert.equal(started, 0);
    const question = 'show me the code for the composer caret blink';
    const first = gatherAskFileResearch({ graph, digest, question, resolveReadable: (p) => resolveInRepo(dir, p), repoRoot: dir });
    assert.ok(Array.isArray(first.files), 'the first ask answers without waiting');
    assert.equal(started, 1, 'the first ask started the planned build');
    assert.ok(await warmAskFileIndex(graph, dir, [], (p) => resolveInRepo(dir, p)));
    assert.ok(readyAskFileIndex(graph, dir));
    const second = gatherAskFileResearch({ graph, digest, question, resolveReadable: (p) => resolveInRepo(dir, p), repoRoot: dir });
    assert.equal(second.files[0]?.path, 'src/theme.css');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
