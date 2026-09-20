/* ══════════════════════════════════════════════════════════════════════════
   THE UNIFIED-DIFF PARSER — item 5.1
   packages/web2/src/review/diffModel.ts

   WHAT THIS REPLACES. v1's review surface is `FileEditProposalBar.tsx:24,40`:
   a list of bare filenames (`fileEditProposalModel.ts:96-98`) with one
   whole-set Accept and one Deny. No diff, no per-file control, no line
   comments. §5.1 P2 prices closing that gap at 6–8 days and calls it the
   largest par gap on the list. This file is its first line.

   WHY A PARSER AND NOT A LIBRARY. The input is not arbitrary: it is exactly
   what `gitWorkspace.ts:206-224` produces, which is `git diff --no-color HEAD
   -- <path>` with `--no-renames` already set on the status side. That is a
   narrow, specified, machine-generated dialect, and the four things that
   actually break a diff view on it — the omitted hunk count, the
   `\ No newline` marker, a quoted path, CRLF — are four rules, not a
   dependency. A parser small enough to read is also a parser whose line
   arithmetic can be checked by hand, and the line arithmetic is the whole
   reason this surface can be trusted: item 5.3 anchors a comment to a NUMBER,
   and a gutter one line off silently steers the agent at the wrong line.

   IT IS PURE AND IT IS TOTAL. No throw, on any input. A diff that cannot be
   understood comes back as a file with no hunks and `empty: true`, which the
   surface renders as a sentence — never as a blank expanded panel, and never
   as a fabricated hunk.
   ══════════════════════════════════════════════════════════════════════════ */

export type DiffLineKind = 'add' | 'del' | 'context';

export interface DiffLine {
  kind: DiffLineKind;
  /** 1-based line number in the OLD file, or null for an added line. */
  oldLine: number | null;
  /** 1-based line number in the NEW file, or null for a removed line. */
  newLine: number | null;
  /** The line WITHOUT its leading `+`, `-` or space, and without any `\r`. */
  text: string;
}

export interface DiffHunk {
  /** The raw `@@ … @@` line, kept so a header can be shown verbatim. */
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** git's own enclosing-context guess — the text after the second `@@`. */
  section: string;
  lines: DiffLine[];
}

export type DiffChangeKind = 'added' | 'deleted' | 'modified';

export interface DiffFileChange {
  /** Repo-relative destination path. This is the string a write targets. */
  path: string;
  /** The source path when there was one; null for a newly added file. */
  oldPath: string | null;
  change: DiffChangeKind;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  binary: boolean;
  /** True when nothing was understood: no hunks and not binary. */
  empty: boolean;
  /** git emitted `\ No newline at end of file` somewhere in this file. */
  noNewlineAtEof: boolean;
}

export interface DiffTotals {
  files: number;
  added: number;
  removed: number;
  binary: number;
}

/** A span of NEW-file lines a change touched. Both bounds inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

/* ── path handling ─────────────────────────────────────────────────────────
 *
 * MEASURED AGAINST REAL git 2.x RATHER THAN ASSUMED, because the first draft of
 * this file assumed the wrong shape twice. Run against a throwaway repository:
 *
 *   a path with a SPACE is NOT quoted — git emits
 *       `--- a/src/two words.ts<TAB>`
 *     and relies on the tab to terminate it;
 *   a path with a NON-ASCII byte IS quoted, WHOLE, PREFIX INCLUDED —
 *       `--- "a/src/caf\303\251.ts"`
 *     with each byte of the UTF-8 sequence as a three-digit octal escape.
 *
 * So the order below is forced: unquote FIRST, strip the `a/` / `b/` prefix
 * SECOND, because the prefix is inside the quotes.
 *
 * RENDERING THE QUOTES IS NOT A COSMETIC BUG: the string on screen would then
 * not be the string `PUT /api/file` must carry, so an accept targets a path
 * that does not exist — or creates a file whose name contains a literal quote.
 * And decoding `\303\251` one byte at a time through `fromCharCode` yields
 * `Ã©`, which is the same defect with a different spelling.
 * ───────────────────────────────────────────────────────────────────────── */

const C_ESCAPES: Record<string, number> = {
  n: 0x0a,
  t: 0x09,
  r: 0x0d,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  v: 0x0b,
  '"': 0x22,
  '\\': 0x5c,
};

const UTF8 = new TextDecoder('utf-8');
const ASCII = new TextEncoder();

function unquotePath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
  const body = raw.slice(1, -1);
  /* Bytes, not characters. The escapes are UTF-8 BYTES, so they have to be
     gathered and decoded as a sequence — decoding each one alone is how a
     two-byte character becomes two wrong ones. */
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') {
      for (const b of ASCII.encode(body[i])) bytes.push(b);
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8) & 0xff);
      i += 3;
      continue;
    }
    bytes.push(C_ESCAPES[next] ?? ASCII.encode(next)[0]);
    i += 1;
  }
  return UTF8.decode(Uint8Array.from(bytes));
}

/**
 * Read the path off a `---` / `+++` header.
 *
 * Three things are stripped, in this order: the tab-separated timestamp git
 * appends in some configurations, the surrounding quotes, and the `a/` or `b/`
 * prefix. `/dev/null` answers null — the marker for a file that did not exist
 * on that side, which is how "added" and "deleted" are told apart from
 * "modified" without reading the `new file mode` line that `--no-prefix` and
 * some porcelain wrappers omit.
 */
function headerPath(rest: string): string | null {
  const tab = rest.indexOf('\t');
  const raw = tab === -1 ? rest : rest.slice(0, tab);
  const unquoted = unquotePath(raw.trim());
  if (unquoted === '/dev/null') return null;
  if (unquoted.startsWith('a/') || unquoted.startsWith('b/')) return unquoted.slice(2);
  return unquoted;
}

/**
 * Read both paths off a `diff --git a/x b/x` line.
 *
 * The unquoted case is genuinely ambiguous when a path contains a space — but
 * git QUOTES in exactly that case, so the ambiguity is unreachable for real
 * git output. The length identity below (`a/` + p + ` b/` + p) resolves the
 * common same-path form exactly; the ` b/` fallback covers a rename, which
 * `--no-renames` means the status side never produces but a pasted diff might.
 */
function gitHeaderPaths(rest: string): { old: string | null; next: string | null } {
  if (rest.startsWith('"')) {
    const parts = rest.match(/"(?:\\.|[^"\\])*"/g) ?? [];
    return {
      old: parts[0] ? headerPath(parts[0]) : null,
      next: parts[1] ? headerPath(parts[1]) : null,
    };
  }
  const len = (rest.length - 5) / 2;
  if (Number.isInteger(len) && len > 0 && rest.startsWith('a/') && rest.slice(2 + len, 5 + len) === ' b/') {
    const p = rest.slice(2, 2 + len);
    if (p === rest.slice(5 + len)) return { old: p, next: p };
  }
  const marker = rest.lastIndexOf(' b/');
  if (marker === -1) return { old: null, next: null };
  return { old: headerPath(rest.slice(0, marker)), next: headerPath(rest.slice(marker + 1)) };
}

/* ── the parser ──────────────────────────────────────────────────────────── */

const HUNK = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@+ ?(.*)$/;

function blankFile(): DiffFileChange {
  return {
    path: '',
    oldPath: null,
    change: 'modified',
    hunks: [],
    added: 0,
    removed: 0,
    binary: false,
    empty: true,
    noNewlineAtEof: false,
  };
}

/**
 * Parse the unified diff `git diff` produced.
 *
 * Returns one entry per file, in the order git emitted them. An input with no
 * `diff --git`, no `---`/`+++` pair and no `@@` yields `[]` — GET /api/git/diff
 * documents an empty body for an untracked or unchanged file, and answering
 * with a file that has no change in it is v1's list-of-filenames wearing a coat.
 */
export function parseUnifiedDiff(text: string): DiffFileChange[] {
  if (text.trim() === '') return [];

  const files: DiffFileChange[] = [];
  /* CRLF is normalised ONCE, here. core.autocrlf=true in this repository and
     CANON §6 names "CRLF on read" as a mistake already made — a surviving \r
     paints as nothing and makes every rendered line one invisible character
     longer than the line it is being compared against. */
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let file: DiffFileChange | null = null;
  let hunk: DiffHunk | null = null;
  let oldCursor = 0;
  let newCursor = 0;
  /* THE HUNK CLOSES ON ITS OWN COUNTS, NOT ON THE NEXT HEADER.
     A unified hunk is exactly `oldCount` old-side lines and `newCount`
     new-side lines; when both are spent the hunk is over. Reading to the next
     `@@` instead looks equivalent and is not: `git diff` output ends with a
     newline, `split('\n')` therefore hands this loop a trailing '', and that
     empty string is indistinguishable from a context line whose content is
     empty. Without this counter the last hunk of every diff in the product
     grows one phantom line, every number below it is unaffected but the file
     is one line taller than the file, and a comment placed on that phantom
     anchors past the end. Closing on the declared counts makes it unreachable. */
  let oldLeft = 0;
  let newLeft = 0;

  const open = () => {
    const fresh = blankFile();
    files.push(fresh);
    file = fresh;
    hunk = null;
    return fresh;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const { old, next } = gitHeaderPaths(line.slice('diff --git '.length));
      const fresh = open();
      fresh.oldPath = old;
      fresh.path = next ?? old ?? '';
      continue;
    }

    if (line.startsWith('--- ')) {
      const current = file ?? open();
      const p = headerPath(line.slice(4));
      current.oldPath = p;
      if (p === null) current.change = 'added';
      if (current.path === '' && p !== null) current.path = p;
      hunk = null;
      continue;
    }

    if (line.startsWith('+++ ')) {
      const current = file ?? open();
      const p = headerPath(line.slice(4));
      if (p === null) current.change = 'deleted';
      else current.path = p;
      hunk = null;
      continue;
    }

    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      const current = file ?? open();
      current.binary = true;
      current.empty = false;
      hunk = null;
      continue;
    }

    const header = HUNK.exec(line);
    if (header) {
      const current = file ?? open();
      /* An omitted count is a count of one — git writes `@@ -1 +1 @@` whenever
         the hunk is a single line, and reading the absence as zero puts every
         line in the hunk one number out. */
      hunk = {
        header: line,
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        section: header[5] ?? '',
        lines: [],
      };
      oldCursor = hunk.oldStart;
      newCursor = hunk.newStart;
      oldLeft = hunk.oldCount;
      newLeft = hunk.newCount;
      current.hunks.push(hunk);
      current.empty = false;
      if (oldLeft === 0 && newLeft === 0) hunk = null;
      continue;
    }

    if (hunk === null || file === null) continue;
    /* Bound to a local because `open()` assigns `file` from inside a closure,
       which defeats TypeScript's control-flow narrowing on the outer `let` and
       leaves it typed `never` in every branch below. The guard above is the
       real check; this is the compiler's copy of it. */
    const current: DiffFileChange = file;

    /* THE MARKER, AND WHY IT IS NOT A CONTEXT LINE. `\ No newline at end of
       file` starts with a backslash and a space, and a parser that falls
       through to the ' ' branch counts it: both cursors advance, and every
       line below it in the hunk is numbered one too high. It is silent, and it
       only happens in files that lack a trailing newline. */
    if (line.startsWith('\\')) {
      current.noNewlineAtEof = true;
      continue;
    }

    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', oldLine: null, newLine: newCursor, text: line.slice(1) });
      newCursor += 1;
      newLeft -= 1;
      current.added += 1;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', oldLine: oldCursor, newLine: null, text: line.slice(1) });
      oldCursor += 1;
      oldLeft -= 1;
      current.removed += 1;
    } else if (line.startsWith(' ') || line === '') {
      /* An empty string inside an unspent hunk is a context line whose content
         is empty — some tools strip the trailing space from such a line. The
         counter above is what stops the trailing '' of the whole input from
         reaching here. */
      hunk.lines.push({ kind: 'context', oldLine: oldCursor, newLine: newCursor, text: line.slice(1) });
      oldCursor += 1;
      newCursor += 1;
      oldLeft -= 1;
      newLeft -= 1;
    } else {
      hunk = null;
      continue;
    }

    if (oldLeft <= 0 && newLeft <= 0) hunk = null;
  }

  return files.filter((f) => f.path !== '' || !f.empty);
}

/** The "n files changed, +a −b" arithmetic for the surface header. */
export function diffTotals(files: DiffFileChange[]): DiffTotals {
  let added = 0;
  let removed = 0;
  let binary = 0;
  for (const f of files) {
    added += f.added;
    removed += f.removed;
    if (f.binary) binary += 1;
  }
  return { files: files.length, added, removed, binary };
}

/**
 * The NEW-file line spans a change touched — the bridge to the impact panel.
 *
 * A deletion contributes no new line, and returning nothing for it would make
 * "you deleted the body of handleAuth()" invisible to item 5.5, which is the
 * single loudest thing that panel should say. So a deletion anchors at the
 * new-file position the removed content used to occupy.
 *
 * Runs that touch, touch: a delete-then-add pair at the same position is one
 * span, not two. Binary files answer `[]` — there is no line to name and
 * inventing one would put a fabricated range in front of `computeImpact`.
 */
export function changedRanges(file: DiffFileChange): LineRange[] {
  if (file.binary) return [];
  const ranges: LineRange[] = [];

  const push = (line: number) => {
    const at = Math.max(1, line);
    const last = ranges[ranges.length - 1];
    if (last && at <= last.end + 1) {
      last.end = Math.max(last.end, at);
      return;
    }
    ranges.push({ start: at, end: at });
  };

  for (const hunk of file.hunks) {
    let newCursor = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.kind === 'context') {
        newCursor += 1;
        continue;
      }
      if (line.kind === 'add') {
        push(newCursor);
        newCursor += 1;
        continue;
      }
      push(newCursor);
    }
  }

  return ranges;
}

/**
 * When git returns no diff for a proposed path, render the proposal as an
 * all-added file — typical for paths that do not exist on disk yet.
 */
export function diffFromProposedContent(path: string, content: string): DiffFileChange {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n') && lines.at(-1) === '') lines.pop();
  const diffLines: DiffLine[] = lines.map((text, index) => ({
    kind: 'add',
    oldLine: null,
    newLine: index + 1,
    text,
  }));
  const count = lines.length;
  return {
    path,
    oldPath: null,
    change: 'added',
    hunks: [
      {
        header: `@@ -0,0 +1,${count} @@`,
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: count,
        section: '',
        lines: diffLines,
      },
    ],
    added: count,
    removed: 0,
    binary: false,
    empty: count === 0,
    noNewlineAtEof: count > 0 && !normalized.endsWith('\n'),
  };
}
