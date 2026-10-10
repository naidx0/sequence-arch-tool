import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SNAP_PREF_EVENT, readEditLogEnabled, readSnapMode } from '../whiteboard/snapPreference';
import { WhiteboardSetting } from './WhiteboardSetting';

describe('Settings > Whiteboard', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it('tidy-up defaults to Suggest and the edit log to on', () => {
    render(<WhiteboardSetting />);
    expect(screen.getByRole('radio', { name: 'Suggest' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'Tidy drawn shapes' }).className).toBe('sb-seg');
    expect((screen.getByTestId('settings-editlog-switch') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('settings-snap-hint').textContent).toMatch(/Enter takes it/);
  });

  it('choosing Auto or Off is remembered, announced to an open board, and explained', () => {
    let heard = 0;
    const on = () => (heard += 1);
    window.addEventListener(SNAP_PREF_EVENT, on);
    render(<WhiteboardSetting />);
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(readSnapMode()).toBe('auto');
    expect(screen.getByTestId('settings-snap-hint').textContent).toMatch(/Ctrl\+Z gives your stroke back/);
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    expect(readSnapMode()).toBe('off');
    expect(heard).toBe(2);
    window.removeEventListener(SNAP_PREF_EVENT, on);
  });

  it('the edit-log switch opts out, says where it lives and that it is never sent', () => {
    render(<WhiteboardSetting />);
    fireEvent.click(screen.getByTestId('settings-editlog-switch'));
    expect(readEditLogEnabled()).toBe(false);
    expect(screen.getByTestId('settings-editlog').textContent).toMatch(/\.sequence folder\. Never sent anywhere/);
  });
});
