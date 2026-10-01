import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAskArgs } from '../askCli.js';

/**
 * THE TURN DEADLINE HAD NO CALLER — the reported shape.
 *
 * `docs/research/teach-mode-driven-end-to-end.md` §6, measured on this
 * repository with `minicpm5-hermes` Q8_0: two of three teach turns produced NO
 * LESSON, stopped by `ASK_TURN_DEADLINE_MS = 180_000`. The section's finding is
 * not that 180 seconds is the wrong number — it is that **no caller can
 * choose**:
 *
 *   "`resolveTurnDeadlineMs` accepts a `turnDeadlineMs` override, and the HTTP
 *    route never reads one. The CLI's `--timeout` is a client-side give-up, not
 *    this deadline. So a learner in the app has a hard three-minute ceiling per
 *    turn with no way to lift it."
 *
 * Verified again before this test was written: `turnDeadlineMs` is declared on
 * the pipeline input, read by `resolveTurnDeadlineMs`, and passed by exactly one
 * thing in the repository — `ask-turn-deadline.test.ts`. Neither shipped caller
 * (`repoServer.ts`, `askCli.ts`) sets it. It was a parameter only a test could
 * reach.
 *
 * WHY THE CLI AND NOT THE ROUTE. Raising the budget a LEARNER gets is a product
 * call — §6 poses it as one and this lane does not take it. Making the existing
 * parameter reachable on the HEADLESS path is not: it changes no default, no app
 * behaviour and no answer, and it is what lets the next measurement ask whether
 * a lesson finishes with more time. §6's contract checks are currently marked
 * UNVERIFIED precisely because no turn on this repository has ever finished.
 *
 * `--timeout` AND `--turn-deadline` ARE DIFFERENT THINGS and the help text has
 * to say so, or the CLI ships two flags a caller will reasonably confuse:
 * `--timeout` aborts the CLI process and exits CANCELLED, killing a turn in
 * flight; `--turn-deadline` is the pipeline's own soft budget, which stops NEW
 * tool rounds and lets the turn write its answer.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const askCliSource = (): string =>
  fs.readFileSync(path.resolve(here, '..', '..', 'src', 'askCli.ts'), 'utf8');

test('THE REPORTED SHAPE: a caller can now set the turn deadline', () => {
  const parsed = parseAskArgs(['--turn-deadline', '600000', 'teach me jail.ts']);
  assert.strictEqual(parsed.error, undefined, `must parse: ${parsed.error}`);
  assert.strictEqual(parsed.turnDeadlineMs, 600_000);
  assert.strictEqual(parsed.question, 'teach me jail.ts', 'the flag must not eat the question');
});

test('0 is the documented switch-off, and is NOT rejected as "not positive"', () => {
  /*
   * `resolveTurnDeadlineMs` documents `<= 0` as "no deadline" and
   * `ask-turn-deadline.test.ts` drives its ceiling case with exactly 0. A
   * validator copied from `--timeout` (which requires > 0, because a zero-length
   * client give-up is meaningless) would reject the one value the pipeline
   * defines a meaning for.
   */
  const parsed = parseAskArgs(['--turn-deadline', '0', 'q']);
  assert.strictEqual(parsed.error, undefined, `0 means no deadline: ${parsed.error}`);
  assert.strictEqual(parsed.turnDeadlineMs, 0);
});

test('a non-numeric or negative deadline is refused by NAME, not coerced', () => {
  /*
   * Matching only /--turn-deadline/ would pass BEFORE the flag exists, on the
   * unconsumed-flag error ("an unconsumed `--flag` is a typo, not a question").
   * A check that is green before the fix is not a check, so this asserts the
   * validator's own sentence.
   */
  const bad = parseAskArgs(['--turn-deadline', 'soon', 'q']);
  assert.match(String(bad.error), /--turn-deadline must be/, `got: ${bad.error}`);
  const negative = parseAskArgs(['--turn-deadline', '-5', 'q']);
  assert.match(String(negative.error), /--turn-deadline must be/, `got: ${negative.error}`);
});

test('absent means absent — the default is the pipeline’s, not the CLI’s', () => {
  /*
   * The CLI must not restate 180_000. A second copy of a default is how the two
   * halves of a rule drift, and this file exists because of a parameter that had
   * one reader and no writer.
   */
  const parsed = parseAskArgs(['q']);
  assert.strictEqual(parsed.turnDeadlineMs, undefined);
  const src = askCliSource();
  assert.ok(
    !/180_?000/.test(src),
    'the CLI must not hardcode the deadline default; ASK_TURN_DEADLINE_MS owns it',
  );
});

test('the flag reaches the pipeline, and is not parsed and dropped', () => {
  /*
   * The defect this whole file is about was a parameter nothing passed. Parsing
   * it into a field that no call site forwards would reproduce it exactly one
   * layer further in.
   */
  const src = askCliSource();
  assert.match(
    src,
    /turnDeadlineMs:\s*parsed\.turnDeadlineMs/,
    'askCli must forward turnDeadlineMs into runAskPipeline',
  );
});

test('the help text distinguishes it from --timeout', () => {
  /* Two flags measured in milliseconds that do different things: if the help
     does not separate them, the CLI has shipped a trap. */
  const src = askCliSource();
  /*
   * Anchored on the DESCRIPTION line ("  --timeout <ms>    give up after"), not
   * on the synopsis: the synopsis lists the two flags adjacently, so a window
   * around it matches whether or not either is actually explained.
   */
  const at = src.indexOf('--timeout <ms>    give up after');
  assert.ok(at > 0, 'the --timeout description line moved; re-anchor this test');
  const help = src.slice(at, at + 700);
  assert.match(help, /--turn-deadline/, 'documented next to --timeout, where the confusion lives');
  assert.match(help, /does not kill the turn|soft/i, 'the help must say how it differs');
});
