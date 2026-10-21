/* 0.1.8.4: the Tree / Timeline / Workflows switch follows the pane (container) width, never the window. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(`${__dirname}/agentsSurface.css`, 'utf8');
const rules = (sel: RegExp): string[] => [...css.matchAll(sel)].map((m) => m[1]);

describe('agents tab switch per container width bucket', () => {
  it('the surface is the size container', () => {
    expect(css).toMatch(/\.ags \{ container-type: inline-size; \}/);
  });

  it('no viewport media query decides the tab look', () => {
    const media = [...css.matchAll(/@media[^{]*\{([\s\S]*?\n\})/g)].map((m) => m[1]).join('\n');
    expect(media).not.toMatch(/\.ags-seg/);
  });

  it('narrow bucket (under 480px, the base rules): icon-only, a 32px hit target, the word visually hidden but kept', () => {
    expect(css).toMatch(/\.ags-seg-ico \{ display: block;/);
    expect(css).toMatch(/\.ags-seg-btn \{[^}]*width: var\(--sp-32\)[^}]*min-height: var\(--sp-24\)[^}]*padding: 0/);
    expect(css).toMatch(/\.ags-seg-t \{[^}]*position: absolute[^}]*clip-path: inset\(50%\)/);
  });

  it('wide bucket (480px and up): icon and word, the word un-hidden', () => {
    const wide = rules(/@container \(min-width: 480px\) \{([\s\S]*?\n\})/g).join('\n');
    expect(wide).toMatch(/\.ags-seg-btn \{[^}]*width: auto/);
    expect(wide).toMatch(/\.ags-seg-t \{[^}]*position: static[^}]*clip-path: none/);
  });

  it('the head never wraps tabs: tabs and words do not wrap or shrink', () => {
    expect(css).toMatch(/\.ags-seg-btn \{ white-space: nowrap; \}/);
    expect(css).toMatch(/\.ags-seg \{ flex: none; \}/);
    expect(css).toMatch(/\.ags-seg-btn \{[^}]*flex: none/);
  });
});
