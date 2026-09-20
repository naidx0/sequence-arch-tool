/**
 * THE BELT THE HARNESS ACTUALLY NEEDED — ranged reads, surgical edits, the
 * grounded graph, and a tool call that is never silently thrown away.
 *
 * Every test here is built to a shape a fixture could not produce by accident:
 * a file bigger than the read cap, an `oldString` that occurs twice, a service
 * whose files are not in the prompt. The four defects these lock were all
 * invisible at fixture scale.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import {
  ASK_TOOL_READ_CAP_BYTES,
  executeAskTool,
  parseFencedToolRequests,
  stripReadFileGutter,
  type AskToolContext,
} from '../server/askTools.js';
import {
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-belt-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  return fs.realpathSync(repo);
}

function ctxFor(root: string, extra: Partial<AskToolContext> = {}): AskToolContext {
  return {
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    designMode: false,
    ...extra,
  };
}

/** A file bigger than the read cap — the shape 22% of this repo's own source has. */
function writeBigFile(root: string, rel: string, lines: number): string[] {
  const body = Array.from({ length: lines }, (_, i) => `const line${i} = ${i}; // padding padding padding`);
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body.join('\n'));
  return body;
}

/* ============================================================== read_file === */

test('READ_FILE CAN REACH PAST ITS OWN CAP — offset, limit, and a way back', async () => {
  /*
   * It used to take exactly `{ path }` and return `raw.slice(0, 12_000)`. The
   * marker said "(truncated)" and there was no follow-up call that got more, so
   * a function below byte 12,000 was unreachable — and the per-turn cache keyed
   * on the arguments, which could not vary, so every later read returned the
   * same head. 201 of this repository's own 912 TypeScript files are over that
   * cap.
   */
  const root = tmpRepo();
  const lines = writeBigFile(root, 'src/big.ts', 900);
  assert.ok(lines.join('\n').length > ASK_TOOL_READ_CAP_BYTES, 'the fixture must exceed the cap');
  const needle = lines[800];

  const head = await executeAskTool('read_file', { path: 'src/big.ts' }, ctxFor(root));
  assert.ok(head.ok);
  assert.ok(!head.content!.includes(needle), 'the head slice cannot reach line 800');
  /* The cut names the exact call that continues it, rather than only that it
     happened — inert advice is the defect this file already records once. */
  assert.match(head.content!, /call read_file again with \{"path":"src\/big\.ts","offset":\d+\}/);

  /* Page until the needle is reached. Each page must name the offset of the
     next one, which is the property that makes the whole file reachable. */
  let page = head;
  let pages = 1;
  while (!page.content!.includes(needle)) {
    const offsetMatch = /"offset":(\d+)\}/.exec(page.content!);
    assert.ok(offsetMatch, `page ${pages} stopped without naming a continuation offset`);
    page = await executeAskTool(
      'read_file',
      { path: 'src/big.ts', offset: Number(offsetMatch![1]) },
      ctxFor(root),
    );
    assert.ok(page.ok, page.evidence);
    pages += 1;
    assert.ok(pages < 20, 'paging must converge');
  }
  assert.ok(pages > 1, "line 800 is past the first page, which is the whole point");

  const window = await executeAskTool(
    'read_file',
    { path: 'src/big.ts', offset: 801, limit: 2 },
    ctxFor(root),
  );
  assert.ok(window.content!.includes(needle));
  assert.ok(!window.content!.includes(lines[810]), 'limit really bounds the window');
  assert.match(window.content!, /lines 801-802 of 900/);
});

test('read_file numbers its lines, and the gutter is reversible', async () => {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'alpha\nbeta\ngamma\n');
  const r = await executeAskTool('read_file', { path: 'src/a.ts' }, ctxFor(root));
  assert.match(r.content!, /^\s+2\|beta$/m, 'cat -n style gutter so an answer can cite a line');
  assert.strictEqual(stripReadFileGutter('    2|beta\n    3|gamma'), 'beta\ngamma');
});

/* ============================================================== edit_file === */

test('EDIT_FILE CHANGES A LINE WITHOUT REWRITING THE FILE', async () => {
  /*
   * Before this tool the only write path was `propose_files`, whose schema is
   * the WHOLE new body. Changing one line in a 900-line file meant emitting 900
   * lines — from a read that had shown the model the first 12,000 bytes of it.
   * The realistic outcome was a proposal that silently deleted the tail.
   */
  const root = tmpRepo();
  const lines = writeBigFile(root, 'src/big.ts', 900);
  const result = await executeAskTool(
    'edit_file',
    {
      path: 'src/big.ts',
      title: 'Rename line 800',
      edits: [{ oldString: 'const line800 = 800;', newString: 'const line800 = 8000;' }],
    },
    ctxFor(root),
  );
  assert.ok(result.ok, result.evidence);
  assert.ok(result.proposal, 'it stages the same reviewable proposal propose_files does');
  const proposed = result.proposal!.files[0];
  assert.strictEqual(proposed.path, 'src/big.ts');
  assert.ok(proposed.content.includes('const line800 = 8000;'));
  assert.strictEqual(
    proposed.content.split('\n').length,
    lines.length,
    'every other line survives — nothing is reconstructed from what the model could see',
  );
  assert.strictEqual(
    fs.readFileSync(path.join(root, 'src/big.ts'), 'utf8'),
    lines.join('\n'),
    'and nothing is written to disk',
  );
});

test('an AMBIGUOUS oldString is refused with its count, never applied to the wrong line', async () => {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'dup.ts'), 'x = 1;\ny = 2;\nx = 1;\n');
  const ambiguous = await executeAskTool(
    'edit_file',
    { path: 'src/dup.ts', edits: [{ oldString: 'x = 1;', newString: 'x = 3;' }] },
    ctxFor(root),
  );
  assert.ok(!ambiguous.ok);
  assert.match(ambiguous.evidence, /appears 2 times/);
  assert.ok(!ambiguous.proposal, 'an ambiguous edit stages nothing at all');

  const all = await executeAskTool(
    'edit_file',
    { path: 'src/dup.ts', edits: [{ oldString: 'x = 1;', newString: 'x = 3;', replaceAll: true }] },
    ctxFor(root),
  );
  assert.ok(all.ok, all.evidence);
  assert.strictEqual(all.proposal!.files[0].content, 'x = 3;\ny = 2;\nx = 3;\n');
});

test('an ABSENT oldString is refused with actionable advice, not silently ignored', async () => {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'alpha\n');
  const miss = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', edits: [{ oldString: 'omega', newString: 'zeta' }] },
    ctxFor(root),
  );
  assert.ok(!miss.ok);
  assert.match(miss.evidence, /does not appear in src\/a\.ts/);
  assert.match(miss.evidence, /read_file/, 'the refusal names the way out');
});

test("edit_file tolerates read_file's own line gutter — one reversal, never a guess", async () => {
  /* The model copies the tool output it was given. The numbers came from THIS
     module, so stripping them back off is a reversal, not fuzzy matching. */
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'alpha\nbeta\n');
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', edits: [{ oldString: '    2|beta', newString: 'BETA' }] },
    ctxFor(root),
  );
  assert.ok(r.ok, r.evidence);
  assert.strictEqual(r.proposal!.files[0].content, 'alpha\nBETA\n');
});

test('edit_file refuses a file that does not exist and says which tool creates one', async () => {
  const root = tmpRepo();
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/nope.ts', edits: [{ oldString: 'a', newString: 'b' }] },
    ctxFor(root),
  );
  assert.ok(!r.ok);
  assert.match(r.evidence, /propose_files/);
});

/* ========================================================== read_topology === */

test('READ_TOPOLOGY GETS BACK WHAT THE INDEX LEFT OUT — and refuses to invent one', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);
  const root = tmpRepo();
  const ctx = ctxFor(root, { digest, graph });

  const list = await executeAskTool('read_topology', {}, ctx);
  assert.ok(list.ok, list.evidence);
  for (const svc of digest.services) {
    assert.ok(list.content!.includes(svc.id), `${svc.id} is named in the index listing`);
  }

  const first = digest.services[0];
  const one = await executeAskTool('read_topology', { service: first.id }, ctx);
  assert.ok(one.ok, one.evidence);
  for (const f of first.files.slice(0, 3)) {
    assert.ok(one.content!.includes(f.path), `${f.path} comes back in full`);
  }

  const unknown = await executeAskTool('read_topology', { service: 'svc:not-a-thing' }, ctx);
  assert.ok(!unknown.ok);
  assert.match(unknown.evidence, /real service ids are/, 'a weak model can recover in-turn');
  assert.ok(unknown.evidence.includes(first.id));

  const noDigest = await executeAskTool('read_topology', {}, ctxFor(root));
  assert.ok(!noDigest.ok, 'with no digest it refuses rather than inventing a service list');
});

/* ============================================================== who_calls === */

test('WHO_CALLS ANSWERS FROM THE SCANNED GRAPH, NOT FROM A SUBSTRING WALK', async () => {
  /*
   * Sequence exports twelve grounded graph tools to OTHER agents over MCP and
   * gave its own model none of them: asked what breaks if a file changes, the
   * in-app agent grepped. Every row here is a real scanned edge.
   */
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const root = tmpRepo();
  const ctx = ctxFor(root, { graph, digest: buildDigest(graph) });

  const fileNode = graph.nodes.find(
    (n) => n.kind === 'file' && graph.edges.some((e) => e.dstId === n.id),
  );
  assert.ok(fileNode, 'the fixture must have at least one file with an inbound edge');

  const r = await executeAskTool('who_calls', { target: fileNode!.path ?? fileNode!.id }, ctx);
  assert.ok(r.ok, r.evidence);
  assert.match(r.content!, /INCOMING \(\d+\)/);
  assert.match(r.content!, /OUTGOING \(\d+\)/);
  assert.match(r.content!, /BLAST RADIUS: \d+ nodes?/);

  const expectedIn = graph.edges.filter((e) => e.dstId === fileNode!.id).length;
  assert.match(
    r.evidence,
    new RegExp(`${expectedIn} in\\b`),
    'the count is the real edge count, not an estimate',
  );

  /*
   * THE REFERENTS ARE THE REAL CALLERS, not a re-parse of the prose above.
   *
   * The fourth carry slot hands this list to the next turn so a follow-up
   * saying "of those, which one first" has an antecedent. If it were scraped
   * back out of `content` it would be a guess about what the tool said; this
   * asserts it is the same set the scanned edges produced.
   */
  assert.ok(r.referents, 'who_calls must expose what its answer was about');
  assert.equal(r.referents!.tool, 'who_calls');
  /*
   * DISTINCT callers, not edges: two imports from one file are one file to
   * change, and the next turn is being asked which FILE to change first.
   */
  const callerIds = new Set(
    graph.edges.filter((e) => e.dstId === fileNode!.id).map((e) => e.srcId),
  );
  const callerNames = new Set(
    [...callerIds].map((id) => {
      const n = graph.nodes.find((x) => x.id === id);
      return ((n?.path ?? n?.label ?? id) as string).split('\\').join('/');
    }),
  );
  assert.equal(r.referents!.total, callerNames.size, 'the referent count is the distinct callers');
  assert.ok(r.referents!.total <= expectedIn, 'distinct callers cannot exceed edges');
  for (const item of r.referents!.items) {
    assert.ok(callerNames.has(item), `referent ${item} is not one of the scanned callers`);
  }
  assert.equal(
    new Set(r.referents!.items).size,
    r.referents!.items.length,
    'a caller must not be listed twice',
  );

  const missing = await executeAskTool('who_calls', { target: 'nothing/like/this.ts' }, ctx);
  assert.ok(!missing.ok);
  assert.match(missing.evidence, /found no node matching/);

  const noGraph = await executeAskTool('who_calls', { target: 'a.ts' }, ctxFor(root));
  assert.ok(!noGraph.ok, 'with no graph it refuses rather than guessing');
  assert.equal(missing.referents, undefined, 'a refusal carries no referents');
  assert.equal(noGraph.referents, undefined, 'a refusal carries no referents');
});

/* ====================================================== malformed fences === */

test('A MALFORMED TOOL BLOCK IS REPORTED, NOT DROPPED', () => {
  /*
   * It used to be stripped from the answer and silently discarded: no request,
   * no error, nothing in the round's results. Weak local models emit
   * slightly-off tool JSON constantly, and every one of those was a turn where
   * the request vanished and the user got a short answer citing a file nothing
   * had read.
   */
  const broken =
    'Let me look.\n\n```sequence-tool\n{"id":"t1","name":"read_file" "args":{"path":"a.ts"}}\n```\n\nDone.';
  const parsed = parseFencedToolRequests(broken);
  assert.strictEqual(parsed.requests.length, 0);
  assert.strictEqual(parsed.malformed.length, 1);
  assert.match(parsed.malformed[0], /not valid JSON/);
  assert.match(parsed.malformed[0], /SINGLE JSON object with keys id, name, args/);
});

test('the two repairs are reversals of known damage, and nothing else is guessed', () => {
  const trailingComma =
    '```sequence-tool\n{"id":"t1","name":"read_file","args":{"path":"a.ts"},}\n```';
  const repaired = parseFencedToolRequests(trailingComma);
  assert.strictEqual(repaired.requests.length, 1, 'a trailing comma is recovered');
  assert.strictEqual(repaired.malformed.length, 0);

  const structural = '```sequence-tool\n{"id":"t1"\n```';
  const notRepaired = parseFencedToolRequests(structural);
  assert.strictEqual(notRepaired.requests.length, 0);
  assert.strictEqual(notRepaired.malformed.length, 1, 'structural damage stays reported');
});

test('a block naming a tool that does not exist is told which tools do', () => {
  const wrong = '```sequence-tool\n{"id":"t1","name":"grep","args":{"q":"x"}}\n```';
  const parsed = parseFencedToolRequests(wrong);
  assert.strictEqual(parsed.requests.length, 0);
  assert.match(parsed.malformed[0], /"grep", which is not a tool/);
  assert.match(parsed.malformed[0], /read_file/);
});

test('THE PIPELINE SPENDS ONE ROUND FIXING A MALFORMED BLOCK', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-belt-repo-'));
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });

  const prompts: string[] = [];
  let call = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    prompts.push(prompt);
    call += 1;
    if (call === 1) {
      return {
        text: 'Reading.\n\n```sequence-tool\n{"id":"t1","name":"read_file" "args":{"path":"gateway/src/routes/orders.ts"}}\n```',
      };
    }
    return { text: 'The orders route is in gateway/src/routes/orders.ts.' };
  };

  const input: AskPipelineInput = {
    question: 'Where is the orders route?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    callProvider,
  };

  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.strictEqual(prompts.length, 2, 'the malformed block buys exactly one corrective round');
  assert.match(
    prompts[1],
    /### tool \(not executed\)/,
    "the model is told its block was not executed and why",
  );
  assert.match(prompts[1], /not valid JSON/);
  assert.ok(
    !result.text.includes('sequence-tool'),
    'and the broken fence never reaches the reader',
  );
});

/* ======================================================== evidence ledger === */

test('THE SAME FILE IS NOT PAID FOR TWICE — one copy, dated by its latest fetch', async () => {
  /*
   * MEASURED, driving this pipeline against a local ornith:9b on the real
   * Sequence monorepo: the model called `read_file` on the same path with the
   * same arguments in four consecutive rounds. The per-turn cache stopped the
   * disk reads, but each hit still pushed the SAME 12,000-character body onto
   * the evidence ledger, so the prompt grew by that much every round —
   * 53,575 characters at round one, 103,091 by round six, for one file read
   * once. Nothing said "you already ran this", so nothing discouraged it.
   */
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-ledger-'));
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const target = 'gateway/src/routes/orders.ts';
  const marker = fs.readFileSync(path.join(root, target), 'utf8').split('\n')[0];

  const prompts: string[] = [];
  let call = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    prompts.push(prompt);
    call += 1;
    if (call <= 3) {
      return {
        text: 'looking',
        toolRequests: [{ id: `t${call}`, name: 'read_file', args: { path: target } }],
      };
    }
    return { text: 'The orders route handles POST /orders.' };
  };

  const input: AskPipelineInput = {
    question: 'How does the gateway route orders in the source code?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    callProvider,
  };

  await runAskPipeline(input, () => {});

  assert.ok(prompts.length >= 4, 'the model asked three times and then answered');
  const last = prompts[prompts.length - 1];
  /* Count inside the TOOL RESULTS section only — FILE RESEARCH renders the same
     header for its own opening excerpt, and that copy is not the ledger. */
  const toolSection = last.slice(last.indexOf('TOOL RESULTS'));
  const occurrences = toolSection.split(`### ${target}`).length - 1;
  assert.strictEqual(
    occurrences,
    1,
    `one read must appear once in the ledger, not once per request (found ${occurrences})`,
  );
  assert.ok(last.includes(marker), 'and the body is still there — nothing was dropped');

  /* The ledger stops growing once the model is only re-asking for what it has. */
  const growth = prompts[3].length - prompts[2].length;
  assert.ok(
    growth < 500,
    `a repeated identical read must not re-charge its body (grew ${growth} chars)`,
  );
  assert.match(
    last,
    /you already ran this exact call this turn/,
    'and the model is told that it did, rather than handed identical bytes in silence',
  );
});
