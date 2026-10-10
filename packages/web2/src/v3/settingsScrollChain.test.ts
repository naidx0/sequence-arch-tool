import { describe, expect, it } from 'vitest';

import css from './v3.css?raw';
import host from './V3OverlayHost.tsx?raw';
import settingsCss from '../settings/settings.css?raw';

/* Owner: "You can't scroll the pages in Settings." The panel is a fixed-height flex column that clips; the
   settings body (.sb-body, overflow-y auto) only scrolls if every box between the panel and the body has a
   constrained height. The old selector `.v3-overlay-panel [role="dialog"]` was a DESCENDANT selector, but the
   panel itself carries role=dialog, so it matched nothing and the host div had no height at all. */

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (s: string) =>
  [...strip(s).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const body = (s: string, sel: string) =>
  rules(s).filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel)).map((r) => r.body).join(';');

describe('settings overlay height chain', () => {
  it('no rule uses the descendant [role=dialog] selector that misses the panel', () => {
    expect(strip(css)).not.toMatch(/\.v3-overlay-panel\s+\[role="dialog"\]/);
  });

  it('the settings host div carries a class the stylesheet constrains', () => {
    expect(host).toMatch(/className="v3-overlay-settings-host"[^>]*data-testid="overlay-settings"|data-testid="overlay-settings"[^>]*className="v3-overlay-settings-host"/);
    const b = body(css, '.v3-overlay-scrim[data-kind="settings"] .v3-overlay-settings-host');
    expect(b).toMatch(/display:\s*flex/);
    expect(b).toMatch(/flex-direction:\s*column/);
    expect(b).toMatch(/flex:\s*1 1 auto/);
    expect(b).toMatch(/min-height:\s*0/);
  });

  it('the settings panel inside the host fills it and the body is the scroller', () => {
    const scope = body(css, '.v3-overlay-panel .settings-scope');
    expect(scope).toMatch(/min-height:\s*0/);
    expect(scope).toMatch(/flex:\s*1 1 auto/);
    expect(scope).not.toMatch(/height:\s*100%/);
    const sb = body(settingsCss, '.settings-scope .sb-body');
    expect(sb).toMatch(/overflow-y:\s*auto/);
    expect(sb).toMatch(/min-height:\s*0/);
  });
});

describe('no inner box eats the wheel on the Agents pane', () => {
  it('the AGENTS.md preview is a capped glance, not a scroller', () => {
    const b = body(settingsCss, '.settings-scope .sb-instr-preview');
    expect(b).toMatch(/max-height:/);
    expect(b).toMatch(/overflow:\s*hidden/);
    expect(b).not.toMatch(/overflow(-y)?:\s*(auto|scroll)/);
  });
});
