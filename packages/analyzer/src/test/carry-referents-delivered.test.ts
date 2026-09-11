/*
 * DOES THE CARRIED REFERENT LIST ACTUALLY REACH THE PROMPT?
 *
 * Mechanism B's four arms refuted clause 1 — neither treatment run named one of
 * the three callers reachable only through the fourth slot. A refutation is
 * only worth as much as the mechanism it refutes: if the block never reached
 * turn 2's prompt, the arms measured nothing and the refutation is an artefact,
 * exactly as three earlier voids in this stage would have been.
 *
 * The arms could not settle it. `carryOut` is stripped from the payload as an
 * internal field, the context breakdown does not name the carry as a section,
 * and adding a client-visible copy of the prompt to make a measurement easier
 * is the instrument writing its own result.
 *
 * The pipeline takes `callProvider`, so a stub can read the prompt directly.
 * That is what this does. No model, no card, and it answers the question the
 * arms could not.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import { scanRepo } from '../scan.js';
import { runAskPipeline } from '../server/askPipeline.js';
import type { AskPipelineInput } from '../server/askPipeline.js';
import { EMPTY_CARRY, extendCarry } from '../server/turnCarry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-carry-referents-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return repo;
}

/** The carry a turn 1 that called `who_calls` would hand to turn 2. */
const carryWithReferents = () =>
  extendCarry(EMPTY_CARRY, 1, {
    referents: {
      tool: 'who_calls',
      subject: 'src/scan.ts',
      items: ['src/alpha.ts', 'src/beta.ts', 'src/gamma.ts'],
      total: 84,
    },
  });

async function promptFor(carry: ReturnType<typeof carryWithReferents> | undefined): Promise<string> {
  const repo = shopfrontRepo();
  try {
    const root = fs.realpathSync(repo);
    const graph = await scanRepo(repo, { cluster: true });
    const digest = buildDigest(graph);
    const prompts: string[] = [];
    const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
      prompts.push(prompt);
      return { text: 'The first change is src/alpha.ts.', toolRequests: [] };
    };
    const input: AskPipelineInput = {
      question: 'Of those, which one would I have to change first?',
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
      ...(carry ? { carry, turnIndex: 1 } : {}),
    };
    await runAskPipeline(input);
    return prompts.join('\n');
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
}

test('WITH the flag on, the carried list reaches the prompt the model is given', async () => {
  const before = process.env.SEQUENCE_ASK_CARRY_REFERENTS;
  process.env.SEQUENCE_ASK_CARRY_REFERENTS = '1';
  try {
    const prompt = await promptFor(carryWithReferents());
    assert.match(prompt, /ALREADY IN THIS CONVERSATION/, 'the carry block is rendered');
    assert.match(prompt, /src\/alpha\.ts/, 'and the carried names are in it');
    assert.match(prompt, /3 of 84/, 'with the denominator, so eight of 84 cannot read as all of them');
    assert.match(prompt, /contents were not read/, 'and the honesty line the fabrication risk needs');
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_ASK_CARRY_REFERENTS;
    else process.env.SEQUENCE_ASK_CARRY_REFERENTS = before;
  }
});

test('with NO carry, none of it appears — so the block is the carry and not something else', async () => {
  /*
   * The control arm's condition. Without this the first case could be passing
   * on text the prompt always contains, which is the vacuity that would make
   * the whole comparison meaningless.
   */
  const prompt = await promptFor(undefined);
  assert.doesNotMatch(prompt, /ALREADY IN THIS CONVERSATION/);
  assert.doesNotMatch(prompt, /src\/alpha\.ts/);
});

test('PLACEMENT — each of the three puts the block somewhere different, and all three are real', async () => {
  /*
   * Registered in docs/research/carry-placement-registration.md. The arms are
   * worth nothing if a placement silently falls back to another one — and
   * `before-question` DOES fall back to `tail` when the prompt shape has no
   * question marker, so this proves the marker is present on the shape the arms
   * run and that each value lands where it claims.
   */
  const before = process.env.SEQUENCE_ASK_CARRY_PLACE;
  const refs = process.env.SEQUENCE_ASK_CARRY_REFERENTS;
  process.env.SEQUENCE_ASK_CARRY_REFERENTS = '1';
  try {
    const at = async (place: string): Promise<{ carry: number; q: number; tools: number }> => {
      process.env.SEQUENCE_ASK_CARRY_PLACE = place;
      const prompt = await promptFor(carryWithReferents());
      return {
        carry: prompt.indexOf('ALREADY IN THIS CONVERSATION'),
        q: prompt.indexOf('--- QUESTION ---'),
        tools: prompt.indexOf('--- TOOLS (attached repo) ---'),
      };
    };

    const tail = await at('tail');
    assert.ok(tail.q >= 0, 'the question marker must exist, or before-question silently falls back');
    assert.ok(tail.carry > tail.q, 'tail: the block sits AFTER the question — the shipped behaviour');
    assert.ok(tail.tools > tail.carry, 'tail: and BEFORE the tools section');

    const bq = await at('before-question');
    assert.ok(bq.carry >= 0 && bq.carry < bq.q, 'before-question: the list precedes the pronoun');

    const last = await at('last');
    assert.ok(last.tools >= 0 && last.carry > last.tools, 'last: nothing between the block and generation');
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_ASK_CARRY_PLACE;
    else process.env.SEQUENCE_ASK_CARRY_PLACE = before;
    if (refs === undefined) delete process.env.SEQUENCE_ASK_CARRY_REFERENTS;
    else process.env.SEQUENCE_ASK_CARRY_REFERENTS = refs;
  }
});
