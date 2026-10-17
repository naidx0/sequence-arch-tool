import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { deriveGroundedLesson, handsTheWorkBack, withGroundedLesson, withWorkedExample } from '../server/conceptChart.js';

const ANALYZER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

async function shopfrontGraph() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-grounded-lesson-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return scanRepo(repo);
}

const SERVICES = {
  version: 1,
  kind: 'system-architecture',
  title: 'shopfront',
  items: [
    { id: 'g', label: 'gateway', nodeId: 'svc:gateway' },
    { id: 'o', label: 'orders', nodeId: 'svc:orders' },
    { id: 'db', label: 'postgres', nodeId: 'ds:postgres' },
  ],
  links: [
    { from: 'g', to: 'o', label: 'HTTP' },
    { from: 'o', to: 'db', label: 'stores orders' },
  ],
} as never;

/* The seven hand-backs quoted in the owner's chat (09-22/23), verbatim or cut to their deciding sentence. */
const HAND_BACKS = [
  'Hello! This looks like the start of a conversation. What are you working on — would you like help analyzing the intrtech service?',
  'I used all 2 of my tool rounds on this and was still looking things up when I ran out, so I have not written an answer rather than guess at one.',
  'I stopped because this turn hit its time budget while I was still looking things up, so I have not written an answer rather than guess at one.',
  'There is no README file',
  "your last turn cited `providers.py`, `facade.py`, and `security.py`, which I haven't verified yet. Can you confirm which files are available",
  'The question references "the ai canvas" which isn\'t a valid surface for this repository\'s contents',
];
/* The two that taught, cut to their first sentences. */
const LESSONS = [
  "The app is a FastAPI service (`app/main.py`) that sits behind a React UI (`frontend`). The frontend's engine module sends HTTP requests to the service. Those requests pass through a security middleware that enforces authentication, CORS, and allowed origins. The service persists state in a SQLite database (`ds:ml-harness-db`) and uses an OpenCode facade.",
  "Here's what I found from the repository structure and files you've loaded: the frontend sends an API call via `frontend/src/lib/engine/client.ts`, which posts to `app/main.py`.",
];

test('the hand-backs from the owner\'s chat are recognised, and the two real lessons are not', () => {
  for (const t of HAND_BACKS) assert.ok(handsTheWorkBack(t), t);
  for (const t of LESSONS) assert.ok(!handsTheWorkBack(t), t);
});

test('the lesson is read off the chart and the scan: the path, that the arrows are real, and a real file:line', async () => {
  const graph = await shopfrontGraph();
  const lesson = deriveGroundedLesson(graph, SERVICES)!;
  assert.match(lesson, /^Here is what the code itself shows, read from the scan\. Follow the picture on the canvas: it starts at \*\*gateway\*\*, goes through \*\*orders\*\*, and ends at \*\*postgres\*\*\./);
  assert.match(lesson, /Each arrow on that path is a connection the scan found in the code/);
  assert.match(lesson, /A real example from this code: `gateway\/src\/routes\/[a-z]+\.ts:\d+` sends/);
});

test('boxes that are not real nodes get the path but no claim that the arrows are the scan\'s', () => {
  const concept = {
    version: 1,
    kind: 'data-flow',
    title: 'softmax',
    items: [
      { id: 'a', label: 'scores' },
      { id: 'b', label: 'exponentials' },
    ],
    links: [{ from: 'a', to: 'b' }],
  } as never;
  const lesson = deriveGroundedLesson(undefined, concept)!;
  assert.match(lesson, /it starts at \*\*scores\*\* and leads to \*\*exponentials\*\*\./);
  assert.doesNotMatch(lesson, /connection the scan found/);
});

test('a hand-back keeps its own words after the lesson; a real lesson is left alone', async () => {
  const graph = await shopfrontGraph();
  const out = withGroundedLesson(HAND_BACKS[4]!, graph, SERVICES, 35);
  assert.match(out, /^Here is what the code itself shows/);
  assert.ok(out.endsWith(HAND_BACKS[4]!));
  assert.equal(withGroundedLesson(LESSONS[0]!, graph, SERVICES, 35), LESSONS[0]);
  /* An empty turn becomes just the lesson. */
  assert.match(withGroundedLesson('', graph, SERVICES, 35), /^Here is what the code itself shows[^\n]*$/);
  /* No chart with arrows, nothing to teach from: unchanged. */
  assert.equal(withGroundedLesson(HAND_BACKS[3]!, graph, undefined, 35), HAND_BACKS[3]);
});

test('the worked-example line is not added a second time after the lesson carries one', async () => {
  const graph = await shopfrontGraph();
  const out = withWorkedExample(withGroundedLesson(HAND_BACKS[0]!, graph, SERVICES, 35), graph, SERVICES);
  assert.equal(out.match(/A real example from this code/g)?.length, 1);
});

test('drop mode removes only the sentences that hand the work back, and keeps the rest of the model\'s words', async () => {
  const graph = await shopfrontGraph();
  const turn = "Your last turn cited `providers.py`, which I haven't verified yet. Can you confirm which files are available?";
  const out = withGroundedLesson(turn, graph, SERVICES, 35, 'drop');
  assert.match(out, /^Here is what the code itself shows/);
  assert.ok(out.includes("Your last turn cited `providers.py`, which I haven't verified yet."));
  assert.doesNotMatch(out, /Can you confirm which files/);
  /* A turn that is nothing but a hand-back becomes just the lesson. */
  assert.match(withGroundedLesson('There is no README file', graph, SERVICES, 35, 'drop'), /^Here is what the code itself shows[^\n]*$/);
  /* keep is the default and leaves every word. */
  assert.ok(withGroundedLesson(turn, graph, SERVICES, 35).endsWith(turn));
});
