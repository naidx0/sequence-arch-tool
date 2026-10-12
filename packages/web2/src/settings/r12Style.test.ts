import { describe, expect, it } from 'vitest';

import css from './settings.css?raw';

/* Round 12 (ask 17): Settings in uiarc's soft glass. No drop shadows in the panel (only the floating menu
   lifts), one micro-label for every section, one pill for every button, never stretched across a card. */

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

describe('settings.css after the round 12 pass', () => {
  it('draws no drop shadow except on the floating menu (rings of 0 blur are focus and selection, not shadows)', () => {
    const lifted = rules.filter((r) => /box-shadow:[^;]*var\(--e\d\)/.test(r.body)).map((r) => r.sel);
    /* Round 13 (N3): the primary pill and the Local model / API key choices lift softly; nothing else does. */
    expect(lifted).toEqual(['.sb-menu', '.settings-scope .sb-pill-solid', '.settings-scope .sb-choice', ".settings-scope .sb-choice[data-open='true']"]);
  });

  it('the dialog is a hairline over the scrim, with no lift', () => {
    const panel = rules.find((r) => r.sel === ".s2 .v3-overlay-scrim[data-kind='settings'] .v3-overlay-panel");
    expect(panel?.body).toContain('box-shadow: 0 0 0 var(--w-hair) var(--edge-strong)');
  });

  it('every section label is the mono uppercase micro-label (no later rule turns it back into a sentence)', () => {
    const labs = rules.filter((r) => r.sel === '.settings-scope .sb-lab');
    expect(labs.length).toBe(1);
    expect(labs[0]!.body).toContain('font-family: var(--font-mono)');
    expect(labs[0]!.body).toContain('text-transform: uppercase');
  });

  it('a button in a card keeps its own width', () => {
    const r = rules.find((x) => x.sel.includes('.sb-card > .sb-pill'));
    expect(r?.body).toContain('align-self: flex-start');
  });

  it('the Theme select is drawn as the same soft pill', () => {
    const r = rules.find((x) => x.sel === '.settings-scope .sb-native > select');
    expect(r?.body).toContain('border-radius: var(--r-full)');
    expect(r?.body).toContain('appearance: none');
  });
});
