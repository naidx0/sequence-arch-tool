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

/* Claim T3: the count and token cost come from the server's payload (the MCP registry), never from a string typed in the row. */
describe('the board tools row reads the registry numbers from the payload', () => {
  const tools = { all: 23, core: ['map', 'who_calls', 'impact', 'architecture_changed', 'list_boards', 'create_board', 'draw', 'edit_workflow', 'drawings', 'visual', 'find_files'], allTokens: 5726, coreTokens: 2864 };
  const body = (over: Record<string, unknown> = {}) => JSON.stringify({ includeArchitectureMap: true, allBoardTools: false, map: { tokens: 3912 }, tools, ...over });

  it('shows the payload count and tokens, not the old 16 and 4.1k, and says what Off gives and what a turn is', async () => {
    render(<AgentMapSetting fetchImpl={(async () => new Response(body(), { status: 200 })) as typeof fetch} />);
    const sub = await screen.findByTestId('settings-board-tools-status');
    await waitFor(() => expect(sub.textContent).toBe("23 tools, about 5.7k tokens added to each agent session's tool list."));
    expect(document.body.textContent).not.toMatch(/16 tools|4\.1k/);
    expect(sub.getAttribute('title')).toContain('Off: the 11 core tools (the map, who calls, impact, the architecture diff,');
    expect(sub.getAttribute('title')).toContain('about 2.9k tokens');
    expect(sub.getAttribute('title')).toContain("A turn is one message you send and the agent's full reply.");
  });

  it('follows the numbers it is given', async () => {
    render(<AgentMapSetting fetchImpl={(async () => new Response(body({ tools: { ...tools, all: 31, allTokens: 900 } }), { status: 200 })) as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId('settings-board-tools-status').textContent).toMatch(/^31 tools, about 900 tokens/));
  });

  it('says what the map costs and where it is sent, with the turn definition on the line', async () => {
    render(<AgentMapSetting fetchImpl={(async () => new Response(body(), { status: 200 })) as typeof fetch} />);
    const st = await screen.findByTestId('settings-agent-map-status');
    await waitFor(() => expect(st.textContent).toContain("the map is about 3.9k tokens, sent with every question to Sequence's own model. Claude and Codex read it through the map tool when they need it."));
    expect(st.getAttribute('title')).toContain('one message you send');
  });

  it('with no counts from the server it shows none rather than a stale number', async () => {
    render(<AgentMapSetting fetchImpl={(async () => new Response(body({ tools: null }), { status: 200 })) as typeof fetch} />);
    await waitFor(() => expect((screen.getByTestId('settings-board-tools-toggle') as HTMLInputElement).disabled).toBe(false));
    const sub = screen.getByTestId('settings-board-tools-status');
    expect(sub.textContent).toBe('Every board tool, not only the core set.');
    expect(sub.textContent).not.toMatch(/\d/);
  });
});
