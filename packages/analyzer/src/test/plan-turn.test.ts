import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { executeCanvasWrite } from '../server/canvasTools.js';
import { renderAskInstructionBelt } from '../server/askPipeline.js';
import { PLANNING_GUIDANCE, parsePlanCommand, writePlanDocument } from '../server/planTurn.js';

/*
 * `/plan` — owner, 2026-09-22: "a certain set of tools which helps the model
 * create number one a goal, number two a to-do list, and number three an
 * in-depth plan … not a select guide rail that it has to absolutely follow".
 */
describe('the command', () => {
  it('/plan <task> is a planning turn about <task>', () => {
    assert.deepEqual(parsePlanCommand('/plan add a memory system'), {
      question: 'add a memory system',
      planning: true,
    });
    assert.deepEqual(parsePlanCommand('/PLAN: add a memory system'), {
      question: 'add a memory system',
      planning: true,
    });
  });

  it('anything else is left exactly as it was', () => {
    for (const q of ['plan the thing', '/planner x', '/plan', 'what is /plan for?']) {
      assert.deepEqual(parsePlanCommand(q), { question: q, planning: false }, q);
    }
    assert.deepEqual(parsePlanCommand(42), { question: 42, planning: false });
  });
});

describe('the guidance', () => {
  const base = { designMode: false, repoRoot: '/repo', question: 'add a memory system' } as never;

  it('joins the belt on a planning turn and only then', () => {
    const planning = renderAskInstructionBelt({ ...(base as object), planning: true } as never);
    const plain = renderAskInstructionBelt(base);
    assert.match(planning, /--- PLANNING THIS TASK ---/);
    assert.doesNotMatch(plain, /PLANNING THIS TASK/);
  });

  it('offers, it does not order — no absolutes, no counts to reach', () => {
    const text = PLANNING_GUIDANCE.join('\n');
    assert.doesNotMatch(text, /\b(MUST|NEVER|EXACTLY|ONLY|ALWAYS|REQUIRED)\b/);
    assert.match(text, /include what fits this task and leave out what does not/i);
    assert.match(text, /None of this is required/);
  });

  it('names the three parts he asked for', () => {
    const text = PLANNING_GUIDANCE.join('\n');
    assert.match(text, /write_plan/);
    assert.match(text, /"surface": "plan"/);
    assert.match(text, /before-and-after/);
    assert.match(text, /estimate/);
  });
});

describe('the Plan tab', () => {
  it('a canvas write can name the Plan tab, and the default carries no surface', () => {
    const plan = executeCanvasWrite('canvas.write_markdown', { content: '# Plan', surface: 'Plan' });
    assert.equal(plan.ok && plan.block?.surface, 'plan');
    const plain = executeCanvasWrite('canvas.write_markdown', { content: '# A', surface: 'canvas' });
    assert.equal(plain.ok && plain.block?.surface, undefined);
  });

  it('the plan document is saved beside the session, blocks in order', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-plan-doc-'));
    const file = writePlanDocument(repo, 'session-1', new Map([['a', '# Plan'], ['b', '## Risks']]));
    assert.ok(file);
    assert.equal(fs.readFileSync(file, 'utf8'), '# Plan\n\n## Risks');
    assert.equal(path.basename(file), 'session-1.md');
  });

  it('nothing to save writes nothing', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-plan-doc-'));
    assert.equal(writePlanDocument(repo, 's', new Map()), null);
    assert.equal(fs.existsSync(path.join(repo, '.sequence', 'plans')), false);
  });
});

describe('a chart link to an item the chart lacks', () => {
  it('is dropped and named, and the rest of the chart draws — the live /plan refusal', async () => {
    const { executeAskTool } = await import('../server/askTools.js');
    const ctx = { repoRoot: '/repo', resolveReadable: () => null } as never;
    const r = await executeAskTool(
      'propose_chart',
      {
        kind: 'before-and-after',
        title: 'Memory',
        items: [
          { id: 'orig', label: 'Without memory' },
          { id: 'next', label: 'With memory' },
        ],
        links: [
          { from: 'orig', to: 'prev' },
          { from: 'Without memory', to: 'next' },
        ],
      },
      ctx,
    );
    assert.equal(r.ok, true, r.evidence);
    assert.deepEqual(r.chart?.links, [{ from: 'orig', to: 'next' }]);
    assert.match(r.evidence, /left out links to items the chart does not have: orig -> prev/);
  });
});

describe('a planning turn is not told to ask first', () => {
  it('no turn is told to ask its scope first — planning or not', () => {
    const base = { designMode: false, repoRoot: '/repo', question: 'add a memory system', permission: 'plan' };
    const planning = renderAskInstructionBelt({ ...base, planning: true } as never);
    const plain = renderAskInstructionBelt(base as never);
    assert.doesNotMatch(planning, /ask ONE short clarifying question/);
    assert.doesNotMatch(plain, /ask ONE short clarifying question/);
    assert.match(planning, /Draw the detailed diagram/);
    assert.match(plain, /Draw the detailed diagram/);
    assert.match(planning, /plan it rather than asking about it/);
  });
});

describe('the approved plan is what the build works from', () => {
  it('the plan document written on the Plan tab is read back for the run', async () => {
    const { readPlanDocument } = await import('../server/planTurn.js');
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-plan-doc-'));
    writePlanDocument(repo, 'session-9', new Map([['a', '# Memory plan\n\nWhy: sessions are forgotten.']]));
    assert.match(readPlanDocument(repo, 'session-9') ?? '', /Memory plan/);
    assert.equal(readPlanDocument(repo, 'nobody'), undefined);
  });

  it('a live run carries the document; an idle turn does not', async () => {
    const { renderGoalSection } = await import('../server/goalPlan.js');
    const plan = [{ id: '1', text: 'Add a memory store', status: 'open' as const }];
    const live = renderGoalSection({ goal: 'remember sessions', plan, runLive: true, planDocument: '# Memory plan' }).join('\n');
    const idle = renderGoalSection({ goal: 'remember sessions', plan, runLive: false, planDocument: '# Memory plan' }).join('\n');
    assert.match(live, /THE PLAN DOCUMENT \(approved; build from this\)/);
    assert.match(live, /# Memory plan/);
    assert.doesNotMatch(idle, /THE PLAN DOCUMENT/);
  });
});

describe('chart item text is text (live, 2026-09-22)', () => {
  it('a board-shaped detail `{ whatItDoes }` is read as its sentence, and the chart lands', async () => {
    const { executeAskTool } = await import('../server/askTools.js');
    const ctx = { repoRoot: '/repo', resolveReadable: () => null } as never;
    const r = await executeAskTool(
      'propose_chart',
      {
        kind: 'system-architecture',
        title: 'Sequence architecture plan',
        items: [
          { id: 'schema', label: 'Schema', detail: { whatItDoes: 'Graph/domain/program types' } },
          { id: 'web2', label: 'Web2', detail: { whatItDoes: 'The UI' } },
        ],
        links: [{ from: 'web2', to: 'schema' }],
      },
      ctx,
    );
    assert.equal(r.ok, true, r.evidence);
    assert.equal(r.chart?.items[0]?.detail, 'Graph/domain/program types');
  });
});
