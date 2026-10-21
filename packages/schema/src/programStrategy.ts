/**
 * Customer autoresearch strategy helpers — parse scoped edit allowlists from
 * `.sequence/program.md`. Pure + browser-safe (no disk I/O).
 */

/** Primary section heading in program.md (case-insensitive). */
export const PROGRAM_EDIT_ALLOWLIST_HEADING = 'Agent may edit';

/** Inline Setup-style line: "Agent may edit only `a/**` and `b.ts`." */
const INLINE_ONLY_RE = /Agent may edit only\s+(.+)/i;

/** Extract backtick-wrapped paths/globs from a line of markdown. */
function extractBacktickPaths(line: string): string[] {
  const out: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const p = m[1].trim();
    if (p.length > 0) out.push(p);
  }
  return out;
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^\s*[-*+]\s+/, '').trim();
}

function isPathOrGlobToken(token: string): boolean {
  if (token.length === 0) return false;
  if (token.includes(' ')) return false;
  // Reject obvious prose; globs/paths use alnum, /, ., -, _, *, ?
  return /^[\w./\-*?]+$/.test(token);
}

/** Collect glob/path tokens from one section line. */
function globsFromLine(line: string): string[] {
  const fromTicks = extractBacktickPaths(line);
  if (fromTicks.length > 0) return fromTicks;
  const stripped = stripBulletPrefix(line);
  if (isPathOrGlobToken(stripped)) return [stripped];
  return [];
}

function parseAgentMayEditSection(markdown: string): string[] | undefined {
  const lines = markdown.split(/\r?\n/);
  let inSection = false;
  const globs: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (inSection) break;
      if (heading[1].trim().toLowerCase() === PROGRAM_EDIT_ALLOWLIST_HEADING.toLowerCase()) {
        inSection = true;
        continue;
      }
      continue;
    }
    if (!inSection) continue;
    if (line.trim().length === 0) continue;
    globs.push(...globsFromLine(line));
  }

  return globs.length > 0 ? globs : undefined;
}

function parseInlineAgentMayEditOnly(markdown: string): string[] | undefined {
  const globs: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const m = raw.match(INLINE_ONLY_RE);
    if (!m) continue;
    const fromTicks = extractBacktickPaths(m[1]);
    if (fromTicks.length > 0) {
      globs.push(...fromTicks);
      continue;
    }
    // "path1 and path2" without backticks
    const parts = m[1].split(/\s+and\s+/i);
    for (const part of parts) {
      const t = part.replace(/[.,;]+$/, '').trim();
      if (isPathOrGlobToken(t)) globs.push(t);
    }
  }
  return globs.length > 0 ? globs : undefined;
}

/**
 * Parse scoped edit globs from program strategy markdown.
 * Returns undefined when no allowlist is declared (no restriction).
 */
export function parseProgramEditAllowlist(markdown: string): string[] | undefined {
  if (typeof markdown !== 'string' || markdown.trim().length === 0) return undefined;
  const section = parseAgentMayEditSection(markdown);
  if (section) return section;
  return parseInlineAgentMayEditOnly(markdown);
}

function matchSegment(globSeg: string, pathSeg: string): boolean {
  if (globSeg === '*') return true;
  if (globSeg.includes('*') || globSeg.includes('?')) {
    const re = new RegExp(
      '^' + globSeg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    );
    return re.test(pathSeg);
  }
  return globSeg === pathSeg;
}

function matchParts(globParts: string[], pathParts: string[]): boolean {
  if (globParts.length === 0) return pathParts.length === 0;
  if (globParts[0] === '**') {
    for (let i = 0; i <= pathParts.length; i++) {
      if (matchParts(globParts.slice(1), pathParts.slice(i))) return true;
    }
    return false;
  }
  if (pathParts.length === 0) return false;
  if (!matchSegment(globParts[0], pathParts[0])) return false;
  return matchParts(globParts.slice(1), pathParts.slice(1));
}

/** Match one repo-relative posix path against a glob (supports `*` and `**`). */
export function pathMatchesRepoGlob(path: string, glob: string): boolean {
  const normPath = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const normGlob = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normGlob.includes('*') && !normGlob.includes('?')) {
    return normPath === normGlob;
  }
  return matchParts(normGlob.split('/'), normPath.split('/'));
}

/** True when `path` matches any allowlist glob, or allowlist is empty/undefined. */
export function pathMatchesProgramEditAllowlist(
  path: string,
  allowlist: readonly string[] | undefined,
): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  return allowlist.some((g) => pathMatchesRepoGlob(path, g));
}
