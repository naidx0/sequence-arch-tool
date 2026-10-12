import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttentionSetting } from './AttentionSetting';
import { readWorkflowNotify } from './notifyPreference';

/*
 * S5: when Windows' own settings refuse toasts, Settings says so in one quiet
 * line and nothing more. The desktop bridge is faked with the status main
 * returns after a logged 'failed' event carrying HRESULT 0x803E0114
 * (desktop attention.test.ts proves main sets notificationsBlocked from it).
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function bridge(status: Record<string, unknown>) {
  const calls: unknown[] = [];
  vi.stubGlobal('sequence', {
    openRepo: async () => null,
    attention: async (req: unknown) => (calls.push(req), status),
  });
  return calls;
}

describe('AttentionSetting', () => {
  it('Windows blocking toasts: one quiet line, no instruction to change system settings', async () => {
    const calls = bridge({ waiting: 0, badge: 0, flashing: false, notificationsBlocked: true, notices: [{ title: 't', state: 'failed', error: 'Notification failed. HRESULT:-2143420140' }] });
    render(<AttentionSetting />);
    await act(async () => {});
    expect(calls).toEqual([{ kind: 'status' }]);
    const line = screen.getByTestId('settings-attention-os-blocked');
    expect(line.textContent).toBe('Windows is blocking Sequence notifications');
    expect(screen.getByTestId('settings-attention').textContent).not.toMatch(/settings to|turn on|enable/i);
  });

  it('touching the run switch is the opt-in that lets workflow runs notify (migration flag)', async () => {
    bridge({ notificationsBlocked: false, notices: [] });
    localStorage.clear();
    expect(readWorkflowNotify()).toBe(false);
    render(<AttentionSetting />);
    await act(async () => {});
    fireEvent.click(screen.getByTestId('settings-attention-turns').querySelector('input')!);
    fireEvent.click(screen.getByTestId('settings-attention-turns').querySelector('input')!);
    expect(readWorkflowNotify()).toBe(true);
  });

  it('no line once a toast has shown (main cleared the flag), and none in a browser', async () => {
    bridge({ notificationsBlocked: false, notices: [] });
    render(<AttentionSetting />);
    await act(async () => {});
    expect(screen.queryByTestId('settings-attention-os-blocked')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    render(<AttentionSetting />);
    await act(async () => {});
    expect(screen.queryByTestId('settings-attention-os-blocked')).toBeNull();
  });
});
