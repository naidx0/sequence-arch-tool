/**
 * `locate_symbol` — where is this DEFINED? Answered from the repository, not the model.
 *
 * ================================ THE MEASUREMENT ==========================
 * A six-question battery about this repository, every answer grep-checkable, put to
 * granite4-hermes through the real server: **0/6**. The failure was not that the
 * questions were hard. Asked "which source file builds the stalePaths array that
 * /api/status returns", the harness pre-read seven files chosen by filename overlap —
 * none of them `repoServer.ts`, where the answer is — and the model then read MORE of
 * a file it had been handed and answered out of it. It never ran
 * `search_files("stalePaths")`, which resolves in one call.
 *
 * All six questions named an identifier the index resolves with no model at all.
 * Three are already in the scanned function graph with an exact file and line:
 *
 *     deriveImportEdges -> packages/export/src/derivedEdges.ts:91    (model said "analyzer")
 *     validateAiConfig  -> packages/analyzer/src/server/provider.ts  (model invented a list)
 *     resolveShell      -> packages/analyzer/src/server/terminal.ts  (model invented a story)
 *
 * A product whose claim is "grounded, not guessed" should not route a DECIDABLE lookup
 * through model reasoning. A weak model does not have to be clever to be right here; it
 * has to call one tool and read the answer.
 *
 * ============================ WHY DECLARATIONS, NOT THE GRAPH ==============
 * The scanned function graph indexes FUNCTIONS. Two of the six answers are exported
 * consts, which are not in it, so a graph lookup would answer four questions and be
 * silent on two. Matching DECLARATION SHAPES covers functions, consts, classes,
 * interfaces, types and enums in one pass, and — the point — ranks a definition above
 * its call sites, which a substring search cannot do.
 *
 * ================================= WHAT IT NEVER DOES ======================
 * It does not guess. A symbol with no declaration in the searched files returns an
 * honest miss that says how many files were searched and what to try instead, rather
 * than the nearest plausible file. The evidence is the declaring line itself, so the
 * reader can check the claim without trusting the tool.
 */
import fs from 'node:fs';

/** Most hits worth printing. A symbol declared more than this is a naming problem. */
export const ASK_TOOL_LOCATE_MAX_HITS = 12;

/** One declaration shape, and how strongly it means "this is the definition". */
interface DeclarationShape {
  /** Built per-symbol so the name is anchored, never a substring of a longer id. */
  build: (name: string) => RegExp;
  /** Lower sorts first. 0 = exported, 1 = local, 2 = member. */
  rank: number;
  /** What the reader is told this line is. */
  what: string;
}

/**
 * Ordered by how definitive the shape is, not by how common it is.
 *
 * An EXPORTED declaration is what another package can import and therefore what
 * "where does this live" almost always means. A member or property function is a
 * real declaration and still the last thing to show, because a method named `run`
 * exists in fifty classes.
 */
const DECLARATION_SHAPES: readonly DeclarationShape[] = [
  {
    build: (n) =>
      new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class|interface|type|enum)\\s+${n}\\b`),
    rank: 0,
    what: 'exported declaration',
  },
  {
    build: (n) => new RegExp(`^\\s*export\\s+(?:const|let|var)\\s+${n}\\b`),
    rank: 0,
    what: 'exported binding',
  },
  {
    build: (n) => new RegExp(`^\\s*(?:async\\s+)?(?:function|class|interface|type|enum)\\s+${n}\\b`),
    rank: 1,
    what: 'declaration',
  },
  {
    build: (n) => new RegExp(`^\\s*(?:const|let|var)\\s+${n}\\s*[:=]`),
    rank: 1,
    what: 'binding',
  },
  {
    /* `handler: (req) => …` or `handler: function () {`. The arrow / `function` keyword is
       required so a plain `name: value` pair in an object literal is not a declaration. */
    build: (n) =>
      new RegExp(`^\\s*${n}\\s*[:=]\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>)`),
    rank: 2,
    what: 'property function',
  },
  {
    /*
     * A method DECLARATION opens a body; a call closes a statement. Without the trailing
     * brace this shape matched `resolveShell();` on its own line and reported four
     * "declarations" for a symbol declared once — precision this tool cannot afford,
     * since ranking a definition above its call sites is the only reason it exists.
     * An optional return-type annotation sits between the parens and the brace.
     */
    build: (n) =>
      new RegExp(
        `^\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+|async\\s+)*${n}\\s*\\([^)]*\\)\\s*(?::[^{;]+)?\\s*\\{\\s*$`,
      ),
    rank: 2,
    what: 'method',
  },
];

/** A test fixture of the same name is a real declaration and still not the answer. */
function isTestPath(rel: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.includes('/test/') || rel.includes('/__tests__/');
}

export interface LocatedDeclaration {
  file: string;
  line: number;
  text: string;
  what: string;
  rank: number;
}

export interface LocateSymbolOutcome {
  /** Empty when nothing was found — the caller decides how to say so. */
  hits: LocatedDeclaration[];
  filesExamined: number;
  /**
   * Files too large to scan, NAMED.
   *
   * A silent size-skip is what made this whole class of failure invisible. `repoServer.ts`
   * (337,114 bytes) sat above the old 256,000-byte ceiling, so a search for a symbol
   * declared inside it answered "no matches" and the reader concluded the symbol did not
   * exist — in the file that holds every API route, which is the file most questions are
   * about. A miss that hides what it did not look at is a lie by omission, so the names
   * come back with it.
   */
  skippedForSize: string[];
}

/**
 * Find every DECLARATION of `name`, best first.
 *
 * `readFile` returns the file's text or null (unreadable / outside the jail / too big);
 * `eachFile` walks candidate repo-relative paths. Both are injected so this stays a
 * pure function over a file set and can be tested without a repository.
 */
export function locateDeclarations(
  name: string,
  eachFile: (visit: (rel: string) => boolean) => void,
  readFile: (rel: string) => string | null,
  skippedForSize: string[] = [],
): LocateSymbolOutcome {
  const shapes = DECLARATION_SHAPES.map((s) => ({ re: s.build(name), rank: s.rank, what: s.what }));
  const hits: LocatedDeclaration[] = [];
  let filesExamined = 0;

  eachFile((rel) => {
    const raw = readFile(rel);
    if (raw === null) return true;
    filesExamined += 1;
    /* Cheap reject before six regexes touch a 3,000-line file. */
    if (!raw.includes(name)) return true;
    const lines = raw.split('\n');
    const testPenalty = isTestPath(rel) ? 4 : 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      for (const shape of shapes) {
        if (shape.re.test(line)) {
          hits.push({
            file: rel,
            line: i + 1,
            text: line.trim().slice(0, 160),
            what: shape.what,
            rank: shape.rank + testPenalty,
          });
          break; // one hit per line — the first shape that matches is the most specific
        }
      }
    }
    return true;
  });

  hits.sort((a, b) => a.rank - b.rank || a.file.localeCompare(b.file) || a.line - b.line);
  return { hits, filesExamined, skippedForSize };
}

/** Is this one identifier, rather than a phrase someone should have grepped for? */
export function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/** The tool's evidence string: the declaring lines themselves, so a reader can check it. */
export function renderLocateEvidence(name: string, outcome: LocateSymbolOutcome): string {
  const { hits, filesExamined, skippedForSize } = outcome;
  /* What was NOT looked at, always, and first when there is nothing else to say. A miss
     that omits this is how "no matches" came to mean "does not exist". */
  const unread =
    skippedForSize.length > 0
      ? ` NOT SEARCHED (too large): ${skippedForSize.slice(0, 5).join(', ')}` +
        (skippedForSize.length > 5 ? ` and ${skippedForSize.length - 5} more.` : '.')
      : '';
  if (hits.length === 0) {
    return (
      `locate_symbol "${name}" — no DECLARATION found in ${filesExamined} searched files.` +
      unread +
      ' It may be imported from a dependency, spelled differently, or only referenced. ' +
      'Try search_files to see where it is mentioned.'
    );
  }
  const shown = hits.slice(0, ASK_TOOL_LOCATE_MAX_HITS);
  const head = `locate_symbol "${name}" — ${hits.length} declaration${hits.length === 1 ? '' : 's'}`;
  const body = shown.map((h) => `  ${h.file}:${h.line}  (${h.what})\n    ${h.text}`).join('\n');
  const more = hits.length > shown.length ? `\n  … ${hits.length - shown.length} more` : '';
  return `${head}\n${body}${more}${unread ? `\n ${unread.trim()}` : ''}`;
}

/** Read a file for {@link locateDeclarations}, or null when it is not worth reading. */
export function makeFileReader(
  resolveReadable: (rel: string) => string | null,
  maxBytes: number,
  onTooLarge?: (rel: string, bytes: number) => void,
): (rel: string) => string | null {
  return (rel: string): string | null => {
    const abs = resolveReadable(rel);
    if (!abs) return null;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return null;
      if (stat.size > maxBytes) {
        /* Reported, never dropped — see LocateSymbolOutcome.skippedForSize. */
        onTooLarge?.(rel, stat.size);
        return null;
      }
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  };
}
