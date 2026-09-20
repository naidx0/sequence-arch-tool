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
 * TWO RUNGS SINCE 2026-09-13. Plan is the old `propose` under the name the
 * owner uses for it — "make sure proposed mode is plan mode" — so it STAGES
 * file changes and draws, and the one thing it may never do is run a command.
 * TEACH is the narrow mode now: it refuses every mutating tool on its own,
 * whichever permission is set beside it.
 */

test('PLAN STAGES AND NEVER RUNS; TEACH is the one that drops everything', () => {
  /*
   * This case asserted that plan dropped every mutating tool, which was true
   * while plan meant read-only. Plan stages now, and a mode whose autonomy row
   * says `propose: true` has to be HANDED the staging tools or that cell is a
   * claim the belt refuses to honour.
   *
   * The narrow belt did not disappear — it moved to teach, where it always
   * belonged: `runAskPipeline` refuses every ASK_MUTATING_TOOLS call on a teach
   * turn regardless of permission, so advertising them there would be the
   * prompt teaching the model to call something the executor will refuse.
   */
  const plan = askToolsForJobMode(undefined, 'plan');
  assert.ok(!plan.includes('run_command'), 'run_command must not be offered in plan mode');
  assert.ok(plan.includes('propose_files'), 'Plan stages, so it must carry propose_files');

  const teaching = askToolsForJobMode(undefined, 'plan', { teach: true });
  for (const tool of ASK_MUTATING_TOOLS) {
    assert.ok(!teaching.includes(tool), `${tool} must not be offered while teaching`);
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

test('PROPOSE_FILES COUNTS AS MUTATING, and that is what keeps TEACH narrow', () => {
  /*
   * It writes nothing to disk — a proposal is reviewed and accepted by a human
   * first — so calling it mutating is the arguable call, and it is still the
   * right one. A LESSON that ends with a diff sitting in the review pane has
   * ended in something the learner did not ask for.
   *
   * The reason moved on 2026-09-13: this used to be justified by plan mode's
   * "the turn ends in WORDS" contract. Plan stages now, so teach is the
   * contract this membership actually serves.
   */
  assert.ok(ASK_MUTATING_TOOLS.includes('propose_files'));
});

test('ONLY BUILD GETS THE SHELL — and the gate is a membership test, not an exclusion list', () => {
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
   * An ABSENT mode has not consented to a shell either, so it is refused with
   * everything else.
   *
   * TWO RUNGS SINCE 2026-09-13 (owner: "teach mode, plan mode, build mode … it
   * should be pretty simple"), AND THAT MADE THIS GATE SAFER RATHER THAN
   * LOOSER. It used to name three of four values and let the fourth fall
   * through — a default-ALLOW written as a default-deny, one missing name away
   * from the very defect above. It is now `permission !== 'build'`, so the
   * stale names in the loop below — values this build can no longer produce,
   * but an old client or a hand-written body still can — lose the shell by
   * construction rather than by being listed.
   */
  /* `walk_example` is teach's own tool and is out of every non-teach belt by
     construction (askToolsForJobMode filters it from the base), so the
     expectation here subtracts it the same way it subtracts the shell. Stated
     rather than assumed: this assertion is deepStrictEqual, which is what makes
     it a gate, and a gate that has to be told about each new tool is doing its
     job. `teach-walk.test.ts` locks the other half — that teach KEEPS it. */
  /* `write_plan` / `mark_step_done` are subtracted for the same reason as
     `walk_example`: they are out of every belt by construction unless the
     session HAS a goal (`askToolsForJobMode`'s `goalDepth`, default `none`), so
     the expectation subtracts them the way it subtracts the shell.
     `goal-tools.test.ts` locks the other half — who does get them. */
  const withoutShell = ASK_TOOL_ALLOWLIST.filter(
    (t) => t !== 'run_command' && t !== 'walk_example' && t !== 'write_plan' && t !== 'mark_step_done',
  );
  for (const mode of [undefined, 'plan', 'propose', 'autoEdit', 'full', 'Build', 'build '] as const) {
    assert.deepStrictEqual(
      askToolsForJobMode(undefined, mode as never),
      withoutShell,
      `${mode ?? '(no mode)'} must not carry run_command`,
    );
  }
  /* Build gets the shell and still not the walk: the shell is a PERMISSION
     and the walk is a MODE'S tool, so the two subtract independently. */
  assert.deepStrictEqual(
    askToolsForJobMode(undefined, 'build'),
    ASK_TOOL_ALLOWLIST.filter(
      (t) => t !== 'walk_example' && t !== 'write_plan' && t !== 'mark_step_done',
    ),
  );
  assert.ok(askToolsForJobMode(undefined, 'build').includes('run_command'));
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
  /* Work mode already drops run_command. Plan drops it too, and neither
     re-adds what the other removed — which is the composition being asserted.
     Plan keeps the staging tools in both. */
  const belt = askToolsForJobMode('work', 'plan');
  assert.ok(!belt.includes('run_command'));
  assert.ok(belt.includes('propose_files'));
  assert.ok(belt.includes('read_file'));
});

test('THE MODEL IS TOLD THE SAME BELT IT IS GIVEN', () => {
  /*
   * Advertising a tool that will be refused invites the model to spend a round
   * asking for it and then apologise for something the USER chose. Asserted
   * against the belt itself rather than a fixed list, so the two cannot drift
   * apart whatever the mode turns out to allow.
   */
  for (const mode of ['plan', 'build'] as const) {
    const belt = askToolsForJobMode(undefined, mode);
    const hint = renderAskToolHintSection(undefined, mode).join('\n');
    for (const tool of ASK_MUTATING_TOOLS) {
      if (belt.includes(tool)) continue;
      assert.ok(!hint.includes(tool), `${tool} must not be advertised in ${mode} mode`);
    }
    assert.ok(hint.includes('read_file'));
  }
});
