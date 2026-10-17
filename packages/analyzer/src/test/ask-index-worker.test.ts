import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAskFileIndexAsync, scoreAskFileHybrid, type AskFileIndex } from '../explain/askFileIndex.js';
import { buildAskFileIndexInWorker, indexFromWire, indexToWire, workerResolver } from '../explain/askIndexWorker.js';
import { scanWorkerFile } from '../scan/scanRunner.js';

/*
 * 019-P2D part 2: the ask index is built on a worker thread so the build's garbage dies with it. The index
 * that arrives must answer exactly as the one built on this thread.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const WORKER = scanWorkerFile();

/** The worker's own jail, on this thread, so both builds read the same bytes. */
const plain = workerResolver;

function sameIndex(a: AskFileIndex, b: AskFileIndex, questions: string[]): void {
  assert.deepEqual(a.files, b.files);
  assert.equal(a.n, b.n);
  assert.equal(a.avgdl, b.avgdl);
  assert.equal(a.maxChurn, b.maxChurn);
  assert.equal(a.textCapped, b.textCapped);
  assert.deepEqual([...a.churn], [...b.churn]);
  assert.deepEqual(a.hist, b.hist);
  assert.equal(a.df.size, b.df.size);
  assert.deepEqual([...a.df], [...b.df]);
  for (const f of a.files) {
    assert.equal(a.docs.get(f)!.len, b.docs.get(f)!.len, f);
    assert.deepEqual([...a.docs.get(f)!.tf], [...b.docs.get(f)!.tf], f);
    assert.deepEqual([...a.pathDocs.get(f)!], [...b.pathDocs.get(f)!], f);
  }
  assert.equal(Boolean(a.ltr), Boolean(b.ltr));
  assert.deepEqual(a.ltr, b.ltr);
  for (const q of questions) assert.deepEqual([...scoreAskFileHybrid(a, q)], [...scoreAskFileHybrid(b, q)], q);
}

async function compare(root: string, questions: string[]): Promise<void> {
  assert.ok(WORKER, 'the scan worker program is built');
  const main = await buildAskFileIndexAsync(root, [], plain(root));
  assert.ok(main);
  await main.ltrPending;
  const viaWorker = await buildAskFileIndexInWorker(root, [], WORKER, {});
  assert.ok(viaWorker);
  assert.equal(viaWorker.ltr, undefined, 'the learned stage arrives after the text stage, as in-process');
  await viaWorker.ltrPending;
  assert.ok(viaWorker.ltr, 'and it does arrive');
  sameIndex(viaWorker, main, questions);
}

test('wire round trip: the revived index equals the original (no worker)', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-wire-')));
  fs.writeFileSync(path.join(root, 'a.ts'), 'export function settleInvoice() { return 1; }\n');
  fs.writeFileSync(path.join(root, 'b.ts'), 'export const ledger = settleInvoice;\n');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'init');
  const built = await buildAskFileIndexAsync(root, [], plain(root), { ltr: false });
  assert.ok(built);
  const revived = indexFromWire(structuredClone(indexToWire(built)));
  sameIndex(revived, built, ['settle invoice', 'ledger']);
});

test('a worker-built index equals the in-process one: a fixture repo with history', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-wk-')));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.sequence'));
  fs.writeFileSync(path.join(root, '.sequence', 'ai.json'), '{"secretkeyword":"zzz"}');
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(root, 'src', `m${i}.ts`), `import { v${(i + 1) % 40} } from './m${(i + 1) % 40}';\nexport function handle${i}Invoice() { return v${(i + 1) % 40}; }\nexport const v${i} = ${i};\n`);
  git(root, 'init', '-q');
  git(root, 'add', 'src');
  git(root, 'commit', '-qm', 'add the invoice handlers');
  fs.appendFileSync(path.join(root, 'src', 'm3.ts'), '// retry the payment\n');
  git(root, 'commit', '-qam', 'retry payment in handler three');
  await compare(root, ['handle invoice', 'retry payment', 'where is the invoice handler 3', 'secretkeyword']);
});

test('a worker-built index equals the in-process one: this repository (real scale)', { timeout: 240_000 }, async () => {
  const root = path.resolve(here, '..', '..', '..', '..');
  assert.ok(fs.existsSync(path.join(root, 'pnpm-workspace.yaml')), root);
  await compare(root, ['where is the retry delay computed', 'ask file index warm up', 'scan worker standby', 'heap snapshot memory']);
});

test('cancelling terminates the worker and yields null; a missing worker program rejects (the caller falls back)', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ask-wk2-')));
  fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;\n');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'init');
  assert.equal(await buildAskFileIndexInWorker(root, [], WORKER!, { cancelled: () => true }), null);
  await assert.rejects(buildAskFileIndexInWorker(root, [], path.join(root, 'no-such-worker.js'), {}));
});
