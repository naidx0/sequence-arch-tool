import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * EVERY CLASS THIS PACKAGE RENDERS, AGAINST EVERY CLASS IT STYLES
 *
 * ── WHY ──────────────────────────────────────────────────────────────────
 *
 * `fe6f644e` (2026-09-14, "Ship V3 fill-screen chrome") deleted 5,615 lines of
 * CSS across sixteen sheets and added 1,882 to `v3.css`, leaving each emptied
 * file a one-line note: "retired — V3 chrome owns visuals".
 *
 * For the shell, the sessions rail, the terminal and the browser that note is
 * TRUE; `v3.css` carries those selectors and they render. For six other
 * surfaces it was not, and nobody found out from a test:
 *
 *   the AI Canvas       8 rendered class names, 1 rule   (found by eye, 19 Sep)
 *   Open a repository   25 names, 0 rules                (found by eye, 20 Sep)
 *   the edit-approval card, the boot screen, the chart primitives, the
 *   teach walk                                           (found by THIS, 20 Sep)
 *
 * Two of the six were reported by the owner, weeks apart, as "looks bad". The
 * other four were still shipping. One commit judged one blast radius and
 * applied it to sixteen sheets.
 *
 * ── WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────
 *
 * jsdom does no layout, so nothing here can see an ugly screen. What it can
 * see is the thing that was actually true every time: a class rendered with no
 * rule anywhere behind it. That is cheap, it is objective, and it is the exact
 * shape of all six failures.
 *
 * ONE GLOBAL POOL OF SELECTORS, on purpose. A class styled by any sheet the
 * app loads is styled; asking each component to be matched by its OWN sheet
 * would fail every surface that inherits from `chat.css` or `v3.css`, which is
 * most of them.
 *
 * A CEILING, NOT A ZERO. The remaining strays are containers whose children
 * are styled, and a few classes that exist only to be queried. The number may
 * go down and may not go up — that is what stops a sheet being emptied again
 * while leaving today's honest state describable.
 * ══════════════════════════════════════════════════════════════════════════
 */

const SRC = path.dirname(fileURLToPath(import.meta.url));

/**
 * The count of rendered-but-unstyled classes on 2026-09-20, after restoring the
 * six surfaces above. Lower it when you style more; never raise it.
 */
const CEILING = 30;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SRC);
const components = files.filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const sheets = files.filter((f) => f.endsWith('.css'));

/** Every `.name` any sheet declares, with comments stripped so prose is not a rule. */
function styledClasses(): Set<string> {
  const out = new Set<string>();
  for (const f of sheets) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of code.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) out.add(m[1]!);
  }
  return out;
}

/** Every literal class a component renders, by the file that renders it. */
function renderedClasses(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of components) {
    const text = fs.readFileSync(f, 'utf8');
    const hits = [
      ...text.matchAll(/className="([^"{}]+)"/g),
      ...text.matchAll(/className=\{`([^`]*)`\}/g),
      ...text.matchAll(/className=\{'([^']*)'\}/g),
    ];
    for (const m of hits) {
      /* An interpolation leaves its static neighbours behind, which is the
         part worth checking: `foo ${x}` still proves `foo` is rendered. */
      for (const cls of m[1]!.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (cls === '' || cls.includes('$') || !/^[A-Za-z][\w-]*$/.test(cls)) continue;
        if (!out.has(cls)) out.set(cls, new Set());
        out.get(cls)!.add(path.relative(SRC, f));
      }
    }
  }
  return out;
}

const styled = styledClasses();
const styledList = [...styled];
const rendered = renderedClasses();

/**
 * A name ending in `-` is a PREFIX, not a class: `files-line-${kind}` leaves
 * `files-line-` behind once the expression is stripped. It counts as styled
 * when any real class starts with it — eleven false positives without this.
 */
function isStyled(cls: string): boolean {
  return cls.endsWith('-') ? styledList.some((s) => s.startsWith(cls)) : styled.has(cls);
}

const unstyled = [...rendered.entries()]
  .filter(([cls]) => !isStyled(cls))
  .map(([cls, where]) => `${cls} (${[...where].join(', ')})`)
  .sort();

describe('every rendered class has a rule', () => {
  it('found the components and the sheets — a vacuity guard', () => {
    expect(components.length).toBeGreaterThan(100);
    expect(sheets.length).toBeGreaterThan(5);
    expect(rendered.size).toBeGreaterThan(800);
    expect(styled.size).toBeGreaterThan(800);
  });

  it(`leaves at most ${CEILING} classes unstyled`, () => {
    expect(
      unstyled.length,
      `${unstyled.length} rendered classes have no rule in any sheet:\n  ${unstyled.join('\n  ')}`,
    ).toBeLessThanOrEqual(CEILING);
  });

  it('the six restored surfaces are styled, by name', () => {
    /*
     * The ceiling alone would pass if somebody emptied a sheet and styled
     * thirty other things. These are the surfaces that were actually lost, so
     * they are named: a regression on any one of them fails with its own
     * sentence rather than as a number that moved.
     */
    for (const cls of [
      'ai-canvas-md-fence', // the AI Canvas block bodies
      'ai-canvas-react-host', // the canvas React block
      'attach-open', // Open a repository
      'startup-title', // the boot screen
      'editapproval-hd', // the accept/reject diff card
      'cbox', // the chart primitives
      'walk-step', // the teach walk
      'cc-head', // the code card
    ]) {
      expect(isStyled(cls), `.${cls} has no rule — a surface lost its sheet again`).toBe(true);
    }
  });
});
