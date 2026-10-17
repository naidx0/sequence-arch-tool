import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { WorkflowError, adoptWorkflow, applyWorkflowEdit, createWorkflow, ensureChatWorkflow, listWorkflows, readWorkflow, unownedWorkflows, workflowForChat } from '../workflows/workflowStore.js';

/** ROUND 16 (G8): one workflow per chat, not per project. The files stay where they were (.sequence/workflows/<id>.json); a
    workflow records the chat that owns it. */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');
const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-wf-chat-'));

test('two chats in one project get separate workflows; reopening a chat returns its own, edits included', async () => {
  const root = tmpRoot();
  assert.equal(workflowForChat(root, 'chat-a'), null);
  const a = ensureChatWorkflow(root, 'chat-a');
  const b = ensureChatWorkflow(root, 'chat-b');
  assert.equal(a.created, true);
  assert.equal(b.created, true);
  assert.notEqual(a.doc.id, b.doc.id);
  await applyWorkflowEdit(root, a.doc.id, [{ op: 'rename', name: 'Only A' }, { op: 'add', kind: 'loop', at: 0, span: 3 }]);
  const again = ensureChatWorkflow(root, 'chat-a');
  assert.equal(again.created, false, 'a chat has at most one');
  assert.equal(again.doc.id, a.doc.id);
  assert.equal(again.doc.name, 'Only A');
  assert.equal(again.doc.chatId, 'chat-a', 'the owner survives an edit');
  assert.deepEqual(listWorkflows(root, { chatId: 'chat-a' }).map((d) => d.id), [a.doc.id]);
  const other = workflowForChat(root, 'chat-b')!;
  assert.equal(other.name, 'Workflow');
  assert.deepEqual(other.blocks.map((x) => x.kind), ['agent', 'checker', 'test', 'finish'], 'chat B did not get the loop chat A added');
  assert.equal(listWorkflows(root, { chatId: 'chat-c' }).length, 0, 'a third chat sees neither');
  assert.equal(listWorkflows(root).length, 2, 'the project folder still holds every file');
  assert.throws(() => ensureChatWorkflow(root, '../x'), WorkflowError);
});

test('two first uses of one chat at once make one file', async () => {
  const root = tmpRoot();
  const made = await Promise.all(Array.from({ length: 6 }, () => Promise.resolve().then(() => ensureChatWorkflow(root, 'racey'))));
  assert.equal(new Set(made.map((m) => m.doc.id)).size, 1);
  assert.equal(made.filter((m) => m.created).length, 1);
  assert.equal(listWorkflows(root).length, 1);
});

test('workflows saved before chats owned them stay readable and are offered once: a chat takes one, then no other chat can', async () => {
  const root = tmpRoot();
  const old = createWorkflow(root, { name: 'Old project flow' });
  assert.equal(old.chatId, undefined);
  assert.equal(readWorkflow(root, old.id)?.name, 'Old project flow');
  assert.deepEqual(unownedWorkflows(root).map((d) => d.id), [old.id]);
  assert.equal(workflowForChat(root, 'chat-a'), null, 'a legacy workflow is not silently any chat\'s');
  const taken = await adoptWorkflow(root, old.id, 'chat-a');
  assert.equal(taken.chatId, 'chat-a');
  assert.equal(taken.rev, old.rev + 1);
  assert.deepEqual(unownedWorkflows(root), []);
  assert.equal(workflowForChat(root, 'chat-a')?.id, old.id);
  await assert.rejects(adoptWorkflow(root, old.id, 'chat-b'), (e: unknown) => e instanceof WorkflowError && e.status === 409);
  const mine = ensureChatWorkflow(root, 'chat-b').doc;
  const loose = createWorkflow(root, { name: 'Loose' });
  await assert.rejects(adoptWorkflow(root, loose.id, 'chat-b'), (e: unknown) => e instanceof WorkflowError && e.status === 409, 'a chat that has one cannot take a second');
  assert.equal(mine.chatId, 'chat-b');
});

async function startServer(repo: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

test('routes: a chat opens its own workflow (made on first use), another chat does not see it, legacy ones are offered', async () => {
  const dir = tmpRoot();
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const legacy = createWorkflow(repo, { name: 'Before chats' });
  const { base, close } = await startServer(repo);
  const json = { 'content-type': 'application/json' };
  const post = (p: string, b: unknown) => fetch(`${base}${p}`, { method: 'POST', headers: json, body: JSON.stringify(b) });
  try {
    const empty = (await (await fetch(`${base}/api/workflows?chat=chat-a`)).json()) as { workflows: unknown[]; legacy: { id: string }[] };
    assert.deepEqual(empty.workflows, []);
    assert.deepEqual(empty.legacy.map((w) => w.id), [legacy.id]);

    const first = await post('/api/workflows', { chatId: 'chat-a', name: 'Workflow', from: 'empty' });
    assert.equal(first.status, 201);
    const a = (await first.json()) as { id: string; chatId: string; blocks: unknown[] };
    assert.equal(a.chatId, 'chat-a');
    assert.equal(a.blocks.length, 1);
    const reopened = await post('/api/workflows', { chatId: 'chat-a', name: 'Another', from: 'fresh' });
    assert.equal(reopened.status, 200, 'reopening is not creating');
    assert.equal(((await reopened.json()) as { id: string }).id, a.id);

    const b = (await (await post('/api/workflows', { chatId: 'chat-b' })).json()) as { id: string };
    assert.notEqual(b.id, a.id);
    const listA = (await (await fetch(`${base}/api/workflows?chat=chat-a`)).json()) as { workflows: { id: string }[] };
    assert.deepEqual(listA.workflows.map((w) => w.id), [a.id]);
    assert.equal((await fetch(`${base}/api/workflows/${a.id}?chat=chat-b`)).status, 404, 'B cannot open the workflow of A');
    assert.equal((await fetch(`${base}/api/workflows/${a.id}?chat=chat-a`)).status, 200);
    const refused = await post(`/api/workflows/${a.id}/ops`, { chatId: 'chat-b', ops: [{ op: 'rename', name: 'mine now' }] });
    assert.equal(refused.status, 403);
    assert.equal(readWorkflow(repo, a.id)?.name, 'Workflow');
    const ok = await post(`/api/workflows/${a.id}/ops`, { chatId: 'chat-a', ops: [{ op: 'rename', name: 'Renamed by A' }] });
    assert.equal(ok.status, 200);

    const adopted = await post(`/api/workflows/${legacy.id}/adopt`, { chatId: 'chat-c' });
    assert.equal(adopted.status, 200);
    assert.equal(((await adopted.json()) as { chatId: string }).chatId, 'chat-c');
    const afterAdopt = (await (await fetch(`${base}/api/workflows?chat=chat-d`)).json()) as { legacy: unknown[] };
    assert.deepEqual(afterAdopt.legacy, []);
    assert.equal((await post(`/api/workflows/${legacy.id}/adopt`, { chatId: 'chat-d' })).status, 409);
    const all = (await (await fetch(`${base}/api/workflows`)).json()) as { workflows: unknown[] };
    assert.equal(all.workflows.length, 3, 'no chat parameter: the project list is what it always was');
  } finally {
    await close();
  }
});
