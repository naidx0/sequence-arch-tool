import assert from 'node:assert';
import http from 'node:http';
import { test } from 'node:test';
import {
  generateText,
  generateTextStream,
  generateTextStreamWithUsage,
  generateTextWithUsage,
  ProviderError,
  SseFrameParser,
  StreamDeltaAccumulator,
  type AiConfig,
} from '../server/provider.js';

/**
 * WAVE 1 / ITEM 1.2 — token streaming at the provider boundary.
 *
 * The gap this locks (v2-architecture-and-gaps.md §3.5 G2, §5.1 P1): `provider.ts`
 * POSTed `{model, messages}` with no `stream:true` and read the whole body before
 * returning, so time-to-first-token was the FULL generation time on every ask.
 *
 * THE INVARIANT UNDER TEST is not "some callbacks fired". It is:
 *
 *     the text the provider layer returns IS the concatenation, in emission
 *     order, of the deltas it already handed the caller — character for
 *     character, with no terminal frame, no re-read, and no repair.
 *
 * That equality is what buys replay for free (ml-harness-adoption.md §1.1: its
 * stored assistant message is `"".join(text_parts)`, the exact concatenation of
 * the deltas it already committed). A design that reassembles the final answer
 * from a *different* source can disagree with what the user watched appear, and
 * the disagreement is invisible until a user reloads.
 *
 * Every server here is a real localhost HTTP hop, so fetch, chunk boundaries,
 * SSE framing, and UTF-8 decoding are all exercised exactly as the live path
 * would exercise them. No provider key exists in this build environment; that
 * boundary is documented in provider.ts and is unchanged by streaming.
 */

/* ------------------------------------------------------------ the mock server */

/** A chunk to write, or a number of milliseconds to pause before the next one. */
type Chunk = string | Buffer | number;

interface StreamPlan {
  status?: number;
  contentType?: string;
  chunks: Chunk[];
}

interface StreamServer {
  baseUrl: string;
  requests: Array<{ headers: http.IncomingHttpHeaders; body: unknown }>;
  close: () => Promise<void>;
}

async function startStreamServer(plan: (body: unknown) => StreamPlan): Promise<StreamServer> {
  const requests: StreamServer['requests'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        /* leave null */
      }
      requests.push({ headers: req.headers, body });
      const p = plan(body);
      res.statusCode = p.status ?? 200;
      res.setHeader('content-type', p.contentType ?? 'text/event-stream');
      void (async () => {
        for (const c of p.chunks) {
          if (typeof c === 'number') {
            await new Promise((r) => setTimeout(r, c));
            continue;
          }
          res.write(c);
        }
        res.end();
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const KEY = 'sk-TEST-not-a-real-key';

function anthropicCfg(baseUrl: string): AiConfig {
  return { provider: 'anthropic', model: 'claude-test', apiKey: KEY, baseUrl };
}
function openAiCfg(baseUrl: string): AiConfig {
  return { provider: 'openai-compatible', model: 'model-test', apiKey: KEY, baseUrl };
}

/** One Anthropic SSE event, framed the way the real wire frames it. */
function anthropicFrame(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}
/** One OpenAI-compatible SSE chunk. */
function openAiFrame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
function openAiTextFrame(text: string): string {
  return openAiFrame({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  });
}

/* ------------------------------------------------ THE LOCKING TEST — both wires */

test('LOCK: an anthropic streamed call emits >=2 deltas before the result, and their concatenation IS the returned text', async () => {
  const pieces = ['The ', 'gateway ', 'calls ', 'the ', 'ledger.'];
  const srv = await startStreamServer(() => ({
    chunks: [
      anthropicFrame('message_start', {
        message: { id: 'msg_1', role: 'assistant', content: [], usage: { input_tokens: 120, output_tokens: 1 } },
      }),
      anthropicFrame('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ...pieces.map((t) => anthropicFrame('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } })),
      anthropicFrame('content_block_stop', { index: 0 }),
      anthropicFrame('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } }),
      anthropicFrame('message_stop', {}),
    ],
  }));
  try {
    const deltas: string[] = [];
    let resolved = false;
    let lateDelta = false;
    const text = await generateTextStream(anthropicCfg(srv.baseUrl), 'q', (d) => {
      if (resolved) lateDelta = true;
      deltas.push(d);
    });
    resolved = true;

    assert.ok(deltas.length >= 2, `expected >=2 deltas before the result, got ${deltas.length}`);
    assert.strictEqual(lateDelta, false, 'every delta must arrive before the result resolves');
    // The invariant. Not "looks right" — identical.
    assert.strictEqual(deltas.join(''), text);
    assert.strictEqual(text, pieces.join(''));
  } finally {
    await srv.close();
  }
});

test('LOCK: an openai-compatible streamed call emits >=2 deltas before the result, and their concatenation IS the returned text', async () => {
  const pieces = ['packages/', 'analyzer ', 'imports ', 'packages/schema.'];
  const srv = await startStreamServer(() => ({
    chunks: [
      ...pieces.map(openAiTextFrame),
      openAiFrame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ],
  }));
  try {
    const deltas: string[] = [];
    let resolved = false;
    let lateDelta = false;
    const text = await generateTextStream(openAiCfg(srv.baseUrl), 'q', (d) => {
      if (resolved) lateDelta = true;
      deltas.push(d);
    });
    resolved = true;

    assert.ok(deltas.length >= 2, `expected >=2 deltas before the result, got ${deltas.length}`);
    assert.strictEqual(lateDelta, false, 'every delta must arrive before the result resolves');
    assert.strictEqual(deltas.join(''), text);
    assert.strictEqual(text, pieces.join(''));
  } finally {
    await srv.close();
  }
});

/* ----------------------------------------- the point of streaming: TTFT is not TTLT */

test('time-to-first-token is the first frame, not the whole generation', async () => {
  // The server hands over one delta immediately and then stalls for 400 ms before
  // finishing. Pre-streaming, the caller saw NOTHING until the stall was over —
  // that is exactly gap P1. The assertion is the relationship, not a wall-clock
  // constant: first token must land well before the answer completes.
  const srv = await startStreamServer(() => ({
    chunks: [
      openAiTextFrame('first '),
      400,
      openAiTextFrame('and '),
      openAiTextFrame('last'),
      'data: [DONE]\n\n',
    ],
  }));
  try {
    const started = Date.now();
    let firstDeltaMs = -1;
    const deltas: string[] = [];
    const text = await generateTextStream(openAiCfg(srv.baseUrl), 'q', (d) => {
      if (firstDeltaMs < 0) firstDeltaMs = Date.now() - started;
      deltas.push(d);
    });
    const totalMs = Date.now() - started;
    assert.ok(firstDeltaMs >= 0, 'no delta arrived at all');
    assert.ok(totalMs >= 400, `the mock must actually stall; total was ${totalMs}ms`);
    assert.ok(
      firstDeltaMs < totalMs - 300,
      `first token at ${firstDeltaMs}ms should precede completion at ${totalMs}ms by the stall`,
    );
    assert.ok(firstDeltaMs < 1500, `TTFT must be under 1.5s (build item 1.2); was ${firstDeltaMs}ms`);
    assert.strictEqual(deltas.join(''), text);
  } finally {
    await srv.close();
  }
});

/* ------------------------------------------------- the non-streaming path is intact */

test('no onDelta ⇒ the request body carries NO stream flag and the old path answers unchanged', async () => {
  const srv = await startStreamServer(() => ({
    contentType: 'application/json',
    chunks: [JSON.stringify({ content: [{ type: 'text', text: 'plain answer' }], usage: { input_tokens: 7, output_tokens: 3 } })],
  }));
  try {
    const text = await generateText(anthropicCfg(srv.baseUrl), 'q');
    assert.strictEqual(text, 'plain answer');
    const body = srv.requests[0].body as Record<string, unknown>;
    assert.ok(!('stream' in body), 'a non-streaming call must not put `stream` on the wire');
    assert.ok(!('stream_options' in body), 'a non-streaming call must not put `stream_options` on the wire');
    assert.strictEqual(body.model, 'claude-test');
    assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'q' }]);
    // Usage still comes from the provider, not an estimate.
    assert.ok(!('accept' in srv.requests[0].headers) || srv.requests[0].headers.accept !== 'text/event-stream');
  } finally {
    await srv.close();
  }
});

test('onDelta ⇒ the request body carries stream:true and asks for the SSE content type', async () => {
  const srv = await startStreamServer(() => ({
    chunks: [openAiTextFrame('a'), openAiTextFrame('b'), 'data: [DONE]\n\n'],
  }));
  try {
    await generateTextStream(openAiCfg(srv.baseUrl), 'q', () => {});
    const req = srv.requests[0];
    assert.strictEqual((req.body as Record<string, unknown>).stream, true);
    assert.strictEqual(req.headers.accept, 'text/event-stream');
  } finally {
    await srv.close();
  }
});

/* ------------------------------------------------------- honest failure, not silence */

test('a provider that ignores stream:true and returns whole JSON still answers, as one delta', async () => {
  // Real local servers do this. Reporting "empty answer" for a full one would be
  // the failure ml-harness names: failing silently, in the direction that hurts.
  const srv = await startStreamServer(() => ({
    contentType: 'application/json',
    chunks: [JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'not streamed at all' } }] })],
  }));
  try {
    const deltas: string[] = [];
    const text = await generateTextStream(openAiCfg(srv.baseUrl), 'q', (d) => deltas.push(d));
    assert.strictEqual(text, 'not streamed at all');
    assert.strictEqual(deltas.join(''), text, 'the concatenation invariant holds on the fallback path too');
  } finally {
    await srv.close();
  }
});

test('an error frame ON the stream is reported, never returned as an empty answer', async () => {
  const srv = await startStreamServer(() => ({
    chunks: [
      anthropicFrame('message_start', { message: { id: 'm', role: 'assistant', content: [] } }),
      anthropicFrame('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }),
    ],
  }));
  try {
    await assert.rejects(
      () => generateTextStream(anthropicCfg(srv.baseUrl), 'q', () => {}),
      (e: unknown) => e instanceof ProviderError && /Overloaded/.test((e as Error).message),
    );
  } finally {
    await srv.close();
  }
});

test('an HTTP error on a streamed request keeps its status and provider body', async () => {
  const srv = await startStreamServer(() => ({
    status: 429,
    contentType: 'application/json',
    chunks: [JSON.stringify({ error: { message: 'slow down' } })],
  }));
  try {
    await assert.rejects(
      () => generateTextStream(openAiCfg(srv.baseUrl), 'q', () => {}),
      (e: unknown) =>
        e instanceof ProviderError && e.status === 429 && /slow down/.test(e.body ?? ''),
    );
  } finally {
    await srv.close();
  }
});

/* ------------------------------------------------ never parse tool calls out of prose */

test('a tool_use block interleaved in the stream never leaks into the prose text', async () => {
  // ml-harness-adoption.md §1.2: "We never emulate tool calling by parsing JSON
  // out of prose." The accumulator is index-keyed precisely so a tool block's
  // input_json_delta cannot be mistaken for an answer.
  const srv = await startStreamServer(() => ({
    chunks: [
      anthropicFrame('message_start', { message: { id: 'm', role: 'assistant', content: [] } }),
      anthropicFrame('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      anthropicFrame('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Let me look. ' } }),
      anthropicFrame('content_block_stop', { index: 0 }),
      anthropicFrame('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'read_file' } }),
      anthropicFrame('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts"}' } }),
      anthropicFrame('content_block_stop', { index: 1 }),
      anthropicFrame('content_block_start', { index: 2, content_block: { type: 'text', text: '' } }),
      anthropicFrame('content_block_delta', { index: 2, delta: { type: 'text_delta', text: 'Done.' } }),
      anthropicFrame('content_block_stop', { index: 2 }),
      anthropicFrame('message_stop', {}),
    ],
  }));
  try {
    const deltas: string[] = [];
    const text = await generateTextStream(anthropicCfg(srv.baseUrl), 'q', (d) => deltas.push(d));
    assert.strictEqual(text, 'Let me look. Done.');
    assert.ok(!text.includes('partial_json'));
    assert.ok(!text.includes('a.ts'), 'tool arguments must never appear in the answer text');
    assert.strictEqual(deltas.join(''), text);
  } finally {
    await srv.close();
  }
});

/* ------------------------------- a wordless turn is reported on BOTH paths, alike */

test('a tool-calls-only turn returns structured toolRequests (B2.2 openai)', async () => {
  // Before B2.2 this threw "could not locate assistant text". Native tool_calls
  // ARE the answer — fence salvage stays the belt when tools are absent.
  const buffered = await startStreamServer(() => ({
    contentType: 'application/json',
    chunks: [
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
                },
              ],
            },
          },
        ],
      }),
    ],
  }));
  const streamed = await startStreamServer(() => ({
    chunks: [
      openAiFrame({
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'c1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":' },
                },
              ],
            },
          },
        ],
      }),
      openAiFrame({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }],
            },
          },
        ],
      }),
      openAiFrame({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ],
  }));
  try {
    const buf = await generateTextWithUsage(openAiCfg(buffered.baseUrl), 'q');
    assert.strictEqual(buf.text, '');
    assert.deepEqual(buf.toolRequests, [
      { id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
    ]);

    const stream = await generateTextStreamWithUsage(openAiCfg(streamed.baseUrl), 'q', () => {});
    assert.strictEqual(stream.text, '');
    assert.deepEqual(stream.toolRequests, [
      { id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
    ]);
  } finally {
    await buffered.close();
    await streamed.close();
  }
});

test('a wordless turn with neither text nor tool_calls is still reported', async () => {
  // The buffered reader throws here when there is no text AND no tool_calls.
  const buffered = await startStreamServer(() => ({
    contentType: 'application/json',
    chunks: [
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: null } }],
      }),
    ],
  }));
  const streamed = await startStreamServer(() => ({
    chunks: [
      openAiFrame({ choices: [{ index: 0, delta: { role: 'assistant' } }] }),
      openAiFrame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ],
  }));
  try {
    const wanted = (e: unknown) =>
      e instanceof ProviderError && /could not locate assistant text/.test((e as Error).message);
    await assert.rejects(() => generateText(openAiCfg(buffered.baseUrl), 'q'), wanted);
    await assert.rejects(() => generateTextStream(openAiCfg(streamed.baseUrl), 'q', () => {}), wanted);
  } finally {
    await buffered.close();
    await streamed.close();
  }
});

test('a genuinely EMPTY text part still returns "" — absent and empty are different facts', async () => {
  const srv = await startStreamServer(() => ({
    chunks: [
      openAiFrame({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] }),
      openAiFrame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ],
  }));
  try {
    const deltas: string[] = [];
    const text = await generateTextStream(openAiCfg(srv.baseUrl), 'q', (d) => deltas.push(d));
    assert.strictEqual(text, '');
    assert.deepStrictEqual(deltas, [], 'an empty delta is not worth a callback');
    assert.strictEqual(deltas.join(''), text);
  } finally {
    await srv.close();
  }
});

/* ------------------------------------------------------------- framing robustness */

test('SSE framing survives split chunks, CRLF, comments and multi-line data', async () => {
  // The wire does not respect frame boundaries. A frame split across two TCP
  // writes, a keep-alive comment, CRLF line endings, and a data payload spread
  // over two `data:` lines are all legal SSE and all appear in the wild.
  const one = openAiTextFrame('alpha ');
  const head = one.slice(0, 12);
  const tail = one.slice(12);
  // A pretty-printed payload is emitted as one `data:` line PER LINE of JSON.
  // The spec joins those with "\n", which reconstitutes the document exactly —
  // and is why the parser must join the lines rather than parse each one alone.
  const pretty = JSON.stringify({ choices: [{ index: 0, delta: { content: 'omega' } }] }, null, 2);
  assert.ok(pretty.split('\n').length > 3, 'the multi-line case needs a genuinely multi-line payload');
  const multiLine = pretty.split('\n').map((l) => `data: ${l}`).join('\n') + '\n\n';
  const srv = await startStreamServer(() => ({
    chunks: [
      ': keep-alive\n\n',
      head,
      tail,
      // CRLF framing
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'beta ' } }] })}\r\n\r\n`,
      multiLine,
      'data: [DONE]\n\n',
    ],
  }));
  try {
    const deltas: string[] = [];
    const text = await generateTextStream(openAiCfg(srv.baseUrl), 'q', (d) => deltas.push(d));
    assert.strictEqual(text, 'alpha beta omega');
    assert.strictEqual(deltas.join(''), text);
  } finally {
    await srv.close();
  }
});

test('a multi-byte character split across two chunks is not corrupted', async () => {
  const frame = Buffer.from(openAiTextFrame('héllo — 世界'), 'utf8');
  // Cut inside the multi-byte run. A naive per-chunk toString() yields U+FFFD here.
  const cut = frame.indexOf(Buffer.from('—', 'utf8')) + 1;
  const srv = await startStreamServer(() => ({
    chunks: [frame.subarray(0, cut), frame.subarray(cut), 'data: [DONE]\n\n'],
  }));
  try {
    const deltas: string[] = [];
    const text = await generateTextStream(openAiCfg(srv.baseUrl), 'q', (d) => deltas.push(d));
    assert.ok(!text.includes('�'), `decoder corrupted the text: ${JSON.stringify(text)}`);
    assert.strictEqual(text, 'héllo — 世界');
    assert.strictEqual(deltas.join(''), text);
  } finally {
    await srv.close();
  }
});

/* ---------------------------------------------------------------------- usage */

test('provider-reported usage is picked up from the stream frames (anthropic)', async () => {
  const srv = await startStreamServer(() => ({
    chunks: [
      anthropicFrame('message_start', {
        message: { id: 'm', role: 'assistant', content: [], usage: { input_tokens: 1200, output_tokens: 1 } },
      }),
      anthropicFrame('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      anthropicFrame('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } }),
      anthropicFrame('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 88 } }),
      anthropicFrame('message_stop', {}),
    ],
  }));
  try {
    const { text, providerUsage } = await generateTextStreamWithUsage(anthropicCfg(srv.baseUrl), 'q', () => {});
    assert.strictEqual(text, 'ok');
    assert.strictEqual(providerUsage?.inputTokens, 1200);
    assert.strictEqual(providerUsage?.outputTokens, 88, 'the message_delta output count must win over message_start');
  } finally {
    await srv.close();
  }
});

test('generateTextWithUsage forwards an AbortSignal to fetch', async () => {
  const ac = new AbortController();
  const srv = await startStreamServer(() => ({
    contentType: 'application/json',
    chunks: [JSON.stringify({ content: [{ type: 'text', text: 'never' }], usage: { input_tokens: 1, output_tokens: 1 } })],
  }));
  try {
    const seen: AbortSignal[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.signal) seen.push(init.signal);
      return origFetch(input, init);
    }) as typeof fetch;

    ac.abort();
    await assert.rejects(
      () => generateTextWithUsage(anthropicCfg(srv.baseUrl), 'q', { signal: ac.signal }),
      (e: unknown) =>
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError'),
    );
    assert.strictEqual(seen.length, 1, 'fetch must receive the abort signal');
    assert.strictEqual(seen[0], ac.signal);
    globalThis.fetch = origFetch;
  } finally {
    await srv.close();
  }
});

test('generateTextWithUsage still takes two arguments and still does not stream', async () => {
  const srv = await startStreamServer(() => ({
    contentType: 'application/json',
    chunks: [JSON.stringify({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 5, output_tokens: 2 } })],
  }));
  try {
    const { text, providerUsage } = await generateTextWithUsage(anthropicCfg(srv.baseUrl), 'q');
    assert.strictEqual(text, 'hi');
    assert.strictEqual(providerUsage?.inputTokens, 5);
    assert.ok(!('stream' in (srv.requests[0].body as Record<string, unknown>)));
  } finally {
    await srv.close();
  }
});

test('openai-compatible asks attach tools when opts.tools is set (B2.2)', async () => {
  const srv = await startStreamServer(() => ({
    contentType: 'application/json',
    chunks: [
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
    ],
  }));
  try {
    await generateTextWithUsage(openAiCfg(srv.baseUrl), 'q', {
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
        },
      ],
    });
    const body = srv.requests[0]!.body as Record<string, unknown>;
    assert.ok(Array.isArray(body.tools), 'tools must be on the wire');
    assert.equal(body.tool_choice, 'auto');
    assert.equal((body.tools as { function: { name: string } }[])[0]!.function.name, 'read_file');
  } finally {
    await srv.close();
  }
});

/* ------------------------------------------------------- the pure pieces, directly */

test('SseFrameParser: fields other than `data` are ignored and a trailing frame flushes', () => {
  const p = new SseFrameParser();
  assert.deepStrictEqual(p.push('event: x\nid: 7\nretry: 100\ndata: one\n\n'), ['one']);
  assert.deepStrictEqual(p.push('data: two'), []);
  assert.deepStrictEqual(p.end(), ['two'], 'a frame without its terminating blank line must still flush');
});

test('StreamDeltaAccumulator: text() is exactly the concatenation of what push() returned', () => {
  const acc = new StreamDeltaAccumulator('openai-compatible');
  const emitted: string[] = [];
  for (const t of ['a', 'bb', '', 'ccc']) {
    emitted.push(...acc.push(JSON.stringify({ choices: [{ index: 0, delta: { content: t } }] })));
  }
  assert.deepStrictEqual(emitted, ['a', 'bb', 'ccc']);
  assert.strictEqual(acc.text, emitted.join(''));
});

test('StreamDeltaAccumulator: a second choice is accumulated but never emitted as the answer', () => {
  // `extractModelText` reads choices[0] on the non-streaming path. Emitting
  // another choice here would make the two paths disagree about what was said.
  const acc = new StreamDeltaAccumulator('openai-compatible');
  const emitted = [
    ...acc.push(JSON.stringify({ choices: [{ index: 0, delta: { content: 'primary' } }] })),
    ...acc.push(JSON.stringify({ choices: [{ index: 1, delta: { content: 'ALTERNATE' } }] })),
  ];
  assert.deepStrictEqual(emitted, ['primary']);
  assert.strictEqual(acc.text, 'primary');
});

test('StreamDeltaAccumulator: a malformed frame is counted, skipped, and never repaired', () => {
  const acc = new StreamDeltaAccumulator('openai-compatible');
  assert.deepStrictEqual(acc.push('{not json'), []);
  assert.strictEqual(acc.malformedFrames, 1);
  assert.strictEqual(acc.frames, 0);
  assert.deepStrictEqual(acc.push(JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' } }] })), ['ok']);
  assert.strictEqual(acc.text, 'ok');
});

test('openai-compat content as an ARRAY of text parts is assistant text, not an empty answer', async () => {
  // Measured on OpenRouter free-tier backends (2026-08-29): two SWE-bench turns
  // died with "could not locate assistant text" on exactly this shape.
  const srv = await startStreamServer(() => ({
    contentType: 'application/json',
    chunks: [
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: [
                { type: 'text', text: 'part one, ' },
                { type: 'text', text: 'part two' },
              ],
            },
          },
        ],
      }),
    ],
  }));
  try {
    const deltas: string[] = [];
    const text = await generateTextStream(openAiCfg(srv.baseUrl), 'q', (d) => deltas.push(d));
    assert.strictEqual(text, 'part one, part two');
    assert.strictEqual(deltas.join(''), text);
  } finally {
    await srv.close();
  }
});
