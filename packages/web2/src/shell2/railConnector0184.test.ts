/* ══════════════════════════════════════════════════════════════════════════
   0.1.8.4: THE RAIL DRAWS NO LINE DOWN A FOLDER'S CHATS (it did, briefly)
   packages/web2/src/shell2/railConnector0184.test.ts

   Owner, of SimpleML's project with its threads under it: "a thin line following the hierarchy". Sequence's chats were
   indented 12 px with nothing joining them to their folder. The line is a ::before of the folder's chat list, in the
   existing edge token at the hairline width, centred on the folder row's icon. The numbers it is built from are the
   rail row's own (RailRow rule: 4 px inset, a 16 px chevron slot, a 6 px gap, a 16 px icon slot), checked here against
   the row rule itself so the two cannot drift apart.
   ══════════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';

import css from './shell2.css?raw';
import settings from '../settings/settings.css?raw';

const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (source: string, sel: string): string => [...strip(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim().replace(/\s+/g, ' ') === sel).map((m) => m[2]).join(';');

describe('the folder connector is gone (0.1.8.4)', () => {
  it('no ::before or ::after is drawn on the chat list of a folder: the chats read as inside it by their indent and the fold alone', () => {
    const decls = [...strip(css).matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim().replace(/\s+/g, ' '));
    const pseudo = decls.filter((sel) => sel.split(',').some((part) => /\.s2-proj-chats[^,]*::(before|after)/.test(part)));
    expect(pseudo).toEqual([]);
  });

  it('the chat list itself, the rows and the fold are still there', () => {
    expect(rule(css, '.s2-proj-chats')).toMatch(/display:\s*flex/);
    expect(rule(css, '.s2-rail-twist, .s2-rail-ic')).toMatch(/width:\s*16px/);
    expect(rule(css, '.s2-rail-row')).toMatch(/--rail-depth/);
  });
});

describe('Settings segmented controls on a narrow window', () => {
  it('take the card width at most and wrap their segments (390 px read "Syste" and ran off the card)', () => {
    const m = /@media \(max-width: 560px\) \{([\s\S]*?)\n\}/.exec(settings.slice(settings.indexOf('.sb-seg button:focus-visible')));
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toMatch(/\.settings-scope \.sb-seg \{[^}]*flex-wrap: wrap;[^}]*max-width: 100%/);
    expect(body).toMatch(/\.settings-scope \.sb-seg button \{[^}]*min-width: 0/);
  });
});
