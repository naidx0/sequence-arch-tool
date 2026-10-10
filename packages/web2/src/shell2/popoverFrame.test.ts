import { describe, expect, it } from 'vitest';

import chat2Raw from './chat2.css?raw';
import editsRaw from './edits.css?raw';
import shell2Raw from './shell2.css?raw';

/*
 * ROUND 8, item 6: one popover style. e2e/popovers-share.mjs opens every
 * pop-up it can reach in the built app and compares their computed frames.
 * Two cannot be opened on a static host (the toast and the takeover need an
 * agent run), so this holds them, and the tooltip and the context ring's
 * popover, to the same rule at the sheet: each is in the shared frame's
 * selector list, and no rule later in the shell's sheets restates a frame
 * property for it.
 */

const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const edits = strip(editsRaw);
const FRAME = ['border-radius', 'border', 'background', 'box-shadow', 'padding'];

function rules(css: string) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]!, at: m.index! }));
}

describe('one popover frame (round 8)', () => {
  const all = rules(edits);
  const shared = all.find((r) => /border-radius:\s*var\(--pop-r\)/.test(r.body));

  it('one rule draws the frame, for every kind of pop-up', () => {
    expect(shared).toBeTruthy();
    const list = shared!.sel.split(',').map((s) => s.trim());
    for (const want of ['.s2-menu', '.s2-dlg', '.s2-take', '.s2 .agtoast', '.s2 .s2-ctx .ctxring-panel', '.s2 .shell-cmd', ".s2 [role='tooltip']"]) expect(list).toContain(want);
    for (const p of FRAME) expect(shared!.body).toMatch(new RegExp(`${p}:[^;]*var\\(--pop-`));
  });

  it('nothing after it restates a frame property for one of them', () => {
    const list = shared!.sel.split(',').map((s) => s.trim());
    const later = all.filter((r) => r.at > shared!.at);
    const bad: string[] = [];
    for (const r of later) {
      for (const s of r.sel.split(',').map((x) => x.trim())) {
        if (!list.includes(s)) continue;
        for (const p of FRAME) if (new RegExp(`(^|;|\\n)\\s*${p}\\s*:`).test(r.body)) bad.push(`${s} { ${p} }`);
      }
    }
    expect(bad).toEqual([]);
    /* The control: the sheets loaded before edits.css do restate them (the old dialog's 24 px). */
    expect(strip(editsRaw.slice(0, editsRaw.indexOf('ROUND 8: ONE POPOVER')))).toMatch(/\.s2-dlg \{[^}]*border-radius:\s*24px/);
    expect(strip(shell2Raw) + strip(chat2Raw)).toMatch(/\.s2-menu \{/);
  });
});
