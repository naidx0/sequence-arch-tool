import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';
import { putAttachment } from '../server/attachmentStore.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

/**
 * THE TWO ASK ROUTES MUST AGREE, AND THEY DID NOT.
 *
 * `/api/ask` and `/api/ask/stream` are two handlers for one question. The
 * client only ever posts to the STREAMING one (`askClient.ts:29`), and the
 * non-streaming one is what most of this server's ask features were wired
 * into. Four separate shipped-and-locked features were therefore dead for
 * every real user, each in the same way: the field went out on the wire, the
 * streaming handler never read it, and nothing anywhere said so.
 *
 *   · `attachmentIds`  a pasted log reached the server and was ignored
 *   · `permission`     choosing Plan changed nothing
 *   · `maxRounds`      the per-request cap could not be lowered
 *   · instructions     THIS repo's own AGENTS.md/CLAUDE.md were never read
 *
 * Every one of them had tests. Every one of those tests exercised the client,
 * the store or the non-streaming route - never the route the product uses.
 * That is the same seam the conversation-history defect lived in.
 *
 * These tests assert against THE PROMPT the provider actually receives, which
 * is the only artefact that proves a field survived the whole path.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-PARITY-42';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-parity-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

async function startServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Ask through the STREAMING route - the one the client actually posts to -
 * and answer the prompt the provider was handed.
 */
async function promptFromStreamedAsk(
  repo: string,
  body: Record<string, unknown>,
): Promise<string> {
  const prompts: string[] = [];
  const mock = await startMockProvider((req) => {
    prompts.push(JSON.stringify(req));
    return { text: 'ok' };
  });
  const { base, close } = await startServer(repo);
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });
    const res = await fetch(`${base}/api/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'What does this app do?',
        intents: [{ id: 'impact', subject: 'backend', subjectNodeId: 'svc:backend' }],
        ...body,
      }),
    });
    await res.text();
    return prompts.join('\n');
  } finally {
    await close();
    await mock.close();
  }
}

test('an ATTACHMENT reaches the prompt on the streaming route', async () => {
  /*
   * The client pastes a log, the server stores it, the chip renders, and the
   * turn carries `attachmentIds`. All of that was true and locked - and the
   * streaming handler dropped the field, so the model never saw the log.
   */
  const repo = plainappRepo();
  const stored = putAttachment(repo, 'crash.log', 'ValueError: bad input at line 42');

  const prompt = await promptFromStreamedAsk(repo, { attachmentIds: [stored.id] });

  assert.match(prompt, /ValueError: bad input at line 42/, 'the attached text is in the prompt');
  assert.match(prompt, /NOT read from this repository/, 'and it is marked as the user’s, not the repo’s');
});

test("the REPOSITORY'S OWN INSTRUCTIONS reach the prompt on the streaming route", async () => {
  /*
   * Rank 26's own words: "THIS REPOSITORY IS ITS OWN BEST EXAMPLE: it carries
   * AGENTS.md and CLAUDE.md at the root ... and nothing in the product ever
   * opened either one." It shipped, it was tested, and it was wired into the
   * handler the product does not call.
   */
  const repo = plainappRepo();
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# House rules\n\nAlways use tabs, never spaces.\n');
  /*
   * AND ONLY BECAUSE THE REPOSITORY IS TRUSTED. Repo text becoming binding
   * instruction on attach alone was the hole `server/repoTrust.ts` closes; this
   * test is the other half of that boundary and would otherwise be asserting
   * the defect. `repo-trust.test.ts` locks the untrusted side.
   */
  setRepoTrust(userStoreDir(), fs.realpathSync(repo), true);

  const prompt = await promptFromStreamedAsk(repo, {});

  assert.match(prompt, /Always use tabs, never spaces/, "the repo's own instructions are in the prompt");
  assert.match(prompt, /PROJECT INSTRUCTIONS/, 'under a header that names the file');
});

test('PLAN MODE changes the prompt on the streaming route', async () => {
  /*
   * The control under the composer said what the agent was allowed to do, and
   * on the streaming route the field was discarded - so choosing Plan changed
   * nothing at all. A decorative control is the exact defect rank 25 exists
   * to fix.
   *
   * Asserted DIFFERENTIALLY, against the belt the prompt advertises, because
   * `askTools.ts` deliberately stops advertising a tool it would refuse - "a
   * hint that advertises a refused tool is worse than no hint". So the same
   * question asked two ways must produce two different prompts, or the mode did
   * not arrive.
   *
   * THE BELT DIFFERENTIAL LEFT THIS FILE on 2026-09-13, and where it went is
   * the honest half of the note. It used to be `propose_files`, which Plan
   * refused when Plan meant read-only; Plan is the old `propose` now and
   * STAGES, so it advertises that tool like every other writing mode. The
   * boundary that replaced it is `run_command` — and that is NOT observable
   * here, because this harness drives the `work` job mode, which strips the
   * shell whatever the permission says. Asserting it against this prompt would
   * have passed for the wrong reason.
   *
   * So the shell boundary is measured where it can be measured directly, on
   * the belt itself: `plan-mode-tools.test.ts` and `openai-ask-tools.test.ts`.
   * What THIS case still proves, and what it was written for, is that the
   * permission field ARRIVES on the streaming route at all — the defect was a
   * decorative control whose field the handler discarded — and
   * PLAN_MODE_INSTRUCTIONS is the observable that shows it did.
   */
  const repo = plainappRepo();
  const withPlan = await promptFromStreamedAsk(repo, { permission: 'plan' });
  const withoutPlan = await promptFromStreamedAsk(plainappRepo(), {});

  assert.match(withPlan, /PLAN MODE/);
  assert.match(withPlan, /SURVEY BEFORE YOU PROPOSE/);
  assert.match(withPlan, /NAME THE FILES/);
  assert.doesNotMatch(withoutPlan, /SURVEY BEFORE YOU PROPOSE/);
});

/**
 * THE ROOT CAUSE, GUARDED DIRECTLY.
 *
 * Four features were dead on the streaming route for one reason: the two ask
 * handlers drifted, and nothing compared them. Testing each symptom leaves the
 * NEXT field to drift the same way, silently, until someone notices a feature
 * doing nothing.
 *
 * The two handlers used to declare their own body shapes and this test compared
 * the declarations. They now take their body from ONE preparation
 * (`prepareAskTurn` in askTurnCore.ts) that declares ONE `AskRequestBody`, so a
 * field cannot be read by one route and not the other. This test asserts that
 * structure, and that every `body.<field>` the shared code reads is declared. It
 * is a source-shape test for the same reason `tools/ci/` has them: the
 * invariant is about the code, and no runtime assertion states it as plainly.
 */
test('BOTH ask handlers accept the same request fields', async () => {
  const routes = fs.readFileSync(path.join(ANALYZER_ROOT, 'src', 'server', 'askRoutes.ts'), 'utf8');
  const core = fs.readFileSync(path.join(ANALYZER_ROOT, 'src', 'server', 'askTurnCore.ts'), 'utf8');

  /* One declaration, in the shared module. */
  const open = core.indexOf('export interface AskRequestBody {');
  assert.ok(open !== -1, 'AskRequestBody must be declared once, in askTurnCore.ts');
  const close = core.indexOf('\n}', open);
  assert.ok(close !== -1, 'unterminated AskRequestBody declaration');
  const declared = new Set(Array.from(core.slice(open, close).matchAll(/(\w+)\?: unknown;/g)).map((m) => m[1] as string));
  assert.ok(declared.size >= 16, `AskRequestBody declares only ${declared.size} fields`);

  /* Each handler takes its body from the shared preparation and declares none of its own. */
  const at = routes.indexOf("pathname === '/api/ask' && method === 'POST'");
  const atStream = routes.indexOf("pathname === '/api/ask/stream' && method === 'POST'");
  assert.ok(at !== -1 && atStream > at, 'both ask handlers must be found, buffered first');
  const slices: Array<[string, string]> = [
    ['buffered', routes.slice(at, atStream)],
    ['stream', routes.slice(atStream)],
  ];
  for (const [route, slice] of slices) {
    assert.ok(
      slice.includes(`prepareAskTurn(ctx, req, res, '${route}')`),
      `the ${route} handler must take its request from prepareAskTurn — a body shape of its own is how the routes drifted`,
    );
    assert.ok(!/let body:/.test(slice), `the ${route} handler declares a body shape of its own`);
  }

  /* Every field the shared code reads off the body is declared (derived from the code, not listed). */
  const read = new Set(Array.from(core.matchAll(/\bbody\.(\w+)/g)).map((m) => m[1] as string));
  const undeclared = [...read].filter((f) => !declared.has(f)).sort();
  assert.deepStrictEqual(undeclared, [], `the shared ask code reads body fields AskRequestBody does not declare: ${undeclared.join(', ')}`);
});

/**
 * THE SUBJECT-LESS LESSON REFUSAL IS CONSULTED THE SAME WAY BY BOTH ROUTES.
 *
 * `/api/ask` consulted `askTurn.refusal()` on every request; `/api/ask/stream` — the route the client posts to —
 * consulted it only inside its no-intents branch (item 23 kept that as an explicit difference). So "I want to learn
 * about machine learning" WITH an intent chip refused on one route and went to the provider on the other. Driven over
 * HTTP with a provider that counts its calls, because the property is "the provider is never reached".
 */
async function refusalProbe(path_: '/api/ask' | '/api/ask/stream', body: Record<string, unknown>) {
  let calls = 0;
  const mock = await startMockProvider(() => {
    calls += 1;
    return { text: 'ok' };
  });
  const { base, close } = await startServer(plainappRepo());
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });
    const res = await fetch(`${base}${path_}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', text, calls };
  } finally {
    await close();
    await mock.close();
  }
}

const SUBJECTLESS = 'I want to learn about machine learning. What is it?';

test('a subject-less lesson ask is refused on BOTH routes, with or without intents, and never reaches the provider', async () => {
  for (const route of ['/api/ask', '/api/ask/stream'] as const) {
    for (const withIntents of [false, true]) {
      const body: Record<string, unknown> = { question: SUBJECTLESS };
      if (withIntents) body.intents = [{ id: 'impact', subject: 'backend', subjectNodeId: 'svc:backend' }];
      const r = await refusalProbe(route, body);
      const label = `${route} ${withIntents ? 'with' : 'without'} intents`;
      assert.equal(r.status, 200, `${label}: status`);
      assert.match(r.text, /could not find a subject/i, `${label}: must answer with the refusal`);
      assert.match(r.text, /lesson/, `${label}: marked source "lesson"`);
      assert.equal(r.calls, 0, `${label}: the provider must not be called for a refused ask`);
    }
  }
});

test('the stream route answers a refusal as a real event stream (content-type set), like any other stream answer', async () => {
  const r = await refusalProbe('/api/ask/stream', { question: SUBJECTLESS });
  assert.match(r.contentType, /text\/event-stream/, `a refusal on the stream route was sent with content-type "${r.contentType}"`);
  assert.match(r.text, /^data: /m, 'and framed as SSE data');
});
