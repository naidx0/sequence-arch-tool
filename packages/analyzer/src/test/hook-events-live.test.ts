import assert from 'node:assert';
import { test } from 'node:test';

import {
  HOOK_EVENTS,
  HOOK_EVENTS_LIVE,
  hookEventFires,
  unfiredHookWarning,
} from '../server/hooks.js';

/**
 * FOUR ADVERTISED LIFECYCLE EVENTS THAT CANNOT FIRE.
 *
 * `HOOK_EVENTS` declares six. Only `pre-write` and `pre-commit` have a call
 * site; the other four are documented, accepted by the hooks file reader, and
 * invoked by nothing.
 *
 * A user who writes a `pre-tool` hook gets SILENCE — their script never runs,
 * nothing says why, and the likeliest conclusion is that their script is
 * broken, so they debug the wrong thing.
 */

test('only the two events with a call site are live', () => {
  assert.deepStrictEqual([...HOOK_EVENTS_LIVE].sort(), ['pre-commit', 'pre-write']);
});

test('THE OTHER FOUR ARE STILL DECLARED — the design is not deleted', () => {
  /* Six is the intended surface. Trimming it would lose the ambition; what
     was missing is the honesty, not the design. */
  for (const event of ['session-start', 'pre-tool', 'post-tool', 'run-finished']) {
    assert.ok(HOOK_EVENTS.includes(event as never), `${event} should still be declared`);
    assert.strictEqual(hookEventFires(event), false, `${event} does not fire`);
  }
});

test('a configured hook on a dead event is NAMED', () => {
  const warning = unfiredHookWarning(['pre-tool', 'pre-write']);
  assert.ok(warning);
  assert.match(warning, /pre-tool/);
  /* And the live one is not accused. */
  assert.ok(!warning.includes('pre-write'));
  assert.match(warning, /will not run/);
});

test('several dead events are listed once each, sorted', () => {
  const warning = unfiredHookWarning(['post-tool', 'pre-tool', 'pre-tool'])!;
  assert.match(warning, /post-tool, pre-tool/);
});

test('SILENCE WHEN EVERYTHING CONFIGURED IS LIVE', () => {
  /* Null rather than "all good" — a surface that congratulates the reader on
     every render is one they stop reading. */
  assert.strictEqual(unfiredHookWarning(['pre-write', 'pre-commit']), null);
  assert.strictEqual(unfiredHookWarning([]), null);
});

test('the singular reads as English', () => {
  assert.match(unfiredHookWarning(['pre-tool'])!, /pre-tool is configured/);
});
