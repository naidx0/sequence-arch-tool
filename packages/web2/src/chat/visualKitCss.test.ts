import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FALLBACK_DARK, FALLBACK_LIGHT, visualDocument } from './visualDoc';
import { VISUAL_FONT, VISUAL_KIT_CLASSES, VISUAL_KIT_CSS } from './visualKit';

describe('the kit stylesheet inside an html drawing (the app components, not freelance styles)', () => {
  for (const [name, theme] of [['dark', FALLBACK_DARK], ['light', FALLBACK_LIGHT]] as const) {
    it(`${name}: the document carries every kit class before the agent's page, and the theme variables they read`, () => {
      const doc = visualDocument('<p id="agent">hi</p>', theme);
      for (const c of VISUAL_KIT_CLASSES) expect(doc, c).toContain(`.${c}`);
      expect(doc).toContain('.seq-btn.primary');
      expect(doc).toContain('--seq-surface:');
      expect(doc.indexOf('.seq-card')).toBeLessThan(doc.indexOf('id="agent"'));
      expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('.seq-card'));
    });
  }

  it('the kit takes its values from the app tokens: r14 card, hairline edge, 32px pill button, accent primary', () => {
    expect(VISUAL_KIT_CSS).toMatch(/\.seq-card\{[^}]*border:1px solid[^}]*border-radius:14px/);
    expect(VISUAL_KIT_CSS).toMatch(/\.seq-btn\{[^}]*height:32px[^}]*border-radius:999px/);
    expect(VISUAL_KIT_CSS).toMatch(/\.seq-btn\.primary\{background:var\(--seq-accent\)/);
    expect(VISUAL_KIT_CSS).toMatch(/\.seq-row\{display:flex[^}]*gap:8px/);
    expect(VISUAL_KIT_CSS).toMatch(/\.seq-stack\{display:flex;flex-direction:column;gap:8px/);
    expect(VISUAL_KIT_CSS).toMatch(/\.seq-muted\{color:var\(--seq-muted\)/);
  });

  it('colours come only from the theme variables: no hex or rgb literal, no gradient or shadow', () => {
    expect(VISUAL_KIT_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|gradient|shadow/i);
  });

  it('the scrollbar is the app thin one: 6px, transparent track', () => {
    expect(VISUAL_KIT_CSS).toContain('::-webkit-scrollbar{width:6px;height:6px}');
    expect(VISUAL_KIT_CSS).toMatch(/::-webkit-scrollbar-track[^{]*\{background:transparent\}/);
  });

  it('the body face is the app face (Inter first), in the document', () => {
    expect(VISUAL_FONT.startsWith('"Inter"')).toBe(true);
    expect(visualDocument('x', FALLBACK_DARK)).toContain(`font:14px/1.5 ${VISUAL_FONT}`);
  });

  it('the classes named in the agent prompt are exactly the kit classes', () => {
    const src = readFileSync(resolve(process.cwd(), '../acp/src/accessMode.ts'), 'utf8');
    const line = /only kit classes: ([^'"]+?)\. No own/.exec(src)?.[1] ?? '';
    const named = [...line.matchAll(/seq-[a-z]+/g)].map((m) => m[0]);
    expect([...new Set(named)].sort()).toEqual([...VISUAL_KIT_CLASSES].sort());
  });
});
