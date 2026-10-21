import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  advanceLesson,
  buildTeachContext,
  lessonExhausted,
  newLesson,
  nextConcept,
  type LessonShape,
} from '../server/lessonState.js';

/**
 * THE BENCH AND THE PRODUCT MUST HAND THE BELT THE SAME THING.
 *
 * They are two callers of one pipeline and they used to assemble `teachContext`
 * separately — the ask handler from `lesson.json`, `tools/bench/teach-eval.mjs`
 * from an in-memory lesson. They drifted, and the drift was invisible: the
 * product passed `lessonDone: {}` where the bench passed
 * `lessonDone: { neighbours }`, and an empty object takes the belt's OTHER
 * branch — ask the learner what they want next, rather than propose a grounded
 * step from what touches the last concept. That is the turn shape of 10 of the
 * 20 bench conversations, so every belt number on record was measured against a
 * contract the product never rendered on the commonest follow-up there is.
 *
 * MY FIRST ATTEMPT AT THIS TEST WAS A MIRROR of both assemblies, and a mirror
 * cannot fail when either original moves — it tests its own copies. So the
 * assembly became one exported function instead, and what is gated here is
 * that function plus the fact that NEITHER CALLER BUILDS ITS OWN. Drift is now
 * a compile-time impossibility; the source scan is what keeps it that way.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..', '..', '..');

const GRAPH = {
  /* `kind: 'file'` because a real scanned node always carries one, and
     buildQueue now requires it: a concept is a FILE, and services and modules
     carry paths too but have no edges, so choosing one guarantees no chart. */
  nodes: [
    { id: 'a', kind: 'file', label: 'scan.ts', path: 'src/scan.ts' },
    { id: 'b', kind: 'file', label: 'join.ts', path: 'src/join.ts' },
    { id: 'c', kind: 'file', label: 'facts.ts', path: 'src/facts.ts' },
  ],
  edges: [
    { srcId: 'a', dstId: 'b' },
    { srcId: 'c', dstId: 'a' },
  ],
} as never;

const drain = (lesson: LessonShape): LessonShape => {
  let out = lesson;
  for (let i = 0; i < 12 && nextConcept(out) !== undefined; i += 1) {
    out = advanceLesson(out, { passed: true, turn: i });
  }
  return out;
};

test('an exhausted lesson carries REAL neighbours, not an empty object', () => {
  /*
   * The regression itself, pinned. `lessonDone: {}` is wrong in exactly the way
   * that hides: it is PRESENT, so the belt renders the finished-lesson slot,
   * and its neighbours are EMPTY, so the slot renders its ask-the-learner
   * branch. Both halves look correct in isolation.
   */
  const lesson = drain(newLesson('thread-1', 'teach me the scanner', GRAPH));
  assert.ok(lessonExhausted(lesson), 'the walk must actually reach an exhausted lesson');

  const ctx = buildTeachContext({ lesson, graph: GRAPH }) as {
    lessonDone?: { neighbours?: string[] };
  };
  assert.ok(ctx.lessonDone, 'the finished-lesson slot is present');
  assert.ok(
    (ctx.lessonDone.neighbours ?? []).length > 0,
    'and it proposes from what actually touches the last concept, rather than asking the learner',
  );
});

test('no lesson yields an empty context — never an invented finished one', () => {
  /* The ask handler may have no `lesson.json` yet where the bench always has a
     lesson. That asymmetry is legitimate; inventing a finished lesson from it
     would not be. */
  assert.deepStrictEqual(buildTeachContext({ graph: GRAPH }), {});
});

test('the belt variant rides through the same builder, so an arm cannot bypass it', () => {
  const lesson = newLesson('thread-1', 'teach me the scanner', GRAPH);
  const ctx = buildTeachContext({ lesson, graph: GRAPH, beltVariant: 'mid' });
  assert.strictEqual((ctx as { beltVariant?: string }).beltVariant, 'mid');
});

/* ═══ the gate that keeps it one assembly ═════════════════════════════════ */

/**
 * Comments out, tracking block state rather than matching a line prefix.
 *
 * The line-prefix version failed on this repository's own house style: a
 * wrapped continuation inside a block comment carries no leading marker, so a
 * comment EXPLAINING the drift read as code that caused it. A scan that cannot
 * tell prose from source will eventually be silenced rather than fixed.
 */
const stripComments = (src: string): string => {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) continue;
    out.push(line);
  }
  return out.join('\n');
};

test('NEITHER caller assembles teachContext itself', () => {
  /*
   * This is the test that would have caught the original bug, and the reason it
   * is a source scan rather than a behavioural one: the failure was not that a
   * function returned the wrong value, it was that there were TWO functions.
   * Nothing observable was wrong on either side alone.
   */
  const callers = [
    'packages/analyzer/src/server/repoServer.ts',
    'tools/bench/teach-eval.mjs',
  ];
  for (const rel of callers) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    const code = stripComments(src);
    assert.ok(
      code.includes('buildTeachContext'),
      `${rel} must build teachContext through the shared builder`,
    );
    assert.ok(
      !/lessonDone\s*:/.test(code),
      `${rel} hand-assembles lessonDone — that is the drift this exists to prevent`,
    );
  }
});

/* ═══ both ask routes, or neither ════════════════════════════════════════ */

/**
 * THERE WERE TWO ASK HANDLERS AND I PATCHED ONE.
 *
 * `/api/ask` and `/api/ask/stream` were separate blocks in `repoServer.ts` with
 * separate `callProvider` closures. The teach turn's `reasoningEffort: 'none'`
 * went into the first; every seat test drove the second. So the run that
 * "refuted" reasoning-off was measured on a path where reasoning was still on —
 * the Ollama log shows those requests generating 8,000 to 14,700 tokens each
 * with `common_reaso: activated`.
 *
 * This is the same shape as the `teachContext` drift: one rule, two places, one
 * of them quietly different. The assembly is now UNIFIED (item 23): both routes
 * call the same four steps in `askTurnCore.ts`, and each step carries one half
 * of the teach turn. So the gate is two scans: every route CALLS each step, and
 * each step really does its half.
 */
test('every ask route builds, contexts, narrows and FINISHES a teach turn', () => {
  const routes = fs.readFileSync(path.join(REPO, 'packages/analyzer/src/server/askRoutes.ts'), 'utf8');
  const core = stripComments(fs.readFileSync(path.join(REPO, 'packages/analyzer/src/server/askTurnCore.ts'), 'utf8'));

  /* 1. Each route calls every shared step. */
  const markers = ["pathname === '/api/ask' &&", "pathname === '/api/ask/stream' &&"];
  const at = markers.map((marker) => {
    const i = routes.indexOf(marker);
    assert.ok(i > 0, `route marker not found — has ${marker} been renamed?`);
    return { marker, i };
  });
  at.sort((a, b) => a.i - b.i);
  const steps: ReadonlyArray<readonly [RegExp, string]> = [
    [/prepareAskTurn\(/, 'builds the teach turn (thread, lesson, concept)'],
    [/buildAskPipelineInput\(/, 'passes the teach context to the pipeline'],
    [/makeAskCallProvider\(/, 'narrows reasoningEffort for a teach turn'],
    [/finishAskTurn\(/, 'writes the lesson'],
  ];
  for (let i = 0; i < at.length; i += 1) {
    /* Each route's slice runs to the start of the next, so the check cannot pass because a NEIGHBOUR calls the step. */
    const slice = stripComments(routes.slice(at[i]!.i, i + 1 < at.length ? at[i + 1]!.i : routes.length));
    for (const [re, what] of steps) {
      assert.ok(re.test(slice), `${at[i]!.marker} never calls ${re.source.replace('\\(', '')} — it ${what} through that step`);
    }
  }

  /* 2. Each step does its half, once, for both routes. */
  const fnBody = (name: string): string => {
    const start = core.indexOf(name);
    assert.ok(start > 0, `${name} not found in askTurnCore.ts`);
    const next = core.indexOf('\nexport ', start + name.length);
    return core.slice(start, next === -1 ? core.length : next);
  };
  assert.ok(/beginTeachTurn\(/.test(fnBody('export async function prepareAskTurn(')), 'the preparation does not build a teach turn — no lesson, no concept, no derived chart');
  assert.ok(/askTurn\.contextField\(\)/.test(fnBody('export function buildAskPipelineInput(')), 'the pipeline input does not carry the teach context');
  assert.ok(
    /askTurn\.configFor\(/.test(fnBody('export function makeAskCallProvider(')),
    'the provider callback does not narrow reasoningEffort for a teach turn — a teach turn thinks at length and spends its whole budget doing it',
  );
  assert.ok(/askTurn\.finish\(/.test(fnBody('export function finishAskTurn(')), 'the shared finish never writes the lesson — the next turn restarts it');
});
