/* A separate process that polls GET <url> every `intervalMs` (open loop: a tick fires whether or not the
   last request has answered, up to MAX_INFLIGHT outstanding) and reports every request's latency. It is a
   separate process so the engine's stall is the only thing it can be waiting on; its own event loop is
   idle. Each request opens a fresh connection (no keep-alive), like a client that polls.

   Parent -> child: { cmd: 'start', url, intervalMs }   { cmd: 'stop' }
   Child -> parent: { type: 'ready' }   { type: 'result', samples: [[sentEpochMs, latencyMs, status]], skippedAt: [epochMs] }
   status is 'ok' (HTTP 200), 'bad' (non-200 or a connection error: its latency is NOT a service time) or
   'unanswered' (still waiting 3 s after `stop`; latency is the time waited so far, a lower bound). A tick not
   sent because MAX_INFLIGHT requests are already waiting is recorded in skippedAt with its time: each one is
   a 20 ms slot the server did not answer in. */
import http from 'node:http';

const MAX_INFLIGHT = 256;
let timer = null;
let url = '';
const samples = [];
const pending = new Map();
let seq = 0;
const skippedAt = [];
const agent = new http.Agent({ keepAlive: false });

function fire() {
  if (pending.size >= MAX_INFLIGHT) { skippedAt.push(Date.now()); return; }
  const id = seq++;
  const sentEpoch = Date.now();
  const t0 = process.hrtime.bigint();
  pending.set(id, { sentEpoch, t0 });
  const done = (status) => {
    if (!pending.delete(id)) return;
    samples.push([sentEpoch, Number(process.hrtime.bigint() - t0) / 1e6, status]);
  };
  const req = http.get(url, { agent }, (res) => { res.resume(); res.on('end', () => done(res.statusCode === 200 ? 'ok' : 'bad')); });
  req.on('error', () => done('bad'));
}

process.on('message', async (m) => {
  if (m.cmd === 'start') {
    url = m.url;
    timer = setInterval(fire, m.intervalMs);
  } else if (m.cmd === 'stop') {
    clearInterval(timer);
    const end = Date.now() + 3000;
    while (pending.size && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    for (const [, p] of pending) samples.push([p.sentEpoch, Number(process.hrtime.bigint() - p.t0) / 1e6, 'unanswered']);
    pending.clear();
    process.send({ type: 'result', samples, skippedAt });
    process.exit(0);
  }
});
process.send({ type: 'ready' });

/* The parent is gone or hung up (including a trigger that threw before `stop`): exit, never orphan. */
process.on('disconnect', () => process.exit(0));
