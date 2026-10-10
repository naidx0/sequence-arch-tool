/**
 * Failure signals from every provider (harness/refineSignals.ts): the five the
 * ask names, each with the turn ids it rests on, and the two that cannot be
 * recovered later (Edit from here, a discarded best-of-N sibling) written when
 * they happen.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAskLine } from '@sequence/schema';
import { detectTurnSignals, findRepeat, readSignals, recordEditFromHere, recordFanoutDiscard, recordTurn, REPEAT_OVERLAP } from '../harness/refineSignals.js';
import { readRefineLog, type TurnRecord } from '../harness/refineLog.js';
import { contentTokens, jaccard } from '../harness/refineText.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';
import { recordAgentRun } from '../server/agentChatStore.js';
import { rewindChat, undoRewind } from '../server/agentRewind.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'refine-signals-'));
const turn = (id: string, text: string, status: TurnRecord['status'] = 'done', at = 0): TurnRecord => ({ t: 'turn', id, chat: 'c', agent: 'claude', at, text, status });
const input = (id: string, text: string, over: Record<string, unknown> = {}) => ({ id, chat: 'c', agent: 'claude', at: 1, text, status: 'done' as const, ...over });

test('ask_not_done: the agent’s own closing line names the request and its reason, on the turn that reported it', () => {
  const ledger = parseAskLine('ok\n<asks>1 fix the login test: done; 2 bump playwright: not done: the lockfile pins it</asks>');
  const sigs = detectTurnSignals(input('t1', 'fix the login test and bump playwright', { ledger }), []);
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0]!.kind, 'ask_not_done');
  assert.equal(sigs[0]!.turn, 't1');
  assert.deepEqual(sigs[0]!.evidence, ['t1']);
  assert.equal(sigs[0]!.text, 'bump playwright');
  assert.equal(sigs[0]!.detail, 'the lockfile pins it');
});

test('a reply that closed every request, or had no closing line, carries no signal', () => {
  assert.deepEqual(detectTurnSignals(input('t1', 'a b c', { ledger: parseAskLine('x\n<asks>1 a: done; 2 b: done</asks>') }), []), []);
  assert.deepEqual(detectTurnSignals(input('t2', 'just a question about the build'), []), []);
});

test('stopped: a turn the person stopped midway is a signal; a turn that failed on the provider’s side is not', () => {
  assert.equal(detectTurnSignals(input('t1', 'rewrite the whole layout grid', { status: 'stopped' }), [])[0]!.kind, 'stopped');
  assert.deepEqual(detectTurnSignals(input('t2', 'rewrite the whole layout grid', { status: 'failed' }), []), []);
});

test('repeated_ask: the same request typed again points at the EARLIER turn and names both ids', () => {
  const prior = [turn('t1', 'which file defines the backoff schedule')];
  const sigs = detectTurnSignals(input('t4', 'i asked which file defines the backoff schedule'), prior);
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0]!.kind, 'repeated_ask');
  assert.equal(sigs[0]!.turn, 't1');
  assert.deepEqual(sigs[0]!.evidence, ['t1', 't4']);
});

test('repeated_ask: wording that says "still" lowers the overlap needed; without it the 0.6 rule holds', () => {
  const prior = [turn('t1', 'fix the flaky login test and bump the playwright version')];
  const cued = 'the login test is still flaky after the playwright bump, and the readme';
  const plain = 'the login test is flaky after the playwright bump, and the readme';
  assert.ok(jaccard(contentTokens(cued), contentTokens(prior[0]!.text)) < REPEAT_OVERLAP, 'both sit under the plain bar');
  assert.ok(findRepeat({ text: cued }, prior), 'the cued restatement is found');
  assert.equal(findRepeat({ text: plain }, prior), null, 'the same words without the cue are not');
  assert.equal(findRepeat({ text: 'sort the invoices table by due date by default' }, [turn('t2', 'make the table header sticky on the invoices page')]), null, 'a different request on the same page is not a repeat');
});

test('repeated_ask: asking again after a turn that failed or was stopped is a retry, not a repeat', () => {
  const text = 'migrate the settings page to the new form components';
  assert.equal(findRepeat({ text }, [turn('t1', text, 'failed')]), null);
  assert.equal(findRepeat({ text }, [turn('t1', text, 'stopped')]), null);
  assert.ok(findRepeat({ text }, [turn('t1', text, 'done')], new Set(['t1'])));
});

test('repeated_ask needs more than similar words: a re-run with no complaint, of a turn nobody said fell short, is not a repeat', () => {
  /* The sealed set's false positives, in their own shape: the same command run twice, and the same change on a second page. */
  assert.equal(findRepeat({ text: 'run the telemetry tests' }, [turn('t1', 'run the telemetry tests')]), null);
  assert.equal(findRepeat({ text: 'run the unit tests for the analyzer package and report the failures' }, [turn('t1', 'run the unit tests for the analyzer package and report the failures')]), null);
  assert.equal(findRepeat({ text: 'run the telemetry tests again' }, [turn('t1', 'run the telemetry tests')]), null, 'plain "again" is a re-run, not a complaint');
  /* The same words count once the person complains, or the earlier turn was reported not done or edited. */
  assert.ok(findRepeat({ text: 'the telemetry tests still fail, run the telemetry tests' }, [turn('t1', 'run the telemetry tests')]));
  assert.ok(findRepeat({ text: 'run the telemetry tests' }, [turn('t1', 'run the telemetry tests')], new Set(['t1'])));
  const root = tmp();
  recordTurn(root, input('r1', 'run the telemetry tests and fix the flaky one'));
  assert.deepEqual(recordTurn(root, input('r2', 'run the telemetry tests and fix the flaky one')), [], 'through recordTurn: nothing');
  recordTurn(root, input('r3', 'add the export button to the reports page', { ledger: parseAskLine('x\n<asks>1 add the export button: not done: no reports page yet</asks>') }));
  const sigs = recordTurn(root, input('r4', 'add the export button to the reports page'));
  assert.deepEqual(sigs.map((s) => [s.kind, s.turn]), [['repeated_ask', 'r3']], 'an earlier turn reported not done makes the restatement a repeat');
});

test('repeated_ask: short asks and a new request with the same shape are left alone', () => {
  assert.equal(findRepeat({ text: 'run the tests' }, [turn('t1', 'run the tests')]), null, 'two content words is too little to call a repeat');
  assert.equal(findRepeat({ text: 'now do the same for the header component' }, [turn('t1', 'now do the same for the footer component')]), null);
});

test('recordTurn writes the turn and its signals once, whatever the provider, and never the reply', () => {
  const root = tmp();
  recordTurn(root, input('t1', 'which file defines the backoff schedule', { agent: 'local' }));
  const again = recordTurn(root, input('t2', 'i asked which file defines the backoff schedule', { agent: 'codex' }));
  assert.equal(again.length, 1);
  assert.equal(recordTurn(root, input('t2', 'i asked which file defines the backoff schedule')).length, 0, 'idempotent per turn id');
  const log = readRefineLog(root);
  assert.equal(log.filter((r) => r.t === 'turn').length, 2);
  assert.deepEqual(log.filter((r) => r.t === 'turn').map((r) => (r as TurnRecord).agent), ['local', 'codex']);
  assert.ok(!JSON.stringify(log).includes('reply'));
});

test('a damaged line in the log is skipped, not fatal', () => {
  const root = tmp();
  recordTurn(root, input('t1', 'first request here please'));
  fs.appendFileSync(path.join(root, '.sequence', 'refine', 'log.jsonl'), '{not json\n{"t":"turn"}\n');
  recordTurn(root, input('t2', 'second request there please'));
  assert.equal(readRefineLog(root).filter((r) => r.t === 'turn').length, 2);
});

test('Edit from here is written when it happens: the real rewind cuts the turns, the signal keeps them', () => {
  const root = tmp();
  const chat = ensureSessionsMigrated(root).activeId;
  const run = (id: string, prompt: string, n: number) =>
    recordAgentRun(root, chat, { id, agentRef: 'claude', prompt, text: 'ok', status: 'done', error: null, stopReason: 'end_turn', startedAt: n * 1000, endedAt: n * 1000 + 5, model: null, nodeId: null, tools: [] }, new Date(n * 1000));
  run('a1', 'add pagination to the audit log table', 1);
  run('a2', 'use cursor pagination', 2);
  const out = rewindChat(root, chat, 'a1');
  assert.equal(out?.dropped, 2);
  const sigs = readSignals(root).filter((s) => s.kind === 'edit_from_here');
  assert.equal(sigs.length, 1);
  assert.equal(sigs[0]!.turn, 'a1');
  assert.deepEqual(sigs[0]!.evidence, ['a1', 'a2']);
  assert.equal(sigs[0]!.text, 'add pagination to the audit log table');
});

test('Undo of an Edit from here takes the signal back: the turns are in the chat again, so nothing fell short', () => {
  const root = tmp();
  const chat = ensureSessionsMigrated(root).activeId;
  recordAgentRun(root, chat, { id: 'u1', agentRef: 'claude', prompt: 'add pagination to the audit log table', text: 'ok', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1000, endedAt: 1005, model: null, nodeId: null, tools: [] }, new Date(1000));
  rewindChat(root, chat, 'u1');
  assert.equal(readSignals(root).filter((s) => s.kind === 'edit_from_here').length, 1);
  assert.equal(undoRewind(root, chat)?.restored, 1);
  assert.equal(readSignals(root).filter((s) => s.kind === 'edit_from_here').length, 0);
});

test('recordEditFromHere and recordFanoutDiscard: nothing to record is nothing written', () => {
  const root = tmp();
  assert.deepEqual(recordEditFromHere(root, 'c', []), []);
  assert.deepEqual(recordFanoutDiscard(root, [{ chat: 'x', agent: 'codex', prompt: 'p', turnIds: [] }]), []);
  assert.equal(fs.existsSync(path.join(root, '.sequence', 'refine')), false);
  const [s] = recordFanoutDiscard(root, [{ chat: 'x', agent: 'codex', prompt: 'implement the csv import for contacts', turnIds: ['z1', 'z2'] }]);
  assert.equal(s!.kind, 'fanout_discarded');
  assert.deepEqual(s!.evidence, ['z1', 'z2']);
});

test('the dev set (22 hand-labelled turns) keeps the detector at precision >= 0.8 with every failure found', async () => {
  const mod = await import(pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tools', 'bench', 'refine-replay', 'detect-eval.mjs')).href);
  const data = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tools', 'bench', 'refine-replay', 'data', 'dev-turns.json'), 'utf8'));
  const r = mod.evalSet(data);
  assert.ok(r.precision >= 0.8, `precision ${r.precision}`);
  assert.equal(r.recall, 1);
});
