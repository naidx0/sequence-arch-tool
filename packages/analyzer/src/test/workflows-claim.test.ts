import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { WorkflowError, adoptWorkflow, applyWorkflowEdit, createWorkflow, ensureChatWorkflow, listWorkflows, liveChatIds, unownedWorkflows, workflowForChat, workflowsDir } from '../workflows/workflowStore.js';

/** ROUND 16 (G8), claim-file edge cases: crashes, chats not yet in the index, data written before claims, two processes. */

const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-wf-claim-'));
const key = (c: string): string => `chat-${createHash('sha1').update(c).digest('hex').slice(0, 12)}`;
const claim = (r: string, c: string): string => path.join(workflowsDir(r), `${key(c)}.claim`);
const index = (r: string, ids: string[]): void => {
  fs.mkdirSync(path.join(r, '.sequence', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(r, '.sequence', 'sessions', 'index.json'), JSON.stringify({ version: 1, activeId: ids[0], sessions: ids.map((id) => ({ id, title: id, createdAt: '', updatedAt: '' })) }));
};

test('R1: a claim left by a crash before the write does not block the chat, and nothing waits', () => {
  const r = tmpRoot();
  fs.mkdirSync(workflowsDir(r), { recursive: true });
  fs.writeFileSync(claim(r, 'cA'), JSON.stringify({ id: key('cA') }));
  const t = Date.now();
  assert.equal(ensureChatWorkflow(r, 'cA').created, true);
  assert.ok(Date.now() - t < 200, 'no synchronous sleep on the recovery path');
});

test('R1: a claim from a crashed adopt of an older workflow does not block the chat either', () => {
  const r = tmpRoot();
  const leg = createWorkflow(r, { name: 'legacy' });
  fs.writeFileSync(claim(r, 'cA'), JSON.stringify({ id: leg.id }));
  assert.equal(ensureChatWorkflow(r, 'cA').created, true);
});

test('R1: a claim whose workflow was removed outside the store is released', () => {
  const r = tmpRoot();
  const a = ensureChatWorkflow(r, 'cA');
  fs.rmSync(path.join(workflowsDir(r), `${a.doc.id}.json`));
  assert.equal(ensureChatWorkflow(r, 'cA').created, true);
});

test('R2: a chat that owns a workflow with no claim file cannot adopt a second one', async () => {
  const r = tmpRoot();
  ensureChatWorkflow(r, 'cA');
  fs.rmSync(claim(r, 'cA'), { force: true });
  const leg = createWorkflow(r, { name: 'legacy' });
  await assert.rejects(adoptWorkflow(r, leg.id, 'cA'), (e: unknown) => e instanceof WorkflowError && e.status === 409);
  assert.equal(listWorkflows(r, { chatId: 'cA' }).length, 1);
  assert.equal(unownedWorkflows(r).length, 1, 'the older one stays offered');
});

test('R3: a chat not yet in the index keeps its workflow: not offered, not taken, and its next first use deletes nothing', async () => {
  const r = tmpRoot();
  index(r, ['cB']);
  const a = ensureChatWorkflow(r, 'cA', { live: liveChatIds(r) });
  await applyWorkflowEdit(r, a.doc.id, [{ op: 'rename', name: 'A work' }]);
  assert.deepEqual(unownedWorkflows(r, liveChatIds(r)), [], 'edited a moment ago: not an orphan');
  await assert.rejects(adoptWorkflow(r, a.doc.id, 'cB', liveChatIds(r)), (e: unknown) => e instanceof WorkflowError && e.status === 409);
  assert.equal(ensureChatWorkflow(r, 'cA').doc.name, 'A work');
});

test('R3: even when it is an orphan and taken, the previous owner\'s next first use never deletes the file now owned by another chat', async () => {
  const r = tmpRoot();
  index(r, ['cB']);
  const a = ensureChatWorkflow(r, 'cA').doc;
  /* long untouched, and its chat is gone from the index: orphaned, so cB may take it */
  const file = path.join(workflowsDir(r), `${a.id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...raw, name: 'was A', updatedAt: '2020-01-01T00:00:00.000Z' }));
  const taken = await adoptWorkflow(r, a.id, 'cB', liveChatIds(r));
  assert.equal(taken.chatId, 'cB');
  const again = ensureChatWorkflow(r, 'cA');
  assert.equal(again.created, true);
  assert.notEqual(again.doc.id, a.id, 'a fresh id');
  assert.equal(workflowForChat(r, 'cB')?.name, 'was A', 'cB still has its workflow');
  assert.equal(listWorkflows(r).length, 2);
});

test('two processes adopting and making a first workflow for one chat end with it owning one', async () => {
  const r = tmpRoot();
  const leg = createWorkflow(r, { name: 'legacy' });
  const dist = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js')).href;
  const run = (code: string): Promise<number | null> =>
    new Promise((res) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', `const A=await import(${JSON.stringify(dist)});${code}`]);
      p.on('close', (c) => res(c));
    });
  const R = JSON.stringify(r);
  const L = JSON.stringify(leg.id);
  await Promise.all([
    run(`try{await A.adoptWorkflow(${R},${L},'cA')}catch{}`),
    run(`try{A.ensureChatWorkflow(${R},'cA')}catch{}`),
    run(`try{await A.adoptWorkflow(${R},${L},'cA')}catch{}`),
    run(`try{A.ensureChatWorkflow(${R},'cA')}catch{}`),
  ]);
  assert.equal(listWorkflows(r, { chatId: 'cA' }).length, 1);
});
