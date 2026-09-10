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
  ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES,
  CARRIED_EVIDENCE_HEADER,
  MAX_ASK_TOOL_ROUNDS,
  selectCarriedEvidence,
  type AskEvidenceEntry,
} from '../server/askTools.js';
import { runAskPipeline, type AskPipelineInput } from '../server/askPipeline.js';

/**
 * Locking tests — the mid-turn EVIDENCE LEDGER.
 *
 * The defect these lock (v32-scale-and-gaps.md §2 row 3, §4 item 2): the ask
 * loop rebuilt each round's prompt from the base prompt plus ONLY the newest
 * round's tool results (`askPipeline.ts:266` vs `:338`), so a file the agent
 * read in round 1 was gone from the prompt it composed round 2's request with.
 * Three rounds of gathering collapsed to one round of usable evidence, and the
 * agent had to re-read what it had already read.
 *
 * The INVARIANT asserted here is not a field name and not a prompt heading:
 * **evidence a round produced must still be present in the prompt of every
 * later round of the same turn.** It is asserted by looking for the real file
 * bodies the loop actually fetched, so it holds regardless of how the carried
 * section is rendered.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-loop-memory-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return repo;
}

interface CannedProvider {
  text: string;
  toolRequests?: ReadonlyArray<{ id: string; name: string; args?: Record<string, unknown> }>;
}

function makeProviderScript(scripts: CannedProvider[]): {
  calls: string[];
  callProvider: AskPipelineInput['callProvider'];
} {
  const calls: string[] = [];
  let i = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    calls.push(prompt);
    const canned = scripts[Math.min(i, scripts.length - 1)]!;
    i++;
    return {
      text: canned.text,
      ...(canned.toolRequests ? { toolRequests: canned.toolRequests } : {}),
    };
  };
  return { calls, callProvider };
}

async function makeAttachedInput(
  repo: string,
  callProvider: AskPipelineInput['callProvider'],
): Promise<AskPipelineInput> {
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const digest = buildDigest(graph);
  return {
    question: 'How does the gateway route orders, invoices and shipments?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    callProvider,
  };
}

/**
 * One distinct, unmistakable symbol per fixture file, so "did round k's
 * evidence survive into round k+n's prompt" is answerable by substring.
 * Verified present in the fixture sources.
 */
const ROUND_READS: ReadonlyArray<{ path: string; marker: string }> = [
  { path: 'gateway/src/routes/orders.ts', marker: 'ordersRouter' },
  { path: 'gateway/src/routes/invoices.ts', marker: 'invoicesRouter' },
  { path: 'gateway/src/routes/shipments.ts', marker: 'shipmentsRouter' },
];

test('evidence ledger: every round s tool results survive into every later round of the same turn', async () => {
  /*
   * The script must FIT inside the ceiling, which is all this guard was ever
   * protecting: a script longer than the loop can run would silently test a
   * shorter carry than it claims to.
   *
   * It asserted EQUALITY while the cap was a fixed 3 and three rounds was
   * therefore also the maximum. The cap is now a backstop of
   * `MAX_ASK_TOOL_ROUNDS` with the everyday limit set by progress
   * (`UNPRODUCTIVE_ROUND_LIMIT`), so equality would only be re-asserting the
   * constant. The subject of this test — that round k's evidence is still in
   * round k+n's prompt — is unchanged, and the `calls.length` assertion below
   * still proves every scripted round really ran.
   */
  assert.ok(
    ROUND_READS.length <= MAX_ASK_TOOL_ROUNDS,
    'ROUND_READS must fit inside the ceiling or the carry is under-tested',
  );
  const repo = shopfrontRepo();

  // Round n asks for read n; the final call answers.
  const scripts: CannedProvider[] = ROUND_READS.map((r, i) => ({
    text: `reading ${r.path}`,
    toolRequests: [{ id: `t${i + 1}`, name: 'read_file', args: { path: r.path } }],
  }));
  scripts.push({ text: 'Final answer citing all three routers.' });

  const { calls, callProvider } = makeProviderScript(scripts);
  const input = await makeAttachedInput(repo, callProvider);
  await runAskPipeline(input);

  assert.strictEqual(
    calls.length,
    ROUND_READS.length + 1,
    `expected ${ROUND_READS.length} tool rounds then a final call`,
  );

  // THE INVARIANT. After round r has executed, the prompt handed to the model
  // (calls[r]) must still contain the body of every file read in rounds 1..r.
  for (let r = 1; r <= ROUND_READS.length; r++) {
    const promptAfterRound = calls[r]!;
    for (let k = 0; k < r; k++) {
      const { path: p, marker } = ROUND_READS[k]!;
      assert.ok(
        promptAfterRound.includes(marker),
        `round ${r + 1} prompt lost the evidence round ${k + 1} produced ` +
          `(read of ${p}, marker "${marker}") — the loop is re-briefing itself`,
      );
    }
  }
});

/* ================================================== the bound on the ledger ===== */

/**
 * The carry above is only safe because it is bounded. These lock the budget so
 * a later change cannot turn "carry the evidence" into "carry everything".
 * Proven red against a no-cap `selectCarriedEvidence` before landing.
 */

function entry(round: number, tag: string, bytes: number): AskEvidenceEntry {
  return { round, body: `${tag}:${'x'.repeat(Math.max(0, bytes - tag.length - 1))}` };
}

test('evidence ledger: earlier rounds are capped at ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES', () => {
  // Six earlier results of 20,000 bytes each = 120,000, far over the budget.
  const entries: AskEvidenceEntry[] = [];
  for (let i = 1; i <= 6; i++) entries.push(entry(1, `old${i}`, 20_000));
  entries.push(entry(2, 'fresh', 500));

  const carried = selectCarriedEvidence(entries, 2);
  const joined = carried.join('\n');

  const carriedEarlierBytes = carried
    .filter((line) => /^old\d:/.test(line))
    .reduce((n, line) => n + line.length, 0);
  assert.ok(
    carriedEarlierBytes <= ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES,
    `carried ${carriedEarlierBytes} bytes of earlier evidence, budget is ` +
      `${ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES}`,
  );
  // Newest-first retention: the most recent earlier results are the ones kept.
  assert.ok(joined.includes('old6:'), 'the most recent earlier result must survive');
  assert.ok(!joined.includes('old1:'), 'the oldest result must be the one dropped');
  // And the loss is visible, never silent.
  assert.match(joined, /dropped to stay/, 'dropped evidence must be announced to the model');
  assert.match(joined, /^\(4 earlier tool results/m, 'the notice must name how many were dropped');
});

test('evidence ledger: the current round is carried whole and is never charged to the budget', () => {
  // One current-round result on its own larger than the whole budget. Before the
  // ledger existed this was fed back in full; truncating it now would be a
  // regression, not a saving.
  const huge = entry(3, 'now', ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES + 10_000);
  const carried = selectCarriedEvidence([entry(1, 'old', 1_000), entry(2, 'mid', 1_000), huge], 3);
  assert.ok(carried.includes(huge.body), 'the current round must survive intact');
  assert.strictEqual(
    carried[carried.length - 1],
    huge.body,
    'the current round must be the last thing the model reads',
  );
});

test('evidence ledger: carried earlier results keep the order they were fetched in', () => {
  const carried = selectCarriedEvidence(
    [entry(1, 'first', 100), entry(2, 'second', 100), entry(3, 'third', 100)],
    3,
  );
  const joined = carried.join('\n');
  assert.ok(
    joined.indexOf('first:') < joined.indexOf('second:'),
    'earlier evidence must read in fetch order, not reversed',
  );
  assert.ok(joined.indexOf('second:') < joined.indexOf('third:'));
});

test('evidence ledger: nothing carried on the first round (no phantom header)', () => {
  const carried = selectCarriedEvidence([entry(1, 'only', 100)], 1);
  assert.deepStrictEqual(carried, [entry(1, 'only', 100).body]);
  assert.ok(!carried.join('\n').includes(CARRIED_EVIDENCE_HEADER));
});

/* ============================================ the fix cycle, end to end ===== */

/**
 * The measured cost of the defect, encoded as a scenario.
 *
 * A read -> verify -> propose turn needs three tool rounds, which is exactly
 * MAX_ASK_TOOL_ROUNDS. Under the old behaviour the round-3 prompt held only the
 * round-2 command output: the file bodies gathered in round 1 were gone, so a
 * model that must author whole-file `content` for `propose_files`
 * (`executeProposeFiles` refuses an entry with no `content`) had to spend
 * round 3 re-reading them. That put the proposal on the 4th provider call,
 * where `atCap` discards it. The turn produced nothing and the human had to
 * Send again.
 *
 * This asserts the precondition that makes the three-round turn possible: at
 * the moment the model must author the proposal, it can still see everything
 * this turn fetched.
 */
test('fix cycle: read -> verify -> propose fits in one turn with the evidence still visible', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Reading the three routes I need to change.',
      toolRequests: ROUND_READS.map((r, i) => ({
        id: `r${i + 1}`,
        name: 'read_file',
        args: { path: r.path },
      })),
    },
    {
      // run_command is not allowlisted for this string; the refusal notice is
      // still real round-2 evidence and is what the model must react to.
      text: 'Running the check.',
      toolRequests: [{ id: 'v1', name: 'run_command', args: { cmd: 'pnpm nope' } }],
    },
    {
      text: 'Proposing the edit.',
      toolRequests: [
        {
          id: 'p1',
          name: 'propose_files',
          args: {
            title: 'Fix the three routes',
            files: [{ path: ROUND_READS[0]!.path, content: '// patched\n' }],
          },
        },
      ],
    },
    { text: 'Done.' },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: Array<{ type: string }> = [];
  await runAskPipeline(input, (e) => events.push(e));

  // The prompt the model authors the proposal from (call 3, after rounds 1-2).
  const proposePrompt = calls[2]!;
  for (const { path: p, marker } of ROUND_READS) {
    assert.ok(
      proposePrompt.includes(marker),
      `the proposal round cannot see ${p} — it would have to spend its last ` +
        `round re-reading and the proposal would land past the cap`,
    );
  }
  assert.ok(
    proposePrompt.includes('run_command'),
    'the proposal round must also still see the verify result it is reacting to',
  );

  // And the turn actually produced a staged proposal rather than dying at the cap.
  assert.ok(
    events.some((e) => e.type === 'edit:proposal'),
    'the three-round fix cycle must end in a staged proposal',
  );
});
