import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';
import { askMemoStats, probeEffectiveContextCached, PROBE_TTL_MS, resetAskMemo } from '../server/askMemo.js';
import { startMockProvider } from './mock-provider.js';

/*
 * 0.1.8.1 D4 (audit M4): an ask no longer rebuilds what has not changed. Two
 * asks in a row build the digest (graph + tree walk) once and read AGENTS.md
 * once; a write through the app, or an edit to the instruction file, makes
 * the next ask build / read again. The local Ollama window is probed once per
 * PROBE_TTL_MS per model.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.resolve(here, '..', '..', 'test', 'fixtures', 'plainapp');

function repoCopy(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-d4-')));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Rules\n\nAnswer in one sentence.\n');
  return repo;
}

test('D4: a second ask in a row skips the digest/tree rebuild and the AGENTS.md read; a change brings them back', async () => {
  const repo = repoCopy();
  const userDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-d4-user-')));
  setRepoTrust(userStoreDir(), repo, true);
  const mock = await startMockProvider(() => ({ text: 'One sentence.' }));
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: userDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const ask = async (q: string): Promise<void> => {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: q }),
    });
    assert.strictEqual(res.status, 200, await res.clone().text());
    await res.text();
  };
  try {
    const put = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: 'sk-test-000-d4' }),
    });
    assert.strictEqual(put.status, 200);
    resetAskMemo();

    await ask('what is this?');
    assert.strictEqual(askMemoStats.digestBuilds, 1, 'the first ask builds the digest');
    assert.strictEqual(askMemoStats.instructionReads, 1, 'and reads AGENTS.md');
    const firstPrompt = JSON.stringify(mock.requests[mock.requests.length - 1]);
    assert.ok(firstPrompt.includes('Answer in one sentence.'), 'the instruction file reached the model');

    await ask('and again?');
    assert.strictEqual(askMemoStats.digestBuilds, 1, 'the second ask in a row did NOT rebuild the digest/tree');
    assert.ok(askMemoStats.digestHits >= 1);
    assert.strictEqual(askMemoStats.instructionReads, 1, 'and did NOT re-read AGENTS.md');
    assert.ok(JSON.stringify(mock.requests[mock.requests.length - 1]).includes('Answer in one sentence.'), 'the remembered rules still go out');

    /* An edit to the instruction file applies on the next question. */
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Rules\n\nAnswer in exactly two sentences, please.\n');
    await ask('now?');
    assert.strictEqual(askMemoStats.instructionReads, 2, 'a changed AGENTS.md is read again');
    assert.ok(JSON.stringify(mock.requests[mock.requests.length - 1]).includes('exactly two sentences'));

    /* A write through the app moves the repository on: the digest is rebuilt. */
    const before = askMemoStats.digestBuilds;
    const w = await fetch(`${base}/api/file`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'NEW_NOTES.md', content: 'new file\n' }),
    });
    assert.ok(w.status < 300, `the write landed (${w.status} ${await w.clone().text()})`);
    await ask('after the write?');
    assert.strictEqual(askMemoStats.digestBuilds, before + 1, 'a changed repository rebuilds the digest');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await mock.close();
  }
});

test('D4: the Ollama window is probed once per model within PROBE_TTL_MS', async () => {
  resetAskMemo();
  let t = 1_000_000;
  let probes = 0;
  const probe = async (): Promise<number | null> => {
    probes += 1;
    return 8192;
  };
  const noFetch = (() => {
    throw new Error('the injected probe is used');
  }) as unknown as typeof fetch;
  assert.strictEqual(await probeEffectiveContextCached('http://127.0.0.1:11434/v1', 'm', noFetch, () => t, probe), 8192);
  assert.strictEqual(await probeEffectiveContextCached('http://127.0.0.1:11434/v1', 'm', noFetch, () => t, probe), 8192);
  assert.strictEqual(probes, 1, 'the second ask did not probe');
  assert.strictEqual(await probeEffectiveContextCached('http://127.0.0.1:11434/v1', 'other', noFetch, () => t, probe), 8192);
  assert.strictEqual(probes, 2, 'another model is its own probe');
  t += PROBE_TTL_MS;
  await probeEffectiveContextCached('http://127.0.0.1:11434/v1', 'm', noFetch, () => t, probe);
  assert.strictEqual(probes, 3, 'probed again once the TTL is up');
});
