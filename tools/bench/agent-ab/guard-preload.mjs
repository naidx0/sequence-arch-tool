/*
 * Preloaded (node --import) into the SCORED test run, from outside the agent's copy of the repo, before any
 * agent code loads. Two things an agent could otherwise do to make a test "pass" without fixing anything:
 *
 *   - rewrite the assertion library (assert.equal = () => {}, via import, dynamic import, process.getBuiltinModule,
 *     defineProperty...): node:assert, node:assert/strict and everything reachable from their own properties are
 *     deep-frozen, so an assignment throws in module code;
 *   - end the process early (process.exit, process.reallyExit, process.abort, in any spelling): they are replaced by
 *     stubs that throw, and the properties are locked.
 *
 * This is the first line of defence. The scorer's second is that it requires every test the reference solution runs,
 * by name, to report ok (an early exit reports the test FILE as the one passing test).
 */
import assert from 'node:assert';
import strict from 'node:assert/strict';

const seen = new Set();
function freezeDeep(o) {
  if (o === null || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) return;
  seen.add(o);
  for (const k of Reflect.ownKeys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (d && 'value' in d) freezeDeep(d.value);
  }
  Object.freeze(o);
}
freezeDeep(assert);
freezeDeep(strict);
freezeDeep(assert.strict);

for (const name of ['exit', 'reallyExit', 'abort']) {
  Object.defineProperty(process, name, {
    value: function disabled() {
      throw new Error(`process.${name} is disabled while a task is scored`);
    },
    writable: false,
    configurable: false,
    enumerable: true,
  });
}
