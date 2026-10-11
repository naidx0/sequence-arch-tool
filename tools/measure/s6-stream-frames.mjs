#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   S6: THE FRAMES A RECORDED TURN ARRIVES IN, BEFORE AND AFTER THE SERVER MERGE
   tools/measure/s6-stream-frames.mjs

   Plays a recorded codex turn (todo-plan, edit-with-plan) through the real
   server on the replay's ManualClock twice: with text merging off
   (`windowMs: 0`, the pre-S6 server) and on (the 50 ms window). Writes every
   SSE frame with the replay time it was read at to
   packages/web2/test/fixtures/s6/<scenario>.frames.json, which web2's
   commits-per-second measurement replays (chat/s6Commits.test.tsx).

   Replay only, no live agent. Needs the analyzer and acp built.
     node tools/measure/s6-stream-frames.mjs
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = (p) => import(new URL(`file:///${path.join(ROOT, p).replace(/\\/g, '/')}`).href);

const { ManualClock } = await req('packages/acp/dist/replay/clock.js');
const { replaySpawn } = await req('packages/acp/dist/replay/codexReplay.js');
const { createRepoServer, serverSettled } = await req('packages/analyzer/dist/server/repoServer.js');
const { agentSpecimen, replayFixture, streamTurn } = await req('packages/analyzer/dist/test/support/agentServer.js');
const { normalizeEvents } = await req('packages/analyzer/dist/test/support/replayRunNode.js');

const OUT = path.join(ROOT, 'packages', 'web2', 'test', 'fixtures', 's6');

async function play(fixture, windowMs) {
  const s = agentSpecimen({ id: 'codex', command: 'codex' });
  const clock = new ManualClock();
  const h = replaySpawn(fixture, { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const server = await createRepoServer(null, {
    webDist: undefined,
    userConfigDir: s.store,
    acpTurn: { clock, spawn: h.spawn, killGraceMs: 0 },
    ...(windowMs === undefined ? {} : { streamCoalesce: { windowMs } }),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${server.address().port}`;
  const answers = [...(fixture.header.answers ?? [])];
  const at = [];
  try {
    const events = await streamTurn(base, { agentRef: 'codex', prompt: 'go', permissionMode: fixture.header.accessMode ?? 'propose', chatId: s.chatId }, h, async (e) => {
      at.push(clock.now());
      if (e.type === 'acp:permission' && e.pending === true) {
        await fetch(`${base}/api/acp/permission`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: e.requestId, decision: answers.shift() ?? 'deny' }),
        });
      }
    });
    if (h.replay.state.divergences.length) throw new Error(`divergences: ${h.replay.state.divergences.join('; ')}`);
    const norm = normalizeEvents(events, s.work);
    return norm.map((event, i) => ({ at: at[i] - at[0], event }));
  } finally {
    await new Promise((r) => {
      server.close(() => r());
      server.closeAllConnections?.();
    });
    await serverSettled(server);
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
}

fs.mkdirSync(OUT, { recursive: true });
for (const scenario of ['todo-plan', 'edit-with-plan']) {
  const before = await play(replayFixture('codex', scenario), 0);
  const after = await play(replayFixture('codex', scenario));
  const file = path.join(OUT, `${scenario}.frames.json`);
  fs.writeFileSync(file, JSON.stringify({ scenario, source: `packages/acp/src/test/fixtures/replay/codex/${scenario}.jsonl (replayed, not run live)`, before, after }, null, 1) + '\n');
  console.log(`${scenario}: ${before.length} frames before, ${after.length} after, span ${before[before.length - 1].at} ms -> ${file}`);
}
