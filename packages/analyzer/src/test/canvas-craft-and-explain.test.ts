import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { isExplainFileAsk } from '../server/askIntent.js';
import { renderAskInstructionBelt } from '../server/askPipeline.js';
import { CANVAS_TOOL_SCHEMAS } from '../server/canvasTools.js';

/*
 * ══════════════════════════════════════════════════════════════════════════
 * THE AGENT DRAWS BETTER, AND "EXPLAIN THIS FILE" LANDS ON THE CANVAS
 *
 * Owner, 2026-09-18: "if you ask the harness to explain a file it has to do
 * that there". Measured that morning (`docs/research/ai-canvas-moat-audit.md`):
 *
 *   §b  the belt named the five writers and said NOTHING about which one fits
 *       which ask, how big a diagram may get, or that motion is legal.
 *   §e  with a repo attached `canvasToolsEnabled` reduced to
 *       `isDrawishAskQuestion`, and "explain src/foo.ts" matches none of its
 *       alternatives — so the commonest ask in a code-reading tool had the
 *       canvas writers refused at the door.
 * ══════════════════════════════════════════════════════════════════════════
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const FIXTURES = path.join(ANALYZER_ROOT, 'test', 'fixtures');

type BeltInput = Parameters<typeof renderAskInstructionBelt>[0];

function belt(over: Partial<BeltInput> & { question: string }): string {
  return renderAskInstructionBelt({
    intents: [],
    ...over,
  } as BeltInput);
}

/* ------------------------------------------------- 1. craft + animation ---- */

describe('the belt teaches block craft, not only tool names', () => {
  const canvasBelt = belt({ question: 'draw the request flow', surface: { id: 'ai-canvas' } });

  it('names the section and stays within its twelve lines', () => {
    const at = canvasBelt.indexOf('--- CANVAS BLOCK CRAFT (binding) ---');
    assert.ok(at >= 0, 'craft section missing from a canvas turn');
    const section = canvasBelt.slice(at).split('\n\n')[0]!;
    assert.equal(section.split('\n').length, 12);
  });

  it('picks the kind by the ask — each of the five is given a job', () => {
    for (const kind of ['mermaid', 'svg', 'html', 'react', 'markdown']) {
      assert.match(canvasBelt, new RegExp('`' + kind + '`'), `no job stated for ${kind}`);
    }
  });

  it('states the four limits that make a diagram readable', () => {
    assert.match(canvasBelt, /ONE IDEA PER BLOCK/);
    assert.match(canvasBelt, /EVERY BLOCK GETS A `title`/);
    assert.match(canvasBelt, /AT MOST 8 NODES/);
    assert.match(canvasBelt, /LABEL EVERY EDGE/);
  });

  it('SAYS MOTION IS LEGAL, and names both mechanisms that actually work', () => {
    /* The sandbox has permitted these since scripts were allowed in, and
       nothing in the belt ever said so — so the model had no reason to try. */
    assert.match(canvasBelt, /@keyframes/);
    assert.match(canvasBelt, /<animate>/);
    assert.match(canvasBelt, /<animateTransform>/);
  });

  it('and says the network failure is SILENT, which is why it must be avoided', () => {
    /* A remote script under `default-src none` does not throw. It renders an
       empty box, and a model that does not know that will keep reaching for a
       CDN and keep shipping blank blocks. */
    assert.match(canvasBelt, /EMPTY BOX/);
    assert.match(canvasBelt, /no remote `<script>`|NO EXTERNAL ANYTHING/);
  });

  it('is absent from a turn that cannot draw at all', () => {
    const prose = belt({ question: 'is the auth check in this repo case sensitive?', repoRoot: '/r' });
    assert.doesNotMatch(prose, /CANVAS BLOCK CRAFT/);
  });
});

describe('the tool schemas say the same thing at the door', () => {
  it('canvas.write_svg admits SMIL rather than calling itself "SVG markup (no script)"', () => {
    const desc = String(
      (CANVAS_TOOL_SCHEMAS['canvas.write_svg'] as {
        properties: { content: { description: string } };
      }).properties.content.description,
    );
    assert.match(desc, /<animate>/);
    assert.match(desc, /<animateTransform>/);
    /* The script ban stays — this block is inlined into the host page. */
    assert.match(desc, /NO <script>/);
  });

  it('canvas.write_html prefers @keyframes over a timer, and names the empty-box failure', () => {
    const desc = String(
      (CANVAS_TOOL_SCHEMAS['canvas.write_html'] as {
        properties: { content: { description: string } };
      }).properties.content.description,
    );
    assert.match(desc, /@keyframes/);
    assert.match(desc, /EMPTY BOX/);
  });
});

/* --------------------------------------------- 2. explain lands on canvas -- */

describe('an ask to explain a file is recognised as one', () => {
  it('a path, with any of the explain verbs', () => {
    assert.equal(isExplainFileAsk('explain src/server/askPipeline.ts'), true);
    assert.equal(isExplainFileAsk('what does packages/ink/src/index.ts do?'), true);
    assert.equal(isExplainFileAsk('walk me through scan.ts'), true);
    assert.equal(isExplainFileAsk('how does routes/index.js work'), true);
  });

  it('a symbol the user marked as one', () => {
    assert.equal(isExplainFileAsk('explain `classifyAskIntent`'), true);
    assert.equal(isExplainFileAsk('what does recognizeStroke() do'), true);
  });

  it('a subject they point at rather than name', () => {
    assert.equal(isExplainFileAsk('explain this file'), true);
    assert.equal(isExplainFileAsk('what does the component do'), true);
  });

  it('BOTH HALVES ARE REQUIRED — a verb alone is not an explain-a-file ask', () => {
    /* Otherwise this becomes a second DRAW_PATTERN firing on half the turns. */
    assert.equal(isExplainFileAsk('explain the tradeoff between the two designs'), false);
    assert.equal(isExplainFileAsk('what is a monad'), false);
  });

  it('and a subject alone is not either', () => {
    assert.equal(isExplainFileAsk('open src/index.ts'), false);
    assert.equal(isExplainFileAsk('delete this file'), false);
  });

  it('an empty question is not an ask', () => {
    assert.equal(isExplainFileAsk('   '), false);
  });
});

describe('explain, against a REAL SCAN of a fixture repository', () => {
  /*
   * THE SUBJECT IS DERIVED, NOT TYPED. A hand-written path would pass whether
   * or not the scanner can see the file, which is the one thing this test is
   * for: the ask has to be about something the graph actually holds.
   */
  async function aRealFileInAFixture(): Promise<{ repo: string; file: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-canvas-explain-'));
    const repo = path.join(dir, 'repo');
    fs.cpSync(path.join(FIXTURES, 'express-cjs'), repo, { recursive: true });
    const graph = await scanRepo(repo, { cluster: true });
    const paths = graph.nodes
      .map((n) => n.path)
      .filter((f): f is string => typeof f === 'string' && /[.](?:js|ts|json)$/.test(f));
    assert.ok(paths.length > 0, 'the fixture scan produced no file paths to explain');
    return { repo: fs.realpathSync(repo), file: paths[0]! };
  }

  it('THE SCAN SUPPLIES THE SUBJECT — and it is an explain-a-file ask', async () => {
    const { file } = await aRealFileInAFixture();
    assert.equal(isExplainFileAsk(`explain ${file}`), true);
  });

  it('arms the canvas writers, which a drawish-word-only gate would not', async () => {
    const { repo, file } = await aRealFileInAFixture();
    const question = `explain ${file}`;
    const withRepo = belt({ question, repoRoot: repo });
    assert.match(withRepo, /--- AI CANVAS \(typed artifact blocks\) ---/);
    assert.match(withRepo, /--- CANVAS BLOCK CRAFT \(binding\) ---/);
  });

  it('and ORDERS THE PICTURE, grounded in what it actually read', async () => {
    const { repo, file } = await aRealFileInAFixture();
    const section = belt({ question: `explain ${file}`, repoRoot: repo });
    assert.match(section, /--- EXPLAIN IT ON THE CANVAS \(binding\) ---/);
    assert.match(section, /canvas\.write_mermaid/);
    assert.match(section, /canvas\.write_svg/);
    assert.match(section, /read_file/);
    assert.match(section, /path:line/);
    /* The refusal half: a file it could not read gets NO diagram. */
    assert.match(section, /draw NOTHING/);
  });

  it('the same repo, a question with no file in it, gets neither', async () => {
    const { repo } = await aRealFileInAFixture();
    const other = belt({ question: 'is the dependency list up to date?', repoRoot: repo });
    assert.doesNotMatch(other, /EXPLAIN IT ON THE CANVAS/);
    assert.doesNotMatch(other, /CANVAS BLOCK CRAFT/);
  });

  it('WITH NO REPOSITORY THE SECTION IS ABSENT, because its evidence would be', async () => {
    /* It orders `read_file` and demands `path:line`. On a repo-less turn both
       are unavailable, and a belt that orders a refused tool is the
       prompt-fights-itself shape this file is guarding. */
    const { file } = await aRealFileInAFixture();
    const homeless = belt({ question: `explain ${file}`, designMode: true });
    assert.doesNotMatch(homeless, /EXPLAIN IT ON THE CANVAS/);
  });
});
