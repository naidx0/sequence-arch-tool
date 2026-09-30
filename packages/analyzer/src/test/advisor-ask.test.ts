import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import { runAskPipeline, type AskPipelineInput, type AskStreamEvent } from '../server/askPipeline.js';
import type { AiConfig } from '../server/provider.js';

/**
 * MADR model-roles — advisor consult in the ask pipeline. The advisor is a
 * SECOND billed call that READS the worker's draft and returns a short JSON
 * note. It runs only when an advisor is bound to a different model+host than
 * the default; it NEVER fails the ask (a thrown callProvider is swallowed and
 * the worker text still returns).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-advisor-ask-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return repo;
}

/** A config with an advisor bound to a different model+host than the default. */
function advisorBoundCfg(): AiConfig {
  return {
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: 'sk-test',
    roles: {
      advisor: {
        model: 'gpt-advisor',
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-advisor',
      },
    },
  };
}

async function makeAttachedInput(
  repo: string,
  callProvider: AskPipelineInput['callProvider'],
  cfg: AiConfig,
): Promise<AskPipelineInput> {
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const digest = buildDigest(graph);
  return {
    question: 'How does the gateway route orders in the source code?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest,
    cfg,
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    callProvider,
  };
}

function collect(events: AskStreamEvent[]): { types: string[]; byType: Record<string, AskStreamEvent[]> } {
  const byType: Record<string, AskStreamEvent[]> = {};
  for (const e of events) (byType[e.type] ??= []).push(e);
  return { types: events.map((e) => e.type), byType };
}

/* ============================================================ advisor consult ===== */

test('askPipeline advisor: second call returns blocker JSON; result.advisor + stream advisor event', async () => {
  const repo = shopfrontRepo();
  const calls: string[] = [];
  let i = 0;
  const scripts = [
    { text: 'The gateway proxies orders via ordersRouter.' },
    { text: '{"severity":"blocker","note":"ordersRouter is unauthenticated — do not ship"}' },
  ];
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    calls.push(prompt);
    const canned = scripts[Math.min(i, scripts.length - 1)];
    i++;
    return { text: canned.text };
  };
  const input = await makeAttachedInput(repo, callProvider, advisorBoundCfg());
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { types, byType } = collect(events);

  // Two provider calls: worker, then advisor.
  assert.strictEqual(calls.length, 2, 'provider called once for worker, once for advisor');
  // The advisor prompt is the JSON-only advisor prompt (contains the marker).
  assert.ok(calls[1].includes('advisor') || calls[1].includes('severity'), 'advisor prompt built');

  assert.ok(types.includes('advisor'), 'advisor SSE event emitted');
  assert.ok(types.includes('step:start'), 'advisor step:start emitted');
  const advisorEvent = byType['advisor'][0] as { severity: string; note: string };
  assert.strictEqual(advisorEvent.severity, 'blocker');
  assert.ok(advisorEvent.note.includes('unauthenticated'));

  assert.ok(result.advisor, 'result.advisor attached');
  assert.strictEqual(result.advisor!.severity, 'blocker');
  assert.strictEqual(result.advisor!.note, 'ordersRouter is unauthenticated — do not ship');
  // Worker text still the answer.
  assert.strictEqual(result.text, 'The gateway proxies orders via ordersRouter.');
  assert.strictEqual(result.source, 'provider');
});

test('askPipeline advisor: callProvider throws → worker text still returns, no throw, no advisor event', async () => {
  const repo = shopfrontRepo();
  const calls: string[] = [];
  let i = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    calls.push(prompt);
    i++;
    if (i === 2) throw new Error('advisor endpoint down');
    return { text: 'The gateway proxies orders via ordersRouter.' };
  };
  const input = await makeAttachedInput(repo, callProvider, advisorBoundCfg());
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { types } = collect(events);

  // Worker call happened, advisor call was attempted (and threw).
  assert.strictEqual(calls.length, 2, 'advisor call attempted before throwing');
  // No advisor event emitted on failure.
  assert.ok(!types.includes('advisor'), 'no advisor event when callProvider throws');
  // Worker text is still the answer; the ask did not fail.
  assert.strictEqual(result.text, 'The gateway proxies orders via ordersRouter.');
  assert.strictEqual(result.advisor, undefined, 'no advisor note on failure');
  assert.strictEqual(result.source, 'provider');
});

test('askPipeline advisor: no advisor binding → no second call, no advisor event', async () => {
  const repo = shopfrontRepo();
  const calls: string[] = [];
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    calls.push(prompt);
    return { text: 'Direct worker answer.' };
  };
  const cfg: AiConfig = { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' };
  const input = await makeAttachedInput(repo, callProvider, cfg);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { types } = collect(events);

  assert.strictEqual(calls.length, 1, 'only the worker call when no advisor bound');
  assert.ok(!types.includes('advisor'));
  assert.strictEqual(result.advisor, undefined);
  assert.strictEqual(result.text, 'Direct worker answer.');
});
