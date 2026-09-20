import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * EVERY CLASS THE DIALOG RENDERS HAS A RULE.
 *
 * ── THE FAULT ────────────────────────────────────────────────────────────
 *
 * `fe6f644e` (2026-09-14, "Ship V3 fill-screen chrome") deleted 551 of
 * `boot.css`'s 552 lines and left the note "retired Decision 22 — V3 chrome
 * owns visuals". V3 chrome owns the OVERLAY; it never owned what is inside
 * this one, and `AttachDialog.tsx` was not touched — it still renders
 * twenty-five `attach-*` classes and still imports the sheet.
 *
 * So for six days "Open a repository" rendered as raw HTML: `<ul>` bullets on
 * every row, labels overlapping, and the folder glyph at roughly 500px,
 * because `Glyph` writes no width or height and an `<svg>` with a viewBox and
 * no size defaults to 100% × 150px. Nothing failed. Every test passed.
 *
 * ── WHY THIS TEST AND NOT A SCREENSHOT ───────────────────────────────────
 *
 * jsdom does no layout, so a test here cannot see 500px. What it CAN see is
 * the thing that was actually true: a class rendered with no rule behind it.
 * That is the same check the AI Canvas earned in Decision 36 after the same
 * failure — eight rendered class names against one stylesheet rule — and it
 * is cheap enough to keep for every surface that owns its own sheet.
 *
 * It is deliberately about EXISTENCE, not appearance. It will not notice an
 * ugly dialog; it will notice a deleted one.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const component = fs.readFileSync(path.join(here, 'AttachDialog.tsx'), 'utf8');
const sheet = fs.readFileSync(path.join(here, 'boot.css'), 'utf8');
const icons = fs.readFileSync(path.join(here, 'icons.tsx'), 'utf8');

/** Every literal class name in `className="…"`, split on spaces. */
function renderedClasses(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/className="([^"{}]+)"/g)) {
    for (const cls of m[1]!.trim().split(/\s+/)) {
      if (cls !== '') out.add(cls);
    }
  }
  return [...out].sort();
}

describe('the open-a-repository dialog is styled', () => {
  it('renders the classes this test is about — a vacuity guard', () => {
    const classes = renderedClasses(component);
    expect(classes.length).toBeGreaterThan(15);
    expect(classes).toContain('attach-row');
    expect(classes).toContain('attach-open');
  });

  it('EVERY class it renders has at least one rule in boot.css', () => {
    const missing = renderedClasses(component).filter(
      (cls) => !new RegExp(`\\.${cls.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`).test(sheet),
    );
    expect(missing, `unstyled classes: ${missing.join(', ')}`).toEqual([]);
  });

  it('the glyph is SIZED here, because the component refuses to size it', () => {
    /*
     * `icons.tsx` states the rule it is relying on: "the colour of every icon
     * on this surface is decided by the CSS of the element it sits in". Size
     * is decided the same way, and when this rule went missing the browser's
     * own default — 100% wide, 150px tall — is what the reader saw. The
     * component writes NO width and NO height; that is the contract, and this
     * is the other half of it.
     */
    expect(icons).toMatch(/className=\{cls\}/);
    expect(icons).not.toMatch(/<svg[^>]*\swidth=/);
    for (const cls of ['.startup-i', '.startup-i.sz-12', '.startup-i.sz-20']) {
      expect(sheet, `${cls} must size the glyph`).toContain(cls);
    }
    expect(sheet).toMatch(/\.startup-i\s*\{[^}]*width:/);
  });

  it('carries no literal colour — the sheet is on the ramp', () => {
    /*
     * The deleted sheet predated the Graphite ramp and carried literals. A hex
     * value here would be a colour outside the token set, which is how a
     * surface starts disagreeing with the rest of the app one rule at a time.
     */
    const hex = [...sheet.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hex, `literal colours: ${hex.join(', ')}`).toEqual([]);
  });
});
