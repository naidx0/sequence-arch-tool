/* ══════════════════════════════════════════════════════════════════════════
   RESTRAINED SYNTAX HIGHLIGHTING — item 5.1
   packages/web2/src/review/syntax.ts

   GRAPHITE LAW 1: "Every hue on screen is a claim about the world, and there
   are never more hues than claims." A conventional highlighter spends five to
   nine hues on a claim about GRAMMAR — and spends them on the one surface
   whose two real hues, the add and remove washes, are the entire reason to
   look at it. Sheet 12.7 counts five coloured objects in an entire two-turn
   conversation; a keyword rainbow would put more than that on one LINE, and
   the diff's own arithmetic would stop reading as the loudest thing on screen.

   SO THE SEPARATION IS CARRIED BY THE INK RAMP AND BY WEIGHT, which is what
   the book already spends on hierarchy everywhere else:

       comment   --ink-4, italic     present, never competing
       keyword   --ink-1, --fw-solid the brightest ink the sheet has
       string    --ink-2
       number    --ink-2
       the rest  inherits

   HUE BUDGET FOR THIS MODULE: ZERO. `syntax.test.ts` asserts the class list,
   because the way this rule dies is a later paste of a Prism theme, and a
   paste is caught by a test naming the classes and by nothing else.

   IT IS A TOKENIZER AND DELIBERATELY NOT A PARSER, AND IT CARRIES NO
   CROSS-LINE STATE. A diff hunk starts in the middle of a file: there is no
   way to know whether line 40 is inside a block comment or a template
   literal. A highlighter that guesses paints half the hunk as a comment the
   moment a `/*` appears above the window, and the reader cannot tell that from
   the code actually being commented out. One line at a time is the only honest
   reading of a fragment, and `/* … *\/` on one line is still matched.

   LOSSLESS OR IT IS WRONG. The spans rejoin to the exact input, asserted. A
   tokenizer that drops a character renders a line that is not the line in the
   file, on the surface whose whole job is to show what changed.
   ══════════════════════════════════════════════════════════════════════════ */

/** The four token classes, and the assertion that there are only four. */
export const SYNTAX_CLASSES = ['kw', 'str', 'com', 'num'] as const;

export type SyntaxClass = (typeof SYNTAX_CLASSES)[number];

export interface SyntaxSpan {
  text: string;
  cls: SyntaxClass | null;
}

/** The languages this module can name. `txt` is the honest fallback. */
export type SyntaxLanguage = 'ts' | 'py' | 'go' | 'rs' | 'css' | 'json' | 'sh' | 'md' | 'txt';

const BY_EXTENSION: Record<string, SyntaxLanguage> = {
  ts: 'ts',
  tsx: 'ts',
  js: 'ts',
  jsx: 'ts',
  mjs: 'ts',
  cjs: 'ts',
  py: 'py',
  go: 'go',
  rs: 'rs',
  css: 'css',
  scss: 'css',
  json: 'json',
  sh: 'sh',
  bash: 'sh',
  md: 'md',
};

/**
 * Name a file's language from its extension, or refuse.
 *
 * A dotfile is not an extension: `.gitignore` is not a file of type
 * "gitignore" this module knows how to colour, and treating the leading dot as
 * a separator is how `.env` gets highlighted as a language called `env`.
 */
export function languageOf(path: string): SyntaxLanguage {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'txt';
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'txt';
}

/* ── the vocabularies ────────────────────────────────────────────────────── */

const C_LIKE = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'new', 'class', 'extends', 'implements', 'interface', 'type',
  'enum', 'import', 'export', 'from', 'as', 'default', 'async', 'await', 'yield', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'this', 'super', 'null', 'undefined',
  'true', 'false', 'void', 'delete', 'static', 'readonly', 'public', 'private', 'protected',
  'satisfies', 'keyof', 'infer', 'declare', 'namespace', 'abstract',
];

const KEYWORDS: Record<SyntaxLanguage, string[]> = {
  ts: C_LIKE,
  go: ['func', 'package', 'import', 'var', 'const', 'type', 'struct', 'interface', 'return', 'if',
    'else', 'for', 'range', 'switch', 'case', 'default', 'defer', 'go', 'chan', 'map', 'nil',
    'true', 'false', 'break', 'continue'],
  rs: ['fn', 'let', 'mut', 'const', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod',
    'match', 'if', 'else', 'for', 'while', 'loop', 'return', 'self', 'Self', 'where', 'async',
    'await', 'move', 'ref', 'dyn', 'true', 'false', 'None', 'Some'],
  py: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as',
    'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'pass', 'break', 'continue',
    'None', 'True', 'False', 'and', 'or', 'not', 'in', 'is', 'global', 'nonlocal', 'assert',
    'async', 'await'],
  sh: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac',
    'function', 'return', 'export', 'local', 'set'],
  css: [],
  json: ['true', 'false', 'null'],
  md: [],
  txt: [],
};

/** The line-comment opener each language uses. `null` means it has none. */
const LINE_COMMENT: Record<SyntaxLanguage, string | null> = {
  ts: '//',
  go: '//',
  rs: '//',
  css: null,
  json: null,
  py: '#',
  sh: '#',
  md: null,
  txt: null,
};

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const NUMBER = /0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/y;

/**
 * Tokenize one line.
 *
 * The scan is left to right and every branch consumes at least one character,
 * so it terminates on any input including an unterminated string or a lone
 * backslash. Adjacent untagged characters are coalesced into one span, so a
 * line of plain prose is one span rather than eighty.
 */
export function highlight(line: string, language: SyntaxLanguage): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  let plain = '';

  const flush = () => {
    if (plain === '') return;
    spans.push({ text: plain, cls: null });
    plain = '';
  };
  const emit = (text: string, cls: SyntaxClass) => {
    flush();
    if (text !== '') spans.push({ text, cls });
  };

  const keywords = new Set(KEYWORDS[language]);
  const comment = LINE_COMMENT[language];

  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    /* A comment runs to the end of the line, and it is checked FIRST so that
       `// return early` never yields a keyword. It is checked AFTER strings in
       the loop order below only in the sense that a `//` inside a string is
       consumed by the string branch before the scan ever reaches it — which is
       what keeps "https://example.test" out of the comment class. */
    if (comment !== null && line.startsWith(comment, i)) {
      emit(line.slice(i), 'com');
      return spans;
    }

    /* A block comment that OPENS AND CLOSES on this line. An unterminated one
       is deliberately not treated as a comment: the close could be anywhere
       below the hunk, and painting the rest of the line grey on a guess is the
       cross-line state this module refuses to keep. */
    if ((language === 'ts' || language === 'go' || language === 'rs' || language === 'css') && line.startsWith('/*', i)) {
      const close = line.indexOf('*/', i + 2);
      if (close !== -1) {
        emit(line.slice(i, close + 2), 'com');
        i = close + 2;
        continue;
      }
      plain += ch;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      /* An unterminated quote consumes to the end of the line. It is still a
         string as far as the reader is concerned, and — more importantly —
         leaving it unconsumed would let the scan read keywords out of prose
         that is plainly inside a quote. */
      emit(line.slice(i, Math.min(j, line.length)), 'str');
      i = Math.min(j, line.length);
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(line);
      if (m) {
        emit(m[0], 'num');
        i += m[0].length;
        continue;
      }
    }

    IDENT.lastIndex = i;
    const ident = IDENT.exec(line);
    if (ident) {
      /* WHOLE WORDS ONLY. The identifier is consumed as a unit before it is
         tested, so `reconstant` can never contribute a `const` — a substring
         match would highlight the middle of a name and make the line unreadable
         in exactly the place a reviewer is looking hardest. */
      if (keywords.has(ident[0])) emit(ident[0], 'kw');
      else plain += ident[0];
      i += ident[0].length;
      continue;
    }

    plain += ch;
    i += 1;
  }

  flush();
  return spans;
}
