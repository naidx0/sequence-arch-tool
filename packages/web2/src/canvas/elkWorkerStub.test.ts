import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ITEM 3.2 — the one constraint the lifted worker carries that a reader cannot
 * see by reading the worker.
 *
 * `elk.worker.ts` came across from v1 verbatim. Its first executable statement
 * stubs `self.document`, and elkjs is then loaded by a DYNAMIC `import()`. Both
 * halves are load-bearing and the second one is the easy one to lose, because
 * converting a dynamic import to a static one reads like a tidy-up and breaks
 * nothing that any other test can see:
 *
 *   elkjs's bundled build self-detects a Worker-like environment via
 *   `typeof document === 'undefined' && typeof self !== 'undefined'` and hijacks
 *   `self.onmessage` to turn itself into a standalone worker entrypoint. This
 *   file already IS a Worker, so that self-check misfires and elkjs fails to
 *   construct (`_Worker is not a constructor`). Stubbing `document` makes elkjs
 *   take its normal same-thread path. Static `import` declarations are HOISTED
 *   and evaluate before any of this module's own statements, so the stub only
 *   wins if elkjs arrives through `import()`.
 *
 * Recorded as constraint ★2.1 in docs/rebuild/inherited-constraints.md. That
 * document's lock (tools/ci/inherited-constraints.test.mjs) cites the v1 file,
 * which is deleted at Wave 7 — so the constraint needs a lock that lives beside
 * the code that now carries it.
 *
 * IT ASSERTS THE INVARIANT, NOT THE EXPRESSION: the ORDER of the two events and
 * the ABSENCE of any static elkjs import — not the literal `??=`, not the exact
 * specifier string, and not a line number. A worker that reaches the same state
 * by another spelling passes; one that hoists elkjs above the stub cannot.
 */

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'elk.worker.ts');

/* core.autocrlf=true on this checkout — normalise before anything indexes. */
const SOURCE = readFileSync(WORKER, 'utf8').replace(/\r\n/g, '\n');

/** Source with comments removed: the header quotes both `import` and
 *  `document`, and a prose mention must not satisfy — or trip — a rule about
 *  what the module actually executes. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('item 3.2 — the lifted elk worker keeps its elkjs stub', () => {
  it('stubs document before elkjs is loaded', () => {
    const stub = CODE.search(/\bdocument\b\s*(\?\?=|=[^=])/);
    const load = CODE.search(/\belkjs\b/);

    expect(stub, 'the worker no longer assigns self.document at all').toBeGreaterThan(-1);
    expect(load, 'the worker no longer loads elkjs at all').toBeGreaterThan(-1);
    expect(stub, 'elkjs is loaded before self.document is stubbed').toBeLessThan(load);
  });

  it('loads elkjs dynamically, so nothing hoists above the stub', () => {
    // A static `import ... from 'elkjs...'` or a bare side-effect
    // `import 'elkjs...'` — either one hoists above the stub.
    const hoisting = /(?:^|\n)\s*import\b(?:(?!\(\s*)[\s\S])*?['"][^'"]*elkjs[^'"]*['"]/;
    expect(hoisting.test(CODE), 'elkjs is imported statically and will hoist above the stub').toBe(
      false,
    );
    expect(/\bimport\s*\(\s*['"][^'"]*elkjs[^'"]*['"]\s*\)/.test(CODE)).toBe(true);
  });
});
