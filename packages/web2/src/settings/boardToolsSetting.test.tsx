import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentMapSetting } from './AgentMapSetting';

/* S2a: "Give coding agents every board tool" sits beside the map setting on
   the same /api/agent-settings; off by default (the core four), and a click
   sends only its own field. */

describe('the board tools switch', () => {
  it('reads the stored value, is off by default, and saves only allBoardTools', async () => {
    const puts: unknown[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ includeArchitectureMap: true, allBoardTools: true, map: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ includeArchitectureMap: true, allBoardTools: false, map: null }), { status: 200 });
    };
    render(<AgentMapSetting fetchImpl={fetchImpl as typeof fetch} />);
    const box = (await screen.findByTestId('settings-board-tools-toggle')) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(false);
    await act(async () => {
      fireEvent.click(box);
    });
    expect(puts).toEqual([{ allBoardTools: true }]);
    await waitFor(() => expect(box.checked).toBe(true));
  });
});
