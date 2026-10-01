import assert from 'node:assert';
import http from 'node:http';
import { test } from 'node:test';
import {
  ReasoningOnlyError,
  StreamDeltaAccumulator,
  generateText,
  generateTextStream,
  type AiConfig,
} from '../server/provider.js';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * IT THOUGHT, AND IT SAID NOTHING
 *
 * MEASURED, Ollama 0.33.2, 2026-09-18. A thinking model (qwen3.5:4b, the
 * deepseek family) asked through `/v1/chat/completions` answers with
 * `message.content: ""` and the whole reply in `message.reasoning`, and
 * `finish_reason: length` once max_tokens has been spent thinking. One real
 * turn — 6,746 tokens in, 0 out, 27 seconds of wall time — reached the reader
 * as "I did not produce an answer", with the model's actual words on the floor
 * and every downstream honesty field reporting success.
 *
 * THIS WAS NOT AN OVERSIGHT, WHICH IS WHY IT NEEDS A TEST. `provider.ts` said
 * out loud that it dropped `reasoning_content` on purpose: reading it on the
 * streamed path alone would have made the two paths answer differently. The
 * PARITY argument was right; the conclusion — that parity required dropping it
 * — was not. Both paths now read it into a channel that is not the answer, and
 * these lock that both halves of that sentence hold:
 *
 *   1. reasoning is NEVER returned as text, on either path;
 *   2. a turn that produced only reasoning REFUSES rather than returning '';
 *   3. the refusal is retried ONCE with `reasoning_effort: none`, which is what
 *      makes the same model answer (measured: 35 tokens, finish_reason stop);
 *   4. a reader's own reasoning-effort setting is never overridden;
 *   5. the anthropic wire is untouched.
 *
 * Every server below is a real localhost HTTP hop, so fetch, chunk boundaries,
 * SSE framing and UTF-8 decoding are exercised as the live path exercises them.
 * ══════════════════════════════════════════════════════════════════════════
 */

interface Plan {
  status?: number;
  contentType?: string;
  body: string;
}

interface Server {
  baseUrl: string;
  requests: unknown[];
  close: () => Promise<void>;
}

async function startServer(plan: (body: unknown, n: number) => Plan): Promise<Server> {
  const requests: unknown[] = [];
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
      requests.push(body);
      const p = plan(body, requests.length - 1);
      res.statusCode = p.status ?? 200;
      res.setHeader('content-type', p.contentType ?? 'application/json');
      res.end(p.body);
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
const cfg = (baseUrl: string, params?: AiConfig['params']): AiConfig => ({
  provider: 'openai-compatible',
  model: 'qwen3.5:4b',
  apiKey: KEY,
  baseUrl,
  ...(params ? { params } : {}),
});

/** The exact buffered shape Ollama returns for a thinking model. */
const THINKING_BODY = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '', reasoning: 'Let me work through this. '.repeat(4) },
      finish_reason: 'length',
    },
  ],
  usage: { prompt_tokens: 6746, completion_tokens: 0 },
});

/** What the same model returns once `reasoning_effort: none` is on the wire. */
const ANSWER_BODY = JSON.stringify({
  id: 'chatcmpl-2',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content: 'The ledger owns it.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 6746, completion_tokens: 35 },
});

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/* ───────────────────────── the accumulator, in isolation ───────────────── */

test('LOCK: streamed reasoning is accumulated as thinking and never as the answer', () => {
  /*
   * `reasoning` is Ollama's spelling and `reasoning_content` is DeepSeek's.
   * Reading one and not the other is a bug on the other's server, so both are
   * read — and NEITHER reaches `text`.
   */
  const heard: string[] = [];
  const acc = new StreamDeltaAccumulator('openai-compatible', (d) => heard.push(d));
  const emitted = [
    ...acc.push(JSON.stringify({ choices: [{ index: 0, delta: { reasoning: 'first ' } }] })),
    ...acc.push(JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'second' } }] })),
    ...acc.push(
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }),
    ),
  ];

  assert.equal(acc.text, '', 'thinking must never become the answer');
  assert.deepEqual(emitted, [], 'thinking is not a text delta');
  assert.equal(acc.reasoningText, 'first second');
  assert.deepEqual(heard, ['first ', 'second'], 'a listener hears it as it arrives');
  assert.equal(acc.finishReason, 'length', 'finish_reason was read for the first time');
  /*
   * A turn that only ever thought did NOT carry a text part. Claiming it did
   * would hand the caller an empty answer with no explanation — the silence
   * this repair exists to end.
   */
  assert.equal(acc.sawTextPart, false);
});

test('LOCK: a turn that answered keeps its answer, however much it thought first', () => {
  const acc = new StreamDeltaAccumulator('openai-compatible');
  acc.push(JSON.stringify({ choices: [{ index: 0, delta: { reasoning: 'hmm' } }] }));
  const out = acc.push(JSON.stringify({ choices: [{ index: 0, delta: { content: 'yes' } }] }));

  assert.deepEqual(out, ['yes']);
  assert.equal(acc.text, 'yes', 'the answer is exactly the content deltas');
  assert.equal(acc.reasoningText, 'hmm');
  assert.equal(acc.sawTextPart, true);
});

/* ──────────────────────────── the buffered path ────────────────────────── */

test('LOCK: a reasoning-only reply is RETRIED once without reasoning, and answers', async () => {
  /*
   * THE MEASURED TURN. Attempt one is the shape Ollama actually returned;
   * attempt two is what the same model says when `reasoning_effort: none` is on
   * the wire. Before this, attempt one returned `text: ''` and there was no
   * attempt two.
   */
  const srv = await startServer((_b, n) => ({ body: n === 0 ? THINKING_BODY : ANSWER_BODY }));
  try {
    const text = await generateText(cfg(srv.baseUrl), 'who owns the ledger?');
    assert.equal(text, 'The ledger owns it.');
    assert.equal(srv.requests.length, 2, 'exactly one extra attempt, never a loop');

    const first = srv.requests[0] as Record<string, unknown>;
    const second = srv.requests[1] as Record<string, unknown>;
    /*
     * NOT SENT BY DEFAULT. This file's own rule is that a blank knob is OMITTED
     * from the body, because several OpenAI-compatible servers answer 400 to a
     * field they did not expect. The field only ever reaches a server that has
     * already proved it understands reasoning by producing some.
     */
    assert.equal('reasoning_effort' in first, false, 'attempt 1 body is byte-identical to before');
    assert.equal(second.reasoning_effort, 'none', 'attempt 2 turns the thinking off');
  } finally {
    await srv.close();
  }
});

test('LOCK: when it thinks twice, the refusal names the cause and the fix', async () => {
  /* A model that will not stop thinking is not weather: the reader gets the one
     sentence that says what to change, not "I did not produce an answer". */
  const srv = await startServer(() => ({ body: THINKING_BODY }));
  try {
    await assert.rejects(
      () => generateText(cfg(srv.baseUrl), 'q'),
      (e: unknown) => {
        assert.ok(e instanceof ReasoningOnlyError, 'a subclass, so callers branch on the TYPE');
        assert.equal(e.finishReason, 'length', 'read for the first time, and it is the point');
        assert.ok(e.reasoningChars > 0);
        assert.match(e.message, /reasoning/i);
        assert.match(e.message, /Reasoning effort to none|Max output tokens/);
        return true;
      },
    );
    assert.equal(srv.requests.length, 2, 'retried once, then stopped');
  } finally {
    await srv.close();
  }
});

test('LOCK: a reader who ASKED for reasoning is never overridden', async () => {
  /* Someone who set `high` gets high and the honest error. Silently rewriting a
     setting the reader chose would be the product deciding on their behalf. */
  const srv = await startServer(() => ({ body: THINKING_BODY }));
  try {
    await assert.rejects(
      () => generateText(cfg(srv.baseUrl, { reasoningEffort: 'high' }), 'q'),
      ReasoningOnlyError,
    );
    assert.equal(srv.requests.length, 1, 'no second attempt when the knob was the reader s');
    assert.equal((srv.requests[0] as Record<string, unknown>).reasoning_effort, 'high');
  } finally {
    await srv.close();
  }
});

test('LOCK: an ordinary empty reply is still the OTHER fault, with its own message', async () => {
  /*
   * A genuinely empty reply with NO thinking is a different failure with a
   * different fix. A reader told to turn reasoning off would be sent to change
   * a setting that was never the cause.
   */
  const srv = await startServer(() => ({
    body: JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant' } }] }),
  }));
  try {
    await assert.rejects(
      () => generateText(cfg(srv.baseUrl), 'q'),
      (e: unknown) => {
        assert.equal(e instanceof ReasoningOnlyError, false);
        assert.match((e as Error).message, /could not locate assistant text/);
        return true;
      },
    );
  } finally {
    await srv.close();
  }
});

/* ──────────────────────────── the streamed path ────────────────────────── */

test('LOCK: a streamed reasoning-only turn refuses too — the two paths agree', async () => {
  /*
   * PARITY IS THE WHOLE POINT. The old comment dropped reasoning precisely so
   * the streamed and buffered paths would not disagree; they now read the same
   * two fields into the same separate channel, so they still do not.
   */
  const srv = await startServer((_b, n) => ({
    contentType: 'text/event-stream',
    body:
      n === 0
        ? sse({ choices: [{ index: 0, delta: { reasoning: 'thinking hard' } }] }) +
          sse({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }) +
          'data: [DONE]\n\n'
        : sse({ choices: [{ index: 0, delta: { content: 'the answer' } }] }) + 'data: [DONE]\n\n',
  }));
  try {
    const deltas: string[] = [];
    const text = await generateTextStream(cfg(srv.baseUrl), 'q', (d) => deltas.push(d));
    assert.equal(text, 'the answer');
    /* NOT ONE DELTA reached the caller before the retry — which is the law every
       retry in this file obeys, and here it holds by construction. */
    assert.deepEqual(deltas, ['the answer']);
    assert.equal(srv.requests.length, 2);
  } finally {
    await srv.close();
  }
});

/* ───────────────────────────── the anthropic wire ──────────────────────── */

test('LOCK: the anthropic wire is untouched by any of this', async () => {
  /*
   * Anthropic's thinking arrives as `thinking` content blocks on its own wire,
   * which none of this reads. An empty anthropic reply keeps the message it has
   * always had, and no `reasoning_effort` is ever put on that body.
   */
  const acc = new StreamDeltaAccumulator('anthropic');
  acc.push(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x' } }));
  assert.equal(acc.text, '');
  assert.equal(acc.reasoningText, '', 'the anthropic branch feeds no reasoning channel');

  const srv = await startServer(() => ({ body: JSON.stringify({ content: [] }) }));
  try {
    await assert.rejects(
      () =>
        generateText(
          { provider: 'anthropic', model: 'claude-test', apiKey: KEY, baseUrl: srv.baseUrl },
          'q',
        ),
      (e: unknown) => {
        assert.equal(e instanceof ReasoningOnlyError, false);
        return true;
      },
    );
    assert.equal(srv.requests.length, 1, 'no reasoning retry on this wire');
  } finally {
    await srv.close();
  }
});
