import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { makeBigRepo as makeFiles } from './findFilesBigRepo.js';

/*
 * Item 019-progress: a RUNTIME attach (the window switching repos) reports its progress on `/api/status` as the
 * additive `attaching: {path, phase, done, total, startedAt}`, so the switch view can say "N of M files" instead of a
 * static screen. `scanning` keeps meaning only "the startup attach is unsettled" and never appears for a runtime attach.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES = path.resolve(here, '..', '..', '..', '..', 'examples');
const portOf = (s: http.Server): number => (s.address() as { port: number }).port;
const closeServer = (s: http.Server): Promise<void> => new Promise((r) => s.close(() => r()));
const rm = (d: string): void => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

interface Attaching {
  path: string;
  phase: string;
  done: number;
  total: number;
  startedAt: number;
}

test('a runtime attach of a big repo reports increasing done over a stable total on /api/status, then clears it', async () => {
  const big = makeFiles(3000);
  fs.writeFileSync(path.join(big, 'package.json'), JSON.stringify({ name: 'bigrepo', version: '1.0.0' }));
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ap-home-')));
  const small = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ap-small-')));
  fs.cpSync(path.join(EXAMPLES, 'ticketing-scaffold'), small, { recursive: true, filter: (s) => !s.includes(`${path.sep}.sequence`) });
  const server = await createRepoServer(small, { userConfigDir: home, recentStoreDir: home, browseRoot: path.dirname(big) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${portOf(server)}`;
  try {
    const first = (await (await fetch(`${base}/api/status`)).json()) as Record<string, unknown>;
    assert.strictEqual(first.attached, true);
    assert.strictEqual(first.attaching, undefined, 'nothing is attaching at rest');

    const samples: Attaching[] = [];
    let sawScanning = false;
    let polling = true;
    const poll = (async () => {
      while (polling) {
        const b = (await (await fetch(`${base}/api/status`)).json()) as { attaching?: Attaching; scanning?: unknown };
        if (b.scanning !== undefined) sawScanning = true;
        if (b.attaching) samples.push(b.attaching);
        await new Promise((r) => setTimeout(r, 15));
      }
    })();
    const res = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: big }),
    });
    assert.strictEqual(res.status, 200, await res.clone().text());
    polling = false;
    await poll;

    assert.ok(samples.length >= 3, `status answered with attaching while the scan ran (${samples.length} samples)`);
    assert.ok(samples.every((s) => fs.realpathSync(s.path) === fs.realpathSync(big)), 'attaching names the folder being opened');
    const counted = samples.filter((s) => s.phase === 'scanning' && s.total > 0);
    assert.ok(counted.length >= 2, `phase scanning with a known total was observed (${counted.length})`);
    const totals = new Set(counted.map((s) => s.total));
    assert.strictEqual(totals.size, 1, `total is stable: ${[...totals].join(',')}`);
    for (let i = 1; i < counted.length; i++) assert.ok(counted[i]!.done >= counted[i - 1]!.done, 'done never goes backwards');
    assert.ok(counted[counted.length - 1]!.done > counted[0]!.done, `done increased (${counted[0]!.done} -> ${counted[counted.length - 1]!.done})`);
    assert.ok(samples.every((s) => s.startedAt === samples[0]!.startedAt && typeof s.startedAt === 'number'));
    assert.strictEqual(sawScanning, false, '`scanning` stays the startup attach\'s: a runtime attach never sets it');

    const after = (await (await fetch(`${base}/api/status`)).json()) as { attached: boolean; attaching?: unknown; root?: string };
    assert.strictEqual(after.attached, true);
    assert.strictEqual(after.attaching, undefined, 'cleared once the attach settles');
    assert.strictEqual(fs.realpathSync(after.root!), fs.realpathSync(big));
  } finally {
    await closeServer(server);
    rm(big);
    rm(small);
    rm(home);
  }
});

test('a failed runtime attach clears attaching too', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ap-fail-')));
  const server = await createRepoServer(null, { userConfigDir: home, recentStoreDir: home, browseRoot: home });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${portOf(server)}`;
  try {
    const res = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.join(home, 'nope') }),
    });
    assert.ok(res.status >= 400);
    const st = (await (await fetch(`${base}/api/status`)).json()) as Record<string, unknown>;
    assert.strictEqual(st.attaching, undefined);
  } finally {
    await closeServer(server);
    rm(home);
  }
});
