#!/usr/bin/env node
/*
 * ltr-parity — does the TypeScript LTR picker (askLtr.ts) pick what the frozen
 * Python reference (harness-study search3/ltr/pick.py) picks?
 *
 * Runs pick.py on (repo, idx, back), then builds the product's index over the
 * same S tree (same file set and order, same contents, churn and first-parent
 * history up to S) and ranks each question with rankAskFileLtr. Reports, per
 * question, whether the two top 5 lists are identical (as ordered lists and as
 * sets), and hit@5 / hit@1 for both.
 *
 *   node tools/bench/ltr-parity.mjs --repo <git dir> --idx 501 --back 200 \
 *     --python /home/claude/ltr-venv/bin/python --pick <search3/ltr/pick.py> [--out file.json]
 *
 * Needs a built analyzer (packages/analyzer/dist). Dev repos only.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAskFileIndex, readGitChurn } from '../../packages/analyzer/dist/explain/askFileIndex.js';
import { askLtrFeatures, rankAskFileLtr, readAskLtrHistory } from '../../packages/analyzer/dist/explain/askLtr.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : process.argv[i + 1];
};
const REPO = path.resolve(arg('--repo', '.'));
const IDX = arg('--idx');
const AT = arg('--at');
const BACK = Number(arg('--back', 200));
const PY = arg('--python', '/home/claude/ltr-venv/bin/python');
const PICK = arg('--pick', '/mnt/project-files/sequence/harness-study/search3/ltr/pick.py');
const OUT = arg('--out');
const K = 5;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ltr-parity-'));
const pyOut = path.join(tmp, 'rows.json');
const pyArgs = ['-B', PICK, '--repo', REPO, '--back', String(BACK), '--out', pyOut, ...(AT ? ['--at', AT] : ['--idx', String(IDX ?? BACK)])];
const tPy = Date.now();
execFileSync(PY, pyArgs, { stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 28 });
const pyWall = Date.now() - tPy;
const py = JSON.parse(fs.readFileSync(pyOut, 'utf8'));

/* The reference's snapshot: S tree via git archive, ltrlib.is_source, sorted, unreadable / NUL files dropped. */
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const chain = git('rev-list', '--first-parent', 'HEAD').split('\n');
const ai = AT ? chain.findIndex((c) => c.startsWith(AT)) : Number(IDX ?? BACK);
const S = chain[ai];
if (S.slice(0, 8) !== py.S) throw new Error(`S mismatch ${S.slice(0, 8)} vs ${py.S}`);
const CODE = /\.(m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|swift|dart|c|cc|cpp|h|hpp|vue|svelte|css|html|sh|ps1|toml|ya?ml|json)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|out|\.git|vendor|lab|runs|logs|tmp|\.repos)\//;
const LOCK = /lock\.(json|ya?ml)$|-lock\.json$/;
const tree = path.join(tmp, 'tree');
fs.mkdirSync(tree);
execFileSync('tar', ['-x'], { cwd: tree, input: execFileSync('git', ['-C', REPO, 'archive', '--format=tar', S], { maxBuffer: 1 << 30 }) });
const atS = git('ls-tree', '-r', '--name-only', S).split('\n').filter((p) => CODE.test(p) && !SKIP.test(p) && !LOCK.test(p)).sort();
const files = [];
for (const f of atS) {
  let t;
  try {
    t = fs.readFileSync(path.join(tree, f), 'utf8');
  } catch {
    continue;
  }
  if (!t.includes('\0')) files.push([f, t]);
}
const tBuild = performance.now();
const index = buildAskFileIndex(files, readGitChurn(REPO, { rev: S }), undefined, readAskLtrHistory(REPO, { rev: S }));
const buildMs = performance.now() - tBuild;

const rows = [];
for (const r of py.rows) {
  const t0 = performance.now();
  const got = rankAskFileLtr(index, r.subject).slice(0, K);
  const ms = performance.now() - t0;
  const pyGot = r.LTR.got;
  const same = got.length === pyGot.length && got.every((f, i) => f === pyGot[i]);
  const sameSet = got.length === pyGot.length && got.every((f) => pyGot.includes(f));
  const hit = got.some((f) => r.truth.includes(f)) ? 1 : 0;
  const row = { commit: r.commit, subject: r.subject, truth: r.truth, py: pyGot, ts: got, same, sameSet, hit, pyHit: r.LTR.hit, hit1: got[0] && r.truth.includes(got[0]) ? 1 : 0, pyHit1: r.LTR.hit1, ms };
  if (!sameSet) {
    const { cands } = askLtrFeatures(index, r.subject);
    row.candidates = cands.length;
  }
  rows.push(row);
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const report = {
  repo: path.basename(REPO),
  S: py.S,
  queries: rows.length,
  files: files.length,
  identicalTop5: +mean(rows.map((r) => (r.same ? 1 : 0))).toFixed(4),
  sameTop5Set: +mean(rows.map((r) => (r.sameSet ? 1 : 0))).toFixed(4),
  python: { hitAt5: +mean(rows.map((r) => r.pyHit)).toFixed(4), hitAt1: +mean(rows.map((r) => r.pyHit1)).toFixed(4), msPerQuery: py.summary.LTR.ms, wallMs: pyWall },
  ts: { hitAt5: +mean(rows.map((r) => r.hit)).toFixed(4), hitAt1: +mean(rows.map((r) => r.hit1)).toFixed(4), msPerQuery: +mean(ms).toFixed(1), p95: +(ms[Math.floor(ms.length * 0.95)] ?? 0).toFixed(1), buildMs: Math.round(buildMs) },
  differing: rows.filter((r) => !r.same).map((r) => ({ commit: r.commit, subject: r.subject, py: r.py, ts: r.ts })),
};
console.log(JSON.stringify(report, null, 1));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ...report, rows }, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
