/**
 * `locate_symbol` — the deterministic half of "where is this defined".
 *
 * WHY THIS TOOL EXISTS, measured: a six-question battery about this repository, every
 * answer grep-checkable, put to granite4-hermes through the real server scored 0/6. All
 * six questions named an identifier the index resolves with no model at all. The harness
 * routed each of them through model reasoning anyway, and the model invented answers.
 *
 * The worst case was "which source file builds the stalePaths array" — unanswerable not
 * because it is hard but because `repoServer.ts` (337,114 bytes) sat above the old
 * 256,000-byte content-search ceiling and was skipped SILENTLY. Search said "no matches"
 * about the one file that holds every API route.
 *
 * These lock the three properties that make the tool trustworthy: a definition outranks
 * its call sites, a miss says what it did not read, and a phrase is refused rather than
 * quietly matching nothing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isIdentifier,
  locateDeclarations,
  renderLocateEvidence,
} from '../server/locateSymbol.js';

/** A tiny in-memory repo: no disk, so these stay fast and hermetic. */
function corpus(files: Record<string, string>) {
  const eachFile = (visit: (rel: string) => boolean): void => {
    for (const rel of Object.keys(files)) if (visit(rel) === false) return;
  };
  const readFile = (rel: string): string | null => files[rel] ?? null;
  return { eachFile, readFile };
}

test('the DEFINITION outranks its call sites — the whole point of the tool', () => {
  const { eachFile, readFile } = corpus({
    'src/uses-it.ts': 'import { resolveShell } from "./terminal.js";\nconst s = resolveShell();\nresolveShell();\n',
    'src/terminal.ts': 'export function resolveShell(env = process.env): string {\n  return "bash";\n}\n',
    'src/also-uses.ts': 'resolveShell();\nresolveShell();\n',
  });
  const out = locateDeclarations('resolveShell', eachFile, readFile);

  /* A substring search returns five mentions and the definition is not first. This must
     return the declaration ONLY, and it must be the one in terminal.ts. */
  assert.equal(out.hits.length, 1, 'call sites are not declarations');
  assert.equal(out.hits[0]!.file, 'src/terminal.ts');
  assert.equal(out.hits[0]!.line, 1);
  assert.match(out.hits[0]!.text, /export function resolveShell/);
});

test('an exported const is found — the function graph alone would miss it', () => {
  /* Two of the six battery answers are exported consts. A lookup built only on the
     scanned FUNCTION graph answers four questions and is silent on two. */
  const { eachFile, readFile } = corpus({
    'src/askTools.ts': '/* notes */\nexport const MAX_ASK_TOOL_ROUNDS = 8;\n',
    'src/other.ts': 'if (rounds > MAX_ASK_TOOL_ROUNDS) stop();\n',
  });
  const out = locateDeclarations('MAX_ASK_TOOL_ROUNDS', eachFile, readFile);
  assert.equal(out.hits.length, 1);
  assert.equal(out.hits[0]!.what, 'exported binding');
  assert.equal(out.hits[0]!.line, 2);
});

test('a test-file declaration sorts BELOW a real one', () => {
  const { eachFile, readFile } = corpus({
    'src/thing.test.ts': 'const parseConfig = () => ({});\n',
    'src/thing.ts': 'export function parseConfig() {\n  return {};\n}\n',
  });
  const out = locateDeclarations('parseConfig', eachFile, readFile);
  assert.equal(out.hits.length, 2, 'both are real declarations');
  assert.equal(out.hits[0]!.file, 'src/thing.ts', 'the shipped one comes first');
});

test('a name that is a prefix of another symbol is not a match', () => {
  const { eachFile, readFile } = corpus({
    'src/a.ts': 'export function resolveShellPath() {}\nexport const resolveShellCache = 1;\n',
  });
  const out = locateDeclarations('resolveShell', eachFile, readFile);
  assert.deepEqual(out.hits, [], 'word-boundary anchored, never a substring');
});

test('A MISS NAMES WHAT IT DID NOT READ', () => {
  /*
   * The defect this whole tool was built around. A file skipped for size used to vanish,
   * so "no matches" was indistinguishable from "does not exist" — for repoServer.ts,
   * the file most questions in this repository are about.
   */
  const { eachFile, readFile } = corpus({ 'src/small.ts': 'nothing here\n' });
  const out = locateDeclarations('stalePaths', eachFile, readFile, [
    'packages/analyzer/src/server/repoServer.ts',
  ]);
  const evidence = renderLocateEvidence('stalePaths', out);

  assert.match(evidence, /no DECLARATION found/);
  assert.match(evidence, /NOT SEARCHED \(too large\)/, 'the skip must be stated, not swallowed');
  assert.match(evidence, /repoServer\.ts/, 'and the file must be named');
});

test('a HIT still reports an unread file, so a partial answer says it is partial', () => {
  const { eachFile, readFile } = corpus({ 'src/a.ts': 'export const thing = 1;\n' });
  const out = locateDeclarations('thing', eachFile, readFile, ['huge/bundle.js']);
  const evidence = renderLocateEvidence('thing', out);
  assert.match(evidence, /1 declaration/);
  assert.match(evidence, /NOT SEARCHED \(too large\)/, 'a hit does not excuse hiding the gap');
});

test('a phrase is refused rather than matching nothing', () => {
  /* A regex built out of prose matches nothing, and an empty result reads as "this does
     not exist" — the exact confusion the tool exists to remove. */
  assert.equal(isIdentifier('resolveShell'), true);
  assert.equal(isIdentifier('MAX_ASK_TOOL_ROUNDS'), true);
  assert.equal(isIdentifier('$el'), true);
  assert.equal(isIdentifier('which file builds stalePaths'), false);
  assert.equal(isIdentifier('foo.bar'), false);
  assert.equal(isIdentifier(''), false);
});

test('evidence carries the declaring line itself, so the claim can be checked', () => {
  const { eachFile, readFile } = corpus({
    'packages/export/src/derivedEdges.ts': 'export function deriveImportEdges(\n  graph: ArchGraph,\n) {}\n',
  });
  const evidence = renderLocateEvidence(
    'deriveImportEdges',
    locateDeclarations('deriveImportEdges', eachFile, readFile),
  );
  assert.match(evidence, /packages\/export\/src\/derivedEdges\.ts:1/);
  assert.match(evidence, /export function deriveImportEdges\(/, 'the proof is the source line');
});
