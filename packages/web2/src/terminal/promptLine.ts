/* ══════════════════════════════════════════════════════════════════════════
   THE PROMPT, CONDENSED TO ONE LINE (packages/web2/src/terminal/promptLine.ts)

   Owner, 2026-10-09: "desktop name should be hidden, the path should really be
   shown" and then "the dollar sign where you start typing is on a second line:
   condense much more, maximum about fifteen or sixteen characters, then the
   dollar sign, then you type on that line."

   Git Bash prints `user@HOST MINGW64 ~/path (branch)` and then `$ ` on the NEXT
   line. This turns the pair into `<short path> $ <what you type>` on ONE line:
   the machine, the user and the shell tag go, home is ~, the path is cut from the
   FRONT with an ellipsis to PROMPT_MAX characters (the last folder kept whole
   when it fits), and the branch is shown only when it all still fits. The full
   original line is the caller's tooltip. Pure: no DOM, no state.
   ══════════════════════════════════════════════════════════════════════════ */

export const ELLIPSIS = '…';

/** About sixteen characters of path, plus the two of the "…/" marker. */
export const PROMPT_MAX = 18;

const WORD = String.raw`[\p{L}\p{N}_.-]+`;
/* Git Bash / MSYS: `user@HOST MINGW64 <path>[ (branch)]`. A Windows user name may hold spaces and non-ASCII letters. */
const MSYS = new RegExp(String.raw`^(${WORD}(?: ${WORD})*)@(${WORD}) (?:MINGW\d+|MSYS|UCRT64|CLANG\d+|CLANGARM64|CYGWIN\d*) (\S.*)$`, 'u');
/* Linux and macOS bash: `user@host:<path>$ <typed>` on one line. */
const POSIX = new RegExp(String.raw`^(${WORD}(?: ${WORD})*)@(${WORD}):(\S[^$#]*?)[$#] ?(.*)$`, 'u');

export interface PromptParts {
  user: string;
  host: string;
  /** The path with home as ~, plus the branch suffix when there is one. */
  path: string;
  /** For a one-line prompt: what was typed after the marker. Undefined for the two-line Git Bash prompt. */
  rest?: string;
  /** For a one-line prompt: where `rest` starts in the original line. */
  restAt?: number;
}

/** Home as ~: the Windows forms (C:\Users\me, /c/Users/me), /home/me and /Users/me. */
export function tildeHome(path: string, user: string): string {
  const u = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return path.replace(new RegExp(`^(?:/[a-zA-Z]/Users/${u}|[a-zA-Z]:[\\\\/]Users[\\\\/]${u}|/home/${u}|/Users/${u})(?=[\\\\/]|\\s|$)`, 'iu'), '~');
}

/** The parts of a prompt line, or null for any other line of output. */
export function parsePromptLine(raw: string): PromptParts | null {
  /* A pty ends its lines with CR LF. */
  const line = raw.replace(/\r$/, '');
  const m = MSYS.exec(line);
  /* A cleared or redrawn screen pads the line with blanks: they are not part of the path, and ` (branch)` must still end the string. */
  if (m) return { user: m[1]!, host: m[2]!, path: tildeHome(m[3]!.trimEnd(), m[1]!) };
  const p = POSIX.exec(line);
  if (p) return { user: p[1]!, host: p[2]!, path: tildeHome(p[3]!, p[1]!), rest: p[4]!, restAt: line.length - p[4]!.length };
  return null;
}

/** The branch name inside ` (branch)`, parens stripped however many there are. A detached HEAD becomes its 7-char hash, or null when no hash shows. */
function branchOf(inner: string): string | null {
  const t = inner.trim().replace(/\.{3}$|…$/, '');
  const hash = /(?:^|[\s(])([0-9a-f]{7,40})$/i.exec(t);
  if (hash) return hash[1]!.slice(0, 7);
  if (/detached|^HEAD$/i.test(t)) return null;
  return t || null;
}

/** `path` cut from the front to at most `cols` characters. The path has priority: ` (branch)` shows only when the whole label fits. */
export function fitPath(path: string, cols: number): string {
  if (cols <= 0) return '';
  const b = /\s\(+([^()]*)\)+$/.exec(path);
  const dir = b ? path.slice(0, path.length - b[0].length) : path;
  if (b) {
    const name = branchOf(b[1]!);
    const whole = name ? `${dir} (${name})` : dir;
    if (whole.length <= cols) return whole;
  }
  if (dir.length <= cols) return dir;
  /* Whole trailing folders first: `…/seq-wt13-settings`. */
  const segs = dir.split('/');
  let kept = '';
  for (let i = segs.length - 1; i >= 0; i--) {
    const next = segs[i] + (kept ? '/' + kept : '');
    if (next.length + 2 > cols) break;
    kept = next;
  }
  if (kept) return ELLIPSIS + '/' + kept;
  /* Even the last folder is too long: keep its end. */
  return ELLIPSIS + dir.slice(-(cols - 1));
}

export interface CondensedPrompt {
  /** The one line to draw: `<short path> $ <typed>`. */
  text: string;
  /** The original prompt line, for the tooltip. */
  full: string;
  /** How many original lines it replaces: 2 for the Git Bash pair, 1 for a one-line prompt. */
  consumed: 1 | 2;
  /** Where an original cursor column on the line that holds the typed text lands in `text`. */
  cursorCol: (col: number) => number;
}

/**
 * Condense the prompt starting at `line`. `next` is the line after it: Git Bash's `$ ` line, joined on.
 * Returns null when `line` is not a prompt (or the pair is not `prompt line` then `$ ` line).
 */
export function condensePrompt(line: string, next: string | undefined, max = PROMPT_MAX): CondensedPrompt | null {
  const parts = parsePromptLine(line);
  if (!parts) return null;
  const label = fitPath(parts.path, max);
  const full = line.replace(/\r$/, '');
  if (parts.rest !== undefined) {
    const prefix = `${label} $ `;
    const at = parts.restAt ?? 0;
    return { text: prefix + parts.rest, full, consumed: 1, cursorCol: (col) => prefix.length + Math.max(0, col - at) };
  }
  if (next !== undefined && /^\$(?: |$)/.test(next)) {
    const prefix = `${label} `;
    return { text: prefix + next.replace(/\r$/, ''), full, consumed: 2, cursorCol: (col) => prefix.length + col };
  }
  return null;
}
