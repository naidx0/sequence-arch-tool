/**
 * THE AGENT'S ONLY DISCOVERY TOOL SPENT ITS WHOLE BUDGET ON SCREENSHOTS.
 *
 * MEASURED by reproducing `walkFiles` over this monorepo (1,480 tracked files):
 * the first 200 files it examined — `ASK_TOOL_SEARCH_MAX_FILES`, the entire
 * budget — were 88 PNGs out of a gitignored `tmp-shots/`, 72 from `tools/`, 17
 * at the root, 10 from `site/`, and 13 from `packages/`, of which ZERO were in
 * `packages/analyzer/src`. Asking for a symbol that exists answered "no matches
 * (stopped after 200 files)".
 *
 * The fixtures here are built to that shape rather than to fixture scale: an
 * asset directory that sorts first, a second copy of the source tree under
 * `release/`, and a needle that only a walk which reaches source will find.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { IGNORE_DIRS } from '../ignoreDirs.js';
import {
  ASK_TOOL_SEARCH_MAX_FILES,
  executeSearchFiles,
  isSearchableTextFile,
} from '../server/askTools.js';

function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function search(repoRoot: string, args: Record<string, unknown>) {
  return executeSearchFiles(args, {
    repoRoot,
    resolveReadable: (rel: string) => path.join(repoRoot, rel),
    designMode: false,
  } as never);
}

/** The production shape: assets and a second source copy crowding the real tree. */
function crowdedRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-walk-'));
  /* 300 screenshots, which is what actually filled the old budget. */
  for (let i = 0; i < 300; i++) {
    write(root, `tmp-shots/shot-${String(i).padStart(4, '0')}.png`, 'PNGDATA'.repeat(50));
  }
  /* 300 files of tooling, which sort before `packages` and are not the answer. */
  for (let i = 0; i < 300; i++) {
    write(root, `tools/lora/gen-${String(i).padStart(4, '0')}.ts`, `export const gen${i} = 1;\n`);
  }
  /* A COMPLETE SECOND COPY of the source, which is what `release/` and
     `server-bundle/` are on a machine that has ever built this product. */
  for (let i = 0; i < 50; i++) {
    write(root, `release/packages/analyzer/src/f${i}.ts`, 'export function deriveImportEdges() {}\n');
  }
  write(root, 'packages/analyzer/src/graph/imports.ts', 'export function deriveImportEdges() {}\n');
  write(root, 'packages/web2/src/app.tsx', 'export const App = () => null;\n');
  return root;
}

test('A SYMBOL IN THE SOURCE TREE IS FOUND, not lost behind 600 files of noise', () => {
  const root = crowdedRepo();
  const result = search(root, { query: 'deriveImportEdges' });
  assert.ok(result.ok);
  assert.match(result.evidence, /match/, `expected a hit, got: ${result.evidence}`);
  assert.ok(
    result.content!.includes('packages/analyzer/src/graph/imports.ts'),
    'the real source hit must be in the results',
  );
});

test('THE BUILD OUTPUT IS NOT A SECOND REPOSITORY — one skip list, the canonical one', () => {
  /*
   * `SEARCH_SKIP_DIRS` was a third private copy of a list this repository keeps
   * canonically in `ignoreDirs.ts`, and it was missing `release`,
   * `server-bundle`, `out`, `coverage`, `vendor` and `.turbo`. `ignoreDirs.ts`
   * exists BECAUSE two copies of that list once diverged and made the graph lie.
   */
  assert.ok(IGNORE_DIRS.has('release'), 'the canonical list is the one being used');
  const root = crowdedRepo();
  const result = search(root, { query: 'deriveImportEdges' });
  assert.ok(
    !result.content!.includes('release/'),
    'a build copy of the source must never come back as a search result',
  );
});

test('AN ASSET FILE COSTS NOTHING — the budget is spent on things with lines in it', () => {
  assert.ok(isSearchableTextFile('packages/a/src/x.ts'));
  assert.ok(isSearchableTextFile('Dockerfile'));
  assert.ok(!isSearchableTextFile('tmp-shots/shot-0001.png'));
  assert.ok(!isSearchableTextFile('assets/logo.woff2'));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-walk-assets-'));
  for (let i = 0; i < ASK_TOOL_SEARCH_MAX_FILES + 100; i++) {
    write(root, `aaa-assets/shot-${String(i).padStart(5, '0')}.png`, 'PNGDATA');
  }
  write(root, 'zzz/src/needle.ts', 'const findMeHere = 1;\n');
  const result = search(root, { query: 'findMeHere' });
  assert.match(
    result.evidence,
    /1 match/,
    'more screenshots than the whole file budget still cannot hide one source file',
  );
});

test('SOURCE BEFORE ASSETS — the walk order is deterministic and prefers real code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-walk-order-'));
  write(root, 'tools/helper.ts', 'const shared = 1;\n');
  write(root, 'docs/note.md', 'shared\n');
  write(root, 'packages/app/src/main.ts', 'const shared = 2;\n');
  const result = search(root, { query: 'shared', maxResults: 3 });
  const rows = result.content!.split('\n').filter((l) => /:\d+: /.test(l));
  assert.ok(rows.length >= 2);
  assert.ok(
    rows[0].startsWith('packages/'),
    `source must be reached before tooling and docs, got: ${rows[0]}`,
  );
});

test('`**/` MATCHES ZERO DIRECTORIES, the way every other glob does', () => {
  /*
   * `**` expanded to `.*` and the following `/` was escaped and kept, so the
   * slash was mandatory: `packages/**\/*.ts` silently missed `packages/a.ts`
   * and `**\/*.ts` missed every root-level file. The tool's own truncation
   * message advises "narrow with a glob", so the advice and the matcher
   * disagreed — and the failure was a shorter list, never an error.
   */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-walk-glob-'));
  write(root, 'packages/a.ts', 'const target = 1;\n');
  write(root, 'packages/deep/b.ts', 'const target = 2;\n');
  write(root, 'root.ts', 'const target = 3;\n');

  const scoped = search(root, { query: 'target', glob: 'packages/**/*.ts' });
  assert.ok(scoped.content!.includes('packages/a.ts'), 'zero directories must match');
  assert.ok(scoped.content!.includes('packages/deep/b.ts'), 'and so must one');

  const everywhere = search(root, { query: 'target', glob: '**/*.ts' });
  assert.ok(everywhere.content!.includes('root.ts'), 'a root-level file matches `**/*.ts`');
  assert.ok(everywhere.content!.includes('packages/deep/b.ts'));
});
