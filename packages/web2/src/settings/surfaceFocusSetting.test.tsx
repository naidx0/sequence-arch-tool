import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FOCUS_LARGE_KEY, readFocusLarge, setFocusLarge } from '../shell2/layoutPrefs';
import { SurfaceFocusSetting } from './SurfaceFocusSetting';

afterEach(() => {
  cleanup();
  setFocusLarge(false);
  localStorage.removeItem(FOCUS_LARGE_KEY);
});

describe('"Open new surfaces large" setting', () => {
  it('is off by default and says what off does', () => {
    render(<SurfaceFocusSetting />);
    const sw = screen.getByRole('switch', { name: /Open new surfaces large/ }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(screen.getByTestId('settings-surface-focus-sub').textContent).toContain('share the workspace evenly');
    expect(readFocusLarge()).toBe(false);
  });

  it('turns on, is stored with the other layout prefs, and says what on does', () => {
    render(<SurfaceFocusSetting />);
    fireEvent.click(screen.getByTestId('settings-surface-focus-switch'));
    expect((screen.getByTestId('settings-surface-focus-switch') as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem(FOCUS_LARGE_KEY)).toBe('1');
    expect(screen.getByTestId('settings-surface-focus-sub').textContent).toContain('about 75%');
    fireEvent.click(screen.getByTestId('settings-surface-focus-switch'));
    expect(localStorage.getItem(FOCUS_LARGE_KEY)).toBe('0');
  });

  it('reads the stored choice when it mounts', () => {
    localStorage.setItem(FOCUS_LARGE_KEY, '1');
    render(<SurfaceFocusSetting />);
    expect((screen.getByTestId('settings-surface-focus-switch') as HTMLInputElement).checked).toBe(true);
  });
});

describe('Settings shows the Open new surfaces large row (0.1.6 B4, mounted by the lead)', () => {
  it('SettingsPanel imports and mounts SurfaceFocusSetting next to the version section', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'SettingsPanel.tsx'), 'utf8');
    expect(src).toMatch(/import \{ SurfaceFocusSetting \} from '\.\/SurfaceFocusSetting'/);
    expect(src).toMatch(/showing\('app'\) \? null : <SurfaceFocusSetting \/>/);
  });
});
