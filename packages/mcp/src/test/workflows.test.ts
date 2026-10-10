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
