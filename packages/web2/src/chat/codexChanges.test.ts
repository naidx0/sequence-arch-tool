import { describe, expect, it } from 'vitest';

import { parseUnifiedDiff } from '../review/diffModel';
import { approvalFilesFor, codexChangesOf, inferKind, relativeIn, relativePath, replacementDiff, unifiedDiffFor } from './codexChanges';

/* The fileChange item exactly as `codex app-server generate-ts` (codex-cli
   0.153.4) declares it: ThreadItem `{ type: 'fileChange', id, changes:
   Array<FileUpdateChange>, status }`, FileUpdateChange `{ path, kind:
   PatchChangeKind, diff }`, PatchChangeKind `{ type: 'add' } | { type:
   'delete' } | { type: 'update', move_path }`. Paths are absolute. */
const ROOT = 'C:\\Users\\dev\\shop';
const ITEM = {
  type: 'fileChange',
  id: 'item-1',
  status: 'inProgress',
  changes: [
    { path: 'C:\\Users\\dev\\shop\\src\\hello.ts', kind: { type: 'add' }, diff: 'export const hi = 1;\nexport const yo = 2;\n' },
    {
      path: 'C:\\Users\\dev\\shop\\src\\orders.ts',
      kind: { type: 'update', move_path: null },
      diff: '@@ -1,2 +1,2 @@\n import { db } from "./db";\n-const n = 1;\n+const n = 2;\n',
    },
    { path: 'C:\\Users\\dev\\shop\\old.txt', kind: { type: 'delete' }, diff: 'gone\n' },
  ],
};

describe("codex's file changes", () => {
  it('reads the v2 change set: path, kind and body', () => {
    const c = codexChangesOf(ITEM);
    expect(c.map((x) => [x.kind, x.movePath])).toEqual([
      ['add', null],
      ['update', null],
      ['delete', null],
    ]);
    expect(c[0].diff).toBe('export const hi = 1;\nexport const yo = 2;\n');
    /* And the legacy FileChange map (ApplyPatchApprovalParams.fileChanges). */
    const legacy = codexChangesOf({ fileChanges: { '/r/a.ts': { type: 'add', content: 'x\n' }, '/r/b.ts': { type: 'update', unified_diff: '@@ -1 +1 @@\n-a\n+b\n', move_path: '/r/c.ts' } } });
    expect(legacy).toEqual([
      { path: '/r/a.ts', kind: 'add', diff: 'x\n', movePath: null },
      { path: '/r/b.ts', kind: 'update', diff: '@@ -1 +1 @@\n-a\n+b\n', movePath: '/r/c.ts' },
    ]);
    expect(codexChangesOf({ type: 'commandExecution', command: 'ls' })).toEqual([]);
  });

  it('an added file is an add-only diff, named relative to the repo root', () => {
    const [add] = codexChangesOf(ITEM);
    const diff = unifiedDiffFor(add, ROOT);
    const [file] = parseUnifiedDiff(diff);
    expect(file.path).toBe('src/hello.ts');
    expect(file.change).toBe('added');
    expect(file.added).toBe(2);
    expect(file.removed).toBe(0);
    expect(file.hunks[0].lines.map((l) => [l.kind, l.text])).toEqual([
      ['add', 'export const hi = 1;'],
      ['add', 'export const yo = 2;'],
    ]);
  });

  it('an update keeps codex\'s hunks under headers; a delete is remove-only', () => {
    const [, upd, del] = codexChangesOf(ITEM);
    const [u] = parseUnifiedDiff(unifiedDiffFor(upd, ROOT));
    expect(u.path).toBe('src/orders.ts');
    expect(u.hunks[0].lines.map((l) => l.kind)).toEqual(['context', 'del', 'add']);
    const [d] = parseUnifiedDiff(unifiedDiffFor(del, ROOT));
    expect(d.change).toBe('deleted');
    expect(d.removed).toBe(1);
    /* A move names the destination. */
    const moved = unifiedDiffFor({ ...upd, movePath: 'C:\\Users\\dev\\shop\\src\\sales.ts' }, ROOT);
    expect(moved.split('\n').slice(0, 2)).toEqual(['--- a/src/orders.ts', '+++ b/src/sales.ts']);
  });

  it('a body already written as +lines is not double-signed', () => {
    const diff = unifiedDiffFor({ path: '/repo/hello.txt', kind: 'add', diff: '+hello\n', movePath: null }, '/repo');
    expect(diff).toBe('--- /dev/null\n+++ b/hello.txt\n@@ -0,0 +1,1 @@\n+hello\n');
  });

  it('relative paths: case-blind on Windows, untouched outside the root', () => {
    expect(relativePath('c:\\users\\DEV\\shop\\a\\b.ts', ROOT)).toBe('a/b.ts');
    expect(relativePath('/repo/a.ts', '/repo/')).toBe('a.ts');
    expect(relativePath('/repository/a.ts', '/repo')).toBe('/repository/a.ts');
    expect(relativePath('D:\\other\\a.ts', ROOT)).toBe('D:/other/a.ts');
    expect(relativePath('/repo/a.ts', null)).toBe('/repo/a.ts');
    expect(relativeIn('Edit C:\\Users\\dev\\shop\\src\\hello.ts, C:\\Users\\dev\\shop\\b.ts', ROOT)).toBe('Edit src/hello.ts, b.ts');
  });

  it("an approval's files: kind from the tool call when known, inferred when not", () => {
    const changes = codexChangesOf(ITEM);
    /* The server's proposal keeps path + diff and drops kind. */
    const files = approvalFilesFor(
      [
        { path: ITEM.changes[0].path, diff: ITEM.changes[0].diff },
        { path: ITEM.changes[1].path, diff: ITEM.changes[1].diff },
      ],
      changes,
      ROOT,
    );
    expect(files.map((f) => f.path)).toEqual(['src/hello.ts', 'src/orders.ts']);
    expect(parseUnifiedDiff(files[0].diff!)[0].change).toBe('added');
    expect(parseUnifiedDiff(files[1].diff!)[0].hunks[0].lines.map((l) => l.kind)).toEqual(['context', 'del', 'add']);
    /* No tool call seen: hunks mean update, plain text means a new file. */
    const inferred = approvalFilesFor([{ path: '/r/x.ts', diff: 'plain\n' }, { path: '/r/y.ts', diff: null }], [], '/r');
    expect(inferred).toEqual([
      { path: 'x.ts', diff: '--- /dev/null\n+++ b/x.ts\n@@ -0,0 +1,1 @@\n+plain\n' },
      { path: 'y.ts', diff: null },
    ]);
    expect(inferKind('@@ -1 +1 @@\n-a\n+b')).toBe('update');
    /* The server's kind beats the guess: a delete's body has no hunks and
       would otherwise read as a new file. */
    const told = approvalFilesFor([{ path: '/r/gone.ts', diff: 'old\n', kind: 'delete' }], [], '/r');
    expect(parseUnifiedDiff(told[0].diff!)[0].change).toBe('deleted');
  });

  it('an ACP diff block (old text, new text) is one whole-file hunk', () => {
    const [f] = parseUnifiedDiff(replacementDiff('/r/a.ts', 'a\nb\n', 'a\nc\n', '/r'));
    expect(f.path).toBe('a.ts');
    expect([f.added, f.removed]).toEqual([2, 2]);
  });
});
