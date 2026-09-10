import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * ITEM 0.6 — THE FIREWALL.
 *
 * "Pure modules are inherited. Rendered chrome is not." 197 React-free modules
 * carry forward; every .tsx is authored fresh against Graphite. This test is
 * the mechanism that makes that a fact rather than an intention.
 *
 * Four rules, each with a specific failure it prevents:
 *
 *   1. NO IMPORT FROM packages/web. packages/web was deleted 2026-08-20
 *      (Wave 7 cutover), but leftover gitignored dist on old machines and
 *      muscle memory still make "reach across and take it" the easiest wrong
 *      move. One import edge is all it costs: v1's own firewall report shows a
 *      single import in programs/ProgramGraph.tsx dragging 28 legacy canvas
 *      files into the live bundle. The demolition is about CONTAMINATION, not
 *      downtime — a surviving old surface gets referred to, copied from, and
 *      quietly reproduced.
 *
 *   2. NO .arch-rf- OR .product- CLASS NAMES. These are v1's two class
 *      namespaces. A copied class name is a copied layout arriving without its
 *      stylesheet, and it is how "forget how it used to look" quietly becomes
 *      "it looks the same but nothing is styled".
 *
 *   3. NO HEX LITERAL outside tokens/graphite.css. One file declares colour.
 *      A hex anywhere else is a hue that no theme can move, that the three-state
 *      switch cannot reach, and that the hue budget cannot count.
 *
 *   4. NO px FONT-SIZE outside tokens/graphite.css. The nine size-and-leading
 *      pairs have deliberately non-uniform ratios (17/22 is 1.29, 14/21 is
 *      1.50), so a hardcoded px size arrives
 *      without its paired line-height and quietly breaks the ladder. v1 carries
 *      255 usages on a half-pixel and 102 places rendering below the 10px floor,
 *      which is what happens when this is not enforced.
 *
 * THIS FILE LIVES OUTSIDE src/ ON PURPOSE. A scanner inside the tree it scans
 * matches its own patterns and reports itself, and the escapes from that are an
 * exclusion list nobody maintains or a pattern loosened until it stops seeing
 * itself. Neither is acceptable for the file whose whole job is to be strict.
 */

const SRC = resolve(process.cwd(), 'src');

/** The token source exempted by the colour, type-size, control-rung and
 *  font-weight value rules below. */
const TOKEN_FILE = join('tokens', 'graphite.css');

const SCANNED = new Set(['.ts', '.tsx', '.css']);

interface SourceFile {
  /** Path relative to src/, with the platform separator. */
  rel: string;
  text: string;
}

function collect(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    if (dot === -1 || !SCANNED.has(entry.name.slice(dot))) continue;
    /*
     * core.autocrlf=true, so a checkout on Windows has \r\n. Normalising here
     * means every pattern below can be written against \n and none of them has
     * to carry a \r? that someone will forget.
     */
    out.push({ rel: relative(SRC, full), text: readFileSync(full, 'utf8').replace(/\r\n/g, '\n') });
  }
  return out;
}

const FILES = collect(SRC);

const isTokenFile = (rel: string) => rel === TOKEN_FILE;

/** Comments are stripped for the class-name rule only.
 *
 *  Prose legitimately cites the old tree — this file's own header names
 *  ProgramGraph.tsx, and the token sheet cites product.css by line number.
 *  Those are references to a decision, not a class on an element. Code is
 *  where a class name can actually do damage, so code is where it is checked.
 *  The hex and font-size rules deliberately do NOT strip comments: a colour
 *  written down anywhere is a second source of truth waiting to be pasted. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every module specifier in a file: static import/export, side-effect import,
 *  dynamic import(), require(), and CSS @import. */
function specifiersIn(file: SourceFile): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
    /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of file.text.matchAll(pattern)) found.push(match[1]);
  }
  // Deduped: a CSS `@import '…'` is matched by both the @import pattern and
  // the side-effect-import pattern, and one breach should be reported once.
  return [...new Set(found)];
}

function landsInDeletedWeb(landed: string): boolean {
  const web = resolve(process.cwd(), '..', 'web');
  return landed === web || landed.startsWith(web + sep);
}

const FONT_SIZE_PATTERNS = [
  // CSS: font-size: 14px, and the font shorthand carrying a px size.
  /font-size\s*:\s*[^;{}]*?\d*\.?\d+px/gi,
  /(?:^|[\s;{])font\s*:\s*[^;{}]*?\d*\.?\d+px/gi,
  // TS/TSX inline styles: fontSize: '14px' and fontSize: 14.
  /fontSize\s*:\s*['"`][^'"`]*?\d*\.?\d+px/g,
  /fontSize\s*:\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?![\w.])/g,
];

function fontSizeDeclarationsIn(text: string): string[] {
  return FONT_SIZE_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[0].trim()),
  );
}

describe('item 0.6 — the packages/web firewall', () => {
  it('scans a non-empty tree', () => {
    /*
     * Every rule below is a "for each file, assert nothing matches" loop, and
     * all of them pass vacuously against an empty list. If the src/ resolution
     * ever breaks, this is the test that says so instead of six green ticks
     * that mean nothing.
     */
    expect(FILES.length).toBeGreaterThan(0);
    expect(FILES.some((f) => isTokenFile(f.rel))).toBe(true);
  });

  it('imports nothing from packages/web', () => {
    const violations: string[] = [];

    for (const file of FILES) {
      for (const spec of specifiersIn(file)) {
        if (spec.startsWith('.')) {
          /*
           * Resolved rather than pattern-matched. A relative specifier can
           * reach packages/web by any number of ../ hops and through any
           * intermediate name, and only resolution settles where it actually
           * lands.
           */
          const from = resolve(SRC, file.rel, '..');
          const landed = resolve(from, spec);
          if (landsInDeletedWeb(landed)) violations.push(`${file.rel}: ${spec}`);
          continue;
        }
        // Bare specifier: the workspace package, or a path that names it.
        if (/^@sequence\/web(?![\w-])/.test(spec)) violations.push(`${file.rel}: ${spec}`);
        if (/(^|\/)packages\/web(?![\w-])/.test(spec)) violations.push(`${file.rel}: ${spec}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('treats the deleted packages/web directory itself as forbidden', () => {
    expect(landsInDeletedWeb(resolve(process.cwd(), '..', 'web'))).toBe(true);
  });

  it('uses no .arch-rf- or .product- class name', () => {
    const violations: string[] = [];
    const pattern = /(?:^|[.\s"'`{])(arch-rf-|product-)[a-zA-Z0-9_-]+/g;

    for (const file of FILES) {
      for (const match of stripComments(file.text).matchAll(pattern)) {
        violations.push(`${file.rel}: ${match[0].trim()}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('declares no hex colour outside tokens/graphite.css', () => {
    const violations: string[] = [];
    // 3, 4, 6 or 8 digits — the four valid hex colour lengths. '#root' does not
    // match because 'r' is not a hex digit.
    const pattern = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

    for (const file of FILES) {
      if (isTokenFile(file.rel)) continue;
      for (const match of file.text.matchAll(pattern)) {
        violations.push(`${file.rel}: ${match[0]}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('writes no CONTROL RUNG height as a raw number', () => {
    /*
     * RULE 5 — the rungs are tokens too.
     *
     * `--control-h: 28px`, `--icon-btn: 26px` and `--row-h: 30px` are sheet
     * 10's control ladder. Three rules in `chat.css` wrote those numbers
     * instead: `.sendbtn` and `.strip` at 28px, `.toolrow` at 26px. Identical
     * today, and free to drift apart the moment the ladder moves - which is
     * the whole reason the other four rules in this file exist.
     *
     * ONLY THE LADDER'S OWN NUMBERS. A 16px icon is not "spacing 16" and a
     * 640px pane is not a rung; forcing a token onto a number that merely
     * coincides would be worse than the literal, because it would claim two
     * unrelated facts are one. This checks the three heights that ARE named
     * rungs, in the properties where a rung is what is being set.
     */
    /*
     * LAW 3, VERBATIM: "Thread rows 28px, tool rows 26px, controls 28px, icon
     * buttons 26px." Four rungs, two shared values - and a tool row is not an
     * icon button, so each has its own token and they are free to move apart.
     * A raw number picks none of them, which is why this rule names the token
     * to reach for rather than only reporting the digit.
     */
    const RUNGS: Record<string, string> = {
      '30': '--row-h',
      '28': '--control-h / --row-h-thread',
      '26': '--icon-btn / --row-h-tool',
    };
    const pattern = /(?:min-height|height)\s*:\s*(\d+)px/g;
    const violations: string[] = [];

    for (const file of FILES) {
      if (isTokenFile(file.rel)) continue;
      if (!file.rel.endsWith('.css')) continue;
      for (const match of stripComments(file.text).matchAll(pattern)) {
        const token = RUNGS[match[1] as string];
        if (token) violations.push(`${file.rel}: ${match[0]} -> use var(${token})`);
      }
    }

    expect(
      violations,
      'A control rung is a token, not a number. Point these at the ladder: ' +
        violations.join(' | '),
    ).toEqual([]);
  });

  it('declares no px font-size outside tokens/graphite.css', () => {
    const violations: string[] = [];

    for (const file of FILES) {
      if (isTokenFile(file.rel)) continue;
      for (const declaration of fontSizeDeclarationsIn(file.text)) {
        violations.push(`${file.rel}: ${declaration}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('recognises a numeric TSX fontSize as a raw size', () => {
    expect(fontSizeDeclarationsIn('style={{ fontSize: 14 }}')).toEqual(['fontSize: 14']);
  });

  /* ────────────────────────────────────────────────────────────────────────
     RULE 5 — NO RAW font-weight OUTSIDE tokens/graphite.css.

     THE DEFECT THIS EXISTS BECAUSE OF, measured at the Wave 2 gate:

       --fw-body / --fw-label / --fw-head / --fw-solid / --fw-verdict were
       consumed by ZERO rules, while fifteen raw font-weight declarations
       stood in src/ — five of them `550`, one of them `450`.

     @fontsource/instrument-sans ships the static cuts 400/500/600/700, and
     CSS Fonts 4 font-matching does NOT round to the nearest: a declared 450
     paints 500 and a declared 550 paints 600. Measured by glyph advance at
     40px, 450 and 500 paint IDENTICALLY and 550 and 600 paint identically.
     So body text rendered one cut heavy, and every element declaring 550 sat
     on the same painted weight as every element declaring 600 — the
     label-versus-heading distinction the ladder exists to draw was erased on
     exactly those elements.

     WHY THE EXISTING TEST DID NOT CATCH IT, which is the part worth keeping.
     tokens/graphite.test.ts asserts the --fw-* DECLARATIONS are shippable
     cuts. It is a true assertion about a ramp nothing used. A token layer can
     be perfect and the product still wrong, and the only thing that closes
     that gap is a rule about CONSUMPTION. Hence two tests, not one: nothing
     may declare a raw weight, and something must use the ramp.

     This is the same shape as rules 3 and 4 and it is here for the same
     reason they are: a number written outside the token file is a second
     source of truth that no theme can move and no ladder can count. It also
     keeps §4.6's ban on the source-grep tier coherent — this file is the ONE
     sanctioned scanner, so a new "no raw X in source" rule belongs in it
     rather than in a second file that would become a second exception.
     ──────────────────────────────────────────────────────────────────────── */
  it('declares no raw font-weight outside tokens/graphite.css', () => {
    const violations: string[] = [];
    const patterns = [
      // CSS longhand: `font-weight: 550`, `font-weight:bold`. A var(--fw-…)
      // is the only legal right-hand side, and `inherit` is not a weight — it
      // is a refusal to state one, which is what a child of a styled row wants.
      /font-weight\s*:\s*[^;}]+/gi,
      // TS/TSX inline style: fontWeight: 550, fontWeight: '550'.
      /fontWeight\s*:\s*[^,}\n]+/g,
    ];
    // The `font:` shorthand carries a weight in the same declaration as a size,
    // so it can set one without the word "font-weight" appearing anywhere.
    // Rule 4 already bans the shorthand whenever it carries a px size; this
    // catches the rest of it rather than leaving a hole the next paste finds.
    const shorthand = /(?:^|[\s;{])font\s*:\s*[^;{}]+/gi;

    const legal = (value: string) => {
      const rhs = value.slice(value.indexOf(':') + 1).trim();
      // Substitution only — `var(--fw-label)` yes, `var(--fw-label) !important`
      // yes, `calc(var(--fw-label) + 50)` no: arithmetic on a weight is how a
      // value that no file carries gets reintroduced without a literal.
      return /^var\(\s*--fw-[a-z0-9-]+\s*\)(\s*!important)?$/i.test(rhs) || rhs === 'inherit';
    };

    for (const file of FILES) {
      if (isTokenFile(file.rel)) continue;
      for (const pattern of patterns) {
        for (const match of file.text.matchAll(pattern)) {
          if (legal(match[0])) continue;
          violations.push(`${file.rel}: ${match[0].trim()}`);
        }
      }
      for (const match of file.text.matchAll(shorthand)) {
        // A bare integer or a weight keyword inside the shorthand.
        if (/(?:^|[\s/])(?:[1-9]00|[1-9]\d0|bold|bolder|lighter)(?:\s|\/|$)/.test(match[0])) {
          violations.push(`${file.rel}: ${match[0].trim()}`);
        }
      }
    }

    expect(
      violations,
      'Weight is a token, not a number. Point these at --fw-body/--fw-label/' +
        '--fw-head/--fw-solid/--fw-verdict: ' +
        violations.join(' | '),
    ).toEqual([]);
  });

  it('actually consumes the --fw- ramp', () => {
    /*
     * The other half, and the half the Wave 2 gate proved was missing. Rule 5
     * alone is satisfiable by a tree that declares no weight at all, which
     * would leave every surface on the browser's 400 and the ladder still
     * undrawn. A ban and a requirement together are what make the ramp real.
     *
     * Counted per NAME, not per occurrence: five tokens all consumed by one
     * sheet is a ladder; one token consumed five times is a habit.
     */
    const used = new Set<string>();
    for (const file of FILES) {
      if (isTokenFile(file.rel)) continue;
      for (const match of file.text.matchAll(/var\(\s*(--fw-[a-z0-9-]+)\s*\)/gi)) {
        used.add(match[1].toLowerCase());
      }
    }

    expect(
      [...used].sort(),
      'the --fw-* ramp is declared and consumed by nothing — see rule 5',
    ).toContain('--fw-body');
    expect(used.size).toBeGreaterThanOrEqual(3);
  });

  it('cites a sheet that exists — the trace-to-sheet rule, enforced', () => {
    // WHAT THIS REPLACED, AND WHY THE GUARANTEE SURVIVED THE CHANGE.
    //
    // This used to assert that every v2 file cited `docs/brand/graphite/v1/`
    // rather than the live book. The reason was real and is recorded in
    // GRAPHITE-DECISIONS.md: five books in seventeen days, and work finished
    // against a sheet must not be silently retargeted by a later edit to that
    // sheet. The mechanism, though, was a byte-identical SECOND COPY of the
    // whole book, and the owner's ruling (Decision 3) is one copy only.
    //
    // The no-silent-edit guarantee now lives where it cannot be satisfied by
    // duplication: tools/ci/graphite-freeze.test.mjs fails any commit that
    // edits a sheet without a matching entry in GRAPHITE-DECISIONS.md.
    //
    // What is left for THIS file is the half that copy-comparison never
    // covered and that §1.4 actually asks for — a citation must name a sheet
    // that exists. A typo, or a sheet that gets renamed out from under a
    // module, used to read as a perfectly valid frozen-path citation.
    //
    // Plain string scanning, not a RegExp: a pattern built here would need
    // escaped slashes, and escapes in this project have collapsed under a
    // shell heredoc six times. indexOf cannot fail that way.
    const BOOK = 'docs/brand/graphite/';
    const repoRoot = resolve(__dirname, '..', '..', '..');
    const violations: string[] = [];

    for (const file of FILES) {
      for (let i = file.text.indexOf(BOOK); i !== -1; i = file.text.indexOf(BOOK, i + 1)) {
        const rest = file.text.slice(i);
        const end = rest.search(/[\s"'`)\]]/);
        const cited = (end === -1 ? rest : rest.slice(0, end)).replace(/[.,;:]+$/, '');
        if (!cited.endsWith('.html') && !cited.endsWith('/')) continue;
        const probe = cited.endsWith('/') ? cited.slice(0, -1) : cited;
        if (existsSync(join(repoRoot, probe))) continue;
        const line = file.text.slice(0, i).split(String.fromCharCode(10)).length;
        violations.push(file.rel + ':' + line + ' cites ' + cited + ', which does not exist');
      }
    }

    expect(
      violations,
      'A v2 file names a Graphite sheet that is not there. Repoint it at a real ' +
        'sheet, or say the surface is unsheeted (see docs/brand/' +
        'GRAPHITE-SHELL-SHEETS-BRIEF.md): ' + violations.join(' | '),
    ).toEqual([]);
  });
});

describe('every custom property a stylesheet uses is one that exists', () => {
  /*
   * WRITTEN BECAUSE IT HAPPENED. Adding the streaming caret I reached for
   * `var(--sp-14)`. The space scale has no 14 — it runs 2, 4, 6, 8, 10, 12, 16,
   * 20, 24, 32, 40, 56 — so the declaration resolved to nothing, the caret got
   * a height of zero, and every gate in this repository stayed green. The
   * firewall above checks that values come from tokens rather than raw hex and
   * px; it never checked that the token being NAMED is real.
   *
   * That is the same defect class as everything else here: an assertion that
   * looks like coverage while the thing it names does not exist. A typo'd token
   * is invisible - no error, no console warning, just an element silently
   * sized, coloured or spaced to nothing.
   */
  const DEFINED = new Set<string>();
  const USED = new Map<string, string[]>();

  for (const file of FILES) {
    if (file.rel.endsWith('.css')) {
      for (const m of file.text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) DEFINED.add(m[1]);
      continue;
    }
    /*
     * SET FROM REACT STATE COUNTS AS DEFINED. The shell hands the cascade
     * `--shell-chat-over` and the board hands it `--board-cam-x` as inline
     * custom properties, which is the documented way a live number reaches CSS
     * here. Those are read out of the SOURCE rather than kept in an allow-list,
     * because an allow-list is a second copy that goes stale the moment one is
     * renamed - and a stale allow-list would hide exactly the typo this test
     * exists to catch.
     */
    for (const m of file.text.matchAll(/['"](--[a-z0-9-]+)['"]\s*:/gi)) DEFINED.add(m[1]);
  }
  for (const file of FILES) {
    if (!file.rel.endsWith('.css')) continue;
    for (const m of file.text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      const list = USED.get(m[1]) ?? [];
      list.push(file.rel);
      USED.set(m[1], list);
    }
  }

  it('found stylesheets and tokens to compare', () => {
    /* The vacuity guard the rest of this file already insists on: with an empty
       collection every assertion below passes without checking anything. */
    expect(DEFINED.size).toBeGreaterThan(50);
    expect(USED.size).toBeGreaterThan(50);
  });

  it('NAMES NO TOKEN THAT DOES NOT EXIST', () => {
    const missing: string[] = [];
    for (const [name, files] of USED) {
      /* A var() carrying its own fallback is a deliberate optional read, not a
         typo — `var(--x, 8px)` still renders when --x is absent. */
      if (!DEFINED.has(name)) missing.push(`${name} — used in ${[...new Set(files)].join(', ')}`);
    }
    expect(missing).toEqual([]);
  });
});
