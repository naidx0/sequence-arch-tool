#!/usr/bin/env node
// Deterministic replay for the refine loop. No model, no network, no spend.
//
//   node run.mjs --data <dir with replay-cases.json + labelled-turns.json + SEALED.txt> [--out <dir>]
//
// REFUSES to run if the two data files do not hash to what SEALED.txt recorded
// before any code existed. Prints one JSON document and a short table.
//
// What it measures (all deterministic):
//   A. detector precision/recall on the 120 hand-labelled turns (turn level)
//   B. for the 60 failed asks: does a failure report become a qualifying note,
//      does the user's repeat get flagged as a repeat (and do 300 non-repeats not),
//      and, with all the notes accepted into ONE pool, is the right note in the
//      injected set for the repeat (ON) versus never (OFF), at what token cost,
//      with what wrong-note rate for unrelated asks.
// What it cannot measure: whether the note changes what a model does. See
// on-pc/README.md for the script that does.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dataDir = path.resolve(arg('--data', path.join(here, 'data')));
const outDir = arg('--out', null);
const dist = path.resolve(here, '../../../packages/analyzer/dist');
const imp = (p) => import(pathToFileURL(path.join(dist, p)).href);
const { parseAskLine } = await import(pathToFileURL(path.resolve(here, '../../../packages/schema/dist/index.js')).href);

// ---- seal check
const sealTxt = fs.readFileSync(path.join(dataDir, 'SEALED.txt'), 'utf8');
for (const f of ['replay-cases.json', 'labelled-turns.json']) {
  const h = createHash('sha256').update(fs.readFileSync(path.join(dataDir, f))).digest('hex');
  if (!sealTxt.includes(`${h}  data/${f}`)) { console.error(`SEAL BROKEN: ${f} hashes to ${h}, not what SEALED.txt recorded`); process.exit(2); }
}
const cases = JSON.parse(fs.readFileSync(path.join(dataDir, 'replay-cases.json'), 'utf8')).cases;
const labelled = JSON.parse(fs.readFileSync(path.join(dataDir, 'labelled-turns.json'), 'utf8'));

const { evalSet } = await import(pathToFileURL(path.join(here, 'detect-eval.mjs')).href);
const { recordTurn, readSignals } = await imp('harness/refineSignals.js');
const { clusterSignals, qualifies, proposalFor, tipFor } = await imp('harness/refineCandidates.js');
const { writeRefineProposal } = await imp('harness/refineProposal.js');
const { acceptProposal } = await imp('harness/refineApply.js');
const { readNotes, selectNotes, renderNoteLines, buildAgentBlock, ThreadNoteLedger, NOTES_STABLE_CHARS } = await imp('harness/refineNotes.js');
const { contentTokens } = await imp('harness/refineText.js');

const wilson = (k, n) => { if (!n) return [null, null]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const round = (x, d = 3) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);
const tokensOf = (lines) => Math.ceil(lines.join('\n').length / 4);

// ---- A. detectors on the labelled set
const A = evalSet(labelled);
const [pLo, pHi] = wilson(A.tp, A.tp + A.fp);
const [rLo, rHi] = wilson(A.tp, A.tp + A.fn);

// ---- B. the 60 failed asks
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refine-replay-'));
const clean = (s) => s.replace(/[;<>]/g, ',').replace(/:/g, ' -');
const B = { cases: cases.length, parsedNotDone: 0, repeatFlagged: 0, nonRepeatFlagged: 0, nonRepeats: 0 };
const caseTurn = new Map();
let t = 0;
for (const c of cases) {
  const chat = `k-${c.id}`;
  const id = `a-${c.id}`;
  caseTurn.set(c.id, id);
  const ledger = parseAskLine(`ok\n<asks>1 ${clean(c.ask)}: not done: ${clean(c.reason)}</asks>`);
  if (ledger && ledger.open.length === 1) B.parsedNotDone += 1;
  recordTurn(tmp, { id, chat, agent: 'claude', at: ++t * 1000, text: c.ask, status: 'done', ledger });
}
const sigs = readSignals(tmp).filter((s) => s.kind === 'ask_not_done');
B.signalsFromReports = sigs.length;
const clusters = clusterSignals(sigs);
const qual = clusters.filter(qualifies);
B.clusters = clusters.length;
B.qualifyingNotes = qual.length;
// accept every qualifying note into ONE pool (the UI queue cap is bypassed on purpose: this builds the pool as if the person had accepted them all)
const noteOfTurn = new Map();
for (const c of qual) {
  const p = proposalFor(c, fs.existsSync(path.join(tmp, '.sequence/memory/NOTES.md')) ? fs.readFileSync(path.join(tmp, '.sequence/memory/NOTES.md'), 'utf8') : '');
  writeRefineProposal(tmp, p);
  const r = acceptProposal(tmp, p.id, 'person');
  if (!r.ok) throw new Error(`accept failed: ${r.error}`);
  for (const tid of c.turnIds) noteOfTurn.set(tid, p.id);
}
const notes = readNotes(tmp);
B.poolNotes = notes.length;

// repeat detection: the user's retyped ask against its original (done turn in same chat), and 5 non-repeats per case in that chat
const { findRepeat } = await imp('harness/refineSignals.js');
// As recordTurn does: a turn the agent reported not done corroborates a later restatement of it.
const fellShort = new Set(readSignals(tmp).filter((s) => s.kind === 'ask_not_done' || s.kind === 'edit_from_here').map((s) => s.turn));
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const prior = [{ t: 'turn', id: caseTurn.get(c.id), chat: 'x', agent: 'claude', at: 1, text: c.ask, status: 'done' }];
  if (findRepeat({ text: c.repeat }, prior, fellShort)) B.repeatFlagged += 1;
  for (let j = 1; j <= 5; j++) {
    const d = cases[(i + 7 * j) % cases.length];
    if (d.id === c.id) continue;
    B.nonRepeats += 1;
    if (findRepeat({ text: d.ask }, prior, fellShort)) B.nonRepeatFlagged += 1;
  }
}

// retrieval: ON (stable + matched) vs stable only vs OFF, repeat asks and distractors
const hitOf = (sel, noteId) => sel.stable.some((n) => n.id === noteId) || sel.matched.some((n) => n.id === noteId);
let hitOn = 0, hitStable = 0, hitMatchedOnly = 0, queries = 0;
let distractQ = 0, distractWrongMatched = 0, distractAnyMatched = 0;
const tok = { stable: tokensOf(renderNoteLines(selectNotes(notes, null).stable)), perAsk: [], agentFirst: [] };
let ledgerBuild = 0;
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const nid = noteOfTurn.get(caseTurn.get(c.id));
  if (!nid) continue;
  queries += 1;
  const sel = selectNotes(notes, c.repeat);
  if (hitOf(sel, nid)) hitOn += 1;
  if (selectNotes(notes, c.repeat, { maxMatched: 0 }).stable.some((n) => n.id === nid)) hitStable += 1;
  if (sel.matched.some((n) => n.id === nid)) hitMatchedOnly += 1;
  tok.perAsk.push(tokensOf([...renderNoteLines(sel.stable), ...renderNoteLines(sel.matched, 'x')]));
  for (let j = 1; j <= 5; j++) {
    const d = cases[(i + 7 * j) % cases.length];
    if (d.id === c.id) continue;
    distractQ += 1;
    const ds = selectNotes(notes, d.ask);
    if (ds.matched.length) distractAnyMatched += 1;
    if (ds.matched.some((n) => n.id === nid)) distractWrongMatched += 1;
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
// Claude/Codex first turn on a thread vs later turns, with a skills-free repo
const led = new ThreadNoteLedger();
const first = buildAgentBlock(tmp, cases[0].repeat, 'chat::k::claude', 'th', led);
const afterFirst = (() => { led.mark('chat::k::claude', 'th', first.sent); return buildAgentBlock(tmp, cases[1].repeat, 'chat::k::claude', 'th', led); })();

const result = {
  protocol: 'tools/bench/refine-replay/run.mjs; data sealed in SEALED.txt before code',
  A_detectors_on_120_labelled_turns: {
    turns: A.turns, failedTruth: A.failedTruth, tp: A.tp, fp: A.fp, fn: A.fn,
    precision: round(A.precision), precisionCI95: [round(pLo), round(pHi)],
    recall: round(A.recall), recallCI95: [round(rLo), round(rHi)],
    perKind: A.per, misses: A.wrong.map(([k, id, what, p]) => `${k} ${id} ${what}: ${p}`),
  },
  B_replay_60_failed_asks: {
    ...B,
    repeatRecall: round(B.repeatFlagged / B.cases), repeatRecallCI95: wilson(B.repeatFlagged, B.cases).map((x) => round(x)),
    nonRepeatFalseFlagRate: round(B.nonRepeatFlagged / B.nonRepeats), nonRepeatFalseFlagCI95: wilson(B.nonRepeatFlagged, B.nonRepeats).map((x) => round(x)),
    retrieval: {
      queries,
      OFF_noteInPrompt: 0,
      ON_noteInPrompt: hitOn, ON_rate: round(hitOn / queries), ON_CI95: wilson(hitOn, queries).map((x) => round(x)),
      ON_stableTierOnly: hitStable, ON_stableTierOnly_rate: round(hitStable / queries),
      ON_viaQuestionMatch: hitMatchedOnly,
      random8_expected_rate: round(Math.min(1, 8 / Math.max(1, notes.length))),
      distractorQueries: distractQ, distractorGotAnyMatchedNote: distractAnyMatched, distractorGotThisCasesNote: distractWrongMatched,
    },
    tokens: {
      OFF: 0,
      alwaysOnBlock_tokens: tok.stable, budgetChars: NOTES_STABLE_CHARS,
      perLocalAsk_ON_mean: round(mean(tok.perAsk), 1), p50: pct(tok.perAsk, 0.5), p95: pct(tok.perAsk, 0.95), max: Math.max(...tok.perAsk),
      claudeCodex_firstTurn_tokens: first.tokens, claudeCodex_laterTurns_tokens: afterFirst.tokens,
    },
    sampleTips: qual.slice(0, 3).map(tipFor),
  },
};
console.log(JSON.stringify(result, null, 1));
if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(result, null, 1)); }
fs.rmSync(tmp, { recursive: true, force: true });
