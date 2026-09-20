/**
 * LOCKS `sequence ask --mode design`, built from the owner-reported shape.
 *
 * THE REPORT, 2026-09-08: "make sure it's doing system design, make sure it
 * recognizes" — Sequence was producing section cards instead of architecture.
 *
 * THE REPRODUCTION, before any fix. Asked to design a photo-upload system, the
 * CLI scanned 1085 nodes, read **0 of 2900 edges**, and answered with a
 * clarifying question whose stated reason was that the described workflow
 * "doesn't directly match any existing service in the repo". That is CORRECT
 * for implementation mode and useless for greenfield design — and there was no
 * way for the caller to say which they meant, because `--mode` accepted only
 * `implementation` and `research`.
 *
 * THE CAUSE was not a missing feature. `buildDesignAskPrompt` has always said
 * the right thing ("helping the user DESIGN a software system from scratch …
 * propose a concrete architecture"), and `designDrawBaseline` drives it on a
 * blank-design workspace. `askCli.ts` hardcoded `designMode: false` in BOTH the
 * instruction hash and the pipeline call, so the design path was unreachable
 * from the command line.
 *
 * WHAT THESE LOCK, and why each would have failed before the fix:
 *
 *   1. `--mode design` parses at all. It returned a usage error.
 *   2. The other two modes still parse, and a junk mode is still refused with a
 *      message that NAMES all three — a rejected flag whose error lists the
 *      wrong set is how a working feature stays undiscovered.
 *   3. The usage text offers design. A flag no help text mentions is one nobody
 *      finds, which is the same defect as the flag not existing.
 *
 * WHAT THESE DELIBERATELY DO NOT LOCK: the model's answer. Whether a given
 * model proposes a good architecture is a measurement, not an assertion, and it
 * belongs in the bench with a baseline beside it. Asserting on generated prose
 * here would be a test that passes on a sentence and claims a capability.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAskArgs } from '../askCli.js';

const QUESTION =
  'Design the architecture for this system: users upload photos from a mobile app, ' +
  'thumbnails are generated asynchronously, and results are served worldwide.';

test('ask --mode design parses, and is the owner-reported case', () => {
  const parsed = parseAskArgs([QUESTION, '--mode', 'design']);
  assert.equal(parsed.error, undefined, 'design mode must not be a usage error');
  assert.equal(parsed.mode, 'design');
  assert.equal(parsed.question, QUESTION);
});

test('the two prior modes still parse — the fix widens, it does not replace', () => {
  for (const mode of ['implementation', 'research'] as const) {
    const parsed = parseAskArgs(['q', '--mode', mode]);
    assert.equal(parsed.error, undefined, `${mode} must still parse`);
    assert.equal(parsed.mode, mode);
  }
  assert.equal(parseAskArgs(['q']).mode, 'implementation', 'default is unchanged');
});

test('an unknown mode is refused, and the refusal names all three', () => {
  const parsed = parseAskArgs(['q', '--mode', 'sideways']);
  assert.ok(parsed.error, 'a junk mode must still be refused');
  const message = String(parsed.error);
  for (const mode of ['implementation', 'research', 'design']) {
    assert.ok(
      message.includes(mode),
      `the error must name ${mode}; a caller reads this list to find the flag: ${message}`,
    );
  }
});

test('the usage text offers design, so the flag is discoverable', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  /* Reads the COMPILED module beside this test, not the .ts source: the suite
     runs out of dist/, where no .ts file exists. The USAGE literal survives
     compilation intact, so this asserts on the text the user is actually
     shown. */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.resolve(here, '..', 'askCli.js'), 'utf8');
  const usage = source.slice(source.indexOf('const USAGE'), source.indexOf('const USAGE') + 4000);
  assert.ok(
    usage.includes('implementation|research|design'),
    'the usage line must offer design alongside the other modes',
  );
  assert.ok(
    /design:.*does NOT\s*\n?\s*.*exist yet/s.test(usage) || usage.includes('does NOT'),
    'the help must say design is for a system that does not exist yet',
  );
});
