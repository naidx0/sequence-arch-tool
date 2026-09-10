import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import {
  MAX_ASK_TOOL_ROUNDS,
  UNPRODUCTIVE_ROUND_LIMIT,
} from '../server/askTools.js';
import {
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';

/**
 * A HARD QUESTION MUST BE ABLE TO FINISH.
 *
 * The register row: "a hard question ends with the loop admitting it spent all
 * three rounds still looking", gated as "a question needing 5 lookups
 * completes". Three was a fixed number, and a fixed number is wrong in both
 * directions at once — it cuts off the question that genuinely needs a sixth
 * lookup, and it pays for three full provider rounds for a model that is
 * re-reading the same file and learning nothing.
 *
 * SO THE BUDGET IS SPENT ON PROGRESS, NOT ON A COUNT. The loop keeps going
 * while rounds bring back evidence it has not seen, and stops when they stop
 * doing that. The ceiling remains, because "keep going while it is learning" is
 * still unbounded if the model can always produce one novel byte — but the
 * ceiling is now the backstop rather than the everyday limit.
 *
 * The invariant under test is therefore NOT "the loop runs N times". It is:
 *   · a run that keeps finding new things is allowed to continue past 3
 *   · a run that stops finding new things stops, without reaching the ceiling
 *   · the ceiling still holds when every round is genuinely novel
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');

/** A repo with enough distinct files that five DIFFERENT lookups are possible. */
function manyFileRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-rounds-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'rounds', version: '1.0.0' }),
  );
  for (let i = 1; i <= 8; i += 1) {
    fs.writeFileSync(
      path.join(repo, 'src', `mod${i}.ts`),
      `export const VALUE_${i} = ${i};\nexport function step${i}() { return VALUE_${i}; }\n`,
    );
  }
  return repo;
}

/** Canned provider replies, in order; the last repeats if the loop wants more. */
function providerScript(replies: { text: string; toolRequests?: unknown[] }[]) {
  let calls = 0;
  const callProvider = async (
    _cfg: unknown,
    _prompt: string,
    _onDelta?: (t: string) => void,
  ) => {
    const reply = replies[Math.min(calls, replies.length - 1)]!;
    calls += 1;
    return { text: reply.text, toolRequests: reply.toolRequests ?? [] } as never;
  };
  return { callProvider, calls: () => calls };
}

async function attachedInput(
  repo: string,
  callProvider: unknown,
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
  } as unknown as AskPipelineInput;
}

function toolStarts(events: AskStreamEvent[]): number {
  return events.filter((e) => e.type === 'tool:start').length;
}

/* ═══ the row's own gate ══════════════════════════════════════════════════ */

test('a question needing five DIFFERENT lookups completes instead of running out', async () => {
  const repo = manyFileRepo();
  try {
    /* Five rounds, each reading a file the loop has not seen, then an answer.
       Under a fixed cap of three this ended at round three with the "I spent
       all my rounds" apology and no answer. */
    const script = providerScript([
      { text: 'looking', toolRequests: [{ id: 'a', name: 'read_file', args: { path: 'src/mod1.ts' } }] },
      { text: 'looking', toolRequests: [{ id: 'b', name: 'read_file', args: { path: 'src/mod2.ts' } }] },
      { text: 'looking', toolRequests: [{ id: 'c', name: 'read_file', args: { path: 'src/mod3.ts' } }] },
      { text: 'looking', toolRequests: [{ id: 'd', name: 'read_file', args: { path: 'src/mod4.ts' } }] },
      { text: 'looking', toolRequests: [{ id: 'e', name: 'read_file', args: { path: 'src/mod5.ts' } }] },
      { text: 'Here is the answer, having read five files.' },
    ]);
    const input = await attachedInput(repo, script.callProvider);
    const events: AskStreamEvent[] = [];
    const result = await runAskPipeline(input, (e) => events.push(e));

    assert.strictEqual(toolStarts(events), 5, 'all five distinct lookups ran');
    assert.strictEqual(result.text, 'Here is the answer, having read five files.');
    /* The apology must NOT appear. It is the exact string the register quotes,
       and a turn that answered has nothing to apologise for. */
    assert.ok(
      !/spent all .* tool rounds/i.test(result.text),
      'a completed answer must not carry the out-of-rounds apology',
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

/* ═══ the other half: it must stop when it stops learning ═════════════════ */

test('re-reading the same file stops the loop early — the budget is progress, not a count', async () => {
  const repo = manyFileRepo();
  try {
    /* Every round asks for the identical file. The first is real work; the
       rest bring back bytes already in the ledger. */
    const same = (id: string) => ({
      text: 'again',
      toolRequests: [{ id, name: 'read_file', args: { path: 'src/mod1.ts' } }],
    });
    const script = providerScript([
      same('r1'),
      same('r2'),
      same('r3'),
      same('r4'),
      same('r5'),
      same('r6'),
      same('r7'),
      same('r8'),
      same('r9'),
    ]);
    const input = await attachedInput(repo, script.callProvider);
    const events: AskStreamEvent[] = [];
    await runAskPipeline(input, (e) => events.push(e));

    /*
     * One productive round, then `UNPRODUCTIVE_ROUND_LIMIT` that were not.
     * Asserting the arithmetic rather than a literal keeps this test correct
     * when the limit is retuned, which is the point of naming it.
     */
    assert.strictEqual(
      toolStarts(events),
      1 + UNPRODUCTIVE_ROUND_LIMIT,
      'the loop stops once rounds stop bringing anything back',
    );
    assert.ok(
      toolStarts(events) < MAX_ASK_TOOL_ROUNDS,
      'and it stops well short of the ceiling — the ceiling is a backstop, not the limit',
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('the ceiling still holds when every round is genuinely novel', async () => {
  const repo = manyFileRepo();
  try {
    /* Eight distinct files, all novel, and the model never stops asking. Only
       the ceiling can end this — which is what a ceiling is for. */
    const script = providerScript(
      Array.from({ length: 20 }, (_unused, i) => ({
        text: 'still looking',
        toolRequests: [
          { id: `n${i}`, name: 'read_file', args: { path: `src/mod${(i % 8) + 1}.ts` } },
        ],
      })),
    );
    const input = await attachedInput(repo, script.callProvider);
    const events: AskStreamEvent[] = [];
    const result = await runAskPipeline(input, (e) => events.push(e));

    assert.strictEqual(toolStarts(events), MAX_ASK_TOOL_ROUNDS, 'the ceiling bounds the run');
    /*
     * And it SAYS so. A turn that stopped because it ran out of budget and one
     * that stopped because the model was finished are different events, and the
     * user can only act on the difference if we name which happened.
     */
    assert.ok(
      /still looking|ran out|tool rounds/i.test(result.text),
      `an out-of-budget ending must say so; got: ${result.text.slice(0, 120)}`,
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a repeated FAILURE is not mistaken for new evidence', async () => {
  const repo = manyFileRepo();
  try {
    /*
     * The subtle one. A failed tool is fed back as `### tool <id> (<name>): …`,
     * and the id changes every round — so a signature taken over the whole body
     * would call the same refusal "new" forever and the loop would run to the
     * ceiling collecting nothing. The signature has to be id-independent.
     */
    const script = providerScript(
      Array.from({ length: 12 }, (_unused, i) => ({
        text: 'trying',
        toolRequests: [
          { id: `f${i}`, name: 'read_file', args: { path: 'src/does-not-exist.ts' } },
        ],
      })),
    );
    const input = await attachedInput(repo, script.callProvider);
    const events: AskStreamEvent[] = [];
    await runAskPipeline(input, (e) => events.push(e));

    assert.strictEqual(
      toolStarts(events),
      1 + UNPRODUCTIVE_ROUND_LIMIT,
      'the same refusal, re-requested, is not progress',
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

void FIXTURES;
