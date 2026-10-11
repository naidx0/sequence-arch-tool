import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FontSetting } from './FontSetting';
import { FONT_CHOICES, FONT_KEY, applyFont, readFont, writeFont } from './fontPreference';

const root = () => document.documentElement;
const reset = () => {
  localStorage.clear();
  root().style.removeProperty('--font-sans');
  root().style.removeProperty('--font-ui');
  delete root().dataset.font;
};
beforeEach(reset);
afterEach(reset);

describe('interface font preference', () => {
  it('defaults to Inter and leaves the stylesheet face alone', () => {
    expect(readFont()).toBe('inter');
    applyFont();
    expect(root().style.getPropertyValue('--font-sans')).toBe('');
    expect(root().style.getPropertyValue('--font-ui')).toBe('');
  });

  it('a stored choice is read back and applied as the CSS variables on <html>', () => {
    writeFont('plex');
    expect(localStorage.getItem(FONT_KEY)).toBe('plex');
    expect(readFont()).toBe('plex');
    expect(root().style.getPropertyValue('--font-sans')).toMatch(/^"IBM Plex Sans"/);
    expect(root().style.getPropertyValue('--font-ui')).toMatch(/^"IBM Plex Sans"/);
    expect(root().style.getPropertyValue('--font-display')).toMatch(/^"IBM Plex Sans"/);
    writeFont('system');
    expect(root().style.getPropertyValue('--font-sans')).toMatch(/^system-ui/);
    writeFont('inter');
    expect(root().style.getPropertyValue('--font-sans')).toBe('');
    expect(root().style.getPropertyValue('--font-display')).toBe('');
  });

  it('an unknown stored value falls back to Inter', () => {
    localStorage.setItem(FONT_KEY, 'comic-sans');
    expect(readFont()).toBe('inter');
  });

  it('every offered face except the system one is bundled locally, and none comes from Google', () => {
    const css = readFileSync(path.resolve(__dirname, '../tokens/graphite.css'), 'utf8');
    expect(css).toMatch(/@import '@fontsource\/geist-sans\//);
    expect(css).toMatch(/@import '@fontsource\/ibm-plex-sans\//);
    expect(css).not.toMatch(/https?:\/\/fonts\./);
    for (const c of FONT_CHOICES) {
      if (c.id === 'system') expect(c.stack).toMatch(/^system-ui/);
    }
  });
});

describe('<FontSetting />', () => {
  it('is one dropdown row of the four faces with Inter chosen, and choosing one applies and persists it', () => {
    render(<FontSetting />);
    const btn = screen.getByTestId('settings-font-select');
    expect(btn.getAttribute('value')).toBe('inter');
    fireEvent.click(btn);
    const opts = screen.getAllByTestId('settings-font-select-option');
    expect(opts.map((o) => o.textContent)).toEqual(['Inter', 'Geist', 'IBM Plex Sans', 'System']);
    fireEvent.click(opts[1]!);
    expect(localStorage.getItem(FONT_KEY)).toBe('geist');
    expect(root().style.getPropertyValue('--font-sans')).toMatch(/^"Geist Sans"/);
    expect(screen.getByTestId('settings-font-select').getAttribute('value')).toBe('geist');
  });

  it('is mounted in Settings > Application right after Theme', () => {
    const panel = readFileSync(path.resolve(__dirname, 'SettingsPanel.tsx'), 'utf8');
    expect(panel).toMatch(/<ThemeSetting \/>\s*<FontSetting \/>/);
  });
});
