import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createSession,
  readSessionGoal,
  readSessionIndex,
  updateSession,
} from '../server/sessionsStore.js';

/**
 * THE GOAL AND PLAN ON THE SESSION.
 *
 * Two families of rule, and they pull in opposite directions on purpose:
 *
 *  1. THE THREE STATES OF `goal`. `undefined` means NOBODY HAS SET ONE and no
 *     turn ever will — see the block below for the owner report that removed
 *     adoption. `''` means the person cleared it, and a non-empty goal is
 *     theirs. Absent and cleared stay distinct because they are different
 *     facts, not because anything may refill either.
 *
 *  2. `updatedAt` MOVES FOR A PLAN AND NOT FOR A GOAL. FINDING F10's rule, and
 *     it puts these two fields on opposite sides: a plan moves because a tool
 *     was called inside the thread, a goal moves because somebody clicked.
 */

function freshRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-goal-store-'));
}

function chat(id: string, ...turns: Array<[string, string]>): Parameters<typeof updateSession>[2]['chat'] {
  return {
    version: 1,
    sessionId: id,
    turns: turns.map(([role, text]) => ({ role, text })),
  };
}

/* ------------------------ the three states (no adoption) ------------------ */

/**
 * THE FIRST MESSAGE NEVER SETS A GOAL, and this file used to assert the
 * opposite.
 *
 * Owner, walking the installed app 2026-09-17: "I don't like that it sets the
 * goal automatically." `adoptGoalFromChat` took the first substantive user turn
 * as the session's standing goal, which is rendered into every later prompt and
 * is what the goal run aims at — so one question became a standing instruction
 * the person never asked for and then had to notice and clear.
 *
 * These four cases are the inversion, one stop each: the opening message, a
 * later message, a message after a CLEAR, and a message after the person set a
 * goal by hand. Only the last leaves a goal on the row, and it is the one they
 * typed.
 */
test('the FIRST message does not set a goal — a goal exists only when the person sets one', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  updateSession(repo, made.id, {
    chat: chat(made.id, ['user', 'make the goalbar show the plan'], ['assistant', 'sure']),
  });
  assert.strictEqual(
    readSessionGoal(repo, made.id).goal,
    undefined,
    'the first message was adopted as a standing goal',
  );
  /* ABSENT, not `''`: nothing has happened to this field, and the two states
     are different facts on the wire. */
  assert.ok(
    !('goal' in readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!),
    'a session nobody gave a goal must carry no goal key at all',
  );
});

test('a LATER message does not set one either — every chat write leaves the goal alone', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  updateSession(repo, made.id, { chat: chat(made.id, ['user', 'make the goalbar show the plan']) });
  updateSession(repo, made.id, {
    chat: chat(made.id, ['user', 'make the goalbar show the plan'], ['user', 'now do something else entirely']),
  });
  assert.strictEqual(readSessionGoal(repo, made.id).goal, undefined);
});

test('a CLEARED goal stays cleared across a chat write — "" is still not absent', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  updateSession(repo, made.id, { goal: 'the first standing goal here' });
  updateSession(repo, made.id, { goal: '' });
  assert.strictEqual(readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.goal, '');

  updateSession(repo, made.id, { chat: chat(made.id, ['user', 'a message with four words']) });
  assert.strictEqual(
    readSessionGoal(repo, made.id).goal,
    '',
    'a chat write refilled a goal the person had cleared',
  );
});

test('the goal the PERSON set survives every later message, unchanged', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  updateSession(repo, made.id, { goal: 'get the gateway off the shared pool' });
  updateSession(repo, made.id, {
    chat: chat(made.id, ['user', 'first, what is in the routing table'], ['user', 'now rename the pool']),
  });
  assert.strictEqual(readSessionGoal(repo, made.id).goal, 'get the gateway off the shared pool');
});

test('the store exports no adoption path at all — the rule is removed, not disabled', async () => {
  const store = (await import('../server/sessionsStore.js')) as Record<string, unknown>;
  assert.strictEqual(
    store.adoptGoalFromChat,
    undefined,
    'a re-exported adopter is a rule waiting to be called again',
  );
});

/* ------------------------------ goal vs title ----------------------------- */

test('the goal is not the title — setting one leaves the other alone', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  updateSession(repo, made.id, { title: 'Gateway work' });
  updateSession(repo, made.id, { goal: 'make the gateway stop timing out' });
  const entry = readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!;
  assert.strictEqual(entry.title, 'Gateway work');
  assert.strictEqual(entry.goal, 'make the gateway stop timing out');
});

/* --------------------------- the activity rule (F10) ---------------------- */

test('a goal-only patch does NOT bump updatedAt — a click is not a turn', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  const before = readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt;
  updateSession(repo, made.id, { goal: 'a standing goal of four words' });
  assert.strictEqual(
    readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt,
    before,
  );
});

test('a CHANGED plan bumps updatedAt — a tick is a tool call inside the thread', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  const before = readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt;
  updateSession(repo, made.id, { plan: [{ id: 's1', text: 'Read the parser', status: 'open' }] });
  const after = readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt;
  assert.ok(after > before, 'writing a plan did not count as activity');
});

test('re-PUTting the IDENTICAL plan does not re-stamp the row', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  const plan = [
    { id: 's1', text: 'Read the parser', status: 'open' as const },
    { id: 's2', text: 'Measure it', status: 'parked' as const, why: 'no benchmark' },
  ];
  updateSession(repo, made.id, { plan });
  const stamped = readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt;
  /* The goalbar re-flushes on activate; an unconditional bump would push every
     session to the top of the rail merely by opening it — FINDING F10 exactly. */
  updateSession(repo, made.id, { plan: plan.map((s) => ({ ...s })) });
  assert.strictEqual(readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt, stamped);
});

test('the plan comparison is field-by-field, so key order cannot fake a change', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  updateSession(repo, made.id, { plan: [{ id: 's1', text: 'Read it now', status: 'open' }] });
  const stamped = readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt;
  updateSession(repo, made.id, {
    plan: [{ status: 'open', text: 'Read it now', id: 's1' } as { id: string; text: string; status: 'open' }],
  });
  assert.strictEqual(readSessionIndex(repo)!.sessions.find((s) => s.id === made.id)!.updatedAt, stamped);
});

/* --------------------------------- reading -------------------------------- */

test('readSessionGoal answers {} for an unknown session rather than throwing', () => {
  assert.deepStrictEqual(readSessionGoal(freshRepo(), 'no-such-thread'), {});
});

test('a session with a plan and no goal is still readable as a plan', () => {
  const repo = freshRepo();
  const made = createSession(repo);
  updateSession(repo, made.id, { plan: [{ id: 's1', text: 'Read the parser', status: 'open' }] });
  const read = readSessionGoal(repo, made.id);
  assert.strictEqual(read.goal, undefined);
  assert.strictEqual(read.plan?.length, 1);
});
