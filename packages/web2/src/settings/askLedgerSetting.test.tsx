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
    expect(screen.getByRole('option', { name: 'Ask the agent again, once, automatically' })).toBeTruthy();
  });

  it('its words never claim the app checks anything: it relays the agent’s own list', () => {
    render(<AskLedgerSetting />);
    const text = screen.getByTestId('settings-ask-ledger').textContent ?? '';
    expect(text).not.toMatch(/check/i);
    expect(screen.getByRole('option', { name: 'Show what the agent reports not done' })).toBeTruthy();
  });

  it('is off by default and remembers the choice', () => {
    render(<AskLedgerSetting />);
    const select = screen.getByLabelText('Ask the agent to list what it didn’t do') as HTMLSelectElement;
    expect(select.value).toBe('off');
    fireEvent.change(select, { target: { value: 'chip' } });
    expect(readAskLedgerMode()).toBe('chip');
  });
});
