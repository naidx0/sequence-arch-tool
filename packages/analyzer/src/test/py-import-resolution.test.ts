import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveImportAll } from '../scan.js';

/**
 * `from PACKAGE import submodule` NAMES THE SUBMODULE, NOT THE PACKAGE.
 *
 * The resolver tried exactly two candidates for a Python import — `<mod>.py` and
 * `<mod>/__init__.py` — using only the module specifier. It never read
 * `ImportFact.names`, which the parser has always populated
 * (`parse/facts.ts` calls `parsePyFromImportNames`). So `from app import events`
 * resolved to `app/__init__.py` and stopped there.
 *
 * WHAT THAT COST, measured on ml-harness (292 files, 969 edges) on 2026-08-21:
 *
 *   - **550 of 969 import edges terminated on an `__init__.py`** package marker.
 *   - `app/events.py` — the Event Spine, depended on by most of the backend —
 *     had ZERO inbound edges.
 *   - A **two-line** `app/__init__.py` carried the highest PageRank in the whole
 *     graph, 0.1713, against 0.0202 for `app/main.py`. That is 8.5x, on a file
 *     containing nothing.
 *
 * The last one is why this sits upstream of the naming defects rather than
 * beside them: PageRank picks a cluster's anchor and the anchor picks its label,
 * so a hub that exists only as an artefact of unresolved imports was choosing
 * the words on the board.
 *
 * And which edges survived depended on the AUTHOR'S IMPORT STYLE, not on the
 * dependency: `from app.tools.evidence import X` resolved to the real file while
 * `from app.tools import evidence` did not. A graph that changes shape when you
 * rewrite an import without changing what the code depends on is measuring
 * syntax, not architecture.
 */

const FILES = new Set([
  'app/__init__.py',
  'app/main.py',
  'app/events.py',
  'app/provenance.py',
  'app/tools/__init__.py',
  'app/tools/evidence.py',
  'app/tools/registry.py',
  'pkg/__init__.py',
  'pkg/sub/__init__.py',
  'pkg/sub/leaf.py',
]);

const resolve = (from: string, raw: string, names?: string[]) =>
  resolveImportAll(from, raw, 'py', '.', FILES, undefined, names);

test('`from app import events` resolves to app/events.py, not the package marker', () => {
  assert.deepEqual(resolve('app/main.py', 'app', ['events']), ['app/events.py']);
});

test('every name in one statement becomes its own edge', () => {
  // `from app import events, provenance` genuinely depends on BOTH.
  assert.deepEqual(resolve('app/main.py', 'app', ['events', 'provenance']), [
    'app/events.py',
    'app/provenance.py',
  ]);
});

test('a name that is a SYMBOL, not a submodule, still resolves to the module', () => {
  // `from app.tools.evidence import record_fact` — `record_fact` is a function.
  // The module itself is the dependency and must remain the edge.
  assert.deepEqual(resolve('app/main.py', 'app.tools.evidence', ['record_fact']), [
    'app/tools/evidence.py',
  ]);
});

test('a mix of submodules and symbols keeps the submodules', () => {
  assert.deepEqual(resolve('app/main.py', 'app.tools', ['evidence', 'SOME_CONSTANT']), [
    'app/tools/evidence.py',
  ]);
});

test('a package submodule that is itself a package resolves to its __init__', () => {
  assert.deepEqual(resolve('app/main.py', 'pkg', ['sub']), ['pkg/sub/__init__.py']);
});

test('a plain `import app` still resolves to the package marker — nothing else is named', () => {
  assert.deepEqual(resolve('app/main.py', 'app', undefined), ['app/__init__.py']);
  assert.deepEqual(resolve('app/main.py', 'app', []), ['app/__init__.py']);
});

test('a relative `from . import events` resolves within the importing package', () => {
  assert.deepEqual(resolve('app/main.py', '.', ['events']), ['app/events.py']);
});

test('an unresolvable import is empty, never a guess', () => {
  assert.deepEqual(resolve('app/main.py', 'httpx', ['AsyncClient']), []);
  assert.deepEqual(resolve('app/main.py', 'app', ['not_a_module']), ['app/__init__.py']);
});
