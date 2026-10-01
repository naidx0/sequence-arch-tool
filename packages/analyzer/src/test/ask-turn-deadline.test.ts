import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import {
  ASK_TURN_DEADLINE_MS,
  MAX_ASK_TOOL_ROUNDS,
  resolveTurnDeadlineMs,
} from '../server/askTools.js';
import {
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';

/**
 * A TURN THAT NEVER ENDS IS WORSE THAN A TURN THAT CRASHES.
 *
 * The round budget bounds COST and nobody experiences rounds. `timeoutMs`
 * bounds ONE provider call; a turn is rounds x calls and nothing bounded the
 * product, so eight rounds each passing the per-call timeout is a turn with no
 * upper bound in the only unit the person waiting can feel. Practical ML's
 * teach walk hit exactly that: turn 4 still running when its own 900s clock
 * killed it, board already drawn, check-in never reached.
 *
 * The gate below is a PAIR, because a single "it stopped early" assertion is
 * not a gate -- a loop that always stops early passes it. The same provider
 * script is run twice against the same repository and differs only in the
 * budget: with a deadline it stops on time, and with the deadline switched off
 * it runs on to the round ceiling. One of those failing means the deadline did
 * nothing; both passing means the deadline, and only the deadline, ended it.
 */

/** Enough distinct files that every round can be genuinely novel. */
function manyFileRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-deadline-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'deadline', version: '1.0.0' }),
  );
  for (let i = 1; i <= 10; i += 1) {
    fs.writeFileSync(
      path.join(repo, 'src', `mod${i}.ts`),
      `export const VALUE_${i} = ${i};\nexport function step${i}() { return VALUE_${i}; }\n`,
    );
  }
  return repo;
}

/**
 * Every round asks for a DIFFERENT file, so the no-progress rule can never be
 * what ends the loop. Only the ceiling or the clock can, which is what lets the
 * pair below attribute the ending.
 */
function alwaysNovelProvider() {
  let calls = 0;
  const callProvider = async () => {
    calls += 1;
    return {
      /* TOOL-ONLY rounds, no prose. That is the B2.1 case the harness's own
         voice exists for: when the model never writes anything for the user,
         the harness must say what happened rather than fall silent. It is also
         what makes the pair below observable -- with prose present the turn
         correctly keeps the model's words and neither ending has a voice. */
      text: '',
      toolRequests: [
        { id: `r${calls}`, name: 'read_file', args: { path: `src/mod${calls}.ts` } },
      ],
    } as never;
  };
  return { callProvider, calls: () => calls };
}

async function inputFor(
  repo: string,
  callProvider: unknown,
  turnDeadlineMs: number | undefined,
): Promise<AskPipelineInput> {
  const graph = await scanRepo(repo, {});
  return {
    question: 'What does this do?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'research',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (p: string) => path.resolve(repo, p),
    repoRoot: repo,
    callProvider,
    ...(turnDeadlineMs === undefined ? {} : { turnDeadlineMs }),
  } as unknown as AskPipelineInput;
}

const toolStarts = (events: AskStreamEvent[]): number =>
  events.filter((e) => e.type === 'tool:start').length;

test('a turn past its wall-clock budget stops, and says it was the clock', async () => {
  const repo = manyFileRepo();
  try {
    const script = alwaysNovelProvider();
    /* 1ms: the first provider call alone outlives it, so the check at the top
       of the next round is already past the deadline. Deterministic -- no sleep,
       no race -- because the assertion is "it did not reach the ceiling", not
       "it stopped at round N". */
    const input = await inputFor(repo, script.callProvider, 1);
    const events: AskStreamEvent[] = [];
    const result = await runAskPipeline(input, (e) => events.push(e));

    assert.strictEqual(
      result.metrics?.stopReason,
      'deadline',
      'the clock ended it, and the metric must name the clock rather than the round budget',
    );
    assert.ok(
      toolStarts(events) < MAX_ASK_TOOL_ROUNDS,
      `stopped before the ceiling, got ${toolStarts(events)} tool rounds`,
    );
    /* The harness speaks in TIME to someone who watched a clock. Saying "I used
       all my tool rounds" there would be the harness describing its own
       bookkeeping instead of what the person experienced. */
    assert.match(result.text, /time budget/i);
    assert.ok(
      !/all \d+ of my tool rounds/i.test(result.text),
      'a turn ended by the clock must not blame the round budget',
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('the SAME script with no deadline runs on to the round ceiling', async () => {
  const repo = manyFileRepo();
  try {
    const script = alwaysNovelProvider();
    /* 0 means "no deadline" -- the switch-off case, and the contrast that makes
       the test above a gate rather than a tautology. */
    const input = await inputFor(repo, script.callProvider, 0);
    const events: AskStreamEvent[] = [];
    const result = await runAskPipeline(input, (e) => events.push(e));

    assert.strictEqual(
      result.metrics?.stopReason,
      'ceiling',
      'with the clock off, the round budget is what ends it',
    );
    /* The other half of the voice: the same script, ended by the other budget,
       must name THAT budget. If both endings produced the same sentence the
       distinction would be bookkeeping the user never sees. */
    assert.match(result.text, /all \d+ of my tool rounds/i);
    assert.ok(!/time budget/i.test(result.text), 'the ceiling is not a clock');
    assert.strictEqual(
      toolStarts(events),
      MAX_ASK_TOOL_ROUNDS,
      'every round was novel, so the loop spends the whole budget',
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

/* ═══ the resolver ════════════════════════════════════════════════════════ */

test('the deadline resolver: explicit wins, benchmark turns are exempt, 0 means off', () => {
  assert.strictEqual(resolveTurnDeadlineMs({}), ASK_TURN_DEADLINE_MS);
  assert.strictEqual(resolveTurnDeadlineMs({ turnDeadlineMs: 5_000 }), 5_000);
  /* An explicit value beats the auto-writes exemption in BOTH directions: a
     caller that states a budget has made a decision, and this removes an
     automatic bound rather than overriding a stated one. */
  assert.strictEqual(resolveTurnDeadlineMs({ turnDeadlineMs: 5_000, autoWrites: true }), 5_000);
  assert.strictEqual(resolveTurnDeadlineMs({ autoWrites: true }), undefined);
  assert.strictEqual(resolveTurnDeadlineMs({ turnDeadlineMs: 0 }), undefined);
  assert.strictEqual(resolveTurnDeadlineMs({ turnDeadlineMs: -1 }), undefined);
  /* NaN is not a budget; it must fall through to the default rather than
     compare false forever and silently disable the bound. */
  assert.strictEqual(resolveTurnDeadlineMs({ turnDeadlineMs: Number.NaN }), ASK_TURN_DEADLINE_MS);
});
