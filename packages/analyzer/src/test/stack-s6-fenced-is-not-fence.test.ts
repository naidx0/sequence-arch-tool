import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../index.js';
import { buildQueue, subjectlessRefusal } from '../server/lessonState.js';

/* Package review (next-0.1.4) S6: harness-06 asks about the agent's tool-call fence parser. The kit added
   schema/src/visual/fence.ts, and `fence` inside the word `fenced` made it the lesson's subject. A name must be a whole word of the ask. */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ASK = 'Teach me how tool calls are parsed from fenced blocks here.';

test('S6 "fenced" is not the file fence.ts: the lesson is refused, and the refusal ranks askTools.ts first', async () => {
  const graph = await scanRepo(REPO, { cluster: true });
  assert.deepStrictEqual(buildQueue(graph, ASK), [], 'no confident wrong subject');
  const text = subjectlessRefusal(ASK, buildQueue(graph, ASK), graph);
  assert.ok(text, 'the refusal fires, as it did before the kit');
  assert.match(text!, /askTools\.ts/);
  assert.ok(text!.indexOf('askTools.ts') < (text!.indexOf('stripToolProse.ts') + 1 || Infinity));
});

/* components renamed the kit's fence.ts to specBlock.ts (dc27bc33) so the real repo no longer has the collision; this keeps the rule
   itself held by a small repo that has a fence.ts again. */
test('S6 with a file named fence.ts in the repo, "fenced" still does not pick it, and fence.ts by name still does', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s6-'));
  try {
    const put = (rel: string, body: string): void => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    };
    put('package.json', '{"name":"s6","type":"module"}');
    put('src/visual/fence.ts', 'export function parseFence(s: string): string { return s.trim(); }\n');
    put('src/askTools.ts', "import { parseFence } from './visual/fence.js';\nexport function parseToolCalls(text: string): string[] { return [parseFence(text)]; }\n");
    put('src/ToolCallCard.tsx', 'export function ToolCallCard(): string { return "tool call"; }\n');
    put('src/util.ts', 'export const one = 1;\n');
    const graph = await scanRepo(dir, { cluster: true });
    assert.deepStrictEqual(buildQueue(graph, ASK).filter((c) => c.nodeId?.endsWith('visual/fence.ts')), [], 'fenced is not fence.ts');
    assert.ok(buildQueue(graph, 'Why does fence.ts reject a spec?').some((c) => c.nodeId?.endsWith('visual/fence.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S6 a name still matches as a whole word, a plural, or inside a path', async () => {
  const graph = await scanRepo(REPO, { cluster: true });
  assert.ok(buildQueue(graph, 'Why does specBlock.ts reject a spec?').some((c) => c.nodeId?.endsWith('visual/specBlock.ts')));
  assert.ok(buildQueue(graph, 'teach me about the lessonState').length > 0);
});
