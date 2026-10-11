import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* THE BUTTON KIT (owner ruling, 0.1.4 UX round): a new surface copies the app's buttons, it does not
   invent a new button class. Three shapes exist, all defined in shell2/shell2.css, chat2.css, edits.css:
     secondary   .s2-btn (add .s2-btn-sm in a card or a row)      glass pill, never transparent
     primary     .s2-btn .s2-blue (the one primary)               solid accent
     destructive .s2-btn .s2-danger
     icon        .s2-ibtn (.s2-ibtn-sm | .s2-ibtn-xs)             the transparent ghost icon
     chip        .s2-chipbtn                                       24px glass pill for an inline action
   The subject set is DERIVED: every non-test .tsx under src/, every <button> whose className is a string
   literal (or the literal part of a template). A token passes when it is a kit class, or the button also
   carries a kit base class (the extra token is then only placement, e.g. margin-left: auto), or its family
   is one of the surface families below. Those families were already shipping when this guard was written
   (they are not a model to copy: a new surface uses the kit). A new family fails here; add to the list only
   with a comment that says why the kit cannot do the job. */

const KIT_BASE = new Set(['s2-btn', 's2-ibtn', 's2-chipbtn']);
const KIT = new Set([...KIT_BASE, 's2-btn-sm', 's2-blue', 's2-danger', 's2-solid', 's2-ibtn-sm', 's2-ibtn-xs', 's2-g', 's2-round', 's2-wide']);

/* Families that predate this guard, by owner surface. Prefix match on the class token. */
const GRANDFATHERED = [
  'ac-', 'ag-', 'agbtn', 'agnote-', 'ags-', 'agstarter', 'agsub-', 'agtoast-', 'ai-canvas-', 'ana-', 'annot-', 'ask-', 'attach-',
  'bbtn', 'bdock-', 'bmi', 'board', 'bpill', 'browser-pane-', 'bseg-', 'btag-', 'bview-', 'chart-', 'chip', 'cmd-', 'ctxring-',
  'dv-', 'editapproval-', 'emptychat-', 'failure-note-', 'files-', 'flowstep-', 'fr-', 'gf-', 'ghost', 'gv-', 'iconbtn',
  'keys-help-', 'lockchip', 'mention-row', 'menu', 'modelsel', 'nd-', 'opensrow', 'pb-', 'permsel', 'plusbtn', 'pq-',
  'prooffold-', 'prose-', 'r9-', 'rail-', 'reasonfold-', 'rewind-', 'rsub-', 'rv-', 'sb-', 'se-', 'sendbtn', 'shell-',
  'solid', 'startup-', 'tall', 'teach-', 'terminal-', 'tool-call-', 'trustbtn', 'v3-', 'vt', 'walk-', 'wb-', 'wfe-', 'wt-',
  /* The session shell's own row and menu chrome (rows, menu items, rail rows, status bar), not buttons. */
  's2-cf', 's2-fold', 's2-grow', 's2-iconrail-', 's2-it', 's2-mi', 's2-opt', 's2-pb', 's2-pill', 's2-proj-', 's2-rail-', 's2-rt-',
  's2-sb-', 's2-sec-', 's2-send', 's2-sp-', 's2-st-', 's2-stop', 's2-think-', 's2-wrap', 's2-ws-', 's2-chip-x',
  /* Modifier state classes the base classes above define. */
  'is-', 'dgm-toggle',
];

/* Justified exceptions, each with the reason the kit cannot do it. */
const EXCEPTIONS: Record<string, string> = {
  /* A full-width disclosure row (title and chevron), the same kind as s2-fold / rsub-row / s2-think-h. Not a button look. */
  'dgm-row': 'collapsed drawing card: a disclosure row, not a button',
};

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !/testSupport/.test(f));
}

/** The class tokens of each `<button className=...>` in a source: string literals only. */
export function buttonClassLists(source: string): string[][] {
  const out: string[][] = [];
  for (const m of source.matchAll(/<button\b/g)) {
    const seg = source.slice(m.index! + m[0].length, m.index! + m[0].length + 700);
    const end = seg.indexOf('</button>');
    const head = end >= 0 ? seg.slice(0, end) : seg;
    const c = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(head);
    if (!c) continue;
    const lit = (c[1] ?? c[2] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    out.push(lit.split(/\s+/).filter(Boolean));
  }
  return out;
}

/** The tokens of one button that nothing explains. A kit button may carry placement modifiers; any other button is judged by its base (first) class, and its modifiers follow it. */
export function strays(tokens: string[]): string[] {
  if (tokens.some((t) => KIT_BASE.has(t))) return [];
  const known = (t: string): boolean => KIT.has(t) || t in EXCEPTIONS || GRANDFATHERED.some((p) => t === p || t.startsWith(p));
  return known(tokens[0] ?? '') ? [] : tokens.slice(0, 1);
}

describe('buttons come from the kit (no new button class family)', () => {
  it('flags a planted invented button, passes a kit one and a kit one with a placement modifier', () => {
    expect(strays(['zz-fancy-btn'])).toEqual(['zz-fancy-btn']);
    expect(strays(['fo-btn'])).toEqual(['fo-btn']);
    expect(strays(['zz-new', 's2-chip-x'])).toEqual(['zz-new']);
    expect(strays(['s2-btn', 's2-btn-sm', 's2-blue'])).toEqual([]);
    expect(strays(['s2-btn', 's2-btn-sm', 'zz-place-me'])).toEqual([]);
    expect(buttonClassLists('<div><button type="button" className="a b" onClick={() => go()}>x</button></div>')).toEqual([['a', 'b']]);
    expect(buttonClassLists('<button className={`s2-btn${x ? " on" : ""}`}>x</button>')[0]).toContain('s2-btn');
  });

  it('reads the real tree', () => {
    const lists = sources(__dirname).flatMap((f) => buttonClassLists(readFileSync(join(__dirname, f), 'utf8')));
    expect(lists.length).toBeGreaterThan(150);
    expect(lists.filter((l) => l.includes('s2-btn')).length).toBeGreaterThan(8);
  });

  it('every <button className> in src is the kit, a kit button plus a placement class, or a known family', () => {
    const found: string[] = [];
    for (const f of sources(__dirname)) {
      for (const l of buttonClassLists(readFileSync(join(__dirname, f), 'utf8'))) {
        const s = strays(l);
        if (s.length) found.push(`${f}: ${s.join(' ')}`);
      }
    }
    expect(found).toEqual([]);
  });
});
