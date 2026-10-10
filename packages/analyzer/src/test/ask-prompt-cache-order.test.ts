import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildAskPrompt, buildDigest, renderAskHistorySection } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import { writeAgentMaps } from '../agentMap.js';
import { agentMapSection } from '../server/askAgentMap.js';
import { runAskPipeline, type AskPipelineInput } from '../server/askPipeline.js';

/**
 * Harness study 2026-10-09 (tokens/report.md items 2 and 13): a local runtime
 * reuses its KV cache only for the longest common prefix of consecutive turns,
 * and the ask prompt put turn-specific text early. Locks: the map header no
 * longer carries the scan time; with SEQUENCE_ASK_PROMPT_ORDER=cache the
 * turn-stable head and the tool belt come first, every line is still present,
 * and two turns share their prompt up to the end of the belt. Default: legacy.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');

function repoWithMap(): { root: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cache-order-'));
  fs.cpSync(SHOPFRONT, dir, { recursive: true, filter: (p) => !/[\\/]\.sequence([\\/]|$)/.test(p) });
  return { root: fs.realpathSync(dir) };
}

test('the map section in the prompt carries no scan time (it changed on every rescan)', async () => {
  const { root } = repoWithMap();
  writeAgentMaps(root, await scanRepo(root, { cluster: true }));
  const onDisk = fs.readFileSync(path.join(root, '.sequence', 'map.md'), 'utf8');
  assert.match(onDisk.split('\n')[0]!, / · scanned \S+ · /, 'control: map.md itself keeps it');
  const lines = agentMapSection(root)!.lines;
  assert.match(lines[1]!, /^# map \S+ · budget /);
  assert.doesNotMatch(lines.join('\n'), /scanned \d{4}-/);
});

test('buildAskPrompt cache order: same lines as the legacy order, stable head first, head reported', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);
  const history = renderAskHistorySection(
    [
      { role: 'user', text: 'What does the gateway expose?' },
      { role: 'assistant', text: 'It proxies /orders.' },
    ],
    20,
    { droppedTurns: 0 },
  );
  const base = {
    instructionLines: ['--- PROJECT INSTRUCTIONS ---', 'Use tabs.'],
    agentMapLines: ['--- ARCHITECTURE MAP ---', '# map shopfront · budget 4000'],
    historyLines: history,
    fileResearchLines: ['--- FILE RESEARCH ---', 'x'],
  };
  const q1 = 'How does the gateway route orders?';
  const legacy = buildAskPrompt(digest, q1, base);
  let head = -1;
  const cache = buildAskPrompt(digest, q1, { ...base, cacheFriendlyOrder: true, onCacheHeadChars: (n) => (head = n) });
  const lines = (p: string) => p.split('\n').filter((l) => l !== '').sort();
  assert.deepStrictEqual(lines(cache), lines(legacy), 'nothing added or dropped, only moved (blank separators aside)');
  assert.ok(head > 0);
  const headText = cache.slice(0, head);
  assert.ok(headText.includes('Use tabs.') && headText.includes('# map shopfront'));
  assert.ok(!headText.includes('PRIOR CHAT') && !headText.includes(q1));
  assert.ok(cache.indexOf('PRIOR CHAT') < cache.indexOf('--- QUESTION ---'));
  /* A different question and a longer history keep the same head. */
  let head2 = -1;
  const other = buildAskPrompt(digest, 'Where is the payment retried? Draw it on the whiteboard.', {
    ...base,
    historyLines: [...history, 'User: more'],
    cacheFriendlyOrder: true,
    onCacheHeadChars: (n) => (head2 = n),
  });
  assert.strictEqual(other.slice(0, head2), headText);
});

async function turnPrompt(root: string, question: string, historyLines: string[]): Promise<string> {
  const graph = await scanRepo(root, { cluster: true });
  let first = '';
  const input: AskPipelineInput = {
    question,
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest: buildDigest(graph),
    historyLines,
    agentMapLines: agentMapSection(root)?.lines ?? [],
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    maxRounds: 1,
    callProvider: async (_c, prompt) => {
      if (!first) first = prompt;
      return { text: 'ok' };
    },
  };
  await runAskPipeline(input, () => {});
  return first;
}

test('pipeline: legacy by default; SEQUENCE_ASK_PROMPT_ORDER=cache puts the belt before the question and two turns share it', async () => {
  const { root } = repoWithMap();
  writeAgentMaps(root, await scanRepo(root, { cluster: true }));
  const prev = process.env.SEQUENCE_ASK_PROMPT_ORDER;
  try {
    delete process.env.SEQUENCE_ASK_PROMPT_ORDER;
    const legacy = await turnPrompt(root, 'How does the gateway route orders in code?', []);
    assert.ok(legacy.indexOf('--- TOOLS (attached repo) ---') > legacy.indexOf('--- QUESTION ---'), 'default: the shipped order');

    process.env.SEQUENCE_ASK_PROMPT_ORDER = 'cache';
    const t1 = await turnPrompt(root, 'How does the gateway route orders in code?', []);
    const t2 = await turnPrompt(root, 'Where is the payment retried?', ['--- PRIOR CHAT (same workspace; continue coherently) ---', 'User: x', 'Assistant: y']);
    const belt = t1.indexOf('--- TOOLS (attached repo) ---');
    assert.ok(belt > 0 && belt < t1.indexOf('--- QUESTION ---'));
    assert.ok(t1.indexOf('--- ARCHITECTURE MAP') < belt, 'map in the head');
    let n = 0;
    while (n < t1.length && t1[n] === t2[n]) n++;
    assert.ok(n > belt, `shared prefix ${n} chars reaches into the belt at ${belt}`);
    assert.ok(n / t2.length > 0.4, `shared prefix ${(n / t2.length).toFixed(2)} of the prompt`);
  } finally {
    if (prev === undefined) delete process.env.SEQUENCE_ASK_PROMPT_ORDER;
    else process.env.SEQUENCE_ASK_PROMPT_ORDER = prev;
  }
});
