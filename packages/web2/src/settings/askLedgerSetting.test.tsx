import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AskLedgerSetting } from './AskLedgerSetting';
import { ASK_LEDGER_KEY, readAskLedgerMode } from './askLedgerPreference';

afterEach(() => localStorage.removeItem(ASK_LEDGER_KEY));

describe('the ask ledger setting', () => {
  it('says which chats it covers, that it relies on the agent, and where it is kept', () => {
    render(<AskLedgerSetting />);
    const sub = screen.getByTestId('settings-ask-ledger-sub').textContent ?? '';
    expect(sub).toContain('Claude and Codex chats only');
    expect(sub).toContain('relies on the agent’s own report');
    expect(sub).toContain('Saved here');
    fireEvent.click(screen.getByTestId('settings-ask-ledger-select'));
    expect(screen.getByRole('option', { name: /Ask the agent again, once, automatically/ })).toBeTruthy();
  });

  it('its words never claim the app checks anything: it relays the agent’s own list', () => {
    render(<AskLedgerSetting />);
    const text = screen.getByTestId('settings-ask-ledger').textContent ?? '';
    expect(text).not.toMatch(/check/i);
    fireEvent.click(screen.getByTestId('settings-ask-ledger-select'));
    expect(screen.getByRole('option', { name: /Show what the agent reports not done/ })).toBeTruthy();
  });

  it('is off by default and remembers the choice', () => {
    render(<AskLedgerSetting />);
    const select = screen.getByTestId('settings-ask-ledger-select');
    expect(select.getAttribute('value')).toBe('off');
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: /Show what the agent reports not done/ }));
    expect(readAskLedgerMode()).toBe('chip');
  });

  it('uses the kit select, never a native one that can run past its card', () => {
    const { container } = render(<AskLedgerSetting />);
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('.sb-native')).toBeNull();
  });
});
