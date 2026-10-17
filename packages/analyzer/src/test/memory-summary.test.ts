/* M1: what persists across chats, counted live (GET /api/memory/summary). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { findFilesModelBaseId } from '../explain/findFilesLearn.js';
import { NOTES_REL } from '../harness/refineNotes.js';
import { loadAuthConfig } from '../server/auth.js';
import { memorySummary } from '../server/memorySummary.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated, writeAgentThread } from '../server/sessionsStore.js';

function repo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memsum-')));
  fs.writeFileSync(path.join(dir, 'index.ts'), 'export const a = 1;\n');
  return dir;
}

test('an empty repo has nothing remembered', () => {
  const root = repo();
  assert.deepEqual(memorySummary(root), { notes: 0, notesPath: NOTES_REL, findFilesLabels: 0, findFilesModel: 'frozen', agentThreads: 0 });
});

test('counts the notes, the finder labels, a repo-trained finder model and the agent threads on fixtures', () => {
  const root = repo();
  const notes = path.join(root, NOTES_REL);
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, ['# Repo memory', '', '- Prefer the orders service for totals. <!--n:n1-->', '- Run pnpm test before saying done. <!--n:n2-->', ''].join(String.fromCharCode(10)));
  const ff = path.join(root, '.sequence', 'findfiles');
  fs.mkdirSync(ff, { recursive: true });
  fs.writeFileSync(path.join(ff, 'labels.jsonl'), `${JSON.stringify({ id: 'a', at: 1, files: ['x'] })}\n${JSON.stringify({ id: 'b', at: 2, files: ['y'] })}\ntorn line\n`);
  const chat = ensureSessionsMigrated(root).activeId;
  writeAgentThread(root, chat, 'claude', { id: 't1', kind: 'acp' });
  writeAgentThread(root, chat, 'codex', { id: 't2', kind: 'codex' });
  assert.deepEqual(memorySummary(root), { notes: 2, notesPath: NOTES_REL, findFilesLabels: 2, findFilesModel: 'frozen', agentThreads: 2 });
  fs.writeFileSync(path.join(ff, 'model.json'), JSON.stringify({ v: 1, base: findFilesModelBaseId(), trees: [{}] }));
  assert.equal(memorySummary(root).findFilesModel, 'repo');
  fs.writeFileSync(path.join(ff, 'model.json'), JSON.stringify({ v: 1, base: 'someone-elses', trees: [{}] }));
  assert.equal(memorySummary(root).findFilesModel, 'frozen');
});

test('GET /api/memory/summary answers the same shape', async () => {
  const root = repo();
  const store = path.join(root, '.sequence-user');
  fs.mkdirSync(store, { recursive: true });
  const server = await createRepoServer(root, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api/memory/summary`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), memorySummary(root));
  } finally {
    await new Promise<void>((r) => { server.close(() => r()); (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.(); });
  }
});

test('a huge NOTES.md is counted in chunks, and a changed file is counted again', () => {
  const root = repo();
  const notes = path.join(root, NOTES_REL);
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  const nl = String.fromCharCode(10);
  const lines = ['# Repo memory', ''];
  for (let i = 0; i < 60000; i++) lines.push(`- note number ${i} about something long enough to matter here. <!--n:n${i}-->`);
  fs.writeFileSync(notes, lines.join(nl));
  assert.equal(memorySummary(root).notes, 60000);
  fs.appendFileSync(notes, `${nl}- one more <!--n:last-->`);
  assert.equal(memorySummary(root).notes, 60001);
});

test('a directory where labels.jsonl should be counts as no labels', () => {
  const root = repo();
  fs.mkdirSync(path.join(root, '.sequence', 'findfiles', 'labels.jsonl'), { recursive: true });
  assert.equal(memorySummary(root).findFilesLabels, 0);
});

test('with sign-in on, /api/memory/summary is answered only to a signed-in session, like its siblings', async () => {
  const root = repo();
  const store = path.join(root, '.u');
  fs.mkdirSync(store);
  const authConfig = loadAuthConfig({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', SESSION_SECRET: 'sess-secret-abc', PUBLIC_BASE_URL: 'https://app.example.com' });
  const server = await createRepoServer(root, { webDist: undefined, userConfigDir: store, authConfig });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const get = (p: string) =>
    new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host: 'app.example.com', origin: 'https://app.example.com' } }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      });
      req.on('error', reject);
      req.end();
    });
  try {
    const sessions = await get('/api/sessions');
    assert.equal(sessions.status, 401);
    assert.equal((await get('/api/memory/summary')).status, sessions.status);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
