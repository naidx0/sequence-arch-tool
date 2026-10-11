import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';

import { routeVisualIntent } from '@sequence/schema/dist/visual/router.js';

import { seedFromRuns } from '../server/agentRewind.js';
import { addAgent } from '../server/agentsStore.js';
import { createSession } from '../server/sessionsStore.js';
import { REPO_ROOT, call, repo, serve, temp, turn } from './t3Helpers.js';

/* Package review (next-0.1.4): the kit's private hint (and @drawing attachments) ride in body.prompt, which the
   server saves as the turn's prompt. After a relaunch the person's bubble shows them, Edit from here puts them
   back into the composer, and the rewind seed carries them. */

const FAKE = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'fake-codex-rewind', 'codex.mjs');

test('STACK-5 the saved prompt is what the person typed, not the agent copy with the visual hint', async () => {
  const dir = repo();
  const store = temp('seq-stack-store-');
  process.env.REWIND_STATE = path.join(store, 'state.json');
  process.env.REWIND_LOG = path.join(store, 'log.jsonl');
  addAgent(store, { id: 'codex', command: process.execPath, args: [FAKE], cwd: dir });
  const { base, close } = await serve(dir, store);
  try {
    const chat = createSession(dir).id;
    const typed = 'draw a chart of p95 latency by week';
    const hint = routeVisualIntent(typed)!.hint;
    /* What agentRunner.streamRun sends: withVisualHint(run.prompt, await expandDrawingRefs(run.prompt)). */
    await turn(base, { agentRef: 'codex', prompt: `${typed}\n\n[${hint}]`, display: typed, permissionMode: 'autoEdit', interactivePermissions: true, chatId: chat });
    const runs = (await call(base, `/api/acp/runs?chatId=${chat}`)).json.runs as { prompt: string }[];
    assert.strictEqual(runs[0]!.prompt, typed);
    /* The seed a Claude rewind carries is made from the saved prompt. */
    assert.ok(!seedFromRuns(runs as never).includes('prefer visual components'));
  } finally {
    await close();
    delete process.env.REWIND_STATE;
    delete process.env.REWIND_LOG;
  }
});
