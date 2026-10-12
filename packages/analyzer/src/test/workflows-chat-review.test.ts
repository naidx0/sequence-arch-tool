import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { WorkflowError, adoptWorkflow, createWorkflow, deleteWorkflow, ensureChatWorkflow, findWorkflow, listWorkflows, liveChatIds, unownedWorkflows, workflowForChat, workflowsDir } from '../workflows/workflowStore.js';

/** ROUND 16 (G8), review fixes: one workflow per chat holds under races, deleted chats do not strand workflows. */

const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-wf-chat-rv-'));

function writeChats(root: string, ids: string[]): void {
  const dir = path.join(root, '.sequence', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ version: 1, activeId: ids[0] ?? '', sessions: ids.map((id) => ({ id, title: id })) }));
}

test('F2: two older workflows adopted by one chat at once: one wins, the chat owns exactly one', async () => {
  const root = tmpRoot();
  const a = createWorkflow(root, { name: 'one' });
  const b = createWorkflow(root, { name: 'two' });
  const res = await Promise.allSettled([adoptWorkflow(root, a.id, 'chat-a'), adoptWorkflow(root, b.id, 'chat-a')]);
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(listWorkflows(root, { chatId: 'chat-a' }).length, 1);
  assert.equal(unownedWorkflows(root).length, 1, 'the loser stays unowned');
});

test('F2: first use and taking an older one at once leave the chat with one', async () => {
  const root = tmpRoot();
  const old = createWorkflow(root, { name: 'older' });
  const taking = adoptWorkflow(root, old.id, 'chat-a').catch(() => undefined);
  try {
    ensureChatWorkflow(root, 'chat-a');
  } catch (e) {
    assert.ok(e instanceof WorkflowError);
  }
  await taking;
  assert.equal(listWorkflows(root, { chatId: 'chat-a' }).length, 1);
});

test('F2: deleting a chat\'s workflow frees its slot', async () => {
  const root = tmpRoot();
  const first = ensureChatWorkflow(root, 'chat-a').doc;
  deleteWorkflow(root, first.id);
  assert.equal(ensureChatWorkflow(root, 'chat-a').created, true);
  const old = createWorkflow(root, { name: 'older' });
  await assert.rejects(adoptWorkflow(root, old.id, 'chat-a'), (e: unknown) => e instanceof WorkflowError && e.status === 409);
});

test('F3: the workflow of a deleted chat is offered like an older one, taking it works, and it does not count toward the cap', async () => {
  const root = tmpRoot();
  writeChats(root, ['chat-a', 'chat-b']);
  const live = () => liveChatIds(root);
  const a = ensureChatWorkflow(root, 'chat-a').doc;
  assert.deepEqual(unownedWorkflows(root, live()), [], 'a live chat\'s workflow is not offered');
  writeChats(root, ['chat-b']);
  assert.deepEqual(unownedWorkflows(root, live()), [], 'a chat can be open before it is in the index: a fresh workflow is kept');
  const file = path.join(workflowsDir(root), `${a.id}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), updatedAt: '2020-01-01T00:00:00.000Z' }));
  assert.deepEqual(unownedWorkflows(root, live()).map((d) => d.id), [a.id]);
  assert.deepEqual(unownedWorkflows(root), [], 'with no chat list nothing is orphaned');
  const mine = await adoptWorkflow(root, a.id, 'chat-b', live());
  assert.equal(mine.chatId, 'chat-b');
  assert.equal(workflowForChat(root, 'chat-a'), null);
  /* the cap counts live chats' workflows: 50 workflows of deleted chats leave room */
  const root2 = tmpRoot();
  for (let i = 0; i < 50; i += 1) ensureChatWorkflow(root2, `gone-${i}`);
  for (const d of listWorkflows(root2)) fs.writeFileSync(path.join(workflowsDir(root2), `${d.id}.json`), JSON.stringify({ ...d, updatedAt: '2020-01-01T00:00:00.000Z' }));
  assert.throws(() => ensureChatWorkflow(root2, 'new-chat'), /at most 50/, 'with no list of live chats every workflow counts');
  writeChats(root2, ['new-chat']);
  assert.equal(ensureChatWorkflow(root2, 'new-chat', { live: liveChatIds(root2) }).created, true);
});

test('F1: finding by name with a chat never reaches another chat\'s workflow, by id or by name', () => {
  const root = tmpRoot();
  const a = ensureChatWorkflow(root, 'chat-a').doc;
  const b = ensureChatWorkflow(root, 'chat-b').doc;
  assert.equal(a.name, b.name, 'both are called Workflow');
  assert.equal(findWorkflow(root, 'Workflow', { chatId: 'chat-b' })?.id, b.id);
  assert.equal(findWorkflow(root, 'workflow', { chatId: 'chat-a' })?.id, a.id);
  assert.equal(findWorkflow(root, a.id, { chatId: 'chat-b' }), null);
  const loose = createWorkflow(root, { name: 'Loose' });
  assert.equal(findWorkflow(root, 'Loose', { chatId: 'chat-b' })?.id, loose.id, 'unowned ones stay reachable');
});

test('F5: where hard links are refused, the first use still works and stays whole', () => {
  const root = tmpRoot();
  const real = fs.linkSync;
  (fs as unknown as { linkSync: unknown }).linkSync = () => {
    throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  };
  try {
    const made = ensureChatWorkflow(root, 'chat-a');
    assert.equal(made.created, true);
    assert.equal(ensureChatWorkflow(root, 'chat-a').created, false);
    assert.equal(fs.readdirSync(workflowsDir(root)).filter((f) => f.endsWith('.tmp')).length, 0);
  } finally {
    (fs as unknown as { linkSync: unknown }).linkSync = real;
  }
});
