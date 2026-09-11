/**
 * NATIVE TOOLS ON THE ANTHROPIC WIRE.
 *
 * THE DEFECT THIS LOCKS. `provider.ts` attached tool definitions under
 * `if (wire === 'openai-compatible' && opts.tools …)` and parsed tool calls under
 * `wire === 'openai-compatible' ? extractOpenAiToolRequests(parsed) : []`. So a
 * user on claude-sonnet — the model most reliable at structured tool calling —
 * ran the entire agent loop on regex fence salvage, while a user on a local
 * granite4 got first-class native calls. `repoServer` built the definitions for
 * every attached repo either way and dropped them on the floor for anthropic.
 *
 * Model-agnosticism was inverted: which harness you got depended on a provider
 * choice made for unrelated reasons.
 *
 * WHY THESE FIXTURES. Every server here is a real localhost HTTP hop speaking
 * the REAL Anthropic Messages shapes — `content_block_start` carrying
 * `{type:'tool_use', id, name}` followed by `input_json_delta` fragments on the
 * streamed path, and a `content` array of blocks with `stop_reason:'tool_use'`
 * on the buffered one. A fixture that returned an OpenAI `tool_calls` array over
 * an anthropic config would pass while production stayed broken.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import {
  anthropicPromptContent,
  anthropicToolDefinitions,
  generateTextStreamWithUsage,
  generateTextWithUsage,
  type AiConfig,
} from '../server/provider.js';

interface Recorded {
  baseUrl: string;
  requests: unknown[];
  close: () => Promise<void>;
}

/** A localhost server that records the request body and replies with `plan`. */
async function serve(
  plan: { status?: number; contentType?: string; chunks: string[] },
): Promise<Recorded> {
  const requests: unknown[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        requests.push(null);
      }
      res.statusCode = plan.status ?? 200;
      res.setHeader('content-type', plan.contentType ?? 'application/json');
      for (const c of plan.chunks) res.write(c);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read one repository file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'repo-relative path' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
];

function anthropicCfg(baseUrl: string): AiConfig {
  return { provider: 'anthropic', baseUrl, model: 'claude-sonnet-4-5', apiKey: 'k' };
}

test('anthropic tool definitions come from the SAME array the openai wire is handed', () => {
  const defs = anthropicToolDefinitions(TOOLS);
  assert.deepEqual(defs, [
    {
      name: 'read_file',
      description: 'Read one repository file.',
      input_schema: TOOLS[0]!.function.parameters,
    },
  ]);
  /* The envelope goes away and the schema is renamed. Nothing else — a tool the
     openai wire can call and the anthropic wire cannot would be the exact
     asymmetry this exists to remove. */
  assert.equal(defs.length, TOOLS.length);
});

test('the anthropic request body CARRIES the tools (it used to drop them)', async () => {
  const srv = await serve({
    chunks: [JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })],
  });
  try {
    await generateTextWithUsage(anthropicCfg(srv.baseUrl), 'q', { tools: TOOLS });
  } finally {
    await srv.close();
  }
  const body = srv.requests[0] as Record<string, unknown>;
  assert.ok(Array.isArray(body.tools), 'anthropic body must carry tools');
  assert.deepEqual(body.tools, [
    {
      name: 'read_file',
      description: 'Read one repository file.',
      input_schema: TOOLS[0]!.function.parameters,
    },
  ]);
  /* `tool_choice` is deliberately ABSENT: absent is auto on this wire, and an
     omitted field is one fewer thing a proxy can reject. */
  assert.equal('tool_choice' in body, false);
  /* The openai envelope must NOT leak onto this wire. */
  assert.equal(JSON.stringify(body).includes('"parameters"'), false);
});

test('no tools supplied ⇒ the anthropic body is byte-identical to the pre-tools shape', async () => {
  const srv = await serve({
    chunks: [JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })],
  });
  try {
    await generateTextWithUsage(anthropicCfg(srv.baseUrl), 'q');
  } finally {
    await srv.close();
  }
  assert.deepEqual(srv.requests[0], {
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    messages: [{ role: 'user', content: 'q' }],
  });
});

test('a buffered tool_use reply becomes a tool request (it used to be dropped)', async () => {
  const srv = await serve({
    chunks: [
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me look.' },
          { type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { path: 'src/a.ts' } },
        ],
      }),
    ],
  });
  let out;
  try {
    out = await generateTextWithUsage(anthropicCfg(srv.baseUrl), 'q', { tools: TOOLS });
  } finally {
    await srv.close();
  }
  assert.equal(out.text, 'Let me look.');
  assert.deepEqual(out.toolRequests, [
    { id: 'toolu_01', name: 'read_file', args: { path: 'src/a.ts' } },
  ]);
});

test('a tool_use-only reply is an ANSWER, not "could not locate assistant text"', async () => {
  const srv = await serve({
    chunks: [
      JSON.stringify({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_02', name: 'read_file', input: { path: 'b.ts' } }],
      }),
    ],
  });
  let out;
  try {
    out = await generateTextWithUsage(anthropicCfg(srv.baseUrl), 'q', { tools: TOOLS });
  } finally {
    await srv.close();
  }
  /* Parity with the openai wire, which has treated a tool_calls-only turn as an
     answer since B2.2. Before this change the anthropic branch threw here. */
  assert.equal(out.text, '');
  assert.deepEqual(out.toolRequests, [
    { id: 'toolu_02', name: 'read_file', args: { path: 'b.ts' } },
  ]);
});

test('a STREAMED tool_use is assembled from its input_json_delta fragments', async () => {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9}}}\n\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Looking"}}\n\n',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_03","name":"read_file"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"src/c.ts\\"}"}}\n\n',
    'data: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
  ];
  const srv = await serve({ contentType: 'text/event-stream', chunks: frames });
  const deltas: string[] = [];
  let out;
  try {
    out = await generateTextStreamWithUsage(anthropicCfg(srv.baseUrl), 'q', (d) => deltas.push(d));
  } finally {
    await srv.close();
  }
  /* THE ARGUMENTS ARE NOT PROSE. `input_json_delta` must never reach onDelta —
     "we never emulate tool calling by parsing JSON out of prose" cuts both ways. */
  assert.deepEqual(deltas, ['Looking']);
  assert.equal(out.text, 'Looking');
  assert.deepEqual(out.toolRequests, [
    { id: 'toolu_03', name: 'read_file', args: { path: 'src/c.ts' } },
  ]);
});

test('a streamed tool_use with NO text part is still an answer', async () => {
  const frames = [
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_04","name":"read_file"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"d.ts\\"}"}}\n\n',
  ];
  const srv = await serve({ contentType: 'text/event-stream', chunks: frames });
  let out;
  try {
    out = await generateTextStreamWithUsage(anthropicCfg(srv.baseUrl), 'q', () => {});
  } finally {
    await srv.close();
  }
  assert.equal(out.text, '');
  assert.deepEqual(out.toolRequests, [
    { id: 'toolu_04', name: 'read_file', args: { path: 'd.ts' } },
  ]);
});

/* ==================================================== prompt caching (Wave 8) ===== */

test('anthropicPromptContent: no breakpoint ⇒ the plain string (pre-caching body, byte-identical)', () => {
  assert.equal(anthropicPromptContent('hello world'), 'hello world');
  assert.equal(anthropicPromptContent('hello world', 0), 'hello world');
});

test('anthropicPromptContent: a mid-prompt breakpoint splits into cached prefix + plain tail', () => {
  const content = anthropicPromptContent('PREFIXTAIL', 6);
  assert.deepEqual(content, [
    { type: 'text', text: 'PREFIX', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'TAIL' },
  ]);
});

test('anthropicPromptContent: breakpoint at/after the end marks the WHOLE prompt (round 1 writes the cache)', () => {
  assert.deepEqual(anthropicPromptContent('ALL', 3), [
    { type: 'text', text: 'ALL', cache_control: { type: 'ephemeral' } },
  ]);
  assert.deepEqual(anthropicPromptContent('ALL', 99), [
    { type: 'text', text: 'ALL', cache_control: { type: 'ephemeral' } },
  ]);
});

test('the anthropic request body carries the cache breakpoint as content blocks', async () => {
  const srv = await serve({
    chunks: [JSON.stringify({ content: [{ type: 'text', text: 'ok' }] })],
  });
  try {
    await generateTextWithUsage(anthropicCfg(srv.baseUrl), 'STABLEPREFIX--tail', {
      cacheBreakpointChars: 12,
    });
  } finally {
    await srv.close();
  }
  const body = srv.requests[0] as { messages: Array<{ role: string; content: unknown }> };
  assert.deepEqual(body.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'STABLEPREFIX', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: '--tail' },
      ],
    },
  ]);
});
