#!/usr/bin/env node
/**
 * DO THE TWO ASK ROUTES ASSEMBLE THE SAME REQUEST? — the plain ask, both routes.
 *
 *   node tools/bench/route-parity.mjs
 *
 * Card-free: the model is a stub that records what it was handed and returns a
 * canned completion. Nothing here measures a model. What it measures is whether
 * `POST /api/ask` and `POST /api/ask/stream` build the SAME request for the same
 * question — the assembly-drift law applied to the plain ask, which has never
 * had a per-route gate.
 *
 * ── WHY THIS GOES OVER HTTP AND NOT THROUGH runAskPipeline ────────────────
 *
 * The law's own corollary: a bench that calls the pipeline directly measures the
 * pipeline, not the product. Both routes call the same pipeline; the question is
 * what they hand it. Driving `runAskPipeline` twice would compare two calls this
 * file wrote and would have found nothing, confidently.
 *
 * That is not hypothetical here. Earlier today a `reasoningEffort` change landed
 * on `/api/ask` only while every seat test drives `/api/ask/stream`, and the
 * result measured against it was void. The teach turn got one shared assembly
 * and a per-route source scan out of that. The PLAIN ask got neither.
 *
 * ── ISOLATION ─────────────────────────────────────────────────────────────
 *
 * A private `SEQUENCE_USER_DIR` and its own port. The user's `~/.sequence` is not
 * read or written and no other session's app is touched — the same reason the
 * trust-strip measurement intercepted a response instead of flipping the store.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { ASKS } from './plainAsks.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const MAKEMORE = path.join(ROOT, 'examples', 'makemore');

const ANSWER =
  'bigram_counts.py defines build_counts, which returns the counts matrix along with stoi and itos. ' +
  'The dot character is index 0 and marks both the start and the end of a name.';

/* ── the stub provider ───────────────────────────────────────────────────── */

let captured = [];
let tag = 'unset';

const stub = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = { unparseable: raw.slice(0, 200) };
    }
    captured.push({ tag, url: req.url, body });
    if (body?.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      chunk({ choices: [{ delta: { role: 'assistant', content: ANSWER } }] });
      chunk({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 40 } });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'stub',
        choices: [{ index: 0, message: { role: 'assistant', content: ANSWER }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1200, completion_tokens: 40 },
      }),
    );
  });
});

const freePort = () =>
  new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const stubPort = await freePort();
await new Promise((r) => stub.listen(stubPort, '127.0.0.1', r));

/* ── an isolated app instance ────────────────────────────────────────────── */

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-route-parity-'));
/*
 * TWO PASSES, because the first one could not have caught the bug it exists for.
 *
 * With a bare config the only fields on the wire are messages, model, tools and
 * tool_choice — so "0 drift" said nothing about `reasoning_effort`, which is
 * precisely the field that landed on one route and not the other earlier today.
 * A comparison is only as wide as the keys it walked.
 *
 *   --params  puts temperature and reasoningEffort on the wire (both are real
 *             ai.json knobs, `parseAiParams` in provider.ts) so the drift check
 *             covers the params path as well as the prompt path.
 */
const WITH_PARAMS = process.argv.includes('--params');
fs.writeFileSync(
  path.join(userDir, 'ai.json'),
  JSON.stringify({
    provider: 'openai-compatible',
    model: 'stub-model',
    baseUrl: `http://127.0.0.1:${stubPort}/v1`,
    apiKey: 'stub',
    ...(WITH_PARAMS ? { params: { temperature: 0, reasoningEffort: 'low' } } : {}),
  }),
);
/* Trusted, so the run exercises the ordinary path rather than the gated one.
   Both routes see the same state either way; this only makes it realistic. */
fs.writeFileSync(
  path.join(userDir, 'repo-trust.json'),
  JSON.stringify({ version: 1, trusted: [fs.realpathSync(MAKEMORE)] }),
);

const appPort = await freePort();
const app = spawn(process.execPath, [CLI, 'app', '--repo', MAKEMORE, '--port', String(appPort), '--no-open'], {
  cwd: ROOT,
  env: { ...process.env, SEQUENCE_USER_DIR: userDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
app.stdout.on('data', (d) => (appLog += d));
app.stderr.on('data', (d) => (appLog += d));

const base = `http://127.0.0.1:${appPort}`;
let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(2000) });
    up = res.ok;
  } catch {
    /* still starting */
  }
}
if (!up) {
  console.error(`route-parity: the app did not come up on ${appPort}\n${appLog.slice(-1500)}`);
  app.kill();
  stub.close();
  process.exit(2);
}
console.log(`app on ${appPort} (isolated user dir), stub provider on ${stubPort}`);
console.log(`config: ${WITH_PARAMS ? 'WITH params (temperature 0, reasoningEffort low)' : 'bare (no params block)'}`);
console.log(`asking ${ASKS.length} plain questions on examples/makemore, both routes\n`);

/* ── the two routes ──────────────────────────────────────────────────────── */

async function callRoute(route, question, id) {
  captured = [];
  tag = `${route}:${id}`;
  const started = Date.now();
  let status = 0;
  let text = '';
  let error = null;
  try {
    const res = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(120_000),
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { calls: captured.slice(), status, ms: Date.now() - started, error, bytes: text.length, text };
}

/**
 * What counts as the same request.
 *
 * `stream` is EXPECTED to differ — one route streams and the other does not, and
 * flagging it would bury the finding this is looking for. Everything else is
 * compared, including the message text, the model, and every sampling parameter.
 */
function shape(body) {
  const { stream, stream_options: _so, ...rest } = body ?? {};
  void stream;
  return rest;
}

const rows = [];
/* Which fields '0 drift' actually covers. Recorded rather than described:
   a comparison is only as wide as the keys it walked. */
const comparedKeys = new Set();
for (const ask of ASKS) {
  const a = await callRoute('/api/ask', ask.question, ask.id);
  const b = await callRoute('/api/ask/stream', ask.question, ask.id);

  const aFirst = a.calls[0]?.body;
  const bFirst = b.calls[0]?.body;
  let drift = null;
  if (aFirst === undefined || bFirst === undefined) {
    drift = aFirst === undefined && bFirst === undefined ? null : 'one route made no provider call';
  } else {
    const sa = shape(aFirst);
    const sb = shape(bFirst);
    const keys = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].sort();
    for (const k of keys) comparedKeys.add(k);
    const differing = keys.filter((k) => JSON.stringify(sa[k]) !== JSON.stringify(sb[k]));
    if (differing.length > 0) {
      drift = differing
        .map((k) => {
          if (k === 'messages') {
            const ta = sa.messages?.[0]?.content ?? '';
            const tb = sb.messages?.[0]?.content ?? '';
            return `messages (${ta.length} vs ${tb.length} chars)`;
          }
          return `${k} (${JSON.stringify(sa[k])} vs ${JSON.stringify(sb[k])})`;
        })
        .join(', ');
    }
  }

  rows.push({
    id: ask.id,
    askCalls: a.calls.length,
    streamCalls: b.calls.length,
    askStatus: a.status,
    streamStatus: b.status,
    askError: a.error,
    streamError: b.error,
    drift,
    askMs: a.ms,
    streamMs: b.ms,
  });
  const flag = drift ? `  DRIFT: ${drift}` : '';
  console.log(
    `  ${ask.id}  /api/ask ${a.status} ${a.calls.length} call(s) ${a.ms}ms  ·  /stream ${b.status} ${b.calls.length} call(s) ${b.ms}ms${flag}`,
  );
}

/*
 * ── THE FALSIFICATION CONTROL ─────────────────────────────────────────────
 *
 * "0 of 20 drifted" is worth nothing until the detector is shown to detect. A
 * comparison that always returns "same" reports a clean result on a broken
 * product, and this repository has shipped that mistake before — a fake gate
 * that mirrored both sides and could not fail.
 *
 * So: ask ONE route two DIFFERENT questions and compare those. The detector must
 * report drift. If it does not, the twenty zeroes above are void and say so.
 */
const c1 = await callRoute('/api/ask', ASKS[0].question, 'control-a');
const c2 = await callRoute('/api/ask', ASKS[9].question, 'control-b');
let controlDrift = null;
if (c1.calls[0] && c2.calls[0]) {
  const sa = shape(c1.calls[0].body);
  const sb = shape(c2.calls[0].body);
  const differing = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].filter(
    (k) => JSON.stringify(sa[k]) !== JSON.stringify(sb[k]),
  );
  controlDrift = differing.length > 0 ? differing.join(', ') : null;
}

app.kill();
stub.close();

/* ── the report ──────────────────────────────────────────────────────────── */

const bad = (r) => r.askStatus >= 400 || r.streamStatus >= 400 || r.askError || r.streamError;
const crashed = rows.filter(bad);
const drifted = rows.filter((r) => r.drift !== null);
const totalCalls = rows.reduce((a, r) => a + r.askCalls + r.streamCalls, 0);
const turns = rows.length * 2;

console.log('');
console.log(`turns                 ${turns}  (${rows.length} asks x 2 routes)`);
console.log(`crashes / non-2xx     ${crashed.length}`);
console.log(`provider calls        ${totalCalls}  (${(totalCalls / turns).toFixed(2)} per turn)`);
console.log(`turns with NO call    ${rows.filter((r) => r.askCalls === 0 || r.streamCalls === 0).length}`);
console.log(`fields compared        ${[...comparedKeys].sort().join(', ')}`);
console.log(`fields NOT compared    stream, stream_options (expected to differ by route)`);
console.log(`ASSEMBLY DRIFT        ${drifted.length} of ${rows.length} asks`);
console.log(
  controlDrift === null
    ? '  CONTROL FAILED — two different questions compared as identical. The zero above is VOID.'
    : `  control: two different questions DO differ (${controlDrift}) — the detector detects`,
);
for (const r of drifted) console.log(`   ${r.id}: ${r.drift}`);
if (crashed.length > 0) for (const r of crashed) console.log(`   ${r.id}: ask ${r.askStatus} ${r.askError ?? ''} · stream ${r.streamStatus} ${r.streamError ?? ''}`);

const out = path.join(HERE, 'out', WITH_PARAMS ? 'route-parity-params.json' : 'route-parity.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({ config: WITH_PARAMS ? 'params' : 'bare', asks: rows.length, turns, totalCalls, crashed: crashed.length, drifted: drifted.length, controlDrift, comparedKeys: [...comparedKeys].sort(), rows }, null, 2)}\n`);
console.log(`\nwritten: ${path.relative(ROOT, out)}`);
fs.rmSync(userDir, { recursive: true, force: true });
process.exitCode = 0;
