#!/usr/bin/env node
/* bench:ink — the published shape-recognizer numbers, from the fresh-sealed DiDi slice, in one command.
 *
 *   pnpm bench:ink                  fetch + verify the data (first run: ~222 MB), label it, score it, print the headline
 *   pnpm bench:ink --published      the same, but scores packages/ink as built at the SEALED commit (git history needed) and
 *                                   fails if a published number drifts: the one-command reproduction of 93.9 % / 78.0 %
 *   pnpm bench:ink --old-model      the lone-stroke model before grouping (the 88.1 % / 54.4 % the board's Draw still uses), same checks
 *   pnpm bench:ink --dry          resolve the plan and prerequisites; download, label and score nothing
 *   pnpm bench:ink --check          verify the pins (and whatever is cached) without running; see data/ink-didi/download.mjs
 *   flags: --cache DIR (else $SEQUENCE_BENCH_CACHE/ink-didi)
 *
 * Needs `pnpm -r build` (packages/ink/dist). No GPU, no model: the shipped trees are scored, nothing is trained.
 * Pipeline: download.mjs (Range request, sha256-pinned) -> ink-didi-label.mjs (labels every stroke by geometry against
 * its prompt) -> strokes sha256 checked against the sealed record -> ink-group-eval.mjs --split test (the lone-stroke
 * arm and the grouped arm over the same strokes). The tolerance is the sealed record's: see docs/bench/REPRODUCE.md. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkCache, ensureInk, inkCache, loadManifest, sha256, verifyStatic } from './data/ink-didi/download.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

/** What the sealed record (tools/bench/ink-fresh-sealed.txt) published, and how far a rerun may drift. The scoring is
 * deterministic (no sampling, no clock), so the tolerance only absorbs float formatting: 5e-4 on a rate. */
/** The commit the sealed look was taken at (tools/bench/ink-fresh-sealed.txt, "the final shipped model"). Later ink commits
 * (1b5b5337b, a48245782) moved the grouped score on this same slice; see docs/bench/REPRODUCE.md. */
export const SEALED_COMMIT = 'd9ee1618e29c0d47fa0de82b7175b67f059cfdff';
export const EXPECTED = {
  strokes: 13175,
  drawings: 530,
  tolerance: 5e-4,
  grouped: { macroF1: 0.8955, accuracy: 0.9389, wrongSnapRate: 0.0162, snapRecall: 0.78 },
  single: { macroF1: 0.6362, wrongSnapRate: 0.0197 },
};

/** The old single-stroke model (docs/claims.json V14: 88.1 % accuracy / 54.4 % recall), scored lone-stroke only. */
export const EXPECTED_OLD = { tolerance: 5e-4, single: { macroF1: 0.6489, accuracy: 0.8811, wrongSnapRate: 0.0364, snapRecall: 0.544 } };
export function compareOld(report, exp = EXPECTED_OLD) {
  return Object.entries(exp.single).map(([k, want]) => ({ name: `old model lone ${k}`, got: report.single[k], want, ok: Math.abs(report.single[k] - want) <= exp.tolerance }));
}
export function compare(report, exp = EXPECTED) {
  const rows = [];
  const add = (name, got, want) => rows.push({ name, got, want, ok: Math.abs(got - want) <= exp.tolerance });
  add('grouped macroF1', report.grouped.macroF1, exp.grouped.macroF1);
  add('grouped accuracy', report.grouped.accuracy, exp.grouped.accuracy);
  add('grouped wrong-snap rate', report.grouped.wrongSnapRate, exp.grouped.wrongSnapRate);
  add('grouped snap recall', report.grouped.snapRecall, exp.grouped.snapRecall);
  add('lone macroF1', report.single.macroF1, exp.single.macroF1);
  add('lone wrong-snap rate', report.single.wrongSnapRate, exp.single.wrongSnapRate);
  add('strokes scored', report.strokes, exp.strokes);
  add('drawings', report.drawings, exp.drawings);
  return rows;
}

/** Build packages/ink as it was at the sealed commit into <cache>/ink-sealed, from git objects only (no checkout, no tar). */
function buildInkAt(cache, ref, name) {
  const dir = path.join(cache, name);
  const git = (...a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'buffer', maxBuffer: 1 << 28 });
  if (git('cat-file', '-e', `${ref}^{commit}`).status !== 0) throw new Error(`commit ${ref} is not in this clone (shallow?); run: git fetch --unshallow`);
  fs.rmSync(dir, { recursive: true, force: true });
  const files = git('ls-tree', '-r', '--name-only', ref, 'packages/ink', 'tsconfig.base.json').stdout.toString().split('\n').filter(Boolean);
  for (const f of files) {
    const dest = path.join(dir, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, git('show', `${ref}:${f}`).stdout);
  }
  const tsc = path.join(ROOT, 'packages/ink/node_modules/typescript/bin/tsc');
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(dir, 'packages/ink/tsconfig.json'), '--typeRoots', path.join(ROOT, 'packages/ink/node_modules/@types')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tsc failed building the sealed packages/ink:\n${r.stdout}${r.stderr}`);
  return path.join(dir, 'packages/ink/dist');
}

const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 29, ...opts });

function prerequisites() {
  const m = loadManifest();
  verifyStatic(m);
  return [
    ['packages/ink/dist built (pnpm -r build)', fs.existsSync(path.join(ROOT, 'packages/ink/dist/shapeRecognize.js')) && fs.existsSync(path.join(ROOT, 'packages/ink/dist/shapeGroup.js'))],
    ['manifest, prompts.json and labeller match their pins', true],
  ];
}

function main() {
  const argv = process.argv.slice(2);
  const cache = inkCache(process.argv);
  const t0 = Date.now();
  if (argv.includes('--check')) {
    const r = node([path.join(HERE, 'data/ink-didi/download.mjs'), '--check', '--cache', cache, ...(argv.includes('--strict') ? ['--strict'] : [])], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  const need = prerequisites();
  if (argv.includes('--dry')) {
    const m = loadManifest();
    console.log('bench:ink --dry');
    console.log(`  data: ${m.source.base}/${m.source.ndjson} bytes ${m.source.rangeStart}-${m.source.rangeEnd}, sha256 ${m.source.rawSliceSha256.slice(0, 12)}...`);
    console.log(`  keeps ${m.testDrawings.count} test drawings (sha256 ${m.testDrawings.sha256.slice(0, 12)}...) and fetches ${m.prompts.count} prompt xdot files`);
    console.log(`  stroke labels must hash to ${m.strokes.sha256.slice(0, 12)}... (${m.strokes.count} strokes)`);
    console.log(`  cache: ${cache}`);
    console.log(argv.includes('--old-model') ? `  mode: --old-model (build packages/ink at ${SEALED_COMMIT.slice(0, 9)}^, lone-stroke arm only, fail on drift)` : argv.includes('--published') ? `  mode: --published (build packages/ink at ${SEALED_COMMIT.slice(0, 9)}, fail on drift)` : '  mode: head (score the working tree; prints the delta from the published numbers)');
    for (const c of checkCache(cache, m)) console.log(`  cache ${c.ok === true ? 'ok' : c.ok === null ? 'empty (first run downloads ~222 MB)' : 'MISMATCH'}: ${c.what}`);
    for (const [n, ok] of need) console.log(`  ${ok ? 'ok     ' : 'MISSING'} ${n}`);
    if (need.some(([, ok]) => !ok)) { console.error('dry run: prerequisites not met'); process.exit(1); }
    console.log('dry run ok; nothing was downloaded, labelled or scored');
    return;
  }
  if (need.some(([, ok]) => !ok)) { console.error(`prerequisites not met: ${need.filter(([, ok]) => !ok).map(([n]) => n).join('; ')}`); process.exit(1); }
  return run(cache, t0, modeOf(argv));
}

export const modeOf = (argv) => (argv.includes('--old-model') ? 'old' : argv.includes('--published') ? 'published' : 'head');

async function run(cache, t0, mode) {
  const published = mode !== 'head';
  const m = loadManifest();
  const d = await ensureInk(cache);
  const strokes = path.join(cache, 'strokes.jsonl');
  // ink-didi-label.mjs is run through its exports (its own CLI guard compares file:// URLs and never fires on Windows paths);
  // the row format below is a copy of its main(), and the strokes hash proves the copy is faithful.
  const { parseXdot, labelDrawing } = await import(pathToFileURL(path.join(HERE, 'ink-didi-label.mjs')).href);
  const pngSize = JSON.parse(fs.readFileSync(d.pngSize, 'utf8'));
  const rows = [];
  let n = 0;
  for (const line of fs.readFileSync(d.drawings, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const ink = JSON.parse(line);
    const xf = path.join(d.xdotDir, `${ink.label_id}.xdot`);
    if (!fs.existsSync(xf) || !pngSize[ink.label_id]) continue;
    const labelled = labelDrawing(ink, parseXdot(fs.readFileSync(xf, 'utf8')), pngSize[ink.label_id]);
    n++;
    labelled.forEach((s, i) => rows.push(JSON.stringify({ key: ink.key, split: ink.split, label_id: ink.label_id, i, label: s.label, elem: s.elem, nodeShape: s.nodeShape, x: s.x, y: s.y, t: s.t }) + '\n'));
  }
  const body = Buffer.from(rows.join(''));
  fs.writeFileSync(strokes, body);
  const got = sha256(body);
  if (got !== m.strokes.sha256 || rows.length !== m.strokes.count) {
    console.error(`STROKES MISMATCH: ${rows.length} strokes sha256 ${got}; sealed record says ${m.strokes.count} / ${m.strokes.sha256}. The labels differ from the sealed ones, so the score below would not be the published one; refusing.`);
    process.exit(1);
  }
  console.log(`labelled ${n} drawings, ${rows.length} strokes, sha256 matches the sealed record`);
  const out = path.join(cache, 'report.json');
  const inkArgs = mode === 'published' ? ['--ink', buildInkAt(cache, SEALED_COMMIT, 'ink-sealed')] : mode === 'old' ? ['--ink', buildInkAt(cache, `${SEALED_COMMIT}^`, 'ink-before-sealed'), '--lone-only'] : [];
  const r = node([path.join(HERE, 'ink-group-eval.mjs'), strokes, '--split', 'test', '--out', out, ...inkArgs]);
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(r.status ?? 1); }
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  const pct = (x) => `${(100 * x).toFixed(2)}%`;
  console.log(`\nbench:ink headline (${mode === 'published' ? `packages/ink at the sealed commit ${SEALED_COMMIT.slice(0, 9)}` : mode === 'old' ? `the lone-stroke model before grouping (${SEALED_COMMIT.slice(0, 9)}^)` : 'packages/ink as built in this tree'}; fresh sealed DiDi test slice, ${report.strokes} scored strokes, ${report.drawings} drawings)`);
  if (mode !== 'old') console.log(`  grouped (what ships): macroF1 ${report.grouped.macroF1.toFixed(4)}  accuracy ${pct(report.grouped.accuracy)}  wrong-snap ${pct(report.grouped.wrongSnapRate)}  snap recall ${pct(report.grouped.snapRecall)}`);
  console.log(`  lone stroke:          macroF1 ${report.single.macroF1.toFixed(4)}  accuracy ${pct(report.single.accuracy)}  wrong-snap ${pct(report.single.wrongSnapRate)}  snap recall ${pct(report.single.snapRecall)}`);
  const rows2 = mode === 'old' ? compareOld(report) : compare(report);
  for (const c of rows2) console.log(`  ${c.ok ? 'ok  ' : 'DIFF'} ${c.name}: ${c.got.toFixed ? c.got.toFixed(4) : c.got} (published ${c.want}, tolerance ${EXPECTED.tolerance})`);
  console.log(`  runtime ${((Date.now() - t0) / 1000).toFixed(1)} s; report ${out}`);
  if (rows2.some((c) => !c.ok)) {
    if (published) { console.error(`bench:ink --${mode === 'old' ? 'old-model' : 'published'}: a published number drifted`); process.exit(1); }
    console.log('  note: this tree\'s ink differs from the sealed commit, so DIFF rows are expected; `pnpm bench:ink --published` reproduces the published numbers');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
