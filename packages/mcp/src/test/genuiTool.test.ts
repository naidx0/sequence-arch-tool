import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CORE_TOOLS, createServer } from '../index.js';
import { UI_DESCRIPTION, resetUISurfaces, uiTool } from '../genuiTools.js';

const body = (r: { content: { text: string }[] }): string => r.content[0]!.text;

test('ui: help returns the catalog', async () => {
  const r = await uiTool({ help: true }, {});
  assert.match(body(r), /Card/);
  assert.match(body(r), /TimelineItem/);
});

test('ui: lossless fixes are applied and reported, streaming leaves gaps open', async () => {
  resetUISurfaces();
  const r = await uiTool({ surface: 's', ops: '{"op":"el","id":"c","type":"card","props":{"title":"T"},"children":["b"]}' }, {});
  assert.equal(r.isError, undefined);
  assert.match(body(r), /-> Card/);
  assert.match(body(r), /1 elements/);
});

test('ui: an invalid finished pass is an error with diagnostics, then a patch makes it valid', async () => {
  resetUISurfaces();
  await uiTool({ surface: 's', ops: '{"op":"el","id":"c","type":"Card","props":{"title":"T"},"children":["b"]}\n{"op":"el","id":"b","type":"Button","props":{"label":"Go","action":{"name":"go"}}}' }, {});
  const bad = await uiTool({ surface: 's', done: true }, {});
  assert.equal(bad.isError, true);
  assert.match(body(bad), /UNDECLARED_ACTION/);
  const good = await uiTool({ surface: 's', ops: '{"op":"add","path":"/actions/go","value":{"description":"Go"}}', done: true }, {});
  assert.equal(good.isError, undefined, body(good));
  assert.match(body(good), /valid and final/);
});

test('ui: delivers accepted ops, and the final done, to the app over the local port', async () => {
  resetUISurfaces();
  const seen: { url: string; body: { surface: string; ops: unknown[]; done: boolean } }[] = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', body: JSON.parse(b) });
      res.end('{}');
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  const env = { SEQUENCE_GENUI_URL: `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/genui/ingest?session=chat-1&key=k` };
  try {
    await uiTool({ surface: 'x', ops: '{"op":"el","id":"t","type":"Text","props":{"text":"hi"}}' }, env);
    /* A finish with nothing new still has to be delivered: it is what ends the pass in the app. */
    await uiTool({ surface: 'x', done: true }, env);
  } finally {
    srv.closeAllConnections();
    await new Promise<void>((ok) => srv.close(() => ok()));
  }
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.url, '/api/genui/ingest?session=chat-1&key=k', 'the session and key in the URL are kept');
  assert.equal(seen[0]!.body.surface, 'x');
  assert.equal(seen[0]!.body.done, false);
  assert.equal(seen[1]!.body.done, true);
  assert.equal(seen[1]!.body.ops.length, 0);
});

test('ui is a core tool: a session Sequence starts lists it, in at most 125 tokens, and it points at ui({help:true}) for the catalog', async () => {
  assert.ok(CORE_TOOLS.includes('ui'));
  const server = createServer({ tools: 'core' });
  const [c, sv] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(sv), client.connect(c)]);
  try {
    const mine = (await client.listTools()).tools.filter((t) => t.name === 'ui');
    assert.equal(mine.length, 1);
    assert.ok(Math.ceil(JSON.stringify(mine).length / 4) <= 125, `ui lists at ${Math.ceil(JSON.stringify(mine).length / 4)} tokens`);
    assert.equal(mine[0]!.annotations?.readOnlyHint, false, 'it writes a surface into the chat');
  } finally {
    await client.close();
    await server.close();
  }
  assert.match(UI_DESCRIPTION, /help:\s*true/);
});

test('ui: past 200 elements the extra ops are dropped, and the agent is told what to do instead', async () => {
  resetUISurfaces();
  const lines = ['{"op":"el","id":"root","type":"Stack","props":{}}'];
  for (let i = 0; i < 230; i++) lines.push(JSON.stringify({ op: 'el', id: 'n' + i, type: 'Text', props: { text: 'row ' + i }, parent: 'root' }));
  const r = await uiTool({ surface: 'big', ops: lines.join('\n') }, {});
  assert.equal(r.isError, undefined, 'the first 200 landed');
  assert.match(body(r), /200 elements/);
  assert.match(body(r), /DROPPED: 31 ops dropped: a surface holds at most 200 elements/);
  assert.match(body(r), /summarise instead/);
});
