import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AcpAgentClient } from '@sequence/acp';
import { ManualClock, tick } from '@sequence/acp/dist/replay/clock.js';
import { createAcpSessionCache } from '../server/acpSessionCache.js';

test('an uncooperative cancelled turn releases the chat lock after grace, disposing before reuse', async () => {
  const cache = createAcpSessionCache({ ttlMs: 0 });
  const clock = new ManualClock();
  const ac = new AbortController();
  let disposed = 0, created = 0, active = false, settled = false;
  let rejectLate!: (e: Error) => void;
  const create = async () => ({ sessionId: 's', client: { dispose: async () => { disposed++; } } as AcpAgentClient });
  const options = { signal: ac.signal, cancelGraceMs: 50, clock };
  const first = cache.run('k', async () => { created++; return create(); }, async () => { active = true; return new Promise<void>((_, reject) => { rejectLate = reject; }); }, options);
  void first.catch(() => { settled = true; });
  await tick();
  assert.ok(active);
  const second = cache.run('k', async () => { created++; return create(); }, async () => 'next');
  ac.abort();
  clock.advance(49); await tick();
  assert.equal(settled, false, 'a cooperative bridge gets its grace window');
  clock.advance(1); await tick();
  assert.equal(settled, true, 'Stop must not wait for a bridge that never answers cancel');
  assert.equal(await second, 'next');
  assert.equal(disposed, 1);
  assert.equal(created, 2);
  rejectLate(new Error('late bridge failure after disposal')); await tick(); await tick();
  await cache.disposeAll();
});

test('cancelling a queued caller does not release the active caller or let another turn overtake it', async () => {
  const cache = createAcpSessionCache({ ttlMs: 0 });
  let release!: () => void, entered = 0, cancelled = false;
  const create = async () => ({ sessionId: 's', client: { dispose: async () => {} } as AcpAgentClient });
  const first = cache.run('k', create, async () => new Promise<void>(r => { release = r; }));
  await tick();
  const ac = new AbortController();
  const second = cache.run('k', create, async () => { entered++; }, { signal: ac.signal } as Parameters<typeof cache.run>[3]);
  void second.catch(() => { cancelled = true; });
  const third = cache.run('k', create, async () => { entered++; });
  await tick(); ac.abort(); await tick();
  assert.equal(cancelled, true);
  assert.equal(entered, 0);
  release(); await first; await third;
  assert.equal(entered, 1);
  await cache.disposeAll();
});
