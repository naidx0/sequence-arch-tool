/**
 * read_file continuation (docs/research/pi-and-opencode-study.md, change 3).
 *
 * When a read is cut, the result ENDS with one exact line a model can act on:
 *   [truncated: call read_file with offset=N to continue]
 * and `offset` (1-based line) pages precisely, so paging a file reads every line once.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ASK_TOOL_READ_CAP_BYTES_FULL, executeAskTool, type AskToolContext } from '../server/askTools.js';

function repoWith(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-read-continue-')));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

function ctxFor(root: string, permission: 'build' | 'propose' = 'propose'): AskToolContext {
  return {
    repoRoot: root,
    resolveReadable: (rel: string) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(root) ? abs : null;
    },
    designMode: false,
    permission,
  } as AskToolContext;
}

const HINT = /^\[truncated: call read_file with offset=(\d+) to continue\]$/;
const lastLine = (s: string): string => s.split('\n').filter((l) => l !== '').at(-1) ?? '';
/** The numbered source rows of a read result: `   12|text`. */
const rows = (s: string): Array<{ n: number; text: string }> =>
  s
    .split('\n')
    .map((l) => /^\s*(\d+)\|(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ n: Number(m[1]), text: m[2]! }));

const BIG = Array.from({ length: 3000 }, (_, i) => `const row${i + 1} = ${i + 1}; // padding padding padding`).join('\n') + '\n';

test('a cut read ends with the exact continuation line, and its offset is the next unread line', async () => {
  const root = repoWith({ 'big.ts': BIG });
  const r = await executeAskTool('read_file', { path: 'big.ts' }, ctxFor(root));
  assert.strictEqual(r.ok, true);
  const m = HINT.exec(lastLine(r.content!));
  assert.ok(m, `last line was: ${lastLine(r.content!)}`);
  const shown = rows(r.content!);
  assert.strictEqual(Number(m![1]), shown.at(-1)!.n + 1);
});

test('paging with the hinted offset reads every line exactly once, in order, and the last page carries no hint', async () => {
  const root = repoWith({ 'big.ts': BIG });
  const seen: number[] = [];
  let offset = 1;
  let pages = 0;
  for (;;) {
    pages += 1;
    assert.ok(pages < 100, 'paging did not terminate');
    const r = await executeAskTool('read_file', { path: 'big.ts', offset }, ctxFor(root));
    assert.strictEqual(r.ok, true);
    const got = rows(r.content!);
    assert.ok(got.length > 0, `page at offset ${offset} was empty`);
    assert.strictEqual(got[0]!.n, offset, 'the page starts where we asked');
    seen.push(...got.map((x) => x.n));
    const m = HINT.exec(lastLine(r.content!));
    if (!m) break;
    offset = Number(m[1]);
  }
  assert.strictEqual(seen.length, 3000);
  assert.deepStrictEqual(seen, Array.from({ length: 3000 }, (_, i) => i + 1));
  assert.ok(pages > 1);
});

test('a file that fits has no hint, and a trailing newline is not a phantom last line', async () => {
  const root = repoWith({ 'small.ts': 'a\nb\nc\n' });
  const r = await executeAskTool('read_file', { path: 'small.ts' }, ctxFor(root));
  assert.doesNotMatch(r.content!, /truncated: call read_file/);
  assert.deepStrictEqual(rows(r.content!).map((x) => x.text), ['a', 'b', 'c']);
});

test('a single line longer than the byte cap still advances (no offset that points back at itself)', async () => {
  const root = repoWith({ 'wide.min.js': 'x'.repeat(ASK_TOOL_READ_CAP_BYTES_FULL * 2) + '\nsecond\nthird\n' });
  let offset = 1;
  const seen: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await executeAskTool('read_file', { path: 'wide.min.js', offset }, ctxFor(root, 'build'));
    const got = rows(r.content!);
    assert.ok(got.length > 0, 'a page with no rows is a stuck loop');
    seen.push(...got.map((x) => x.n));
    const m = HINT.exec(lastLine(r.content!));
    if (!m) break;
    assert.ok(Number(m[1]) > offset, `hint offset ${m[1]} must move past ${offset}`);
    offset = Number(m[1]);
  }
  assert.deepStrictEqual(seen, [1, 2, 3]);
});

test('the byte cap named in a cut header is the cap that applied (build reads more than propose)', async () => {
  const root = repoWith({ 'big.ts': BIG });
  const r = await executeAskTool('read_file', { path: 'big.ts' }, ctxFor(root, 'build'));
  assert.match(r.content!, new RegExp(`cut at ${ASK_TOOL_READ_CAP_BYTES_FULL} bytes`));
});
