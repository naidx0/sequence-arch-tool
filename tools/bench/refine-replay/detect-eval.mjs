// Detector precision/recall on a hand-labelled turn set (turn level).
// usage: node detect-eval.mjs <labelled.json> [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../../packages/analyzer/dist');
const imp = (p) => import(pathToFileURL(path.join(dist, p)).href);
const { parseAskLine } = await import(pathToFileURL(path.resolve(here, '../../../packages/schema/dist/index.js')).href);
const { recordTurn, recordEditFromHere, recordFanoutDiscard, readSignals } = await imp('harness/refineSignals.js');

const FAILED = new Set(['not_done', 'stopped', 'repeated', 'edit', 'discarded']);
const labelsOf = (t) => t.label.split('+').filter((l) => !l.startsWith('repeat->'));

export function evalSet(data) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refine-detect-'));
  const byChat = new Map();
  for (const t of data.turns) (byChat.get(t.chat) ?? byChat.set(t.chat, []).get(t.chat)).push(t);
  for (const [chat, turns] of byChat) {
    for (const t of turns) {
      const ledger = t.ledger ? parseAskLine(`reply\n<asks>${t.ledger}</asks>`) : null;
      recordTurn(root, { id: t.id, chat, agent: t.agent, at: t.n * 60000, text: t.prompt, status: t.status, ledger });
    }
  }
  for (const e of data.events ?? []) {
    const turns = byChat.get(e.chat) ?? [];
    const i = turns.findIndex((t) => t.id === e.turn);
    if (e.type === 'rewind') {
      recordEditFromHere(root, e.chat, turns.slice(i).map((t) => ({ id: t.id, agent: t.agent, text: t.prompt, at: t.n * 60000 })), 9e6);
    } else if (e.type === 'fanout_discarded') {
      recordFanoutDiscard(root, [{ chat: e.chat, agent: turns[i].agent, prompt: turns[i].prompt, turnIds: [turns[i].id] }], 9e6);
    }
  }
  const sigs = readSignals(root);
  const predicted = new Map(); // turn -> kinds
  for (const s of sigs) (predicted.get(s.turn) ?? predicted.set(s.turn, new Set()).get(s.turn)).add(s.kind);
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const wrong = [];
  const per = {};
  for (const t of data.turns) {
    const truth = labelsOf(t).some((l) => FAILED.has(l));
    const pred = predicted.has(t.id);
    if (truth && pred) tp++; else if (!truth && pred) { fp++; wrong.push(['FP', t.id, [...predicted.get(t.id)].join(','), t.prompt]); }
    else if (truth && !pred) { fn++; wrong.push(['FN', t.id, t.label, t.prompt]); } else tn++;
  }
  // per kind
  const kindMap = { not_done: 'ask_not_done', stopped: 'stopped', repeated: 'repeated_ask', edit: 'edit_from_here', discarded: 'fanout_discarded' };
  for (const [lab, kind] of Object.entries(kindMap)) {
    const truthIds = new Set(data.turns.filter((t) => labelsOf(t).includes(lab)).map((t) => t.id));
    const predIds = new Set(sigs.filter((s) => s.kind === kind).map((s) => s.turn));
    const k = { truth: truthIds.size, predicted: predIds.size, hit: [...predIds].filter((i) => truthIds.has(i)).length };
    per[kind] = { ...k, precision: k.predicted ? k.hit / k.predicted : null, recall: k.truth ? k.hit / k.truth : null };
  }
  fs.rmSync(root, { recursive: true, force: true });
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return { turns: data.turns.length, failedTruth: tp + fn, tp, fp, fn, tn, precision, recall, per, wrong };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const r = evalSet(data);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`turns ${r.turns}  failed(truth) ${r.failedTruth}  tp ${r.tp} fp ${r.fp} fn ${r.fn}  precision ${r.precision?.toFixed(3)} recall ${r.recall?.toFixed(3)}`);
    for (const [k, v] of Object.entries(r.per)) console.log(' ', k.padEnd(18), JSON.stringify(v));
    for (const w of r.wrong) console.log('  ', ...w);
  }
}
