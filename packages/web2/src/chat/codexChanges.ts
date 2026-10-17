/* ══════════════════════════════════════════════════════════════════════════
   CODEX'S FILE CHANGES, AS A DIFF A PERSON CAN READ
   packages/web2/src/chat/codexChanges.ts

   `packages/acp/src/codexAppServer.ts` hands codex's fileChange item through
   as the tool call's `rawInput`. Its `changes` are, per `codex app-server
   generate-ts` on codex-cli 0.153.4 (v2/FileUpdateChange.ts):

     { path: string, kind: { type: 'add' } | { type: 'delete' }
                         | { type: 'update', move_path: string | null },
       diff: string }

   `diff` means three different things by kind: the whole new file for `add`,
   the whole old file for `delete`, and a unified diff (hunks, no `---`/`+++`
   headers) for `update`. The legacy shape (FileChange.ts: `{ type: 'add',
   content }` / `{ type: 'update', unified_diff, move_path }`) is read too.

   `path` is ABSOLUTE. Everything shown is relative to the repository root.

   The server's approval proposal keeps `path` and `diff` but drops `kind`, so
   the kind comes from the matching tool call when there is one, and is
   inferred from the text when there is not: hunks mean an update, anything
   else is a new file's content.
   ══════════════════════════════════════════════════════════════════════════ */

export type CodexChangeKind = 'add' | 'delete' | 'update';

export interface CodexChange {
  path: string;
  kind: CodexChangeKind;
  /** File content for add/delete, unified hunks for update. */
  diff: string;
  movePath: string | null;
}

const KINDS: readonly string[] = ['add', 'delete', 'update'];

function kindOf(raw: unknown): { kind: CodexChangeKind; movePath: string | null } | null {
  if (typeof raw === 'string' && KINDS.includes(raw)) return { kind: raw as CodexChangeKind, movePath: null };
  if (raw && typeof raw === 'object') {
    const k = raw as { type?: unknown; move_path?: unknown };
    if (typeof k.type === 'string' && KINDS.includes(k.type)) {
      return { kind: k.type as CodexChangeKind, movePath: typeof k.move_path === 'string' ? k.move_path : null };
    }
  }
  return null;
}

function changeOf(path: string, c: Record<string, unknown>): CodexChange | null {
  const v2 = kindOf(c.kind);
  if (v2) return { path, kind: v2.kind, diff: typeof c.diff === 'string' ? c.diff : '', movePath: v2.movePath };
  /* Legacy FileChange: the kind is `type`, the body is `content` or `unified_diff`. */
  const legacy = kindOf(c.type);
  if (legacy) {
    const body = typeof c.unified_diff === 'string' ? c.unified_diff : typeof c.content === 'string' ? c.content : '';
    return { path, kind: legacy.kind, diff: body, movePath: typeof c.move_path === 'string' ? c.move_path : null };
  }
  if (typeof c.diff === 'string') return { path, kind: inferKind(c.diff), diff: c.diff, movePath: null };
  return null;
}

/** The changes a codex fileChange item carries, or [] for anything else. */
export function codexChangesOf(rawInput: unknown): CodexChange[] {
  if (!rawInput || typeof rawInput !== 'object') return [];
  const changes = (rawInput as { changes?: unknown; fileChanges?: unknown }).changes ?? (rawInput as { fileChanges?: unknown }).fileChanges;
  const out: CodexChange[] = [];
  if (Array.isArray(changes)) {
    for (const c of changes) {
      if (!c || typeof c !== 'object' || typeof (c as { path?: unknown }).path !== 'string') continue;
      const one = changeOf((c as { path: string }).path, c as Record<string, unknown>);
      if (one) out.push(one);
    }
  } else if (changes && typeof changes === 'object') {
    /* ApplyPatchApprovalParams: `{ [path]: FileChange }`. */
    for (const [path, c] of Object.entries(changes as Record<string, unknown>)) {
      if (!c || typeof c !== 'object') continue;
      const one = changeOf(path, c as Record<string, unknown>);
      if (one) out.push(one);
    }
  }
  return out;
}

/** Hunk headers mean a unified diff; anything else is a file's content. */
export function inferKind(text: string): CodexChangeKind {
  return /^@@+ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(text) ? 'update' : 'add';
}

const slashes = (p: string): string => p.replace(/\\/g, '/');

/**
 * `path` relative to `root`, with forward slashes. A path outside the root, or
 * any path when the root is unknown, comes back as it was (slashes aside):
 * shortening it would claim a location it does not have.
 */
export function relativePath(path: string, root: string | null | undefined): string {
  const p = slashes(path);
  if (!root) return p;
  const r = slashes(root).replace(/\/+$/, '');
  if (r === '') return p;
  /* Windows paths compare without case: C:/Repo and c:/repo are one place. */
  const windows = /^[a-z]:\//i.test(r);
  const head = p.slice(0, r.length);
  const same = windows ? head.toLowerCase() === r.toLowerCase() : head === r;
  if (!same || (p.length > r.length && p[r.length] !== '/')) return p;
  return p.slice(r.length + 1) || p;
}

/** Every absolute path inside `root` in a sentence (a tool title), made relative. */
export function relativeIn(text: string, root: string | null | undefined): string {
  if (!root) return text;
  const r = slashes(root).replace(/\/+$/, '');
  if (r === '') return text;
  const variants = new Set([r, r.replace(/\//g, '\\')]);
  let out = text;
  for (const v of variants) {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`${esc}[\\\\/]([^\\s,;:'"]+)`, /^[a-z]:/i.test(v) ? 'gi' : 'g'), (_m, rest: string) => slashes(rest));
  }
  return out;
}

function bodyLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * The unified diff the edit approval card parses, for one change, named by its
 * repo-relative path. An add is an add-only hunk; a delete a remove-only one;
 * an update keeps codex's hunks under `---`/`+++` headers.
 */
export function unifiedDiffFor(change: CodexChange, root: string | null | undefined): string {
  const rel = relativePath(change.path, root);
  if (change.kind === 'update') {
    const text = change.diff.replace(/\r\n/g, '\n');
    if (/^--- /m.test(text) && /^\+\+\+ /m.test(text)) return text;
    const to = change.movePath ? relativePath(change.movePath, root) : rel;
    return `--- a/${rel}\n+++ b/${to}\n${text}${text.endsWith('\n') ? '' : '\n'}`;
  }
  let lines = bodyLines(change.diff);
  const sign = change.kind === 'add' ? '+' : '-';
  /* A body that is ALREADY sign-prefixed on every line (an add written as
     `+hello`) is a diff body, not content that starts with a plus. */
  if (lines.length > 0 && lines.every((l) => l.startsWith(sign))) lines = lines.map((l) => l.slice(1));
  const n = lines.length;
  const head =
    change.kind === 'add'
      ? `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${n} @@\n`
      : `--- a/${rel}\n+++ /dev/null\n@@ -1,${n} +0,0 @@\n`;
  return head + lines.map((l) => `${sign}${l}\n`).join('');
}

/**
 * An ACP `diff` block (old text, new text) as one whole-file hunk: every old
 * line removed, every new line added. That is all the block says: ACP carries
 * no hunks, and inventing a line-level diff here would be a second diff
 * algorithm nobody asked for.
 */
export function replacementDiff(path: string, oldText: string, newText: string, root: string | null | undefined): string {
  const rel = relativePath(path, root);
  const was = bodyLines(oldText);
  const now = bodyLines(newText);
  return (
    `--- a/${rel}\n+++ b/${rel}\n@@ -1,${was.length} +1,${now.length} @@\n` +
    was.map((l) => `-${l}\n`).join('') +
    now.map((l) => `+${l}\n`).join('')
  );
}

/**
 * An approval's files as the card should draw them: repo-relative paths, and
 * codex's change set turned into unified diffs. `changes` is the matching tool
 * call's change set when the stream carried one.
 */
export function approvalFilesFor(
  files: readonly { path: string; diff: string | null; kind?: string | null }[],
  changes: readonly CodexChange[],
  root: string | null | undefined,
): { path: string; diff: string | null }[] {
  return files.map((f) => {
    const known = changes.find((c) => slashes(c.path) === slashes(f.path));
    /* The tool call's change set first; then the kind the server passed on
       the proposal; only then a guess from the text. */
    const told = typeof f.kind === 'string' && KINDS.includes(f.kind) ? (f.kind as CodexChangeKind) : null;
    const change: CodexChange | null = known
      ? { ...known, diff: f.diff ?? known.diff }
      : f.diff !== null
        ? { path: f.path, kind: told ?? inferKind(f.diff), diff: f.diff, movePath: null }
        : null;
    return { path: relativePath(f.path, root), diff: change ? unifiedDiffFor(change, root) : null };
  });
}
