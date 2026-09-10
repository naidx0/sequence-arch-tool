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
   * Asserted DIFFERENTIALLY, against the belt the prompt advertises: plan mode
   * removes `propose_files` from the tool belt, and `askTools.ts` deliberately
   * stops advertising it too - "a hint that advertises a refused tool is worse
   * than no hint". So the same question asked two ways must produce two
   * different prompts, or the mode did not arrive.
   *
   * ALSO: PLAN_MODE_INSTRUCTIONS must land in the plan prompt (and not in the
   * default). Tool refusal alone left the in-depth plan bar unreachable.
   */
  const repo = plainappRepo();
  const withPlan = await promptFromStreamedAsk(repo, { permission: 'plan' });
  const withoutPlan = await promptFromStreamedAsk(plainappRepo(), {});

  assert.match(withoutPlan, /propose_files/, 'the default belt advertises propose_files');
  assert.doesNotMatch(withPlan, /propose_files/, 'plan mode must not advertise a tool it refuses');
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
 * So this reads both handlers' declared body shapes out of the source and
 * asserts the streaming one accepts everything the non-streaming one does. It
 * is a source-shape test for the same reason `tools/ci/` has them: the
 * invariant is about the code, and no runtime assertion states it as plainly.
 */
test('BOTH ask handlers accept the same request fields', async () => {
  const src = fs.readFileSync(
    path.join(ANALYZER_ROOT, 'src', 'server', 'repoServer.ts'),
    'utf8',
  );

  function fieldsAfter(marker: string): Set<string> {
    const at = src.indexOf(marker);
    assert.ok(at !== -1, `could not find ${marker}`);
    /*
     * No fixed window. The first draft sliced 1400 chars after the marker and
     * read the declaration out of that — which silently CUT the declaration
     * once the streaming handler's preamble grew (audit G1/G5 appended
     * `sessionId` and `doneWhen` to the END of both shapes, and only the
     * streaming route's copy fell past the window). A guard that reports a
     * field as dropped because it could not see it is the drift it exists to
     * catch. So: find the declaration wherever it is, and bound the search to
     * the handler by asserting it is not implausibly far from the marker.
     */
    const open = src.indexOf('let body: {', at);
    assert.ok(open !== -1 && open - at < 8000, `no body declaration after ${marker}`);
    const close = src.indexOf('};', open);
    assert.ok(close !== -1, `unterminated body declaration after ${marker}`);
    const decl = src.slice(open, close);
    return new Set(
      Array.from(decl.matchAll(/(\w+)\?: unknown;/g)).map((m) => m[1] as string),
    );
  }

  const plain = fieldsAfter("pathname === '/api/ask' && method === 'POST'");
  const streamed = fieldsAfter("pathname === '/api/ask/stream' && method === 'POST'");

  const droppedByStream = [...plain].filter((f) => !streamed.has(f)).sort();
  assert.deepStrictEqual(
    droppedByStream,
    [],
    `/api/ask/stream ignores fields /api/ask reads: ${droppedByStream.join(', ')}. ` +
      'The client only ever posts to the streaming route, so a field only the ' +
      'other handler reads is a feature that does nothing.',
  );
});
