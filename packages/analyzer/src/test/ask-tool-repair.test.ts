/**
 * WAVE A1 — REPAIR BEFORE REFUSE (docs/research/carrying-harness-plan.md).
 *
 * Every shape here was sent by a small local model and used to cost a
 * corrective round or a refusal that read as "the tool is broken". Each is a
 * reversal of one known transform, so the intended call is the only reading;
 * the harness takes it and names the repair on the result. A block that has no
 * single reading still lands in `malformed` and takes the corrective round.
 */
import assert from 'node:assert';
import { test } from 'node:test';

import {
  argsFromToolObject,
  extractIdentifierFromPhrase,
  repairAskToolArgs,
  repairToolJsonText,
} from '../server/askToolRepair.js';
import {
  parseFencedToolRequests,
  repairAskToolRequests,
  withRepairNote,
} from '../server/askTools.js';

const fence = (body: string): string => ['```sequence-tool', body, '```'].join('\n');

test('single-quoted, Python-shaped JSON parses as the call it meant', () => {
  const parsed = parseFencedToolRequests(
    fence("{'id': 'r1', 'name': 'read_file', 'args': {'path': 'src/a.ts', 'limit': None, 'raw': True}}"),
  );
  assert.deepStrictEqual(parsed.malformed, []);
  assert.strictEqual(parsed.requests.length, 1);
  assert.strictEqual(parsed.requests[0]!.name, 'read_file');
  assert.strictEqual(parsed.requests[0]!.args?.path, 'src/a.ts');
  assert.strictEqual(parsed.requests[0]!.args?.limit, null);
  assert.strictEqual(parsed.requests[0]!.args?.raw, true);
});

test('an apostrophe inside real JSON is never touched', () => {
  assert.strictEqual(repairToolJsonText('{"q": "don\'t"}'), '{"q": "don\'t"}');
});

test('arguments written at the top level are folded under args, and the fold is named', () => {
  const parsed = parseFencedToolRequests(fence('{"id":"r2","name":"read_file","path":"./src/b.ts"}'));
  assert.deepStrictEqual(parsed.malformed, []);
  const r = parsed.requests[0]!;
  assert.strictEqual(r.args?.path, 'src/b.ts');
  assert.ok(r.repairs?.some((x) => /top-level keys/.test(x)), JSON.stringify(r.repairs));
  assert.ok(r.repairs?.some((x) => /normalised "path"/.test(x)), JSON.stringify(r.repairs));
});

test('aliases fold onto the documented argument names', () => {
  const who = repairAskToolArgs('who_calls', { file: 'gateway/src/index.ts' });
  assert.strictEqual(who.args?.target, 'gateway/src/index.ts');
  assert.strictEqual(who.args?.file, undefined);
  assert.deepStrictEqual(who.repairs, ['read "file" as "target"']);

  const loc = repairAskToolArgs('locate_symbol', { symbol: 'buildDigest' });
  assert.strictEqual(loc.args?.name, 'buildDigest');

  const cmd = repairAskToolArgs('run_command', { command: 'pnpm test' });
  assert.strictEqual(cmd.args?.cmd, 'pnpm test');

  /* A canonical key already present is never overwritten by an alias. */
  const both = repairAskToolArgs('read_file', { path: 'a.ts', file: 'b.ts' });
  assert.strictEqual(both.args?.path, 'a.ts');
  assert.deepStrictEqual(both.repairs, []);
});

test('an edits array sent as a string, with old/new keys, becomes the documented shape', () => {
  const r = repairAskToolArgs('edit_file', {
    path: 'src/c.ts',
    edits: '[{"old": "const a = 1;", "new": "const a = 2;", "replace_all": false}]',
  });
  const edits = r.args?.edits as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(edits));
  assert.strictEqual(edits[0]!.oldString, 'const a = 1;');
  assert.strictEqual(edits[0]!.newString, 'const a = 2;');
  assert.strictEqual(edits[0]!.replaceAll, false);
  assert.strictEqual(edits[0]!.old, undefined);
  assert.ok(r.repairs.some((x) => /parsed "edits"/.test(x)));
  assert.ok(r.repairs.some((x) => /renamed 3 edit fields/.test(x)), JSON.stringify(r.repairs));
});

test('a single edit object is wrapped into the array the tool takes', () => {
  const r = repairAskToolArgs('edit_file', { path: 'x', edits: { oldString: 'a', newString: 'b' } });
  assert.ok(Array.isArray(r.args?.edits));
  assert.deepStrictEqual(r.repairs, ['wrapped "edits" in an array']);
});

test('plan steps written as prose lines become the list write_plan takes', () => {
  const r = repairAskToolArgs('write_plan', {
    steps: '1. Read gateway/src/index.ts\n- [ ] Add the route\n* Run pnpm test',
  });
  assert.deepStrictEqual(r.args?.steps, ['Read gateway/src/index.ts', 'Add the route', 'Run pnpm test']);
  assert.deepStrictEqual(r.repairs, ['split "steps" into 3 lines']);
});

test('structured tool_calls are repaired too, and the result line names the repair', () => {
  const [r] = repairAskToolRequests([{ id: 's1', name: 'read_file', args: { file: '.\\src\\d.ts' } }]);
  assert.strictEqual(r!.args?.path, 'src/d.ts');
  const noted = withRepairNote(r!, { ok: true, evidence: 'read src/d.ts' });
  assert.match(noted.evidence, /^read src\/d\.ts \(harness repaired the call: read "file" as "path"; normalised "path"\)$/);
  /* A canonical call carries no note at all — the line is unchanged. */
  const clean = repairAskToolRequests([{ id: 's2', name: 'read_file', args: { path: 'src/e.ts' } }]);
  assert.strictEqual(clean[0]!.repairs, undefined);
  assert.strictEqual(withRepairNote(clean[0]!, { ok: true, evidence: 'x' }).evidence, 'x');
});

test('a block with no single reading still takes the corrective round', () => {
  const parsed = parseFencedToolRequests(fence('{"id": "r9", "name": "read_file", "args": {"path": "a.ts", }, oops'));
  assert.strictEqual(parsed.requests.length, 0);
  assert.strictEqual(parsed.malformed.length, 1);
  assert.match(parsed.malformed[0]!, /not valid JSON/);
});

test('argsFromToolObject prefers an explicit args object and parses a JSON string', () => {
  assert.deepStrictEqual(argsFromToolObject({ name: 'x', args: { a: 1 } }), { args: { a: 1 }, repairs: [] });
  const fromString = argsFromToolObject({ name: 'x', args: '{"a": 2}' });
  assert.deepStrictEqual(fromString.args, { a: 2 });
  assert.deepStrictEqual(fromString.repairs, ['parsed args from a JSON string']);
  assert.deepStrictEqual(argsFromToolObject({ name: 'x' }), { args: undefined, repairs: [] });
});

test('the identifier inside a phrase is the symbol, and prose alone is nothing', () => {
  assert.strictEqual(extractIdentifierFromPhrase('the runAskPipeline function'), 'runAskPipeline');
  assert.strictEqual(extractIdentifierFromPhrase('where is build_digest defined'), 'build_digest');
  assert.strictEqual(extractIdentifierFromPhrase('find the class InvoiceController in the repo'), 'InvoiceController');
  assert.strictEqual(extractIdentifierFromPhrase('where is it defined'), undefined);
});
