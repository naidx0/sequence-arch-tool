import { describe, expect, it } from 'vitest';

import {
  DIFF_LINE_CAP,
  FILE_ROW_CAP,
  asFileStatus,
  buildFileTree,
  diffSummary,
  filterFileTree,
  flattenFileTree,
  pathToReveal,
  planDiff,
  statusLetter,
  toRepoPath,
  treeKeyAction,
} from './filesModel';
import type { FileStatus, FileTreeDir, FileTreeNode } from './filesModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL'S PURE MODEL — item 2.1
   packages/web2/src/files/filesModel.test.ts

   FIXTURE SCALE PROVES LOGIC. Every tree below is three to a dozen paths,
   because a rule — "a single-child chain collapses", "a revealed ancestor is
   not a hit" — is provable at that scale and a result is not. CLAUDE.md states
   the split in one line: "Fixture scale proves logic; only a REAL repo proves
   the result." The two places that would only show up at real scale, the row
   cap and the diff cap, are therefore asserted against generated input large
   enough to trip them rather than against a hand-written fixture.

   PATHS ARE WRITTEN WITH BACKSLASHES IN ONE TEST ON PURPOSE. That is not a
   Windows accident: it is what the engine actually sends off the scan —
   `"path":"packages\\acp\\src\\client.ts"` straight off /archgraph.json on this
   machine — while `state/types.ts` declares a repo path as forward-slashed. A
   suite that only ever fed this module POSIX paths would pass while the panel
   drew one row per repository named `packages\acp\src\client.ts`.
   ══════════════════════════════════════════════════════════════════════════ */

const B = String.fromCharCode(92);

/** `packages/acp/src/client.ts` → the native form the scanner emits. */
function native(path: string): string {
  return path.split('/').join(B);
}

function dir(node: FileTreeNode | undefined): FileTreeDir {
  if (!node || node.kind !== 'dir') throw new Error(`expected a directory, got ${node?.kind}`);
  return node;
}

function labels(nodes: FileTreeNode[]): string[] {
  return nodes.map((n) => n.label);
}

describe('building the tree', () => {
  it('nests files under the directories that hold them', () => {
    const tree = buildFileTree(['src/a.ts', 'src/b.ts', 'README.md']);

    expect(labels(tree)).toEqual(['src', 'README.md']);
    expect(labels(dir(tree[0]).children)).toEqual(['a.ts', 'b.ts']);
  });

  it('SORTS DIRECTORIES BEFORE FILES, then by name', () => {
    /* Not taste. A mixed sort puts zod.ts above the src/ the reader is heading
       for, and every IDE the reader has used sorts this way — so any other
       order costs them a scan of the whole list on every glance. */
    const tree = buildFileTree(['zod.ts', 'alpha.ts', 'tools/x.ts', 'apps/y.ts']);
    expect(labels(tree)).toEqual(['apps', 'tools', 'alpha.ts', 'zod.ts']);
  });

  it('COLLAPSES A SINGLE-CHILD DIRECTORY CHAIN INTO ONE ROW', () => {
    /* The headline rule. Four directories with one child each are four rows of
       which three carry no information and cost four indent steps — on this
       monorepo the reader would spend their whole indent budget before reaching
       a file. */
    const tree = buildFileTree(['packages/web2/src/files/FileTree.tsx']);

    expect(tree).toHaveLength(1);
    const only = dir(tree[0]);
    expect(only.label).toBe('packages/web2/src/files');
    /* The PATH is the deepest directory in the chain, because that is the one
       whose children are listed under the row. The shallow end would make the
       expansion key name a directory this tree never drew. */
    expect(only.path).toBe('packages/web2/src/files');
    expect(labels(only.children)).toEqual(['FileTree.tsx']);
  });

  it('stops collapsing at the first directory with two children', () => {
    const tree = buildFileTree(['a/b/c/one.ts', 'a/b/d/two.ts']);

    const ab = dir(tree[0]);
    expect(ab.label).toBe('a/b');
    expect(labels(ab.children)).toEqual(['c', 'd']);
  });

  it('NEVER FOLDS A FILE INTO ITS PARENT LABEL', () => {
    /* A directory with exactly one child that is a FILE does not collapse.
       Folding it would hide the one row the reader came for behind a name that
       looks like a folder, and the chevron beside it would open onto nothing
       new. */
    const tree = buildFileTree(['docs/vision.md']);

    const docs = dir(tree[0]);
    expect(docs.label).toBe('docs');
    expect(labels(docs.children)).toEqual(['vision.md']);
  });

  it('normalises native separators, so the scan and the tree agree', () => {
    const tree = buildFileTree([native('packages/acp/src/client.ts')]);

    const chain = dir(tree[0]);
    expect(chain.label).toBe('packages/acp/src');
    expect(chain.children[0]!.path).toBe('packages/acp/src/client.ts');
    expect(chain.children[0]!.path.includes(B)).toBe(false);
  });

  it('dedupes, and survives the junk two real lists concatenate into', () => {
    /* The wiring lane concatenates the scan's file nodes with the git status
       list, so a duplicate is the NORMAL case rather than a defensive one. An
       empty string, a ./ prefix and a trailing slash all arrive from real
       callers too, and each would otherwise be a second row for one file or a
       directory with no name. */
    const tree = buildFileTree(['src/a.ts', 'src/a.ts', './src/a.ts', '', 'src/', '/src/b.ts']);

    const src = dir(tree[0]);
    expect(labels(src.children)).toEqual(['a.ts', 'b.ts']);
    expect(tree).toHaveLength(1);
  });

  it('counts the files under every directory', () => {
    const tree = buildFileTree(['a/b/one.ts', 'a/c/two.ts', 'a/c/three.ts']);
    expect(dir(tree[0]).fileCount).toBe(3);
  });

  it('is total on nothing at all, and never throws on junk', () => {
    expect(buildFileTree([])).toEqual([]);
    expect(buildFileTree([''])).toEqual([]);
    /* A DIRECTORY PATH IS DROPPED RATHER THAN DRAWN AS A FILE. The trailing
       slash is the one unambiguous signal in this input; using it is what stops
       `src/` becoming a file called `src` sitting beside the directory `src`. */
    expect(buildFileTree(['src/', 'src/a.ts'])).toHaveLength(1);
    expect(labels(buildFileTree(['src/', 'src/a.ts']))).toEqual(['src']);
  });
});

describe('the filter — sheet 11.5, counting hits and not scaffolding', () => {
  const tree = buildFileTree([
    'packages/analyzer/src/auth.ts',
    'packages/analyzer/src/scan.ts',
    'packages/web2/src/chat/send.ts',
  ]);

  it('A DIRECTORY REVEALED ONLY TO EXPOSE A MATCH IS NOT ITSELF A MATCH', () => {
    /* The rule, verbatim from the sheet, and the exact defect the rail records:
       counting the RENDERED rows instead of the matched ones reported "6
       matches" for two files, "and a count a reader can disprove by looking is
       worse than no count at all". One file matches `auth`; two directory rows
       are drawn to reach it; the count is 1. */
    const filtered = filterFileTree(tree, 'auth');

    expect(filtered.matches).toBe(1);
    const rows = flattenFileTree(filtered.nodes, { expanded: 'all' }).rows;
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.filter((r) => r.kind === 'file').map((r) => r.label)).toEqual(['auth.ts']);
  });

  it('null matches with no query is a different fact from zero', () => {
    expect(filterFileTree(tree, '').matches).toBeNull();
    expect(filterFileTree(tree, '   ').matches).toBeNull();
    expect(filterFileTree(tree, 'nothinghere').matches).toBe(0);
    expect(filterFileTree(tree, 'nothinghere').nodes).toEqual([]);
  });

  it('A ONE-WORD QUERY MATCHES A NAME AND NOT A PATH', () => {
    /* The direct fix for the "6 matches for two files" defect. If a file
       matched on its full path, `analyzer` would report one hit for the
       directory plus one for every file beneath it — the same thing counted N
       times. Exactly one row here is NAMED analyzer. */
    const filtered = filterFileTree(tree, 'analyzer');
    expect(filtered.matches).toBe(1);
  });

  it('a query carrying a separator is about a location, and matches the path', () => {
    const filtered = filterFileTree(tree, 'analyzer/src/s');
    expect(filtered.matches).toBe(1);
    const rows = flattenFileTree(filtered.nodes, { expanded: 'all' }).rows;
    expect(rows.some((r) => r.path === 'packages/analyzer/src/scan.ts')).toBe(true);
  });

  it('a matched directory keeps its subtree, and the subtree is not counted', () => {
    /* The second half of the rule, and it is not the same as the first. A
       folder that opens onto nothing is a dead row, so the subtree comes
       through — but the reader typed one thing and found one thing, and "3
       matches" beside two files they never asked for is a number they could
       disprove by reading it. */
    const filtered = filterFileTree(tree, 'chat');

    expect(filtered.matches).toBe(1);
    const rows = flattenFileTree(filtered.nodes, { expanded: 'all' }).rows;
    expect(rows.some((r) => r.label === 'send.ts')).toBe(true);
  });

  it('is case-insensitive in both directions', () => {
    expect(filterFileTree(tree, 'AUTH').matches).toBe(1);
    expect(filterFileTree(buildFileTree(['src/README.md']), 'readme').matches).toBe(1);
  });
});

describe('flattening — what the renderer and the keyboard both read', () => {
  const tree = buildFileTree(['src/a/one.ts', 'src/b.ts']);

  it('shows a collapsed directory and none of its children', () => {
    const { rows } = flattenFileTree(tree, { expanded: new Set() });
    expect(rows.map((r) => r.label)).toEqual(['src']);
    expect(rows[0]!.expanded).toBe(false);
  });

  it('opens exactly what is in the expanded set', () => {
    const { rows } = flattenFileTree(tree, { expanded: new Set(['src']) });
    expect(rows.map((r) => r.label)).toEqual(['src', 'a', 'b.ts']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
  });

  it('marks a changed file, and a directory that holds one', () => {
    const status = new Map<string, FileStatus>([['src/a/one.ts', 'modified']]);
    const { rows } = flattenFileTree(tree, { expanded: 'all', status });

    const byPath = new Map(rows.map((r) => [r.path, r]));
    expect(byPath.get('src/a/one.ts')!.status).toBe('modified');
    expect(byPath.get('src/a')!.dirty).toBe(true);
    expect(byPath.get('src')!.dirty).toBe(true);
    /* A DIRECTORY NEVER CARRIES A STATUS OF ITS OWN. Rolling its children's
       statuses into one letter would have to pick a winner, and any pick is a
       claim the panel cannot support. */
    expect(byPath.get('src')!.status).toBeNull();
    expect(byPath.get('src/b.ts')!.dirty).toBe(false);
  });

  it('CAPS, AND SAYS HOW MANY IT WITHHELD', () => {
    /* The rail's measured stall, one surface over: typing one character matched
       thousands of rows and mounted a DOM node for each. A list that quietly
       stops at the cap tells the reader their repository ends there, and that
       is the one number they cannot check by looking. */
    const many = buildFileTree(
      Array.from({ length: FILE_ROW_CAP + 40 }, (_, i) => `pkg/file-${i}.ts`),
    );
    const { rows, omitted } = flattenFileTree(many, { expanded: 'all' });

    expect(rows).toHaveLength(FILE_ROW_CAP);
    /* +1 for the `pkg` directory row itself. */
    expect(omitted).toBe(41);
  });

  it('reveals the directories on the way to a path, by their real keys', () => {
    /* The chat says "look at this file" and the tree must open to it. Splitting
       the string would produce `packages` and `packages/web2`, of which only
       the collapsed row exists. */
    const chained = buildFileTree(['packages/web2/src/files/x.ts', 'packages/web2/src/rail/y.ts']);
    expect(pathToReveal(chained, 'packages/web2/src/files/x.ts')).toEqual([
      'packages/web2/src',
      'packages/web2/src/files',
    ]);
    expect(pathToReveal(chained, 'nope.ts')).toEqual([]);
  });
});

describe('the keyboard', () => {
  const tree = buildFileTree(['src/a/one.ts', 'src/b.ts']);
  const open = flattenFileTree(tree, { expanded: new Set(['src']) }).rows;
  const shut = flattenFileTree(tree, { expanded: new Set() }).rows;

  it('moves down and up the VISIBLE rows only', () => {
    expect(treeKeyAction(open, 'src', 'ArrowDown')).toEqual({ kind: 'select', path: 'src/a' });
    expect(treeKeyAction(open, 'src/a', 'ArrowUp')).toEqual({ kind: 'select', path: 'src' });
    /* `src/a/one.ts` is not a row here — its directory is closed — so Down from
       the last visible row is nothing at all, and NOT a jump into a subtree the
       reader cannot see. */
    expect(treeKeyAction(open, 'src/b.ts', 'ArrowDown')).toBeNull();
  });

  it('right opens a closed directory, then steps into an open one', () => {
    expect(treeKeyAction(shut, 'src', 'ArrowRight')).toEqual({ kind: 'expand', path: 'src' });
    expect(treeKeyAction(open, 'src', 'ArrowRight')).toEqual({ kind: 'select', path: 'src/a' });
    /* There is nothing to the right of a leaf, and doing nothing is the correct
       answer rather than a gap. */
    expect(treeKeyAction(open, 'src/b.ts', 'ArrowRight')).toBeNull();
  });

  it('left closes an open directory, then climbs to the PARENT', () => {
    expect(treeKeyAction(open, 'src', 'ArrowLeft')).toEqual({ kind: 'collapse', path: 'src' });
    /* Read off the flat list and not off the path string: a collapsed chain's
       parent is not `path.slice(0, lastIndexOf('/'))` — that names a directory
       this tree deliberately never drew. */
    expect(treeKeyAction(open, 'src/b.ts', 'ArrowLeft')).toEqual({ kind: 'select', path: 'src' });
    expect(treeKeyAction(open, 'src', 'ArrowLeft')).not.toBeNull();
  });

  it('climbs out of a collapsed chain to the row that actually exists', () => {
    const chained = buildFileTree(['packages/web2/src/files/x.ts']);
    const rows = flattenFileTree(chained, { expanded: 'all' }).rows;
    expect(treeKeyAction(rows, 'packages/web2/src/files/x.ts', 'ArrowLeft')).toEqual({
      kind: 'select',
      path: 'packages/web2/src/files',
    });
  });

  it('Enter opens a file and toggles a directory', () => {
    expect(treeKeyAction(open, 'src/b.ts', 'Enter')).toEqual({ kind: 'open', path: 'src/b.ts' });
    expect(treeKeyAction(open, 'src', 'Enter')).toEqual({ kind: 'collapse', path: 'src' });
    expect(treeKeyAction(shut, 'src', 'Enter')).toEqual({ kind: 'expand', path: 'src' });
  });

  it('Home and End reach the ends; an empty tree answers nothing', () => {
    expect(treeKeyAction(open, 'src/b.ts', 'Home')).toEqual({ kind: 'select', path: 'src' });
    expect(treeKeyAction(open, 'src', 'End')).toEqual({ kind: 'select', path: 'src/b.ts' });
    expect(treeKeyAction([], null, 'ArrowDown')).toBeNull();
  });

  it('with nothing selected, an arrow lands on the first row', () => {
    expect(treeKeyAction(open, null, 'ArrowDown')).toEqual({ kind: 'select', path: 'src' });
    expect(treeKeyAction(open, null, 'ArrowUp')).toEqual({ kind: 'select', path: 'src' });
    expect(treeKeyAction(open, null, 'Enter')).toBeNull();
  });
});

describe('statuses', () => {
  it('maps the server words, and refuses to print one it does not know', () => {
    expect(asFileStatus('modified')).toBe('modified');
    expect(asFileStatus('MODIFIED')).toBe('modified');
    /* A word this build has never seen must arrive as `unknown` and draw a
       quiet mark — never as a raw porcelain letter the reader has to decode. */
    expect(asFileStatus('typechange')).toBe('unknown');
    expect(asFileStatus(undefined)).toBe('unknown');
  });

  it('gives every status a letter, and none of them a colour', () => {
    const all: FileStatus[] = [
      'added',
      'modified',
      'deleted',
      'renamed',
      'copied',
      'untracked',
      'conflicted',
      'unknown',
    ];
    for (const status of all) expect(statusLetter(status).length).toBe(1);
    expect(new Set(all.map(statusLetter)).size).toBe(all.length);
  });
});

describe('planning a diff', () => {
  const REAL = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,4 @@ export function a() {',
    ' const one = 1;',
    '-const two = 2;',
    '+const two = 22;',
    '+const three = 3;',
    ' return one;',
    '',
  ].join('\n');

  it('reads the real thing: hunks, numbers on both sides, and the arithmetic', () => {
    const plan = planDiff(REAL);

    expect(plan.state).toBe('ready');
    expect(plan.totals).toEqual({ files: 1, added: 2, removed: 1, binary: 0 });
    const lines = plan.files[0]!.hunks[0]!.lines;
    expect(lines.map((l) => l.kind)).toEqual(['context', 'del', 'add', 'add', 'context']);
    /* A REMOVED LINE HAS NO NEW NUMBER. It occupies no line in the file
       anything will edit next, and numbering it sends a reader — or an agent
       the reader steers — at the wrong line, silently. */
    expect(lines[1]!.newLine).toBeNull();
    expect(lines[2]!.oldLine).toBeNull();
    expect(plan.files[0]!.hunks[0]!.section).toBe('export function a() {');
  });

  it('EMPTY, BINARY AND UNREADABLE ARE THREE DIFFERENT FACTS', () => {
    /* Collapsing any two of them is how one blank panel comes to mean four
       unrelated things — and the worst is the one where the reader believes
       they reviewed a change they never saw. */
    expect(planDiff('').state).toBe('empty');
    expect(planDiff('   \n  ').state).toBe('empty');
    expect(
      planDiff(
        [
          'diff --git a/logo.png b/logo.png',
          'Binary files a/logo.png and b/logo.png differ',
        ].join('\n'),
      ).state,
    ).toBe('binary');
    expect(planDiff('this is not a diff at all').state).toBe('unreadable');
  });

  it('a binary file still names itself and still counts as a file', () => {
    const plan = planDiff(
      ['diff --git a/logo.png b/logo.png', 'Binary files a/logo.png and b/logo.png differ'].join(
        '\n',
      ),
    );
    expect(plan.files[0]!.path).toBe('logo.png');
    expect(plan.files[0]!.binary).toBe(true);
    expect(plan.totals.binary).toBe(1);
  });

  it('CAPS A HUGE DIFF, AND EVERY SURVIVING LINE NUMBER IS STILL REAL', () => {
    /* A unified diff is machine-generated and unbounded; one DOM row per line
       over a regenerated lockfile is the rail's measured stall arriving through
       a different door. The cut is a slice off the TAIL, which is the only safe
       one: every line's numbers come from its hunk's own header, so dropping
       the last N leaves every survivor correct. */
    const size = DIFF_LINE_CAP + 500;
    const body = Array.from({ length: size }, (_, i) => `+line ${i}`);
    const huge = [
      'diff --git a/big.txt b/big.txt',
      '--- a/big.txt',
      '+++ b/big.txt',
      `@@ -0,0 +1,${size} @@`,
      ...body,
      '',
    ].join('\n');

    const plan = planDiff(huge);

    expect(plan.shown).toBe(DIFF_LINE_CAP);
    expect(plan.omitted).toBe(500);
    /* The ARITHMETIC is of the whole diff, not of the part that was drawn: the
       reader must be told the size of the change, not the size of the excerpt. */
    expect(plan.totals.added).toBe(size);

    const lines = plan.files[0]!.hunks[0]!.lines;
    expect(lines).toHaveLength(DIFF_LINE_CAP);
    expect(lines[0]!.newLine).toBe(1);
    expect(lines[DIFF_LINE_CAP - 1]!.newLine).toBe(DIFF_LINE_CAP);
  });

  it('a raised cap draws more of the same diff', () => {
    const size = 40;
    const huge = [
      'diff --git a/big.txt b/big.txt',
      '--- a/big.txt',
      '+++ b/big.txt',
      `@@ -0,0 +1,${size} @@`,
      ...Array.from({ length: size }, (_, i) => `+line ${i}`),
      '',
    ].join('\n');

    expect(planDiff(huge, 10).omitted).toBe(30);
    expect(planDiff(huge, 100).omitted).toBe(0);
  });

  it('keeps a file the cap emptied, because its name and its count still act', () => {
    const two = [
      'diff --git a/one.ts b/one.ts',
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/two.ts b/two.ts',
      '--- a/two.ts',
      '+++ b/two.ts',
      '@@ -0,0 +1,2 @@',
      '+c',
      '+d',
      '',
    ].join('\n');

    const plan = planDiff(two, 2);
    expect(plan.files.map((f) => f.path)).toEqual(['one.ts', 'two.ts']);
    expect(plan.files[1]!.hunks).toEqual([]);
    expect(plan.omitted).toBe(2);
  });

  it('says the size in one sentence, in every shape it takes', () => {
    expect(diffSummary({ files: 0, added: 0, removed: 0, binary: 0 })).toBe('no changes');
    expect(diffSummary({ files: 1, added: 2, removed: 1, binary: 0 })).toBe('1 file · +2 −1');
    expect(diffSummary({ files: 3, added: 0, removed: 0, binary: 1 })).toBe('3 files · binary');
    /* "1 files" is the shape of a sentence nobody read before shipping it, and a
       reader who notices it stops trusting the number beside it. */
    expect(diffSummary({ files: 1, added: 0, removed: 0, binary: 0 })).toBe('1 file');
  });
});

describe('toRepoPath', () => {
  it('is total, because a String(undefined) beside real filenames is the defect', () => {
    expect(toRepoPath(native('a/b/c.ts'))).toBe('a/b/c.ts');
    expect(toRepoPath(null)).toBe('');
    expect(toRepoPath(undefined)).toBe('');
  });
});
