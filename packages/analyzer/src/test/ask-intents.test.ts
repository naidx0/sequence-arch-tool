import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';
import {
  askIntentIds,
  executeAskIntents,
  parseAskIntents,
  parseAskMode,
  parseAskContextLines,
  renderAskIntentSection,
  RESEARCH_MODE_DIRECTIVE,
} from '../explain/askIntents.js';
import { buildAskPrompt, buildDesignAskPrompt, buildDigest } from '../explain/explain.js';
import { scanRepo } from '../scan.js';

/**
 * INTENTS ARE CAPABILITIES, NOT PROSE — the locking suite.
 *
 * Owner, verbatim: "Is the tool calling working? Is it included in the prompt?
 * Can the user see that we're including it in a prompt? It shouldn't be seen.
 * It should just be added as a tool, and our backend runs that way. What's going
 * on here?"
 *
 * It WAS included in the prompt: the web composer's `composeOutgoingMessage`
 * joined each attached chip's instruction paragraph with the user's typed words
 * and POSTed the merged string as `/api/ask`'s `question`. An earlier round only
 * stopped RENDERING that paragraph in the bubble.
 *
 * These tests lock the real fix from the server's side of the wire:
 *   · the invoked intent arrives as STRUCTURE (`{id, subject, subjectNodeId}`);
 *   · the instruction text is authored HERE and lands in its own labelled
 *     section — never inside `--- QUESTION ---`;
 *   · `impact` / `break-down` are answered from the REAL graph by the same
 *     engines the canvas uses, before the model is called;
 *   · an unknown id injects nothing and is reported;
 *   · a request with no new fields is byte-identical to the pre-intent build.
 *
 * The client half (that the outgoing body no longer contains the boilerplate) is
 * locked in `packages/web/src/panels/planModeChips.test.ts` and
 * `packages/web/src/ai/aiClient.test.ts`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-INTENT-SECRET-42';

/** The exact boilerplate the client used to prepend — it must never be on the wire. */
const PLAN_BOILERPLATE = 'Propose a short list of concrete tasks';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-intent-'));
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

async function putAiConfig(
  base: string,
  baseUrl: string,
  provider: 'anthropic' | 'openai-compatible' = 'anthropic',
): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, baseUrl, model: 'test-model', apiKey: TEST_KEY }),
  });
}

/** The one prompt string the provider actually received. */
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

test('parseAskIntents: absent ⇒ [] (the legacy request shape stays legal)', () => {
  assert.deepStrictEqual(parseAskIntents(undefined), { intents: [] });
  assert.deepStrictEqual(parseAskIntents(null), { intents: [] });
  assert.deepStrictEqual(parseAskIntents([]), { intents: [] });
});

test('parseAskIntents: a PRESENT but malformed field is an error, never silently dropped', () => {
  assert.ok('error' in parseAskIntents('impact'));
  assert.ok('error' in parseAskIntents([{ subject: 'backend' }]));
  assert.ok('error' in parseAskIntents([{ id: '' }]));
  assert.ok('error' in parseAskIntents([{ id: 'impact', subject: 7 }]));
  assert.ok('error' in parseAskIntents([{ id: 'impact', subjectNodeId: {} }]));
  assert.ok('error' in parseAskIntents(new Array(13).fill({ id: 'impact' })));
});

test('parseAskIntents: a duplicated id can never double an instruction', () => {
  const parsed = parseAskIntents([{ id: 'impact' }, { id: 'impact', subject: 'backend' }]);
  assert.ok('intents' in parsed);
  assert.strictEqual(parsed.intents.length, 1);
});

test('parseAskMode / parseAskContextLines: unknown values degrade to today’s behaviour', () => {
  assert.strictEqual(parseAskMode(undefined), 'implementation');
  assert.strictEqual(parseAskMode('nonsense'), 'implementation');
  assert.strictEqual(parseAskMode('research'), 'research');
  assert.deepStrictEqual(parseAskContextLines(undefined), []);
  assert.deepStrictEqual(parseAskContextLines({ lines: 'nope' }), []);
  assert.deepStrictEqual(parseAskContextLines({ lines: ['a', 7, 'b'] }), ['a', 'b']);
  // Bounded server-side: the client is not a trust boundary for prompt size.
  const huge = new Array(200).fill('x'.repeat(200));
  assert.ok(parseAskContextLines({ lines: huge }).length < huge.length);
});

/* ======================================== deterministic capability execution */

test('executeAskIntents: "What breaks" is computed from the REAL graph, not narrated by the model', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const backend = graph.nodes.find((n) => n.kind === 'service' && n.label.toLowerCase().includes('backend'));
  assert.ok(backend, 'the fixture has a backend service');
  const store = graph.nodes.find((n) => n.kind === 'datastore');
  assert.ok(store, 'the fixture has a datastore');

  const run = executeAskIntents(graph, [{ id: 'impact', subject: store.label, subjectNodeId: store.id }]);
  assert.deepStrictEqual(run.unsupported, []);
  assert.strictEqual(run.executed.length, 1);
  const [intent] = run.executed;
  assert.strictEqual(intent.execution, 'deterministic');
  const facts = intent.facts.join('\n');
  // The real chain is frontend -> backend -> datastore, so the datastore failing
  // takes the backend down with it. That comes from computeImpact, not a guess.
  assert.match(facts, /Blast radius of/);
  assert.ok(facts.includes(backend.label), `the real dependent service is named: ${facts}`);
  assert.match(facts, /computed, not estimated/);
});

test('executeAskIntents: a subject that is NOT in the scan is stated, never swapped for a lookalike', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const run = executeAskIntents(graph, [{ id: 'impact', subject: 'payments-service' }]);
  const facts = run.executed[0].facts.join('\n');
  assert.match(facts, /No component named "payments-service" is in the scan/);
  // …and it must not have quietly answered about a real component instead.
  for (const n of graph.nodes.filter((x) => x.kind === 'service')) {
    assert.ok(!facts.includes(n.label), `must not substitute "${n.label}" for a subject that does not exist`);
  }
  // An intent that computed nothing is NOT reported as deterministic.
  assert.strictEqual(run.executed[0].execution, 'model');
});

test('executeAskIntents: "Break it down" lists only REAL children of the selected node', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const svc = graph.nodes.find((n) => n.kind === 'service')!;
  const realChildren = graph.nodes.filter((n) => n.parentId === svc.id);
  const run = executeAskIntents(graph, [{ id: 'break-down', subject: svc.label, subjectNodeId: svc.id }]);
  const facts = run.executed[0].facts.join('\n');
  for (const c of realChildren) {
    assert.ok(facts.includes(c.label), `the real child "${c.label}" is listed`);
  }
  // Every named part traces to a real node — the fabrication guard.
  const named = facts.match(/^- \w+: ([^\n—]+?)(?:\s+—|$)/gm) ?? [];
  assert.ok(named.length > 0 || realChildren.length === 0);
});

test('executeAskIntents: "Plan tasks" hands the model the real file scope (deterministic INPUT, model reasoning)', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const svc = graph.nodes.find((n) => n.kind === 'service')!;
  const run = executeAskIntents(graph, [{ id: 'multi-task', subject: svc.label, subjectNodeId: svc.id }]);
  const [intent] = run.executed;
  // The decomposition is genuine reasoning — it is honestly reported as model-run.
  assert.strictEqual(intent.execution, 'model');
  const facts = intent.facts.join('\n');
  assert.match(facts, /every file a task names must be one of these/);
  const realPaths = graph.nodes
    .filter((n) => n.kind === 'file' && n.path && n.parentId === svc.id)
    .map((n) => n.path!);
  for (const p of realPaths.slice(0, 3)) assert.ok(facts.includes(p), `real path ${p} is in scope`);
});

test('executeAskIntents: an UNKNOWN id injects nothing and is reported (the fabrication guard)', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const run = executeAskIntents(graph, [{ id: 'delete-the-repo' }, { id: 'impact' }]);
  assert.deepStrictEqual(run.unsupported, ['delete-the-repo']);
  assert.strictEqual(run.executed.length, 1);
  assert.strictEqual(run.executed[0].id, 'impact');
  assert.ok(!renderAskIntentSection(run.executed).join('\n').includes('delete-the-repo'));
});

test('executeAskIntents: design mode (no graph) applies directives but fabricates NO evidence', () => {
  const run = executeAskIntents(undefined, [{ id: 'impact', subject: 'Recipes API' }]);
  assert.strictEqual(run.executed.length, 1);
  assert.deepStrictEqual(run.executed[0].facts, []);
  assert.strictEqual(run.executed[0].execution, 'model');
  assert.match(run.executed[0].directive, /Recipes API/);
});

/* ======================================================= prompt composition = */

test('buildAskPrompt: with no composition it is BYTE-IDENTICAL to the pre-intent build', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const digest = buildDigest(graph);
  const legacy = buildAskPrompt(digest, 'what is fragile?');
  assert.strictEqual(buildAskPrompt(digest, 'what is fragile?', undefined), legacy);
  assert.strictEqual(
    buildAskPrompt(digest, 'what is fragile?', { intentLines: [], scopeLines: [], researchMode: false }),
    legacy,
    'an empty composition adds not one byte',
  );
  assert.ok(legacy.includes('--- QUESTION ---'));
});

test('buildAskPrompt: the intent instruction lives OUTSIDE the question section', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const digest = buildDigest(graph);
  const run = executeAskIntents(graph, [{ id: 'multi-task' }]);
  const prompt = buildAskPrompt(digest, 'add rate limiting to the API', {
    intentLines: renderAskIntentSection(run.executed),
  });
  const qAt = prompt.indexOf('--- QUESTION ---');
  const boilerplateAt = prompt.indexOf(PLAN_BOILERPLATE);
  assert.ok(boilerplateAt >= 0, 'the server DOES instruct the model');
  assert.ok(boilerplateAt < qAt, 'and it does so before/outside the question section');
  // The user's message is EXACTLY the user's message.
  assert.strictEqual(prompt.slice(qAt + '--- QUESTION ---\n'.length).trim(), 'add rate limiting to the API');
  assert.match(prompt, /instructions from the SYSTEM/);
});

test('buildAskPrompt: research mode is a server directive, not a prefix on the user text', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const digest = buildDigest(graph);
  const prompt = buildAskPrompt(digest, 'how would I split this?', { researchMode: true });
  assert.ok(prompt.includes(RESEARCH_MODE_DIRECTIVE));
  const qAt = prompt.indexOf('--- QUESTION ---');
  assert.ok(prompt.indexOf(RESEARCH_MODE_DIRECTIVE) < qAt);
  assert.strictEqual(prompt.slice(qAt + '--- QUESTION ---\n'.length).trim(), 'how would I split this?');
  // The old client-side prefix must never reappear inside the user's words.
  assert.ok(!prompt.includes('[Research mode'));
});

test('buildAskPrompt: a chip-only turn has no empty QUESTION heading', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const digest = buildDigest(graph);
  const run = executeAskIntents(graph, [{ id: 'multi-task' }]);
  const prompt = buildAskPrompt(digest, '', { intentLines: renderAskIntentSection(run.executed) });
  assert.ok(!prompt.includes('--- QUESTION ---'));
  assert.ok(prompt.includes(PLAN_BOILERPLATE));
});

test('buildDesignAskPrompt: composes the same way and still forbids file:line claims', () => {
  const design = { title: 'Recipe Box', outline: 'Recipe Box\n  Backend\n    Recipes API' };
  const legacy = buildDesignAskPrompt(design, 'what is missing?');
  assert.strictEqual(buildDesignAskPrompt(design, 'what is missing?', {}), legacy);
  const run = executeAskIntents(undefined, [{ id: 'break-down', subject: 'Recipes API' }]);
  const composed = buildDesignAskPrompt(design, 'what is missing?', {
    intentLines: renderAskIntentSection(run.executed),
    researchMode: true,
  });
  assert.ok(composed.includes(RESEARCH_MODE_DIRECTIVE));
  assert.match(composed, /do not invent file paths/);
  assert.doesNotMatch(composed, /NEVER cite a file path/);
  assert.match(composed, /Never tell the user you cannot read files/);
  assert.ok(composed.indexOf('--- REQUESTED ACTIONS ---') < composed.indexOf('--- DESIGN:'));
});

test('buildDesignAskPrompt: proposeArchitecture break-down requires four roles + labeled loop', () => {
  const design = {
    title: 'Design from chat',
    outline:
      '- break down hermes agent\nProposed architecture roles:\n- Interface\n- Model\n- Memory\n- Tools',
    proposeArchitecture: true,
  };
  const prompt = buildDesignAskPrompt(
    design,
    'break down hermes agent and tell me how it works with models memory',
  );
  assert.match(prompt, /Do NOT refuse with/);
  assert.match(prompt, /PROPOSE a typical architecture/);
  assert.match(prompt, /never default every ask to Interface\/Model\/Memory\/Tools/);
  assert.match(prompt, /labeled control/);
  assert.match(prompt, /Match modules to the domain/);
  assert.ok(!prompt.includes('Answer the question using ONLY that outline'));
  assert.match(prompt, /do not invent file paths/);
  assert.doesNotMatch(prompt, /NEVER cite a file path/);
  assert.match(prompt, /Never tell the user you cannot read files/);
});

/* ================================================================ over HTTP = */

test('/api/ask: the user message on the wire carries NO boilerplate; the server composes it', async () => {
  const repo = plainappRepo();
  let prompt = '';
  const mock = await startMockProvider((body) => {
    prompt = promptOf(body);
    return { text: 'Three tasks, each in one sitting.' };
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const outgoing = {
      question: 'add rate limiting to the API',
      intents: [{ id: 'multi-task', subject: 'backend' }],
    };
    // THE REPORTED SYMPTOM: the body the client sends must not contain the
    // instruction paragraph glued into the user's message.
    assert.ok(!JSON.stringify(outgoing).includes(PLAN_BOILERPLATE));
    assert.strictEqual(outgoing.question, 'add rate limiting to the API');

    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(outgoing),
    });
    assert.strictEqual(res.status, 200);
    /* The mock answers in prose to an edit-intent question, so the edit
       contract (Wave 9+) appends its closing fact. This test's claim is about
       BOILERPLATE ON THE WIRE, not about the contract — the answer must carry
       the model's text, and anything appended must be the harness's own
       factual note, never instruction boilerplate. */
    const answered = ((await res.json()) as { text: string }).text;
    assert.ok(answered.startsWith('Three tasks, each in one sitting.'), answered);
    assert.ok(!answered.includes(PLAN_BOILERPLATE));
    // …and the model still received the whole instruction, composed server-side.
    assert.ok(prompt.includes(PLAN_BOILERPLATE), 'the server authored the instruction');
    assert.ok(prompt.includes('--- REQUESTED ACTIONS ---'));
    const qAt = prompt.indexOf('--- QUESTION ---');
    assert.ok(prompt.indexOf(PLAN_BOILERPLATE) < qAt, 'instruction is not inside the user message');
    assert.ok(!prompt.slice(qAt).includes(PLAN_BOILERPLATE));
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: "What breaks" reaches the provider as COMPUTED numbers, not a request to derive them', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo);
  const store = graph.nodes.find((n) => n.kind === 'datastore')!;
  const backend = graph.nodes.find((n) => n.kind === 'service' && n.label.toLowerCase().includes('backend'))!;
  let prompt = '';
  const mock = await startMockProvider((body) => {
    prompt = promptOf(body);
    return { text: 'The backend goes down.' };
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: '',
        intents: [{ id: 'impact', subject: store.label, subjectNodeId: store.id }],
      }),
    });
    assert.strictEqual(res.status, 200, 'a chip-only send is a complete request');
    assert.match(prompt, /GROUNDED FACTS/);
    assert.match(prompt, /Blast radius of/);
    assert.ok(prompt.includes(backend.label));
    assert.ok(!prompt.includes('--- QUESTION ---'), 'no empty question heading for a chip-only turn');
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: research mode composes the plan-only directive and still writes nothing', async () => {
  const repo = plainappRepo();
  // `.sequence/` is the server's own config dir (the PUT below writes ai.json);
  // the REPO's own tree is what must not change.
  const listRepo = () => fs.readdirSync(repo).filter((e) => e !== '.sequence').sort();
  const before = listRepo();
  let prompt = '';
  const mock = await startMockProvider((body) => {
    prompt = promptOf(body);
    // A model trying to write files must still not cause a write from /api/ask.
    return { text: '```\nFILE: src/evil.ts\n```\nHere are the files.' };
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'how should I split the backend?',
        mode: 'research',
        intents: [{ id: 'research-compare-patterns' }],
      }),
    });
    assert.strictEqual(res.status, 200);
    assert.ok(prompt.includes(RESEARCH_MODE_DIRECTIVE));
    assert.match(prompt, /Do not write, or claim to have written, production code/);
    assert.deepStrictEqual(listRepo(), before, '/api/ask never writes to the repo');
    assert.ok(!fs.existsSync(path.join(repo, 'src', 'evil.ts')));
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: BOTH wires get native tools, each in its own shape, from one composed prompt', async () => {
  const repo = plainappRepo();
  const prompts: string[] = [];
  const anthropicMock = await startMockProvider((b) => {
    prompts.push(promptOf(b));
    return { text: 'ok-anthropic' };
  }, 'anthropic');
  const openaiMock = await startMockProvider((b) => {
    prompts.push(promptOf(b));
    return { text: 'ok-openai' };
  }, 'openai');
  const { base, close } = await startServer(repo);
  try {
    const body = JSON.stringify({
      question: 'what breaks if the database goes down?',
      intents: [{ id: 'impact', subject: 'backend' }],
    });
    const post = () =>
      fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

    await putAiConfig(base, anthropicMock.baseUrl, 'anthropic');
    assert.strictEqual((await post()).status, 200);
    await putAiConfig(base, openaiMock.baseUrl, 'openai-compatible');
    const second = await post();
    assert.strictEqual(second.status, 200);
    assert.strictEqual(((await second.json()) as { text: string }).text, 'ok-openai');

    assert.strictEqual(prompts.length, 2);
    assert.strictEqual(prompts[0], prompts[1], 'both wire shapes receive the same composed prompt');
    assert.match(prompts[1], /--- REQUESTED ACTIONS ---/);
    /*
     * ONE REGISTRY, TWO SHAPES.
     *
     * This block used to assert `tools` was ABSENT on the anthropic wire and
     * called it "still out of scope". The consequence was that a claude-sonnet
     * user — the model most reliable at structured tool calling — ran the whole
     * agent loop on regex fence salvage, while a local granite4 got first-class
     * native calls: model-agnosticism inverted by a slice boundary. Both wires
     * carry the belt now, each in the shape its API defines, and the shapes must
     * not bleed into each other.
     */
    assert.ok(anthropicMock.requests.length >= 1);
    const anthropicBody = anthropicMock.requests[0]!.body as Record<string, unknown>;
    assert.ok(Array.isArray(anthropicBody.tools), 'the anthropic wire must send tools');
    const anthropicTools = anthropicBody.tools as Record<string, unknown>[];
    assert.ok(anthropicTools.length > 0);
    for (const t of anthropicTools) {
      assert.strictEqual(typeof t.name, 'string');
      assert.ok(t.input_schema && typeof t.input_schema === 'object', 'Messages wire names it input_schema');
      assert.strictEqual('function' in t, false, 'the openai envelope must not leak onto this wire');
    }
    /* Absent is auto on the Messages wire, and an omitted field is one fewer
       thing a proxy in front of the API can reject. */
    assert.strictEqual('tool_choice' in anthropicBody, false);

    /* B2.2 — openai-compatible asks attach the belt as native `tools`. */
    assert.ok(openaiMock.requests.length >= 1);
    const openaiBody = openaiMock.requests[0]!.body as Record<string, unknown>;
    assert.ok(Array.isArray(openaiBody.tools), 'openai-compatible must send tools');
    const openaiTools = openaiBody.tools as Record<string, unknown>[];
    assert.ok(openaiTools.length > 0);
    assert.strictEqual(openaiTools[0]!.type, 'function');
    /* SAME BELT: one registry, so the two wires can never offer different tools. */
    assert.deepStrictEqual(
      anthropicTools.map((t) => t.name),
      openaiTools.map((t) => (t.function as { name: string }).name),
    );
  } finally {
    await close();
    await anthropicMock.close();
    await openaiMock.close();
  }
});

test('/api/ask: an unknown intent id is reported, never invented into the prompt', async () => {
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
      body: JSON.stringify({ question: 'hi', intents: [{ id: 'rm-rf-everything' }] }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { unsupportedIntents?: string[] };
    assert.deepStrictEqual(body.unsupportedIntents, ['rm-rf-everything']);
    assert.ok(!prompt.includes('rm-rf-everything'));
    assert.ok(!prompt.includes('--- REQUESTED ACTIONS ---'));
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: a malformed intents field 400s instead of silently answering without it', async () => {
  const repo = plainappRepo();
  const mock = await startMockProvider(() => ({ text: 'ok' }));
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'hi', intents: 'multi-task' }),
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(mock.requests.length, 0, 'no provider call, so no spend, on a client bug');
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: the LEGACY body (question only) is byte-compatible with the pre-intent server', async () => {
  const repo = plainappRepo();
  const prompts: string[] = [];
  const mock = await startMockProvider((b) => {
    prompts.push(promptOf(b));
    return { text: 'ok' };
  });
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    for (const body of [
      { question: 'what does this app do?' },
      // …and the same request with the new fields present-but-empty.
      { question: 'what does this app do?', intents: [], context: { lines: [] }, mode: 'implementation' },
    ]) {
      const res = await fetch(`${base}/api/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.strictEqual(res.status, 200);
    }
    assert.strictEqual(prompts.length, 2);
    assert.strictEqual(prompts[0], prompts[1], 'empty new fields change nothing on the wire');
    // The exact pre-intent prompt.
    const graph = await scanRepo(repo);
    assert.ok(prompts[0].includes('--- STRUCTURE DIGEST (JSON) ---'));
    assert.ok(prompts[0].includes('--- QUESTION ---'));
    assert.ok(!prompts[0].includes('--- REQUESTED ACTIONS ---'));
    assert.ok(!prompts[0].includes('--- GROUNDED SCOPE'));
    assert.ok(graph.nodes.length > 0);
    // Still a 400 when there is neither a question nor an intent to run.
    const empty = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '   ' }),
    });
    assert.strictEqual(empty.status, 400);
  } finally {
    await close();
    await mock.close();
  }
});

test('/api/ask: the compiled scope arrives as its own section, still bounded server-side', async () => {
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
        question: 'what is this?',
        context: { lines: ['Grounded scope (2 top-level nodes):', '- service:backend @ backend'] },
      }),
    });
    assert.strictEqual(res.status, 200);
    assert.match(prompt, /--- GROUNDED SCOPE \(compiled from the real graph for this turn\) ---/);
    assert.ok(prompt.includes('- service:backend @ backend'));
    const qAt = prompt.indexOf('--- QUESTION ---');
    assert.ok(prompt.indexOf('--- GROUNDED SCOPE') < qAt, 'scope is not inside the user message');

    /*
     * THE CONTRACT IS "ONLY THE USER'S WORDS UNDER --- QUESTION ---", NOT
     * "THE QUESTION IS THE LAST THING IN THE PROMPT".
     *
     * This used to slice to the END of the prompt and compare, which also
     * asserted that nothing follows the question at all. That is a different
     * claim and not the documented one (see `AskComposition` in explain.ts), and
     * it breaks the moment any later labelled section is appended — which is
     * exactly what the attached-repo `--- TOOLS ---` block does. Reading to the
     * next section marker asserts the real invariant: the question section
     * contains the user's typed words and nothing the server glued on.
     */
    const body = prompt.slice(qAt + '--- QUESTION ---\n'.length);
    const nextSection = body.search(/\n--- [A-Z]/);
    const questionSection = nextSection < 0 ? body : body.slice(0, nextSection);
    assert.strictEqual(questionSection.trim(), 'what is this?');
  } finally {
    await close();
    await mock.close();
  }
});

/* ============================================================ registry shape */

test('every capability id is unique and the three owner keepers are present', () => {
  const ids = askIntentIds();
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const id of ['break-down', 'multi-task', 'impact']) {
    assert.ok(ids.includes(id), `the owner's keeper "${id}" has a server capability`);
  }
});
