import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createSession,
  updateSession,
  readSessionIndex,
  summarizeSessionTitle,
  type ChatMemoryShape,
} from '../server/sessionsStore.js';

/**
 * MADR model-roles — session mode stamping + rename stickiness. `createSession`
 * accepts an optional `{ mode }` so a Work/Code session is born with the right
 * mode; `updateSession` keeps `titleEdited` once a title is set so a later chat
 * write does not overwrite a user-chosen title.
 */

function freshRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-sessions-mode-'));
}

test('summarizeSessionTitle: strips polite fluff into a short topic', () => {
  const long =
    'Can you just break down for me how I can set up a local agent harness with Ollama please?';
  const title = summarizeSessionTitle(long);
  assert.ok(!/^Can you/i.test(title), 'must not keep ask fluff');
  assert.ok(title.length <= 50, `title too long: ${title}`);
  assert.match(title, /[Ll]ocal agent harness|[Oo]llama|set up/);
});

test('summarizeSessionTitle: word-boundary truncates long topics', () => {
  const title = summarizeSessionTitle(
    'Explain the entire authentication middleware chain across gateway and all downstream services in detail',
  );
  assert.ok(title.endsWith('…'));
  assert.ok(title.length <= 50);
  assert.ok(!title.includes('  '));
});

test('createSession: with mode:"code" stamps entry.mode', () => {
  const repo = freshRepo();
  const created = createSession(repo, { mode: 'code' });
  // A fresh repo migrates a default session first, so the new session is at [0].
  const entry = created.index.sessions.find((s) => s.id === created.id);
  assert.ok(entry);
  assert.strictEqual(entry!.mode, 'code');
  // Persisted to disk.
  const reread = readSessionIndex(repo);
  assert.ok(reread);
  const rereadEntry = reread!.sessions.find((s) => s.id === created.id);
  assert.ok(rereadEntry);
  assert.strictEqual(rereadEntry!.mode, 'code');
});

test('createSession: with mode:"work" stamps entry.mode', () => {
  const repo = freshRepo();
  const created = createSession(repo, { mode: 'work' });
  const entry = created.index.sessions.find((s) => s.id === created.id);
  assert.ok(entry);
  assert.strictEqual(entry!.mode, 'work');
});

test('createSession: without opts has no mode (work-less default intact)', () => {
  const repo = freshRepo();
  const created = createSession(repo);
  const entry = created.index.sessions.find((s) => s.id === created.id);
  assert.ok(entry);
  assert.strictEqual(entry!.mode, undefined);
  const reread = readSessionIndex(repo);
  const rereadEntry = reread!.sessions.find((s) => s.id === created.id);
  assert.strictEqual(rereadEntry!.mode, undefined);
});

test('updateSession: title sets titleEdited; subsequent chat update does NOT overwrite title', () => {
  const repo = freshRepo();
  const created = createSession(repo);
  const id = created.id;

  // Rename the session — titleEdited becomes true.
  const renamed = updateSession(repo, id, { title: 'My Plan' });
  assert.ok(renamed);
  const renamedEntry = renamed!.sessions.find((s) => s.id === id);
  assert.strictEqual(renamedEntry!.title, 'My Plan');
  assert.strictEqual(renamedEntry!.titleEdited, true);

  // A later chat write (no title in the patch) must NOT clobber the user title.
  // The chat's first turn would otherwise derive a new title.
  const chat: ChatMemoryShape = {
    version: 1,
    sessionId: id,
    turns: [{ role: 'user', text: 'A totally different first question that is long enough', at: '2026-01-01T00:00:00.000Z' }],
  };
  const afterChat = updateSession(repo, id, { chat });
  assert.ok(afterChat);
  const afterEntry = afterChat!.sessions.find((s) => s.id === id);
  assert.strictEqual(afterEntry!.title, 'My Plan', 'user-chosen title survives a later chat write');
  assert.strictEqual(afterEntry!.titleEdited, true);
});

test('updateSession: without a prior rename, chat write derives the title', () => {
  const repo = freshRepo();
  const created = createSession(repo);
  const id = created.id;
  const chat: ChatMemoryShape = {
    version: 1,
    sessionId: id,
    turns: [{ role: 'user', text: 'How does routing work in this repo?', at: '2026-01-01T00:00:00.000Z' }],
  };
  const afterChat = updateSession(repo, id, { chat });
  assert.ok(afterChat);
  const afterEntry = afterChat!.sessions.find((s) => s.id === id);
  assert.ok(
    /routing work/i.test(afterEntry!.title),
    `title derived from chat when not edited, got: ${afterEntry!.title}`,
  );
  assert.strictEqual(afterEntry!.titleEdited, undefined);
});

test('updateSession: polite long prompt becomes a short summary title', () => {
  const repo = freshRepo();
  const created = createSession(repo);
  const id = created.id;
  const chat: ChatMemoryShape = {
    version: 1,
    sessionId: id,
    turns: [
      {
        role: 'user',
        text: 'Can you just break down for me how I can set up a local agent harness with Ollama please?',
        at: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
  const afterChat = updateSession(repo, id, { chat });
  assert.ok(afterChat);
  const title = afterChat!.sessions.find((s) => s.id === id)!.title;
  assert.ok(!/^Can you/i.test(title), `still looks like a prompt: ${title}`);
  assert.ok(title.length <= 50, `too long: ${title}`);
  assert.match(title, /local agent harness|Ollama|set up/i);
});

test('updateSession: boardSeqd title wins over chat when not renamed', () => {
  const repo = freshRepo();
  const created = createSession(repo);
  const id = created.id;
  const chat: ChatMemoryShape = {
    version: 1,
    sessionId: id,
    turns: [{ role: 'user', text: 'put that on the graph please', at: '2026-01-01T00:00:00.000Z' }],
  };
  const after = updateSession(repo, id, {
    chat,
    boardSeqd: JSON.stringify({ title: 'Hermes-style local agent harness.seqd' }),
  });
  assert.ok(after);
  const entry = after!.sessions.find((s) => s.id === id);
  assert.strictEqual(entry!.title, 'Hermes-style local agent harness');
  assert.strictEqual(entry!.titleEdited, undefined);
});
