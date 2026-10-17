#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   STREAM BENCH: what three chats streaming at once cost the page
   tools/measure/stream-bench.mjs

   Boots the BUILT web2 behind a tiny proxy that answers POST /api/acp/run-node with a timed SSE
   stream of acp frames (markdown prose with code blocks, one chunk per --chunk-ms) and passes
   everything else to the real server. Starts a run in each of three chats, then watches the chat on
   screen while all three stream:
     - main-thread busy share and script ms per chunk (CDP Performance metrics)
     - animation-frame gaps (p95, worst) and long tasks (>50 ms) while they stream
     - how long a keystroke takes to paint in the composer, and a chat switch, mid-stream
   Calls no model.

     node tools/measure/stream-bench.mjs --throttle 4 --chunk-ms 25 --seconds 8 [--out f.json]
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import http from 'node:http';
import { arg, launch, median, pct, r1, seedChats, startApp } from './lib/benchApp.mjs';

const THROTTLE = Number(arg('--throttle', '1'));
const CHUNK_MS = Number(arg('--chunk-ms', '50'));
const CHUNK_CHARS = Number(arg('--chunk-chars', '18'));
const SECONDS = Number(arg('--seconds', '8'));
const TURNS = Number(arg('--turns', '40'));
const OUT = arg('--out', '');
const PROFILE = arg('--profile', '');

const app = await startApp({ agents: true });
const ids = await seedChats(app.base, { chats: 3, turns: TURNS });
const target = new URL(app.base);

const answer = (n) => `Here is pass ${n}.\n\n- the cart is summed\n- the key is built\n- \`pay()\` runs\n\n\`\`\`ts\nexport function handler${n}(req: Request) {\n  const total = req.items.reduce((s, it) => s + it.price * it.qty, 0);\n  return pay(total, { retries: 3 });\n}\n\`\`\`\n\nThat is the path through **checkout**. `.repeat(1);
const chunksOf = () => {
  const out = [];
  for (let n = 0; n < 400; n++) for (let i = 0; i < answer(n).length; i += CHUNK_CHARS) out.push(answer(n).slice(i, i + CHUNK_CHARS));
  return out;
};
let runs = 0;
const proxy = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/acp/run-node')) {
    runs += 1;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: 'acp:session', resumed: false, threadId: `t${runs}` });
    const chunks = chunksOf();
    let i = 0;
    const timer = setInterval(() => {
      if (i >= chunks.length || res.destroyed) { clearInterval(timer); if (!res.destroyed) { send({ type: 'acp:result', stopReason: 'end_turn' }); res.end(); } return; }
      send({ type: 'acp:update', update: { sessionId: `t${runs}`, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunks[i++] } } } });
    }, CHUNK_MS);
    res.on('close', () => clearInterval(timer));
    return;
  }
  const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => res.destroy());
  req.pipe(up);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${proxy.address().port}`;

const { browser, page, cdp } = await launch({ throttle: THROTTLE });
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
await page.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  window.__raf = [];
  let last = performance.now();
  const tick = (t) => { window.__raf.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await page.goto(base);
await page.waitForSelector('[data-testid="s2-session"]', { timeout: 60000 });
await page.waitForTimeout(2000);
const rows = page.locator('[data-testid="s2-session"] .s2-it-hit');
const titles = await page.locator('[data-testid="s2-session"] .s2-t').allInnerTexts();
const rowOf = (c) => titles.findIndex((t) => t.trim() === `Chat ${c}`);

for (const c of [0, 1, 2]) {
  await rows.nth(rowOf(c)).click();
  await page.waitForTimeout(800);
  const ta = page.locator('[data-testid="s2-chat"] textarea').first();
  await ta.click();
  await ta.fill(`go ${c}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}
const started = runs;
await page.waitForTimeout(1500);

/* watch the chat on screen (chat 2, the last started) while all three stream */
await page.evaluate(() => { window.__long.length = 0; window.__raf.length = 0; });
if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
const m0 = await metrics();
await page.waitForTimeout(SECONDS * 1000);
if (PROFILE) fs.writeFileSync(PROFILE, JSON.stringify((await cdp.send('Profiler.stop')).profile));
const m1 = await metrics();
const long = await page.evaluate(() => window.__long.slice());
const raf = await page.evaluate(() => window.__raf.slice(2));
const wall = SECONDS;
const chunksPerSec = 3 * (1000 / CHUNK_MS);
const busy = (m1.TaskDuration - m0.TaskDuration) / wall;
const script = (m1.ScriptDuration - m0.ScriptDuration) / wall;

/* a keystroke mid-stream */
const ta = page.locator('[data-testid="s2-chat"] textarea').first();
await ta.click();
const keys = [];
for (const ch of 'where does checkout call') {
  const t0 = await page.evaluate(() => performance.now());
  await page.keyboard.type(ch);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
  keys.push(await page.evaluate((a) => performance.now() - a, t0));
}
/* a chat switch mid-stream */
const sw = [];
for (const c of [0, 1, 0, 1, 2]) {
  const t0 = await page.evaluate(() => performance.now());
  await rows.nth(rowOf(c)).click();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  sw.push(await page.evaluate((a) => performance.now() - a, t0));
  await page.waitForTimeout(400);
}
const out = {
  throttle: THROTTLE, chunkMs: CHUNK_MS, runsStarted: started,
  chunksPerSec, mainThreadBusyPct: r1(busy * 100), scriptPct: r1(script * 100), scriptMsPerChunk: r1((script * 1000) / chunksPerSec),
  rafGapP50: r1(median(raf)), rafGapP95: r1(pct(raf, 0.95)), rafGapMax: r1(Math.max(...raf)),
  longTasks: long.length, longTaskTotalMs: r1(long.reduce((a, b) => a + b, 0)), longTaskMax: r1(Math.max(0, ...long)),
  keyPaintP50: r1(median(keys)), keyPaintP95: r1(pct(keys, 0.95)),
  switchMidStreamMs: sw.map(r1),
};
console.log(JSON.stringify(out));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
await browser.close();
proxy.close();
app.stop();
