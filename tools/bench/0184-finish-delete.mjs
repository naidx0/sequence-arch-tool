// HTTP acknowledgement and durable deletion, not browser click-to-paint latency.
// Usage: node --import ./tools/test-guard/no-real-binaries.mjs tools/bench/0184-finish-delete.mjs <new-output-dir> [samples=10]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRepoServer } from '../../packages/analyzer/dist/server/repoServer.js';

const out = path.resolve(process.argv[2] ?? '');
const samples = Number(process.argv[3] ?? 10);
if (!process.argv[2] || !Number.isSafeInteger(samples) || samples < 2) throw Error('name a NEW output directory and at least 2 samples');
if (fs.existsSync(out)) throw Error('refusing an existing output directory');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, '.finish-deletion-specimen'), 'Owned generated benchmark data only\n');
process.env.SEQUENCE_USER_DIR = path.join(out, 'user');
fs.mkdirSync(process.env.SEQUENCE_USER_DIR);
const write = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(value)); };
const result = { node: process.version, kind: 'real-server HTTP + independent disk re-read; synthetic specimens; no UI timing', samples, rows: [] };
const now = new Date().toISOString();
const percentile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * q) - 1];

for (const [kind, scales] of [['chat', [1, 100, 1000]], ['space', [1, 20, 49]]]) {
  for (const count of scales) {
    const root = path.join(out, `${kind}-${count}`);
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'README.md'), '# Owned deletion benchmark specimen\n');
    const server = await createRepoServer(root, {
      userConfigDir: path.join(out, 'user'), recentStoreDir: path.join(out, 'recent'), browseRoot: out,
      providerSearch: { pathValue: '', extraDirs: [] }, detectLocal: async () => [], terminalEnabled: false,
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const times = [];
    const durableTimes = [];
    try {
      for (let sample = 0; sample < samples; sample++) {
        // Re-seed the exact owned index, and create the measured target's large payload.
        const ids = Array.from({ length: count }, (_, i) => `finish-${sample}-${i}`);
        const target = ids[0];
        const entries = ids.map((id) => ({ id, title: id, name: id, kind: 'whiteboard', rev: 0, createdAt: now, updatedAt: now, chats: ['bench-chat'] }));
        const dir = path.join(root, '.sequence', kind === 'chat' ? 'sessions' : 'boards');
        const indexFile = path.join(dir, 'index.json');
        const targetFile = kind === 'chat' ? path.join(dir, target, 'chat.json') : path.join(dir, `${target}.json`);
        if (kind === 'chat') {
          write(indexFile, { version: 1, activeId: target, sessions: entries });
          write(targetFile, { version: 1, sessionId: target, turns: Array.from({ length: 500 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'benchmark text '.repeat(256) })) });
        } else {
          write(indexFile, { version: 1, boards: [{ id: 'architecture', name: 'Architecture', kind: 'architecture', rev: 0, createdAt: now, updatedAt: now }, ...entries] });
          write(targetFile, { version: 1, id: target, rev: 0, items: Array.from({ length: 2000 }, (_, i) => ({ id: `text-${i}`, kind: 'text', text: 'benchmark text '.repeat(32), at: { x: i, y: i } })) });
        }
        const endpoint = kind === 'chat' ? `/api/sessions/${target}` : `/api/boards/${target}?chat=bench-chat`;
        const start = performance.now();
        const response = await fetch(`${base}${endpoint}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) });
        const body = await response.json();
        const acknowledged = performance.now();
        assert.equal(response.status, 200, JSON.stringify(body));
        assert.equal(fs.existsSync(targetFile), false, 'acknowledgement must mean target payload disappeared');
        const persisted = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        const remaining = kind === 'chat' ? persisted.sessions : persisted.boards;
        assert.equal(remaining.some((row) => row.id === target), false);
        for (const id of ids.slice(1)) assert.ok(remaining.some((row) => row.id === id), `unrelated ${id} survives`);
        assert.equal(remaining.length, kind === 'chat' ? Math.max(1, count - 1) : count);
        if (kind === 'chat') assert.ok(remaining.some((row) => row.id === persisted.activeId), 'active pointer resolves, including last-chat replacement');
        const checked = performance.now();
        times.push(acknowledged - start);
        durableTimes.push(checked - start);
        const again = await fetch(`${base}${endpoint}`, { method: 'DELETE' });
        assert.equal(again.status, 404, 'repeated deletion refuses an absent target');
        await again.text();
      }
      if (kind === 'space') {
        const protectedResponse = await fetch(`${base}/api/boards/architecture`, { method: 'DELETE' });
        assert.equal(protectedResponse.status, 409, 'architecture board stays protected');
        await protectedResponse.text();
      }
      const row = { kind, count, targetPayload: kind === 'chat' ? '500 turns, ~1.9 MB' : '2000 text items', httpMs: times, durableMs: durableTimes, medianMs: percentile(times, .5), p95Ms: percentile(times, .95), maxMs: Math.max(...times) };
      result.rows.push(row);
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(row));
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}
