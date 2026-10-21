import assert from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLightGbmModel, predictLightGbm } from '../explain/lightgbm.js';
import { ASK_LTR_MODEL_SHA256 } from '../explain/askLtrModel.generated.js';
import { ASK_LTR_FEATURES, askLtrFeatures, askLtrModel, byScore, rankAskFileLtr, rankOf, readAskLtrHistory, topByScore } from '../explain/askLtr.js';
import { buildAskFileIndex, buildAskFileIndexAsync, readGitChurn, scoreAskFileHybrid } from '../explain/askFileIndex.js';
import { buildLtrGoldenRepo } from './ltrGoldenRepo.js';
import { selectAskResearchPaths } from '../explain/askFileResearch.js';
import { resolveInRepo } from '../server/jail.js';

/**
 * Harness study search3/ltr: FILE RESEARCH ranks with a LightGBM LambdaRank
 * model once the index's LTR stage is built (sealed hit@5 84.9% vs 75.5% for
 * HYB_NOSEM). Parity with the Python reference: tools/bench/ltr-parity.mjs.
 */

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/* A hand-made model: a numerical tree with a NaN-missing split, a Zero-missing tree, a categorical tree, a one-leaf tree. */
const TINY = `tree
version=v4
num_class=1
num_tree_per_iteration=1
label_index=0
max_feature_idx=2
objective=lambdarank
feature_names=a b c
feature_infos=[0:1] [0:1] [0:1]
tree_sizes=1 1 1 1

Tree=0
num_leaves=3
num_cat=0
split_feature=0 1
split_gain=1 1
threshold=0.5 2.5
decision_type=2 8
left_child=-1 -2
right_child=1 -3
leaf_value=1 2 3
is_linear=0
shrinkage=1


Tree=1
num_leaves=2
num_cat=0
split_feature=2
split_gain=1
threshold=0
decision_type=4
left_child=-1
right_child=-2
leaf_value=10 20
is_linear=0
shrinkage=1


Tree=2
num_leaves=2
num_cat=1
split_feature=0
split_gain=1
threshold=0
decision_type=1
left_child=-1
right_child=-2
leaf_value=100 200
cat_boundaries=0 1
cat_threshold=10
is_linear=0
shrinkage=1


Tree=3
num_leaves=1
num_cat=0
split_feature=
split_gain=
threshold=
decision_type=
left_child=
right_child=
leaf_value=0.5
is_linear=0
shrinkage=1


end of trees

feature_importances:
a=2
`;

test('LightGBM evaluator: numerical, default-left / missing None-Zero-NaN, categorical bitset and one-leaf trees, summed in order', () => {
  const m = parseLightGbmModel(TINY);
  assert.deepEqual(m.featureNames, ['a', 'b', 'c']);
  assert.equal(m.trees.length, 4);
  /* t0: a<=0.5 → 1; else b (NaN missing, default right): b<=2.5 → 2 else 3. t1: c (Zero missing, default right): 0 → 20, c<=0 → 10.
     t2: category bitset 0b1010 = {1, 3} → 100, else 200. t3: 0.5. */
  assert.equal(predictLightGbm(m, [0, 0, 0]), 1 + 20 + 200 + 0.5);
  assert.equal(predictLightGbm(m, [1, NaN, -1]), 3 + 10 + 100 + 0.5, 'NaN with NaN-missing goes the default (right) way');
  assert.equal(predictLightGbm(m, [3, 1, NaN]), 2 + 20 + 100 + 0.5, 'NaN with Zero-missing is zero, and zero goes the default way');
  assert.equal(predictLightGbm(m, [2, 9, 5]), 3 + 20 + 200 + 0.5);
  assert.equal(predictLightGbm(m, [NaN, 0, 1]), 1 + 20 + 200 + 0.5, 'None-missing: NaN reads as 0; categorical NaN goes right');
  assert.equal(predictLightGbm(m, [40, 0, 1]), 2 + 20 + 200 + 0.5, 'a category past the bitset goes right');
  assert.equal(predictLightGbm(m, [-1, 0, 1]), 1 + 20 + 200 + 0.5, 'a negative category goes right');
  /* default_left on the NaN split (decision_type 2|8 = 10): NaN goes left. */
  const left = parseLightGbmModel(TINY.replace('decision_type=2 8', 'decision_type=2 10'));
  assert.equal(predictLightGbm(left, [1, NaN, -1]), 2 + 10 + 100 + 0.5);
  assert.throws(() => parseLightGbmModel(TINY.replace('leaf_value=1 2 3', 'leaf_value=1 2')), /bad tree/);
  assert.throws(() => parseLightGbmModel(TINY.replace('num_class=1', 'num_class=3')), /single-output/);
});

test('the shipped LTR model: 150 trees over the 39 features, and the same raw scores as LightGBM 4.7.0 Booster.predict', () => {
  const m = askLtrModel();
  assert.equal(m.trees.length, 150);
  assert.deepEqual(m.featureNames, [...ASK_LTR_FEATURES]);
  assert.match(ASK_LTR_MODEL_SHA256, /^5e5f68fe1b325386/);
  /* Expected values from /home/claude/ltr-venv (lightgbm 4.7.0) on search3/ltr/model.txt. */
  const rows = [
    new Array(39).fill(0),
    [1.2, 0, 30, 1, 1, 0.5, 4, 0.8, 2, 1, 0, 0.5, 1, 0, 3.2, 2, 5, 9, 0.4, 3, 1, 0.5, 0.7, 6, 0.9, 0.8, 0.6, 12, 7.5, 0, 3, 1, 0.2, 0.6, 2, 1.1, 4, 6.5, 0.75],
    [0.3, 40, 5, 0.2, 0.1, 0, 0, 0.05, 120, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0.05, 900, 0, 0, 0, 0, 0, 0, 0, 3, 5, 1, 5, 2, 0.01, 0, 0, 0, 6, 7, 0.25],
  ];
  const want = [-3.209342024702469, 3.4665006202994317, -5.333082114184385];
  rows.forEach((r, i) => assert.ok(Math.abs(predictLightGbm(m, r) - want[i]!) < 1e-12, `${predictLightGbm(m, r)} vs ${want[i]}`));
});

function ltrRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-ltr-')));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'ui'), { recursive: true });
  const w = (p: string, t: string) => fs.writeFileSync(path.join(dir, p), t);
  w('src/auth/session.ts', "import { save } from './store';\nexport function refreshToken(s) { return save(s); }\n");
  w('src/auth/store.ts', 'export function save(s) { return s; }\n');
  w('src/ui/button.tsx', 'export const Button = () => null;\n');
  w('src/ui/theme.css', '.button { color: red; }\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  w('src/auth/session.ts', "import { save } from './store';\nexport function refreshToken(s) { return save(s) ; }\n");
  git(dir, 'commit', '-qam', 'fix(auth): session expiry race on reconnect');
  w('src/ui/button.tsx', 'export const Button = () => 1;\n');
  git(dir, 'commit', '-qam', 'feat(ui): bigger button');
  w('src/ui/theme.css', '.button { color: blue; }\n');
  git(dir, 'commit', '-qam', 'style: blue');
  return dir;
}

function filesOf(dir: string): [string, string][] {
  return ['src/auth/session.ts', 'src/auth/store.ts', 'src/ui/button.tsx', 'src/ui/theme.css'].map((p) => [p, fs.readFileSync(path.join(dir, p), 'utf8')]);
}

test('LTR features: past commits with similar subjects vote for their files; definitions, import neighbours and recency are read', () => {
  const dir = ltrRepo();
  const H = readAskLtrHistory(dir);
  assert.deepEqual(H.map((c) => c.subject), ['style: blue', 'feat(ui): bigger button', 'fix(auth): session expiry race on reconnect', 'init']);
  const index = buildAskFileIndex(filesOf(dir), new Map(), undefined, H);
  assert.ok(index.ltr);
  const q = 'reconnect race in `refreshToken`';
  const { cands, rows } = askLtrFeatures(index, q);
  const F = (f: string, name: (typeof ASK_LTR_FEATURES)[number]) => rows[cands.indexOf(f)]![ASK_LTR_FEATURES.indexOf(name)]!;
  assert.ok(cands.includes('src/auth/session.ts') && cands.includes('src/auth/store.ts'));
  assert.equal(rows[0]!.length, 39);
  /* The 'reconnect race' commit touched session.ts only: its vote is the whole kNN mass. */
  assert.equal(F('src/auth/session.ts', 'knn_sum_n'), 1);
  assert.equal(F('src/auth/session.ts', 'knn_w_n'), 1);
  assert.equal(F('src/auth/store.ts', 'knn_sum_n'), 0);
  assert.equal(F('src/auth/session.ts', 'def_hit_code'), 1, '`refreshToken` is defined there');
  assert.equal(F('src/auth/store.ts', 'nbr_cnt'), 1, 'store.ts is imported by the best BM25F match');
  assert.equal(F('src/auth/store.ts', 'indeg'), Math.log(2));
  assert.equal(F('src/auth/session.ts', 'since_last'), 2);
  assert.equal(F('src/auth/store.ts', 'since_last'), 3);
  assert.equal(F('src/ui/theme.css', 'in_recent5'), 1);
  assert.equal(F('src/auth/session.ts', 'f50_rank'), 0);
  assert.equal(F('src/ui/theme.css', 'f50_rank'), 9999, 'no match: the F50 rank sentinel');
  assert.equal(F('src/auth/session.ts', 'ext'), 1);
  assert.equal(F('src/ui/theme.css', 'ext'), 4);
  assert.equal(rankAskFileLtr(index, q)[0], 'src/auth/session.ts');
});

test('fallback: no LTR stage = HYB_NOSEM order; with it the LTR order leads and HYB backfills what the gate refuses', () => {
  const dir = ltrRepo();
  const files = filesOf(dir);
  const graph = { nodes: [], edges: [] } as unknown as Parameters<typeof selectAskResearchPaths>[0];
  const digest = { services: [] };
  const q = 'reconnect race in `refreshToken`';
  const plain = buildAskFileIndex(files);
  assert.equal(plain.ltr, undefined);
  const hyb = [...scoreAskFileHybrid(plain, q)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
  assert.deepEqual(selectAskResearchPaths(graph, digest, q, { index: plain }), hyb.slice(0, 6));
  const withLtr = buildAskFileIndex(files, new Map(), undefined, readAskLtrHistory(dir));
  const ltr = rankAskFileLtr(withLtr, q);
  assert.deepEqual(selectAskResearchPaths(graph, digest, q, { index: withLtr }), ltr.slice(0, 6));
  assert.deepEqual(selectAskResearchPaths(graph, digest, q, { index: withLtr, noLtr: true }), hyb.slice(0, 6));
  /* The gate still decides slots. */
  const gated = selectAskResearchPaths(graph, digest, q, { index: withLtr, accept: (p) => p !== ltr[0] });
  assert.ok(!gated.includes(ltr[0]!));
  assert.equal(gated[0], ltr[1]);
});

test('background build: the HYB index is served first and the LTR stage lands after it; SEQUENCE_ASK_PICKER=hyb skips the stage', async () => {
  const dir = ltrRepo();
  const resolve = (p: string) => resolveInRepo(dir, p);
  const index = await buildAskFileIndexAsync(dir, [], resolve);
  assert.ok(index);
  assert.equal(index.ltr, undefined, 'not ready when the index is first served: asks use HYB_NOSEM meanwhile');
  assert.ok(index.ltrPending);
  await index.ltrPending;
  assert.ok(index.ltr, 'the LTR stage attached itself');
  assert.equal(rankAskFileLtr(index, 'reconnect race in `refreshToken`')[0], 'src/auth/session.ts');
  /* Cancelled after the base index: the stage never attaches. */
  let cancel = false;
  const c = await buildAskFileIndexAsync(dir, [], resolve, { cancelled: () => cancel });
  cancel = true;
  await c!.ltrPending;
  assert.equal(c!.ltr, undefined);
  const prev = process.env.SEQUENCE_ASK_PICKER;
  process.env.SEQUENCE_ASK_PICKER = 'hyb';
  try {
    const off = await buildAskFileIndexAsync(dir, [], resolve);
    assert.equal(off!.ltrPending, undefined);
    assert.equal(off!.ltr, undefined);
  } finally {
    if (prev === undefined) delete process.env.SEQUENCE_ASK_PICKER;
    else process.env.SEQUENCE_ASK_PICKER = prev;
  }
});

/* ───────────── golden fixture from the Python reference (tools/bench/ltr-golden.mjs) ───────────── */

interface Golden {
  histN: number;
  files: string[];
  questions: { q: string; cands: string[]; rows: number[][]; scores: number[]; top5: string[]; order: string[] }[];
  threshold_rows: number[][];
  threshold_scores: number[];
}

function golden(): Golden {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(fs.readFileSync(path.resolve(here, '..', '..', 'test', 'fixtures', 'ltr-golden.json'), 'utf8')) as Golden;
}

const close = (a: number, b: number) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

test('golden (pick.py): on the golden repo, every question\'s candidates (in order), 39 features, scores, top 5 and full order match the Python reference', () => {
  const g = golden();
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ltr-golden-')));
  buildLtrGoldenRepo(dir);
  /* The reference's file set: ltrlib.is_source over the HEAD tree, sorted. */
  const CODE = /\.(m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|swift|dart|c|cc|cpp|h|hpp|vue|svelte|css|html|sh|ps1|toml|ya?ml|json)$/i;
  const SKIP = /(^|\/)(node_modules|dist|build|out|\.git|vendor|lab|runs|logs|tmp|\.repos)\//;
  const files = git(dir, 'ls-tree', '-r', '--name-only', 'HEAD').trim().split('\n').filter((p) => CODE.test(p) && !SKIP.test(p) && !/lock\.(json|ya?ml)$|-lock\.json$/.test(p)).sort();
  assert.deepEqual(files, g.files);
  const index = buildAskFileIndex(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')] as [string, string]), readGitChurn(dir), undefined, readAskLtrHistory(dir, { maxCommits: g.histN }), g.histN);
  const model = askLtrModel();
  for (const want of g.questions) {
    const { cands, rows } = askLtrFeatures(index, want.q);
    assert.deepEqual(cands, want.cands, `candidates for ${JSON.stringify(want.q)}`);
    rows.forEach((row, i) =>
      row.forEach((v, j) => assert.ok(close(v, want.rows[i]![j]!), `${JSON.stringify(want.q)} ${cands[i]} ${ASK_LTR_FEATURES[j]}: ${v} vs ${want.rows[i]![j]}`)),
    );
    rows.forEach((row, i) => assert.ok(close(predictLightGbm(model, row), want.scores[i]!), `${JSON.stringify(want.q)} ${cands[i]} score`));
    const got = rankAskFileLtr(index, want.q);
    assert.deepEqual(got.slice(0, 5), want.top5, `top 5 for ${JSON.stringify(want.q)}`);
    assert.deepEqual(got, want.order, `full order (ties: F50 rank, then path) for ${JSON.stringify(want.q)}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('golden (LightGBM 4.7.0): rows sitting exactly on a split threshold score as LightGBM scores them (`<=` goes left)', () => {
  const g = golden();
  const model = askLtrModel();
  g.threshold_rows.forEach((row, i) => assert.ok(Math.abs(predictLightGbm(model, row) - g.threshold_scores[i]!) < 1e-12, `row ${i}: ${predictLightGbm(model, row)} vs ${g.threshold_scores[i]}`));
});

/* ───────────── REVIEW-v3 #3: per-ask cost follows the matches, not the repo ───────────── */

test('REVIEW-v3 #3: the BM25 arms visit only the files that hold a question word (postings), not every file per word', () => {
  const files: [string, string][] = [];
  for (let i = 0; i < 3000; i++) files.push([`src/m${i}.ts`, `export const filler${i} = ${i};\n`]);
  files.push(['src/ledger/settle.ts', 'export function settleInvoice() { /* settle the invoice */ }\n']);
  files.push(['src/invoice/view.ts', 'export const invoiceView = 1;\n']);
  const index = buildAskFileIndex(files, new Map(), undefined, []);
  const want = askLtrFeatures(index, 'settle invoice');
  let gets = 0;
  const docs = index.docs;
  index.docs = new Proxy(docs, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (k === 'get')
        return (f: string) => {
          gets++;
          return t.get(f);
        };
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const got = askLtrFeatures(index, 'settle invoice');
  index.docs = docs;
  assert.deepEqual(got, want);
  assert.ok(gets < 200, `docs.get called ${gets} times for 3,002 files`);
});

test('REVIEW-v3 #3: grep word counts from the trigram postings equal the vocabulary scan', () => {
  const texts = ['aaaaa aaa-aaa', 'the theme thermal_theme', 'x', '', 'other-then foo_bar_baz', 'abc abcabc ABC', 'url urls curl'];
  const index = buildAskFileIndex(texts.map((t, i) => [`f${i}.ts`, t] as [string, string]));
  const words = ['aaa', 'aaaa', 'the', 'theme', 'her', 'r-t', 'o_b', 'abc', 'url', 'zzz', 'ab', 'é9x', 'thermal_theme'];
  const scan = words.map((w) => [...index.grep.wordCounts(w)]);
  for (const _ of index.grep.indexTrigrams(2)) void _;
  assert.deepEqual(words.map((w) => [...index.grep.wordCounts(w)]), scan);
  assert.deepEqual(scan[0], [[0, 3]], "'aaa' in 'aaaaa aaa-aaa': non-overlapping, 1 + 2");
});

test('REVIEW-v3 #3: topByScore and rankOf agree with a full stable sort, ties included', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 200; round++) {
    const m = new Map<string, number>();
    const n = 1 + Math.floor(rnd() * 600);
    for (let i = 0; i < n; i++) m.set(`f${i}`, Math.floor(rnd() * (round % 2 ? 5 : 1000)) / 7);
    const full = byScore(m);
    const k = 1 + Math.floor(rnd() * 60);
    assert.deepEqual(topByScore(m, k), full.slice(0, k));
    const want = [...m.keys()].filter(() => rnd() < 0.2).concat(['absent']);
    const r = rankOf(m, want);
    for (const f of want) assert.equal(r.get(f), f === 'absent' ? undefined : full.indexOf(f), f);
  }
});
