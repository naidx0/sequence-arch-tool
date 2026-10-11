#!/usr/bin/env node
/* A fake `codex app-server` that keeps its threads on disk (REWIND_STATE, JSON)
 * so a NEW process can `thread/resume` them, supports `thread/turns/list` and
 * `thread/revert` (or refuses them when REWIND_NO_REVERT=1, as an older or
 * stricter app-server would), and logs every request it gets to REWIND_LOG as
 * JSON lines. With REWIND_SLOW_MS a turn takes that long to finish. It refuses a turn whose text holds FAIL (turn/start answers an error and the thread gets nothing), and answers each other turn with "ok:<prompt>" and never writes files.
 * Used by the Edit-from-here tests to prove what the NEXT turn really sends. */
import fs from 'node:fs';
import readline from 'node:readline';

const STATE = process.env.REWIND_STATE;
const LOG = process.env.REWIND_LOG;
const noRevert = process.env.REWIND_NO_REVERT === '1';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const load = () => (STATE && fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { threads: {}, n: 0 });
const save = (s) => STATE && fs.writeFileSync(STATE, JSON.stringify(s));
const log = (m) => LOG && fs.appendFileSync(LOG, JSON.stringify({ method: m.method, params: m.params }) + '\n');

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const m = JSON.parse(line);
  if (m.method === undefined) return;
  if (m.id !== undefined) log(m);
  const reply = (result) => send({ id: m.id, result });
  const fail = (code, message) => send({ id: m.id, error: { code, message } });
  const p = m.params ?? {};
  const st = load();
  switch (m.method) {
    case 'initialized':
      return;
    case 'initialize':
      return reply({ userAgent: 'rewind-fake/0.156.0', codexHome: '/fake', platformFamily: 'unix', platformOs: 'linux' });
    case 'thread/start': {
      const id = `thread-${++st.n}`;
      st.threads[id] = [];
      save(st);
      return reply({ thread: { id, turns: [] }, model: 'fake', cwd: p.cwd });
    }
    case 'thread/resume':
      if (!st.threads[p.threadId]) return fail(-32602, `unknown thread ${p.threadId}`);
      return reply({ thread: { id: p.threadId, turns: [] }, model: 'fake', cwd: p.cwd });
    case 'thread/turns/list': {
      if (noRevert) return fail(-32601, 'method not found');
      const turns = [...(st.threads[p.threadId] ?? [])].reverse().map((t) => ({ id: t.id }));
      return reply({ data: turns, nextCursor: null });
    }
    case 'thread/revert': {
      if (noRevert) return fail(-32601, 'method not found');
      const turns = st.threads[p.threadId] ?? [];
      const at = turns.findIndex((t) => t.id === p.beforeTurnId);
      if (at < 0) return fail(-32602, 'unknown turn');
      st.threads[p.threadId] = turns.slice(0, at);
      save(st);
      return reply({ thread: { id: p.threadId } });
    }
    case 'thread/rollback':
      return fail(-32601, 'method not found');
    case 'turn/start': {
      const text = (p.input ?? []).filter((i) => i.type === 'text').map((i) => i.text).join('\n');
      if (text.includes('FAIL')) return fail(-32000, 'the model refused this turn');
      const turnId = `turn-${++st.n}`;
      st.threads[p.threadId].push({ id: turnId, text });
      save(st);
      reply({ turn: { id: turnId, items: [], status: 'inProgress', error: null } });
      send({ method: 'turn/started', params: { threadId: p.threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } } });
      const finish = () => {
        send({ method: 'item/agentMessage/delta', params: { threadId: p.threadId, turnId, itemId: 'm', delta: 'ok' } });
        send({ method: 'item/completed', params: { threadId: p.threadId, turnId, item: { type: 'agentMessage', id: 'm', text: 'ok' }, completedAtMs: Date.now() } });
        send({ method: 'turn/completed', params: { threadId: p.threadId, turn: { id: turnId, items: [], status: 'completed', error: null } } });
      };
      const slow = Number(process.env.REWIND_SLOW_MS || 0);
      if (slow > 0) setTimeout(finish, slow);
      else finish();
      return;
    }
    default:
      return fail(-32601, `method not found: ${m.method}`);
  }
});
