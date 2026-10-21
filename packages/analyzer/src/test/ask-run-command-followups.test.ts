/**
 * Follow-ups to the Pi-style run_command / edit_file work:
 *  1. a timed-out or very large run still shows its last lines (verifyGate returns timedOut + partial output),
 *  2. .sequence/tmp keeps itself out of git,
 *  3. a Build-mode APPLIED edit still gives the model the diff (askPipeline used to replace the result with "wrote N files").
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runAllowlistedRepoCommand } from '../harness/verifyGate.js';
import { executeAskTool, type AskToolContext } from '../server/askTools.js';
import { runAskPipeline } from '../server/askPipeline.js';
import { applyAskFileWrites } from '../server/applyAskFileWrites.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';
import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';

/* The test runner shares one SEQUENCE_USER_DIR across files; trust is a read-modify-write file, so own a private store. */
let ownStore: string | undefined;
function repoWith(files: Record<string, string>): string {
  if (!ownStore) {
    ownStore = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-own-user-'));
    process.env.SEQUENCE_USER_DIR = ownStore;
  }
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-run-follow-')));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  setRepoTrust(userStoreDir(), dir, true);
  return dir;
}

const ctxFor = (root: string, permission = 'build'): AskToolContext =>
  ({
    repoRoot: root,
    resolveReadable: (rel: string) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(root) ? abs : null;
    },
    designMode: false,
    permission,
  }) as AskToolContext;

test('verifyGate: a timed-out command returns timedOut and what it had printed', () => {
  const root = repoWith({ 'slow.js': "console.log('first');\nsetTimeout(() => {}, 20000);\n" });
  const ran = runAllowlistedRepoCommand('node slow.js', root, { timeoutMs: 5000, widenToRunnerBins: true });
  assert.strictEqual(ran.timedOut, true);
  assert.strictEqual(ran.ok, false);
  assert.match(ran.output, /first/);
});

test('verifyGate: a run that is not timed out is not flagged', () => {
  const root = repoWith({ 'ok.js': "console.log('x');\n" });
  const ran = runAllowlistedRepoCommand('node ok.js', root, { widenToRunnerBins: true });
  assert.notStrictEqual(ran.timedOut, true);
  assert.strictEqual(ran.ok, true);
});

test('run_command: a timeout shows the last lines it printed, and says it timed out', async () => {
  const root = repoWith({ 'slow.js': "for (let i = 1; i <= 50; i++) console.log('step ' + i);\nsetTimeout(() => {}, 20000);\n" });
  const r = await executeAskTool('run_command', { cmd: 'node slow.js', timeout: 2 }, ctxFor(root));
  assert.strictEqual(r.ok, false);
  const out = `${r.evidence}\n${r.content}`;
  assert.match(out, /timed out after 2s/);
  assert.match(out, /step 50/);
});

test('run_command: output over the old 1 MB buffer still shows its tail', async () => {
  const root = repoWith({ 'huge.js': "const l = 'x'.repeat(99);\nfor (let i = 1; i <= 20000; i++) console.log(l + i);\nconsole.log('TESTS PASSED');\n" });
  const r = await executeAskTool('run_command', { cmd: 'node huge.js' }, ctxFor(root));
  assert.strictEqual(r.ok, true, r.evidence);
  assert.match(r.content!, /TESTS PASSED/);
});

test('.sequence/tmp ignores itself, so saved run output never reaches git', async () => {
  const root = repoWith({ 'big.js': "for (let i = 1; i <= 5000; i++) console.log('L' + i);\n" });
  await executeAskTool('run_command', { cmd: 'node big.js' }, ctxFor(root));
  const ig = fs.readFileSync(path.join(root, '.sequence', 'tmp', '.gitignore'), 'utf8');
  assert.match(ig, /^\*\s*$/m);
});

test('Build mode: an applied edit_file still hands the model the diff', async () => {
  const root = repoWith({ 'package.json': '{"name":"t","type":"module"}', 'src/a.js': 'export const a = 1;\nexport const b = 2;\n' });
  const graph = await scanRepo(root, { cluster: true });
  const prompts: string[] = [];
  let round = 0;
  await runAskPipeline(
    {
      question: 'change b to 3',
      intents: [],
      scopeLines: [],
      askMode: 'research',
      deictic: false,
      designMode: false,
      graph,
      digest: buildDigest(graph),
      cfg: { provider: 'openai-compatible', model: 'x', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k' },
      resolveReadable: (rel: string) => ctxFor(root).resolveReadable(rel),
      repoRoot: root,
      permission: 'build',
      applyProposedFiles: (files: readonly { path: string; content: string }[]) =>
        applyAskFileWrites(files, { repoRoot: root, resolveWritable: (rel) => ctxFor(root).resolveReadable(rel), runPreWriteHook: async () => ({ allowed: true }) }),
      callProvider: async (_c: unknown, prompt: string) => {
        prompts.push(prompt);
        round += 1;
        if (round === 1) {
          return { text: '', toolRequests: [{ id: 'e1', name: 'edit_file', args: { path: 'src/a.js', oldString: 'b = 2', newString: 'b = 3' } }] };
        }
        return { text: 'done' };
      },
    } as never,
    () => {},
  );
  assert.strictEqual(fs.readFileSync(path.join(root, 'src/a.js'), 'utf8'), 'export const a = 1;\nexport const b = 3;\n');
  const second = prompts[1] ?? '';
  assert.match(second, /wrote 1 file/);
  assert.match(second, /-export const b = 2;/);
  assert.match(second, /\+export const b = 3;/);
});
