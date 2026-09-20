import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ASK_TOOL_SEARCH_MAX_FILES, executeSearchFiles } from '../server/askTools.js';

/**
 * A SEARCH THAT STOPS EARLY MUST SAY SO.
 *
 * MEASURED on the real repository: `ASK_TOOL_SEARCH_MAX_FILES` is 200 and the
 * tree has over 950 tracked files, so the walk ends long before the end.
 * Searching for `deriveImportEdges` — which exists — answered "no matches".
 *
 * It did not fail to find it. It STOPPED LOOKING and said nothing, which is
 * exactly the failure this product exists to catch in other tools: an answer
 * silent about its own coverage. The agent has been receiving that answer too,
 * and reading it as "this symbol is not in the repository".
 */

function repoWith(fileCount: number, needleIn?: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-search-'));
  for (let i = 0; i < fileCount; i++) {
    const body = i === needleIn ? 'const findMeHere = 1;\n' : `const filler${i} = 1;\n`;
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, '0')}.ts`), body);
  }
  return dir;
}

function search(repoRoot: string, args: Record<string, unknown>) {
  return executeSearchFiles(args, {
    repoRoot,
    resolveReadable: (rel: string) => path.join(repoRoot, rel),
    designMode: false,
  } as never);
}

test('a search that fits reports no truncation', () => {
  const repo = repoWith(5, 2);
  const result = search(repo, { query: 'findMeHere' });
  assert.ok(result.ok);
  assert.match(result.evidence!, /1 match/);
  assert.ok(!/stopped after/.test(result.evidence!), 'nothing was cut');
});

test('NO MATCHES INSIDE THE CAP IS AN HONEST NO', () => {
  /* The claim "not here" is only true when the whole tree was looked at. */
  const repo = repoWith(5);
  const result = search(repo, { query: 'findMeHere' });
  assert.match(result.evidence!, /no matches/);
  assert.ok(!/stopped after/.test(result.evidence!));
});

test('A TRUNCATED SEARCH SAYS SO, and does not claim absence', () => {
  /*
   * The needle is past the cap, so the walk never reaches it. Before this, the
   * answer was a flat "no matches" — a claim about the REPOSITORY made from a
   * walk that ended early.
   */
  const repo = repoWith(ASK_TOOL_SEARCH_MAX_FILES + 50, ASK_TOOL_SEARCH_MAX_FILES + 20);
  const result = search(repo, { query: 'findMeHere' });

  assert.ok(result.ok);
  assert.match(
    result.evidence!,
    new RegExp(`stopped after ${ASK_TOOL_SEARCH_MAX_FILES} files`),
  );
  /* And it tells the reader what to do about it rather than only that it
     happened. */
  assert.match(result.evidence!, /narrow with a glob/);
});

test('a truncated search that DID find things still says it was cut', () => {
  /* Finding something is not evidence the walk finished — the next file might
     have held the one that mattered. */
  const repo = repoWith(ASK_TOOL_SEARCH_MAX_FILES + 50, 3);
  const result = search(repo, { query: 'findMeHere' });
  assert.match(result.evidence!, /1 match/);
  assert.match(result.evidence!, /stopped after/);
  assert.match(result.content!, /stopped after/);
});

test('A RESULT-CAPPED SEARCH SAYS THERE MAY BE MORE', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-search-results-'));
  fs.writeFileSync(
    path.join(repo, 'twenty-one.ts'),
    Array.from({ length: 21 }, (_, i) => `const findMeHere${i} = true;`).join('\n'),
  );

  const result = search(repo, { query: 'findMeHere' });

  assert.ok(result.ok);
  assert.match(result.evidence!, /20 matches/);
  assert.match(result.evidence!, /stopped after 20 matches - there may be more/);
  assert.match(result.content!, /stopped after 20 matches - there may be more/);
});

test('NARROWING WITH A GLOB ACTUALLY EXTENDS REACH', () => {
  //
  // The truncation message tells the reader to narrow with a glob. Nothing
  // checked that doing so works - and it did not. `filesScanned++` ran BEFORE
  // the glob test, so every file the glob EXCLUDED still spent the budget, and
  // the cap was reached at the same place no matter how narrow the glob was.
  //
  // MEASURED on the real monorepo through GET /api/search: searching for
  // `isOriginAllowed`, which is in two files, answered
  //   search "isOriginAllowed" - no matches (stopped after 200 files ...)
  // for the whole tree, for a glob naming one directory, AND for a glob naming
  // the single file that contains it.
  //
  // Inert advice is worse than no advice. The reader does what they were told,
  // gets the identical answer, and concludes the symbol is not in their repo.
  //
  const repo = repoWith(ASK_TOOL_SEARCH_MAX_FILES + 50, ASK_TOOL_SEARCH_MAX_FILES + 20);
  const needle = `f${String(ASK_TOOL_SEARCH_MAX_FILES + 20).padStart(5, '0')}.ts`;

  const result = search(repo, { query: 'findMeHere', glob: needle });

  assert.ok(result.ok);
  assert.match(
    result.evidence!,
    /1 match/,
    `narrowing to the one file that holds it must find it - got: ${result.evidence}`,
  );
});
