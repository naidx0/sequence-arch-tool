/*
 * A FILE NAMED IN AN ANSWER, AS SOMETHING THE FILES SURFACE CAN OPEN.
 *
 * Owner: "right now the links to files don't really work, you can't follow that
 * path". The model writes `packages/web2/src/main.tsx:12`, [main](packages/...),
 * or an absolute path. PURE: text in, `{ path, line }` out. TOTAL: runs during
 * render, so a malformed escape or an odd string answers null and never throws.
 */

export interface RepoPathRef {
  /** Repo-relative, forward slashes, or the absolute path when it is not under `root`. */
  path: string;
  /** 1-based line from a `:12`, `:12:3` or `#L12` suffix. */
  line?: number;
}

const EXT = 'tsx?|jsx?|mjs|cjs|json|md|mdx|css|scss|html|py|rs|go|java|kt|c|h|cpp|hpp|cs|rb|php|sh|ps1|ya?ml|toml|sql|txt|svg|vue|svelte|lock|env|csv|xml|seqd';
const SUFFIX = String.raw`(?::(\d{1,6})(?::\d{1,4})?|#L(\d{1,6}))?`;

/**
 * A path-shaped token inside plain prose: a Windows drive path (either slash)
 * or at least one slash, a known extension, optional :line. No spaces in prose.
 */
export const PATH_IN_TEXT = new RegExp(
  String.raw`(?<![\w/\\:.@~-])((?:[A-Za-z]:[\\/](?:[\w.@-]+[\\/])*[\w.@-]+|(?:\.{1,2}/)?(?:[\w.@-]+/)+[\w.@-]+)\.(?:${EXT}))${SUFFIX}(?![\w/\\])`,
  'g',
);

/** A whole code span or link target: spaces and %20 allowed, either slash, drive letter allowed. */
const ONLY_PATH = new RegExp(String.raw`^((?:[A-Za-z]:[\\/]|\.{1,2}[\\/])?(?:[\w.@ %+()-]+[\\/])*[\w.@ %+()-]+\.(?:${EXT}))${SUFFIX}$`);

const norm = (p: string): string => p.replace(/\\/g, '/');

/** `www.example.com/a/b.js` and `github.com/x/y.md` are web addresses, not files. */
export function looksLikeHost(path: string): boolean {
  const first = norm(path).split('/')[0] ?? '';
  return /^www\./i.test(first) || /^[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|app|co|ai|edu|gov|me|xyz|info|uk|de)$/i.test(first);
}

/** decodeURIComponent that answers the input when the escape is malformed. */
function safeDecode(s: string): string {
  if (!s.includes('%')) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Strip the repo root off an absolute path, so the Files tree (repo-relative) can find it. */
export function relativeTo(abs: string, root: string | null | undefined): string {
  const a = norm(abs).replace(/^\.\//, '');
  if (!root) return a;
  const r = norm(root).replace(/\/+$/, '');
  if (a.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return a.slice(r.length + 1);
  return a;
}

const lineOf = (m: RegExpExecArray): { line?: number } => {
  const raw = m[2] ?? m[3];
  return raw && Number(raw) > 0 ? { line: Number(raw) } : {};
};

/** A markdown link target that points at a file on disk (absolute, file: or repo-relative), else null. */
export function refFromLink(target: string, root?: string | null): RepoPathRef | null {
  try {
    let t = target.trim();
    if (/^https?:\/\//i.test(t) || /^mailto:/i.test(t) || t.startsWith('#')) return null;
    if (t.startsWith('file:')) t = t.replace(/^file:\/*/, /^file:\/\/\/[A-Za-z]:/.test(t) ? '' : '/');
    t = safeDecode(t);
    const m = ONLY_PATH.exec(t);
    const abs = /^[A-Za-z]:[\\/]/.test(t) || t.startsWith('/');
    if (m) {
      if (looksLikeHost(m[1]!)) return null;
      return { path: relativeTo(m[1]!, root), ...lineOf(m) };
    }
    if (!abs) return null;
    /* An absolute target with an extension the list does not know: still a file on this machine. */
    const loose = /^(.*?)(?::(\d{1,6})(?::\d{1,4})?|#L(\d{1,6}))?$/.exec(t);
    if (!loose) return null;
    const n = Number(loose[2] ?? loose[3]);
    return { path: relativeTo(loose[1]!, root), ...(n > 0 ? { line: n } : {}) };
  } catch {
    return null;
  }
}

/** Inline code that is nothing but a path (with optional :line). */
export function refFromCode(text: string, root?: string | null): RepoPathRef | null {
  try {
    const t = text.trim();
    const m = ONLY_PATH.exec(t);
    if (!m || !/[\\/]/.test(t) || looksLikeHost(m[1]!)) return null;
    return { path: relativeTo(m[1]!, root), ...lineOf(m) };
  } catch {
    return null;
  }
}

/** A match of PATH_IN_TEXT as a ref (host-looking and malformed matches are null). */
export function refFromProse(path: string, line: string | undefined, root?: string | null): RepoPathRef | null {
  if (looksLikeHost(path)) return null;
  const n = line ? Number(line) : 0;
  return { path: relativeTo(path, root), ...(n > 0 ? { line: n } : {}) };
}
