import assert from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import {
  ASK_INDEX_MAX_FILE_BYTES,
  askFileIndexPending,
  askIndexEvents,
  askTokens,
  bestMatchingWindow,
  buildAskFileIndex,
  buildAskFileIndexAsync,
  readyAskFileIndex,
  warmAskFileIndex,
  isAskIndexSource,
  listRepoSourceFiles,
  readGitChurn,
  readGitHistory,
  scoreAskFileHybrid,
  scoreAskFileIndex,
} from '../explain/askFileIndex.js';
import { readAskLtrHistory } from '../explain/askLtr.js';
import { ASK_ONESHOT_INDEX_WAIT_MS, awaitAskFileIndexForOneShot, gatherAskFileResearch, readAskResearchFiles, renderAskFileResearchSection, selectAskResearchPaths } from '../explain/askFileResearch.js';

/**
 * Harness study 2026-10-09 (H-search1, H-snippet): FILE RESEARCH picks files by
 * what they CONTAIN (BM25F + churn, "F50") and shows each one's best-matching
 * window. Bench: tools/bench/find-the-fix.mjs --at 6ca8c4e6, picker B.
 */

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

test('askTokens: camelCase and snake split, stopwords dropped, light stem, whole identifier kept', () => {
  const t = askTokens('retryPaymentIntent and the charge_customers');
  assert.ok(t.includes('retry') && t.includes('payment') && t.includes('intent'));
  assert.ok(t.includes('~retrypaymentintent'));
  assert.ok(t.includes('charge') && t.includes('customer'), t.join(' '));
  assert.ok(!t.includes('the') && !t.includes('and'));
});

test('F50: a file whose CONTENTS answer outranks one whose path only shares a word; churn re-ranks matches and never surfaces a non-match', () => {
  const files: [string, string][] = [
    ['src/billing/ledger.ts', 'export function settleInvoice(invoiceId) { /* settle the invoice and post to the ledger */ }'],
    ['src/invoice/README.ts', '// nothing here'],
    ['src/util/strings.ts', 'export const pad = (s) => s;'],
  ];
  const plain = scoreAskFileIndex(buildAskFileIndex(files), 'settle invoice');
  const top = [...plain].sort((a, b) => b[1] - a[1])[0]![0];
  assert.equal(top, 'src/billing/ledger.ts');
  assert.ok(!plain.has('src/util/strings.ts'), 'no match, no score');
  /* Churn on the non-matching file adds nothing; churn on a weaker match lifts it. */
  const churned = scoreAskFileIndex(buildAskFileIndex(files, new Map([['src/util/strings.ts', 50], ['src/invoice/README.ts', 50]])), 'settle invoice');
  assert.ok(!churned.has('src/util/strings.ts'));
  assert.ok(churned.get('src/invoice/README.ts')! > plain.get('src/invoice/README.ts')!);
});

test('selectAskResearchPaths with an index: shopfront content question finds the file the path score cannot', async () => {
  const SHOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'shopfront');
  const graph = await scanRepo(SHOP, { cluster: true });
  const digest = buildDigest(graph);
  const all = graph.nodes.filter((n) => n.kind === 'file' && n.path).map((n) => n.path!);
  const files = all.map((p) => [p, fs.readFileSync(path.join(SHOP, p), 'utf8')] as [string, string]);
  /* Find a distinctive identifier that appears in exactly one file's contents but in no path. */
  let pick: { file: string; word: string } | null = null;
  for (const [p, text] of files) {
    for (const m of text.matchAll(/\b[a-z]+[A-Z][A-Za-z]{4,}\b/g)) {
      const w = m[0];
      if (files.filter(([, t]) => t.includes(w)).length === 1 && !all.some((q) => q.toLowerCase().includes(w.toLowerCase()))) {
        pick = { file: p, word: w };
        break;
      }
    }
    if (pick) break;
  }
  assert.ok(pick, 'fixture has a content-only identifier');
  const question = `where is ${pick.word} defined`;
  assert.ok(!selectAskResearchPaths(graph, digest, question).includes(pick.file), 'control: the path score misses it');
  const got = selectAskResearchPaths(graph, digest, question, { index: buildAskFileIndex(files) });
  assert.equal(got[0], pick.file, got.join(', '));
});

test('HYB_NOSEM: a file whose commit history matches the question is lifted even when its contents barely do; no history = F50 + grep', () => {
  const files: [string, string][] = [
    ['src/a.ts', 'export const flushQueue = () => queue.length; // drain the outbox'],
    ['src/b.ts', 'export const flushAll = () => 1; // drain the outbox, outbox'],
    ['src/c.ts', 'export const unrelated = 2;'],
  ];
  const history = [
    { subject: 'fix(outbox): stalled outbox drain after reconnect', files: ['src/a.ts'] },
    { subject: 'feat(outbox): drain the outbox in batches', files: ['src/a.ts'] },
    { subject: 'chore: rename unrelated', files: ['src/c.ts'] },
  ];
  const q = 'outbox drain stalls after reconnect';
  const f50 = [...scoreAskFileIndex(buildAskFileIndex(files), q)].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  assert.equal(f50[0], 'src/b.ts', 'control: contents alone favour b');
  const hyb = [...scoreAskFileHybrid(buildAskFileIndex(files, new Map(), history), q)].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  assert.equal(hyb[0], 'src/a.ts', hyb.join(', '));
  assert.ok(!hyb.includes('src/c.ts'));
  /* Without history the hybrid still ranks by content (F50 + grep). */
  const noHist = [...scoreAskFileHybrid(buildAskFileIndex(files), q)].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  assert.equal(noHist[0], 'src/b.ts');
});

test('readGitChurn + listRepoSourceFiles: counts first-parent changes, skips sweeping commits, lists tracked source files only', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-index-git-')));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'one');
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(dir, 'a.ts'), `a${i}`);
    git(dir, 'commit', '-qam', `edit ${i}`);
  }
  /* A sweep of 31 files is skipped. */
  for (let i = 0; i < 31; i++) fs.writeFileSync(path.join(dir, `s${i}.ts`), 's');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'sweep');
  const churn = readGitChurn(dir);
  assert.equal(churn.get('a.ts'), 4);
  assert.equal(churn.get('s0.ts'), undefined);
  const hist = readGitHistory(dir);
  assert.deepEqual(hist.slice(0, 4).map((c) => c.subject), ['edit 2', 'edit 1', 'edit 0', 'one'], 'newest first; the 31-file sweep skipped');
  assert.deepEqual(hist[3]!.files.sort(), ['a.ts', 'notes.md']);
  const listed = listRepoSourceFiles(dir);
  assert.ok(listed.includes('a.ts') && listed.includes('s30.ts'));
  assert.ok(!listed.includes('notes.md'));
  assert.ok(isAskIndexSource('web/chat.css') && !isAskIndexSource('node_modules/x/index.js') && !isAskIndexSource('pnpm-lock.yaml'));
  /* Not a repo: empty, no throw. */
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-index-plain-'));
  assert.equal(readGitChurn(plain).size, 0);
  assert.deepEqual(readGitHistory(plain), []);
  assert.deepEqual(listRepoSourceFiles(plain), []);
});

test('H-snippet: a long file shows its best-matching window, line-aligned, within the byte cap; no match keeps the opening', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `const filler${i} = ${i};`);
  lines[300] = 'export function reconcileLedgerEntries(entries) { return entries; }';
  const text = lines.join('\n');
  const w = bestMatchingWindow(text, 'reconcile ledger entries', 2000);
  assert.ok(w.content.includes('reconcileLedgerEntries'));
  assert.ok(w.content.length <= 2000);
  assert.ok(w.startLine > 1 && w.startLine <= 301 && w.endLine >= 301, `${w.startLine}-${w.endLine}`);
  assert.equal(w.content, lines.slice(w.startLine - 1, w.endLine).join('\n'));
  const none = bestMatchingWindow(text, 'zebra giraffe', 2000);
  assert.equal(none.startLine, 1);

  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-snippet-')));
  fs.writeFileSync(path.join(dir, 'big.ts'), text);
  const r = readAskResearchFiles((p) => resolveInRepo(dir, p), ['big.ts'], undefined, undefined, 'reconcile ledger entries');
  assert.ok(r.files[0]!.content.includes('reconcileLedgerEntries'));
  assert.ok(r.files[0]!.startLine! > 1);
  const section = renderAskFileResearchSection(r).join('\n');
  assert.match(section, /### big\.ts \(lines \d+-\d+ of 400, the part that best matched the question/);
  /* Without a question: the opening, as before. */
  const opening = readAskResearchFiles((p) => resolveInRepo(dir, p), ['big.ts']);
  assert.ok(opening.files[0]!.content.startsWith('const filler0'));
  assert.equal(opening.files[0]!.startLine, undefined);
});

test('gatherAskFileResearch with repoRoot: never waits for the index; once the background build is ready it picks a tracked .css by its contents', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-gather-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'caret-app', version: '1.0.0', main: 'src/app.ts' }));
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), "import './theme.css';\nexport const app = 1;\n");
  fs.writeFileSync(path.join(dir, 'src', 'theme.css'), '.composer { --composer-caret-blink: 1s; }\n');
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  const graph = await scanRepo(dir, { cluster: true });
  const digest = buildDigest(graph);
  const question = 'show me the code for the composer caret blink';
  /* First ask: no index yet. It answers from the path score at once and starts the build. */
  const first = gatherAskFileResearch({ graph, digest, question, resolveReadable: (p) => resolveInRepo(dir, p), repoRoot: dir });
  assert.ok(!first.files.some((f) => f.path === 'src/theme.css'), 'the first ask did not wait for the index');
  assert.ok(askFileIndexPending(graph, dir), 'the first ask started the background build');
  assert.ok(await warmAskFileIndex(graph, dir, [], (p) => resolveInRepo(dir, p)), 'joins the build in flight');
  const research = gatherAskFileResearch({ graph, digest, question, resolveReadable: (p) => resolveInRepo(dir, p), repoRoot: dir });
  assert.equal(research.files[0]?.path, 'src/theme.css', research.files.map((f) => f.path).join(', '));
  /* Control: without repoRoot (no index) the path score cannot find it. */
  const legacy = gatherAskFileResearch({ graph, digest, question, resolveReadable: (p) => resolveInRepo(dir, p) });
  assert.ok(!legacy.files.some((f) => f.path === 'src/theme.css'));
});

function tempRepo(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(dir, 'init', '-q');
  return dir;
}

test('M1: the background build yields to the event loop while it reads and tokenises, and is bounded by file count and text bytes', async () => {
  const dir = tempRepo('seq-ask-warm-');
  for (let i = 0; i < 240; i++) fs.writeFileSync(path.join(dir, `f${i}.ts`), `export const value${i} = 'alpha beta gamma ${i}';\n`.repeat(20));
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'files');
  const resolve = (p: string) => resolveInRepo(dir, p);
  /*
   * REVIEW-v3 #4: count this build's OWN yields through its onYield hook (a
   * global setImmediate spy also counted other tests' callbacks when the whole
   * file ran), and bound the longest gap between loop turns. 240 files at
   * yieldEvery 50: 4 yields in the read loop and 1 before finishing. With
   * yields off, only the one before finishing.
   */
  const measure = async (yieldEvery: number) => {
    let yields = 0;
    let last = performance.now();
    let maxGap = 0;
    let spinning = true;
    const spin = () => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
      if (spinning) setImmediate(spin);
    };
    setImmediate(spin);
    try {
      const index = await buildAskFileIndexAsync(dir, [], resolve, { yieldEvery, ltr: false, onYield: () => yields++ });
      return { index, yields, maxGap };
    } finally {
      spinning = false;
    }
  };
  /* A gap is judged against the SAME run's un-yielded build, not a wall clock: with yields off the whole read-and-tokenise
     is one gap, so the yielding build's longest gap must be a fraction of it. Load stretches both. Each is the best of
     two runs (a descheduled slice inflates one run's gap, never the minimum). */
  const on = await measure(50);
  const off = await measure(1e9);
  const on2 = await measure(50);
  const off2 = await measure(1e9);
  assert.ok(on.index);
  assert.equal(on.index.n, 240);
  assert.equal(on.yields, 5, `the build yielded ${on.yields} times over 240 files at yieldEvery 50`);
  assert.equal(off.yields, 1, `control: with yields off the build yielded ${off.yields} times`);
  const yields = (g: number, baseline: number) => g < baseline * 0.75;
  const onGap = Math.min(on.maxGap, on2.maxGap);
  const offGap = Math.min(off.maxGap, off2.maxGap);
  assert.ok(yields(onGap, offGap), `longest event-loop gap ${onGap.toFixed(0)} ms yielding vs ${offGap.toFixed(0)} ms with yields off`);
  /* Negative control: the same predicate rejects the un-yielded build against itself. */
  assert.ok(!yields(offGap, offGap), 'control: a build that never yields is not told apart from itself');
  /* Caps: at most maxFiles files; past maxTextBytes, files are indexed by path only. */
  const capped = await buildAskFileIndexAsync(dir, [], resolve, { maxFiles: 100, maxTextBytes: 10 * 1024 });
  assert.ok(capped);
  assert.equal(capped.n, 100);
  assert.equal(capped.textCapped, true);
  const withText = [...capped.docs.values()].filter((d) => d.len > 0).length;
  assert.ok(withText > 0 && withText < 100, `${withText} files with text`);
  /* Cancelled (a newer scan): null, nothing cached. */
  const scan = {};
  assert.equal(await warmAskFileIndex(scan, dir, [], resolve, { cancelled: () => true }), null);
  assert.equal(readyAskFileIndex(scan, dir), undefined);
  assert.ok(await warmAskFileIndex(scan, dir, [], resolve));
  assert.ok(readyAskFileIndex(scan, dir));
});

test('S1: with a subject node and an index, the subject\'s matching files come first', () => {
  const graph = {
    nodes: [
      { id: 'svc-a', kind: 'service', label: 'a' },
      { id: 'fa', kind: 'file', label: 'a.ts', path: 'svc-a/queue.ts', parentId: 'svc-a' },
      { id: 'fb', kind: 'file', label: 'b.ts', path: 'svc-b/queue.ts' },
    ],
    edges: [],
  } as unknown as Parameters<typeof selectAskResearchPaths>[0];
  const digest = { services: [{ files: [{ path: 'svc-a/queue.ts' }, { path: 'svc-b/queue.ts' }] }] };
  const index = buildAskFileIndex([
    ['svc-a/queue.ts', 'export const queue = 1; // retry'],
    ['svc-b/queue.ts', 'export const queue = 1; // retry retry retry retry backoff retry'],
  ]);
  const q = 'how does the queue retry';
  assert.equal(selectAskResearchPaths(graph, digest, q, { index })[0], 'svc-b/queue.ts', 'control: globally b wins');
  assert.deepEqual(selectAskResearchPaths(graph, digest, q, { index, subjectNodeId: 'svc-a' }), ['svc-a/queue.ts', 'svc-b/queue.ts']);
});

test('S2: a path the current gate refuses never takes a slot; the next readable file backfills it', async () => {
  const dir = tempRepo('seq-ask-gate-');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'gate-app', version: '1.0.0', main: 'src/app.ts' }));
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const app = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'secret.ts'), 'export const ledgerReconcile = "ledger reconcile ledger reconcile";\n');
  fs.writeFileSync(path.join(dir, 'src', 'ledger.ts'), 'export const ledger = "reconcile";\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  const graph = await scanRepo(dir, { cluster: true });
  const digest = buildDigest(graph);
  const jail = (p: string) => resolveInRepo(dir, p);
  const gated = (p: string) => (p.endsWith('secret.ts') ? null : jail(p));
  /* The index is built through the plain jail (contents rank), whichever ask comes first. */
  assert.ok(await warmAskFileIndex(graph, dir, [], jail));
  const question = 'show me the code that does the ledger reconcile';
  const open = gatherAskFileResearch({ graph, digest, question, resolveReadable: jail, repoRoot: dir });
  assert.equal(open.files[0]?.path, 'src/secret.ts', 'control: ungated, the best match is read');
  const r = gatherAskFileResearch({ graph, digest, question, resolveReadable: gated, repoRoot: dir });
  assert.ok(!r.files.some((f) => f.path === 'src/secret.ts'));
  assert.deepEqual(r.refusedPaths, [], 'the denied file was skipped, not picked and refused');
  assert.equal(r.files[0]?.path, 'src/ledger.ts');
  /* Review v2 nit: the section still says a better match was skipped, so the model can ask. */
  assert.equal(r.skippedPaths, 1);
  assert.match(renderAskFileResearchSection(r).join('\n'), /…1 best match skipped by permission rules/);
});

test('S3 + N3: opened at a subdirectory of a repo, churn and history paths are relative to it (and non-ASCII paths are not C-quoted)', () => {
  const dir = tempRepo('seq-ask-sub-');
  fs.mkdirSync(path.join(dir, 'pkg'));
  fs.mkdirSync(path.join(dir, 'other'));
  fs.writeFileSync(path.join(dir, 'pkg', 'café.ts'), 'a');
  fs.writeFileSync(path.join(dir, 'other', 'b.ts'), 'b');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(dir, 'pkg', 'café.ts'), 'a2');
  fs.writeFileSync(path.join(dir, 'other', 'b.ts'), 'b2');
  git(dir, 'commit', '-qam', 'edit both');
  /* S-new3: later commits that never touch the subdirectory must not use up its -n window. */
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(dir, 'other', 'b.ts'), `b${i + 3}`);
    git(dir, 'commit', '-qam', `other ${i}`);
  }
  const sub = path.join(dir, 'pkg');
  assert.deepEqual(listRepoSourceFiles(sub), ['café.ts']);
  assert.deepEqual([...readGitChurn(sub)], [['café.ts', 2]]);
  assert.deepEqual([...readGitChurn(sub, { commits: 3 })], [['café.ts', 2]], 'the subtree\'s own last 3 commits, not the repo\'s');
  assert.deepEqual(readGitHistory(sub).map((c) => c.files), [['café.ts'], ['café.ts']]);
  assert.deepEqual(readGitHistory(sub, { maxCommits: 2 }).map((c) => c.subject), ['edit both', 'init']);
  assert.deepEqual(readAskLtrHistory(sub, { maxCommits: 2 }).map((c) => c.files), [['café.ts'], ['café.ts']]);
  /* At the repo root no pathspec is added (it would drop empty commits from the windows). */
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'empty');
  assert.equal(readAskLtrHistory(dir)[0]!.subject, 'empty');
});

test('S4: a tracked file over the index cap is never read whole into FILE RESEARCH: its opening only, no window search', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-huge-')));
  const line = 'const filler = "lorem ipsum dolor sit amet";\n';
  const body = line.repeat(Math.ceil((ASK_INDEX_MAX_FILE_BYTES + 10_000) / line.length)) + 'export function reconcileLedgerEntries() {}\n';
  fs.writeFileSync(path.join(dir, 'huge.json'), body);
  const r = readAskResearchFiles((p) => resolveInRepo(dir, p), ['huge.json'], undefined, undefined, 'reconcile ledger entries');
  assert.equal(r.files[0]!.startLine, undefined, 'the opening, not a window');
  assert.ok(r.files[0]!.truncated);
  assert.ok(r.files[0]!.content.startsWith('const filler'));
  assert.ok(r.files[0]!.content.length <= 2000);
  const w = bestMatchingWindow(body, 'reconcile ledger entries', 2000);
  assert.equal(w.startLine, 1, 'over the cap the window search bails out to the opening');
});

test('S6: grep only scores files the F50 or history arms already ranked (counts from the bounded grep cache, not a second copy of the texts)', () => {
  const files: [string, string][] = [
    ['src/a.ts', 'export const outbox = 1; // drain the outbox'],
    ['src/z.ts', 'export const xoutboxy = 2; // substring only'],
  ];
  const index = buildAskFileIndex(files);
  assert.ok(!('lower' in index));
  const hyb = scoreAskFileHybrid(index, 'outbox drain');
  assert.ok(hyb.has('src/a.ts'));
  assert.ok(!hyb.has('src/z.ts'), 'a grep-only substring match is not scored');
});

test('S7: only universal skips: a user\'s logs/ or lab/ module is source, and a "Log ..." commit is history', () => {
  assert.ok(isAskIndexSource('src/logs/logger.ts'));
  assert.ok(isAskIndexSource('app/lab/results.ts'));
  assert.ok(isAskIndexSource('tmp/x.ts'));
  assert.ok(!isAskIndexSource('dist/x.js') && !isAskIndexSource('vendor/x.js'));
  const dir = tempRepo('seq-ask-noise-');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'Log 401s on retry');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'b');
  git(dir, 'commit', '-qam', 'wip');
  assert.deepEqual(readGitHistory(dir).map((c) => c.subject), ['Log 401s on retry']);
  assert.deepEqual(readGitHistory(dir, { noiseSubject: /^log\b/i }).map((c) => c.subject), [], 'a bench can add its own');
});

/* The 0004 implementation, kept verbatim as the reference for M3's equivalence check. */
function bestMatchingWindowReference(text: string, question: string, budget: number, step = 5) {
  const lines = text.split('\n');
  const windows: [number, number][] = [];
  for (let s = 0; s < lines.length; s += step) {
    let bytes = 0;
    let e = s;
    while (e < lines.length && bytes + lines[e]!.length + 1 <= budget) {
      bytes += lines[e]!.length + 1;
      e++;
    }
    if (e === s) e = s + 1;
    windows.push([s, e]);
    if (e >= lines.length) break;
  }
  const q = [...new Set(askTokens(question))];
  const tfs = windows.map(([s, e]) => {
    const m = new Map<string, number>();
    for (const t of askTokens(lines.slice(s, e).join('\n'))) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const df = new Map<string, number>();
  for (const m of tfs) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  let best = 0;
  let bestScore = 0;
  tfs.forEach((m, i) => {
    let v = 0;
    for (const t of q) {
      const c = m.get(t);
      if (c) v += Math.log(1 + c) * Math.log(1 + windows.length / df.get(t)!);
    }
    if (v > bestScore) {
      bestScore = v;
      best = i;
    }
  });
  const [s, e] = windows[best] ?? [0, lines.length];
  let content = lines.slice(s, e).join('\n');
  if (content.length > budget) content = content.slice(0, budget);
  return { startLine: s + 1, endLine: e, content, totalLines: lines.length };
}

test('M3: bestMatchingWindow is linear (each line tokenised once, prefix sums) and returns exactly what the windowed version returned', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const vocab = ['ledger', 'reconcile', 'entries', 'retryQueue', 'drain_outbox', 'socket', 'the', 'x', 'flushAll', '42', 'snake_case_name'];
  for (let trial = 0; trial < 40; trial++) {
    const nLines = 1 + Math.floor(rnd() * 400);
    const lines = Array.from({ length: nLines }, () => {
      const n = Math.floor(rnd() * 14);
      /* Occasionally a line longer than the budget. */
      return rnd() < 0.02 ? 'y'.repeat(3000) : Array.from({ length: n }, () => vocab[Math.floor(rnd() * vocab.length)]).join(' ');
    });
    const text = lines.join(rnd() < 0.2 ? '\r\n' : '\n');
    const question = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => vocab[Math.floor(rnd() * vocab.length)]).join(' ');
    const budget = [200, 800, 2000][trial % 3]!;
    const step = [5, 1, 3][trial % 3]!;
    assert.deepEqual(bestMatchingWindow(text, question, budget, step), bestMatchingWindowReference(text, question, budget, step), `trial ${trial}`);
  }
  assert.deepEqual(bestMatchingWindow('', 'q', 2000), bestMatchingWindowReference('', 'q', 2000));
  /* Timing guard: a 500 KB source file. The windowed version took 300-540 ms on codeforge files of this size. */
  const big = Array.from({ length: 6_000 }, (_, i) => `export function handler${i}(req, res) { return reconcileLedger(req.body.entries, ${i}); }`).join('\n');
  assert.ok(big.length > 500_000);
  const q = 'reconcile ledger entries handler5999';
  bestMatchingWindow(big, 'reconcile ledger entries', 2000);
  /* Judged against THIS run's baseline, not a wall clock: the windowed reference answers the same question on the same
     text in the same process, so load slows both. The linear version must beat it by 2x (it is ~10x under it when idle).
     Best of three on each side, so one descheduled slice does not decide the comparison. */
  const timed = (fn: () => { content: string }) => {
    let best = Infinity;
    let last: { content: string } | undefined;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      last = fn();
      best = Math.min(best, performance.now() - t0);
    }
    return { ms: best, out: last! };
  };
  const lin = timed(() => bestMatchingWindow(big, q, 2000));
  const ref = timed(() => bestMatchingWindowReference(big, q, 2000));
  assert.ok(lin.out.content.includes('handler5999'));
  assert.deepEqual(lin.out, ref.out);
  /* "Linear" is a claim about growth, so it is checked as growth: four times the text may cost at most about four
     times the time (bound 8, for noise), where re-tokenising every window grows with the square (16x). Both sizes are
     timed in the same run, so load slows both. A ratio against the windowed reference was a constant-factor bet: it
     read 1.96x on a busy machine against a 2x bar, on correct code. */
  const quarter = big.split('\n').slice(0, 1_500).join('\n');
  /* Seven interleaved samples, best of each: a descheduled slice or a GC pause on one sample cannot decide it. */
  const small = { ms: Infinity };
  for (let k = 0; k < 7; k++) {
    let t0 = performance.now();
    bestMatchingWindow(quarter, q, 2000);
    small.ms = Math.min(small.ms, performance.now() - t0);
    t0 = performance.now();
    bestMatchingWindow(big, q, 2000);
    lin.ms = Math.min(lin.ms, performance.now() - t0);
  }
  const growsLinearly = (smallMs: number, bigMs: number) => bigMs < 8 * Math.max(smallMs, 0.5);
  assert.ok(growsLinearly(small.ms, lin.ms), `4x the text took ${(lin.ms / Math.max(small.ms, 0.5)).toFixed(1)}x the time (${small.ms.toFixed(1)} ms -> ${lin.ms.toFixed(1)} ms)`);
  /* Negative control: the predicate rejects quadratic growth (4x the input, 16x the time). */
  assert.ok(!growsLinearly(10, 160), 'control: quadratic growth is rejected');
});

test('S-new1: an ask reads no file to grep (the lowercased text is cached in the index), and a file past the text cap is never read for it', async () => {
  const dir = tempRepo('seq-ask-grepcache-');
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(dir, `f${i}.ts`), `export const outboxDrain${i} = 'drain the outbox ${i}';\n`.repeat(40));
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'files');
  let reads = 0;
  const counting = (p: string) => {
    reads++;
    return resolveInRepo(dir, p);
  };
  const index = await buildAskFileIndexAsync(dir, [], counting, { ltr: false });
  assert.ok(index);
  reads = 0;
  const hyb = scoreAskFileHybrid(index, 'drain the outbox');
  assert.ok(hyb.size > 0);
  assert.equal(reads, 0, 'grep scored from the index, not from disk');
  /* Past the cap: indexed by path only, and grep never reads it at query time. */
  const capped = await buildAskFileIndexAsync(dir, [], counting, { maxTextBytes: 4000, ltr: false });
  assert.ok(capped?.textCapped);
  reads = 0;
  const g = scoreAskFileHybrid(capped, 'outboxDrain29');
  assert.equal(reads, 0);
  assert.ok(![...g.keys()].some((f) => !capped.grep.hasText(capped.files.indexOf(f)) && f !== 'f29.ts'), 'no grep score from an unread file');
  /* The cache's grep counts equal counting in the lowercased text. */
  const counts = capped.grep.wordCounts('outbox');
  const f0 = capped.files.indexOf('f0.ts');
  assert.equal(counts.get(f0), 80);
});

test('S-new4: a one-shot ask (headless sequence ask) waits for the index and its LTR stage, then ranks by contents', async () => {
  const dir = tempRepo('seq-ask-oneshot-');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'caret-app', version: '1.0.0', main: 'src/app.ts' }));
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), "import './theme.css';\nexport const app = 1;\n");
  fs.writeFileSync(path.join(dir, 'src', 'theme.css'), '.composer { --composer-caret-blink: 1s; }\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  const graph = await scanRepo(dir, { cluster: true });
  const digest = buildDigest(graph);
  const question = 'show me the code for the composer caret blink';
  const resolve = (p: string) => resolveInRepo(dir, p);
  assert.equal(await awaitAskFileIndexForOneShot({ graph, digest, question: 'hello there', repoRoot: dir, resolveReadable: resolve }), null, 'no FILE RESEARCH, no wait');
  const index = await awaitAskFileIndexForOneShot({ graph, digest, question, repoRoot: dir, resolveReadable: resolve });
  assert.ok(index?.ltr, 'the LTR stage is in before the ask runs');
  assert.equal(readyAskFileIndex(graph, dir), index);
  const r = gatherAskFileResearch({ graph, digest, question, resolveReadable: resolve, repoRoot: dir });
  assert.equal(r.files[0]?.path, 'src/theme.css');
  /* And the CLI calls it before the pipeline. */
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'askCli.ts'), 'utf8');
  const at = src.indexOf('await awaitAskFileIndexForOneShot(');
  assert.ok(at > 0 && at < src.indexOf('await runAskPipeline('), 'askCli awaits the index before runAskPipeline');
});

test('REVIEW-v3 #2: the one-shot index wait ends on the abort signal (Ctrl-C, --timeout) and on its cap, and cancels the build', async () => {
  const dir = tempRepo('seq-ask-oneshot-abort-');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'slow-app', version: '1.0.0', main: 'src/f0.ts' }));
  for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(dir, 'src', `f${i}.ts`), `export const caret${i} = 'composer caret blink ${i}';\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  const graph = await scanRepo(dir, { cluster: true });
  const digest = buildDigest(graph);
  const question = 'show me the code for the composer caret blink';
  /* Every read costs 10 ms of CPU: the whole build takes 3 s or more. */
  const slow = (p: string) => {
    const until = Date.now() + 10;
    while (Date.now() < until);
    return resolveInRepo(dir, p);
  };
  const cancelled = () => new Promise<void>((resolve) => askIndexEvents.on('cancelled', function on(root: string) {
    if (root !== dir) return;
    askIndexEvents.off('cancelled', on);
    resolve();
  }));

  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  let t = Date.now();
  let gone = cancelled();
  assert.equal(await awaitAskFileIndexForOneShot({ graph, digest, question, repoRoot: dir, resolveReadable: slow, signal: ac.signal }), null);
  assert.ok(Date.now() - t < 1000, `aborted wait returned after ${Date.now() - t} ms`);
  await gone;
  assert.equal(readyAskFileIndex(graph, dir), undefined, 'the cancelled build left nothing behind');

  let gaveUp = -1;
  t = Date.now();
  gone = cancelled();
  assert.equal(await awaitAskFileIndexForOneShot({ graph, digest, question, repoRoot: dir, resolveReadable: slow, maxWaitMs: 50, onGiveUp: (ms) => (gaveUp = ms) }), null);
  assert.ok(Date.now() - t < 1000, `capped wait returned after ${Date.now() - t} ms`);
  assert.ok(gaveUp >= 50, `onGiveUp was told ${gaveUp} ms for a 50 ms cap (-1: never told)`);
  await gone;

  /* The cap never exceeds ASK_ONESHOT_INDEX_WAIT_MS, and askCli passes its controller's signal. */
  assert.equal(ASK_ONESHOT_INDEX_WAIT_MS, 30_000);
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'askCli.ts'), 'utf8');
  const call = src.slice(src.indexOf('await awaitAskFileIndexForOneShot('), src.indexOf('await runAskPipeline('));
  assert.match(call, /signal: controller\.signal/);
  assert.match(call, /if \(controller\.signal\.aborted\) throw new AbortedAsk\(\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the async build reads a slice of files together (its time is not the disk latency times the file count) and builds the same index as one read at a time', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-askidx-par-')));
  try {
    for (let i = 0; i < 120; i++) fs.writeFileSync(path.join(dir, `m${i}.ts`), `export function handle${i}Invoice() { return ${i}; }\n`);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'files'], { cwd: dir });
    const real = fs.promises.readFile;
    let inFlight = 0;
    let peak = 0;
    (fs.promises as { readFile: unknown }).readFile = async (...a: Parameters<typeof real>) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setImmediate(r)); // a read that takes a turn of the loop, as a busy disk does
        return await real(...a);
      } finally {
        inFlight--;
      }
    };
    try {
      const resolve = (p: string) => resolveInRepo(dir, p);
      const together = await buildAskFileIndexAsync(dir, [], resolve, { ltr: false });
      const togetherPeak = peak;
      peak = 0;
      const oneByOne = await buildAskFileIndexAsync(dir, [], resolve, { ltr: false, yieldEvery: 1 });
      assert.ok(together && oneByOne);
      assert.ok(togetherPeak > 10, `a slice was read together (peak ${togetherPeak} reads in flight)`);
      assert.equal(peak, 1, `control: with a slice of one the reads are one at a time (peak ${peak})`);
      assert.deepEqual(together.files, oneByOne.files);
      assert.deepEqual([...together.df], [...oneByOne.df]);
      for (const f of together.files) assert.deepEqual([...together.docs.get(f)!.tf], [...oneByOne.docs.get(f)!.tf], f);
    } finally {
      (fs.promises as { readFile: unknown }).readFile = real;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
