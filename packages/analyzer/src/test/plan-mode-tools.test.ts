import assert from 'node:assert';
import { test } from 'node:test';

import {
  ASK_MUTATING_TOOLS,
  ASK_TOOL_ALLOWLIST,
  askToolsForJobMode,
  renderAskToolHintSection,
} from '../server/askTools.js';

/**
 * THE PERMISSION CONTROL WAS DECORATIVE.
 *
 * The composer offers a control saying what the agent is allowed to do.
 * `PostAskRequest` had no field for it, so the mode never left the browser and
 * the server enforced its own rules having never learned what the reader
 * chose. The control implied a choice that was not being made.
 *
 * `plan` is the mode this can be honest about today: strictly weaker than the
 * default, so honouring it can only ever REFUSE more — never permit something
 * the server would otherwise have blocked.
 */

test('plan mode drops every mutating tool from the belt', () => {
  const belt = askToolsForJobMode(undefined, 'plan');
  for (const tool of ASK_MUTATING_TOOLS) {
    assert.ok(!belt.includes(tool), `${tool} must not be offered in plan mode`);
  }
});

test('plan mode KEEPS every reading tool', () => {
  /* Plan mode reads everything. A mode that could not read would not be able
     to produce the survey its instructions demand. */
  const belt = askToolsForJobMode(undefined, 'plan');
  for (const tool of ['read_file', 'search_files', 'git_status', 'git_diff']) {
    assert.ok(belt.includes(tool as never), `${tool} must still be offered`);
  }
});

test('PROPOSE_FILES COUNTS AS MUTATING, and this is the arguable one', () => {
  /*
   * It writes nothing to disk — a proposal is reviewed and accepted by a human
   * first. But plan mode's contract is that the turn ends in WORDS, and a turn
   * that ends in a diff sitting in the review pane has ended in something
   * else. A reader who asked for a plan and found a pending change did not get
   * what they chose.
   */
  assert.ok(ASK_MUTATING_TOOLS.includes('propose_files'));
});

test('ONLY FULL GETS THE SHELL — propose and the default do not', () => {
  /*
   * THE DEFAULT MODE USED TO RUN COMMANDS WHILE TWO SURFACES SAID IT COULD NOT.
   *
   * `propose` is what a new user has selected before they touch anything, and
   * it fell through to the full belt. The permission control describes it as
   * "Changes arrive as proposals you accept" and the autonomy matrix marks its
   * `runCommands` cell false — so a reader was told twice that nothing happens
   * without their accept, while the agent could invoke the attached repo's
   * `pnpm test` (arbitrary code out of an unaudited package.json) with no
   * accept step anywhere. The engine now matches what both surfaces say.
   *
   * An ABSENT mode is treated as the default rather than as full: a client that
   * never sends the field has not consented to a shell either.
   */
  const withoutShell = ASK_TOOL_ALLOWLIST.filter((t) => t !== 'run_command');
  for (const mode of [undefined, 'propose', 'autoEdit'] as const) {
    assert.deepStrictEqual(
      askToolsForJobMode(undefined, mode),
      withoutShell,
      `${mode ?? '(no mode)'} must not carry run_command`,
    );
  }
  assert.deepStrictEqual(askToolsForJobMode(undefined, 'full'), ASK_TOOL_ALLOWLIST);
  assert.ok(askToolsForJobMode(undefined, 'full').includes('run_command'));
});

test('THE MODEL IS TOLD THE SAME SHELL RULE THE BELT ENFORCES', () => {
  /* The hint is belt-driven, so a drift here would tell the model it may run
     commands the executor will refuse — a round spent apologising for a
     decision the user made. Locked as an equality, not as two lists. */
  for (const mode of [undefined, 'propose', 'autoEdit', 'plan', 'full'] as const) {
    const belt = askToolsForJobMode(undefined, mode);
    const hint = renderAskToolHintSection(undefined, mode).join('\n');
    assert.strictEqual(
      hint.includes('run_command'),
      belt.includes('run_command'),
      `${mode ?? '(no mode)'}: hint and belt disagree about run_command`,
    );
  }
});

test('plan mode composes with work mode rather than overriding it', () => {
  /* Work mode already drops run_command. Plan mode drops it too, and neither
     re-adds what the other removed. */
  const belt = askToolsForJobMode('work', 'plan');
  assert.ok(!belt.includes('run_command'));
  assert.ok(!belt.includes('propose_files'));
  assert.ok(belt.includes('read_file'));
});

test('THE MODEL IS TOLD THE SAME BELT IT IS GIVEN', () => {
  /*
   * Advertising a tool that will be refused invites the model to spend a round
   * asking for it and then apologise for something the USER chose.
   */
  const hint = renderAskToolHintSection(undefined, 'plan').join('\n');
  for (const tool of ASK_MUTATING_TOOLS) {
    assert.ok(!hint.includes(tool), `${tool} must not be advertised in plan mode`);
  }
  assert.ok(hint.includes('read_file'));
});
