import { render } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { FontSetting } from './FontSetting';
import { ThemeSetting } from './ThemeSetting';
import { WhiteboardSetting } from './WhiteboardSetting';
import css from './settings.css?raw';

beforeEach(() => localStorage.clear());

/* Owner: "left it says the thing, right you choose the mode, like Theme". One row format for every single-choice setting. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

describe('single-choice settings are one row: label left, control right', () => {
  it('Theme, Font and Tidy-drawn-shapes rows all carry the one-line row class (.sb-theme: flex, centred, space-between)', () => {
    for (const C of [ThemeSetting, FontSetting]) {
      const { container, unmount } = render(<C />);
      const row = container.querySelector('.sb-row')!;
      expect(row.classList.contains('sb-theme')).toBe(true);
      expect(row.children).toHaveLength(2);
      unmount();
    }
    const { container } = render(<WhiteboardSetting />);
    const row = container.querySelector('[data-testid="settings-snap"]')!;
    expect(row.classList.contains('sb-theme')).toBe(true);
    expect(row.children).toHaveLength(2);
    expect(row.querySelector('.sb-seg')).not.toBeNull();
  });

  it('Font is a dropdown, not a segmented control that wraps under its label', () => {
    const { container } = render(<FontSetting />);
    expect(container.querySelector('.sb-seg')).toBeNull();
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.querySelector('.sb-select-btn')).not.toBeNull();
  });

  it('every segmented control in settings/* sits in a .sb-theme row and is the shared .sb-seg (no per-setting look)', () => {
    const dir = __dirname;
    const found: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      if (!/role="radiogroup"/.test(src)) continue;
      found.push(f);
      expect(src, f).toMatch(/className="sb-seg"/);
      expect(src, f).toMatch(/className="sb-row sb-theme/);
    }
    expect(found).toEqual(expect.arrayContaining(['ThemeSetting.tsx', 'WhiteboardSetting.tsx']));
  });

  it('the segmented control look is defined once: no other rule restyles .sb-seg buttons', () => {
    const own = rules.filter((r) => /\.sb-seg/.test(r.sel));
    expect(own.map((r) => r.sel).sort()).toEqual([
      '.settings-scope .sb-seg',
      '.settings-scope .sb-seg button',
      '.settings-scope .sb-seg button.is-on',
      '.settings-scope .sb-seg button:focus-visible',
      '.settings-scope .sb-seg button:hover',
    ]);
  });

  it('the one-line row class lets the label take the free width and the control stay on the right', () => {
    const body = rules.filter((r) => r.sel === '.settings-scope .sb-theme').map((r) => r.body).join(';');
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/justify-content:\s*space-between/);
    expect(body).toMatch(/flex-wrap:\s*nowrap/);
  });
});
