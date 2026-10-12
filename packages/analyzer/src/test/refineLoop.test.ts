/**
 * The closed loop (harness/learningLoop.ts runSignalLoop and friends): signals
 * become pending note proposals with their turn ids; nothing is applied without
 * an Accept except under the opt-in Auto setting (default off); and each
 * accepted note is tracked for whether the failure came back.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAskLine } from '@sequence/schema';
import { runSignalLoop } from '../harness/learningLoop.js';
import { recordTurn, type TurnInput } from '../harness/refineSignals.js';
import { clusterSignals, qualifies, tipFor } from '../harness/refineCandidates.js';
import { acceptProposal, dismissProposal, undoProposal } from '../harness/refineApply.js';
import { listRefineProposals, readRefineProposal, writeRefineProposal } from '../harness/refineProposal.js';
import { evaluateOutcome, judge, markKept, readOutcomeStore, worseNoteIds, MIN_AFTER } from '../harness/refineOutcome.js';
import { refineCards } from '../harness/refineCards.js';
import { readNotes } from '../harness/refineNotes.js';
import { readAgentSettings, writeAgentSettings } from '../server/askAgentMap.js';
import { createRepoServer } from '../server/repoServer.js';
import { addAgent } from '../server/agentsStore.js';
import { createSession, ensureSessionsMigrated, updateSession } from '../server/sessionsStore.js';
import { startMockProvider } from './mock-provider.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');
const PLAINAPP = path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'plainapp');
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'refine-loop-'));
const notesPath = (root: string): string => path.join(root, '.sequence', 'memory', 'NOTES.md');
const DAY = 86_400_000;

let seq = 0;
function turn(root: string, text: string, over: Partial<TurnInput> = {}): string {
  const id = over.id ?? `t${++seq}`;
  recordTurn(root, { id, chat: 'c1', agent: 'claude', at: (seq + 1) * 1000, text, status: 'done', ...over });
  return id;
}
const NOT_DONE = parseAskLine('x\n<asks>1 add a test for the missing file case: not done: no test runner is set up in this package</asks>');
const NOT_DONE_NO_REASON = parseAskLine('x\n<asks>1 add a test for the missing file case: not done</asks>');

test('a repeated ask becomes ONE pending note with both turn ids as evidence, and nothing is written to the notes file', () => {
  const root = tmp();
  const a = turn(root, 'make the table header sticky when i scroll the invoices page');
  turn(root, 'add a column for the due date');
  const b = turn(root, 'the table header on invoices still isnt sticky, please make it stick when scrolling');
  const out = runSignalLoop(root);
  assert.equal(out.written.length, 1);
  const p = listRefineProposals(root)[0]!;
  assert.equal(p.status, 'pending');
  assert.deepEqual(p.evidenceRefs.runIds, [a, b]);
  assert.deepEqual(p.kinds, ['repeated_ask']);
  assert.equal(p.source, 'signals');
  assert.match(p.note ?? '', /had to be asked twice/);
  assert.equal(fs.existsSync(notesPath(root)), false, 'proposed, not applied');
  assert.equal(runSignalLoop(root).written.length, 0, 'the same evidence again changes nothing');
});

test('a single not-done report with the agent’s own reason is enough; without a reason, or a lone stop, it is not', () => {
  const root = tmp();
  turn(root, 'add a test for the missing file case', { ledger: NOT_DONE_NO_REASON });
  turn(root, 'rewrite the whole layout grid to use container queries', { status: 'stopped' });
  assert.equal(runSignalLoop(root).written.length, 0);
  turn(root, 'add a test for the missing file case', { ledger: NOT_DONE, chat: 'c2' });
  const out = runSignalLoop(root);
  assert.equal(out.written.length, 1);
  const tip = parseTip(out.written[0]!.note!);
  assert.match(tip, /no test runner is set up in this package/);
  assert.match(tip, /was reported not done before/);
});

const parseTip = (note: string): string => note.replace(/^- \[[^\]]+\] /, '').replace(/ \{.*$/, '');

test('weak signals need two turns: a stop and an Edit from here on similar asks together are a candidate', () => {
  const root = tmp();
  turn(root, 'rewrite the whole layout grid to use container queries', { status: 'stopped' });
  turn(root, 'rewrite the whole layout grid with container queries instead', { status: 'stopped', chat: 'c2' });
  const out = runSignalLoop(root);
  assert.equal(out.written.length, 1);
  assert.deepEqual(out.written[0]!.kinds, ['stopped']);
  assert.match(out.written[0]!.note!, /stopped by the person midway/);
});

test('the queue is short: at most three notes wait at once', () => {
  const root = tmp();
  const topics = ['database migration seed script rename', 'pagination cursor audit table sizes', 'telemetry environment variable startup notice', 'footer build version release notes link'];
  topics.forEach((t, i) => turn(root, t, { ledger: parseAskLine(`x\n<asks>1 ${t}: not done: blocked by thing ${i}</asks>`), chat: `q${i}` }));
  const out = runSignalLoop(root);
  assert.equal(out.written.length, 3);
  assert.equal(listRefineProposals(root).filter((p) => p.status === 'pending').length, 3);
});

test('Dismiss is remembered: the same failure again does not bring the note back, nor does a rewording of it', () => {
  const root = tmp();
  turn(root, 'add a test for the missing file case', { ledger: NOT_DONE });
  const id = runSignalLoop(root).written[0]!.id;
  assert.ok(dismissProposal(root, id).ok);
  turn(root, 'add a test for the missing file case', { ledger: NOT_DONE, chat: 'c9' });
  assert.equal(runSignalLoop(root).written.length, 0);
  assert.equal(readRefineProposal(root, id)!.status, 'denied');
  assert.equal(listRefineProposals(root).length, 1);
});

test('Auto is off by default: a new note waits for an Accept; with Auto on it is added at once, with its outcome record, and shows as undoable', () => {
  const root = tmp();
  turn(root, 'add a test for the missing file case', { ledger: NOT_DONE });
  const off = runSignalLoop(root, { auto: false });
  assert.deepEqual(off.autoAccepted, []);
  assert.equal(fs.existsSync(notesPath(root)), false);
  assert.deepEqual(refineCards(root).map((c) => c.state), ['pending']);

  const root2 = tmp();
  turn(root2, 'which file defines the backoff schedule', { chat: 'z' });
  turn(root2, 'i asked which file defines the backoff schedule', { chat: 'z' });
  const on = runSignalLoop(root2, { auto: true });
  assert.equal(on.autoAccepted.length, 1);
  assert.equal(readNotes(root2).length, 1);
  assert.equal(readOutcomeStore(root2, on.autoAccepted[0]!)?.by, 'auto');
  const [card] = refineCards(root2);
  assert.equal(card!.state, 'auto');
  assert.ok(undoProposal(root2, card!.id).ok, 'Undo takes it out again');
  assert.equal(fs.existsSync(notesPath(root2)), false);
  assert.equal(readAgentSettings(tmp()).autoRefine, false, 'the setting defaults to off');
});

test('a card says what the person needs and nothing else: the sentence, the kinds, and their own words from the evidence turns', () => {
  const root = tmp();
  turn(root, 'which file defines the backoff schedule');
  turn(root, 'i asked which file defines the backoff schedule');
  runSignalLoop(root);
  const [c] = refineCards(root);
  assert.equal(c!.state, 'pending');
  assert.match(c!.tip, /had to be asked twice/);
  assert.deepEqual(c!.why.kinds, ['repeated_ask']);
  assert.equal(c!.why.turns.length, 2);
  assert.deepEqual(c!.why.asks, ['which file defines the backoff schedule', 'i asked which file defines the backoff schedule']);
});

/* ------------------------------ recurrence ------------------------------- */

/** A note on the topic "sticky table header invoices", accepted at t=1000 days; returns its id. */
function acceptedNote(root: string, at: number): string {
  turn(root, 'make the table header sticky on the invoices page', { at: at - 3 * DAY });
  turn(root, 'the table header on the invoices page still is not sticky', { at: at - 2 * DAY });
  turn(root, 'make the invoices table header sticky please', { at: at - 1.5 * DAY, id: `ok-${at}` });
  runSignalLoop(root, { now: at });
  const p = listRefineProposals(root).find((x) => x.status === 'pending')!;
  const r = acceptProposal(root, p.id);
  assert.ok(r.ok);
  /* the baseline is dated at the real accept time; pin it for the test */
  const store = readOutcomeStore(root, p.id)!;
  fs.writeFileSync(path.join(root, '.sequence', 'refinements', p.id, 'outcome.json'), JSON.stringify({ ...store, acceptedAt: at }));
  return p.id;
}

test('judge: helped, no change, worse, and too early to say', () => {
  const w = (asks: number, failed: number) => ({ asks, failed, rate: asks ? failed / asks : null });
  const none = w(0, 0);
  assert.equal(judge(w(4, 2), w(5, 0), none, none), 'helped');
  assert.equal(judge(w(4, 2), w(5, 1), none, none), 'helped', 'a rate at half or below counts');
  assert.equal(judge(w(4, 2), w(5, 2), none, none), 'no_change');
  assert.equal(judge(w(4, 1), w(5, 4), none, none), 'worse');
  assert.equal(judge(w(4, 2), w(MIN_AFTER - 1, 0), none, none), 'too_early');
  assert.equal(judge(w(4, 2), w(5, 0), w(20, 2), w(20, 7)), 'worse', 'better on its topic, much worse everywhere else');
});

/** An ask on the note's topic in its own chat, so no other turn of the test is its "repeat"; `bad` makes the agent report it not done. */
function after(root: string, i: number, at: number, bad: boolean): void {
  const text = `make the invoices table header sticky, variant ${i}`;
  turn(root, text, { at, chat: `after-${at}-${i}`, ...(bad ? { ledger: parseAskLine(`x\n<asks>1 ${text}: not done: the header is inside a scroll container</asks>`) } : {}) });
}

test('recurrence: asks on the note’s topic that no longer fail say "helped"; the card stays quiet', () => {
  const root = tmp();
  const at = 1000 * DAY;
  const id = acceptedNote(root, at);
  for (let i = 0; i < 4; i++) after(root, i, at + (i + 1) * 1000, false);
  const o = evaluateOutcome(root, id, at + DAY)!;
  assert.equal(o.verdict, 'helped', o.summary);
  assert.equal(o.flagged, false);
  assert.equal(o.after.asks, 4);
  assert.deepEqual(refineCards(root), []);
});

test('recurrence: the same failure still coming back flags the note for removal, and Keep silences the card without deleting anything', () => {
  const root = tmp();
  const at = 2000 * DAY;
  const id = acceptedNote(root, at);
  for (let i = 0; i < 4; i++) after(root, i, at + (i + 1) * 1000, i === 1);
  const o = evaluateOutcome(root, id, at + DAY)!;
  assert.equal(o.verdict, 'no_change', o.summary);
  assert.ok(o.flagged);
  const [card] = refineCards(root);
  assert.equal(card!.state, 'flagged');
  assert.match(card!.summary ?? '', /No change/);
  assert.ok(markKept(root, id));
  assert.deepEqual(refineCards(root), []);
  assert.equal(readNotes(root).length, 1, 'Keep leaves the note in the file');
  assert.equal(readOutcomeStore(root, id)!.last?.verdict, 'no_change', 'and the verdict stays on record');
});

test('a note the tracker says makes things worse stops reaching prompts while the person decides; the file is untouched', () => {
  const root = tmp();
  const at = 3000 * DAY;
  const id = acceptedNote(root, at);
  for (let i = 0; i < 5; i++) after(root, i, at + (i + 1) * 1000, i < 3);
  const o = evaluateOutcome(root, id, at + DAY)!;
  assert.equal(o.verdict, 'worse', o.summary);
  assert.deepEqual([...worseNoteIds(root, listRefineProposals(root))], [id]);
  assert.deepEqual(refineCards(root).map((c) => c.state), ['flagged']);
  assert.equal(readNotes(root).length, 1);
  assert.ok(undoProposal(root, id).ok, 'Remove is the same Undo');
  assert.equal(readNotes(root).length, 0);
});

test('tip text states what happened to the ask and adds no advice the evidence does not hold', () => {
  const root = tmp();
  const [c] = clusterSignals(
    [
      { t: 'signal', kind: 'fanout_discarded', turn: 'a', evidence: ['a'], chat: 'x', agent: 'codex', at: 1, text: 'implement the csv import for contacts' },
      { t: 'signal', kind: 'fanout_discarded', turn: 'b', evidence: ['b'], chat: 'y', agent: 'claude', at: 2, text: 'implement the csv import for contacts' },
    ],
  );
  assert.ok(qualifies(c!));
  assert.equal(tipFor(c!), 'Several agents tried "implement the csv import for contacts" and the person discarded this one\'s answer.');
});

/* -------------------------- through the real server ------------------------- */

async function serve(store: string, repo: string | null, extra: Record<string, unknown> = {}): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: store, acpTurn: { answerQuietMs: 150, stopGraceMs: 150, statusEveryMs: 60, killGraceMs: 0 }, ...extra });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}
const json = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;
const waitFor = async <T>(f: () => T | undefined | false, ms = 4000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 40));
  }
};

test('a Codex/Claude turn that reports a request not done becomes a card; Accept adds the note; Undo removes it; Auto is off until it is switched on', async () => {
  const repo = fs.realpathSync(tmp());
  const store = path.join(repo, '.sequence');
  fs.mkdirSync(store, { recursive: true });
  addAgent(store, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const chatId = ensureSessionsMigrated(repo).activeId;
  const srv = await serve(store, repo);
  try {
    const REPLY = 'Done except one.\n<asks>1 rename the loader: done; 2 add a test for the missing file case: not done: no test runner is set up in this package</asks> ';
    const res = await fetch(`${srv.base}/api/acp/run-node`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentRef: 'mock', prompt: `rename the loader and add a test for the missing file case REPLY<<${REPLY}>>`, askLedger: true, chatId, sessionKey: `chat::${chatId}::mock` }) });
    assert.equal(res.status, 200);
    const got = await waitFor(() => {
      const p = listRefineProposals(repo);
      return p.length ? p : undefined;
    });
    assert.equal(got[0]!.status, 'pending');
    assert.deepEqual(got[0]!.kinds, ['ask_not_done']);
    assert.equal(fs.existsSync(notesPath(repo)), false, 'nothing applied without an Accept');

    const c1 = await json(await fetch(`${srv.base}/api/harness/refine/cards`));
    assert.equal(c1.auto, false);
    const card = (c1.cards as Array<{ id: string; state: string; tip: string }>)[0]!;
    assert.equal(card.state, 'pending');
    assert.match(card.tip, /no test runner is set up/);

    const acc = await fetch(`${srv.base}/api/harness/refine/${card.id}/accept`, { method: 'POST' });
    assert.equal(acc.status, 200);
    assert.equal(readNotes(repo).length, 1);
    const undo = await fetch(`${srv.base}/api/harness/refine/${card.id}/rollback`, { method: 'POST' });
    assert.equal(undo.status, 200);
    assert.equal(readNotes(repo).length, 0);
    const c2 = await json(await fetch(`${srv.base}/api/harness/refine/cards`));
    assert.deepEqual(c2.cards, [], 'an undone note leaves no card');

    const bad = await fetch(`${srv.base}/api/agent-settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoRefine: 'yes' }) });
    assert.equal(bad.status, 400);
    const on = await json(await fetch(`${srv.base}/api/agent-settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoRefine: true }) }));
    assert.equal(on.autoRefine, true);
    assert.equal(readAgentSettings(store).autoRefine, true);
  } finally {
    await srv.close();
  }
});

test('a local ask: an accepted note is in the prompt the model receives, and the turn is written to the same log', async () => {
  const dir = tmp();
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  fs.mkdirSync(path.join(repo, '.sequence', 'memory'), { recursive: true });
  fs.writeFileSync(notesPath(repo), '# Repo memory\n\n- [signal:x] "what does the backend do" was reported not done before: the backend folder is generated. Check that first. {turns: a, b} <!--n:x1-->\n');
  const mock = await startMockProvider(() => ({ text: 'The backend serves the API.' }));
  const srv = await serve(path.join(dir, 'store'), repo);
  try {
    await fetch(`${srv.base}/api/ai-config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: 'sk-ant-test-REFINE-1' }) });
    const res = await fetch(`${srv.base}/api/ask/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'What does the backend do?', intents: [{ id: 'impact', subject: 'backend', subjectNodeId: 'svc:backend' }] }) });
    await res.text();
    const sent = JSON.stringify(mock.requests.map((r) => r.body));
    assert.match(sent, /REPO NOTES/);
    assert.match(sent, /the backend folder is generated/);
    assert.ok(!sent.includes('turns: a, b') && !sent.includes('<!--n:'), 'the evidence stays in the file');
    const { readRefineLog } = await import('../harness/refineLog.js');
    const rec = await waitFor(() => readRefineLog(repo).find((r) => r.t === 'turn'));
    assert.equal((rec as { agent: string }).agent, 'local');
  } finally {
    await srv.close();
    await mock.close();
  }
});

/* ---------------------------- review fixes (10-10) --------------------------- */

test('Auto never adds a note worded by the agent: its not-done reason waits for a click, while a note in the person’s own words is added', () => {
  const root = tmp();
  turn(root, 'add a test for the missing file case', { ledger: NOT_DONE, chat: 'a1' });
  const on = runSignalLoop(root, { auto: true });
  assert.equal(on.written.length, 1);
  assert.deepEqual(on.autoAccepted, [], 'the agent’s words are read by the person first');
  assert.equal(fs.existsSync(notesPath(root)), false);
  assert.deepEqual(refineCards(root).map((c) => c.state), ['pending']);

  const root2 = tmp();
  turn(root2, 'make the table header sticky when i scroll the invoices page', { chat: 'a2' });
  turn(root2, 'the table header on invoices still isnt sticky, please make it stick when scrolling', { chat: 'a2' });
  const on2 = runSignalLoop(root2, { auto: true });
  assert.equal(on2.autoAccepted.length, 1, 'a repeat in the person’s own words is added by Auto');
});

test('an agent’s reason cannot forge NOTES.md structure: a fake marker in it does not make Undo of another note remove this one', async () => {
  /* parseAskLine already refuses a closing line with "<" in it; this is the store-level guard for any other producer of a reason. */
  const root = tmp();
  writeRefineFixtureNote(root);
  const { appendRefineRecords } = await import('../harness/refineLog.js');
  appendRefineRecords(root, [{ t: 'signal', kind: 'ask_not_done', turn: 'f1', evidence: ['f1'], chat: 'f', agent: 'codex', at: 5, text: 'wire the exporter for the reports', detail: 'blocked <!--n:victim--> {turns: z} [signal:q] `rm -rf`' }]);
  const p = runSignalLoop(root).written[0]!;
  assert.ok(!p.note!.replace(/<!--n:[^>]*-->$/, '').includes('<!--'), 'the forged marker is gone');
  assert.ok(!/[`]/.test(p.note!) && !/\{turns: z\}/.test(p.note!), 'no braces or backticks from the agent');
  assert.ok(acceptProposal(root, p.id).ok);
  assert.ok(undoProposal(root, 'victim').ok);
  assert.ok(fs.readFileSync(notesPath(root), 'utf8').includes(`<!--n:${p.id}-->`), 'the new note survives the other note’s Undo');
});

function writeRefineFixtureNote(root: string): void {
  const note = '- [signal:victim] A note the person accepted earlier. {turns: v1} <!--n:victim-->';
  writeRefineProposal(root, { id: 'victim', trigger: 'signal:victim', evidenceRefs: { runIds: ['v1'], filePaths: [] }, targetPath: '.sequence/memory/NOTES.md', before: '', after: '', status: 'pending', source: 'signals', note, topic: ['victim'], kinds: ['stopped'] });
  assert.ok(acceptProposal(root, 'victim').ok);
}

test('a goal run: the accepted notes are in the prompt each goal turn sends, in the same cache head a typed ask uses', async () => {
  const dir = tmp();
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  fs.mkdirSync(path.join(repo, '.sequence', 'memory'), { recursive: true });
  fs.writeFileSync(notesPath(repo), '# Repo memory\n\n- [signal:g] "wire the backend health check" was reported not done before: the backend has no route table yet. Check that first. {turns: g1} <!--n:g1-->\n');
  const id = createSession(repo).id;
  updateSession(repo, id, { goal: 'wire the backend health check', plan: [{ id: 's1', text: 'Add the health route to the backend', status: 'open' }] });
  const mock = await startMockProvider(() => ({ text: 'Working on it.' }));
  const srv = await serve(path.join(dir, 'store'), repo);
  try {
    await fetch(`${srv.base}/api/ai-config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: 'sk-ant-test-REFINE-2' }) });
    const start = await fetch(`${srv.base}/api/sessions/${id}/goal-run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permission: 'build' }) });
    assert.equal(start.status, 200, await start.clone().text());
    await waitFor(() => mock.requests.length > 0, 8000);
    const sent = JSON.stringify(mock.requests[0]!.body);
    assert.match(sent, /REPO NOTES/);
    assert.match(sent, /the backend has no route table yet/);
    assert.ok(!sent.includes('<!--n:'), 'the marker stays in the file');
  } finally {
    await fetch(`${srv.base}/api/sessions/${id}/goal-run/stop`, { method: 'POST' }).catch(() => {});
    await srv.close();
    await mock.close();
  }
});
