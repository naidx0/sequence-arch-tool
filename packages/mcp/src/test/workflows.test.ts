import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readWorkflow } from '@sequence/analyzer';
import { compileWorkflow, validateProgram } from '@sequence/schema';
import { createServer } from '../index.js';

/** ROUND 13 (A8): the chat agent edits the workflow graph through `edit_workflow`, in a default core session. */
test('a core session lists, creates and edits a workflow; the file the open tab polls changes; a refused edit changes nothing', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-core-workflows-'));
  const server = createServer({ tools: 'core', repo });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'workflows-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  const call = async (args: Record<string, unknown>) => {
    const r = await client.callTool({ name: 'edit_workflow', arguments: args });
    return { error: r.isError === true, body: (r.content as { text: string }[])[0]!.text };
  };
  try {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'edit_workflow')!;
    assert.equal(tool.annotations?.readOnlyHint, false, 'an edit is a write');
    assert.deepEqual(JSON.parse((await call({})).body), { workflows: [] });

    const made = JSON.parse((await call({ create: 'Fix until green' })).body).created;
    assert.equal(made.id, 'fix-until-green');
    assert.equal(made.valid, true);
    assert.deepEqual(made.blocks.map((b: { kind: string }) => b.kind), ['agent', 'checker', 'test', 'finish']);

    const edited = await call({
      workflow: 'Fix until green',
      ops: [
        { op: 'update', id: 'b1', agentRef: 'claude', model: 'claude-sonnet-5', title: 'Edit the failing code' },
        { op: 'add', kind: 'loop', at: 0, span: 3, maxIterations: 4 },
        { op: 'rename', name: 'Fix until green (looped)' },
      ],
    });
    assert.equal(edited.error, false, edited.body);
    const doc = readWorkflow(repo, 'fix-until-green')!;
    assert.equal(doc.name, 'Fix until green (looped)');
    assert.equal(doc.rev, made.rev + 1);
    assert.deepEqual(doc.blocks.map((b) => b.kind), ['loop', 'agent', 'checker', 'test', 'finish']);
    assert.deepEqual(validateProgram(compileWorkflow(doc)).errors, []);
    assert.equal(doc.blocks[1]!.model, 'claude-sonnet-5');

    const before = JSON.stringify(readWorkflow(repo, 'fix-until-green'));
    const refused = await call({ workflow: 'fix-until-green', ops: [{ op: 'rename', name: 'nope' }, { op: 'update', id: 'b3', command: 'rm -rf /' }] });
    assert.equal(refused.error, true);
    assert.match(refused.body, /command must be one of/);
    assert.equal(JSON.stringify(readWorkflow(repo, 'fix-until-green')), before);
    assert.equal((await call({ workflow: 'missing' })).error, true);
    assert.equal((await call({ ops: [{ op: 'remove', id: 'b1' }] })).error, true);
  } finally {
    await client.close();
    await server.close();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/** ROUND 16 (G8): the chat agent edits ITS chat's workflow; another chat's is not touched. */
test('edit_workflow with a chatId edits that chat\'s own workflow (made on first use) and leaves the other chats\' alone', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-core-workflows-chat-'));
  const server = createServer({ tools: 'core', repo });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'workflows-chat-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  /* The chat comes from the server's environment (the chat agent's server carries SEQUENCE_CHAT), never from the model. */
  const was = process.env.SEQUENCE_CHAT;
  const call = async ({ chatId, ...args }: Record<string, unknown>) => {
    process.env.SEQUENCE_CHAT = String(chatId);
    const r = await client.callTool({ name: 'edit_workflow', arguments: args });
    return { error: r.isError === true, body: (r.content as { text: string }[])[0]!.text };
  };
  try {
    const { tools } = await client.listTools();
    const shape = JSON.stringify(tools.find((t) => t.name === 'edit_workflow')!.inputSchema);
    assert.doesNotMatch(shape, /chatId/);
    assert.deepEqual(JSON.parse((await call({ chatId: 'chat-a' })).body), { workflows: [], legacy: [] });
    /* "add a test step after build": ops with no workflow named land in the chat's own, made from the ready-made blocks */
    const edited = await call({ chatId: 'chat-a', ops: [{ op: 'add', kind: 'test', afterId: 'b1', title: 'Run tests after build' }] });
    assert.equal(edited.error, false, edited.body);
    const a = JSON.parse(edited.body).workflow;
    assert.deepEqual(a.blocks.map((b: { title: string }) => b.title), ['Edit the code', 'Run tests after build', 'Check against the graph', 'Run the tests', 'Finish']);
    const doc = readWorkflow(repo, a.id)!;
    assert.equal(doc.chatId, 'chat-a');
    assert.equal(doc.blocks.length, 5);
    /* chat B starts from its own, untouched; and may not edit A's by name */
    const b = JSON.parse((await call({ chatId: 'chat-b', create: 'Mine' })).body).created;
    assert.notEqual(b.id, a.id);
    assert.equal(b.blocks.length, 4);
    const crossed = await call({ chatId: 'chat-b', workflow: a.id, ops: [{ op: 'rename', name: 'stolen' }] });
    assert.equal(crossed.error, true);
    assert.match(crossed.body, /no workflow/);
    assert.equal(readWorkflow(repo, a.id)!.name, a.name);
    /* the same chat asking to create again gets its one back */
    const again = JSON.parse((await call({ chatId: 'chat-a', create: 'Second' })).body);
    assert.equal(again.existing.id, a.id);
    assert.equal(JSON.parse((await call({ chatId: 'chat-a' })).body).workflows.length, 1);
  } finally {
    if (was === undefined) delete process.env.SEQUENCE_CHAT;
    else process.env.SEQUENCE_CHAT = was;
    await client.close();
    await server.close();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/** ROUND 16 (G8) review fix F1: the chat agent's server carries its chat as SEQUENCE_CHAT; "add a test step" needs no chatId argument. */
test('with SEQUENCE_CHAT set and no chatId argument, ops edit this chat\'s workflow and never another chat\'s same-named one', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-core-workflows-env-'));
  const server = createServer({ tools: 'core', repo });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'workflows-env-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  const call = async (args: Record<string, unknown>) => {
    const r = await client.callTool({ name: 'edit_workflow', arguments: args });
    return { error: r.isError === true, body: (r.content as { text: string }[])[0]!.text };
  };
  const was = process.env.SEQUENCE_CHAT;
  try {
    process.env.SEQUENCE_CHAT = 'chat-b';
    const other = JSON.parse((await call({ create: 'Workflow' })).body).created;
    process.env.SEQUENCE_CHAT = 'chat-a';
    const mine = JSON.parse((await call({ create: 'Workflow' })).body).created;
    assert.notEqual(mine.id, other.id);
    const edited = await call({ ops: [{ op: 'add', kind: 'test', afterId: 'b1', title: 'Run tests after build' }] });
    assert.equal(edited.error, false, edited.body);
    assert.equal(readWorkflow(repo, mine.id)!.blocks.length, 5);
    assert.equal(readWorkflow(repo, other.id)!.blocks.length, 4, 'the other chat\'s workflow is untouched');
    /* naming the other chat's by its shared name or its id reaches only this chat's own */
    const byName = await call({ workflow: 'Workflow', ops: [{ op: 'rename', name: 'Renamed' }] });
    assert.equal(JSON.parse(byName.body).workflow.id, mine.id);
    const byId = await call({ workflow: other.id, ops: [{ op: 'rename', name: 'stolen' }] });
    assert.equal(byId.error, true);
    assert.equal(readWorkflow(repo, other.id)!.name, 'Workflow');
  } finally {
    if (was === undefined) delete process.env.SEQUENCE_CHAT;
    else process.env.SEQUENCE_CHAT = was;
    await client.close();
    await server.close();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
