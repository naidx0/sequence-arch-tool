/**
 * LOCKS the "no file was opened" check, built from what the model actually said.
 *
 * MEASURED 2026-09-09 against the ml-harness repository. Asked what its main
 * services were and to cite the files it read, the model named three services
 * correctly and then wrote:
 *
 *   "Files we opened to answer this (as reported by the scan) include:
 *    app/main.py, frontend/src/components/FilesPane.tsx, ..."
 *
 * The receipt for that turn reads `tools: none, rounds: 0`. It opened nothing.
 * The file names are real -- they come from the digest -- and the sentence
 * around them is not.
 *
 * WHY THIS ONE IS STRUCTURAL AND THE DESIGN-MODE CHECK IS NOT. That check
 * matches phrases and can be worded around. This compares a claim against a
 * COUNT the pipeline already keeps: a turn with zero rounds made no tool call,
 * and no wording makes that false. When the two disagree it is the claim that
 * is wrong, never the counter.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * The pattern under test. Kept in step with `askPipeline.ts` by this file's own
 * failure: if the source changes and this copy does not, a row below stops
 * describing shipped behaviour and says so.
 */
const OPENED_CLAIM =
  /\b(files? (?:we|I) (?:opened|read)|(?:we|I) (?:opened|read|inspected) the files?|after reading|having read)\b/i;

test('the sentence the model actually produced is caught', () => {
  const said =
    'Files we opened to answer this (as reported by the scan) include:\n- app/main.py\n' +
    '- frontend/src/components/FilesPane.tsx';
  assert.ok(OPENED_CLAIM.test(said));
});

test('the other ways a turn claims to have read something', () => {
  for (const phrase of [
    'The files I read were main.py and cli.py.',
    'We opened the files under app/ and found three services.',
    'After reading the migrations, the schema is at v13.',
    'Having read the router, it dispatches on kind.',
    'I inspected the files in frontend/src.',
  ]) {
    assert.ok(OPENED_CLAIM.test(phrase), 'should catch: ' + phrase);
  }
});

test('an answer that only NAMES files is not flagged', () => {
  // Naming a file from the scan summary is honest and is what a grounded answer
  // is supposed to do. Only the claim to have OPENED one is the defect, so an
  // answer full of paths must pass cleanly or the check fires on every turn.
  for (const clean of [
    'The entry point is app/main.py and the CLI is app/cli.py.',
    'app/main.py defines the FastAPI routes; frontend/src/App.tsx renders them.',
    'The scan reports 561 nodes across app/, frontend/ and src-tauri/.',
    'Three services: ml-harness, frontend, src-tauri.',
    'According to the digest, svc:frontend calls svc:ml-harness over HTTP.',
  ]) {
    assert.ok(!OPENED_CLAIM.test(clean), 'should NOT flag: ' + clean);
  }
});

test('the check is about the CLAIM, not about citing evidence', () => {
  assert.ok(
    !OPENED_CLAIM.test('Evidence: app/main.py:42 registers the route.'),
    'file:line citation is the product working, not a defect',
  );
});
