/**
 * THE TEACH BENCH MUST GRADE WITH THE GRADER, WHOLE.
 *
 * `tools/bench/teach-eval.mjs` is the evidence behind every number in
 * `docs/teach-mode.md`, and on 2026-09-03 it was found not to be measuring the
 * contract it reported on. Two defects, both silent:
 *
 *  1. ARITY. It called `gradeTeachTurn(text, basenames)` against a
 *     four-argument signature. `readBasenames` and `visualThisTurn` arrived
 *     `undefined`, and both rules that use them are guarded exactly against
 *     that — `if (readBasenames)` and `if (visualThisTurn === false)`, where
 *     undefined is not false. The visual bounce and the cite-without-reading
 *     bounce had never fired in a single benchmarked turn. JS arity is silent:
 *     the grader is TypeScript and would have caught this, the bench is `.mjs`
 *     and did not, and that asymmetry is the whole reason this file exists.
 *
 *  2. A SECOND DEFINITION. The bench carried its own `hasVisual`, which had
 *     drifted from the grader — it counted a ```mermaid fence the product
 *     refuses, and any fence containing `-->` or `=>`, so a lesson showing one
 *     arrow function scored a visual. A bench that re-implements the rule it
 *     benchmarks measures itself.
 *
 * Converting the bench to TypeScript would close defect 1 properly and is the
 * better answer if it is ever worth the build cost; it imports from `dist/` at
 * run time, so that is not a free move. Until then this is the cheap guard, and
 * it is written to FAIL if either defect returns — which is the FIRST LAW in
 * `docs/how-to-verify.md`: a gate you cannot make fail is not a gate.
 *
 * core.autocrlf=true — the file is normalised to LF before it is matched.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BENCH = path.join(ROOT, 'tools/bench/teach-eval.mjs');

/** The file with comments and template/quoted strings removed, so a rule is
 *  matched against CODE and never against prose describing the rule. */
function code() {
  return fs
    .readFileSync(BENCH, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

test('the bench calls gradeTeachTurn with ALL FOUR arguments', () => {
  const calls = [...code().matchAll(/gradeTeachTurn\s*\(([^)]*)\)/g)]
    /* The import binding `{ runAskPipeline, gradeTeachTurn }` is not a call. */
    .map((m) => m[1].trim())
    .filter((args) => args.length > 0);

  assert.ok(calls.length > 0, 'the bench must actually call the grader');
  for (const args of calls) {
    const arity = args.split(',').length;
    assert.equal(
      arity,
      4,
      `gradeTeachTurn(${args}) passes ${arity} arguments. readBasenames and ` +
        'visualThisTurn are guarded against undefined, so a short call silently ' +
        'disables the visual bounce and the cite-without-reading bounce',
    );
  }
});

test('the bench does not re-implement "visual" — one definition, in the grader', () => {
  const src = code();
  assert.ok(
    !/function\s+hasVisual|const\s+hasVisual\s*=/.test(src),
    'the bench must not define its own hasVisual: the copy that existed drifted ' +
      'from the grader and counted a mermaid fence the product refuses',
  );
  /* The two shapes the deleted copy accepted and the grader does not. Matched
     against code only, so the comment recording the history does not trip it. */
  assert.ok(
    !/mermaid/.test(src),
    'a ```mermaid fence is not a visual — only ```seqd reaches the board',
  );
});

test('the bench reconstructs reads and the visual flag the way the pipeline does', () => {
  const src = code();
  assert.ok(
    /file:read/.test(src),
    'readBasenames must come from file:read events, as askPipeline builds filesReadThisTurn',
  );
  assert.ok(
    /chart:proposal/.test(src),
    'the visual flag must look for chart:proposal — the event the contract asks for',
  );
});
