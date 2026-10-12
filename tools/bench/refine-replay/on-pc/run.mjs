#!/usr/bin/env node
// What needs a real model, as a script to run on Jaden's PC. Spends nothing for `manip`
// (the local model); `harm` uses the user's own Claude/Codex subscription through the
// existing agent-ab harness and is the only step that spends quota. Read README.md first.
//
//   node on-pc/run.mjs manip --server http://127.0.0.1:<port> --repo <attached repo> --data <sealed data dir> [--out dir]
//   node on-pc/run.mjs harm  --agent claude|codex --questions <agent-ab questions.json> --repos <repos.json> --data <dir> [--limit 36] [--out dir]
//
// manip: does an accepted note reach the local model's answer? 60 repeat asks, notes OFF vs ON, same
//        server, same model. Scored by a deterministic check on the reply (see mentionsReason), NOT by
//        a judge model. This is a MANIPULATION CHECK: it says the note was read and used, not that the
//        answer is better. Also counts notes leaking into asks that are about something else.
// harm:  does the notes block cost accuracy or tokens on a task it is not about? agent-ab, plain vs
//        plain + the block of 60 unrelated notes (AB_PREFIX_FILE). Paired F1 and tokens per question.
//
// The seal check, the pool and the token estimate are the SAME code as run.mjs (imported, not copied).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../../..');
const dist = path.join(ROOT, 'packages/analyzer/dist');
const imp = (p) => import(pathToFileURL(path.join(dist, p)).href);
const mode = process.argv[2];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dataDir = path.resolve(arg('--data', ''));
const outDir = path.resolve(arg('--out', path.join(os.tmpdir(), `refine-onpc-${mode}-${Date.now()}`)));
fs.mkdirSync(outDir, { recursive: true });

// ---- seal: refuse to run on data that is not what was hashed before any code
const sealTxt = fs.readFileSync(path.join(dataDir, 'SEALED.txt'), 'utf8');
for (const f of ['replay-cases.json', 'labelled-turns.json']) {
  const h = createHash('sha256').update(fs.readFileSync(path.join(dataDir, f))).digest('hex');
  if (!sealTxt.includes(`${h}  data/${f}`)) { console.error(`SEAL BROKEN: ${f}`); process.exit(2); }
}
const cases = JSON.parse(fs.readFileSync(path.join(dataDir, 'replay-cases.json'), 'utf8')).cases;

const { parseAskLine } = await import(pathToFileURL(path.join(ROOT, 'packages/schema/dist/index.js')).href);
const { recordTurn, readSignals } = await imp('harness/refineSignals.js');
const { clusterSignals, qualifies, proposalFor } = await imp('harness/refineCandidates.js');
const { writeRefineProposal } = await imp('harness/refineProposal.js');
const { acceptProposal } = await imp('harness/refineApply.js');
const { reasonWords, mentionsReason, mcnemarP } = await import('./lib.mjs');
const { readNotes, buildAgentBlock, ThreadNoteLedger } = await imp('harness/refineNotes.js');

const clean = (s) => s.replace(/[;<>]/g, ',').replace(/:/g, ' -');
/** Build the 60-note pool in `root` exactly as the replay does: failure report -> signal -> candidate -> accepted note. */
function buildPool(root) {
  let t = 0;
  for (const c of cases) {
    const ledger = parseAskLine(`ok\n<asks>1 ${clean(c.ask)}: not done: ${clean(c.reason)}</asks>`);
    recordTurn(root, { id: `a-${c.id}`, chat: `k-${c.id}`, agent: 'claude', at: ++t * 1000, text: c.ask, status: 'done', ledger });
  }
  const notesFile = path.join(root, '.sequence/memory/NOTES.md');
  for (const c of clusterSignals(readSignals(root)).filter(qualifies)) {
    const p = proposalFor(c, fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : '');
    writeRefineProposal(root, p);
    if (!acceptProposal(root, p.id, 'person').ok) throw new Error('accept failed');
  }
  return readNotes(root).length;
}

async function ask(server, question) {
  const res = await fetch(`${server}/api/ask/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, intents: [] }) });
  const text = await res.text();
  let reply = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try { const e = JSON.parse(line.slice(6)); if (e.type === 'result' && typeof e.text === 'string') reply = e.text; } catch { /* skip */ }
  }
  return reply;
}

if (mode === 'manip') {
  const server = arg('--server'); const repo = path.resolve(arg('--repo'));
  const notesFile = path.join(repo, '.sequence/memory/NOTES.md');
  if (fs.existsSync(notesFile)) { console.error(`refusing: ${notesFile} exists. Use a scratch repo.`); process.exit(2); }
  const n = buildPool(repo);
  const pool = fs.readFileSync(notesFile, 'utf8');
  const park = notesFile + '.off';
  const run = async (on) => {
    if (on) { if (fs.existsSync(park)) fs.renameSync(park, notesFile); } else if (fs.existsSync(notesFile)) fs.renameSync(notesFile, park);
    const out = [];
    for (const c of cases) out.push({ id: c.id, repeat: await ask(server, c.repeat), other: await ask(server, cases[(cases.indexOf(c) + 7) % cases.length].ask) });
    return out;
  };
  const off = await run(false); const on = await run(true);
  let b = 0, c2 = 0, onYes = 0, offYes = 0, leakOn = 0, leakOff = 0;
  cases.forEach((c, i) => {
    const w = reasonWords(c, c.repeat);
    const y1 = mentionsReason(on[i].repeat, w), y0 = mentionsReason(off[i].repeat, w);
    if (y1) onYes++; if (y0) offYes++;
    if (y1 && !y0) b++; if (y0 && !y1) c2++;
    const o = cases[(i + 7) % cases.length]; const ow = reasonWords(c, o.ask);
    if (mentionsReason(on[i].other, ow)) leakOn++; if (mentionsReason(off[i].other, ow)) leakOff++;
  });
  const result = { notesInPool: n, cases: cases.length, OFF_repliesUsingTheNote: offYes, ON_repliesUsingTheNote: onYes, onlyON: b, onlyOFF: c2, mcnemarP: mcnemarP(b, c2), leak_into_unrelated_asks: { OFF: leakOff, ON: leakOn }, poolBytes: pool.length };
  fs.writeFileSync(path.join(outDir, 'manip.json'), JSON.stringify({ result, on, off }, null, 1));
  console.log(JSON.stringify(result, null, 1));
} else if (mode === 'harm') {
  const agent = arg('--agent'); const limit = arg('--limit', '36');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'refine-harm-'));
  buildPool(scratch);
  const block = buildAgentBlock(scratch, 'x', 'harm::k', null, new ThreadNoteLedger());
  const prefix = path.join(outDir, 'notes-prefix.txt'); fs.writeFileSync(prefix, block.text);
  console.log(`prefix: ${block.sent.length} notes, about ${block.tokens} tokens`);
  const ab = path.join(ROOT, 'tools/bench/agent-ab/run.mjs');
  for (const arm of ['plain', 'notes']) {
    const outFile = path.join(outDir, `${agent}-${arm}.jsonl`);
    const r = spawnSync(process.execPath, [ab, '--questions', arg('--questions'), '--repos', arg('--repos'), '--agent', agent, '--arm', 'plain', '--limit', limit, '--out', outFile], { stdio: 'inherit', env: { ...process.env, ...(arm === 'notes' ? { AB_PREFIX_FILE: prefix } : {}) } });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  console.log(`done. Score both files with tools/bench/agent-ab/score.mjs and compare paired F1 and tokens; bar in README.md.`);
} else {
  console.error('usage: run.mjs manip|harm (see header)'); process.exit(2);
}
