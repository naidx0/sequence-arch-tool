import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';
import {
  parseAskSurface,
  isDeicticSurfaceQuestion,
  renderAskSurfaceSection,
  answerSurfaceQuestion,
} from '../explain/askSurface.js';

/**
 * SURFACE CONTEXT — the locking suite for the owner's E2/G5 report.
 *
 * Owner, verbatim: *"I sent that workbook flow thing, and it looks confusing
 * itself."* He was on the **Agents** surface with one of Sequence's own agent
 * workflows on screen and asked about "this workflow". The assistant searched
 * the scanned REPOSITORY and replied that the digest holds "no workflow
 * definitions (no CI/CD pipeline, no BPMN…)".
 *
 * Every test below is built from THAT shape: a Program on the Agents surface,
 * plus a pointing question. They fail against the pre-fix server, which had no
 * `surface` field at all.
 *
 * Also locked here, because this is the change that could break them:
 *   · a request with NO surface field produces a byte-identical prompt;
 *   · no `tools` array is ever put on the provider wire.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-SURFACE-SECRET-11';

/** The workflow the owner had on screen, in the shape the composer sends it. */
const OWNER_WORKFLOW = {
  id: 'agents',
  title: 'Agents',
  focus: {
    kind: 'workflow' as const,
    title: 'Repo review loop',
    nodeCount: 5,
    edgeCount: 5,
    steps: [
      { title: 'Start', kind: 'start' },
      { title: 'Read the changed files', kind: 'agent' },
      { title: 'Run the checker', kind: 'checker' },
      { title: 'Good enough?', kind: 'branch' },
      { title: 'Done', kind: 'end' },
    ],
  },
};

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-surface-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

async function startServer(repoRoot: string | null, userConfigDir?: string) {
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putAiConfig(base: string, baseUrl: string): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'test-model', apiKey: TEST_KEY }),
  });
}

function promptOf(body: unknown): string {
  const o = body as { messages?: { content?: unknown }[] };
  const c = o?.messages?.[0]?.content;
  if (typeof c === 'string') return c;
  /* Prompt caching (Wave 8): the anthropic wire may carry the prompt as text
     blocks split at the cache breakpoint. The PROMPT is their concatenation —
     that is the caching contract itself. */
  if (Array.isArray(c)) {
    return c.map((b) => (b as { text?: string }).text ?? '').join('');
  }
  return JSON.stringify(body);
}

/* ========================================================= wire validation == */

test('parseAskSurface: absent ⇒ nothing (the legacy request shape stays legal)', () => {
  assert.deepStrictEqual(parseAskSurface(undefined), {});
  assert.deepStrictEqual(parseAskSurface(null), {});
});

test('parseAskSurface: a PRESENT but malformed field errors, never silently dropped', () => {
  assert.ok('error' in parseAskSurface('agents'));
  assert.ok('error' in parseAskSurface([]));
  assert.ok('error' in parseAskSurface({}));
  assert.ok('error' in parseAskSurface({ id: 'the-moon' }));
  assert.ok('error' in parseAskSurface({ id: 'agents', focus: 'a workflow' }));
  assert.ok('error' in parseAskSurface({ id: 'agents', focus: { kind: 'spaceship', title: 'x' } }));
});

test('parseAskSurface: a focus with no name is dropped rather than given a placeholder', () => {
  const parsed = parseAskSurface({ id: 'agents', focus: { kind: 'workflow', title: '   ' } });
  assert.ok('surface' in parsed);
  assert.strictEqual(parsed.surface?.focus, undefined);
});

test('parseAskSurface: the client is not a trust boundary for prompt size', () => {
  const parsed = parseAskSurface({
    id: 'agents',
    focus: {
      kind: 'workflow',
      title: 'x'.repeat(500),
      nodeCount: 900,
      steps: new Array(200).fill({ title: 'step', kind: 'agent' }),
    },
  });
  assert.ok('surface' in parsed);
  assert.ok((parsed.surface?.focus?.title.length ?? 0) <= 160);
  assert.ok((parsed.surface?.focus?.steps?.length ?? 0) <= 40);
});

/* ================================================================ deixis === */

test('isDeicticSurfaceQuestion: points at the screen, not at every sentence with "this"', () => {
  for (const q of [
    'what is this workflow',
    'What is this workflow?',
    'explain this board',
    'what am I looking at',
    'whats on my screen', // no apostrophe
    'explain this',
  ]) {
    assert.ok(isDeicticSurfaceQuestion(q), `deictic: ${q}`);
  }
  for (const q of [
    'does this repo use redis?',
    'is this service fragile',
    'how do I add a workflow file to CI',
    'what breaks if the database goes down?',
  ]) {
    assert.ok(!isDeicticSurfaceQuestion(q), `NOT deictic: ${q}`);
  }
});

/* ======================================= the deterministic surface answer === */

test('answerSurfaceQuestion: the owner shape is answered from the Program, no model needed', () => {
  const parsed = parseAskSurface(OWNER_WORKFLOW);
  assert.ok('surface' in parsed);
  const answer = answerSurfaceQuestion(parsed.surface, 'what is this workflow?');
  assert.ok(answer, 'a pointing question about the workflow on screen is answered');
  // It is about SEQUENCE'S OWN workflow…
  assert.ok(answer!.includes('Repo review loop'));
  assert.match(answer!, /Agents/);
  // …with the real steps, in the Program's own order.
  for (const s of OWNER_WORKFLOW.focus.steps) assert.ok(answer!.includes(s.title), s.title);
  // …and it is NOT the reported failure: a repo file search.
  assert.ok(!/no workflow definitions/i.test(answer!));
  assert.ok(!/BPMN|CI\/CD pipeline/i.test(answer!));
});

test('answerSurfaceQuestion: nothing is invented when there is nothing on screen', () => {
  assert.strictEqual(answerSurfaceQuestion(undefined, 'what is this workflow?'), undefined);
  // A repo question on the Agents surface still goes the normal way.
  const parsed = parseAskSurface(OWNER_WORKFLOW);
  assert.ok('surface' in parsed);
  assert.strictEqual(answerSurfaceQuestion(parsed.surface, 'does the repo use postgres?'), undefined);
  // The Agents surface with no workflow loaded describes no workflow.
  const bare = parseAskSurface({ id: 'agents' });
  assert.ok('surface' in bare);
  assert.strictEqual(answerSurfaceQuestion(bare.surface, 'what is this workflow?'), undefined);
});

test('renderAskSurfaceSection: [] with no surface, and it never claims a focus that is not there', () => {
  assert.deepStrictEqual(renderAskSurfaceSection(undefined, true), []);
  const bare = parseAskSurface({ id: 'terminal' });
  assert.ok('surface' in bare);
  const lines = renderAskSurfaceSection(bare.surface, false).join('\n');
  assert.match(lines, /--- WHAT THE USER IS LOOKING AT ---/);
  assert.match(lines, /Terminal/);
  assert.match(lines, /not shipped in web2 yet/i);
  assert.ok(!/workflow|selected|open on it/i.test(lines), lines);
});

test('renderAskSurfaceSection: Whiteboard surface copy never says Task Board', () => {
  /* Wire id remains task-board; user-facing / model-facing copy must name Whiteboard only. */
  const parsed = parseAskSurface({ id: 'task-board' });
  assert.ok('surface' in parsed);
  const text = renderAskSurfaceSection(parsed.surface, false).join('\n');
  assert.match(text, /Whiteboard/i);
  assert.doesNotMatch(text, /Task Board/i);
});

/* ============================================================ over the wire */

test('/api/ask: "what is this workflow" on the Agents surface answers about the SURFACE, not the repo', async () => {
  const repo = plainappRepo();
  let providerCalls = 0;
  const mock = await startMockProvider(() => {
    providerCalls += 1;
    return { text: 'The digest contains no workflow definitions (no CI/CD pipeline, no BPMN).' };
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'what is this workflow?', surface: OWNER_WORKFLOW }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { text: string; source?: string };
    // The reported failure, asserted verbatim against the answer the user reads.
    assert.ok(!/no workflow definitions/i.test(body.text), body.text);
    assert.ok(body.text.includes('Repo review loop'));
    assert.ok(body.text.includes('Run the checker'));
    // Deterministic: read off the Program, so the provider is never called — it
    // works with no key and no network, and cannot drift from the canvas.
    assert.strictEqual(body.source, 'surface');
    assert.strictEqual(providerCalls, 0);
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: a NON-pointing question on the Agents surface still goes to the model, with the surface stated', async () => {
  const repo = plainappRepo();
  let prompt = '';
  const mock = await startMockProvider((b) => {
    prompt = promptOf(b);
    return { text: 'ok' };
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'which service writes to the datastore?',
        surface: OWNER_WORKFLOW,
      }),
    });
    assert.strictEqual(res.status, 200);
    assert.match(prompt, /--- WHAT THE USER IS LOOKING AT ---/);
    assert.ok(prompt.includes('Repo review loop'));
    // The surface is STATED, never folded into the user's own words.
    const question = prompt.slice(prompt.indexOf('--- QUESTION ---'));
    assert.ok(!question.includes('Repo review loop'), 'the surface never lands inside the question');
    /*
     * NATIVE TOOLS, IN THIS WIRE'S SHAPE.
     *
     * This used to assert `tools` was ABSENT and called that "the locked
     * contract". It was locking a defect, not a contract: this fixture is an
     * ANTHROPIC config, and provider.ts attached tool definitions only when the
     * wire was openai-compatible — so a claude-sonnet user ran the whole agent
     * loop on regex fence salvage while a local granite4 got native calls.
     * repoServer builds the definitions for BOTH here (attached repo, not design
     * mode) and they are now sent on both. Asserted in the Messages-wire shape,
     * so the openai envelope can never leak onto it.
     */
    for (const req of mock.requests) {
      const body = req.body as { tools?: unknown };
      assert.ok(Array.isArray(body.tools) && body.tools.length > 0, 'the anthropic wire carries the tools');
      for (const t of body.tools as Record<string, unknown>[]) {
        assert.equal(typeof t.name, 'string');
        assert.ok(t.input_schema && typeof t.input_schema === 'object');
        assert.equal('function' in t, false, 'the openai envelope must not leak onto this wire');
      }
    }
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: a chip-attached turn is never short-circuited by the surface answer', async () => {
  const repo = plainappRepo();
  let providerCalls = 0;
  const mock = await startMockProvider(() => {
    providerCalls += 1;
    return { text: 'ok' };
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'add a step to this workflow',
        surface: OWNER_WORKFLOW,
        intents: [{ id: 'workflow-add-step', subject: 'Repo review loop' }],
      }),
    });
    assert.strictEqual(res.status, 200);
    // The user asked for a capability; answering with a step list instead would
    // be ignoring what they clicked. The claim is "the provider ran" — the
    // edit contract may spend a corrective round on a prose-only reply, so an
    // exact count here would pin the contract, not the short-circuit.
    assert.ok(providerCalls >= 1, `provider ran (${providerCalls} calls)`);
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: a request with NO surface field builds the byte-identical prompt', async () => {
  const repo = plainappRepo();
  const prompts: string[] = [];
  const mock = await startMockProvider((b) => {
    prompts.push(promptOf(b));
    return { text: 'ok' };
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const post = (body: unknown) =>
      fetch(`${base}/api/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    assert.strictEqual((await post({ question: 'what is fragile here?' })).status, 200);
    assert.strictEqual(
      (await post({ question: 'what is fragile here?', surface: null })).status,
      200,
    );
    assert.strictEqual(prompts.length, 2);
    assert.strictEqual(prompts[0], prompts[1]);
    assert.ok(!prompts[0].includes('--- WHAT THE USER IS LOOKING AT ---'));
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: a malformed surface field 400s instead of quietly guessing the noun again', async () => {
  const repo = plainappRepo();
  const mock = await startMockProvider(() => ({ text: 'ok' }));
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'what is this workflow?', surface: { id: 'the-moon' } }),
    });
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /surface\.id/);
  } finally {
    await close();
    await mock.close();
  }
});
